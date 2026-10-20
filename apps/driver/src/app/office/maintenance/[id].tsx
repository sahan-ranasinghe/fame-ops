// Office mode (Stage 1, O3 row 6): one vehicle problem report (from Maintenance). What the driver reported (the problem,
// the plate, who and when, the note, the photos: each opens its 1-hour link), Open task (with assign_tasks) and Call the
// driver; then the update for someone with update_vehicle_report: the status (Open, In garage, Closed), a note the driver
// reads, and "Also take <plate> off the road" (update_vehicle in_garage). Save sticky at the bottom, disabled with its
// reason. The report is found in list_vehicle_reports (the tool has no id of its own). The rules:
// office/maintenanceLogic.ts.

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Image, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Phone } from '@/components/icons';
import { ListEmpty, SkeletonRows } from '@/components/patterns/ListState';
import { Button, Field, Plate, Txt } from '@/components/ui';
import { canTakeOffRoad, categoryKey, REPORT_STATUSES, reportSaveCalls, reportTone } from '@/office/maintenanceLogic';
import { has } from '@/office/nav';
import { useOffice, useTool } from '@/office/state';
import type { FleetError, VehicleReport, VehicleReports } from '@/office/types';
import { BackHeader, ErrorNotice, ListFailed, Pill, Screen, Section, StickyActions } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

const open = (url: string) => void Linking.openURL(url).catch(() => undefined);

export default function ReportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useApp();
  const { api, me, signOut } = useOffice();
  const router = useRouter();
  const q = useTool<VehicleReports>('list_vehicle_reports', { status: 'all', limit: 200 });
  const r = q.data?.reports.find((x) => x.id === id) ?? null;
  const canEdit = me.tools.includes('update_vehicle_report');
  const [status, setStatus] = useState<VehicleReport['status'] | null>(null);
  const [note, setNote] = useState('');
  const [offRoad, setOffRoad] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FleetError | null>(null);
  const [saved, setSaved] = useState(false);
  const shownStatus = status ?? r?.status ?? 'open';
  const calls = r ? reportSaveCalls(r, { status: shownStatus, note, offRoad }, me.tools) : [];

  async function save() {
    if (!r || busy || calls.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      for (const c of calls) await api.call(c.tool, c.input);
      setSaved(true);
      setNote('');
      setOffRoad(false);
      setStatus(null);
      void q.reload();
    } catch (e) {
      setError(e as FleetError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <BackHeader title={r ? t(categoryKey(r.category)) : t('office.maint.report')} subtitle={r ? [r.vehicle, r.reported].filter(Boolean).join(' · ') : undefined} />
      <Screen refreshing={q.refreshing} onRefresh={() => void q.reload()} bottom={canEdit ? 140 : 24}>
        {!q.data && !q.error && <SkeletonRows rows={3} lines={2} />}
        {q.error && <ListFailed stale={!!q.data} error={q.error} onRetry={() => void q.reload()} onSignIn={() => void signOut()} />}
        {q.data && !r && <ListEmpty text={t('office.maint.notFound')} />}
        {r && (
          <>
            <View style={styles.card}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {r.vehicle ? <Plate regNo={r.vehicle} /> : null}
                <Pill text={t(`office.maint.status_${r.status}`)} tone={reportTone(r.status)} />
                {r.vehicle_in_garage ? <Pill text={t('office.maint.inGarageNow')} tone="amber" /> : null}
              </View>
              <Txt variant="muted" size={15}>{[r.driver, t('office.maint.reportedAt', { at: r.reported })].filter(Boolean).join(' · ')}</Txt>
              {r.note ? <Txt variant="body" size={16}>{r.note}</Txt> : null}
              {r.office_note ? <Txt variant="muted" size={15}>{t('office.maint.officeNote', { note: r.office_note })}</Txt> : null}
              {r.photos.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  {r.photos.map((u, n) => (
                    <Pressable key={n} accessibilityRole="imagebutton" accessibilityLabel={t('office.maint.photo', { n: n + 1 })} onPress={() => open(u)} testID="report-photo">
                      <Image source={{ uri: u }} style={styles.photo} resizeMode="cover" />
                    </Pressable>
                  ))}
                </ScrollView>
              )}
              <View style={{ flexDirection: 'row', gap: 10 }}>
                {r.task_id && has(me.permissions, 'assign_tasks') && (
                  <Button kind="outline" label={t('office.maint.openTask')} onPress={() => router.push({ pathname: '/office/task/[id]', params: { id: r.task_id! } })} style={{ flex: 1, minHeight: 52 }} />
                )}
                {r.driver_links?.call && <Button kind="outline" icon={Phone} label={t('office.maint.callDriver')} onPress={() => open(r.driver_links!.call as string)} style={{ flex: 1, minHeight: 52 }} />}
              </View>
            </View>
            {canEdit && (
              <Section title={t('office.maint.update')}>
                {REPORT_STATUSES.map((s) => (
                  <Pressable key={s} accessibilityRole="radio" accessibilityState={{ checked: shownStatus === s }} onPress={() => { setStatus(s); setSaved(false); }} style={[styles.option, shownStatus === s && styles.optionOn]} testID={`report-status-${s}`}>
                    <View style={[styles.radio, shownStatus === s && styles.radioOn]} />
                    <Txt variant="strong" size={16}>{t(`office.maint.status_${s}`)}</Txt>
                  </Pressable>
                ))}
                <Field label={t('office.maint.noteForDriver')} value={note} onChangeText={(v) => { setNote(v); setSaved(false); }} maxLength={500} placeholder={t('office.maint.noteHint')} editable={!busy} />
                {canTakeOffRoad(r, me.tools) && (
                  <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: offRoad }} onPress={() => { setOffRoad((x) => !x); setSaved(false); }} style={styles.option} testID="report-off-road">
                    <View style={[styles.box, offRoad && styles.boxOn]} />
                    <Txt variant="strong" size={16} style={{ flex: 1 }}>{t('office.maint.offRoad', { plate: r.vehicle ?? '' })}</Txt>
                  </Pressable>
                )}
                {saved && <Txt variant="small" color={colors.green}>{t('office.maint.saved')}</Txt>}
                {error && <ErrorNotice error={error} onRetry={() => void save()} onSignIn={() => void signOut()} />}
              </Section>
            )}
          </>
        )}
      </Screen>
      {r && canEdit && (
        <StickyActions>
          {calls.length === 0 && <Txt variant="small" style={{ textAlign: 'center' }}>{t('office.maint.nothingToSave')}</Txt>}
          <Button label={t('office.common.save')} busy={busy} disabled={calls.length === 0} onPress={() => void save()} />
        </StickyActions>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1, borderRadius: 18, padding: 16, gap: 10 },
  photo: { width: 150, height: 112, borderRadius: 12, backgroundColor: '#ebe9e3' },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 10, borderRadius: 12 },
  optionOn: { backgroundColor: colors.blueChip },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.muted },
  radioOn: { borderColor: colors.blue, borderWidth: 7 },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: colors.muted },
  boxOn: { backgroundColor: colors.blue, borderColor: colors.blue },
});
