// Office mode and /m/ (Round 4–7, feature 4; phase8-plan.md §33.1): the vehicle checks as the office reads them (Samsara /
// Motive's DVIR list: each vehicle's latest inspection, then its history). A vehicle's page: Today's check (list_vehicles'
// check_today: All good / Problem: Damage, at 07:42 by Kamal; "No check today") and the last 7 days (vehicle_checks: by
// day; each check's time, result, person, odometer and how; a problem's note; its photos as thumbnails, each opening its
// 1-hour link; a problem opens its report with list_vehicle_reports). A notification's check (?check=<id>) is marked. A
// task: its check lines ("Vehicle check 07:42 · All good" / "· Problem: Damage", with the photos). Every word through i18n
// (the server's English result words are read back: office/myTripLogic.ts resultText).

import type { ReactNode } from 'react';
import { useRouter } from 'expo-router';
import { Image, Linking, Pressable, StyleSheet, View } from 'react-native';

import { ListEmpty, SkeletonRows } from '@/components/patterns/ListState';
import { Mono, Txt } from '@/components/ui';
import { dateWords } from '@/lib/dateWords';
import { colomboDate } from '@/lib/time';
import { byDay, howKey, kmText, lastWeekArgs, resultText } from '@/office/myTripLogic';
import { useOffice, useTool } from '@/office/state';
import { useSwitch } from '@/office/switches';
import type { CheckToday, VehicleCheck, VehicleChecks } from '@/office/types';
import { ListFailed, Section, StatusChip } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors, hoverStyle } from '@/theme';

const open = (url: string) => void Linking.openURL(url).catch(() => undefined);

/** A check's photos as small thumbnails, each opening large (its 1-hour link). */
export function CheckPhotos({ photos }: { photos?: VehicleCheck['photos'] }) {
  const { t } = useApp();
  if (!photos?.length) return null;
  return (
    <View style={styles.photos} testID="check-photos">
      {photos.map((p, n) => {
        const label = p.side ? t(`office.checks.side.${p.side}`) : t('office.checks.photoN', { n: n + 1 });
        return (
          <Pressable key={p.url} accessibilityRole="imagebutton" accessibilityLabel={label} onPress={() => open(p.url)} style={(state) => [hoverStyle(state), state.pressed && { opacity: 0.7 }]}>
            <Image source={{ uri: p.url }} style={styles.thumb} accessibilityLabel={label} />
          </Pressable>
        );
      })}
    </View>
  );
}

/** Today's check of a vehicle in one line (list_vehicles' check_today), or "No check today". */
export function CheckTodayLine({ check }: { check?: CheckToday }) {
  const { t } = useApp();
  if (!check) return <Txt variant="muted" testID="check-today">{t('office.checks.noneToday')}</Txt>;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }} testID="check-today">
      <StatusChip text={resultText(t, check)} tone={check.result === 'problem' ? 'red' : 'green'} />
      <Txt variant="muted" size={15}>{check.by ? t('office.checks.atBy', { time: check.at, name: check.by }) : t('office.checks.at', { time: check.at })}</Txt>
    </View>
  );
}

/** One check: the time, the result, who, the odometer and how; a problem's note; the photos. A problem opens its report. */
function CheckItem({ c, focused }: { c: VehicleCheck; focused: boolean }) {
  const { t } = useApp();
  const { me } = useOffice();
  const router = useRouter();
  const report = c.report && me.tools.includes('list_vehicle_reports') ? c.report.id : null;
  const body = (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Mono size={15} bold>{c.at}</Mono>
        <StatusChip text={resultText(t, c)} tone={c.result === 'problem' ? 'red' : 'green'} />
        <Txt variant="strong" size={15} style={{ flex: 1 }} numberOfLines={1}>{c.person ?? ''}</Txt>
      </View>
      <Txt variant="small">{[c.odometer_km != null ? t('office.trip.kmN', { km: kmText(c.odometer_km) }) : '', t(howKey(c.how)), c.task?.title ?? ''].filter(Boolean).join(' · ')}</Txt>
      {c.report?.note ? <Txt variant="muted" size={15}>{t('office.checks.note', { note: c.report.note })}</Txt> : null}
      <CheckPhotos photos={c.photos} />
      {report ? <Txt variant="strong" size={15} color={colors.blue}>{t('office.checks.openReport')}</Txt> : null}
    </>
  );
  const style = [styles.item, focused && styles.focused];
  return (
    <Pressable
      accessibilityRole={report ? 'button' : 'text'}
      accessibilityState={{ selected: focused }}
      disabled={!report}
      onPress={report ? () => router.push({ pathname: '/office/maintenance/[id]', params: { id: report } }) : undefined}
      style={(state) => [...style, report ? hoverStyle(state) : null, state.pressed && { opacity: 0.8 }]}
      testID={focused ? 'check-focused' : 'check-row'}
    >
      {body}
    </Pressable>
  );
}

