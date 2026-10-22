// Report tab: tell the office about a problem with the vehicle (what happened,
// a note, 1 to 3 photos), and see the status of earlier reports. A problem
// found during a task is reported from the task screen or from Log mileage
// instead (app/report-problem.tsx), with the task filled in; here the task in
// progress, if any, is attached (so a breakdown or accident offers "I need another vehicle").
// Hotfix 3 (L6): my reports 20 at a time with "Load more": the newest ones the phone keeps first (app.reports), then the
// older ones from the server, 20 at a time below the oldest held, with their count (lib/lists.ts, api.fetchReportsBefore).
// Offline: the phone's own, 20 at a time.
// Round 4–7 (§33.1): Damage is a category here too (components/ReportForm.tsx); a report made by the vehicle check before
// work reads "… · Vehicle check" under its category.

import { useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Linking, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LoadMore } from '@/components/patterns/ListState';
import { ReportForm } from '@/components/ReportForm';
import { useDateLabel } from '@/components/task';
import { Button, Card, Notice, Txt } from '@/components/ui';
import { OFFICE_PHONE } from '@/config';
import { fetchReportsBefore } from '@/lib/api';
import { loadMore, mergeNewest, oldestOf, PAGE, pageInfo, windowOf } from '@/lib/lists';
import { supabase } from '@/lib/supabase';
import { colomboTime } from '@/lib/time';
import type { VehicleReport } from '@/lib/types';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

const STATUS_COLOR: Record<string, { text: string; background: string }> = {
  open: { text: colors.red, background: '#fbeceb' },
  in_garage: { text: colors.amberText, background: '#fdf1d6' },
  closed: { text: colors.muted, background: '#eceae4' },
};

export default function ReportScreen() {
  const app = useApp();
  // Off duty, the vehicle held last (Phase 7).
  const { t, workVehicle: vehicle, reports } = app;
  const insets = useSafeAreaInsets();
  const dateLabel = useDateLabel();
  // What was sent last: a report, or a report asking for another vehicle.
  const [sent, setSent] = useState<'report' | 'vehicle' | null>(null);
  const running = app.tasks.find((task) => task.status === 'in_progress');
  const pages = useReportPages(reports);

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.page}>
      <StatusBar style="dark" />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingTop: insets.top + 18, paddingBottom: 28, gap: 16 }}>
        <Txt variant="title">{t('report.title')}</Txt>

        <ReportForm
          vehicle={running ? app.vehicles.find((v) => v.id === running.vehicle_id) ?? vehicle : vehicle}
          taskId={running?.id ?? null}
          onSent={({ needsVehicle }) => setSent(needsVehicle ? 'vehicle' : 'report')}
        />
        {sent && <Notice tone="info" text={t(app.offline ? 'common.savedOffline' : sent === 'vehicle' ? 'report.needVehicleSent' : 'report.sent')} />}
        {sent === 'vehicle' && app.offline && OFFICE_PHONE !== '' && (
          <Button kind="outline" label={t('gate.callOffice')} onPress={() => void Linking.openURL(`tel:${OFFICE_PHONE}`)} />
        )}

        <View style={{ gap: 10 }}>
          <Txt variant="heading" style={{ marginLeft: 6 }}>{t('report.myReports')}</Txt>
          <Card style={{ padding: 0 }}>
            {pages.rows.length === 0 && <Txt variant="muted" style={{ padding: 18 }}>{t('report.none')}</Txt>}
            {pages.visible.map((report, index) => {
              const tone = STATUS_COLOR[report.status] ?? STATUS_COLOR.closed;
              return (
                <View key={report.id} style={[styles.reportRow, index > 0 && { borderTopWidth: 1, borderTopColor: colors.line }]}>
                  <View style={styles.between}>
                    <Txt variant="strong" size={18}>{t(`report.${report.category}`)}</Txt>
                    <View style={[styles.status, { backgroundColor: tone.background }]}>
                      <Txt variant="strong" size={14} color={tone.text}>{t(`report.${report.status}`)}</Txt>
                    </View>
                  </View>
                  {/* Round 4–7: a problem found by the vehicle check before work says so. */}
                  <Txt variant="small">{[`${dateLabel(report.created_at)} ${colomboTime(report.created_at)}`, report.check_id ? t('vehicleCheck.title') : null].filter(Boolean).join(' · ')}</Txt>
                  {report.needs_vehicle && <Txt variant="strong" size={15} color={colors.red}>{t('report.needVehicle')}</Txt>}
                  {report.note && <Txt variant="muted">{report.note}</Txt>}
                  {report.office_note && <Txt variant="strong" size={15} color={colors.blue}>{t('report.office', { note: report.office_note })}</Txt>}
                </View>
              );
            })}
          </Card>
          {pages.info.more && <LoadMore shown={pages.info.n} total={pages.info.total} busy={pages.busy} onPress={pages.more} />}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/**
 * My reports, PAGE at a time: the ones on the phone (the newest, `base`) first, then the server's older ones below the
 * oldest held. The server's count of those is asked each time the tab is opened, so "Showing 20 of 45" is right.
 */
function useReportPages(base: VehicleReport[]) {
  const [older, setOlder] = useState<VehicleReport[]>([]);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [shown, setShown] = useState(PAGE);
  const [busy, setBusy] = useState(false);
  const rows = useMemo(() => mergeNewest(base, older), [base, older]);
  // The newest of both, for the answers that come later (the cursor is always below the oldest report held now).
  const baseRef = useRef(base);
  baseRef.current = base;
  const olderRef = useRef(older);
  const keepOlder = useCallback((list: VehicleReport[]) => {
    olderRef.current = list;
    setOlder(list);
  }, []);
  const cursor = useCallback(() => oldestOf([...baseRef.current, ...olderRef.current]), []);
  // Only the newest answer counts (a count asked on opening the tab must not undo a page that came after it).
  const asked = useRef(0);

  // A refresh that moved the end of the phone's newest reports (a report sent, the list read again) starts the list
  // again, so that no report falls between the phone's and the older pages.
  const baseEnd = oldestOf(base)?.id ?? '';
  const lastEnd = useRef(baseEnd);
  useEffect(() => {
    if (lastEnd.current === baseEnd) return;
    lastEnd.current = baseEnd;
    asked.current += 1;
    keepOlder([]);
    setRemaining(null);
    setShown(PAGE);
  }, [baseEnd, keepOlder]);

  // How many older ones the server has: asked each time the tab is opened, and when the list starts again.
  useFocusEffect(
    useCallback(() => {
      const mine = ++asked.current;
      fetchReportsBefore(supabase, cursor(), 0)
        .then((answer) => {
          if (mine === asked.current) setRemaining(answer.older);
        })
        .catch(() => undefined); // offline: the phone's reports only
    }, [baseEnd, cursor]),
  );

  async function more() {
    const step = loadMore(shown, rows.length, remaining);
    setShown(step.shown);
    if (!step.fetch || busy) return;
    const mine = ++asked.current;
    setBusy(true);
    try {
      const page = await fetchReportsBefore(supabase, cursor(), PAGE);
      if (mine !== asked.current) return;
      keepOlder(mergeNewest(olderRef.current, page.rows));
      setRemaining(Math.max(0, page.older - page.rows.length));
    } catch {
      // No connection: the rows the phone holds stay; Load more asks again.
    } finally {
      setBusy(false);
    }
  }

  return { rows, visible: windowOf(rows, shown), info: pageInfo(shown, rows.length, remaining), busy, more: () => void more() };
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  reportRow: { padding: 16, gap: 4 },
  status: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 3 },
});
