import * as Clipboard from 'expo-clipboard';
import { Copy, Share2, Ticket, Trash2, UserRound } from 'lucide-react-native';
import { useState } from 'react';
import { Platform, Share, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { canAdmin, useCreateInvite, useInvites, useMembers, useRemoveMember, useRevokeInvite, useSetRole } from '@/api/admin';
import { errorMessage } from '@/api/errors';
import { useSites } from '@/api/queries';
import { useSession } from '@/api/session';
import type { Invite, Member, Role } from '@/api/types';
import { Header } from '@/components/Header';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Row, Section } from '@/components/ui/List';
import { Tap } from '@/components/ui/Pressable';
import { Text } from '@/components/ui/Text';
import { confirm } from '@/lib/confirm';
import { fa } from '@/lib/format';
import { assignableRoles, roleMeta } from '@/lib/roles';
import { colors, radius, space } from '@/theme/tokens';

export default function Members() {
  const { site } = useSites();
  const me = useSession((s) => s.user);
  const siteId = site?.id ?? null;
  const admin = canAdmin(site?.role);
  const members = useMembers(siteId);
  const invites = useInvites(siteId, admin);
  const [open, setOpen] = useState<string | null>(null);

  if (!site) return <Screen><Header title="اعضا" /></Screen>;

  return (
    <Screen>
      <Header title="اعضا و دعوت" subtitle={site.name} />
      <View style={styles.body}>
        <Section title={`اعضا (${fa(members.data?.length ?? 0)})`} footer={admin ? 'برای تغییر نقش یا حذف، روی عضو بزنید.' : undefined}>
          {members.data?.map((m, i) => (
            <MemberRow
              key={m.user_id}
              member={m}
              siteId={site.id}
              actor={site.role}
              isMe={m.user_id === me?.id}
              open={open === m.user_id}
              onToggle={() => setOpen(open === m.user_id ? null : m.user_id)}
              last={i === members.data.length - 1}
            />
          ))}
        </Section>

        {admin && <InviteCreator siteId={site.id} actor={site.role} />}

        {admin && !!invites.data?.length && (
          <Section title="کدهای فعال" footer="هر کد یک‌بارمصرف است و پس از ۷ روز منقضی می‌شود.">
            {invites.data.map((inv, i) => (
              <InviteRow key={inv.id} invite={inv} siteId={site.id} last={i === invites.data.length - 1} />
            ))}
          </Section>
        )}
      </View>
    </Screen>
  );
}

function MemberRow({ member, siteId, actor, isMe, open, onToggle, last }: {
  member: Member; siteId: string; actor: Role; isMe: boolean; open: boolean; onToggle: () => void; last: boolean;
}) {
  const setRole = useSetRole();
  const remove = useRemoveMember();
  const options = assignableRoles(actor);
  const manageable = !isMe && options.includes(member.role);

  return (
    <View style={!last && styles.border}>
      <Row
        icon={UserRound}
        iconColor={member.role === 'owner' ? colors.amber : colors.textDim}
        label={`${member.full_name}${isMe ? ' (شما)' : ''}`}
        hint={`${roleMeta[member.role].label}، ${member.email}`}
        onPress={manageable ? onToggle : undefined}
        last
      />
      {open && manageable && (
        <Animated.View entering={FadeIn.duration(200)} style={styles.manage}>
          <View style={styles.roles}>
            {options.map((r) => (
              <Tap
                key={r}
                onPress={() => setRole.mutate([siteId, member.user_id, r])}
                style={[styles.role, r === member.role && styles.roleOn]}
                accessibilityRole="radio"
                accessibilityState={{ selected: r === member.role }}
              >
                <Text variant="label" color={r === member.role ? colors.bg : colors.text}>{roleMeta[r].label}</Text>
              </Tap>
            ))}
          </View>
          <Tap
            onPress={async () => {
              if (await confirm('حذف عضو', `دسترسی ${member.full_name} به این محل حذف شود؟`)) remove.mutate([siteId, member.user_id]);
            }}
            style={styles.remove}
          >
            <Trash2 size={16} color={colors.danger} />
            <Text variant="label" color={colors.danger}>حذف از محل</Text>
          </Tap>
          {(setRole.error || remove.error) && (
            <Text variant="caption" color={colors.danger}>{errorMessage(setRole.error ?? remove.error)}</Text>
          )}
        </Animated.View>
      )}
    </View>
  );
}

