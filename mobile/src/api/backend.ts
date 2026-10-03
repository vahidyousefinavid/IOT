import { request } from './http';
import type {
  Command, Credentials, Device, DeviceKind, HistoryRange, Invite, Member, Point, Protocol, Role, Room, Site, SiteKind,
  Tokens, TrackPoint, User,
} from './types';

export interface Session {
  user: User;
  tokens: Tokens;
}

export interface NewDevice {
  name: string;
  kind: DeviceKind;
  protocol: Protocol;
  room_id: string | null;
  /** IMEI / ID for GPS trackers. */
  external_id?: string;
}

export interface DevicePatch {
  name?: string;
  kind?: DeviceKind;
  room_id?: string;
}

const site = (id: string) => `/v1/sites/${id}`;

/** Typed client for the Hooshban API (backend/internal/*). */
export const backend = {
  // auth & account
  login: (email: string, password: string) => request<Session>('POST', '/v1/auth/login', { email, password }),
  register: (full_name: string, email: string, password: string) =>
    request<Session>('POST', '/v1/auth/register', { full_name, email, password }),
  logout: (refresh_token: string) => request<void>('POST', '/v1/auth/logout', { refresh_token }),
  logoutAll: () => request<void>('POST', '/v1/me/logout-all'),
  changePassword: (current_password: string, new_password: string) =>
    request<void>('POST', '/v1/me/password', { current_password, new_password }),

  // sites
  sites: async () => (await request<{ sites: Site[] }>('GET', '/v1/sites')).sites,
  createSite: (name: string, kind: SiteKind) => request<Site>('POST', '/v1/sites', { name, kind }),
  updateSite: (id: string, patch: { name?: string }) => request<Site>('PATCH', site(id), patch),
  deleteSite: (id: string) => request<void>('DELETE', site(id)),
  redeemInvite: (code: string) => request<Site>('POST', '/v1/invites/redeem', { code }),

  // rooms
  rooms: async (siteId: string) => (await request<{ rooms: Room[] }>('GET', `${site(siteId)}/rooms`)).rooms,
  createRoom: (siteId: string, name: string, icon?: string) => request<Room>('POST', `${site(siteId)}/rooms`, { name, icon }),
  updateRoom: (siteId: string, roomId: string, patch: { name?: string; icon?: string }) =>
    request<Room>('PATCH', `${site(siteId)}/rooms/${roomId}`, patch),
  deleteRoom: (siteId: string, roomId: string) => request<void>('DELETE', `${site(siteId)}/rooms/${roomId}`),

  // members & invites
  members: async (siteId: string) => (await request<{ members: Member[] }>('GET', `${site(siteId)}/members`)).members,
  setRole: (siteId: string, userId: string, role: Role) => request<void>('PATCH', `${site(siteId)}/members/${userId}`, { role }),
  removeMember: (siteId: string, userId: string) => request<void>('DELETE', `${site(siteId)}/members/${userId}`),
  invites: async (siteId: string) => (await request<{ invites: Invite[] }>('GET', `${site(siteId)}/invites`)).invites,
  createInvite: (siteId: string, role: Role) => request<Invite>('POST', `${site(siteId)}/invites`, { role }),
  revokeInvite: (siteId: string, id: string) => request<void>('DELETE', `${site(siteId)}/invites/${id}`),

  // devices
  devices: async (siteId: string) => (await request<{ devices: Device[] }>('GET', `${site(siteId)}/devices`)).devices,
  createDevice: (siteId: string, input: NewDevice) =>
    request<{ device: Device; credentials: Credentials | null }>('POST', `${site(siteId)}/devices`, input),
  updateDevice: (siteId: string, id: string, patch: DevicePatch) => request<Device>('PATCH', `${site(siteId)}/devices/${id}`, patch),
  deleteDevice: (siteId: string, id: string) => request<void>('DELETE', `${site(siteId)}/devices/${id}`),
  rotateCredentials: (siteId: string, id: string) => request<Credentials>('POST', `${site(siteId)}/devices/${id}/credentials`),
  command: (siteId: string, id: string, cmd: Command) => request<void>('POST', `${site(siteId)}/devices/${id}/commands`, cmd),
  track: async (siteId: string, id: string, range: HistoryRange) =>
    (await request<{ points: TrackPoint[] }>('GET', `${site(siteId)}/devices/${id}/track?range=${range}`)).points,
  history: async (siteId: string, id: string, key: string, range: HistoryRange) =>
    (
      await request<{ points: Point[] }>(
        'GET',
        `${site(siteId)}/devices/${id}/history?key=${encodeURIComponent(key)}&range=${range}`,
      )
    ).points,
};
