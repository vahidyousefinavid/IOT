import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import type { Point } from '@/api/types';
import { faNumber } from '@/lib/format';
import { colors, space } from '@/theme/tokens';

import { Text } from './ui/Text';

interface Props {
  points: Point[];
  color: [string, string];
  height?: number;
  unit: string;
  decimals?: number;
}

/** Rounded bar chart; the newest bar is highlighted and labelled. */
export function BarChart({ points, color, height = 140, unit, decimals = 0 }: Props) {
  const [width, setWidth] = useState(0);
  if (points.length === 0) {
    return (
      <View style={[styles.empty, { height }]}>
        <Text variant="caption" color={colors.textMute}>هنوز داده‌ای ثبت نشده</Text>
      </View>
    );
  }

  const max = Math.max(...points.map((p) => p.v), 1);
  const gap = 4;
  const barW = width > 0 ? (width - gap * (points.length - 1)) / points.length : 0;
  const last = points[points.length - 1];
  const avg = points.reduce((s, p) => s + p.v, 0) / points.length;

  return (
    <View style={{ gap: space.md }}>
      <View style={styles.legend}>
        <Text variant="caption" color={colors.textDim}>میانگین {faNumber(avg, decimals)} {unit}</Text>
        <Text variant="title" color={color[0]}>{faNumber(last.v, decimals)} {unit}</Text>
      </View>
      <View style={{ height, transform: [{ scaleX: -1 }] }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {width > 0 && (
          <Svg width={width} height={height}>
            <Defs>
              <LinearGradient id="bar" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={color[0]} />
                <Stop offset="1" stopColor={color[1]} stopOpacity={0.6} />
              </LinearGradient>
            </Defs>
            {points.map((p, i) => {
              const h = Math.max(4, (p.v / max) * (height - 4));
              const isLast = i === points.length - 1;
              return (
                <Rect
                  key={p.t}
                  x={i * (barW + gap)}
                  y={height - h}
                  width={barW}
                  height={h}
                  rx={Math.min(6, barW / 2)}
                  fill={isLast ? 'url(#bar)' : 'rgba(255,255,255,0.09)'}
                />
              );
            })}
          </Svg>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  legend: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  empty: { alignItems: 'center', justifyContent: 'center' },
});
