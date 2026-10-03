import { StyleSheet, View } from 'react-native';

import type { DeviceKind } from '@/api/types';
import { addableKinds, kindMeta } from '@/lib/devices';
import { accents, colors, radius, space } from '@/theme/tokens';

import { Tap } from './ui/Pressable';
import { Text } from './ui/Text';

export function KindPicker({ value, onChange }: { value: DeviceKind; onChange: (k: DeviceKind) => void }) {
  return (
    <View style={styles.grid}>
      {addableKinds.map((k) => {
        const m = kindMeta[k];
        const on = k === value;
        const a = accents[m.accent];
        return (
          <Tap
            key={k}
            onPress={() => onChange(k)}
            style={[styles.kind, on && { borderColor: a.base, backgroundColor: a.glow }]}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={m.label}
          >
            <m.icon size={22} color={on ? a.base : colors.textDim} />
            <Text variant="label" color={on ? colors.text : colors.textDim} numberOfLines={1}>{m.label}</Text>
          </Tap>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  kind: {
    width: '23%',
    flexGrow: 1,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
