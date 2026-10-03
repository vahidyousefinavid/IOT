import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';

import { backend, type DevicePatch } from './backend';
import { keys } from './queries';
import { useSession } from './session';
import type { Role, SiteKind } from './types';

export const adminKeys = {
  members: (siteId: string) => ['members', siteId] as const,
  invites: (siteId: string) => ['invites', siteId] as const,
};

export const canAdmin = (role: Role | undefined) => role === 'owner' || role === 'admin';

/** A mutation that refreshes the given queries once it succeeds. */
function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>, invalidate: (...args: A) => QueryKey[]) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: A) => fn(...args),
    onSuccess: (_r, args) => Promise.all(invalidate(...args).map((queryKey) => qc.invalidateQueries({ queryKey }))),
  });
}

export function useMembers(siteId: string | null) {
  return useQuery({ queryKey: adminKeys.members(siteId ?? ''), queryFn: () => backend.members(siteId!), enabled: !!siteId });
}

export function useInvites(siteId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: adminKeys.invites(siteId ?? ''),
    queryFn: () => backend.invites(siteId!),
    enabled: !!siteId && enabled,
  });
}

export const useCreateSite = () => {
  const setSite = useSession((s) => s.setSite);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, kind }: { name: string; kind: SiteKind }) => backend.createSite(name, kind),
    onSuccess: async (s) => {
      await qc.invalidateQueries({ queryKey: keys.sites });
      setSite(s.id);
    },
  });
};

export const useRedeemInvite = () => {
  const setSite = useSession((s) => s.setSite);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => backend.redeemInvite(code),
    onSuccess: async (s) => {
      await qc.invalidateQueries({ queryKey: keys.sites });
      setSite(s.id);
    },
  });
};

export const useUpdateSite = () =>
  useAction((id: string, name: string) => backend.updateSite(id, { name }), () => [keys.sites]);

export const useDeleteSite = () =>
  useAction((id: string) => backend.deleteSite(id), () => [keys.sites]);

export const useCreateRoom = () =>
  useAction((siteId: string, name: string) => backend.createRoom(siteId, name), (siteId) => [keys.rooms(siteId)]);

export const useRenameRoom = () =>
  useAction((siteId: string, roomId: string, name: string) => backend.updateRoom(siteId, roomId, { name }), (siteId) => [keys.rooms(siteId)]);

export const useDeleteRoom = () =>
  useAction((siteId: string, roomId: string) => backend.deleteRoom(siteId, roomId), (siteId) => [keys.rooms(siteId), keys.devices(siteId)]);

export const useSetRole = () =>
  useAction((siteId: string, userId: string, role: Role) => backend.setRole(siteId, userId, role), (siteId) => [adminKeys.members(siteId)]);

export const useRemoveMember = () =>
  useAction((siteId: string, userId: string) => backend.removeMember(siteId, userId), (siteId) => [adminKeys.members(siteId), keys.sites]);

export const useCreateInvite = () =>
  useAction((siteId: string, role: Role) => backend.createInvite(siteId, role), (siteId) => [adminKeys.invites(siteId)]);

export const useRevokeInvite = () =>
  useAction((siteId: string, id: string) => backend.revokeInvite(siteId, id), (siteId) => [adminKeys.invites(siteId)]);

export const useUpdateDevice = () =>
  useAction((siteId: string, id: string, patch: DevicePatch) => backend.updateDevice(siteId, id, patch), (siteId) => [keys.devices(siteId)]);

export const useDeleteDevice = () =>
  useAction((siteId: string, id: string) => backend.deleteDevice(siteId, id), (siteId) => [keys.devices(siteId)]);

export const useRotateCredentials = () =>
  useMutation({ mutationFn: ([siteId, id]: [string, string]) => backend.rotateCredentials(siteId, id) });
