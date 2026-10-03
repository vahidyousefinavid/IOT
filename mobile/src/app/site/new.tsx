import { router } from 'expo-router';
import { View } from 'react-native';

import { Header } from '@/components/Header';
import { Screen } from '@/components/Screen';
import { SiteForm } from '@/components/SiteForm';
import { space } from '@/theme/tokens';

export default function NewSite() {
  return (
    <Screen>
      <Header title="محل جدید" subtitle="شما مالک محل جدید خواهید بود" />
      <View style={{ paddingHorizontal: space.xl }}>
        <SiteForm onDone={() => router.replace('/')} />
      </View>
    </Screen>
  );
}
