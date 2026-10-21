// "Your phone number" (Part 3b, G): a driver whose own row has no phone is asked for it when the app starts, a full
// screen with no skip (the tabs send the driver here, lib/profile.ts needsPhonePrompt: only once the server said so in
// this run, never over a task in progress). Save → driver-api /profile (stored +94…, logged for the office), then the
// app goes on where it would have gone (the photo step, or Today). With no connection the screen says so and Continue
// lets the driver work; it asks again at the next start. Like Login and Permissions it replaces the tabs: back puts the
// app in the background.

import { Redirect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Phone } from '@/components/icons';
import { Button, Card, Field, Notice, Txt } from '@/components/ui';
import { deferPhonePrompt, phoneE164 } from '@/lib/profile';
import { useApp } from '@/state/app';
import { colors } from '@/theme';
import { failedText } from '@/lib/humanReason';

export default function PhonePromptScreen() {
  const app = useApp();
  const { t, me } = app;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // The save found no connection (or the phone knows it has none): the driver may go on and is asked next time.
  const [offline, setOffline] = useState(false);
  const noConnection = offline || app.offline || !app.dataAvailable;
  // A save the server refuses (or an older server without /profile) never traps the driver: Continue, asked again next start.
  const [stuck, setStuck] = useState(false);

  // The step ends as soon as the driver has a number (saved here, or added meanwhile by the office).
  const hasPhone = !!me?.phone;
  useEffect(() => {
    if (hasPhone) router.replace('/');
  }, [hasPhone, router]);

  if (!me) return <Redirect href="/login" />;

  async function save() {
    if (busy) return;
    const e164 = phoneE164(typed);
    if (!e164) {
      setProblem(t('profile.badPhone'));
      return;
    }
    setProblem(null);
    setBusy(true);
    const outcome = await app.saveProfile({ phone: e164 }, {});
    setBusy(false);
    if (outcome.kind === 'network') {
      setOffline(true);
      return;
    }
    if (outcome.kind === 'refused') {
      setProblem(failedText(t, 'profile.failed', outcome.message));
      setStuck(true);
      return;
    }
    // The effect above goes on once the number is on `me`.
  }

  function goOn() {
    deferPhonePrompt();
    router.replace('/');
  }

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.page}>
      <StatusBar style="dark" />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingTop: insets.top + 28, paddingBottom: 24, gap: 16 }}>
        <View style={styles.icon}>
          <Phone size={36} color={colors.ink} />
        </View>
        <Txt variant="title" size={30}>{t('phonePrompt.title')}</Txt>
        <Txt variant="muted" size={17}>{t('phonePrompt.body')}</Txt>
        <Card style={{ gap: 14 }}>
          <Field
            label={t('phonePrompt.label')}
            value={typed}
            onChangeText={(text) => {
              setTyped(text);
              setProblem(null);
            }}
            keyboardType="phone-pad"
            autoComplete="tel"
            autoFocus
            maxLength={20}
            mono
            style={{ fontSize: 24 }}
          />
          {problem && <Notice tone="danger" text={problem} />}
        </Card>
        {noConnection && <Notice tone="warn" text={t('phonePrompt.offline')} />}
      </ScrollView>

      <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: insets.bottom + 16, gap: 10 }}>
        <Button label={t('phonePrompt.save')} busy={busy} disabled={typed.trim() === ''} onPress={() => void save()} />
        {(noConnection || stuck) && <Button kind="outline" label={t('phonePrompt.continue')} disabled={busy} onPress={goOn} />}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  icon: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.amber, alignItems: 'center', justifyContent: 'center' },
});
