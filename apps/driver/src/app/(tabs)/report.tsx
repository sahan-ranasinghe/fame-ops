// Report tab: tell the office about a problem with the vehicle (what happened,
// a note, 1 to 3 photos), and see the status of earlier reports. A problem
// found during a task is reported from the task screen or from Log mileage
// instead (app/report-problem.tsx), with the task filled in; here the task in
// progress, if any, is attached.

import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ReportForm } from '@/components/ReportForm';
import { useDateLabel } from '@/components/task';
import { Card, Notice, Txt } from '@/components/ui';
import { colomboTime } from '@/lib/time';
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
  const [sent, setSent] = useState(false);
  const running = app.tasks.find((task) => task.status === 'in_progress');

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.page}>
      <StatusBar style="dark" />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingTop: insets.top + 18, paddingBottom: 28, gap: 16 }}>
        <Txt variant="title">{t('report.title')}</Txt>

        <ReportForm vehicle={running ? app.vehicles.find((v) => v.id === running.vehicle_id) ?? vehicle : vehicle} taskId={running?.id ?? null} onSent={() => setSent(true)} />
        {sent && <Notice tone="info" text={t(app.offline ? 'common.savedOffline' : 'report.sent')} />}

        <View style={{ gap: 10 }}>
          <Txt variant="heading" style={{ marginLeft: 6 }}>{t('report.myReports')}</Txt>
          <Card style={{ padding: 0 }}>
            {reports.length === 0 && <Txt variant="muted" style={{ padding: 18 }}>{t('report.none')}</Txt>}
            {reports.map((report, index) => {
              const tone = STATUS_COLOR[report.status] ?? STATUS_COLOR.closed;
              return (
                <View key={report.id} style={[styles.reportRow, index > 0 && { borderTopWidth: 1, borderTopColor: colors.line }]}>
                  <View style={styles.between}>
                    <Txt variant="strong" size={18}>{t(`report.${report.category}`)}</Txt>
                    <View style={[styles.status, { backgroundColor: tone.background }]}>
                      <Txt variant="strong" size={14} color={tone.text}>{t(`report.${report.status}`)}</Txt>
                    </View>
                  </View>
                  <Txt variant="small">{`${dateLabel(report.created_at)} ${colomboTime(report.created_at)}`}</Txt>
                  {report.note && <Txt variant="muted">{report.note}</Txt>}
                  {report.office_note && <Txt variant="strong" size={15} color={colors.blue}>{t('report.office', { note: report.office_note })}</Txt>}
                </View>
              );
            })}
          </Card>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  reportRow: { padding: 16, gap: 4 },
  status: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 3 },
});
