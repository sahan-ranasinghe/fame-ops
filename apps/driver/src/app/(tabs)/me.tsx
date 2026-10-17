// Me tab: who is signed in (with their photo and Change photo), language,
// current vehicle and its documents, what is still waiting to be sent,
// permissions, Phone setup (Phase 7 item 7: the brand's battery and auto-start
// steps on their own page, amber when the phone stopped the app lately), app
// version, sign out (not while on duty: Finish work first, Phase 7).

import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { BatteryCharging, Camera, ChevronRight, FileText, LogOut, RefreshCw, Wifi } from '@/components/icons';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LanguageSwitch } from '@/components/LanguageSwitch';
import { useStoppedNote } from '@/components/PhoneSetup';
import { Thumb, useMyPhoto } from '@/components/Photos';
import { useDateLabel } from '@/components/task';
import { Button, Card, Mono, Notice, Plate, Txt } from '@/components/ui';
import { colomboTime } from '@/lib/time';
import { runningUpdate } from '@/lib/updates';
import { megabytes } from '@/lib/video';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

export default function MeScreen() {
  const app = useApp();
  const { t, me, vehicle, queue, live, sharing } = app;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [updateNote, setUpdateNote] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const dateLabel = useDateLabel();
  const update = runningUpdate();
  const photo = useMyPhoto();
  // The phone stopped the app on one of the last 3 days: the Phone setup row is amber (the page says when).
  const stopped = useStoppedNote().note !== null;

  async function checkUpdate() {
    setChecking(true);
    setUpdateNote(null);
    const outcome = await app.checkUpdate();
    setChecking(false);
    setUpdateNote(t(outcome === 'failed' ? 'me.updateFailed' : outcome === 'downloaded' ? 'me.updateDownloaded' : 'me.upToDate'));
  }

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
          if (outcome === 'duty') setProblem(t('me.finishWorkFirst'));
          if (outcome === 'queue') setProblem(t('me.signOutQueue'));
        },
      },
    ]);
  }

  const taskRunning = app.tasks.some((task) => task.status === 'in_progress');
  // Sign out waits for the task to be finished, then for Finish work.
  const signOutBlocked = taskRunning ? 'me.signOutTask' : sharing ? 'me.finishWorkFirst' : null;

  return (
    <View style={styles.page}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={{ padding: 16, paddingTop: insets.top + 18, paddingBottom: 28, gap: 16 }}>
        {/* Phase 7 §5: the driver's photo at the top, Change photo (the same two choices as the first-run step). */}
        <View style={styles.who}>
          <Thumb uri={photo} size={84} round kind="person" />
          <View style={{ flex: 1, gap: 8 }}>
            <Txt variant="title" size={26}>{me?.name}</Txt>
            <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/profile-photo', params: { mode: 'change' } })} style={styles.link}>
              <Camera size={20} color={colors.ink} />
              <Txt variant="strong">{t(me?.photo_id ? 'profilePhoto.change' : 'profilePhoto.title')}</Txt>
            </Pressable>
          </View>
        </View>

        <Card style={{ gap: 14 }}>
          <Line label={t('me.code')}><Mono size={17} bold>{me?.code}</Mono></Line>
          {me?.phone && <Line label={t('me.phone')}><Mono size={17}>{me.phone}</Mono></Line>}
          <Line label={t('me.vehicle')}>
            {vehicle ? <Plate regNo={vehicle.reg_no} /> : <Txt variant="muted">{t(sharing ? 'duty.noVehicle' : 'duty.offDuty')}</Txt>}
          </Line>
          {/* The vehicle changes only while on duty; off duty, Start work on Today picks it. */}
          {sharing && <Button kind="outline" label={t('vehicle.change')} onPress={() => router.push({ pathname: '/vehicle', params: { mode: 'change' } })} />}
          {/* Phase 7 §28: the held vehicle's revenue licence, insurance and emission test, for roadside checks. */}
          <Button kind="outline" icon={FileText} label={t('docs.title')} onPress={() => router.push('/documents')} />
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

        <Card style={{ gap: 12 }}>
          <Pressable accessibilityRole="switch" accessibilityState={{ checked: app.wifiOnly }} onPress={() => app.setWifiOnly(!app.wifiOnly)} style={styles.line}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
              <Wifi size={22} color={colors.ink} />
              <Txt variant="strong" style={{ flex: 1 }}>{t('me.wifiOnly')}</Txt>
            </View>
            <View style={[styles.toggle, app.wifiOnly && { backgroundColor: colors.blue }]}>
              <View style={[styles.knob, app.wifiOnly && { alignSelf: 'flex-end' }]} />
            </View>
          </Pressable>
          {queue.videos > 0 && <Txt variant="muted">{`${queue.videos} · ${megabytes(queue.videoBytes)}`}</Txt>}
        </Card>

        <Button kind="outline" label={t('me.permissions')} onPress={() => router.push('/permissions')} />

        {/* Phase 7 item 7: the brand's steps moved here from Today; a pushed page, back returns to Me. */}
        <Pressable accessibilityRole="button" onPress={() => router.push('/phone-setup')} testID="me-phone-setup">
          <Card style={[styles.row, stopped && { backgroundColor: '#fdf1d6' }]}>
            <BatteryCharging size={24} color={stopped ? colors.amberText : colors.ink} />
            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="big" color={stopped ? colors.amberText : colors.ink}>{t('phoneSetup.title')}</Txt>
              <Txt variant="muted">{t('phoneSetup.meHint')}</Txt>
            </View>
            <ChevronRight size={24} color={colors.muted} />
          </Card>
        </Pressable>

        <Card style={{ gap: 14 }}>
          <Line label={t('me.version')}><Mono size={17}>{Constants.expoConfig?.version}</Mono></Line>
          <Line label={t('me.live')}>
            <Txt variant="strong" color={live === 'connected' ? colors.blue : live === 'connecting' ? colors.amberText : colors.red}>
              {t(live === 'connected' ? 'me.liveOn' : live === 'connecting' ? 'me.liveConnecting' : 'me.liveOff')}
            </Txt>
          </Line>
          {update && (
            <>
              {update.publishedAt && (
                <Line label={t('me.update')}>
                  <Mono size={15}>{`${dateLabel(update.publishedAt)} ${colomboTime(update.publishedAt)}`}</Mono>
                </Line>
              )}
              <Button kind="outline" label={t('me.checkUpdate')} busy={checking} onPress={checkUpdate} />
              {updateNote && <Txt variant="muted">{updateNote}</Txt>}
            </>
          )}
        </Card>

        {problem && <Notice tone="danger" text={problem} />}
        {signOutBlocked && <Txt variant="muted" style={{ textAlign: 'center' }}>{t(signOutBlocked)}</Txt>}
        <Button kind="outline" icon={LogOut} label={t('me.signOut')} disabled={signOutBlocked !== null} busy={busy} onPress={confirmSignOut} />
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
  who: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 64 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, alignSelf: 'flex-start' },
  toggle: { width: 52, height: 30, borderRadius: 15, backgroundColor: '#c9c5bb', padding: 3, justifyContent: 'center' },
  knob: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.card },
});
