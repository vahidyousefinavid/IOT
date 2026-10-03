import { Text as RNText, type TextProps } from 'react-native';

import { colors, type as typeScale, type TypeVariant } from '@/theme/tokens';

interface Props extends TextProps {
  variant?: TypeVariant;
  color?: string;
  align?: 'left' | 'right' | 'center' | 'auto';
}

export function Text({ variant = 'body', color = colors.text, align = 'auto', style, ...rest }: Props) {
  // writingDirection keeps mixed Persian/Latin runs ordered correctly.
  return <RNText {...rest} style={[typeScale[variant], { color, textAlign: align, writingDirection: 'rtl' }, style]} />;
}
