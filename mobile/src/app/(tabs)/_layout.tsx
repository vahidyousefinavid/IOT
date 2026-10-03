import { Tabs } from 'expo-router/js-tabs';
import { ActivityIndicator, View } from 'react-native';

import { errorMessage } from '@/api/errors';
import { useSites } from '@/api/queries';
import { useRealtime } from '@/api/realtime';
import { Onboarding } from '@/components/Onboarding';
import { TabBar } from '@/components/TabBar';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { colors, space } from '@/theme/tokens';

export default function TabsLayout() {
  const { site, data: sites, isLoading, error, refetch } = useSites();
  useRealtime(site?.id ?? null);

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.amber} />
      </View>
    );
  }
  if (error && !sites) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', gap: space.lg, padding: space.xl }}>
        <Text variant="title" align="center">{errorMessage(error)}</Text>
        <Button title="تلاش دوباره" variant="ghost" onPress={() => refetch()} />
      </View>
    );
  }
  if (sites && sites.length === 0) return <Onboarding />;

  return (
    <Tabs tabBar={(props) => <TabBar {...props} />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.bg } }}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="rooms" />
      <Tabs.Screen name="energy" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}
