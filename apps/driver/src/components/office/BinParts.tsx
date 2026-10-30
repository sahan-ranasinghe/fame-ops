// Round 52 (docs/phase8-plan.md §40): Office mode's archive and delete, one component per job, used by every page that
// has them (the rules: office/binLogic.ts).
//   - ArchiveTripsSheet: archiving a driver or a vehicle booked from today on lists those trips first (each opens its task);
//     "Archive anyway" sends confirm true.
//   - RecordDelete: a record's "Delete permanently" (users only, can_delete): the button only when it has no history;
//     else "Has history (3 tasks, 2 fills): archive instead", or the account guard's sentence. The sheet asks for the name
//     or the plate typed exactly (GitHub) for a person or a vehicle, once for the rest; then delete_record.
//   - DeleteRecordSheet: the same sheet for a list's row (it asks can_delete itself when it opens).
//   - DeleteEntry / DeleteEntrySheet: a wrong entry's "Delete…" (approve, delete_entry): the entry in words and what goes
//     with it (the preview), a required reason, Delete.
// After a delete: the snackbar "Deleted · in Recently deleted until <date>", then the caller's onDeleted (back to the list).

import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Sheet } from '@/components/patterns/Sheet';
import { showSnackbar } from '@/components/patterns/Snackbar';
import { Button, Field, Txt } from '@/components/ui';
import { dateWords } from '@/lib/dateWords';
import { deleteEntryInput, deleteReady, deleteRecordInput, deleteState, needsTyping, previewInput, reasonOk } from '@/office/binLogic';
import { useOffice, useTool } from '@/office/state';
import type { ArchiveTrip, CanDeleteResult, DeleteEntryPreview, DeleteEntryResult, DeleteRecordResult, EntryKind, FleetError, RecordKind } from '@/office/types';
import { Divider, ErrorNotice, Row } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

const DANGER = { borderWidth: 1.5, borderColor: '#e3b8b4', backgroundColor: colors.card };

/** Archiving someone or something booked from today on: the trips, each opening its task; Archive anyway. */
export function ArchiveTripsSheet({ visible, name, trips, busy, error, onClose, onConfirm }: {
  visible: boolean;
  name: string;
  trips: ArchiveTrip[];
  busy: boolean;
  error: FleetError | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t } = useApp();
  const router = useRouter();
  return (
    <Sheet
      visible={visible}
      title={t('office.bin.tripsTitle', { name })}
      onClose={() => { if (!busy) onClose(); }}
      testID="archive-trips-sheet"
      actions={(
        <>
          <Button kind="outline" label={t('office.common.cancel')} onPress={onClose} disabled={busy} style={{ flex: 1 }} />
          <Button kind="danger-text" label={t('office.bin.archiveAnyway')} onPress={onConfirm} busy={busy} style={[{ flex: 1 }, DANGER]} testID="archive-anyway" />
        </>
      )}
    >
      <View style={{ gap: 10 }}>
        <Txt variant="muted">{trips.length === 1 ? t('office.bin.tripsBodyOne') : t('office.bin.tripsBody', { n: trips.length })}</Txt>
        <View>
          {trips.map((trip, i) => (
            <View key={trip.task_id}>
              {i > 0 && <Divider />}
              <Row
                title={trip.title}
                line={dateWords(t, trip.when)}
                chevron
                onPress={() => { onClose(); router.push({ pathname: '/office/task/[id]', params: { id: trip.task_id } }); }}
                testID="archive-trip"
              />
            </View>
          ))}
        </View>
        {error && <ErrorNotice error={error} onRetry={onConfirm} />}
      </View>
    </Sheet>
  );
}

/** The snackbar after a delete: where it went, until when. */
function saidDeleted(t: (k: string, v?: Record<string, string | number>) => string, until: string) {
  showSnackbar({ text: t('office.bin.deletedSnack', { date: dateWords(t, until) }) });
}

/**
 * A record's Delete permanently, at the foot of its page: asks can_delete once (users only); the button only when it has
 * no history, else why not in words. Nothing at all for someone without can_delete.
 */
