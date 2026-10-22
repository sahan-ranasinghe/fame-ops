// Report tab: tell the office about a problem with the vehicle (what happened,
// a note, 1 to 3 photos), and see the status of earlier reports. A problem
// found during a task is reported from the task screen or from Log mileage
// instead (app/report-problem.tsx), with the task filled in; here the task in
// progress, if any, is attached (so a breakdown or accident offers "I need another vehicle").
// Round 4–7 (§33.1): Damage is a category here too (components/ReportForm.tsx); a report made by the vehicle check before
// work says "Vehicle check" in its grey line.
// Round 4–7, item 8 (§33.7, Gmail's rows): "My reports" shows the last 5 (components/ReportRows.tsx: the category's icon,
// one specific line, one grey line with the plate, the time in words and the status chip) and "See all", which opens
// app/my-reports.tsx (every report, 20 at a time with Load more: the phone's, then the server's older ones).

import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ReportForm } from '@/components/ReportForm';
import { ReportRow } from '@/components/ReportRows';
import { Button, Card, Notice, Txt } from '@/components/ui';
import { OFFICE_PHONE } from '@/config';
import { mergeNewest } from '@/lib/lists';
import { RECENT_REPORTS, reportsSeeAll } from '@/lib/reportList';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

export default function ReportScreen() {
  const app = useApp();
  // Off duty, the vehicle held last (Phase 7).
  const { t, workVehicle: vehicle, reports } = app;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // What was sent last: a report, or a report asking for another vehicle.
  const [sent, setSent] = useState<'report' | 'vehicle' | null>(null);
  const running = app.tasks.find((task) => task.status === 'in_progress');
  // The phone's newest reports (a report just sent comes first).
  const newest = useMemo(() => mergeNewest(reports), [reports]);

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
          <View style={styles.head}>
            <Txt variant="heading" style={{ flex: 1, marginLeft: 6 }}>{t('report.myReports')}</Txt>
            {reportsSeeAll(newest.length) && (
              <Pressable accessibilityRole="button" onPress={() => router.push('/my-reports')} hitSlop={8} style={styles.seeAll} testID="reports-see-all">
                <Txt variant="strong" size={16} color={colors.blue}>{t('logHistory.seeAll')}</Txt>
              </Pressable>
            )}
          </View>
          <Card style={{ padding: 0 }}>
            {newest.length === 0 && <Txt variant="muted" style={{ padding: 18 }}>{t('report.none')}</Txt>}
            {newest.slice(0, RECENT_REPORTS).map((report, index) => <ReportRow key={report.id} report={report} first={index === 0} />)}
          </Card>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  seeAll: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 6 },
});
