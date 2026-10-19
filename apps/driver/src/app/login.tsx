// Sign in (design/office 01): Driver (username, 6-digit PIN, as always) or Office (work e-mail and password through
// Supabase Auth, the same account as the site; Phase 8, O1). Drivers never see an e-mail address on their side. The session
// decides the interface: a driver's account opens the driver app, an office account Office mode (office/auth.ts).

import Constants from 'expo-constants';
import { Redirect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Eye, EyeOff } from '@/components/icons';
import { LanguagePill } from '@/components/LanguageSwitch';
import { PRIVACY_URL } from '@/config';
import { Button, Card, Field, Notice, Txt } from '@/components/ui';
import { getJson } from '@/lib/kv';
import { type OfficeSignInOutcome, signInOffice, signOutOffice } from '@/office/auth';
import { OFFICE_KEYS, useOfficeMe } from '@/office/store';
import { type SignInOutcome, useApp } from '@/state/app';
import { colors, fonts } from '@/theme';

const PROBLEM: Record<Exclude<SignInOutcome, 'ok'>, string> = {
  wrong: 'login.wrong',
  network: 'login.network',
  switched_off: 'login.switchedOff',
  not_configured: 'login.notConfigured',
};

const OFFICE_PROBLEM: Record<Exclude<OfficeSignInOutcome, 'ok'>, string> = {
  wrong: 'office.login.wrong',
  network: 'login.network',
  no_office_role: 'office.login.noOfficeRole',
  switched_off: 'login.switchedOff',
  mfa_required: 'office.login.mfaRequired',
  not_configured: 'login.notConfigured',
};

type Side = 'driver' | 'office';

export default function LoginScreen() {
  const { me, t, signIn } = useApp();
  const officeMe = useOfficeMe();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [side, setSide] = useState<Side>(() => (getJson<string>(OFFICE_KEYS.email) ? 'office' : 'driver'));
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [email, setEmail] = useState(() => getJson<string>(OFFICE_KEYS.email) ?? '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (me) return <Redirect href="/" />;
  if (officeMe) return <Redirect href="/office" />;

  const ready = side === 'driver' ? username.trim().length >= 3 && pin.length === 6 : /\S+@\S+\.\S+/.test(email.trim()) && password.length >= 6;

  async function submit() {
    if (!ready || busy) return;
    setBusy(true);
    setProblem(null);
    if (side === 'driver') {
      // One person per phone: an office sign-in on this phone goes first.
      if (officeMe) await signOutOffice();
      const outcome = await signIn(username, pin);
      if (outcome !== 'ok') {
        setProblem(PROBLEM[outcome]);
        setBusy(false);
      }
      return;
    }
    const outcome = await signInOffice(email, password);
    if (outcome === 'ok') {
      router.replace('/office');
      return;
    }
    setProblem(OFFICE_PROBLEM[outcome]);
    setBusy(false);
  }

  function pick(next: Side) {
    if (busy) return;
    setSide(next);
    setProblem(null);
  }

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.page}>
      <StatusBar style="light" />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1 }}>
        <View style={[styles.header, { paddingTop: insets.top + 24 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={styles.logo}><Txt variant="heading" size={20} style={{ fontFamily: fonts.heading }}>FF</Txt></View>
            <View style={{ flex: 1 }}>
              <Txt variant="strong" color="#ffffff" size={18}>{Constants.expoConfig?.name}</Txt>
              <Txt variant="muted" color="#c9ccd1" size={15}>{t('office.login.company')}</Txt>
            </View>
            <LanguagePill />
          </View>
          <Txt variant="title" color="#ffffff" style={{ marginTop: 18, fontFamily: fonts.heading }}>{t('login.title')}</Txt>
          {/* Driver | Office (design 01). */}
          <View style={styles.switch} accessibilityRole="tablist">
            {(['driver', 'office'] as const).map((s) => {
              const on = s === side;
              return (
                <Pressable key={s} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => pick(s)} style={[styles.side, on && { backgroundColor: colors.amber }]}>
                  <Txt variant="button" size={18} color={on ? colors.ink : '#c9ccd1'}>{t(s === 'driver' ? 'office.login.driver' : 'office.login.office')}</Txt>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={{ padding: 16, gap: 16 }}>
          {side === 'driver' ? (
            <Card style={{ gap: 18 }}>
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
          ) : (
            <Card style={{ gap: 18 }}>
              <Field
                label={t('office.login.email')}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                keyboardType="email-address"
                returnKeyType="next"
              />
              <View>
                <Field
                  label={t('office.login.password')}
                  value={password}
                  onChangeText={setPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="password"
                  secureTextEntry={!showPassword}
                  returnKeyType="done"
                  onSubmitEditing={submit}
                  style={{ paddingRight: 56 }}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t(showPassword ? 'office.login.hidePassword' : 'office.login.showPassword')}
                  onPress={() => setShowPassword((v) => !v)}
                  style={styles.eye}
                >
                  {showPassword ? <EyeOff size={22} color={colors.muted} /> : <Eye size={22} color={colors.muted} />}
                </Pressable>
              </View>
              <Pressable accessibilityRole="button" onPress={() => Alert.alert(t('office.login.forgotTitle'), t('office.login.forgotBody'))} style={{ alignSelf: 'flex-end', minHeight: 44, justifyContent: 'center' }}>
                <Txt variant="strong" size={16} color={colors.blue}>{t('office.login.forgot')}</Txt>
              </Pressable>
              {problem && <Notice tone="danger" text={t(problem)} />}
              <Button label={t('login.signIn')} onPress={submit} disabled={!ready} busy={busy} />
            </Card>
          )}
          <Txt variant="muted" style={{ textAlign: 'center', paddingHorizontal: 12 }}>{t(side === 'driver' ? 'login.help' : 'office.login.help')}</Txt>
          {/* Part 6: the app's name and version, and the privacy policy (design/office 01 Sign in). */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4, paddingTop: 8 }}>
            <Txt variant="muted" size={15}>{t('login.version', { version: Constants.expoConfig?.version ?? '' })}</Txt>
            <Txt variant="muted" size={15} accessibilityRole="link" style={{ textDecorationLine: 'underline', minHeight: 48 }} onPress={() => void Linking.openURL(PRIVACY_URL)}>
              {t('common.privacy')}
            </Txt>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  header: { backgroundColor: colors.ink, paddingHorizontal: 20, paddingBottom: 26 },
  logo: { width: 48, height: 48, borderRadius: 12, backgroundColor: colors.amber, alignItems: 'center', justifyContent: 'center' },
  switch: { flexDirection: 'row', marginTop: 18, backgroundColor: colors.darkSurface, borderRadius: 16, padding: 4 },
  side: { flex: 1, minHeight: 52, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  eye: { position: 'absolute', right: 6, bottom: 4, width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
});
