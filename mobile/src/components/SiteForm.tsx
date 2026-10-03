import { Building2, Factory, Home, type LucideIcon } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useCreateSite } from '@/api/admin';
import { errorMessage } from '@/api/errors';
import type { SiteKind } from '@/api/types';
import { accents, colors, radius, space } from '@/theme/tokens';

import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Tap } from './ui/Pressable';
import { Text } from './ui/Text';

const kinds: { id: SiteKind; label: string; hint: string; icon: LucideIcon }[] = [
  { id: 'home', label: 'خانه', hint: 'آپارتمان یا ویلا', icon: Home },
  { id: 'building', label: 'ساختمان', hint: 'مجتمع، اداره، مغازه', icon: Building2 },
  { id: 'machine', label: 'ماشین / صنعت', hint: 'دستگاه یا خط تولید', icon: Factory },
];

/** Creates a site; the creator becomes its owner and default rooms are added. */
export function SiteForm({ onDone }: { onDone?: () => void }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<SiteKind>('home');
  const create = useCreateSite();

  return (
    <View style={{ gap: space.lg }}>
      <View style={styles.kinds}>
        {kinds.map((k) => {
          const on = k.id === kind;
          return (
            <Tap key={k.id} onPress={() => setKind(k.id)} style={[styles.kind, on && styles.kindOn]} accessibilityRole="radio" accessibilityState={{ selected: on }}>
              <k.icon size={24} color={on ? colors.amber : colors.textDim} />
              <Text variant="title" color={on ? colors.text : colors.textDim}>{k.label}</Text>
              <Text variant="label" color={colors.textMute} align="center">{k.hint}</Text>
            </Tap>
          );
        })}
      </View>
      <Input label="نام" value={name} onChangeText={setName} placeholder={kind === 'machine' ? 'مثلاً خط تولید ۱' : 'مثلاً خانه ولنجک'} maxLength={60} />
      {create.error && <Text variant="caption" color={colors.danger}>{errorMessage(create.error)}</Text>}
      <Button
        title="ساخت"
        loading={create.isPending}
        disabled={!name.trim()}
        onPress={() => create.mutate({ name: name.trim(), kind }, { onSuccess: () => onDone?.() })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  kinds: { flexDirection: 'row', gap: space.sm },
  kind: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    paddingVertical: space.lg,
    paddingHorizontal: space.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  kindOn: { borderColor: colors.amber, backgroundColor: accents.amber.glow },
});
