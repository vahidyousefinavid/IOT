import { AlertTriangle, Battery, Gauge, KeyRound, Navigation, Power, Satellite, Signal } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Linking, Platform, StyleSheet, View } from 'react-native';

import { errorMessage } from '@/api/errors';
import { useCommand, useTrack } from '@/api/queries';
import type { Device, HistoryRange, Role } from '@/api/types';
import { confirm } from '@/lib/confirm';
import { fa, faNumber, relativeTime } from '@/lib/format';
import { colors, radius, space } from '@/theme/tokens';

import { Chips } from './Chips';
import { TrackMap } from './map/TrackMap';
import type { MapData } from './map/mapHtml';
import { Card } from './ui/Card';
import { Tap } from './ui/Pressable';
import { Text } from './ui/Text';

const alarmLabels: Record<string, string> = {
  sos: 'دکمه اضطراری (SOS) زده شد',
  power_cut: 'برق اصلی ردیاب قطع شد',
  vibration: 'لرزش خودرو (احتمال سرقت)',
  geofence_enter: 'ورود به محدوده',
  geofence_exit: 'خروج از محدوده',
  overspeed: 'سرعت غیرمجاز',
};

/** Great-circle distance along a route, in km. */
function distanceKm(points: { lat: number; lon: number }[]): number {
  let d = 0;
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]];
    const rad = Math.PI / 180;
    const h =
      Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
      Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2;
    d += 12742 * Math.asin(Math.sqrt(h));
  }
  return d;
}

