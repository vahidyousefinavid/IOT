import { router } from 'expo-router';
import { ArrowRight } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { colors, space } from '@/theme/tokens';

import { IconButton } from './ui/IconButton';
import { Text } from './ui/Text';

/** Title bar for pushed screens: back, title/subtitle, optional action. */
export function Header({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.xl, marginBottom: space.lg }}>
      <IconButton icon={ArrowRight} label="بازگشت" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
      <View style={{ flex: 1 }}>
        <Text variant="h2" numberOfLines={1}>{title}</Text>
        {subtitle && <Text variant="caption" color={colors.textDim} numberOfLines={1}>{subtitle}</Text>}
      </View>
      {action ?? <View style={{ width: 44 }} />}
    </View>
  );
}
