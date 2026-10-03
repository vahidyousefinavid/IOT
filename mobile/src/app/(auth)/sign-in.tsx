import { Link } from 'expo-router';
import { Lock, Mail } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { backend } from '@/api/backend';
import { errorMessage } from '@/api/errors';
import { useSession } from '@/api/session';
import { AuthShell } from '@/components/AuthShell';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Text } from '@/components/ui/Text';
import { colors, space } from '@/theme/tokens';

export default function SignIn() {
  const signIn = useSession((s) => s.signIn);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError(null);
    setLoading(true);
    try {
      const { user, tokens } = await backend.login(email, password);
      await signIn(user, tokens);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell title="خوش برگشتید" subtitle="برای کنترل خانه و دستگاه‌هایتان وارد شوید.">
      <Input label="ایمیل" icon={Mail} ltr value={email} onChangeText={setEmail} placeholder="you@example.com"
        autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" />
      <Input label="رمز عبور" icon={Lock} ltr value={password} onChangeText={setPassword} placeholder="••••••••••"
        secureTextEntry autoComplete="current-password" textContentType="password" onSubmitEditing={submit} />
      {error && <Text variant="caption" color={colors.danger}>{error}</Text>}
      <Button title="ورود" onPress={submit} loading={loading} disabled={!email || !password} style={{ marginTop: space.sm }} />
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: space.lg }}>
        <Text variant="body" color={colors.textDim}>حساب ندارید؟</Text>
        <Link href="/sign-up" replace>
          <Text variant="title" color={colors.amber}>ثبت‌نام کنید</Text>
        </Link>
      </View>
    </AuthShell>
  );
}
