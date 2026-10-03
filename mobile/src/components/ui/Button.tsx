import { LinearGradient } from 'expo-linear-gradient';
import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { accents, colors, radius, type Accent } from '@/theme/tokens';

import { Tap } from './Pressable';
import { Text } from './Text';

interface Props {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'ghost';
  accent?: Accent;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Button({ title, onPress, variant = 'primary', accent = 'amber', loading, disabled, style }: Props) {
  const a = accents[accent];
  const inactive = disabled || loading;
  return (
    <Tap
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={[styles.base, inactive && { opacity: 0.55 }, style]}
    >
      {variant === 'primary' ? (
        <LinearGradient colors={[a.base, a.deep]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.fill}>
          {loading ? <ActivityIndicator color={colors.bg} /> : <Text variant="title" color={colors.bg}>{title}</Text>}
        </LinearGradient>
      ) : (
        <View style={[styles.fill, styles.ghost]}>
          {loading ? <ActivityIndicator color={colors.text} /> : <Text variant="title">{title}</Text>}
        </View>
      )}
    </Tap>
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: radius.md, overflow: 'hidden' },
  fill: { height: 54, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  ghost: { backgroundColor: colors.surfaceHigh, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.borderStrong },
});
