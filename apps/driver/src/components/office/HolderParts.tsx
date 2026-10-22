// Round 4–7, feature 7 (Sahan, 22 October 2026): someone else has that driver or vehicle. Office mode's (and /m/'s) holder
// parts, the rules in office/holderLogic.ts:
//   - HolderLine: who holds it on a busy warning (Google Calendar's room booking): the photo or the initials, the name and
//     the role, "Asked for it · 08:00–11:00", then Call, WhatsApp and Ask for it (office users only: everyone here is);
//   - HolderStrip: the short line under a busy row ("Anoja's · 08:00–11:00" and Ask), outside the row: a pick row holds no
//     other button (docs/ui-patterns.md §11);
//   - AskForItSheet: the shared Sheet with an optional note → ask_for_it → the snackbar ("Asked Anoja. You'll hear their
//     answer."); an error stays in the sheet with Try again;
//   - ConflictCard: a conflict's sentence with its holder and Open that task (the approve page's proposal, a save's notice);
//   - TaskAsksLink: on a task page, "Asks about this trip · 2" when there are any, opening the Asks page for that trip;
//   - InboxActions: the notification centre's buttons (an Ask for it's Yes / No): the tool with its args as they are, the
//     item read, then "You said Yes"; an error in words with Try again.
// With holder_contact off the server sends no holder and no actions: none of this shows.

import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { showSnackbar } from '@/components/patterns/Snackbar';
import { Sheet } from '@/components/patterns/Sheet';
import { Button, Field, Txt } from '@/components/ui';
import { actionWords, answeredLabel, askArgs, asksFor, askSentence, askedSnack, byLine, busyWords, conflictResource, holderTitle, mayAsk, reachOf, rememberAnswer, type Resource, type Wanted } from '@/office/holderLogic';
import { sentenceText } from '@/office/statusWords';
import { useOffice, useTool } from '@/office/state';
import type { AskedForIt, Conflict, FleetError, Holder, HolderAsks, InboxItem } from '@/office/types';
import { Avatar, ErrorNotice } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors, hoverStyle, webHitSlop } from '@/theme';

const open = (url: string) => void Linking.openURL(url).catch(() => undefined);

/** A small text button (Call, WhatsApp, Ask for it, Ask): 44 px tall, blue words. */
function LinkButton({ label, onPress, testID, a11y }: { label: string; onPress: () => void; testID?: string; a11y?: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={a11y ?? label} onPress={onPress} hitSlop={6} testID={testID}
      style={(state) => [styles.linkBtn, webHitSlop(6), hoverStyle(state), state.pressed && { opacity: 0.7 }]}>
      <Txt variant="strong" size={15} color={colors.blue}>{label}</Txt>
    </Pressable>
  );
}

/** The holder of a busy driver or vehicle, with Call, WhatsApp and Ask for it. */
export function HolderLine({ holder, resource, what, wanted, testID = 'holder-line' }: {
  holder: Holder;
  resource: Resource;
  /** The plate or the driver's name (the sheet's sentence). */
  what?: string;
  /** The trip being planned, when the screen knows it (else the server takes the busy trip's own time). */
  wanted?: Wanted;
  testID?: string;
}) {
  const { t } = useApp();
  const { me } = useOffice();
  const [asking, setAsking] = useState(false);
  const reach = reachOf(holder, me.name);
  const ask = mayAsk(holder, me.tools, me.name);
  return (
    <View style={styles.holder} testID={testID}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Avatar name={holder.name} size={40} photo={holder.photo_url} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt variant="strong" size={16} numberOfLines={1}>{holderTitle(holder, me.name, t)}</Txt>
          <Txt variant="muted" size={14} numberOfLines={1}>{byLine(holder, t)}</Txt>
        </View>
      </View>
      {(reach.call || reach.whatsapp || ask) && (
        <View style={styles.actions}>
          {reach.call ? <LinkButton label={t('office.common.call')} a11y={`${t('office.common.call')} ${holder.name}`} onPress={() => open(reach.call!)} testID={`${testID}-call`} /> : null}
          {reach.whatsapp ? <LinkButton label={t('office.common.whatsapp')} a11y={`${t('office.common.whatsapp')} ${holder.name}`} onPress={() => open(reach.whatsapp!)} testID={`${testID}-whatsapp`} /> : null}
          {ask ? <LinkButton label={t('office.holders.askForIt')} onPress={() => setAsking(true)} testID={`${testID}-ask`} /> : null}
        </View>
      )}
      {ask && <AskForItSheet visible={asking} onClose={() => setAsking(false)} holder={holder} resource={resource} what={what} wanted={wanted} />}
    </View>
  );
}

