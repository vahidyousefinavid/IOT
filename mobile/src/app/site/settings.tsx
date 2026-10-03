import { router } from 'expo-router';
import { Check, DoorOpen, LogOut, Pencil, Plus, Trash2, Users, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { canAdmin, useCreateRoom, useDeleteRoom, useDeleteSite, useRemoveMember, useRenameRoom, useUpdateSite } from '@/api/admin';
import { errorMessage } from '@/api/errors';
import { useDevices, useRooms, useSites } from '@/api/queries';
import { useSession } from '@/api/session';
import type { Room } from '@/api/types';
import { Header } from '@/components/Header';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Row, Section } from '@/components/ui/List';
import { Tap } from '@/components/ui/Pressable';
import { Text } from '@/components/ui/Text';
import { confirm } from '@/lib/confirm';
import { kindMeta, statusLine } from '@/lib/devices';
import { fa } from '@/lib/format';
import { roleMeta } from '@/lib/roles';
import { colors, font, radius, space } from '@/theme/tokens';

export default function SiteSettings() {
  const { site } = useSites();
  const user = useSession((s) => s.user);
  const siteId = site?.id ?? null;
  const rooms = useRooms(siteId);
  const devices = useDevices(siteId);
  const admin = canAdmin(site?.role);

  const updateSite = useUpdateSite();
  const deleteSite = useDeleteSite();
  const leave = useRemoveMember();
  const [name, setName] = useState(site?.name ?? '');
  useEffect(() => setName(site?.name ?? ''), [site?.name]);

  if (!site) return <Screen><Header title="مدیریت محل" /></Screen>;

  const error = updateSite.error ?? deleteSite.error ?? leave.error;

  return (
    <Screen>
      <Header title="مدیریت محل" subtitle={`${site.name}، نقش شما: ${roleMeta[site.role].label}`} />
      <View style={styles.body}>
        {admin && (
          <View style={{ gap: space.md }}>
            <Input label="نام محل" value={name} onChangeText={setName} maxLength={60} />
            {name.trim() !== site.name && (
              <Button title="ذخیره نام" loading={updateSite.isPending} disabled={!name.trim()} onPress={() => updateSite.mutate([site.id, name.trim()])} />
            )}
          </View>
        )}

        <Section title="اعضا و دسترسی">
          <Row icon={Users} iconColor={colors.violet} label="اعضا و کدهای دعوت" hint="نقش‌ها، دعوت مالک یا اعضای خانواده" onPress={() => router.push('/site/members')} last />
        </Section>

        <Section title={`اتاق‌ها (${fa(rooms.data?.length ?? 0)})`} footer={admin ? 'با حذف اتاق، دستگاه‌های آن حذف نمی‌شوند و فقط بدون اتاق می‌مانند.' : undefined}>
          {rooms.data?.map((r, i) => (
            <RoomRow key={r.id} room={r} siteId={site.id} editable={admin} last={!admin && i === rooms.data.length - 1} />
          ))}
          {admin && <AddRoom siteId={site.id} />}
        </Section>

        <Section title={`دستگاه‌ها (${fa(devices.data?.length ?? 0)})`}>
          {devices.data?.length === 0 && <Row label="هنوز دستگاهی اضافه نشده" last />}
          {devices.data?.map((d, i) => (
            <Row
              key={d.id}
              icon={kindMeta[d.kind].icon}
              iconColor={d.online ? colors.success : colors.textMute}
              label={d.name}
              hint={`${kindMeta[d.kind].label}، ${statusLine(d)}${d.parent_id ? '، از طریق بریج' : ''}`}
              onPress={() => router.push({ pathname: admin ? '/device/settings/[id]' : '/device/[id]', params: { id: d.id } })}
              last={!admin && i === devices.data.length - 1}
            />
          ))}
          {admin && <Row icon={Plus} iconColor={colors.amber} label="افزودن دستگاه" onPress={() => router.push('/device/add')} last />}
        </Section>

        {error && <Text variant="caption" color={colors.danger}>{errorMessage(error)}</Text>}

        <Section>
          {site.role === 'owner' ? (
            <Row
              icon={Trash2}
              danger
              label="حذف کامل محل"
              hint="همه دستگاه‌ها، کلیدها و داده‌ها برای همیشه حذف می‌شوند"
              last
              onPress={async () => {
                if (await confirm('حذف محل', `«${site.name}» و همه دستگاه‌ها و داده‌هایش برای همیشه حذف می‌شود.`)) {
                  deleteSite.mutate([site.id], { onSuccess: () => router.replace('/') });
                }
              }}
            />
          ) : (
            <Row
              icon={LogOut}
              danger
              label="خروج از این محل"
              last
              onPress={async () => {
                if (user && (await confirm('خروج از محل', `دیگر به «${site.name}» دسترسی نخواهید داشت.`, 'خروج'))) {
                  leave.mutate([site.id, user.id], { onSuccess: () => router.replace('/') });
                }
              }}
            />
          )}
        </Section>
      </View>
    </Screen>
  );
}

