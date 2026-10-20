// "All today's tasks" (Hotfix 3, L6), a page pushed over Today: the task under way and every task still to start today,
// then "Coming up" (later days), 20 at a time with "Load more" (lib/lists.ts; the tasks are the phone's own list, so it
// works offline). Never a missed task. A row opens the task, pushed on top: back returns here, and back from here
// (the arrow, Android's back or the gesture) returns to Today as it was. Nothing is typed here: no "Discard changes?".

import { Redirect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChevronLeft } from '@/components/icons';
import { LoadMore } from '@/components/patterns/ListState';
import { useNow } from '@/components/task';
import { TaskList, TaskRows, useMarkShown } from '@/components/TaskRows';
import { Card, Txt } from '@/components/ui';
import { loadMore, PAGE, pageInfo, todayLists, windowOf } from '@/lib/lists';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

export default function TodayTasksScreen() {
  const app = useApp();
  const { t, me, tasks } = app;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const now = useNow();
  const [shown, setShown] = useState(PAGE);

  const { all, allToday } = todayLists(tasks, now);
  const visible = windowOf(all, shown);
  const todays = visible.slice(0, allToday);
  const later = visible.slice(allToday);
  useMarkShown(visible);

  if (!me) return <Redirect href="/login" />;

  return (
    <View style={styles.page}>
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingTop: insets.top + 18, paddingBottom: insets.bottom + 28, gap: 16 }}
        refreshControl={<RefreshControl refreshing={app.refreshing} onRefresh={app.refresh} tintColor={colors.amber} colors={[colors.ink]} />}
      >
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={() => router.back()} style={styles.back}>
            <ChevronLeft size={28} color={colors.ink} strokeWidth={2.6} />
          </Pressable>
          <Txt variant="title" size={28} style={{ flex: 1 }}>{t('today.allTasksTitle')}</Txt>
        </View>

        {all.length === 0 && (
          <Card style={{ alignItems: 'center', paddingVertical: 34, gap: 6 }}>
            <Txt variant="heading">{t('today.noTasks')}</Txt>
            <Txt variant="muted" style={{ textAlign: 'center' }}>{t('today.noTasksHint')}</Txt>
          </Card>
        )}
        {todays.length > 0 && <TaskRows tasks={todays} />}
        <TaskList title={t('today.upcoming')} tasks={later} showDate />
        {pageInfo(shown, all.length).more && <LoadMore shown={pageInfo(shown, all.length).n} total={all.length} busy={false} onPress={() => setShown(loadMore(shown, all.length, null).shown)} />}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  back: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
});
