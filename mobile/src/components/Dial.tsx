import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedProps, useSharedValue, withSpring } from 'react-native-reanimated';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';

import { Text } from '@/components/ui/Text';
import { fa } from '@/lib/format';
import { colors } from '@/theme/tokens';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface Props {
  value: number;
  min: number;
  max: number;
  step?: number;
  unit: string;
  caption: string;
  colors: [string, string];
  disabled?: boolean;
  onCommit: (value: number) => void;
  size?: number;
}

const START = 135; // degrees, measured clockwise from 3 o'clock
const SWEEP = 270;

/**
 * A 270° radial control (brightness, target temperature). Drag anywhere on
 * the ring; haptics tick on every step and the value commits on release.
 */
export function Dial({ value, min, max, step = 1, unit, caption, colors: grad, disabled, onCommit, size = 280 }: Props) {
  const stroke = 20;
  const r = size / 2 - stroke - 6;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;
  const arc = (circumference * SWEEP) / 360;

  const toProgress = (v: number) => (Math.min(max, Math.max(min, v)) - min) / (max - min);
  const progress = useSharedValue(toProgress(value));
  const lastStep = useSharedValue(value);
  const [display, setDisplay] = useState(value);

  useEffect(() => {
    progress.value = withSpring(toProgress(value), { damping: 20, stiffness: 140 });
    lastStep.value = value;
    setDisplay(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, min, max]);

  const tick = (v: number) => {
    setDisplay(v);
    Haptics.selectionAsync().catch(() => {});
  };

  const pan = Gesture.Pan()
    .enabled(!disabled)
    .minDistance(0)
    .onUpdate((e) => {
      const deg = (Math.atan2(e.y - c, e.x - c) * 180) / Math.PI;
      let rel = (deg - START + 720) % 360;
      if (rel > SWEEP) rel = rel > SWEEP + (360 - SWEEP) / 2 ? 0 : SWEEP;
      const p = rel / SWEEP;
      progress.value = p;
      const v = Math.round((min + p * (max - min)) / step) * step;
      if (v !== lastStep.value) {
        lastStep.value = v;
        scheduleOnRN(tick, v);
      }
    })
    .onEnd(() => {
      scheduleOnRN(onCommit, lastStep.value);
    });

  const arcProps = useAnimatedProps(() => ({ strokeDashoffset: arc * (1 - progress.value) }));
  const knobProps = useAnimatedProps(() => {
    const a = ((START + progress.value * SWEEP) * Math.PI) / 180;
    return { cx: c + r * Math.cos(a), cy: c + r * Math.sin(a) };
  });

  const decimals = step < 1 ? 1 : 0;

  return (
    <GestureDetector gesture={pan}>
      <View style={{ width: size, height: size, opacity: disabled ? 0.45 : 1 }} accessibilityRole="adjustable" accessibilityLabel={caption} accessibilityValue={{ min, max, now: display }}>
        <Svg width={size} height={size}>
          <Defs>
            <LinearGradient id="dial" x1="0" y1="1" x2="1" y2="0">
              <Stop offset="0" stopColor={grad[1]} />
              <Stop offset="1" stopColor={grad[0]} />
            </LinearGradient>
          </Defs>
          {/* tick marks */}
          {Array.from({ length: 28 }, (_, i) => {
            const a = ((START + (i / 27) * SWEEP) * Math.PI) / 180;
            const ri = r - stroke - 4;
            return <Circle key={i} cx={c + ri * Math.cos(a)} cy={c + ri * Math.sin(a)} r={1.4} fill={colors.textMute} />;
          })}
          <Circle
            cx={c} cy={c} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={stroke}
            strokeDasharray={[arc, circumference]} strokeLinecap="round" transform={`rotate(${START} ${c} ${c})`}
          />
          <AnimatedCircle
            cx={c} cy={c} r={r} fill="none" stroke="url(#dial)" strokeWidth={stroke}
            strokeDasharray={[arc, circumference]} strokeLinecap="round" transform={`rotate(${START} ${c} ${c})`}
            animatedProps={arcProps}
          />
          <AnimatedCircle r={stroke / 2 + 5} fill="#fff" animatedProps={knobProps} />
        </Svg>
        <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none">
          <Text variant="caption" color={colors.textDim}>{caption}</Text>
          <View style={styles.valueRow}>
            <Text variant="display" style={{ fontSize: 58, lineHeight: 72 }}>{fa(display.toFixed(decimals))}</Text>
            <Text variant="h2" color={colors.textDim} style={{ marginTop: 10 }}>{unit}</Text>
          </View>
        </View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  valueRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 2 },
});