function InviteCreator({ siteId, actor }: { siteId: string; actor: Role }) {
  const options = assignableRoles(actor);
  const [role, setRole] = useState<Role>('member');
  const create = useCreateInvite();
  const [created, setCreated] = useState<Invite | null>(null);

  const share = async (code: string) => {
    const message = `کد دعوت هوشبان: ${code}\nدر اپ هوشبان «عضویت با کد دعوت» را بزنید. این کد تا ۷ روز و فقط یک بار معتبر است.`;
    if (Platform.OS === 'web') await Clipboard.setStringAsync(message);
    else await Share.share({ message });
  };

  return (
    <View style={{ gap: space.sm }}>
      <Text variant="label" color={colors.textDim} style={{ paddingHorizontal: space.xs }}>دعوت عضو جدید</Text>
      <Card style={{ gap: space.lg }}>
        <Text variant="caption" color={colors.textDim}>
          نصاب‌ها: پس از پیکربندی، یک کد با نقش «مالک» برای صاحب خانه بسازید تا محل را تحویل بگیرد.
        </Text>
        <View style={styles.roles}>
          {options.map((r) => (
            <Tap key={r} onPress={() => setRole(r)} style={[styles.role, r === role && styles.roleOn]} accessibilityRole="radio" accessibilityState={{ selected: r === role }}>
              <Text variant="label" color={r === role ? colors.bg : colors.text}>{roleMeta[r].label}</Text>
            </Tap>
          ))}
        </View>
        <Text variant="caption" color={colors.textMute}>{roleMeta[role].hint}</Text>
        <Button title="ساخت کد دعوت" accent="violet" loading={create.isPending} onPress={() => create.mutate([siteId, role], { onSuccess: setCreated })} />
        {create.error && <Text variant="caption" color={colors.danger}>{errorMessage(create.error)}</Text>}
        {created?.code && (
          <Animated.View entering={FadeIn.duration(300)} style={styles.codeBox}>
            <Text variant="label" color={colors.textDim}>کد دعوت ({roleMeta[created.role].label})</Text>
            <Text variant="h1" style={styles.code} selectable>{created.code}</Text>
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Tap onPress={() => Clipboard.setStringAsync(created.code!)} style={styles.codeBtn}>
                <Copy size={16} color={colors.text} />
                <Text variant="label">کپی</Text>
              </Tap>
              <Tap onPress={() => share(created.code!)} style={styles.codeBtn}>
                <Share2 size={16} color={colors.text} />
                <Text variant="label">ارسال</Text>
              </Tap>
            </View>
            <Text variant="caption" color={colors.textMute} align="center">این کد دیگر نمایش داده نمی‌شود.</Text>
          </Animated.View>
        )}
      </Card>
    </View>
  );
}

function InviteRow({ invite, siteId, last }: { invite: Invite; siteId: string; last: boolean }) {
  const revoke = useRevokeInvite();
  const days = Math.max(0, Math.ceil((new Date(invite.expires_at).getTime() - Date.now()) / 86_400_000));
  return (
    <Row
      icon={Ticket}
      iconColor={colors.violet}
      label={`دعوت ${roleMeta[invite.role].label}`}
      hint={`${fa(days)} روز تا انقضا`}
      last={last}
      trailing={
        <Tap hitSlop={8} onPress={() => revoke.mutate([siteId, invite.id])} accessibilityLabel="لغو دعوت">
          <Text variant="label" color={colors.danger}>لغو</Text>
        </Tap>
      }
    />
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: space.xl, gap: space.xl },
  border: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  manage: { paddingHorizontal: space.lg, paddingBottom: space.lg, gap: space.md },
  roles: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  role: {
    paddingHorizontal: space.md,
    height: 34,
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceHigh,
  },
  roleOn: { backgroundColor: colors.amber },
  remove: { flexDirection: 'row', alignItems: 'center', gap: space.sm, alignSelf: 'flex-start' },
  codeBox: {
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceHigh,
    borderWidth: 1,
    borderColor: 'rgba(164,139,255,0.35)',
  },
  code: { fontFamily: 'monospace', letterSpacing: 3, writingDirection: 'ltr' },
  codeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.lg,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
});
