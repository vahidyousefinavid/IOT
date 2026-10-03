import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowRight, Battery, Settings2, Droplets, Lock, LockOpen, Power, Thermometer, Zap } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { canAdmin } from '@/api/admin';
import { useCommand, useDevice, useHistory, useRooms, useSites } from '@/api/queries';
import type { Command, Device, HistoryRange } from '@/api/types';
import { BarChart } from '@/components/BarChart';
import { Chips } from '@/components/Chips';
import { Dial } from '@/components/Dial';
import { Screen } from '@/components/Screen';
import { Card } from '@/components/ui/Card';
import { IconButton } from '@/components/ui/IconButton';
import { Tap } from '@/components/ui/Pressable';
import { Text } from '@/components/ui/Text';
import { TrackerView } from '@/components/TrackerView';
import { kindMeta, protocolMeta, statusLine } from '@/lib/devices';
import { fa, faNumber, relativeTime } from '@/lib/format';
import { accents, colors, radius, space } from '@/theme/tokens';

export default function DeviceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { site } = useSites();
  const siteId = site?.id ?? null;
  const { device } = useDevice(siteId, id);
  const rooms = useRooms(siteId);
  const command = useCommand(siteId);

  if (!device) return <Screen><View /></Screen>;

  const meta = kindMeta[device.kind];
  const a = accents[meta.accent];
  const room = rooms.data?.find((r) => r.id === device.room_id);
  const send = (cmd: Command) => command.mutate({ id: device.id, cmd });
  const on = device.state.on === true;

  return (
    <Screen>
      <LinearGradient
        colors={[on ? a.glow : 'rgba(255,255,255,0.03)', 'transparent']}
        style={[StyleSheet.absoluteFill, { height: 420 }]}
      />

      <View style={styles.header}>
        <IconButton icon={ArrowRight} label="بازگشت" onPress={() => router.back()} />
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text variant="title" numberOfLines={1}>{device.name}</Text>
          <View style={styles.statusRow}>
            <View style={[styles.dot, { backgroundColor: device.online ? colors.success : colors.danger }]} />
            <Text variant="label" color={colors.textDim}>
              {device.online ? room?.name ?? meta.label : `آفلاین، ${relativeTime(device.last_seen)}`}
            </Text>
          </View>
        </View>
        {canAdmin(site?.role) ? (
          <IconButton icon={Settings2} label="تنظیمات دستگاه" onPress={() => router.push({ pathname: '/device/settings/[id]', params: { id: device.id } })} />
        ) : (
          <View style={{ width: 44 }} />
        )}
      </View>

      {device.kind === 'tracker' && site ? (
        <Animated.View entering={FadeIn.duration(400)} style={[styles.body, { marginTop: space.lg }]}>
          <TrackerView device={device} siteId={site.id} role={site.role} />
        </Animated.View>
      ) : (
        <Animated.View entering={FadeIn.duration(400)} style={styles.hero}>
          <Controls device={device} send={send} />
        </Animated.View>
      )}

      <Animated.View entering={FadeInDown.delay(120).duration(400)} style={[styles.body, device.kind === 'tracker' && { marginTop: space.lg }]}>
        {device.kind !== 'tracker' && <Readings device={device} />}
        {device.kind !== 'tracker' && <History device={device} siteId={siteId} />}
        <Card>
          <Row label="نوع" value={meta.label} />
          <Row label="پروتکل" value={protocolMeta[device.protocol]?.label ?? device.protocol} />
          <Row label="آخرین ارتباط" value={relativeTime(device.last_seen)} />
          <Row label="وضعیت" value={statusLine(device)} last />
        </Card>
      </Animated.View>
    </Screen>
  );
}

type Send = (cmd: Command) => void;

function Controls({ device, send }: { device: Device; send: Send }) {
  const s = device.state;
  const a = accents[kindMeta[device.kind].accent];
  const disabled = !device.online;

  switch (device.kind) {
    case 'light':
      return (
        <>
          <Dial value={s.brightness ?? 0} min={0} max={100} unit="٪" caption="روشنایی" colors={[a.base, a.deep]}
            disabled={disabled || !s.on} onCommit={(v) => send({ brightness: v })} />
          <PowerButton on={!!s.on} color={a.base} disabled={disabled} onPress={() => send({ on: !s.on })} />
        </>
      );
    case 'thermostat':
    case 'ac':
      return (
        <>
          <Dial value={s.target_temperature ?? 22} min={16} max={30} step={0.5} unit="°" caption="دمای هدف"
            colors={[colors.sky, colors.skyDeep]} disabled={disabled || !s.on} onCommit={(v) => send({ target_temperature: v })} />
          <PowerButton on={!!s.on} color={colors.sky} disabled={disabled} onPress={() => send({ on: !s.on })} />
        </>
      );
    case 'curtain':
      return (
        <>
          <Dial value={s.position ?? 0} min={0} max={100} step={5} unit="٪" caption="میزان باز بودن"
            colors={[colors.violet, colors.violetDeep]} disabled={disabled} onCommit={(v) => send({ position: v })} />
          <View style={styles.presets}>
            {[0, 50, 100].map((p) => (
              <Tap key={p} onPress={() => send({ position: p })} style={styles.preset} disabled={disabled}>
                <Text variant="title">{p === 0 ? 'بسته' : p === 100 ? 'کاملاً باز' : `${fa(p)}٪`}</Text>
              </Tap>
            ))}
          </View>
        </>
      );
    case 'lock': {
      const locked = s.locked !== false;
      const Icon = locked ? Lock : LockOpen;
      const color = locked ? colors.violet : colors.danger;
      return (
        <Tap onPress={() => send({ locked: !locked })} disabled={disabled} style={styles.bigToggle} accessibilityLabel={locked ? 'باز کردن قفل' : 'قفل کردن'}>
          <View style={[styles.bigRing, { borderColor: color, shadowColor: color }]}>
            <Icon size={64} color={color} strokeWidth={1.6} />
          </View>
          <Text variant="h2">{locked ? 'قفل است' : 'باز است'}</Text>
          <Text variant="caption" color={colors.textDim}>برای {locked ? 'باز کردن' : 'قفل کردن'} لمس کنید</Text>
        </Tap>
      );
    }
    case 'sensor':
    case 'meter':
    case 'camera':
    case 'bridge': {
      const Icon = kindMeta[device.kind].icon;
      return (
        <View style={styles.bigToggle}>
          <View style={[styles.bigRing, { borderColor: a.base, shadowColor: a.base }]}>
            <Icon size={60} color={a.base} strokeWidth={1.5} />
          </View>
          <Text variant="h2">{statusLine(device)}</Text>
        </View>
      );
    }
    default: {
      const on = !!s.on;
      return (
        <View style={styles.bigToggle}>
          <Tap onPress={() => send({ on: !on })} disabled={disabled} accessibilityRole="switch" accessibilityState={{ checked: on }}>
            <View style={[styles.bigRing, { borderColor: on ? a.base : colors.borderStrong, shadowColor: a.base, shadowOpacity: on ? 0.6 : 0 }]}>
              <Power size={60} color={on ? a.base : colors.textMute} strokeWidth={1.8} />
            </View>
          </Tap>
          <Text variant="h2">{statusLine(device)}</Text>
        </View>
      );
    }
  }
}

