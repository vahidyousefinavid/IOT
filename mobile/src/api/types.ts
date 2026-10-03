// Mirrors the Go API's JSON shapes.

export type Role = 'owner' | 'admin' | 'member' | 'guest';
export type SiteKind = 'home' | 'building' | 'machine';

export interface User {
  id: string;
  email: string;
  full_name: string;
  created_at: string;
}

export interface Tokens {
  access_token: string;
  expires_at: string;
  refresh_token: string;
}

export interface Site {
  id: string;
  name: string;
  kind: SiteKind;
  timezone: string;
  role: Role;
  created_at: string;
}

export interface Room {
  id: string;
  name: string;
  icon: string;
  sort: number;
}

export type DeviceKind =
  | 'light' | 'switch' | 'plug' | 'thermostat' | 'ac' | 'fan' | 'curtain'
  | 'lock' | 'sensor' | 'camera' | 'meter' | 'bridge' | 'machine' | 'tracker' | 'other';

export type Protocol = 'native' | 'zigbee2mqtt' | 'tasmota' | 'gt06' | 'h02';

/** Canonical state keys, see backend/internal/protocol. */
export interface DeviceState {
  on?: boolean;
  brightness?: number;
  color_temp?: number;
  target_temperature?: number;
  temperature?: number;
  humidity?: number;
  power?: number;
  energy?: number;
  battery?: number;
  position?: number;
  locked?: boolean;
  contact?: boolean;
  occupancy?: boolean;
  // GPS trackers
  lat?: number;
  lon?: number;
  speed?: number;
  course?: number;
  satellites?: number;
  gps_valid?: boolean;
  fix_time?: string;
  ignition?: boolean;
  power_cut?: boolean;
  gsm?: number;
  alarm?: string;
  alarm_at?: string;
  [key: string]: unknown;
}

export interface Device {
  id: string;
  site_id: string;
  room_id: string | null;
  parent_id: string | null;
  name: string;
  kind: DeviceKind;
  protocol: Protocol;
  external_id: string | null;
  state: DeviceState;
  online: boolean;
  last_seen: string | null;
  created_at: string;
}

export type Command = Partial<Pick<DeviceState, 'on' | 'brightness' | 'target_temperature' | 'position' | 'locked' | 'color_temp'>> & {
  immobilized?: boolean;
};

export interface Credentials {
  mqtt_username: string;
  mqtt_password: string;
  topic_root: string;
}

export interface Member {
  user_id: string;
  email: string;
  full_name: string;
  role: Role;
  joined_at: string;
}

export interface Invite {
  id: string;
  role: Role;
  expires_at: string;
  created_at: string;
  /** Only present right after creation. */
  code?: string;
}

export interface Point {
  t: string;
  v: number;
}

export interface TrackPoint {
  t: string;
  lat: number;
  lon: number;
  speed: number;
}

export type HistoryRange = '24h' | '7d' | '30d';
