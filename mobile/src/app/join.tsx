import { router } from 'expo-router';
import { Ticket } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { useRedeemInvite } from '@/api/admin';
import { errorMessage } from '@/api/errors';
import { Header } from '@/components/Header';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Text } from '@/components/ui/Text';
import { colors, space } from '@/theme/tokens';

export default function Join() {
  const [code, setCode] = useState('');
  const redeem = useRedeemInvite();
  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, '');

  return (
    <Screen>
      <Header title="عضویت با کد دعوت" />
      <View style={{ paddingHorizontal: space.xl, gap: space.lg }}>
        <Text variant="body" color={colors.textDim}>
          کد ۱۰ حرفی را که مالک یا نصاب محل به شما داده وارد کنید. هر کد فقط یک بار و تا ۷ روز معتبر است.
        </Text>
        <Input
          label="کد دعوت"
          icon={Ticket}
          ltr
          value={code}
          onChangeText={setCode}
          placeholder="ABCDE-FGH23"
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={14}
          style={{ letterSpacing: 2, fontSize: 18 }}
        />
        {redeem.error && <Text variant="caption" color={colors.danger}>{errorMessage(redeem.error)}</Text>}
        <Button
          title="عضویت"
          loading={redeem.isPending}
          disabled={clean.length !== 10}
          onPress={() => redeem.mutate(clean, { onSuccess: () => router.replace('/') })}
        />
      </View>
    </Screen>
  );
}
