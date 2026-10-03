import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { ChevronDown, Droplets, Plus, Settings2, Zap } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { canAdmin } from '@/api/admin';
import { errorMessage } from '@/api/errors';
import { useCommand, useDevices, useRooms, useSites } from '@/api/queries';
import { useSession } from '@/api/session';
import type { Device } from '@/api/types';
import { Chips } from '@/components/Chips';
import { DeviceTile } from '@/components/DeviceTile';
import { Screen } from '@/components/Screen';
import { IconButton } from '@/components/ui/IconButton';
import { Tap } from '@/components/ui/Pressable';
import { Text } from '@/components/ui/Text';
import { isActive } from '@/lib/devices';
import { fa, faNumber, greeting } from '@/lib/format';
import { scenes, type Scene } from '@/lib/scenes';
import { accents, colors, radius, space } from '@/theme/tokens';

export default function Home() {
  const user = useSession((s) => s.user);
  const setSite = useSession((s) => s.setSite);
  const { site, data: sites } = useSites();
  const admin = canAdmin(site?.role);
  const rooms = useRooms(site?.id ?? null);
  const devices = useDevices(site?.id ?? null);
  const command = useCommand(site?.id ?? null);
  const [room, setRoom] = useState('all');
  const [runningScene, setRunningScene] = useState<string | null>(null);

  const list = devices.data ?? [];
  const roomName = useMemo(() => new Map(rooms.data?.map((r) => [r.id, r.name])), [rooms.data]);
  const visible = room === 'all' ? list : list.filter((d) => d.room_id === room);
  const summary = useMemo(() => summarize(list), [list]);

  const firstName = user?.full_name.split(' ')[0] ?? '';

  const runScene = async (scene: Scene) => {
    setRunningScene(scene.id);
    const jobs = list
      .filter((d) => d.online)
      .map((d) => [d, scene.plan(d)] as const)
      .filter(([, cmd]) => cmd)
      .map(([d, cmd]) => command.mutateAsync({ id: d.id, cmd: cmd! }).catch(() => {}));
    await Promise.all(jobs);
    setRunningScene(null);
  };

  const cycleSite = () => {
    if (!sites || sites.length < 2 || !site) return;
    const i = sites.findIndex((s) => s.id === site.id);
    setSite(sites[(i + 1) % sites.length].id);
  };

  return (
    <Screen tabBar refreshing={devices.isRefetching} onRefresh={() => devices.refetch()}>
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text variant="caption" color={colors.textDim}>{greeting()}،</Text>
          <Text variant="h1" numberOfLines={1}>{firstName} 👋</Text>
        </View>
        {admin && <IconButton icon={Plus} label="افزودن دستگاه" onPress={() => router.push('/device/add')} />}
        <IconButton icon={Settings2} label="مدیریت محل" onPress={() => router.push('/site/settings')} />
      </View>

      {site && (
        <Tap onPress={cycleSite} style={styles.sitePill} accessibilityLabel={`محل: ${site.name}`}>
          <View style={[styles.liveDot, { backgroundColor: colors.success }]} />
          <Text variant="title" style={{ fontSize: 13 }}>{site.name}</Text>
          {sites && sites.length > 1 && <ChevronDown size={16} color={colors.textDim} />}
        </Tap>
      )}

      {/* Hero summary */}
      <Animated.View entering={FadeInDown.duration(450)} style={styles.section}>
        <View style={styles.hero}>
          <LinearGradient
            colors={['rgba(255,181,71,0.20)', 'rgba(108,184,255,0.10)', 'rgba(20,24,33,0)']}
            start={{ x: 1, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <View style={{ flex: 1.2, justifyContent: 'space-between' }}>
            <Text variant="caption" color={colors.textDim}>دمای داخل</Text>
            {summary.temp != null ? (
              <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                <Text variant="display">{faNumber(summary.temp, 1)}</Text>
                <Text variant="h2" color={colors.textDim} style={{ marginTop: 6 }}>°</Text>
              </View>
            ) : (
              <Text variant="caption" color={colors.textMute}>برای نمایش دما یک سنسور اضافه کنید</Text>
            )}
            <Text variant="caption" color={colors.amber}>
              {fa(summary.active)} دستگاه روشن از {fa(summary.total)}
            </Text>
          </View>
          <View style={styles.heroStats}>
            <Stat icon={Droplets} color={colors.sky} label="رطوبت" value={summary.humidity != null ? `${fa(Math.round(summary.humidity))}٪` : '—'} />
            <Stat icon={Zap} color={colors.mint} label="مصرف لحظه‌ای" value={`${faNumber(summary.power)} وات`} />
          </View>
        </View>
      </Animated.View>

      {/* Scenes */}
      <SectionTitle title="سناریوها" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scenes}>
        {scenes.map((s, i) => {
          const a = accents[s.accent];
          const Icon = s.icon;
          const running = runningScene === s.id;
          return (
            <Animated.View key={s.id} entering={FadeInDown.delay(80 + i * 50).duration(400)}>
              <Tap onPress={() => runScene(s)} disabled={!!runningScene} style={styles.scene} accessibilityLabel={`سناریو ${s.label}`}>
                <View style={[styles.sceneIcon, { backgroundColor: a.glow }]}>
                  {running ? <ActivityIndicator size="small" color={a.base} /> : <Icon size={20} color={a.base} />}
                </View>
                <View>
                  <Text variant="title" style={{ fontSize: 14 }}>{s.label}</Text>
                  <Text variant="label" color={colors.textMute}>{s.hint}</Text>
                </View>
              </Tap>
            </Animated.View>
          );
        })}
      </ScrollView>

      {/* Devices */}
      <SectionTitle title="دستگاه‌ها" trailing={`${fa(visible.length)} مورد`} />
      <Chips
        chips={[{ id: 'all', label: 'همه' }, ...(rooms.data ?? []).map((r) => ({ id: r.id, label: r.name }))]}
        selected={room}
        onSelect={setRoom}
      />

      <View style={styles.grid}>
        {devices.isLoading && <ActivityIndicator color={colors.amber} style={{ marginTop: space.xxl, flex: 1 }} />}
        {devices.error && <Text variant="body" color={colors.danger}>{errorMessage(devices.error)}</Text>}
        {!devices.isLoading && visible.length === 0 && !devices.error && (
          <View style={styles.empty}>
            <Text variant="title">هنوز دستگاهی اینجا نیست</Text>
            <Text variant="caption" color={colors.textDim} align="center">
              {admin ? 'با دکمه + اولین دستگاه را اضافه کنید.' : 'مدیر محل هنوز دستگاهی اضافه نکرده است.'}
            </Text>
          </View>
        )}
        {pairs(visible).map(([a, b]) => (
          <View key={a.id} style={styles.row}>
            <DeviceTile
              device={a}
              roomName={room === 'all' ? roomName.get(a.room_id ?? '') : undefined}
              onPress={() => router.push({ pathname: '/device/[id]', params: { id: a.id } })}
              onToggle={(on) => command.mutate({ id: a.id, cmd: { on } })}
            />
            {b ? (
              <DeviceTile
                device={b}
                roomName={room === 'all' ? roomName.get(b.room_id ?? '') : undefined}
                onPress={() => router.push({ pathname: '/device/[id]', params: { id: b.id } })}
                onToggle={(on) => command.mutate({ id: b.id, cmd: { on } })}
              />
            ) : (
              <View style={{ flex: 1 }} />
            )}
          </View>
        ))}
      </View>
    </Screen>
  );
}

function Stat({ icon: Icon, color, label, value }: { icon: typeof Zap; color: string; label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <View style={[styles.statIcon, { backgroundColor: `${color}22` }]}>
        <Icon size={16} color={color} />
      </View>
      <View>
        <Text variant="label" color={colors.textDim}>{label}</Text>
        <Text variant="title">{value}</Text>
      </View>
    </View>
  );
}

function SectionTitle({ title, trailing }: { title: string; trailing?: string }) {
  return (
    <View style={styles.sectionTitle}>
      <Text variant="h2">{title}</Text>
      {trailing && <Text variant="caption" color={colors.textMute}>{trailing}</Text>}
    </View>
  );
}

function pairs<T>(xs: T[]): [T, T | undefined][] {
  const out: [T, T | undefined][] = [];
  for (let i = 0; i < xs.length; i += 2) out.push([xs[i], xs[i + 1]]);
  return out;
}

function summarize(list: Device[]) {
  const temps = list.filter((d) => d.kind === 'sensor' && typeof d.state.temperature === 'number');
  const hums = list.filter((d) => typeof d.state.humidity === 'number');
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return {
    total: list.length,
    active: list.filter((d) => d.online && isActive(d)).length,
    temp: avg(temps.map((d) => d.state.temperature as number)),
    humidity: avg(hums.map((d) => d.state.humidity as number)),
    power: list.reduce((s, d) => s + (d.state.on && typeof d.state.power === 'number' ? d.state.power : 0), 0),
  };
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.xl },
  sitePill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.md,
    marginHorizontal: space.xl,
    paddingHorizontal: space.md,
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  liveDot: { width: 7, height: 7, borderRadius: 4 },
  section: { paddingHorizontal: space.xl, marginTop: space.xl },
  hero: {
    flexDirection: 'row',
    minHeight: 168,
    padding: space.xl,
    gap: space.lg,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    overflow: 'hidden',
  },
  heroStats: { flex: 1, justifyContent: 'center', gap: space.lg },
  stat: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  statIcon: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingHorizontal: space.xl,
    marginTop: space.xxl,
    marginBottom: space.md,
  },
  scenes: { gap: space.md, paddingHorizontal: space.xl },
  scene: {
    width: 148,
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  sceneIcon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  grid: { gap: space.md, paddingHorizontal: space.xl, marginTop: space.lg },
  row: { flexDirection: 'row', gap: space.md },
  empty: { alignItems: 'center', gap: space.xs, paddingVertical: space.xxxl },
});
