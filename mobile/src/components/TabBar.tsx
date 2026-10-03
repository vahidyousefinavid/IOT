import { BlurView } from 'expo-blur';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import * as Haptics from 'expo-haptics';
import { Home, LayoutGrid, User, Zap, type LucideIcon } from 'lucide-react-native';
import { Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius } from '@/theme/tokens';

import { Tap } from './ui/Pressable';
import { Text } from './ui/Text';

const tabs: Record<string, { label: string; icon: LucideIcon }> = {
  index: { label: 'خانه', icon: Home },
  rooms: { label: 'اتاق‌ها', icon: LayoutGrid },
  energy: { label: 'انرژی', icon: Zap },
  profile: { label: 'پروفایل', icon: User },
};

/** Floating glass pill tab bar. */
export function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.outer, { bottom: Math.max(insets.bottom, 12) }]} pointerEvents="box-none">
      <View style={styles.pill}>
        <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined} />
        {state.routes.map((route, i) => {
          const t = tabs[route.name];
          if (!t) return null;
          const focused = state.index === i;
          const Icon = t.icon;
          return (
            <Tap
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={t.label}
              onPress={() => {
                const e = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                if (!focused && !e.defaultPrevented) {
                  Haptics.selectionAsync().catch(() => {});
                  navigation.navigate(route.name);
                }
              }}
              style={[styles.item, focused && styles.itemOn]}
            >
              <Icon size={20} color={focused ? colors.bg : colors.textDim} strokeWidth={focused ? 2.3 : 1.8} />
              {focused && <Text variant="title" color={colors.bg} style={{ fontSize: 13 }}>{t.label}</Text>}
            </Tap>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { position: 'absolute', left: 20, right: 20, alignItems: 'center' },
  pill: {
    flexDirection: 'row',
    gap: 6,
    padding: 6,
    borderRadius: radius.pill,
    overflow: 'hidden',
    backgroundColor: 'rgba(20,24,33,0.78)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
  },
  item: {
    height: 50,
    minWidth: 54,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  itemOn: { backgroundColor: colors.amber },
});