/** Under a busy row: the holder's small photo, "Anoja's · 08:00–11:00" and Ask. */
export function HolderStrip({ holder, resource, what, wanted, testID = 'holder-strip' }: {
  holder: Holder;
  resource: Resource;
  what?: string;
  wanted?: Wanted;
  testID?: string;
}) {
  const { t } = useApp();
  const { me } = useOffice();
  const [asking, setAsking] = useState(false);
  const ask = mayAsk(holder, me.tools, me.name);
  return (
    <View style={styles.strip} testID={testID}>
      <Avatar name={holder.name} size={24} photo={holder.photo_url} />
      <Txt variant="small" style={{ flex: 1 }} numberOfLines={1}>{busyWords(holder, me.name, t)}</Txt>
      {ask ? <LinkButton label={t('office.holders.ask')} a11y={`${t('office.holders.askForIt')} · ${holder.name}`} onPress={() => setAsking(true)} testID={`${testID}-ask`} /> : null}
      {ask && <AskForItSheet visible={asking} onClose={() => setAsking(false)} holder={holder} resource={resource} what={what} wanted={wanted} />}
    </View>
  );
}

/** Ask for it: the sentence, an optional note, Send. */
export function AskForItSheet({ visible, onClose, holder, resource, what, wanted }: {
  visible: boolean;
  onClose: () => void;
  holder: Holder;
  resource: Resource;
  what?: string;
  wanted?: Wanted;
}) {
  const { t } = useApp();
  const { api } = useOffice();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<FleetError | null>(null);
  const close = () => {
    if (busy) return;
    setProblem(null);
    onClose();
  };
  async function send() {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const out = await api.call<AskedForIt>('ask_for_it', askArgs(holder.task_id, resource, wanted, note));
      setNote('');
      onClose();
      showSnackbar({ text: askedSnack(out, t) });
    } catch (e) {
      setProblem(e as FleetError);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      visible={visible}
      title={t('office.holders.askForIt')}
      onClose={close}
      testID="ask-for-it-sheet"
      actions={<Button label={t('office.holders.send')} onPress={() => void send()} busy={busy} style={{ flex: 1 }} testID="ask-for-it-send" />}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Avatar name={holder.name} size={40} photo={holder.photo_url} />
        <Txt variant="strong" size={16} style={{ flex: 1 }}>{askSentence(holder, resource, what, t)}</Txt>
      </View>
      <Txt variant="muted" size={15}>{t('office.holders.askHow')}</Txt>
      <Field
        label={t('office.common.note')}
        value={note}
        onChangeText={setNote}
        maxLength={300}
        multiline
        placeholder={t('office.holders.notePlaceholder')}
        style={styles.note}
        testID="ask-for-it-note"
      />
      {problem && <ErrorNotice error={problem} onRetry={() => void send()} />}
    </Sheet>
  );
}

/** A conflict as a card: its sentence, who holds it, Open that task (for who may open tasks). */
export function ConflictCard({ c, wanted, what, testID = 'conflict-card' }: { c: Conflict; wanted?: Wanted; what?: string; testID?: string }) {
  const { t } = useApp();
  const { me } = useOffice();
  const router = useRouter();
  const resource = conflictResource(c);
  const opens = !!c.task && me.permissions.includes('assign_tasks');
  return (
    <View style={styles.conflict} testID={testID}>
      <Txt variant="strong" size={15} color={colors.red}>{sentenceText(t, c.text)}</Txt>
      {c.holder && resource ? <HolderLine holder={c.holder} resource={resource} what={what} wanted={wanted} testID={`${testID}-holder`} /> : null}
      {opens ? <LinkButton label={t('office.trip.openThatTask')} onPress={() => router.push({ pathname: '/office/task/[id]', params: { id: c.task!.id } })} testID={`${testID}-open`} /> : null}
    </View>
  );
}

