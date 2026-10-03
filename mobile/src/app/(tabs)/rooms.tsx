import { router } from 'expo-router';
import { Bed, ChefHat, DoorOpen, Factory, Monitor, Sofa, Car, type LucideIcon } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { useDevices, useRooms, useSites } from '@/api/queries';
import type { Device, Room } from '@/api/types';
import { Screen } from '@/components/Screen';
import { Card } from '@/components/ui/Card';
import { Tap } from '@/components/ui/Pressable';
import { Text } from '@/components/ui/Text';
import { isActive, kindMeta } from '@/lib/devices';
import { fa, faNumber } from '@/lib/format';
import { accents, colors, radius, space } from '@/theme/tokens';

const roomIcons: Record<string, LucideIcon> = {
  sofa: Sofa, 'chef-hat': ChefHat, bed: Bed, monitor: Monitor, 'door-open': DoorOpen, car: Car, factory: Factory,
};

export default function Rooms() {
  const { site } = useSites();
  const rooms = useRooms(site?.id ?? null);
  const devices = useDevices(site?.id ?? null);
  const list = devices.data ?? [];

  return (
    <Screen tabBar refreshing={devices.isRefetching} onRefresh={() => devices.refetch()}>
      <View style={{ paddingHorizontal: space.xl, gap: space.xs }}>
        <Text variant="h1">اتاق‌ها</Text>
        <Text variant="body" color={colors.textDim}>{fa(rooms.data?.length ?? 0)} فضا در {site?.name ?? ''}</Text>
      </View>
      <View style={styles.list}>
        {rooms.data?.map((room, i) => (
          <Animated.View key={room.id} entering={FadeInDown.delay(i * 60).duration(400)}>
            <RoomCard room={room} devices={list.filter((d) => d.room_id === room.id)} />
          </Animated.View>
        ))}
      </View>
    </Screen>
  );
}

function RoomCard({ room, devices }: { room: Room; devices: Device[] }) {
  const Icon = roomIcons[room.icon] ?? Sofa;
  const active = devices.filter((d) => d.online && isActive(d));
  const temp = devices.find((d) => typeof d.state.temperature === 'number')?.state.temperature as number | undefined;

  return (
    <Card style={{ gap: space.lg }}>
      <View style={styles.head}>
        <View style={styles.roomIcon}>
          <Icon size={22} color={colors.amber} />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="h2">{room.name}</Text>
          <Text variant="caption" color={colors.textDim}>
            {fa(devices.length)} دستگاه، {fa(active.length)} روشن
          </Text>
        </View>
        {temp != null && <Text variant="h2" color={colors.textDim}>{faNumber(temp, 1)}°</Text>}
      </View>
      {devices.length > 0 && (
        <View style={styles.devices}>
          {devices.map((d) => {
            const m = kindMeta[d.kind];
            const on = d.online && isActive(d);
            const a = accents[m.accent];
            return (
              <Tap
                key={d.id}
                onPress={() => router.push({ pathname: '/device/[id]', params: { id: d.id } })}
                style={[styles.device, on && { backgroundColor: a.glow, borderColor: 'transparent' }]}
                accessibilityLabel={d.name}
              >
                <m.icon size={16} color={on ? a.base : colors.textMute} />
                <Text variant="label" color={on ? colors.text : colors.textDim} numberOfLines={1}>{d.name}</Text>
              </Tap>
            );
          })}
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  list: { padding: space.xl, gap: space.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  roomIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,181,71,0.12)',
  },
  devices: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  device: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 34,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surfaceHigh,
  },
});
