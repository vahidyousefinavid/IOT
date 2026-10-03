import {
  AirVent, Blinds, Camera, Car, Cpu, Factory, Fan, Gauge, Lightbulb, Lock,
  Plug, Radio, Thermometer, ToggleRight, type LucideIcon,
} from 'lucide-react-native';

import type { Device, DeviceKind, Protocol } from '@/api/types';
import { fa, faNumber } from '@/lib/format';
import type { Accent } from '@/theme/tokens';

interface KindMeta {
  label: string;
  icon: LucideIcon;
  accent: Accent;
  /** Whether a single tap on the tile toggles `on`. */
  toggleable: boolean;
}

export const kindMeta: Record<DeviceKind, KindMeta> = {
  light: { label: 'چراغ', icon: Lightbulb, accent: 'amber', toggleable: true },
  switch: { label: 'کلید', icon: ToggleRight, accent: 'mint', toggleable: true },
  plug: { label: 'پریز هوشمند', icon: Plug, accent: 'mint', toggleable: true },
  thermostat: { label: 'ترموستات', icon: Thermometer, accent: 'sky', toggleable: true },
  ac: { label: 'کولر', icon: AirVent, accent: 'sky', toggleable: true },
  fan: { label: 'فن', icon: Fan, accent: 'sky', toggleable: true },
  curtain: { label: 'پرده', icon: Blinds, accent: 'violet', toggleable: false },
  lock: { label: 'قفل', icon: Lock, accent: 'violet', toggleable: false },
  sensor: { label: 'سنسور', icon: Gauge, accent: 'sky', toggleable: false },
  camera: { label: 'دوربین', icon: Camera, accent: 'rose', toggleable: false },
  meter: { label: 'کنتور', icon: Gauge, accent: 'mint', toggleable: false },
  bridge: { label: 'هاب / بریج', icon: Radio, accent: 'violet', toggleable: false },
  machine: { label: 'ماشین صنعتی', icon: Factory, accent: 'amber', toggleable: true },
  tracker: { label: 'ردیاب خودرو', icon: Car, accent: 'sky', toggleable: false },
  other: { label: 'سایر', icon: Cpu, accent: 'mint', toggleable: true },
};

export const addableKinds: DeviceKind[] = [
  'light', 'switch', 'plug', 'thermostat', 'ac', 'fan', 'curtain', 'lock', 'sensor', 'meter', 'bridge', 'machine', 'tracker',
];

export const protocolMeta: Record<Protocol, { label: string; hint: string }> = {
  native: { label: 'هوشبان (ESP32)', hint: 'فرم‌ور اختصاصی روی ESP32 / ESP8266' },
  zigbee2mqtt: { label: 'Zigbee', hint: 'بیش از ۴۰۰۰ دستگاه زیگبی از طریق Zigbee2MQTT' },
  tasmota: { label: 'Tasmota', hint: 'پریزها و رله‌های Sonoff، Tuya و ESP با تاسموتا' },
  gt06: { label: 'GT06 / Concox', hint: 'اکثر ردیاب‌های سیم‌کارتی خودرو (GT06N، TK100 و مشابه‌ها)' },
  h02: { label: 'H02 / Sinotrack', hint: 'سینوترک ST-901، ST-906 و ردیاب‌های مشابه' },
};

export const mqttProtocols: Protocol[] = ['native', 'zigbee2mqtt', 'tasmota'];
export const trackerProtocols: Protocol[] = ['gt06', 'h02'];

/** Server port each tracker protocol connects to (docker-compose.yml). */
export const trackerPorts: Partial<Record<Protocol, number>> = {
  gt06: Number(process.env.EXPO_PUBLIC_GT06_PORT ?? 5023),
  h02: Number(process.env.EXPO_PUBLIC_H02_PORT ?? 5013),
};

export function isActive(d: Device): boolean {
  if (d.kind === 'lock') return d.state.locked === false;
  if (d.kind === 'curtain') return (d.state.position ?? 0) > 0;
  if (d.kind === 'tracker') return (d.state.speed ?? 0) > 3;
  return d.state.on === true;
}

/** One short line describing what the device is doing right now. */
export function statusLine(d: Device): string {
  if (!d.online) return 'آفلاین';
  const s = d.state;
  switch (d.kind) {
    case 'light':
      return s.on ? (s.brightness != null ? `روشن، ${fa(Math.round(s.brightness))}٪` : 'روشن') : 'خاموش';
    case 'thermostat':
    case 'ac':
      if (!s.on) return 'خاموش';
      return s.target_temperature != null ? `تنظیم روی ${fa(s.target_temperature)}°` : 'روشن';
    case 'plug':
    case 'machine':
      if (!s.on) return 'خاموش';
      return s.power != null ? `${faNumber(s.power)} وات` : 'روشن';
    case 'tracker':
      if (s.power_cut) return 'موتور قطع است';
      if ((s.speed ?? 0) > 3) return `در حرکت، ${fa(Math.round(s.speed ?? 0))} کیلومتر`;
      return s.ignition ? 'روشن، متوقف' : 'پارک';
    case 'curtain':
      return s.position ? `${fa(Math.round(s.position))}٪ باز` : 'بسته';
    case 'lock':
      return s.locked === false ? 'باز' : 'قفل';
    case 'sensor':
      if (s.temperature != null) return `${faNumber(s.temperature, 1)}°، ${fa(Math.round(s.humidity ?? 0))}٪ رطوبت`;
      if (s.contact != null) return s.contact ? 'بسته' : 'باز';
      if (s.occupancy != null) return s.occupancy ? 'حرکت شناسایی شد' : 'بدون حرکت';
      return 'فعال';
    default:
      return s.on ? 'روشن' : s.on === false ? 'خاموش' : 'فعال';
  }
}
