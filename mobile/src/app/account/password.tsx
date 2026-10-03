import { useQueryClient } from '@tanstack/react-query';
import { Lock } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { backend } from '@/api/backend';
import { errorMessage } from '@/api/errors';
import { useSession } from '@/api/session';
import { Header } from '@/components/Header';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Text } from '@/components/ui/Text';
import { colors, space } from '@/theme/tokens';

export default function ChangePassword() {
  const signOut = useSession((s) => s.signOut);
  const qc = useQueryClient();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError(null);
    setLoading(true);
    try {
      await backend.changePassword(current, next);
      // The server ended every session; sign in again with the new password.
      qc.clear();
      await signOut();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen>
      <Header title="تغییر رمز عبور" />
      <View style={{ paddingHorizontal: space.xl, gap: space.lg }}>
        <Input label="رمز فعلی" icon={Lock} ltr secureTextEntry value={current} onChangeText={setCurrent} autoComplete="current-password" />
        <Input label="رمز جدید" icon={Lock} ltr secureTextEntry value={next} onChangeText={setNext} autoComplete="new-password" />
        <Text variant="caption" color={colors.textMute}>
          حداقل ۱۰ کاراکتر، شامل حرف بزرگ، کوچک و عدد. پس از تغییر، از همه دستگاه‌ها خارج می‌شوید.
        </Text>
        {error && <Text variant="caption" color={colors.danger}>{error}</Text>}
        <Button title="تغییر رمز" loading={loading} disabled={!current || next.length < 10} onPress={submit} />
      </View>
    </Screen>
  );
}
