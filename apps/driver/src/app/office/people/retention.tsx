// Office mode (Round 4–7, item 9; docs/phase8-plan.md §33.8): More → Settings → Data retention (the users permission; the
// site's /settings/retention, Slack's and Google Workspace's retention settings, laid out for a phone). Each kind of data
// with how long it is kept: a tap opens the one sheet with the days (the minimum shown, Save disabled with the reason until
// valid), saved through update_settings `retention` with only that period (the server keeps the others); fuel videos' months on the
// same list (their own setting). "Never removed" (the preview's list) and Run now: the first press asks retention_preview
// (the counts, nothing removed), the second ("Remove N now") runs run_retention {confirm: true}, a write never asked again by
// itself. Without update_settings the periods are read; without the run tools there is no Run now. Rules:
// office/retentionLogic.ts.

import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ChevronRight } from '@/components/icons';
import { ListEmpty, SkeletonRows } from '@/components/patterns/ListState';
import { ChoiceRow } from '@/components/patterns/Select';
import { Sheet } from '@/components/patterns/Sheet';
import { showSnackbar } from '@/components/patterns/Snackbar';
import { Button, Mono, Txt } from '@/components/ui';
import {
  daysInput, type DaysProblem, minimumOf, neverWords, nightlyTime, periodsOf, previewLines, RETENTION_ROWS, type RetentionKey, ruleKey, whatKey, withPeriod,
} from '@/office/retentionLogic';
import { useOffice, useTool } from '@/office/state';
import type { FleetError, RetentionDays, RetentionPreview, RetentionRun, SettingsResult } from '@/office/types';
import { BackHeader, Divider, ErrorNotice, Screen, Section } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors, fonts } from '@/theme';

type Editing = { kind: 'days'; key: RetentionKey; text: string } | { kind: 'fuel'; months: 6 | 12 };
type Run = { step: 'idle' } | { step: 'checking' } | { step: 'preview'; preview: RetentionPreview } | { step: 'removing'; preview: RetentionPreview } | { step: 'done'; run: RetentionRun };

const n = (v: number) => v.toLocaleString('en-US');

