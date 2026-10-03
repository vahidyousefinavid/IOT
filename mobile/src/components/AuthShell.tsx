import { LinearGradient } from 'expo-linear-gradient';
import { Cpu } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, space } from '@/theme/tokens';

import { Text } from './ui/Text';

/** Shared frame for sign-in / sign-up: glowing brand mark, title, form. */
export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <LinearGradient
        colors={['rgba(255,138,61,0.20)', 'rgba(164,139,255,0.08)', 'transparent']}
        start={{ x: 0.9, y: 0 }}
        end={{ x: 0.2, y: 0.6 }}
        style={StyleSheet.absoluteFill}
      />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingTop: insets.top + 56, paddingBottom: insets.bottom + space.xxl, paddingHorizontal: space.xl }}
      >
        <Animated.View entering={FadeInDown.duration(500)} style={styles.brand}>
          <LinearGradient colors={[colors.amber, colors.amberDeep]} style={styles.logo}>
            <Cpu size={30} color={colors.bg} strokeWidth={2.2} />
          </LinearGradient>
          <Text variant="label" color={colors.amber} style={{ letterSpacing: 1 }}>هوشبان</Text>
        </Animated.View>
        <Animated.View entering={FadeInDown.delay(80).duration(500)} style={{ gap: space.sm, marginBottom: space.xxl }}>
          <Text variant="h1">{title}</Text>
          <Text variant="body" color={colors.textDim}>{subtitle}</Text>
        </Animated.View>
        <Animated.View entering={FadeInDown.delay(160).duration(500)}>
          <View style={{ gap: space.lg }}>{children}</View>
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  brand: { alignItems: 'flex-start', gap: space.md, marginBottom: space.xxxl },
  logo: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.amberDeep,
    shadowOpacity: 0.5,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
  },
});