function RoomRow({ room, siteId, editable, last }: { room: Room; siteId: string; editable: boolean; last: boolean }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(room.name);
  const rename = useRenameRoom();
  const del = useDeleteRoom();

  if (editing) {
    return (
      <View style={[styles.inline, !last && styles.border]}>
        <TextInput value={name} onChangeText={setName} autoFocus maxLength={40} style={styles.inlineInput} selectionColor={colors.amber} />
        <Tap onPress={() => rename.mutate([siteId, room.id, name.trim()], { onSuccess: () => setEditing(false) })} disabled={!name.trim()} accessibilityLabel="ذخیره">
          <Check size={20} color={colors.success} />
        </Tap>
        <Tap onPress={() => { setName(room.name); setEditing(false); }} accessibilityLabel="انصراف">
          <X size={20} color={colors.textDim} />
        </Tap>
      </View>
    );
  }
  return (
    <Row
      icon={DoorOpen}
      label={room.name}
      last={last}
      trailing={
        editable ? (
          <View style={{ flexDirection: 'row', gap: space.lg }}>
            <Tap onPress={() => setEditing(true)} hitSlop={8} accessibilityLabel={`تغییر نام ${room.name}`}>
              <Pencil size={18} color={colors.textDim} />
            </Tap>
            <Tap
              hitSlop={8}
              accessibilityLabel={`حذف ${room.name}`}
              onPress={async () => {
                if (await confirm('حذف اتاق', `اتاق «${room.name}» حذف شود؟`)) del.mutate([siteId, room.id]);
              }}
            >
              <Trash2 size={18} color={colors.danger} />
            </Tap>
          </View>
        ) : undefined
      }
    />
  );
}

function AddRoom({ siteId }: { siteId: string }) {
  const [name, setName] = useState('');
  const create = useCreateRoom();
  return (
    <View style={styles.inline}>
      <Plus size={18} color={colors.amber} />
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="افزودن اتاق جدید…"
        placeholderTextColor={colors.textMute}
        maxLength={40}
        style={styles.inlineInput}
        selectionColor={colors.amber}
        onSubmitEditing={() => name.trim() && create.mutate([siteId, name.trim()], { onSuccess: () => setName('') })}
      />
      {!!name.trim() && (
        <Tap onPress={() => create.mutate([siteId, name.trim()], { onSuccess: () => setName('') })} accessibilityLabel="افزودن اتاق">
          <Check size={20} color={colors.success} />
        </Tap>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: space.xl, gap: space.xl },
  inline: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, minHeight: 60 },
  border: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  inlineInput: {
    flex: 1,
    color: colors.text,
    fontFamily: font.medium,
    fontSize: 15,
    textAlign: 'right',
    paddingVertical: space.md,
    borderRadius: radius.sm,
  },
});
