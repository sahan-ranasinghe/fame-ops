// Office mode (Phase 8, O2, item 7): Add a driver (from People → Drivers, with create_driver): the name, the employee code,
// the mobile (needed), the username and a 6-digit PIN typed or generated → create_driver. After it: the username and the
// PIN shown once, big, with "Tell <name> by phone"; Done goes back to the list. The PIN is never logged. The rules
// (the username rule, the PIN, what create_driver takes): office/peopleLogic.ts.

import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useLeaveGuard } from '@/components/navigation';
import { Button, Field, Mono, Notice, Txt } from '@/components/ui';
import { firstName } from '@/lib/format';
import { type DriverFields, type DriverProblem, emptyDriver, randomPin, validateNewDriver } from '@/office/peopleLogic';
import { useOffice } from '@/office/state';
import type { FleetError } from '@/office/types';
import { BackHeader, ErrorNotice, Screen, StickyActions } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

export default function DriverNew() {
  const { t } = useApp();
  const { api, signOut } = useOffice();
  const router = useRouter();
  const [f, setF] = useState<DriverFields>(emptyDriver);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<DriverProblem | null>(null);
  const [error, setError] = useState<FleetError | null>(null);
  const [done, setDone] = useState<{ name: string; username: string; pin: string } | null>(null);
  const dirty = !done && Object.values(f).some((v) => v.trim() !== '');
  const { allowLeave } = useLeaveGuard(dirty, busy);
  const set = <K extends keyof DriverFields>(k: K, v: string) => setF((x) => ({ ...x, [k]: v }));

  async function submit() {
    const v = validateNewDriver(f);
    if ('error' in v) {
      setProblem(v.error);
      return;
    }
    setProblem(null);
    setError(null);
    setBusy(true);
    try {
      await api.call('create_driver', v.input);
      allowLeave();
      setDone({ name: String(v.input.name), username: String(v.input.username), pin: String(v.input.pin) });
    } catch (e) {
      setError(e as FleetError);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.page }}>
        <BackHeader title={t('office.people.driverAdded')} subtitle={done.name} />
        <Screen>
          <View style={styles.card}>
            <Txt variant="body">{t('office.people.giveThese', { name: done.name })}</Txt>
            <View style={{ gap: 2 }}>
              <Txt variant="small">{t('office.people.usernameLabel')}</Txt>
              <Mono size={24} bold selectable>{done.username}</Mono>
            </View>
            <View style={{ gap: 2 }}>
              <Txt variant="small">{t('office.people.pin')}</Txt>
              <Mono size={34} bold selectable>{done.pin}</Mono>
            </View>
            <Txt variant="strong" size={15} color={colors.amberText}>{t('office.people.pinTell', { name: firstName(done.name) })}</Txt>
          </View>
        </Screen>
        <StickyActions>
          <Button kind="dark" label={t('office.people.done')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/office/people/drivers'))} />
        </StickyActions>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <BackHeader title={t('office.people.newDriver')} subtitle={t('office.people.newDriverHint')} />
      <Screen bottom={16}>
        <Field label={t('office.people.name')} value={f.name} onChangeText={(v) => set('name', v)} maxLength={120} autoFocus editable={!busy} />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Field label={t('office.people.code')} value={f.code} onChangeText={(v) => set('code', v)} maxLength={30} placeholder="E0123" autoCapitalize="characters" editable={!busy} mono />
          <Field label={t('office.people.phone')} value={f.phone} onChangeText={(v) => set('phone', v)} maxLength={30} keyboardType="phone-pad" placeholder="0771234567" editable={!busy} mono />
        </View>
        <View style={{ gap: 6 }}>
          <Field label={t('office.people.usernameLabel')} value={f.username} onChangeText={(v) => set('username', v)} maxLength={40} placeholder="nuwan.p" autoCapitalize="none" autoCorrect={false} editable={!busy} mono />
          <Txt variant="small">{t('office.people.usernameHint')}</Txt>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10 }}>
          <Field label={t('office.people.pin')} value={f.pin} onChangeText={(v) => set('pin', v.replace(/\D/g, '').slice(0, 6))} maxLength={6} keyboardType="number-pad" editable={!busy} mono style={{ fontSize: 24 }} />
          <Button kind="outline" label={t('office.people.generate')} onPress={() => set('pin', randomPin())} disabled={busy} style={{ minHeight: 56 }} />
        </View>
        <Txt variant="small">{t('office.people.pinOnce')}</Txt>
        {problem && <Notice tone="danger" text={t(`office.people.driverErr.${problem}`)} />}
        {error && <ErrorNotice error={error} onRetry={() => void submit()} onSignIn={() => void signOut()} />}
      </Screen>
      <StickyActions>
        <Button kind="primary" label={t('office.people.create')} onPress={() => void submit()} busy={busy} />
      </StickyActions>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderColor: colors.amber, borderWidth: 1.5, borderRadius: 18, padding: 18, gap: 14 },
});
