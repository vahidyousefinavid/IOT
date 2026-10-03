import { router, useLocalSearchParams } from 'expo-router';
import { KeyRound, Trash2 } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { canAdmin, useDeleteDevice, useRotateCredentials, useUpdateDevice } from '@/api/admin';
import { errorMessage } from '@/api/errors';
import { useDevice, useRooms, useSites } from '@/api/queries';
import type { DeviceKind } from '@/api/types';
import { Chips } from '@/components/Chips';
import { CredentialsCard } from '@/components/CredentialsCard';
import { Header } from '@/components/Header';
import { KindPicker } from '@/components/KindPicker';
import { TrackerSetup } from '@/components/TrackerSetup';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Row, Section } from '@/components/ui/List';
import { Text } from '@/components/ui/Text';
import { confirm } from '@/lib/confirm';
import { protocolMeta } from '@/lib/devices';
import { relativeTime } from '@/lib/format';
import { colors, space } from '@/theme/tokens';

export default function DeviceSettings() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { site } = useSites();
  const siteId = site?.id ?? null;
  const { device } = useDevice(siteId, id);
  const rooms = useRooms(siteId);

  const update = useUpdateDevice();
  const del = useDeleteDevice();
  const rotate = useRotateCredentials();

  const [name, setName] = useState('');
  const [kind, setKind] = useState<DeviceKind>('other');
  const [roomId, setRoomId] = useState<string | null>(null);

  useEffect(() => {
    if (!device) return;
    setName(device.name);
    setKind(device.kind);
    setRoomId(device.room_id);
    // Only reset the form when a different device is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device?.id]);

  if (!device || !site) return <Screen><Header title="تنظیمات دستگاه" /></Screen>;
  if (!canAdmin(site.role)) {
    return (
      <Screen>
        <Header title="تنظیمات دستگاه" />
        <Text variant="body" color={colors.textDim} align="center">فقط مدیر یا مالک محل می‌تواند دستگاه را پیکربندی کند.</Text>
      </Screen>
    );
  }

  const isTracker = device.kind === 'tracker';
  const dirty = name.trim() !== device.name || kind !== device.kind || (roomId ?? null) !== device.room_id;
  const error = update.error ?? del.error ?? rotate.error;

  return (
    <Screen>
      <Header title="تنظیمات دستگاه" subtitle={device.name} />
      <View style={styles.body}>
        <Input label="نام" value={name} onChangeText={setName} maxLength={60} />

        {!isTracker && <View style={{ gap: space.md }}>
          <Text variant="label" color={colors.textDim}>نوع دستگاه</Text>
          <KindPicker value={kind} onChange={setKind} />
          {device.parent_id && (
            <Text variant="caption" color={colors.textMute}>
              این دستگاه از طریق بریج شناسایی شده و نوعش حدسی است؛ در صورت نیاز اصلاح کنید.
            </Text>
          )}
        </View>}

        {!!rooms.data?.length && (
          <View style={{ gap: space.md }}>
            <Text variant="label" color={colors.textDim}>اتاق</Text>
            <View style={{ marginHorizontal: -space.xl }}>
              <Chips
                chips={rooms.data.map((r) => ({ id: r.id, label: r.name }))}
                selected={roomId ?? ''}
                onSelect={setRoomId}
              />
            </View>
          </View>
        )}

        {dirty && (
          <Button
            title="ذخیره تغییرات"
            loading={update.isPending}
            disabled={!name.trim()}
            onPress={() =>
              update.mutate([site.id, device.id, { name: name.trim(), kind, ...(roomId ? { room_id: roomId } : {}) }])
            }
          />
        )}

        <Section title="اطلاعات فنی">
          <Row label="وضعیت" hint={device.online ? 'آنلاین' : `آفلاین، آخرین ارتباط ${relativeTime(device.last_seen)}`} />
          <Row label="پروتکل" hint={protocolMeta[device.protocol]?.label ?? device.protocol} />
          {device.external_id && <Row label={isTracker ? 'IMEI / شناسه ردیاب' : 'شناسه در بریج'} hint={device.external_id} />}
          <Row label="شناسه دستگاه" hint={device.id} last />
        </Section>

        <Card style={{ gap: space.sm }}>
          <Text variant="label" color={colors.textDim}>آخرین وضعیت گزارش‌شده</Text>
          <Text variant="caption" style={styles.mono} align="left" selectable>
            {JSON.stringify(device.state, null, 2)}
          </Text>
        </Card>

        {rotate.data && <CredentialsCard creds={rotate.data} protocol={device.protocol} />}
        {isTracker && device.external_id && <TrackerSetup protocol={device.protocol} imei={device.external_id} />}

        {error && <Text variant="caption" color={colors.danger}>{errorMessage(error)}</Text>}

        <Section footer="ساخت کلید جدید، کلید قبلی را باطل می‌کند؛ دستگاه تا وارد کردن کلید جدید قطع می‌شود.">
          {!device.parent_id && !isTracker && (
            <Row
              icon={KeyRound}
              iconColor={colors.amber}
              label="ساخت کلید جدید دستگاه"
              onPress={async () => {
                if (await confirm('کلید جدید', 'کلید فعلی دستگاه باطل می‌شود. ادامه می‌دهید؟', 'ساخت کلید')) {
                  rotate.mutate([site.id, device.id]);
                }
              }}
            />
          )}
          <Row
            icon={Trash2}
            danger
            label="حذف دستگاه"
            last
            onPress={async () => {
              if (await confirm('حذف دستگاه', `«${device.name}» و تاریخچه‌اش حذف و کلید آن باطل می‌شود.`)) {
                del.mutate([site.id, device.id], { onSuccess: () => router.dismissTo('/') });
              }
            }}
          />
        </Section>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: space.xl, gap: space.xl },
  mono: { fontFamily: 'monospace', writingDirection: 'ltr', lineHeight: 20 },
});
