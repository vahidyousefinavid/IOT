import * as Clipboard from 'expo-clipboard';
import { Check, Copy, MessageSquareText } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { API_URL } from '@/api/http';
import type { Protocol } from '@/api/types';
import { trackerPorts } from '@/lib/devices';
import { colors, radius, space } from '@/theme/tokens';

import { Card } from './ui/Card';
import { Tap } from './ui/Pressable';
import { Text } from './ui/Text';

const operators = [
  { id: 'mci', label: 'همراه اول', apn: 'mcinet' },
  { id: 'irancell', label: 'ایرانسل', apn: 'mtnirancell' },
  { id: 'rightel', label: 'رایتل', apn: 'rightel' },
];

function trackerHost(): string {
  if (process.env.EXPO_PUBLIC_TRACKER_HOST) return process.env.EXPO_PUBLIC_TRACKER_HOST;
  try {
    return new URL(API_URL).hostname;
  } catch {
    return '';
  }
}

/**
 * SMS commands the installer sends to the tracker's SIM number to point it
 * at this server. Syntax is the common default for each family; some
 * models/firmwares differ, so the installer should check the device manual.
 */
export function TrackerSetup({ protocol, imei }: { protocol: Protocol; imei: string }) {
  const [op, setOp] = useState(operators[0]);
  const host = trackerHost();
  const port = trackerPorts[protocol];
  const isIP = /^\d+\.\d+\.\d+\.\d+$/.test(host);

  const steps =
    protocol === 'gt06'
      ? [
          { label: 'تنظیم APN اینترنت سیم‌کارت', sms: `APN,${op.apn}#` },
          { label: 'تنظیم آدرس سرور', sms: `SERVER,${isIP ? 0 : 1},${host},${port},0#` },
          { label: 'فعال کردن ارسال اینترنتی', sms: 'GPRSON,1#' },
          { label: 'ارسال موقعیت هر ۱۰ ثانیه هنگام حرکت', sms: 'TIMER,10#' },
        ]
      : [
          { label: 'تنظیم APN (رمز پیش‌فرض 0000)', sms: `8030000 ${op.apn}` },
          { label: 'تنظیم آدرس و پورت سرور', sms: `8040000 ${host} ${port}` },
          { label: 'فعال کردن حالت GPRS', sms: '7100000' },
        ];

  return (
    <Animated.View entering={FadeInDown.duration(400)} style={{ gap: space.lg }}>
      <Card style={styles.notice}>
        <MessageSquareText size={22} color={colors.sky} />
        <Text variant="body" style={{ flex: 1 }}>
          ردیاب با شناسه {imei} ثبت شد. پیامک‌های زیر را به شماره سیم‌کارت داخل ردیاب بفرستید. ردیاب پس از اتصال خودکار آنلاین می‌شود.
        </Text>
      </Card>

      <View style={{ gap: space.sm }}>
        <Text variant="label" color={colors.textDim}>اپراتور سیم‌کارت ردیاب</Text>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          {operators.map((o) => (
            <Tap key={o.id} onPress={() => setOp(o)} style={[styles.op, o.id === op.id && styles.opOn]} accessibilityRole="radio" accessibilityState={{ selected: o.id === op.id }}>
              <Text variant="label" color={o.id === op.id ? colors.bg : colors.text}>{o.label}</Text>
            </Tap>
          ))}
        </View>
      </View>

      {steps.map((s, i) => (
        <SmsStep key={s.sms} n={i + 1} label={s.label} sms={s.sms} />
      ))}

      <Text variant="caption" color={colors.textMute}>
        دستورها برای پرکاربردترین مدل‌ها هستند و ممکن است در برخی مدل‌ها کمی متفاوت باشند؛ در صورت عدم اتصال، دفترچه ردیاب را بررسی کنید. پیشنهاد امنیتی: رمز پیامکی پیش‌فرض ردیاب را تغییر دهید تا کسی نتواند سرور آن را عوض کند.
      </Text>
    </Animated.View>
  );
}

function SmsStep({ n, label, sms }: { n: number; label: string; sms: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <View style={{ gap: space.sm }}>
      <Text variant="label" color={colors.textDim}>{`${n}. ${label}`}</Text>
      <Tap
        onPress={async () => {
          await Clipboard.setStringAsync(sms);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        scaleTo={0.98}
        style={styles.sms}
        accessibilityLabel={`کپی ${label}`}
      >
        <Text variant="title" style={styles.mono} align="left" selectable>{sms}</Text>
        {copied ? <Check size={18} color={colors.success} /> : <Copy size={18} color={colors.textDim} />}
      </Tap>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start', borderColor: 'rgba(108,184,255,0.35)' },
  op: { flex: 1, height: 38, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceHigh },
  opOn: { backgroundColor: colors.sky },
  sms: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  mono: { flex: 1, fontFamily: 'monospace', writingDirection: 'ltr' },
});
