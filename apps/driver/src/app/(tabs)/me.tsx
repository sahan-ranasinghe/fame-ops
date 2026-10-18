// Me tab: the driver's profile (Part 3b, G): the photo with Change photo, name, employee code; the profile card (phone,
// WhatsApp when it is not the phone, the emergency contact, the driving licence: number, expiry with an amber note
// within 30 days and red within 7 or past, the front and back photos) with Edit (app/profile-edit.tsx, pushed); the
// language; the current vehicle; this month (my completed tasks and their km, kept on the phone for offline); Call office
// and Call fleet admin with WhatsApp (Hotfix 2, F); what is still waiting to be sent; app version, live updates and the
// update check; then the rows Availability (app/availability.tsx, H1), Phone setup (Phase 7 item 7: the brand's battery
// and auto-start steps, amber when the phone stopped the app lately), Documents (the held vehicle's, §28) and
// Permissions; Sign out (not while a task is in progress, nor on duty: Finish work first).

import Constants from 'expo-constants';
import { useFocusEffect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { BatteryCharging, CalendarX, Camera, ChevronRight, FileText, type LucideIcon, LogOut, Pencil, RefreshCw, ShieldCheck, Wifi } from '@/components/icons';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CallButtons } from '@/components/CallButtons';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { useStoppedNote } from '@/components/PhoneSetup';
import { Thumb, useLicencePhotos, useMyPhoto } from '@/components/Photos';
import { useDateLabel } from '@/components/task';
import { Button, Card, Mono, Notice, Plate, Txt } from '@/components/ui';
import { fetchMonthTasks } from '@/lib/api';
import { availLine, type UnavailabilityRow, upcomingEntries } from '@/lib/availability';
import { officeCalls, phoneDisplay } from '@/lib/contacts';
import { thousands } from '@/lib/format';
import { getJson, KEYS, setJson } from '@/lib/kv';
import { dateLabel as longDate, expiryLine } from '@/lib/photoRules';
import { monthTotals } from '@/lib/profile';
import { supabase } from '@/lib/supabase';
import { colomboDate, colomboTime, startOfColomboMonth } from '@/lib/time';
import { runningUpdate } from '@/lib/updates';
import { megabytes } from '@/lib/video';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

const TONE = { ok: colors.ink, amber: colors.amberText, red: colors.red, none: colors.muted } as const;

/** This month's completed tasks and km (read when Me opens; the last copy shows offline). */
function useMonthTotals(meId: string | null): { tasks: number; km: number } | null {
  const month = colomboDate().slice(0, 7);
  const [totals, setTotals] = useState<{ month: string; tasks: number; km: number } | null>(() => {
    const kept = getJson<{ month: string; tasks: number; km: number }>(KEYS.monthTotals);
    return kept && kept.month === month ? kept : null;
  });
  useFocusEffect(useCallback(() => {
    if (!meId) return;
    let live = true;
    void fetchMonthTasks(supabase, meId, startOfColomboMonth())
      .then((rows) => {
        if (!live) return;
        const next = { month, ...monthTotals(rows) };
        setJson(KEYS.monthTotals, next);
        setTotals(next);
      })
      .catch(() => undefined); // no connection: the copy kept
    return () => {
      live = false;
    };
  }, [meId, month]));
  return totals && totals.month === month ? totals : null;
}

