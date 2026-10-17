// Me → Phone setup (Phase 7 item 7), a page pushed over Me: the brand's battery and auto-start steps with the
// "Open <brand> settings" button (components/PhoneSetup.tsx; the same steps show once in the first-run
// Permissions flow). When the phone stopped Fame Driver for over 3 minutes on one of the last 3 days, that is said
// at the top (it used to be the card on Today) until the driver taps Done. Back (the arrow, Android's back or
// Done) returns to Me. Nothing is typed here, so there is no "Discard changes?".

import { Redirect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BatteryCharging, ChevronLeft } from '@/components/icons';
import { phoneSetupBrand, PhoneSetupSteps, useStoppedNote, useStoppedText } from '@/components/PhoneSetup';
import { Button, Card, Txt } from '@/components/ui';
import { KEYS, setJson } from '@/lib/kv';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

export default function PhoneSetupScreen() {
  const { t, me } = useApp();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { note } = useStoppedNote();
  const stoppedText = useStoppedText();
  const { name } = phoneSetupBrand();

  if (!me) return <Redirect href="/login" />;

  // Done: the driver has changed the settings. The note stays away until the phone stops the app again.
  function done() {
    setJson(KEYS.phoneSetupDoneAt, Date.now());
    router.back();
  }

  return (
    <View style={styles.page}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={{ padding: 16, paddingTop: insets.top + 18, paddingBottom: insets.bottom + 28, gap: 14 }}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={() => router.back()} style={styles.back}>
            <ChevronLeft size={28} color={colors.ink} strokeWidth={2.6} />
          </Pressable>
          <View style={{ flex: 1, gap: 4 }}>
            <Txt variant="title" size={28}>{t('phoneSetup.title')}</Txt>
            <Txt variant="muted">{name ? t('phoneSetup.yourBrand', { brand: name }) : t('phoneSetup.yourPhone')}</Txt>
          </View>
        </View>

        {note && (
          <View style={styles.stopped} testID="phone-setup-stopped">
            <BatteryCharging size={22} color={colors.amberText} />
            <Txt variant="strong" size={16} color={colors.amberText} style={{ flex: 1 }}>{stoppedText(note)}</Txt>
          </View>
        )}

        <Card style={{ gap: 12 }}>
          <PhoneSetupSteps />
        </Card>

        <Button kind="outline" label={t('phoneSetup.done')} onPress={done} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  back: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  stopped: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderRadius: 14, padding: 14, backgroundColor: '#fdf1d6' },
});
