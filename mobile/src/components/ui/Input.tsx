import type { LucideIcon } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { colors, font, radius, space } from '@/theme/tokens';

import { Text } from './Text';

interface Props extends TextInputProps {
  label: string;
  icon?: LucideIcon;
  ltr?: boolean;
}

export function Input({ label, icon: Icon, ltr, style, onFocus, onBlur, ...rest }: Props) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: space.sm }}>
      <Text variant="label" color={colors.textDim}>{label}</Text>
      <View style={[styles.field, focused && styles.focused]}>
        {Icon && <Icon size={18} color={focused ? colors.amber : colors.textMute} />}
        <TextInput
          {...rest}
          placeholderTextColor={colors.textMute}
          selectionColor={colors.amber}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[styles.input, { textAlign: ltr ? 'left' : 'right', writingDirection: ltr ? 'ltr' : 'rtl' }, style]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    height: 54,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  focused: { borderColor: 'rgba(255,181,71,0.55)', backgroundColor: colors.surfaceHigh },
  input: { flex: 1, color: colors.text, fontFamily: font.regular, fontSize: 15, height: '100%' },
});