export default function DataRetention() {
  const { t } = useApp();
  const { me, api, signOut } = useOffice();
  const canEdit = me.tools.includes('update_settings');
  const canRun = me.tools.includes('retention_preview') && me.tools.includes('run_retention');
  const settings = useTool<SettingsResult>('get_settings', {}, { enabled: me.tools.includes('get_settings') });
  // The preview on opening: the minimums, what is never removed, the nightly time (its counts wait for Run now).
  const about = useTool<RetentionPreview>('retention_preview', {}, { enabled: me.tools.includes('retention_preview') });
  const [editing, setEditing] = useState<Editing | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<FleetError | null>(null);
  const [run, setRun] = useState<Run>({ step: 'idle' });
  const [runError, setRunError] = useState<FleetError | null>(null);

  const s = settings.data?.settings;
  const periods = periodsOf(s?.retention ?? about.data?.periods);
  const minimums = about.data?.minimums;
  const time = nightlyTime(about.data?.nightly);
  const fuelMonths = s?.fuel_video_keep_months ?? 12;
  const days = (v: number) => (v === 1 ? t('office.retention.oneDay') : t('office.retention.days', { n: n(v) }));
  const problemText = (p: DaysProblem) => t(p.key, Object.fromEntries(Object.entries(p.vars ?? {}).map(([k, v]) => [k, n(v)])));
  const loading = (settings.loading || about.loading) && !settings.data && !about.data;
  const failed = !settings.data && !about.data && (settings.error ?? about.error);

  function open(e: Editing) {
    setSaveError(null);
    setEditing(e);
  }

  async function save() {
    if (!editing || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      if (editing.kind === 'days') {
        const v = daysInput(editing.text, minimumOf(editing.key, minimums));
        if ('error' in v) return;
        const next: RetentionDays = withPeriod(periods, editing.key, v.days);
        // Only the period that changed: the server keeps the others as stored.
        await api.call('update_settings', { key: 'retention', value: { [editing.key]: v.days } });
        settings.patch((p) => ({ ...p, settings: { ...p.settings, retention: next } }));
        showSnackbar({ text: t('office.retention.savedDays', { what: t(whatKey(editing.key)), days: days(v.days) }) });
      } else {
        await api.call('update_settings', { key: 'fuel_video_keep_months', value: editing.months });
        const months = editing.months;
        settings.patch((p) => ({ ...p, settings: { ...p.settings, fuel_video_keep_months: months } }));
        showSnackbar({ text: t('office.retention.savedDays', { what: t('office.retention.fuel'), days: t('office.retention.months', { n: months }) }) });
      }
      setEditing(null);
    } catch (e) {
      setSaveError(e as FleetError);
    } finally {
      setSaving(false);
    }
  }

  async function check() {
    if (run.step === 'checking') return;
    setRun({ step: 'checking' });
    setRunError(null);
    try {
      const p = await api.call<RetentionPreview>('retention_preview', {});
      about.patch(p);
      setRun({ step: 'preview', preview: p });
    } catch (e) {
      setRun({ step: 'idle' });
      setRunError(e as FleetError);
    }
  }

  async function remove(preview: RetentionPreview) {
    if (run.step === 'removing') return;
    setRun({ step: 'removing', preview });
    setRunError(null);
    try {
      const r = await api.call<RetentionRun>('run_retention', { confirm: true });
      setRun({ step: 'done', run: r });
      showSnackbar({ text: t('office.retention.removedSnack') });
    } catch (e) {
      // A write is never sent again by itself: the person presses Remove again.
      setRun({ step: 'preview', preview });
      setRunError(e as FleetError);
    }
  }

  const ruleWords = (l: { key: string; what: string }) => {
    const k = ruleKey(l.key);
    return k ? t(k) : l.what;
  };
  const line = (l: { key: string; what: string; days: number; count: number }) =>
    `${t('office.retention.countOf', { n: n(l.count), what: ruleWords(l) })} · ${t('office.retention.olderThan', { days: days(l.days) })}`;

  const editingProblem = editing?.kind === 'days' ? daysInput(editing.text, minimumOf(editing.key, minimums)) : null;
  const unchanged = editing?.kind === 'days' ? editing.text.trim() === String(periods[editing.key]) : editing?.kind === 'fuel' ? editing.months === fuelMonths : true;

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <BackHeader title={t('office.retention.title')} subtitle={t('office.retention.subtitle', { time })} />
      <Screen refreshing={settings.refreshing} onRefresh={() => { void settings.reload(); void about.reload(); }}>
        {loading && <SkeletonRows rows={6} />}
        {failed && <ErrorNotice error={failed} onRetry={() => { void settings.reload(); void about.reload(); }} onSignIn={() => void signOut()} />}
        {!loading && !failed && (
          <>
            <Txt variant="small" style={{ paddingHorizontal: 4 }}>{t('office.retention.intro', { time })}</Txt>
            <Section title={t('office.retention.kept')}>
              {RETENTION_ROWS.map((row, i) => (
                <View key={row.key}>
                  {i > 0 && <Divider />}
                  <Pressable
                    accessibilityRole={canEdit ? 'button' : 'text'}
                    accessibilityLabel={`${t(whatKey(row.key))}, ${days(periods[row.key])}`}
                    disabled={!canEdit}
                    onPress={() => open({ kind: 'days', key: row.key, text: String(periods[row.key]) })}
                    style={({ pressed }) => [styles.row, pressed && canEdit && { backgroundColor: colors.page }]}
                    testID={`retention-row-${row.key}`}
                  >
                    <View style={{ flex: 1, gap: 2 }}>
                      <Txt variant="strong" size={16}>{t(whatKey(row.key))}</Txt>
                      {row.note ? <Txt variant="small">{t(row.note)}</Txt> : null}
                      {minimumOf(row.key, minimums) > 1 ? <Txt variant="small">{t('office.retention.atLeast', { n: n(minimumOf(row.key, minimums)) })}</Txt> : null}
                    </View>
                    <Mono size={15} bold>{days(periods[row.key])}</Mono>
                    {canEdit && <ChevronRight size={20} color={colors.muted} />}
                  </Pressable>
                </View>
              ))}
              <Divider />
              <Pressable
                accessibilityRole={canEdit ? 'button' : 'text'}
                accessibilityLabel={`${t('office.retention.fuel')}, ${t('office.retention.months', { n: fuelMonths })}`}
                disabled={!canEdit || !settings.data}
                onPress={() => open({ kind: 'fuel', months: fuelMonths })}
                style={({ pressed }) => [styles.row, pressed && canEdit && { backgroundColor: colors.page }]}
                testID="retention-row-fuel"
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt variant="strong" size={16}>{t('office.retention.fuel')}</Txt>
                  <Txt variant="small">{t('office.retention.fuelNote')}</Txt>
                </View>
                <Mono size={15} bold>{t('office.retention.months', { n: fuelMonths })}</Mono>
                {canEdit && <ChevronRight size={20} color={colors.muted} />}
              </Pressable>
            </Section>

            {about.data?.never?.length ? (
              <Section title={t('office.retention.neverTitle')}>
                <Txt variant="body" size={15} testID="retention-never">{neverWords(about.data.never, t).join(', ')}</Txt>
              </Section>
            ) : null}

            {canRun && (
              <Section title={t('office.retention.runTitle')}>
                <View style={{ gap: 12, paddingVertical: 8 }} testID="retention-run">
                  <Txt variant="small">{t('office.retention.runBody', { time })}</Txt>
                  {(run.step === 'preview' || run.step === 'removing') && (() => {
                    const { lines, total } = previewLines(run.preview);
                    if (total === 0) return <ListEmpty text={t('office.retention.nothing')} />;
                    return (
                      <View style={{ gap: 6 }} testID="retention-preview">
                        <Txt variant="strong" size={15}>{t('office.retention.wouldRemove')}</Txt>
                        {lines.map((l) => <Txt key={l.key} variant="body" size={15}>{line(l)}</Txt>)}
                        <Txt variant="strong" size={15}>{t('office.retention.total', { n: n(total) })}</Txt>
                      </View>
                    );
                  })()}
                  {run.step === 'done' && (
                    <View style={{ gap: 6 }} testID="retention-done">
                      {run.run.counts.some((c) => c.count > 0) ? (
                        <>
                          <Txt variant="strong" size={15} color={colors.green}>{t('office.retention.removed')}</Txt>
                          {run.run.counts.filter((c) => c.count > 0).map((c) => <Txt key={c.key} variant="body" size={15}>{line(c)}</Txt>)}
                        </>
                      ) : <Txt variant="strong" size={15}>{t('office.retention.removedNone')}</Txt>}
                      {run.run.summarised > 0 && <Txt variant="small">{t('office.retention.summarised', { n: n(run.run.summarised) })}</Txt>}
                    </View>
                  )}
                  {runError && <ErrorNotice error={runError} onSignIn={() => void signOut()} />}
                  {(run.step === 'idle' || run.step === 'checking' || run.step === 'done') && (
                    <Button kind="outline" label={t('office.retention.runCheck')} busy={run.step === 'checking'} onPress={() => void check()} testID="retention-check" />
                  )}
                  {(run.step === 'preview' || run.step === 'removing') && previewLines(run.preview).total > 0 && (
                    <Button kind="dark" label={t('office.retention.remove', { n: n(previewLines(run.preview).total) })} busy={run.step === 'removing'} onPress={() => void remove(run.preview)} testID="retention-remove" />
                  )}
                  {(run.step === 'preview' || run.step === 'removing') && (
                    <Button kind="outline" label={previewLines(run.preview).total > 0 ? t('office.common.cancel') : t('office.retention.close')} disabled={run.step === 'removing'} onPress={() => setRun({ step: 'idle' })} />
                  )}
                </View>
              </Section>
            )}
          </>
        )}
      </Screen>

      <Sheet
        visible={!!editing}
        title={editing?.kind === 'days' ? t(whatKey(editing.key)) : t('office.retention.fuel')}
        onClose={() => { if (!saving) setEditing(null); }}
        testID="retention-sheet"
        actions={(
          <View style={{ gap: 6 }}>
            <Button
              kind="primary"
              label={t('office.common.save')}
              busy={saving}
              disabled={unchanged || (!!editingProblem && 'error' in editingProblem)}
              onPress={() => void save()}
              testID="retention-save"
            />
            {editingProblem && 'error' in editingProblem && !unchanged
              ? <Txt variant="small" color={colors.red} style={{ textAlign: 'center' }}>{problemText(editingProblem.error)}</Txt>
              : null}
          </View>
        )}
      >
        {editing?.kind === 'days' && (
          <View style={{ gap: 10 }}>
            <Txt variant="strong" size={16}>{t('office.retention.daysLabel')}</Txt>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <TextInput
                value={editing.text}
                onChangeText={(v) => setEditing({ ...editing, text: v.replace(/\D/g, '').slice(0, 4) })}
                keyboardType="number-pad"
                maxLength={4}
                editable={!saving}
                accessibilityLabel={t('office.retention.daysLabel')}
                style={styles.number}
                testID="retention-days"
              />
              <Txt variant="muted">{t('office.retention.daysUnit')}</Txt>
            </View>
            {minimumOf(editing.key, minimums) > 1 && <Txt variant="small">{t('office.retention.atLeast', { n: n(minimumOf(editing.key, minimums)) })}</Txt>}
          </View>
        )}
        {editing?.kind === 'fuel' && (
          <View accessibilityRole="radiogroup" style={{ gap: 8 }}>
            {([12, 6] as const).map((m) => (
              <ChoiceRow key={m} selected={editing.months === m} disabled={saving} onPress={() => setEditing({ kind: 'fuel', months: m })} testID={`retention-fuel-${m}`}>
                <Txt variant="strong" size={16}>{t('office.retention.months', { n: m })}</Txt>
              </ChoiceRow>
            ))}
            <Txt variant="small">{t('office.retention.fuelWhen')}</Txt>
          </View>
        )}
        {saveError && <ErrorNotice error={saveError} onSignIn={() => void signOut()} />}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 64, paddingVertical: 10 },
  number: { width: 110, minHeight: 52, borderWidth: 1.5, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 12, fontSize: 20, fontFamily: fonts.monoSemiBold, color: colors.ink, backgroundColor: colors.card },
});