function PowerButton({ on, color, disabled, onPress }: { on: boolean; color: string; disabled: boolean; onPress: () => void }) {
  return (
    <Tap onPress={onPress} disabled={disabled} style={[styles.power, on && { backgroundColor: color, borderColor: color }]}
      accessibilityRole="switch" accessibilityState={{ checked: on }} accessibilityLabel="روشن و خاموش">
      <Power size={20} color={on ? colors.bg : colors.text} strokeWidth={2.2} />
      <Text variant="title" color={on ? colors.bg : colors.text}>{on ? 'روشن' : 'خاموش'}</Text>
    </Tap>
  );
}

function Readings({ device }: { device: Device }) {
  const s = device.state;
  const items = [
    s.temperature != null && { icon: Thermometer, color: colors.amber, label: 'دما', value: `${faNumber(s.temperature, 1)}°` },
    s.humidity != null && { icon: Droplets, color: colors.sky, label: 'رطوبت', value: `${fa(Math.round(s.humidity))}٪` },
    s.power != null && { icon: Zap, color: colors.mint, label: 'توان', value: `${faNumber(s.power)} وات` },
    s.energy != null && { icon: Zap, color: colors.violet, label: 'مصرف کل', value: `${faNumber(s.energy, 1)} kWh` },
    s.battery != null && { icon: Battery, color: s.battery < 20 ? colors.danger : colors.success, label: 'باتری', value: `${fa(Math.round(s.battery))}٪` },
  ].filter(Boolean) as { icon: typeof Zap; color: string; label: string; value: string }[];

  if (!items.length) return null;
  return (
    <View style={styles.readings}>
      {items.map((it) => (
        <Card key={it.label} style={styles.reading}>
          <it.icon size={18} color={it.color} />
          <Text variant="label" color={colors.textDim} style={{ marginTop: space.sm }}>{it.label}</Text>
          <Text variant="h2">{it.value}</Text>
        </Card>
      ))}
    </View>
  );
}

function History({ device, siteId }: { device: Device; siteId: string | null }) {
  const key = device.state.power != null ? 'power' : device.state.temperature != null ? 'temperature' : null;
  const [range, setRange] = useState<HistoryRange>('24h');
  const history = useHistory(key ? siteId : null, device.id, key ?? '', range);
  if (!key) return null;

  const isPower = key === 'power';
  return (
    <Card style={{ gap: space.lg }} padded={false}>
      <View style={{ padding: space.lg, paddingBottom: 0 }}>
        <Text variant="title">{isPower ? 'مصرف برق' : 'تغییرات دما'}</Text>
      </View>
      <View style={{ marginHorizontal: -space.xl }}>
        <Chips
          chips={[{ id: '24h', label: '۲۴ ساعت' }, { id: '7d', label: '۷ روز' }, { id: '30d', label: '۳۰ روز' }]}
          selected={range}
          onSelect={(r) => setRange(r as HistoryRange)}
        />
      </View>
      <View style={{ padding: space.lg, paddingTop: 0 }}>
        <BarChart
          points={history.data ?? []}
          color={isPower ? [colors.mint, colors.mintDeep] : [colors.amber, colors.amberDeep]}
          unit={isPower ? 'وات' : '°'}
          decimals={isPower ? 0 : 1}
        />
      </View>
    </Card>
  );
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.row, !last && styles.rowBorder]}>
      <Text variant="body" color={colors.textDim}>{label}</Text>
      <Text variant="body">{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.xl, gap: space.md },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  hero: { alignItems: 'center', gap: space.xl, paddingVertical: space.xxl },
  body: { paddingHorizontal: space.xl, gap: space.lg },
  power: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    height: 52,
    paddingHorizontal: space.xxl,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceHigh,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  presets: { flexDirection: 'row', gap: space.sm },
  preset: {
    paddingHorizontal: space.lg,
    height: 44,
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceHigh,
  },
  bigToggle: { alignItems: 'center', gap: space.md, paddingVertical: space.xl },
  bigRing: {
    width: 190,
    height: 190,
    borderRadius: 95,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    shadowOpacity: 0.5,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 0 },
  },
  readings: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  reading: { flexGrow: 1, flexBasis: '30%', padding: space.lg },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: space.md },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
});
