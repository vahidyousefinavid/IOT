import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Ticket } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { useSession } from '@/api/session';
import { colors, space } from '@/theme/tokens';

import { Screen } from './Screen';
import { SiteForm } from './SiteForm';
import { Row, Section } from './ui/List';
import { Text } from './ui/Text';

/** First run: the user has no site yet — create one or join with a code. */
export function Onboarding() {
  const user = useSession((s) => s.user);
  return (
    <Screen>
      <LinearGradient
        colors={['rgba(255,138,61,0.16)', 'transparent']}
        style={[StyleSheet.absoluteFill, { height: 320 }]}
      />
      <View style={{ paddingHorizontal: space.xl, gap: space.xxl }}>
        <Animated.View entering={FadeInDown.duration(450)} style={{ gap: space.sm, marginTop: space.xl }}>
          <Text variant="caption" color={colors.amber}>خوش آمدید {user?.full_name.split(' ')[0]}</Text>
          <Text variant="h1">اولین محل خود را بسازید</Text>
          <Text variant="body" color={colors.textDim}>
            هر خانه، ساختمان یا ماشین یک «محل» است. دستگاه‌ها، اتاق‌ها و اعضا زیر هر محل مدیریت می‌شوند.
          </Text>
        </Animated.View>
        <Animated.View entering={FadeInDown.delay(100).duration(450)}>
          <SiteForm />
        </Animated.View>
        <Animated.View entering={FadeInDown.delay(200).duration(450)}>
          <Section footer="اگر نصاب یا مالک، محل را برایتان آماده کرده، با کد دعوت وارد شوید.">
            <Row icon={Ticket} iconColor={colors.violet} label="عضویت با کد دعوت" onPress={() => router.push('/join')} last />
          </Section>
        </Animated.View>
      </View>
    </Screen>
  );
}
