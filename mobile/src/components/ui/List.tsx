import { ChevronLeft, type LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors, space } from '@/theme/tokens';

import { Card } from './Card';
import { Tap } from './Pressable';
import { Text } from './Text';

export function Section({ title, footer, children }: { title?: string; footer?: string; children: ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      {title && <Text variant="label" color={colors.textDim} style={{ paddingHorizontal: space.xs }}>{title}</Text>}
      <Card padded={false}>{children}</Card>
      {footer && <Text variant="caption" color={colors.textMute} style={{ paddingHorizontal: space.xs }}>{footer}</Text>}
    </View>
  );
}

interface RowProps {
  label: string;
  hint?: string;
  icon?: LucideIcon;
  iconColor?: string;
  onPress?: () => void;
  trailing?: ReactNode;
  danger?: boolean;
  last?: boolean;
  disabled?: boolean;
}

export function Row({ label, hint, icon: Icon, iconColor, onPress, trailing, danger, last, disabled }: RowProps) {
  const color = danger ? colors.danger : colors.text;
  const body = (
    <View style={[styles.row, !last && styles.border, disabled && { opacity: 0.5 }]}>
      {Icon && (
        <View style={[styles.icon, danger && { backgroundColor: 'rgba(255,92,108,0.12)' }]}>
          <Icon size={18} color={danger ? colors.danger : iconColor ?? colors.textDim} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text variant="title" color={color}>{label}</Text>
        {hint && <Text variant="caption" color={colors.textDim}>{hint}</Text>}
      </View>
      {trailing ?? (onPress && !danger && <ChevronLeft size={18} color={colors.textMute} />)}
    </View>
  );
  if (!onPress) return body;
  return (
    <Tap onPress={onPress} scaleTo={0.985} disabled={disabled} accessibilityRole="button" accessibilityLabel={label}>
      {body}
    </Tap>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, minHeight: 60 },
  border: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  icon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceHigh,
  },
});
