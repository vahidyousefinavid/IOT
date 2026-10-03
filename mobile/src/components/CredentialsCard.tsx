import * as Clipboard from 'expo-clipboard';
import { Check, Copy, ShieldCheck } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { API_URL } from '@/api/http';
import type { Credentials, Protocol } from '@/api/types';
import { colors, radius, space } from '@/theme/tokens';

import { Card } from './ui/Card';
import { Tap } from './ui/Pressable';
import { Text } from './ui/Text';

/** Broker host devices should use: EXPO_PUBLIC_MQTT_HOST, else the API host. */
function brokerHost(): string {
  if (process.env.EXPO_PUBLIC_MQTT_HOST) return process.env.EXPO_PUBLIC_MQTT_HOST;
  try {
    return new URL(API_URL).hostname;
  } catch {
    return '';
  }
}

/**
 * Device credentials, shown exactly once after creation or rotation, with
 * the exact configuration line the installer types into the device.
 */
export function CredentialsCard({ creds, protocol }: { creds: Credentials; protocol: Protocol }) {
  const setup =
    protocol === 'zigbee2mqtt'
      ? `mqtt:\n  server: mqtts://${brokerHost()}:8883\n  base_topic: ${creds.topic_root}/z2m\n  user: ${creds.mqtt_username}\n  client_id: ${creds.mqtt_username}`
      : protocol === 'tasmota'
        ? `MqttHost ${brokerHost()}\nMqttPort 8883\nMqttUser ${creds.mqtt_username}\nMqttClient ${creds.mqtt_username}\nFullTopic ${creds.topic_root}/%prefix%/`
        : `host: ${brokerHost()}  port: 8883 (TLS)\nclient_id = username\nroot: ${creds.topic_root}`;

  return (
    <Animated.View entering={FadeInDown.duration(400)} style={{ gap: space.lg }}>
      <Card style={styles.notice}>
        <ShieldCheck size={22} color={colors.amber} />
        <Text variant="body" style={{ flex: 1 }}>
          این مشخصات فقط همین یک بار نمایش داده می‌شود. آن را همین حالا در دستگاه وارد یا ذخیره کنید. در صورت گم شدن، از تنظیمات دستگاه «کلید جدید» بسازید.
        </Text>
      </Card>
      <Field label="Username / Client ID" value={creds.mqtt_username} />
      <Field label="Password" value={creds.mqtt_password} />
      <Field label="پیکربندی دستگاه" value={setup} multiline />
    </Animated.View>
  );
}

function Field({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await Clipboard.setStringAsync(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <View style={{ gap: space.sm }}>
      <Text variant="label" color={colors.textDim}>{label}</Text>
      <Tap onPress={copy} scaleTo={0.98} style={styles.field} accessibilityLabel={`کپی ${label}`}>
        <Text variant="caption" style={styles.mono} numberOfLines={multiline ? undefined : 1} align="left" selectable>
          {value}
        </Text>
        {copied ? <Check size={18} color={colors.success} /> : <Copy size={18} color={colors.textDim} />}
      </Tap>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start', borderColor: 'rgba(255,181,71,0.35)' },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  mono: { flex: 1, fontFamily: 'monospace', writingDirection: 'ltr', lineHeight: 20 },
});
