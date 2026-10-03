import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { create } from 'zustand';

import type { Tokens, User } from './types';

// Tokens live in the Keychain / Android Keystore, never in AsyncStorage.
const KEY = 'hooshban.session';
const storeOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

interface SessionState {
  ready: boolean;
  user: User | null;
  tokens: Tokens | null;
  siteId: string | null;
  hydrate: () => Promise<void>;
  signIn: (user: User, tokens: Tokens) => Promise<void>;
  setTokens: (tokens: Tokens) => Promise<void>;
  setSite: (siteId: string) => void;
  signOut: () => Promise<void>;
}

// SecureStore has no web implementation; the web build is a development
// preview only, so it keeps the session in sessionStorage (cleared with the tab).
const storage =
  Platform.OS === 'web'
    ? {
        get: async () => sessionStorage.getItem(KEY),
        set: async (v: string) => sessionStorage.setItem(KEY, v),
        del: async () => sessionStorage.removeItem(KEY),
      }
    : {
        get: () => SecureStore.getItemAsync(KEY, storeOptions),
        set: (v: string) => SecureStore.setItemAsync(KEY, v, storeOptions),
        del: () => SecureStore.deleteItemAsync(KEY, storeOptions),
      };

async function persist(user: User | null, tokens: Tokens | null) {
  if (!user || !tokens) {
    await storage.del();
    return;
  }
  await storage.set(JSON.stringify({ user, tokens }));
}

export const useSession = create<SessionState>((set, get) => ({
  ready: false,
  user: null,
  tokens: null,
  siteId: null,

  hydrate: async () => {
    try {
      const raw = await storage.get();
      if (raw) {
        const { user, tokens } = JSON.parse(raw) as { user: User; tokens: Tokens };
        set({ user, tokens });
      }
    } catch {
      await storage.del().catch(() => {});
    } finally {
      set({ ready: true });
    }
  },

  signIn: async (user, tokens) => {
    await persist(user, tokens);
    set({ user, tokens });
  },

  setTokens: async (tokens) => {
    await persist(get().user, tokens);
    set({ tokens });
  },

  setSite: (siteId) => set({ siteId }),

  signOut: async () => {
    await persist(null, null);
    set({ user: null, tokens: null, siteId: null });
  },
}));
