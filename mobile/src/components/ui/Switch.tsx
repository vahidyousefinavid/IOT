import { Pressable, StyleSheet } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, useDerivedValue, withSpring, withTiming } from 'react-native-reanimated';

import { colors } from '@/theme/tokens';

interface Props {
  value: boolean;
  onChange: (v: boolean) => void;
  color?: string;
  disabled?: boolean;
  label: string;
}

const W = 46;
const H = 28;
const KNOB = 22;

export function Switch({ value, onChange, color = colors.amber, disabled, label }: Props) {
  const p = useDerivedValue(() => withTiming(value ? 1 : 0, { duration: 180 }), [value]);
  const track = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(p.value, [0, 1], ['rgba(255,255,255,0.10)', color]),
  }));
  // In RTL the "on" side is the left, so the knob travels negative.
  const knob = useAnimatedStyle(() => ({
    transform: [{ translateX: withSpring(value ? -(W - KNOB - 6) : 0, { damping: 16, stiffness: 240 }) }],
  }));

  return (
    <Pressable
      onPress={() => onChange(!value)}
      disabled={disabled}
      hitSlop={10}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled }}
    >
      <Animated.View style={[styles.track, track, disabled && { opacity: 0.4 }]}>
        <Animated.View style={[styles.knob, knob]} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: { width: W, height: H, borderRadius: H / 2, padding: 3, alignItems: 'flex-start' },
  knob: {
    width: KNOB,
    height: KNOB,
    borderRadius: KNOB / 2,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
});
