import type { LucideIcon } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { colors } from '@/theme/tokens';

import { Tap } from './Pressable';

interface Props {
  icon: LucideIcon;
  onPress: () => void;
  label: string;
  badge?: boolean;
  size?: number;
}

export function IconButton({ icon: Icon, onPress, label, badge, size = 44 }: Props) {
  return (
    <Tap
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={[styles.btn, { width: size, height: size, borderRadius: size / 2 }]}
    >
      <Icon size={20} color={colors.text} strokeWidth={1.8} />
      {badge && <View style={styles.badge} />}
    </Tap>
  );
}

const styles = StyleSheet.create({
  btn: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  badge: {
    position: 'absolute',
    top: 11,
    end: 12,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.rose,
    borderWidth: 1.5,
    borderColor: colors.surface,
  },
});