export function RecordDelete({ kind, refText, onDeleted }: { kind: RecordKind; refText: string; onDeleted: (r: DeleteRecordResult) => void }) {
  const { t } = useApp();
  const { me } = useOffice();
  const may = me.tools.includes('can_delete') && me.tools.includes('delete_record') && !!refText;
  const q = useTool<CanDeleteResult>('can_delete', { kind, ref: refText }, { enabled: may });
  const [open, setOpen] = useState(false);
  if (!may) return null;
  const state = deleteState(q.data, t);
  if (state.kind === 'none') return null;
  return (
    <View style={{ gap: 8 }} testID="record-delete">
      {state.kind === 'button' && (
        <Button kind="danger-text" label={t('office.bin.deleteForever')} onPress={() => setOpen(true)} style={[{ minHeight: 52 }, DANGER]} testID="delete-forever" />
      )}
      {state.kind === 'history' && <Txt variant="small" testID="delete-history">{t('office.bin.hasHistory', { words: state.words })}</Txt>}
      {state.kind === 'problem' && <Txt variant="small" testID="delete-problem">{state.text}</Txt>}
      {q.data && <DeleteRecordSheet visible={open} kind={kind} refText={refText} answer={q.data} onClose={() => setOpen(false)} onDeleted={(r) => { setOpen(false); onDeleted(r); }} />}
    </View>
  );
}

