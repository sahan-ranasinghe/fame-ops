// Part 3b (H4): "Running late" on the task screen, the preview and the Today card (before or during a task; never on a
// trip the driver started). The sheet: 10 · 15 · 30 min (one tap sends) or Other (5–180, typed) → report_running_late
// through the offline queue (lib/late.ts; the server keeps the latest report and tells the office and the requester).
// After it: "The office knows: 15 min late", or "Will be sent when you are online"; the task then says "You said 15 min
// late at 08:52" (tasks.late_report_min / late_report_at, the phone's copy at once). The back button or Cancel closes
// the sheet first; while it sends, nothing closes it. The shared Sheet since the Stage 0 review (docs/ui-patterns.md §6).

import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Sheet } from '@/components/patterns/Sheet';
import { Clock } from '@/components/icons';
import { Button, Notice, Txt } from '@/components/ui';
import { LATE_CHOICES, lateLine, lateMinutes } from '@/lib/late';
import type { TaskWithStops } from '@/lib/types';
import { type SendOutcome, useApp } from '@/state/app';
import { colors, fonts } from '@/theme';

/** The words for what became of a report (the sheet's result line). */
export function lateOutcomeText(t: (key: string, vars?: Record<string, string | number>) => string, outcome: SendOutcome, minutes: number): { text: string; tone: 'info' | 'warn' | 'danger' } {
  switch (outcome.kind) {
    case 'sent':
      return { text: t('late.sent', { n: minutes }), tone: 'info' };
    case 'queued':
      return { text: t('late.queued'), tone: 'warn' };
    case 'failed':
      return { text: t('late.failed', { reason: outcome.message }), tone: 'danger' };
    default:
      return { text: t('late.closed'), tone: 'warn' };
  }
}

/**
 * The "Running late" button with the line under it ("You said 15 min late at 08:52", then what became of the last
 * report), on the task screen, the preview and the Today card.
 */
export function RunningLate({ task }: { task: TaskWithStops }) {
  const { t } = useApp();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<{ text: string; tone: 'info' | 'warn' | 'danger' } | null>(null);
  const said = lateLine(t, task);
  return (
    <View style={{ gap: 8 }}>
      <Button kind="outline" icon={Clock} label={t('late.button')} onPress={() => setOpen(true)} />
      {said && <Txt variant="strong" size={15} color={colors.amberText}>{said}</Txt>}
      {result && <Notice tone={result.tone} text={result.text} />}
      <LateSheet task={open ? task : null} onClose={() => setOpen(false)} onSent={setResult} />
    </View>
  );
}

export function LateSheet({ task, onClose, onSent }: {
  task: TaskWithStops | null;
  onClose: () => void;
  onSent: (result: { text: string; tone: 'info' | 'warn' | 'danger' }) => void;
}) {
  const { t, reportLate } = useApp();
  const [other, setOther] = useState(false);
  const [typed, setTyped] = useState('');
  const [bad, setBad] = useState(false);
  const [busy, setBusy] = useState(false);

  function close() {
    if (busy) return;
    setOther(false);
    setTyped('');
    setBad(false);
    onClose();
  }

  async function send(minutes: number | null) {
    if (!task || busy) return;
    if (minutes === null) {
      setBad(true);
      return;
    }
    setBusy(true);
    const outcome = await reportLate(task, minutes);
    setBusy(false);
    onSent(lateOutcomeText(t, outcome, minutes));
    setOther(false);
    setTyped('');
    setBad(false);
    onClose();
  }

  return (
    <Sheet
      visible={task !== null}
      title={t('late.title')}
      onClose={close}
      testID="late-sheet"
      actions={<Button label={t('common.cancel')} kind="outline" disabled={busy} onPress={close} style={{ flex: 1 }} />}
    >
      {task ? <Txt variant="muted" numberOfLines={1}>{task.title}</Txt> : null}
      <View style={styles.choices}>
        {LATE_CHOICES.map((n) => (
          <Pressable
            key={n}
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void send(n)}
            style={({ pressed }) => [styles.choice, (pressed || busy) && { opacity: 0.6 }]}
          >
            <Txt variant="button" size={20}>{t('late.min', { n })}</Txt>
          </Pressable>
        ))}
      </View>
      {!other ? (
        <Button kind="outline" label={t('late.other')} disabled={busy} onPress={() => setOther(true)} />
      ) : (
        <View style={{ gap: 10 }}>
          <Txt variant="strong" size={16}>{t('late.minutes')}</Txt>
          <TextInput
            value={typed}
            onChangeText={(text) => {
              setTyped(text.replace(/[^\d]/g, '').slice(0, 3));
              setBad(false);
            }}
            keyboardType="number-pad"
            autoFocus
            maxLength={3}
            style={[styles.input, { fontFamily: fonts.mono }]}
          />
          {bad && <Notice tone="danger" text={t('late.bad')} />}
          <Button kind="dark" label={t('late.send')} busy={busy} onPress={() => void send(lateMinutes(typed))} />
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  choices: { flexDirection: 'row', gap: 10 },
  choice: {
    flex: 1, minHeight: 72, borderRadius: 16, backgroundColor: colors.amber, alignItems: 'center', justifyContent: 'center',
  },
  input: { minHeight: 60, borderWidth: 1.5, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 14, fontSize: 24, color: colors.ink },
});
