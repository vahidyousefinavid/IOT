import { router } from 'expo-router';
import { Check, X } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { errorMessage } from '@/api/errors';
import { useCreateDevice, useRooms, useSites } from '@/api/queries';
import type { Credentials, DeviceKind, Protocol } from '@/api/types';
import { Chips } from '@/components/Chips';
import { CredentialsCard } from '@/components/CredentialsCard';
import { KindPicker } from '@/components/KindPicker';
import { TrackerSetup } from '@/components/TrackerSetup';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { Tap } from '@/components/ui/Pressable';
import { Text } from '@/components/ui/Text';
import { mqttProtocols, protocolMeta, trackerProtocols } from '@/lib/devices';
import { colors, radius, space } from '@/theme/tokens';

export default function AddDevice() {
  const insets = useSafeAreaInsets();
  const { site } = useSites();
  const rooms = useRooms(site?.id ?? null);
  const create = useCreateDevice(site?.id ?? null);

  const [name, setName] = useState('');
  const [kind, setKind] = useState<DeviceKind>('light');
  const [protocol, setProtocol] = useState<Protocol>('native');
  const [roomId, setRoomId] = useState<string | null>(null);
  const [imei, setImei] = useState('');
  const [creds, setCreds] = useState<Credentials | null>(null);
  const [tracker, setTracker] = useState<string | null>(null);

  const isTracker = kind === 'tracker';
  const protocols = isTracker ? trackerProtocols : mqttProtocols;
  const imeiDigits = imei.replace(/[^0-9]/g, '');

  const chooseKind = (k: DeviceKind) => {
    setKind(k);
    // Trackers and MQTT devices use disjoint protocol sets.
    if ((k === 'tracker') !== trackerProtocols.includes(protocol)) setProtocol(k === 'tracker' ? 'gt06' : 'native');
  };

  const submit = async () => {
    const res = await create
      .mutateAsync({ name: name.trim(), kind, protocol, room_id: roomId, ...(isTracker && { external_id: imeiDigits }) })
      .catch(() => null);
    if (!res) return;
    if (res.credentials) setCreds(res.credentials);
    else setTracker(imeiDigits);
  };
  const done = !!creds || !!tracker;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgElevated }}>
      <View style={[styles.header, { paddingTop: insets.top + space.md }]}>
        <View>
          <Text variant="h2">{done ? 'دستگاه اضافه شد' : 'افزودن دستگاه'}</Text>
          {site && <Text variant="caption" color={colors.textDim}>{site.name}</Text>}
        </View>
        <IconButton icon={X} label="بستن" onPress={() => router.back()} size={40} />
      </View>

      <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.xl, paddingBottom: insets.bottom + space.xxl }} keyboardShouldPersistTaps="handled">
        {done ? (
          <>
            {creds && <CredentialsCard creds={creds} protocol={protocol} />}
            {tracker && <TrackerSetup protocol={protocol} imei={tracker} />}
            <Button title="تمام" onPress={() => router.back()} />
          </>
        ) : (
          <>
            <Input label="نام دستگاه" value={name} onChangeText={setName} placeholder="مثلاً چراغ پذیرایی" maxLength={60} />

            <View style={{ gap: space.md }}>
              <Text variant="label" color={colors.textDim}>نوع دستگاه</Text>
              <KindPicker value={kind} onChange={chooseKind} />
            </View>

            <View style={{ gap: space.md }}>
              <Text variant="label" color={colors.textDim}>{isTracker ? 'مدل / پروتکل ردیاب' : 'روش اتصال'}</Text>
              {protocols.map((p) => {
                const on = p === protocol;
                return (
                  <Tap key={p} onPress={() => setProtocol(p)} style={[styles.option, on && styles.optionOn]} accessibilityRole="radio" accessibilityState={{ selected: on }}>
                    <View style={[styles.radio, on && styles.radioOn]}>{on && <Check size={12} color={colors.bg} strokeWidth={3} />}</View>
                    <View style={{ flex: 1 }}>
                      <Text variant="title">{protocolMeta[p].label}</Text>
                      <Text variant="caption" color={colors.textDim}>{protocolMeta[p].hint}</Text>
                    </View>
                  </Tap>
                );
              })}
            </View>

            {isTracker && (
              <Input
                label="IMEI / شناسه ردیاب (روی برچسب یا با پیامک IMEI#)"
                ltr
                value={imei}
                onChangeText={setImei}
                keyboardType="number-pad"
                placeholder="359710049012345"
                maxLength={20}
              />
            )}

            {!isTracker && !!rooms.data?.length && (
              <View style={{ gap: space.md }}>
                <Text variant="label" color={colors.textDim}>اتاق</Text>
                <View style={{ marginHorizontal: -space.xl }}>
                  <Chips
                    chips={[{ id: '', label: 'بدون اتاق' }, ...rooms.data.map((r) => ({ id: r.id, label: r.name }))]}
                    selected={roomId ?? ''}
                    onSelect={(id) => setRoomId(id || null)}
                  />
                </View>
              </View>
            )}

            {create.error && <Text variant="caption" color={colors.danger}>{errorMessage(create.error)}</Text>}
            <Button
              title={isTracker ? 'ثبت ردیاب' : 'افزودن و دریافت کلید دستگاه'}
              onPress={submit}
              loading={create.isPending}
              disabled={!name.trim() || (isTracker && (imeiDigits.length < 6 || imeiDigits.length > 20))}
            />
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: space.xl,
    paddingBottom: space.md,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  optionOn: { borderColor: colors.amber },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.textMute,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { backgroundColor: colors.amber, borderColor: colors.amber },
});
