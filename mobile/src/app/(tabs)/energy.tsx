import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Leaf, Zap } from 'lucide-react-native';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { useDevices, useSites } from '@/api/queries';
import { Screen } from '@/components/Screen';
import { Card } from '@/components/ui/Card';
import { Tap } from '@/components/ui/Pressable';
import { Text } from '@/components/ui/Text';
import { kindMeta } from '@/lib/devices';
import { fa, faNumber } from '@/lib/format';
import { colors, radius, space } from '@/theme/tokens';

export default function Energy() {
  const { site } = useSites();
  const devices = useDevices(site?.id ?? null);

  const consumers = useMemo(
    () =>
      (devices.data ?? [])
        .filter((d) => typeof d.state.power === 'number')
        .map((d) => ({ device: d, power: d.state.on ? (d.state.power as number) : 0 }))
        .sort((a, b) => b.power - a.power),
    [devices.data],
  );
  const total = consumers.reduce((s, c) => s + c.power, 0);
  const max = Math.max(1, ...consumers.map((c) => c.power));
  const totalEnergy = (devices.data ?? []).reduce((s, d) => s + (typeof d.state.energy === 'number' ? d.state.energy : 0), 0);

  return (
    <Screen tabBar refreshing={devices.isRefetching} onRefresh={() => devices.refetch()}>
      <View style={{ paddingHorizontal: space.xl, gap: space.xs }}>
        <Text variant="h1">انرژی</Text>
        <Text variant="body" color={colors.textDim}>مصرف لحظه‌ای و دستگاه‌های پرمصرف</Text>
      </View>

      <Animated.View entering={FadeInDown.duration(400)} style={{ padding: space.xl, gap: space.md }}>
        <View style={styles.hero}>
          <LinearGradient colors={['rgba(79,227,193,0.22)', 'rgba(20,24,33,0)']} start={{ x: 1, y: 0 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFill} />
          <View style={styles.heroIcon}>
            <Zap size={22} color={colors.bg} />
          </View>
          <Text variant="caption" color={colors.textDim}>مصرف همین الان</Text>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.sm }}>
            <Text variant="display">{faNumber(total)}</Text>
            <Text variant="h2" color={colors.textDim}>وات</Text>
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: space.md }}>
          <Card style={{ flex: 1, gap: space.xs }}>
            <Text variant="label" color={colors.textDim}>مصرف کل ثبت‌شده</Text>
            <Text variant="h2">{faNumber(totalEnergy, 1)} <Text variant="caption" color={colors.textDim}>kWh</Text></Text>
          </Card>
          <Card style={{ flex: 1, gap: space.xs }}>
            <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
              <Leaf size={14} color={colors.success} />
              <Text variant="label" color={colors.textDim}>برآورد روزانه</Text>
            </View>
            <Text variant="h2">{faNumber((total * 24) / 1000, 1)} <Text variant="caption" color={colors.textDim}>kWh</Text></Text>
          </Card>
        </View>

        <Text variant="h2" style={{ marginTop: space.lg }}>پرمصرف‌ترین‌ها</Text>
        <Card padded={false}>
          {consumers.length === 0 && (
            <Text variant="caption" color={colors.textMute} style={{ padding: space.lg }}>دستگاهی با اندازه‌گیری توان ندارید.</Text>
          )}
          {consumers.map(({ device, power }, i) => {
            const m = kindMeta[device.kind];
            return (
              <Tap
                key={device.id}
                scaleTo={0.98}
                onPress={() => router.push({ pathname: '/device/[id]', params: { id: device.id } })}
                style={[styles.row, i < consumers.length - 1 && styles.rowBorder]}
              >
                <View style={styles.rowIcon}>
                  <m.icon size={18} color={power > 0 ? colors.mint : colors.textMute} />
                </View>
                <View style={{ flex: 1, gap: 6 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text variant="title">{device.name}</Text>
                    <Text variant="title" color={power > 0 ? colors.text : colors.textMute}>{faNumber(power)} وات</Text>
                  </View>
                  <View style={styles.track}>
                    <View style={[styles.fill, { width: `${(power / max) * 100}%` }]} />
                  </View>
                </View>
              </Tap>
            );
          })}
        </Card>
        <Text variant="caption" color={colors.textMute} align="center">
          {fa(consumers.filter((c) => c.power > 0).length)} دستگاه در حال مصرف
        </Text>
      </Animated.View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    padding: space.xl,
    gap: space.xs,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    overflow: 'hidden',
  },
  heroIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.mint,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.md,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceHigh,
  },
  track: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.06)', overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3, backgroundColor: colors.mint },
});
