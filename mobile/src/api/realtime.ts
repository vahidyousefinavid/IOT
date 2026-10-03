import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { API_URL, freshAccessToken } from './http';
import { keys } from './queries';
import { useSession } from './session';
import type { Device } from './types';

interface ServerEvent {
  type: 'device.state' | 'device.created' | 'device.deleted' | 'subscribed';
  site_id: string;
  device_id?: string;
  data?: { state: Device['state']; online: boolean; last_seen: string };
}

/**
 * Keeps the device cache live over a WebSocket while the app is in the
 * foreground, reconnecting with exponential backoff.
 */
export function useRealtime(siteId: string | null) {
  const qc = useQueryClient();
  const signedIn = useSession((s) => !!s.tokens);

  useEffect(() => {
    if (!siteId || !signedIn) return;

    let ws: WebSocket | null = null;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;

    const onEvent = (e: ServerEvent) => {
      const key = keys.devices(siteId);
      if (e.type === 'device.state' && e.device_id && e.data) {
        const { state, online, last_seen } = e.data;
        qc.setQueryData<Device[]>(key, (list) =>
          list?.map((d) => (d.id === e.device_id ? { ...d, state, online, last_seen } : d)),
        );
      } else if (e.type === 'device.created' || e.type === 'device.deleted') {
        qc.invalidateQueries({ queryKey: key });
      }
    };

    const connect = async () => {
      if (closed) return;
      // Access tokens are short-lived; never reconnect with an expired one.
      const token = await freshAccessToken();
      if (!token || closed) return;
      // The token travels as a subprotocol (works in browsers too) and
      // never appears in the URL.
      ws = new WebSocket(`${API_URL.replace(/^http/, 'ws')}/v1/ws`, ['hooshban.v1', `bearer.${token}`]);
      ws.onopen = () => {
        retry = 0;
        ws?.send(JSON.stringify({ type: 'subscribe', site_id: siteId }));
        // Catch up on anything missed while disconnected.
        qc.invalidateQueries({ queryKey: keys.devices(siteId) });
      };
      ws.onmessage = (m) => {
        try {
          onEvent(JSON.parse(String(m.data)) as ServerEvent);
        } catch {
          /* ignore malformed frames */
        }
      };
      ws.onclose = () => {
        if (closed) return;
        const wait = Math.min(30_000, 1000 * 2 ** retry++) * (0.5 + Math.random() / 2);
        timer = setTimeout(connect, wait);
      };
    };

    const stop = () => {
      closed = true;
      clearTimeout(timer);
      ws?.close();
    };

    connect();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && closed) {
        closed = false;
        connect();
      } else if (s === 'background') {
        stop();
      }
    });
    return () => {
      sub.remove();
      stop();
    };
  }, [siteId, signedIn, qc]);
}
