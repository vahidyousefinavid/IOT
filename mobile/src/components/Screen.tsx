import type { ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, space } from '@/theme/tokens';

interface Props {
  children: ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Extra bottom space so content clears the floating tab bar. */
  tabBar?: boolean;
}

export function Screen({ children, scroll = true, refreshing, onRefresh, tabBar }: Props) {
  const insets = useSafeAreaInsets();
  const padding = { paddingTop: insets.top + space.md, paddingBottom: insets.bottom + (tabBar ? 110 : space.xxl) };
  if (!scroll) return <View style={[styles.root, padding]}>{children}</View>;
  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={padding}
      showsVerticalScrollIndicator={false}
      refreshControl={
        onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.amber} /> : undefined
      }
    >
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
});