export function TrackerView({ device, siteId, role }: { device: Device; siteId: string; role: Role }) {
  const s = device.state;
  const [range, setRange] = useState<HistoryRange>('24h');
  const track = useTrack(siteId, device.id, range);
  const command = useCommand(siteId);
  const moving = (s.speed ?? 0) > 3;
  const hasPos = typeof s.lat === 'number' && typeof s.lon === 'number';

  const mapData = useMemo<MapData>(
    () => ({
      pos: hasPos ? [s.lat as number, s.lon as number] : null,
      course: s.course ?? 0,
      moving,
      track: (track.data ?? []).map((p) => [p.lat, p.lon]),
    }),
    [hasPos, s.lat, s.lon, s.course, moving, track.data],
  );
  const km = useMemo(() => distanceKm(track.data ?? []), [track.data]);

  const recentAlarm = s.alarm && s.alarm_at && Date.now() - new Date(s.alarm_at).getTime() < 24 * 3600e3;
  const canControl = role !== 'guest';
  const engineSupported = device.protocol === 'gt06';

  const toggleEngine = async () => {
    const cut = !s.power_cut;
    const ok = cut
      ? await confirm('قطع موتور', 'برق/سوخت خودرو از راه دور قطع می‌شود. فقط وقتی خودرو متوقف است انجام می‌شود.', 'قطع موتور')
      : await confirm('وصل موتور', 'خودرو دوباره قابل روشن شدن می‌شود.', 'وصل');
    if (ok) command.mutate({ id: device.id, cmd: { immobilized: cut } });
  };

  const openInMaps = () => {
    if (!hasPos) return;
    const { lat, lon } = s as { lat: number; lon: number };
    const url = Platform.select({
      ios: `https://maps.apple.com/?q=${lat},${lon}`,
      android: `geo:${lat},${lon}?q=${lat},${lon}`,
      default: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`,
    });
    Linking.openURL(url).catch(() => {});
  };

  return (
    <View style={{ gap: space.lg }}>
      <View style={styles.mapWrap}>
        {hasPos ? (
          <TrackMap data={mapData} style={StyleSheet.absoluteFill} />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.noFix]}>
            <Satellite size={32} color={colors.textMute} />
            <Text variant="caption" color={colors.textDim} align="center">
              {device.online ? 'در انتظار دریافت موقعیت GPS…' : 'ردیاب هنوز به سرور وصل نشده است'}
            </Text>
          </View>
        )}
        <View style={styles.statusPill}>
          <View style={[styles.dot, { backgroundColor: !device.online ? colors.danger : moving ? colors.amber : colors.success }]} />
          <Text variant="title" style={{ fontSize: 13 }}>
            {!device.online ? 'آفلاین' : moving ? `${fa(Math.round(s.speed ?? 0))} کیلومتر بر ساعت` : 'متوقف'}
          </Text>
        </View>
        {hasPos && (
          <Tap onPress={openInMaps} style={styles.navBtn} accessibilityLabel="مسیریابی در نقشه">
            <Navigation size={18} color={colors.bg} />
          </Tap>
        )}
      </View>

      {recentAlarm && (
        <Card style={styles.alarm}>
          <AlertTriangle size={20} color={colors.danger} />
          <View style={{ flex: 1 }}>
            <Text variant="title" color={colors.danger}>{alarmLabels[s.alarm!] ?? 'هشدار ردیاب'}</Text>
            <Text variant="caption" color={colors.textDim}>{relativeTime(s.alarm_at!)}</Text>
          </View>
        </Card>
      )}

      <View style={styles.grid}>
        <Stat icon={Gauge} color={colors.amber} label="سرعت" value={`${fa(Math.round(s.speed ?? 0))} km/h`} />
        <Stat icon={KeyRound} color={s.ignition ? colors.success : colors.textDim} label="سوئیچ" value={s.ignition == null ? '—' : s.ignition ? 'روشن' : 'خاموش'} />
        <Stat icon={Battery} color={(s.battery ?? 100) < 30 ? colors.danger : colors.success} label="باتری ردیاب" value={s.battery == null ? '—' : `${fa(Math.round(s.battery))}٪`} />
        <Stat icon={Signal} color={colors.sky} label="آنتن" value={s.gsm == null ? '—' : `${fa(s.gsm)} از ۴`} />
        <Stat icon={Satellite} color={colors.violet} label="ماهواره" value={s.satellites == null ? '—' : fa(s.satellites)} />
        <Stat icon={Navigation} color={colors.mint} label="آخرین موقعیت" value={s.fix_time ? relativeTime(s.fix_time) : '—'} />
      </View>

      <Card padded={false} style={{ paddingVertical: space.lg, gap: space.md }}>
        <View style={styles.routeHead}>
          <Text variant="title">مسیر طی‌شده</Text>
          <Text variant="title" color={colors.sky}>{faNumber(km, 1)} کیلومتر</Text>
        </View>
        <Chips
          chips={[{ id: '24h', label: '۲۴ ساعت' }, { id: '7d', label: '۷ روز' }, { id: '30d', label: '۳۰ روز' }]}
          selected={range}
          onSelect={(r) => setRange(r as HistoryRange)}
        />
      </Card>

      {canControl && (
        <Card style={{ gap: space.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <View style={[styles.engineIcon, s.power_cut && { backgroundColor: 'rgba(255,92,108,0.15)' }]}>
              <Power size={22} color={s.power_cut ? colors.danger : colors.success} />
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="title">{s.power_cut ? 'موتور قطع است' : 'موتور وصل است'}</Text>
              <Text variant="caption" color={colors.textDim}>
                {engineSupported ? 'قطع از راه دور فقط وقتی خودرو متوقف باشد انجام می‌شود' : 'این مدل ردیاب قطع از راه دور را پشتیبانی نمی‌کند'}
              </Text>
            </View>
          </View>
          {engineSupported && (
            <Tap
              onPress={toggleEngine}
              disabled={!device.online || command.isPending}
              style={[styles.engineBtn, { backgroundColor: s.power_cut ? colors.success : colors.danger }, !device.online && { opacity: 0.4 }]}
              accessibilityRole="button"
            >
              <Text variant="title" color={colors.bg}>{s.power_cut ? 'وصل موتور' : 'قطع موتور'}</Text>
            </Tap>
          )}
          {command.error && <Text variant="caption" color={colors.danger}>{errorMessage(command.error)}</Text>}
        </Card>
      )}
    </View>
  );
}

function Stat({ icon: Icon, color, label, value }: { icon: typeof Gauge; color: string; label: string; value: string }) {
  return (
    <Card style={styles.stat}>
      <Icon size={17} color={color} />
      <Text variant="label" color={colors.textDim} style={{ marginTop: space.sm }}>{label}</Text>
      <Text variant="title" numberOfLines={1}>{value}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  mapWrap: {
    height: 340,
    borderRadius: radius.xl,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
  },
  noFix: { alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.xl },
  statusPill: {
    position: 'absolute',
    top: space.md,
    start: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(10,12,16,0.85)',
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  navBtn: {
    position: 'absolute',
    bottom: space.md,
    end: space.md,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.amber,
  },
  alarm: { flexDirection: 'row', alignItems: 'center', gap: space.md, borderColor: 'rgba(255,92,108,0.4)' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  stat: { flexBasis: '31%', flexGrow: 1, padding: space.md },
  routeHead: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: space.lg },
  engineIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(61,220,151,0.12)',
  },
  engineBtn: { height: 50, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
