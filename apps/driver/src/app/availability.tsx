// Me → Availability (Part 3b, H1; docs/phase7-plan.md "Part 3b"), pushed over Me: when the driver can't take trips (not
// leave: HR stays separate; this only tells dispatch). The entries ahead, soonest first, in words ("Tue 20 Oct · until
// 13:00 · Half day"), "Added by Palitha" when the office added one; Edit opens the form (app/availability-edit.tsx,
// pushed), Remove asks first (remove_my_unavailability). Read when the page opens and when it comes back from the form;
// online only: with no connection the list read last shows with "No connection". Back returns to Me.

import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChevronLeft, Pencil, Plus } from '@/components/icons';
import { useDateLabel } from '@/components/task';
import { Button, Card, Notice, Txt } from '@/components/ui';
import { ApiError, fetchMyUnavailability, removeMyUnavailability } from '@/lib/api';
import { addedByOther, availLine, type UnavailabilityRow, upcomingEntries } from '@/lib/availability';
import { getJson, KEYS, setJson } from '@/lib/kv';
import { supabase } from '@/lib/supabase';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

export default function AvailabilityScreen() {
  const { t, me } = useApp();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const dateLabel = useDateLabel();
  const [rows, setRows] = useState<UnavailabilityRow[] | null>(() => getJson<UnavailabilityRow[]>(KEYS.availability));
  const [offline, setOffline] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const meId = me?.id ?? null;
  const load = useCallback(async () => {
    if (!meId) return;
    try {
      const list = await fetchMyUnavailability(supabase, meId, new Date());
      setJson(KEYS.availability, list);
      setRows(list);
      setOffline(false);
    } catch {
      setOffline(true);
      setRows((old) => old ?? []);
    }
  }, [meId]);

  // Read when the page opens and when the form closes over it.
  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  if (!me) return <Redirect href="/login" />;

  const pull = async () => {
    setRefreshing(true);
    setProblem(null);
    await load();
    setRefreshing(false);
  };

  function remove(row: UnavailabilityRow) {
    setProblem(null);
    Alert.alert(t('avail.remove'), t('avail.removeConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('avail.remove'),
        style: 'destructive',
        onPress: async () => {
          setRemoving(row.id);
          try {
            const result = await removeMyUnavailability(supabase, row.id);
            if (result === 'office') setProblem(t('avail.officeAdded'));
            if (result === 'past') setProblem(t('avail.past'));
            await load();
          } catch (error) {
            setProblem(error instanceof ApiError && error.permanent ? t('avail.failed', { reason: error.message }) : t('avail.noConnection'));
          }
          setRemoving(null);
        },
      },
    ]);
  }

  const list = upcomingEntries(rows ?? [], Date.now());

  return (
    <View style={styles.page}>
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingTop: insets.top + 18, paddingBottom: insets.bottom + 28, gap: 14 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={pull} tintColor={colors.amber} colors={[colors.ink]} />}
      >
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={() => router.back()} style={styles.back}>
            <ChevronLeft size={28} color={colors.ink} strokeWidth={2.6} />
          </Pressable>
          <Txt variant="title" size={28} style={{ flex: 1 }}>{t('avail.title')}</Txt>
        </View>
        <Txt variant="muted">{t('avail.intro')}</Txt>

        {offline && <Notice tone="warn" text={t('avail.noConnection')} />}
        {problem && <Notice tone="danger" text={problem} />}

        <Button icon={Plus} label={t('avail.add')} onPress={() => router.push('/availability-edit')} />

        {rows !== null && list.length === 0 && (
          <Card style={{ alignItems: 'center', paddingVertical: 28 }}>
            <Txt variant="strong">{t('avail.none')}</Txt>
          </Card>
        )}

        {list.map((row) => {
          const by = addedByOther(row, me.id);
          // An entry the office added is theirs to change (the server refuses it too).
          const office = row.channel !== 'driver';
          return (
            <Card key={row.id} style={{ gap: 8 }}>
              <Txt variant="big">{availLine(t, dateLabel, row)}</Txt>
              {row.note && <Txt variant="body">{row.note}</Txt>}
              {by && <Txt variant="muted">{t('avail.addedBy', { name: by })}</Txt>}
              {office && <Txt variant="muted">{t('avail.officeAdded')}</Txt>}
              {!office && <View style={styles.actions}>
                <Button
                  kind="outline"
                  icon={Pencil}
                  label={t('me.edit')}
                  disabled={removing !== null}
                  onPress={() => router.push({ pathname: '/availability-edit', params: { id: row.id } })}
                  style={{ flex: 1 }}
                />
                <Button
                  kind="danger-text"
                  label={t('avail.remove')}
                  busy={removing === row.id}
                  disabled={removing !== null}
                  onPress={() => remove(row)}
                  style={{ flex: 1 }}
                />
              </View>}
            </Card>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  back: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', gap: 10, alignItems: 'center' },
});
