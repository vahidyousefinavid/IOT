import {
  Vazirmatn_300Light, Vazirmatn_400Regular, Vazirmatn_500Medium, Vazirmatn_600SemiBold,
  Vazirmatn_700Bold, Vazirmatn_800ExtraBold, useFonts,
} from '@expo-google-fonts/vazirmatn';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, SplashScreen, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { I18nManager, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ApiError } from '@/api/http';
import { useSession } from '@/api/session';
import { colors } from '@/theme/tokens';

SplashScreen.preventAutoHideAsync();

// Production builds are forced RTL by the expo-localization plugin (app.json).
// This covers Expo Go, where it takes effect after one app restart.
if (Platform.OS === 'web') {
  // react-native-web follows the document direction.
  document.documentElement.dir = 'rtl';
  document.documentElement.lang = 'fa';
} else if (!I18nManager.isRTL) {
  I18nManager.allowRTL(true);
  I18nManager.forceRTL(true);
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.bg, card: colors.bg, primary: colors.amber, text: colors.text, border: colors.border },
};

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Vazirmatn_300Light, Vazirmatn_400Regular, Vazirmatn_500Medium,
    Vazirmatn_600SemiBold, Vazirmatn_700Bold, Vazirmatn_800ExtraBold,
  });
  const { ready, user, hydrate } = useSession();

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (fontsLoaded && ready) SplashScreen.hideAsync();
  }, [fontsLoaded, ready]);

  if (!fontsLoaded || !ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider value={theme}>
            <StatusBar style="light" />
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'fade_from_bottom' }}>
              <Stack.Protected guard={!!user}>
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="device/[id]" options={{ animation: 'slide_from_left' }} />
                <Stack.Screen name="device/add" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
                <Stack.Screen name="device/settings/[id]" options={{ animation: 'slide_from_left' }} />
                <Stack.Screen name="site/settings" options={{ animation: 'slide_from_left' }} />
                <Stack.Screen name="site/members" options={{ animation: 'slide_from_left' }} />
                <Stack.Screen name="site/new" options={{ animation: 'slide_from_left' }} />
                <Stack.Screen name="join" options={{ animation: 'slide_from_left' }} />
                <Stack.Screen name="account/password" options={{ animation: 'slide_from_left' }} />
              </Stack.Protected>
              <Stack.Protected guard={!user}>
                <Stack.Screen name="(auth)" />
              </Stack.Protected>
            </Stack>
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