/** The Delete permanently sheet: can_delete's answer (given, or asked when it opens), the typed name or plate, delete_record. */
export function DeleteRecordSheet({ visible, kind, refText, answer, onClose, onDeleted }: {
  visible: boolean;
  kind: RecordKind;
  refText: string;
  answer?: CanDeleteResult;
  onClose: () => void;
  onDeleted: (r: DeleteRecordResult) => void;
}) {
  const { t } = useApp();
  const { api } = useOffice();
  const [asked, setAsked] = useState<CanDeleteResult | null>(null);
  const [askError, setAskError] = useState<FleetError | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FleetError | null>(null);
  const a = answer ?? asked;

  async function ask() {
    setAskError(null);
    try {
      setAsked(await api.call<CanDeleteResult>('can_delete', { kind, ref: refText }));
    } catch (e) {
      setAskError(e as FleetError);
    }
  }
  useEffect(() => {
    if (!visible) return;
    setTyped('');
    setError(null);
    if (!answer) {
      setAsked(null);
      void ask();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, kind, refText]);

  async function remove() {
    if (!a || !deleteReady(kind, a, typed) || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.call<DeleteRecordResult>('delete_record', deleteRecordInput(kind, refText, typed, a));
      saidDeleted(t, r.until);
      onDeleted(r);
    } catch (e) {
      setError(e as FleetError);
    } finally {
      setBusy(false);
    }
  }

  const state = deleteState(a, t);
  const what = kind === 'vehicle' ? t('office.bin.typePlate', { text: a?.confirm_with ?? '' }) : t('office.bin.typeName', { text: a?.confirm_with ?? '' });
  return (
    <Sheet
      visible={visible}
      title={t('office.bin.deleteTitle', { label: a?.label ?? '' })}
      onClose={() => { if (!busy) onClose(); }}
      testID="delete-record-sheet"
      actions={(
        <>
          <Button kind="outline" label={t('office.common.cancel')} onPress={onClose} disabled={busy} style={{ flex: 1 }} />
          {state.kind === 'button' && (
            <Button kind="danger-text" label={t('office.bin.deleteForever')} onPress={() => void remove()} busy={busy} disabled={!deleteReady(kind, a, typed)} style={[{ flex: 1 }, DANGER]} testID="delete-record-confirm" />
          )}
        </>
      )}
    >
      <View style={{ gap: 12 }}>
        {!a && !askError && <Txt variant="muted">{t('office.bin.checking')}</Txt>}
        {askError && <ErrorNotice error={askError} onRetry={() => void ask()} />}
        {state.kind === 'history' && <Txt variant="strong" testID="delete-history">{t('office.bin.hasHistory', { words: state.words })}</Txt>}
        {state.kind === 'problem' && <Txt variant="strong" testID="delete-problem">{state.text}</Txt>}
        {state.kind === 'button' && a && (
          <>
            <Txt variant="muted">{t('office.bin.deleteBody')}</Txt>
            {needsTyping(a) && (
              <Field
                label={what}
                value={typed}
                onChangeText={setTyped}
                editable={!busy}
                autoCapitalize={kind === 'vehicle' ? 'characters' : 'words'}
                autoCorrect={false}
                mono={kind === 'vehicle'}
                testID="delete-type"
              />
            )}
          </>
        )}
        {error && <ErrorNotice error={error} onRetry={() => void remove()} />}
      </View>
    </Sheet>
  );
}

/** A wrong entry's "Delete…" button with its sheet. */
export function DeleteEntry({ kind, id, onDeleted, testID = 'delete-entry', compact = false }: {
  kind: EntryKind;
  id: string | undefined;
  onDeleted: (r: DeleteEntryResult) => void;
  testID?: string;
  compact?: boolean;
}) {
  const { t } = useApp();
  const { me } = useOffice();
  const [open, setOpen] = useState(false);
  if (!id || !me.tools.includes('delete_entry')) return null;
  return (
    <>
      <Button kind="danger-text" label={t('office.bin.deleteEntry')} onPress={() => setOpen(true)} style={compact ? { alignSelf: 'flex-start', minHeight: 44 } : [{ minHeight: 52 }, DANGER]} compact={compact} testID={testID} />
      <DeleteEntrySheet visible={open} kind={kind} id={id} onClose={() => setOpen(false)} onDeleted={(r) => { setOpen(false); onDeleted(r); }} />
    </>
  );
}

/** The wrong entry's sheet: what it is and what goes with it (delete_entry's preview), the reason, Delete. */
export function DeleteEntrySheet({ visible, kind, id, onClose, onDeleted }: {
  visible: boolean;
  kind: EntryKind;
  id: string;
  onClose: () => void;
  onDeleted: (r: DeleteEntryResult) => void;
}) {
  const { t } = useApp();
  const { api } = useOffice();
  const [preview, setPreview] = useState<DeleteEntryPreview | null>(null);
  const [previewError, setPreviewError] = useState<FleetError | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FleetError | null>(null);

  async function look() {
    setPreviewError(null);
    try {
      setPreview(await api.call<DeleteEntryPreview>('delete_entry', previewInput(kind, id)));
    } catch (e) {
      setPreviewError(e as FleetError);
    }
  }
  useEffect(() => {
    if (!visible) return;
    setPreview(null);
    setReason('');
    setError(null);
    void look();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, kind, id]);

  async function remove() {
    if (!preview || !reasonOk(reason) || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.call<DeleteEntryResult>('delete_entry', deleteEntryInput(kind, id, reason));
      saidDeleted(t, r.until);
      onDeleted(r);
    } catch (e) {
      setError(e as FleetError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      visible={visible}
      title={t('office.bin.entryTitle')}
      onClose={() => { if (!busy) onClose(); }}
      testID="delete-entry-sheet"
      actions={(
        <>
          <Button kind="outline" label={t('office.common.cancel')} onPress={onClose} disabled={busy} style={{ flex: 1 }} />
          <Button kind="danger-text" label={t('office.bin.delete')} onPress={() => void remove()} busy={busy} disabled={!preview || !reasonOk(reason)} style={[{ flex: 1 }, DANGER]} testID="delete-entry-confirm" />
        </>
      )}
    >
      <View style={{ gap: 12 }}>
        {!preview && !previewError && <Txt variant="muted">{t('office.bin.checking')}</Txt>}
        {previewError && <ErrorNotice error={previewError} onRetry={() => void look()} />}
        {preview && (
          <>
            <Txt variant="strong" testID="delete-entry-label">{preview.label}</Txt>
            {preview.affects.length > 0 && (
              <View style={{ gap: 4 }} testID="delete-entry-affects">
                <Txt variant="small">{t('office.bin.goesWithIt')}</Txt>
                {preview.affects.map((x) => <Txt key={x} variant="body" size={15}>{`• ${x}`}</Txt>)}
              </View>
            )}
            <Txt variant="small">{t('office.bin.entryNote')}</Txt>
            <Field label={t('office.bin.reasonLabel')} value={reason} onChangeText={setReason} editable={!busy} placeholder={t('office.bin.reasonHint')} maxLength={300} testID="delete-reason" />
            {!reasonOk(reason) && <Txt variant="small" testID="delete-reason-why">{t('office.bin.reasonNeeded')}</Txt>}
          </>
        )}
        {error && <ErrorNotice error={error} onRetry={() => void remove()} />}
      </View>
    </Sheet>
  );
}