/** A vehicle's checks: Today's check, then the last 7 days by day; `focus` = a check to mark (a notification's ?check=). */
export function VehicleChecksSection({ plate, today: checkToday, focus }: { plate: string; today?: CheckToday; focus?: string }) {
  const { t } = useApp();
  const { me, signOut } = useOffice();
  // The switch vehicle_check off: no section (§33.13: a feature switched off hides its part).
  const on = useSwitch('vehicle_check');
  const allowed = on && me.tools.includes('vehicle_checks');
  const q = useTool<VehicleChecks>('vehicle_checks', lastWeekArgs(plate, colomboDate()), { enabled: allowed });
  const days = q.data ? byDay(q.data.checks) : [];
  if (!on) return null;
  return (
    <Section title={t('office.checks.title')}>
      <View style={{ gap: 6, paddingVertical: 6 }}>
        <Txt variant="label" color={colors.muted}>{t('office.checks.today').toUpperCase()}</Txt>
        <CheckTodayLine check={checkToday} />
      </View>
      {allowed && (
        <View style={{ gap: 8, paddingTop: 8 }}>
          <Txt variant="label" color={colors.muted}>{t('office.checks.lastWeek').toUpperCase()}</Txt>
          {!q.data && !q.error && <SkeletonRows rows={2} lines={2} />}
          {q.error && <ListFailed stale={!!q.data} error={q.error} onRetry={() => void q.reload()} onSignIn={() => void signOut()} />}
          {q.data && days.length === 0 && <ListEmpty text={t('office.checks.noneWeek')} />}
          {days.map((d) => (
            <View key={d.date} style={{ gap: 6 }}>
              <Txt variant="strong" size={15}>{dateWords(t, d.date)}</Txt>
              {d.checks.map((c) => <CheckItem key={c.id} c={c} focused={c.id === focus} />)}
            </View>
          ))}
        </View>
      )}
    </Section>
  );
}

/** A task's checks: "Vehicle check 07:42 · All good" / "· Problem: Damage", the odometer, the note and the photos. */
export function TaskCheckLines({ checks, extra }: { checks?: VehicleCheck[]; /** Round 52: under each check (its "Delete…"). */ extra?: (check: VehicleCheck) => ReactNode }) {
  const { t } = useApp();
  const on = useSwitch('vehicle_check');
  if (!on || !checks?.length) return null;
  return (
    <View style={{ gap: 8 }} testID="task-checks">
      {checks.map((c) => (
        <View key={c.id} style={{ gap: 4 }} testID="task-check">
          <Txt variant="strong" size={15} color={c.result === 'problem' ? colors.red : colors.ink}>
            {[t('office.checks.taskLine', { time: c.at, result: resultText(t, c) }), c.odometer_km != null ? t('office.trip.kmN', { km: kmText(c.odometer_km) }) : ''].filter(Boolean).join(' · ')}
          </Txt>
          {c.report?.note ? <Txt variant="muted" size={15}>{t('office.checks.note', { note: c.report.note })}</Txt> : null}
          <CheckPhotos photos={c.photos} />
          {extra ? extra(c) : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  thumb: { width: 64, height: 48, borderRadius: 8, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.mapLand },
  item: { gap: 4, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card },
  focused: { borderWidth: 2, borderColor: colors.blue, backgroundColor: colors.blueChip },
});