/** The conflicts a save answered that name a holder (the others stay as the notice's lines). */
export const holderConflicts = (conflicts: readonly Conflict[] | undefined): Conflict[] => (conflicts ?? []).filter((c) => !!c.holder && !!conflictResource(c));

/** The notification centre's buttons for one item: each calls its tool, the item is read, then "You said Yes". */
export function InboxActions({ item, onRead }: { item: InboxItem; onRead: (item: InboxItem) => void }) {
  const { t } = useApp();
  const { api } = useOffice();
  const [state, setState] = useState<{ busy: string | null; done: string | null; error: FleetError | null; last: number }>(
    () => ({ busy: null, done: answeredLabel(item.id) ?? null, error: null, last: -1 }),
  );
  const actions = item.actions ?? [];
  if (!actions.length) return null;
  async function press(i: number) {
    const a = actions[i];
    if (!a || state.busy) return;
    setState((s) => ({ ...s, busy: a.label, error: null, last: i }));
    try {
      await api.call(a.tool, a.args);
      rememberAnswer(item.id, a.label);
      onRead(item);
      setState({ busy: null, done: a.label, error: null, last: i });
    } catch (e) {
      setState((s) => ({ ...s, busy: null, error: e as FleetError }));
    }
  }
  if (state.done) {
    return (
      <View style={styles.inboxActions} testID="inbox-actions-done">
        <Txt variant="strong" size={15} color={colors.green}>{t('office.holders.youSaid', { answer: actionWords(state.done, t) })}</Txt>
      </View>
    );
  }
  return (
    <View style={{ gap: 6 }} testID="inbox-actions">
      <View style={styles.inboxActions}>
        {actions.map((a, i) => (
          <Button
            key={`${a.tool}-${a.label}`}
            kind={i === 0 ? 'dark' : 'outline'}
            label={actionWords(a.label, t)}
            onPress={() => void press(i)}
            busy={state.busy === a.label}
            disabled={!!state.busy && state.busy !== a.label}
            style={styles.actionBtn}
            testID={`inbox-action-${a.label.toLowerCase()}`}
          />
        ))}
      </View>
      {state.error && <ErrorNotice error={state.error} onRetry={() => void press(state.last)} />}
    </View>
  );
}

/** On a task page: "Asks about this trip · N" (holder_asks: all with approve, else to me and by me), nothing without any. */
export function TaskAsksLink({ taskId }: { taskId: string }) {
  const { t } = useApp();
  const { me } = useOffice();
  const router = useRouter();
  const may = me.tools.includes('holder_asks');
  const approver = me.permissions.includes('approve');
  const all = useTool<HolderAsks>('holder_asks', { which: 'all' }, { enabled: may && approver });
  const toMe = useTool<HolderAsks>('holder_asks', { which: 'to_me' }, { enabled: may && !approver });
  const byMe = useTool<HolderAsks>('holder_asks', { which: 'by_me' }, { enabled: may && !approver });
  if (!may) return null;
  const mine = { all: asksFor(all.data?.asks ?? [], taskId), to_me: asksFor(toMe.data?.asks ?? [], taskId), by_me: asksFor(byMe.data?.asks ?? [], taskId) };
  const which = approver ? 'all' : mine.by_me.length ? 'by_me' : 'to_me';
  const n = approver ? mine.all.length : mine.to_me.length + mine.by_me.length;
  if (!n) return null;
  return (
    <LinkButton label={t('office.holders.taskAsks', { n })} onPress={() => router.push({ pathname: '/office/holder-asks', params: { which, task: taskId } })} testID="task-asks-link" />
  );
}

const styles = StyleSheet.create({
  holder: { gap: 6, borderTopWidth: 1, borderTopColor: '#efede8', paddingTop: 10 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 18, paddingLeft: 50 },
  linkBtn: { minHeight: 44, justifyContent: 'center' },
  strip: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, minHeight: 44 },
  note: { minHeight: 80, textAlignVertical: 'top' },
  conflict: { borderWidth: 1.5, borderColor: colors.red, borderRadius: 14, padding: 12, gap: 8, backgroundColor: colors.card },
  inboxActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingLeft: 66, paddingBottom: 4, minHeight: 44 },
  actionBtn: { minHeight: 44, paddingHorizontal: 18 },
});
