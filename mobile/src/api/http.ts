import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { useSession } from './session';
import type { Tokens } from './types';

/**
 * EXPO_PUBLIC_API_URL is required for release builds. In development it
 * falls back to port 8080 on the machine running the Expo dev server, so a
 * phone on the same Wi-Fi reaches the local stack without configuration.
 */
function resolveApiUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '');
  if (explicit) return explicit;
  if (!__DEV__) throw new Error('EXPO_PUBLIC_API_URL must be set for release builds');
  if (Platform.OS === 'web') return `http://${window.location.hostname}:8080`;
  const host = Constants.expoConfig?.hostUri?.split(':')[0] ?? 'localhost';
  return `http://${host}:8080`;
}

export const API_URL = resolveApiUrl();

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

// Only one refresh may be in flight: refresh tokens rotate, so two parallel
// refreshes would look like token theft to the server and end the session.
let refreshing: Promise<boolean> | null = null;

async function refreshTokens(): Promise<boolean> {
  const { tokens, setTokens, signOut } = useSession.getState();
  if (!tokens) return false;
  try {
    const res = await fetch(`${API_URL}/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: tokens.refresh_token }),
    });
    if (!res.ok) {
      await signOut();
      return false;
    }
    const body = (await res.json()) as { tokens: Tokens };
    await setTokens(body.tokens);
    return true;
  } catch {
    return false;
  }
}

function refreshOnce(): Promise<boolean> {
  refreshing ??= refreshTokens().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

/** Refreshes the access token if it expires within 30 seconds. */
export async function freshAccessToken(): Promise<string | null> {
  const tokens = useSession.getState().tokens;
  if (!tokens) return null;
  if (new Date(tokens.expires_at).getTime() - Date.now() < 30_000) await refreshOnce();
  return useSession.getState().tokens?.access_token ?? null;
}

export async function request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  const token = useSession.getState().tokens?.access_token;
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'network', 'network error');
  }

  if (res.status === 401 && retry && token) {
    if (await refreshOnce()) return request<T>(method, path, body, false);
  }
  if (res.status === 204 || res.status === 202) return undefined as T;

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = data?.error ?? {};
    throw new ApiError(res.status, err.code ?? 'internal', err.message ?? res.statusText);
  }
  return data as T;
}
