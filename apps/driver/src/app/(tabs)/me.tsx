// Me tab: who is signed in, language, current vehicle, what is still waiting
// to be sent, permissions, app version, sign out.

import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { LogOut, RefreshCw } from '@/components/icons';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LanguageSwitch } from '@/components/LanguageSwitch';
import { Button, Card, Mono, Notice, Plate, Txt } from '@/components/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

export default function MeScreen() {
  const app = useApp();
  const { t, me, vehicle, queue } = app;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const waiting = queue.ops + queue.points;

  async function send(includeFailed: boolean) {
    setBusy(true);
    await app.sendNow(includeFailed);
    setBusy(false);
  }

  function confirmSignOut() {
    setProblem(null);
    Alert.alert(t('me.signOut'), t('me.signOutConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('me.signOut'),
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          const outcome = await app.signOut();
          setBusy(false);
          if (outcome === 'task') setProblem(t('me.signOutTask'));
          if (outcome === 'queue') setProblem(t('me.signOutQueue'));
        },
      },
    ]);
  }

  const taskRunning = app.tasks.some((task) => task.status === 'in_progress');

  return (
    <View style={styles.page}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={{ padding: 16, paddingTop: insets.top + 18, paddingBottom: 28, gap: 16 }}>
        <Txt variant="title">{me?.name}</Txt>

        <Card style={{ gap: 14 }}>
          <Line label={t('me.code')}><Mono size={17} bold>{me?.code}</Mono></Line>
          {me?.phone && <Line label={t('me.phone')}><Mono size={17}>{me.phone}</Mono></Line>}
          <Line label={t('me.vehicle')}>
            {vehicle ? <Plate regNo={vehicle.reg_no} /> : <Txt variant="muted">{t('today.noVehicle')}</Txt>}
          </Line>
          <Button kind="outline" label={t(vehicle ? 'today.change' : 'today.choose')} onPress={() => router.push('/vehicle')} />
        </Card>

        <Card style={{ gap: 12 }}>
          <Txt variant="big">{t('me.language')}</Txt>
          <LanguageSwitch />
        </Card>

        <Card style={{ gap: 12 }}>
          <Txt variant="big" color={waiting > 0 ? colors.amberText : colors.ink}>
            {waiting > 0 ? t('me.waiting', { n: waiting }) : t('me.allSent')}
          </Txt>
          {app.offline && <Txt variant="muted">{t('common.savedOffline')}</Txt>}
          {waiting > 0 && <Button kind="dark" icon={RefreshCw} label={t('me.sendNow')} busy={busy} onPress={() => send(false)} />}
          {queue.failed > 0 && (
            <>
              <Txt variant="strong" color={colors.red}>{t('me.failed', { n: queue.failed })}</Txt>
              <Button kind="outline" label={t('me.tryFailed')} busy={busy} onPress={() => send(true)} />
            </>
          )}
        </Card>

        <Button kind="outline" label={t('me.permissions')} onPress={() => router.push('/permissions')} />

        <Card style={{ gap: 14 }}>
          <Line label={t('me.version')}><Mono size={17}>{Constants.expoConfig?.version}</Mono></Line>
        </Card>

        {problem && <Notice tone="danger" text={problem} />}
        {taskRunning && <Txt variant="muted" style={{ textAlign: 'center' }}>{t('me.signOutTask')}</Txt>}
        <Button kind="outline" icon={LogOut} label={t('me.signOut')} disabled={taskRunning} busy={busy} onPress={confirmSignOut} />
      </ScrollView>
    </View>
  );
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.line}>
      <Txt variant="muted">{label}</Txt>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
});
