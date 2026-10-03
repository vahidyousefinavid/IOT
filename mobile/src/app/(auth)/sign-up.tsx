import { Link } from 'expo-router';
import { Check, Lock, Mail, UserRound } from 'lucide-react-native';
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

// Mirrors the server policy so users see requirements before submitting.
const rules = [
  { label: 'حداقل ۱۰ کاراکتر', test: (p: string) => [...p].length >= 10 },
  { label: 'حرف بزرگ و کوچک انگلیسی', test: (p: string) => /[a-z]/.test(p) && /[A-Z]/.test(p) },
  { label: 'حداقل یک عدد', test: (p: string) => /[0-9]/.test(p) },
];

export default function SignUp() {
  const signIn = useSession((s) => s.signIn);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const valid = rules.every((r) => r.test(password)) && name.trim().length >= 2 && email.includes('@');

  const submit = async () => {
    setError(null);
    setLoading(true);
    try {
      const { user, tokens } = await backend.register(name.trim(), email.trim(), password);
      await signIn(user, tokens);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell title="ساخت حساب" subtitle="یک حساب برای همه خانه‌ها و دستگاه‌هایتان.">
      <Input label="نام و نام خانوادگی" icon={UserRound} value={name} onChangeText={setName} autoComplete="name" textContentType="name" />
      <Input label="ایمیل" icon={Mail} ltr value={email} onChangeText={setEmail} placeholder="you@example.com"
        autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" />
      <Input label="رمز عبور" icon={Lock} ltr value={password} onChangeText={setPassword}
        secureTextEntry autoComplete="new-password" textContentType="newPassword" />
      <View style={{ gap: 6 }}>
        {rules.map((r) => {
          const ok = r.test(password);
          return (
            <View key={r.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Check size={14} color={ok ? colors.success : colors.textMute} strokeWidth={3} />
              <Text variant="caption" color={ok ? colors.text : colors.textMute}>{r.label}</Text>
            </View>
          );
        })}
      </View>
      {error && <Text variant="caption" color={colors.danger}>{error}</Text>}
      <Button title="ساخت حساب" onPress={submit} loading={loading} disabled={!valid} style={{ marginTop: space.sm }} />
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: space.lg }}>
        <Text variant="body" color={colors.textDim}>حساب دارید؟</Text>
        <Link href="/sign-in" replace>
          <Text variant="title" color={colors.amber}>وارد شوید</Text>
        </Link>
      </View>
    </AuthShell>
  );
}
