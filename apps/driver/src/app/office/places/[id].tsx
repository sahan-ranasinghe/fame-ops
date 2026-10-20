// Office mode (Stage 1, O3 row 8): one place (place_detail): the badge, the name, the address, district, depot and region,
// the ids, the pin with Open in Maps, where it came from, how often stops used it in 90 days. Edit (update_place: the name,
// address, district, depot; the vehicles permission). Remove (remove_place): when it is the base place or tasks today or
// later use it, the page says why first (place_detail's in_use) and the second Remove sends confirm; a removed place has
// Restore (restore_place). The rules: office/placesLogic.ts.

import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { MapPin } from '@/components/icons';
import { ListEmpty, SkeletonRows } from '@/components/patterns/ListState';
import { Button, Field, Mono, Notice, Txt } from '@/components/ui';
import { type PlaceDetailAnswer, placeFields, type PlaceFields, type RemoveAnswer, updatePlaceInput } from '@/office/placesLogic';
import { useOffice, useTool } from '@/office/state';
import type { FleetError } from '@/office/types';
import { BackHeader, ErrorNotice, ListFailed, Screen, Section } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

export default function PlaceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useApp();
  const { api, me, signOut } = useOffice();
  const q = useTool<PlaceDetailAnswer>('place_detail', { id });
  const p = q.data?.place ?? null;
  const removed = !!p?.removed;
  const mayEdit = me.tools.includes('update_place') && !removed;
  const mayRemove = me.tools.includes('remove_place') && !removed && p?.active !== false;
  const mayRestore = me.tools.includes('restore_place') && removed;

  const [editing, setEditing] = useState(false);
  const [f, setF] = useState<PlaceFields>({ name: '', address: '', district: '', depot: '' });
  const [busy, setBusy] = useState<'save' | 'remove' | 'restore' | null>(null);
  const [error, setError] = useState<{ error: FleetError; retry: () => void } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  async function run(kind: 'save' | 'remove' | 'restore', fn: () => Promise<void>) {
    setBusy(kind);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError({ error: e as FleetError, retry: () => void run(kind, fn) });
    } finally {
      setBusy(null);
    }
  }
  function save() {
    if (!p) return;
    const input = updatePlaceInput(p.id, placeFields(p), f);
    if (input === 'name') return setProblem(t('office.places.needName'));
    if (!input) return setEditing(false);
    setProblem(null);
    void run('save', async () => {
      await api.call('update_place', input);
      setEditing(false);
      setDone(t('office.places.saved'));
      await q.reload();
    });
  }
  function remove(confirm: boolean) {
    if (!p) return;
    void run('remove', async () => {
      const r = await api.call<RemoveAnswer>('remove_place', { id: p.id, ...(confirm ? { confirm: true } : {}) });
      if (r.needs_confirm) {
        setConfirming(true);
        return;
      }
      setConfirming(false);
      setDone([t('office.places.removedDone'), r.note].filter(Boolean).join(' '));
      await q.reload();
    });
  }
  function restore() {
    if (!p) return;
    void run('restore', async () => {
      await api.call('restore_place', { id: p.id });
      setDone(t('office.places.restoredDone'));
      await q.reload();
    });
  }
  const reasons = q.data?.in_use?.reasons ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <BackHeader title={p?.name ?? t('office.places.place')} subtitle={p?.badge} />
      <Screen refreshing={q.refreshing} onRefresh={() => void q.reload()} bottom={24}>
        {!q.data && !q.error && <SkeletonRows rows={3} lines={2} />}
        {q.error && <ListFailed stale={!!q.data} error={q.error} onRetry={() => void q.reload()} onSignIn={() => void signOut()} />}
        {q.data && !p && <ListEmpty text={t('office.places.notFound')} />}
        {p && (
          <>
            {removed && <Notice tone="warn" text={t('office.places.removedAt', { at: p.removed! })} />}
            {p.active === false && !removed && <Notice tone="warn" text={t('office.places.switchedOff')} />}
            {done && <Txt variant="small" color={colors.green}>{done}</Txt>}
            <View style={styles.card}>
              {[
                [t('office.places.address'), p.address],
                [t('office.places.district'), p.district],
                [t('office.places.depot'), p.depot],
                [t('office.places.region'), p.region],
                [t('office.places.siteId'), [p.site_id, ...(p.other_ids ?? [])].filter(Boolean).join(' · ')],
                [t('office.places.used'), t('office.places.usedN', { n: q.data?.stops_90_days ?? 0 })],
              ].filter(([, v]) => !!v).map(([label, v]) => (
                <View key={label as string} style={{ gap: 2 }}>
                  <Txt variant="label" color={colors.muted}>{(label as string).toUpperCase()}</Txt>
                  <Txt variant="strong">{v as string}</Txt>
                </View>
              ))}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <MapPin size={20} color={p.pinned === false ? colors.amberText : colors.blue} />
                {typeof p.lat === 'number' && typeof p.lng === 'number'
                  ? <Mono size={15} style={{ flex: 1 }}>{`${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`}</Mono>
                  : <Txt variant="muted" size={15} style={{ flex: 1 }}>{t('office.places.noPin')}</Txt>}
                {p.maps ? (
                  <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(p.maps!).catch(() => undefined)} style={{ minHeight: 44, justifyContent: 'center' }}>
                    <Txt variant="strong" size={15} color={colors.blue}>{t('office.places.openMaps')}</Txt>
                  </Pressable>
                ) : null}
              </View>
              {p.attribution ? <Txt variant="small">{p.attribution}</Txt> : null}
              <Txt variant="small">{t('office.places.updated', { at: p.updated_at })}</Txt>
            </View>

            {mayEdit && !editing && <Button kind="outline" label={t('office.places.edit')} onPress={() => { setF(placeFields(p)); setProblem(null); setEditing(true); }} style={{ minHeight: 52 }} />}
            {editing && (
              <Section title={t('office.places.edit')}>
                <Field label={t('office.places.name')} value={f.name} onChangeText={(v) => setF({ ...f, name: v })} maxLength={160} editable={busy === null} />
                <Field label={t('office.places.address')} value={f.address} onChangeText={(v) => setF({ ...f, address: v })} maxLength={240} editable={busy === null} />
                <Field label={t('office.places.district')} value={f.district} onChangeText={(v) => setF({ ...f, district: v })} maxLength={80} editable={busy === null} />
                <Field label={t('office.places.depot')} value={f.depot} onChangeText={(v) => setF({ ...f, depot: v })} maxLength={80} editable={busy === null} />
                {problem && <Notice tone="danger" text={problem} />}
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Button kind="outline" label={t('office.common.cancel')} disabled={busy !== null} onPress={() => setEditing(false)} style={{ flex: 1, minHeight: 52 }} />
                  <Button label={t('office.common.save')} busy={busy === 'save'} onPress={save} style={{ flex: 1, minHeight: 52 }} />
                </View>
              </Section>
            )}

            {mayRemove && (
              <Section title={t('office.places.removeTitle')}>
                {reasons.length > 0 && (
                  <View style={{ gap: 4 }} testID="place-in-use">
                    {reasons.map((r) => <Txt key={r} variant="strong" size={15} color={colors.amberText}>{r}</Txt>)}
                    {(q.data?.in_use?.tasks ?? []).map((x) => <Txt key={x.task_id} variant="small">{`${x.when} · ${x.title}`}</Txt>)}
                  </View>
                )}
                <Txt variant="small">{t('office.places.removeNote')}</Txt>
                {confirming ? (
                  <Button kind="danger-text" label={t('office.places.removeAnyway')} busy={busy === 'remove'} onPress={() => remove(true)} style={{ minHeight: 52 }} testID="place-remove-confirm" />
                ) : (
                  <Button kind="danger-text" label={t('office.places.remove')} busy={busy === 'remove'} onPress={() => remove(false)} style={{ minHeight: 52 }} testID="place-remove" />
                )}
              </Section>
            )}
            {mayRestore && <Button label={t('office.places.restore')} busy={busy === 'restore'} onPress={restore} style={{ minHeight: 56 }} testID="place-restore" />}
            {error && <ErrorNotice error={error.error} onRetry={error.retry} onSignIn={() => void signOut()} />}
          </>
        )}
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1, borderRadius: 18, padding: 16, gap: 12 },
});
