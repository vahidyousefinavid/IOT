import { Clapperboard, DoorOpen, Moon, Sunrise, type LucideIcon } from 'lucide-react-native';

import type { Command, Device } from '@/api/types';
import type { Accent } from '@/theme/tokens';

export interface Scene {
  id: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  accent: Accent;
  /** Returns the command for a device, or null to leave it alone. */
  plan: (d: Device) => Command | null;
}

export const scenes: Scene[] = [
  {
    id: 'morning',
    label: 'صبح بخیر',
    hint: 'نورها و پرده‌ها باز',
    icon: Sunrise,
    accent: 'amber',
    plan: (d) => (d.kind === 'light' ? { on: true, brightness: 100 } : d.kind === 'curtain' ? { position: 100 } : null),
  },
  {
    id: 'away',
    label: 'خروج از خانه',
    hint: 'همه خاموش، در قفل',
    icon: DoorOpen,
    accent: 'violet',
    plan: (d) =>
      d.kind === 'light' || d.kind === 'ac' || d.kind === 'fan' ? { on: false } : d.kind === 'lock' ? { locked: true } : null,
  },
  {
    id: 'movie',
    label: 'فیلم',
    hint: 'نور کم، پرده بسته',
    icon: Clapperboard,
    accent: 'rose',
    plan: (d) => (d.kind === 'light' ? { on: true, brightness: 15 } : d.kind === 'curtain' ? { position: 0 } : null),
  },
  {
    id: 'night',
    label: 'شب',
    hint: 'خاموشی و ۲۱ درجه',
    icon: Moon,
    accent: 'sky',
    plan: (d) =>
      d.kind === 'light' ? { on: false } : d.kind === 'thermostat' ? { on: true, target_temperature: 21 } : d.kind === 'lock' ? { locked: true } : null,
  },
];
