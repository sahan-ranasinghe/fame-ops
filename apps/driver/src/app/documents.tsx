// Documents (Phase 7 §28), opened from Me → my vehicle: the revenue licence, insurance and emission test of the vehicle
// the driver holds now, for roadside checks. Read-only. Each shows its expiry as the office's chips do (amber within
// 30 days, red within 7 days or expired) and Open: a 1-hour link the app signs; a photo opens here, full screen, a PDF
// in the phone's browser. The list read last is kept on the phone (the expiries show offline); the files never are:
// without a connection, "Needs a connection to open". Back (or the arrow) returns to Me; an open photo closes first.

import { Redirect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Linking, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChevronLeft, FileText } from '@/components/icons';
import { PlateText } from '@/components/PlateText';
import { Button, Card, Notice, Txt } from '@/components/ui';
import { BUCKETS, fetchHeldVehicle, fetchVehicleDocuments } from '@/lib/api';
import { getJson, KEYS, setJson } from '@/lib/kv';
import { currentDocuments, dateLabel, type DocumentRow, expiryLine, opensInApp } from '@/lib/photoRules';
import { signedUrl } from '@/lib/signedUrls';
import { supabase } from '@/lib/supabase';
import { colomboDate } from '@/lib/time';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

/** What the screen read last (KEYS.documents): the held vehicle and its documents. */
interface LastRead {
  vehicleId: string | null;
  rows: DocumentRow[];
}

const TONE = { ok: colors.ink, amber: colors.amberText, red: colors.red, none: colors.muted } as const;

export default function DocumentsScreen() {
  const { t, tList, me, vehicles } = useApp();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // null = still loading. `offline` = the server could not be asked: what was read last (for the vehicle held now).
  const [read, setRead] = useState<(LastRead & { offline: boolean }) | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ id: string; key: string } | null>(null);
  // The photo open full screen: its link and its document.
  const [viewing, setViewing] = useState<{ url: string; id: string } | null>(null);
  const [viewLoading, setViewLoading] = useState(true);

  const heldId = me?.current_vehicle_id ?? null;
  const load = useCallback(async () => {
    try {
      const vehicleId = await fetchHeldVehicle(supabase);
      const rows = vehicleId ? await fetchVehicleDocuments(supabase) : [];
      setJson(KEYS.documents, { vehicleId, rows } satisfies LastRead);
      setRead({ vehicleId, rows, offline: false });
    } catch {
      const last = getJson<LastRead>(KEYS.documents);
      setRead(last && last.vehicleId === heldId ? { ...last, offline: true } : { vehicleId: heldId, rows: [], offline: true });
    }
  }, [heldId]);

  useEffect(() => {
    void load();
  }, [load]);

  const pull = useCallback(async () => {
    setRefreshing(true);
    setProblem(null);
    await load();
    setRefreshing(false);
  }, [load]);

  if (!me) return <Redirect href="/login" />;

  async function open(doc: DocumentRow) {
    if (opening) return;
    setProblem(null);
    setOpening(doc.id);
    const link = await signedUrl(BUCKETS.vehicleDocs, doc.path);
    setOpening(null);
    if ('error' in link) {
      setProblem({ id: doc.id, key: link.error === 'network' ? 'docs.needsConnection' : 'docs.failed' });
      return;
    }
    if (opensInApp(doc.content_type)) {
      setViewLoading(true);
      setViewing({ url: link.url, id: doc.id });
      return;
    }
    Linking.openURL(link.url).catch(() => setProblem({ id: doc.id, key: 'docs.failed' }));
  }

  const plate = vehicles.find((v) => v.id === read?.vehicleId)?.reg_no ?? null;
  const today = colomboDate();
  const months = tList('months');

  return (
    <View style={styles.page}>
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingTop: insets.top + 18, paddingBottom: 28, gap: 14 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void pull()} colors={[colors.ink]} />}
      >
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={() => router.back()} style={styles.back}>
            <ChevronLeft size={28} color={colors.ink} strokeWidth={2.6} />
          </Pressable>
          <View style={{ flex: 1, gap: 4 }}>
            <Txt variant="title" size={28}>{t('docs.title')}</Txt>
            {plate ? <PlateText text={t('docs.open')} plate={plate} /> : <Txt variant="muted">{t('docs.myVehicle')}</Txt>}
          </View>
        </View>

        {read === null ? (
          <ActivityIndicator size="large" color={colors.ink} style={{ marginTop: 32 }} />
        ) : read.vehicleId === null ? (
          <Card style={{ alignItems: 'center', paddingVertical: 30, gap: 10 }}>
            <FileText size={34} color={colors.muted} />
            <Txt variant="big" style={{ textAlign: 'center' }}>{t('docs.noVehicle')}</Txt>
          </Card>
        ) : (
          <>
            {read.offline && <Notice tone="warn" text={t('docs.needsConnection')} />}
            {currentDocuments(read.rows).map(({ kind, doc }) => {
              const expiry = doc ? expiryLine(doc.expiry, today) : null;
              return (
                <Card key={kind} style={{ gap: 10 }}>
                  <Txt variant="big">{t(`docs.${kind}`)}</Txt>
                  {!doc || !expiry ? (
                    <Txt variant="muted">{t('docs.missing')}</Txt>
                  ) : (
                    <>
                      <Txt variant="strong" color={TONE[expiry.tone]}>
                        {t(expiry.key, { date: doc.expiry ? dateLabel(doc.expiry, months) : '' })}
                      </Txt>
                      {problem?.id === doc.id && <Notice tone={problem.key === 'docs.failed' ? 'danger' : 'warn'} text={t(problem.key)} />}
                      {read.offline
                        ? <Txt variant="muted">{t('docs.needsConnection')}</Txt>
                        : <Button kind="outline" icon={FileText} label={t('docs.view')} busy={opening === doc.id} disabled={opening !== null && opening !== doc.id} onPress={() => void open(doc)} />}
                    </>
                  )}
                </Card>
              );
            })}
          </>
        )}
      </ScrollView>

      {/* A photo of a document, full screen. Android's back closes it first. */}
      <Modal visible={viewing !== null} animationType="fade" onRequestClose={() => setViewing(null)} statusBarTranslucent>
        <View style={[styles.viewer, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 }]}>
          {viewing && (
            <Image
              source={{ uri: viewing.url }}
              style={{ flex: 1 }}
              resizeMode="contain"
              onLoadEnd={() => setViewLoading(false)}
              onError={() => {
                setProblem({ id: viewing.id, key: 'docs.failed' });
                setViewing(null);
              }}
            />
          )}
          {viewLoading && <ActivityIndicator size="large" color="#ffffff" style={StyleSheet.absoluteFill} />}
          <Button kind="dark" label={t('common.close')} onPress={() => setViewing(null)} style={{ marginHorizontal: 16, borderWidth: 1.5, borderColor: '#5a6068' }} />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  back: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  viewer: { flex: 1, backgroundColor: '#000000', gap: 12 },
});