export default function MeScreen() {
  const app = useApp();
  const { t, tList, me, vehicle, queue, live, sharing } = app;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [updateNote, setUpdateNote] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const dateLabel = useDateLabel();
  const update = runningUpdate();
  const photo = useMyPhoto();
  const licencePhotos = useLicencePhotos();
  const month = useMonthTotals(me?.id ?? null);
  // The phone stopped the app on one of the last 3 days: the Phone setup row is amber (the page says when).
  const stopped = useStoppedNote().note !== null;
  // Who to call at the office (read again when Me opens, at most every 10 minutes; the last copy shows offline).
  const { loadOfficeContacts } = app;
  useFocusEffect(useCallback(() => loadOfficeContacts(), [loadOfficeContacts]));
  const calls = officeCalls(app.officeContacts);
  // The next time I'm not available, as Availability last read it.
  const nextAway = upcomingEntries(getJson<UnavailabilityRow[]>(KEYS.availability) ?? [], Date.now())[0] ?? null;

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

  const edit = () => router.push('/profile-edit');
  const emergency = [me?.emergency_name, me?.emergency_relation].filter(Boolean).join(' · ');
  const licence = me?.licence_expiry ? expiryLine(me.licence_expiry, colomboDate()) : null;
  const hasLicence = !!(me?.licence_no || me?.licence_expiry || me?.licence_front_photo_id || me?.licence_back_photo_id);

  return (
    <View style={styles.page}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={{ padding: 16, paddingTop: insets.top + 18, paddingBottom: 28, gap: 16 }}>
        {/* Phase 7 §5: the driver's photo at the top, Change photo (the same two choices as the first-run step). */}
        <View style={styles.who}>
          <Thumb uri={photo} size={84} round kind="person" />
          <View style={{ flex: 1, gap: 4 }}>
            <Txt variant="title" size={26}>{me?.name}</Txt>
            <View style={styles.code}>
              <Txt variant="muted">{t('me.code')}</Txt>
              <Mono size={17} bold>{me?.code}</Mono>
            </View>
            <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/profile-photo', params: { mode: 'change' } })} style={styles.link}>
              <Camera size={20} color={colors.ink} />
              <Txt variant="strong">{t(me?.photo_id ? 'profilePhoto.change' : 'profilePhoto.title')}</Txt>
            </Pressable>
          </View>
        </View>

        {/* Part 3b (G): the profile, with Edit. */}
        <Card style={{ gap: 14 }}>
          <Txt variant="big">{t('me.profile')}</Txt>
          <Line label={t('me.phone')}>
            {me?.phone
              ? <Mono size={17}>{phoneDisplay(me.phone)}</Mono>
              : <Txt variant="strong" color={colors.amberText}>{t('me.missingPhone')}</Txt>}
          </Line>
          {me?.whatsapp && <Line label={t('me.whatsapp')}><Mono size={17}>{phoneDisplay(me.whatsapp)}</Mono></Line>}
          <View style={styles.block}>
            <Txt variant="muted">{t('me.emergency')}</Txt>
            {emergency || me?.emergency_phone ? (
              <>
                {emergency !== '' && <Txt variant="strong">{emergency}</Txt>}
                {me?.emergency_phone && <Mono size={17}>{phoneDisplay(me.emergency_phone)}</Mono>}
              </>
            ) : (
              <Txt variant="muted" color={colors.amberText}>{t('me.notSet')}</Txt>
            )}
          </View>
          <View style={styles.block}>
            <Txt variant="muted">{t('me.licence')}</Txt>
            {hasLicence ? (
              <>
                {me?.licence_no && <Mono size={17} bold>{me.licence_no}</Mono>}
                {licence && me?.licence_expiry && (
                  <Txt variant="strong" color={TONE[licence.tone]}>{t(licence.key, { date: longDate(me.licence_expiry, tList('months')) })}</Txt>
                )}
                {(me?.licence_front_photo_id || me?.licence_back_photo_id) && (
                  <View style={styles.licencePhotos}>
                    {(['front', 'back'] as const).map((side) => (
                      <View key={side} style={{ gap: 4 }}>
                        <Thumb uri={licencePhotos[side]} size={96} kind="card" />
                        <Txt variant="small">{t(side === 'front' ? 'profile.licenceFront' : 'profile.licenceBack')}</Txt>
                      </View>
                    ))}
                  </View>
                )}
              </>
            ) : (
              <Txt variant="muted" color={colors.amberText}>{t('me.notSet')}</Txt>
            )}
          </View>
          <Button kind="outline" icon={Pencil} label={t('me.edit')} onPress={edit} />
        </Card>

        <Card style={{ gap: 12 }}>
          <Txt variant="big">{t('me.language')}</Txt>
          <LanguageSwitch />
        </Card>

        <Card style={{ gap: 14 }}>
          <Line label={t('me.vehicle')}>
            {vehicle ? <Plate regNo={vehicle.reg_no} /> : <Txt variant="muted">{t(sharing ? 'duty.noVehicle' : 'duty.offDuty')}</Txt>}
          </Line>
          {/* The vehicle changes only while on duty; off duty, Start work on Today picks it. */}
          {sharing && <Button kind="outline" label={t('vehicle.change')} onPress={() => router.push({ pathname: '/vehicle', params: { mode: 'change' } })} />}
          <Line label={t('me.thisMonth')}>
            {month
              ? <Txt variant="strong">{t('me.monthLine', { tasks: month.tasks, km: thousands(month.km) })}</Txt>
              : <Txt variant="muted">–</Txt>}
          </Line>
        </Card>

        {calls.length > 0 && <CallButtons calls={calls} />}

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

        {/* Part 3b (H1): when I can't take trips (pushed; back returns here). */}
        <Row
          icon={CalendarX}
          title={t('me.availability')}
          hint={nextAway ? availLine(t, dateLabel, nextAway) : t('avail.none')}
          onPress={() => router.push('/availability')}
          testID="me-availability"
        />

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

        {/* Phase 7 §28: the held vehicle's revenue licence, insurance and emission test, for roadside checks. */}
        <Row icon={FileText} title={t('docs.title')} hint={vehicle ? t('docs.open', { plate: vehicle.reg_no }) : null} onPress={() => router.push('/documents')} />

        <Row icon={ShieldCheck} title={t('me.permissions')} onPress={() => router.push('/permissions')} />

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

/** A row that opens a page pushed over Me (back returns here). */
function Row({ icon: Icon, title, hint, onPress, testID }: { icon: LucideIcon; title: string; hint?: string | null; onPress: () => void; testID?: string }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} testID={testID}>
      <Card style={styles.row}>
        <Icon size={24} color={colors.ink} />
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="big">{title}</Txt>
          {hint ? <Txt variant="muted">{hint}</Txt> : null}
        </View>
        <ChevronRight size={24} color={colors.muted} />
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  block: { gap: 4 },
  who: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  code: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 64 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, alignSelf: 'flex-start' },
  licencePhotos: { flexDirection: 'row', gap: 12, marginTop: 4 },
  toggle: { width: 52, height: 30, borderRadius: 15, backgroundColor: '#c9c5bb', padding: 3, justifyContent: 'center' },
  knob: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.card },
});
