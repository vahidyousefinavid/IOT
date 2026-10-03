import { useQueryClient } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import {
  Building2, Check, Factory, Home, KeyRound, LogOut, MonitorSmartphone, Plus, Settings2, Ticket, Users, type LucideIcon,
} from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { backend } from '@/api/backend';
import { useSites } from '@/api/queries';
import { useSession } from '@/api/session';
import type { SiteKind } from '@/api/types';
import { Screen } from '@/components/Screen';
import { Row, Section } from '@/components/ui/List';
import { Text } from '@/components/ui/Text';
import { confirm } from '@/lib/confirm';
import { fa } from '@/lib/format';
import { roleMeta } from '@/lib/roles';
import { colors, space } from '@/theme/tokens';

const siteIcons: Record<SiteKind, LucideIcon> = { home: Home, building: Building2, machine: Factory };

export default function Profile() {
  const { user, tokens, siteId, setSite, signOut } = useSession();
  const { data: sites, site } = useSites();
  const qc = useQueryClient();

  const logout = async (everywhere: boolean) => {
    if (everywhere) await backend.logoutAll().catch(() => {});
    else if (tokens) await backend.logout(tokens.refresh_token).catch(() => {});
    qc.clear();
    await signOut();
  };

  const initials = user?.full_name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('‌') ?? '';

  return (
    <Screen tabBar>
      <View style={styles.profile}>
        <View style={styles.avatar}>
          <Text variant="h1" color={colors.bg}>{initials}</Text>
        </View>
        <Text variant="h2">{user?.full_name}</Text>
        <Text variant="caption" color={colors.textDim}>{user?.email}</Text>
      </View>

      <View style={styles.body}>
        <Section title="محل‌های من">
          {sites?.map((s) => {
            const Icon = siteIcons[s.kind];
            const on = s.id === siteId;
            return (
              <Row
                key={s.id}
                icon={Icon}
                iconColor={on ? colors.amber : colors.textDim}
                label={s.name}
                hint={roleMeta[s.role].label}
                onPress={() => setSite(s.id)}
                trailing={on ? <Check size={18} color={colors.amber} /> : <View />}
              />
            );
          })}
          <Row icon={Plus} iconColor={colors.amber} label="ساخت محل جدید" onPress={() => router.push('/site/new')} />
          <Row icon={Ticket} iconColor={colors.violet} label="عضویت با کد دعوت" onPress={() => router.push('/join')} last />
        </Section>

        {site && (
          <Section title={site.name}>
            <Row icon={Settings2} label="مدیریت محل" hint="نام، اتاق‌ها، دستگاه‌ها" onPress={() => router.push('/site/settings')} />
            <Row icon={Users} label="اعضا و دعوت" onPress={() => router.push('/site/members')} last />
          </Section>
        )}

        <Section title="حساب و امنیت">
          <Row icon={KeyRound} label="تغییر رمز عبور" onPress={() => router.push('/account/password')} />
          <Row
            icon={MonitorSmartphone}
            label="خروج از همه دستگاه‌ها"
            hint="اگر گوشی گم شده یا به نشستی مشکوکید"
            onPress={async () => {
              if (await confirm('خروج از همه دستگاه‌ها', 'همه نشست‌های فعال شما، از جمله همین دستگاه، بسته می‌شوند.', 'خروج')) logout(true);
            }}
            last
          />
        </Section>

        <Section>
          <Row icon={LogOut} danger label="خروج از حساب" onPress={() => logout(false)} last />
        </Section>

        <Text variant="label" color={colors.textMute} align="center">
          هوشبان، نسخه {fa(Constants.expoConfig?.version ?? '')}
          {Constants.expoConfig?.extra?.variant !== 'production' && ` (${Constants.expoConfig?.extra?.variant ?? 'dev'})`}
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  profile: { alignItems: 'center', gap: space.xs, paddingTop: space.xl },
  avatar: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.amber,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.md,
  },
  body: { paddingHorizontal: space.xl, gap: space.xl, marginTop: space.xxl },
});
