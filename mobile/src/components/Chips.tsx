import { ScrollView, StyleSheet } from 'react-native';

import { colors, radius, space } from '@/theme/tokens';

import { Tap } from './ui/Pressable';
import { Text } from './ui/Text';

interface Chip {
  id: string;
  label: string;
  count?: number;
}

interface Props {
  chips: Chip[];
  selected: string;
  onSelect: (id: string) => void;
}

export function Chips({ chips, selected, onSelect }: Props) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {chips.map((c) => {
        const on = c.id === selected;
        return (
          <Tap
            key={c.id}
            onPress={() => onSelect(c.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={[styles.chip, on && styles.chipOn]}
          >
            <Text variant="title" color={on ? colors.bg : colors.textDim} style={{ fontSize: 13 }}>
              {c.label}
            </Text>
          </Tap>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: space.sm, paddingHorizontal: space.xl },
  chip: {
    height: 38,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  chipOn: { backgroundColor: colors.text, borderColor: colors.text },
});
