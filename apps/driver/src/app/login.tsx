// Sign in: language, username, 6-digit PIN. Drivers never see an email address.

import Constants from 'expo-constants';
import { Redirect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LanguageSwitch } from '@/components/LanguageSwitch';
import { Button, Card, Field, Notice, Txt } from '@/components/ui';
import { type SignInOutcome, useApp } from '@/state/app';
import { colors, fonts } from '@/theme';

const PROBLEM: Record<Exclude<SignInOutcome, 'ok'>, string> = {
  wrong: 'login.wrong',
  network: 'login.network',
  switched_off: 'login.switchedOff',
  not_configured: 'login.notConfigured',
};

export default function LoginScreen() {
  const { me, t, signIn } = useApp();
  const insets = useSafeAreaInsets();
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (me) return <Redirect href="/" />;

  const ready = username.trim().length >= 3 && pin.length === 6;

  async function submit() {
    if (!ready || busy) return;
    setBusy(true);
    setProblem(null);
    const outcome = await signIn(username, pin);
    if (outcome !== 'ok') {
      setProblem(PROBLEM[outcome]);
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.page}>
      <StatusBar style="light" />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1 }}>
        <View style={[styles.header, { paddingTop: insets.top + 36 }]}>
          <Txt variant="title" color="#ffffff" style={{ fontFamily: fonts.heading }}>{Constants.expoConfig?.name}</Txt>
          <View style={{ marginTop: 22 }}>
            <LanguageSwitch onDark />
          </View>
        </View>

        <View style={{ padding: 16, gap: 16 }}>
          <Card style={{ gap: 18 }}>
            <Txt variant="heading">{t('login.title')}</Txt>
            <Field
              label={t('login.username')}
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username"
              returnKeyType="next"
              style={{ fontFamily: fonts.mono }}
            />
            <Field
              label={t('login.pin')}
              mono
              value={pin}
              onChangeText={(text) => setPin(text.replace(/\D/g, '').slice(0, 6))}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={6}
              returnKeyType="done"
              onSubmitEditing={submit}
              style={{ fontSize: 24, letterSpacing: 6 }}
            />
            {problem && <Notice tone="danger" text={t(problem)} />}
            <Button label={t('login.signIn')} onPress={submit} disabled={!ready} busy={busy} />
          </Card>
          <Txt variant="muted" style={{ textAlign: 'center', paddingHorizontal: 12 }}>{t('login.help')}</Txt>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  header: { backgroundColor: colors.ink, paddingHorizontal: 20, paddingBottom: 26 },
});
