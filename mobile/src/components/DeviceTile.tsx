import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import type { Device } from '@/api/types';
import { isActive, kindMeta, statusLine } from '@/lib/devices';
import { accents, colors, radius, space } from '@/theme/tokens';

import { Tap } from './ui/Pressable';
import { Switch } from './ui/Switch';
import { Text } from './ui/Text';

interface Props {
  device: Device;
  roomName?: string;
  onPress: () => void;
  onToggle: (on: boolean) => void;
}

/**
 * Bento tile. Idle tiles are quiet; an active tile fills with its accent
 * gradient so the home reads at a glance ("what's on?").
 */
export function DeviceTile({ device, roomName, onPress, onToggle }: Props) {
  const meta = kindMeta[device.kind];
  const a = accents[meta.accent];
  const active = isActive(device) && device.online;
  const Icon = meta.icon;

  return (
    <Animated.View entering={FadeIn.duration(300)} style={styles.wrap}>
      <Tap onPress={onPress} accessibilityRole="button" accessibilityLabel={`${device.name}، ${statusLine(device)}`} style={styles.tile}>
        {active && (
          <LinearGradient
            colors={[a.glow, 'rgba(255,255,255,0.02)']}
            start={{ x: 1, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        )}
        <View style={styles.top}>
          <View style={[styles.iconWrap, active && { backgroundColor: a.base }]}>
            <Icon size={20} color={active ? colors.bg : colors.textDim} strokeWidth={2} />
          </View>
          {meta.toggleable ? (
            <Switch value={device.state.on === true} onChange={onToggle} color={a.base} disabled={!device.online} label={device.name} />
          ) : (
            !device.online && <View style={styles.offlineDot} />
          )}
        </View>
        <View style={{ gap: 2 }}>
          <Text variant="title" numberOfLines={1}>{device.name}</Text>
          <Text variant="caption" color={active ? a.base : colors.textDim} numberOfLines={1}>
            {statusLine(device)}
          </Text>
          {roomName && <Text variant="label" color={colors.textMute} numberOfLines={1}>{roomName}</Text>}
        </View>
      </Tap>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  tile: {
    minHeight: 150,
    padding: space.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceHigh,
  },
  offlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.danger, marginTop: 6 },
});
