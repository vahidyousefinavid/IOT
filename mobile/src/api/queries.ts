import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useEffect } from 'react';

import { backend, type NewDevice } from './backend';
import { useSession } from './session';
import type { Command, Device, HistoryRange } from './types';

export const keys = {
  sites: ['sites'] as const,
  rooms: (siteId: string) => ['rooms', siteId] as const,
  devices: (siteId: string) => ['devices', siteId] as const,
  history: (siteId: string, id: string, key: string, range: HistoryRange) => ['history', siteId, id, key, range] as const,
};

/** Loads the user's sites and selects the first one if none is selected. */
export function useSites() {
  const { siteId, setSite } = useSession();
  const q = useQuery({ queryKey: keys.sites, queryFn: backend.sites });
  useEffect(() => {
    const sites = q.data;
    if (sites?.length && !sites.some((s) => s.id === siteId)) setSite(sites[0].id);
  }, [q.data, siteId, setSite]);
  return { ...q, site: q.data?.find((s) => s.id === siteId) ?? null };
}

export function useRooms(siteId: string | null) {
  return useQuery({
    queryKey: keys.rooms(siteId ?? ''),
    queryFn: () => backend.rooms(siteId!),
    enabled: !!siteId,
  });
}

export function useDevices(siteId: string | null) {
  return useQuery({
    queryKey: keys.devices(siteId ?? ''),
    queryFn: () => backend.devices(siteId!),
    enabled: !!siteId,
  });
}

export function useDevice(siteId: string | null, id: string) {
  const q = useDevices(siteId);
  return { ...q, device: q.data?.find((d) => d.id === id) ?? null };
}

export function useHistory(siteId: string | null, id: string, key: string, range: HistoryRange) {
  return useQuery({
    queryKey: keys.history(siteId ?? '', id, key, range),
    queryFn: () => backend.history(siteId!, id, key, range),
    enabled: !!siteId,
    staleTime: 60_000,
  });
}

/**
 * Sends a command with an optimistic update: the UI reacts instantly and
 * the real state arrives over the WebSocket. On failure the change is rolled back.
 */
export function useCommand(siteId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cmd }: { id: string; cmd: Command }) => backend.command(siteId!, id, cmd),
    onMutate: async ({ id, cmd }) => {
      Haptics.selectionAsync().catch(() => {});
      const key = keys.devices(siteId ?? '');
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<Device[]>(key);
      qc.setQueryData<Device[]>(key, (list) =>
        list?.map((d) => (d.id === id ? { ...d, state: { ...d.state, ...cmd } } : d)),
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      if (ctx?.prev) qc.setQueryData(keys.devices(siteId ?? ''), ctx.prev);
    },
  });
}

export function useCreateDevice(siteId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewDevice) => backend.createDevice(siteId!, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.devices(siteId ?? '') }),
  });
}

export function useTrack(siteId: string | null, id: string, range: HistoryRange, enabled = true) {
  return useQuery({
    queryKey: ['track', siteId ?? '', id, range] as const,
    queryFn: () => backend.track(siteId!, id, range),
    enabled: !!siteId && enabled,
    refetchInterval: 30_000,
  });
}
