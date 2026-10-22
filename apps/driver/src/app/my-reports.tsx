// Round 4–7, item 8 (docs/phase8-plan.md §33.7): "See all" from the Report tab's "My reports". Every report, Gmail's rows
// (components/ReportRows.tsx), 20 at a time with Load more: the ones the phone keeps (the newest) first, then the
// server's older ones below the oldest held, with their count ("20 of 45"; Hotfix 3, L6). Offline the phone's own. A page
// pushed over the tab: back returns there; nothing is typed here (no "Discard changes?").

import { Redirect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChevronLeft } from '@/components/icons';
import { ListEmpty, LoadMore } from '@/components/patterns/ListState';
import { ReportRow, useReportPages } from '@/components/ReportRows';
import { Card, Txt } from '@/components/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

export default function MyReportsScreen() {
  const app = useApp();
  const { t, me, reports } = app;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const pages = useReportPages(reports);

  if (!me) return <Redirect href="/login" />;

  return (
    <View style={styles.page}>
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingTop: insets.top + 18, paddingBottom: insets.bottom + 28, gap: 16 }}
        refreshControl={<RefreshControl refreshing={app.refreshing} onRefresh={app.refresh} tintColor={colors.amber} colors={[colors.ink]} />}
      >
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={() => router.back()} style={styles.back}>
            <ChevronLeft size={28} color={colors.ink} strokeWidth={2.6} />
          </Pressable>
          <Txt variant="title" size={28} style={{ flex: 1 }}>{t('report.myReports')}</Txt>
        </View>

        {pages.rows.length === 0 ? (
          <ListEmpty text={t('report.none')} />
        ) : (
          <Card style={{ padding: 0 }}>
            {pages.visible.map((report, index) => <ReportRow key={report.id} report={report} first={index === 0} />)}
          </Card>
        )}
        {pages.info.more && <LoadMore shown={pages.info.n} total={pages.info.total} busy={pages.busy} onPress={pages.more} />}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  back: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
});
