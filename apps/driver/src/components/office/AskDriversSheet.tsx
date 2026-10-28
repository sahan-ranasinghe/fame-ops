// Office mode (Phase 8, O2): Ask drivers (design 13), a bottom sheet opened from "Ask drivers" on Approve a request, Give
// it a driver and the Drivers board. The question as three chips (Free for a trip? with the trip's day and window under
// it · When at the office? · Where are you?), "Send to · N picked" with All free · None, a row per driver (the shared
// SelectableRow: a circle that fills with a check, the tint and the border; the name, the status line; free ones picked
// first), then Send to N drivers (ask_drivers). Once sent,
// the answers live under the rows (ask_answers every 10 s while the sheet is open and someone has still to answer):
// waiting… / seen HH:MM / Yes · HH:MM / No / Call me with a Call button when the number is known / a time / where they
// are with a map link; a Yes gets Use when the caller can pick that driver (onUse). The rules: office/askLogic.ts.
// The sent question stays on the sheet while the screen is open (closing hides it); "Ask another question" starts over.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { Sheet } from '@/components/patterns/Sheet';
import { TimeField } from '@/components/patterns/TimeField';

import { Clock, MapPin, Phone, Van } from '@/components/icons';
import { ChoiceCard, pickedStyle, SelectableRow, SelectMark } from '@/components/patterns/Select';
import { Button, Txt } from '@/components/ui';
import { shortDate } from '@/lib/durations';
import {
  allFree, answerLabel, answerOf, ANSWERS_EVERY_MS, ASK_KINDS, type AskContext, askInput, type AskTarget, askTargetsFromBoard, canSend, keepPolling, mergeRows, preticked, sendLabel, toggled,
  tripBoardArgs, windowText,
} from '@/office/askLogic';
import { useOffice } from '@/office/state';
import type { Ask, AskAnswers, AskDriversResult, AskKind, DriversBoard, FleetError } from '@/office/types';
import { Avatar, ErrorNotice, Pill, type Tone } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** The drivers to list (askLogic.askTargets from availability rows, askTargetsFromBoard from the board). */
  drivers: AskTarget[];
  /** Ticked when the sheet opens (usernames); the free drivers when empty. */
  preticked?: string[];
  context: AskContext;
  /** The caller can pick a driver: a Yes gets Use, which picks them and closes the sheet. */
  onUse?: (username: string) => void;
  /** The question picked first (free_for_trip by default). */
  kind?: AskKind;
}

const KIND_ICON = { free_for_trip: Van, office_time: Clock, where_now: MapPin } as const;

const open = (url: string) => void Linking.openURL(url).catch(() => undefined);

export function AskDriversSheet({ visible, onClose, drivers: givenDrivers, preticked: given, context, onUse, kind: firstKind = 'free_for_trip' }: Props) {
  const { t, tList } = useApp();
  const { api } = useOffice();
  const names = { days: tList('days'), months: tList('months') };
  const dayLabel = (date: string) => shortDate(names, `${date}T06:00:00Z`);

  const [kind, setKind] = useState<AskKind>(firstKind);
  const [picked, setPicked] = useState<string[]>(() => preticked(drivers, given));
  // The window typed here when the caller gave none (the Drivers board: today, no trip).
  const [from, setFrom] = useState(context.from ?? '');
  const [to, setTo] = useState(context.to ?? '');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<FleetError | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);


  // The end only when it is after the start (the server refuses `to` at or before `from`; a task's end may be unset or odd).
  const fromText = from.trim();
  const toText = to.trim();
  const ctx: AskContext = { ...context, from: fromText || undefined, to: toText && (!fromText || toText > fromText) ? toText : undefined };
  const window = windowText(ctx, dayLabel);
  const windowGiven = !!context.from;

  // Round 48 (Google Calendar's attendee picker): a trip window typed HERE (the Drivers tab gave none) asks the board
  // again for that window, so the rows and the ticks say free for the trip, not free now; the caller's rows stand
  // until it answers, and when the caller gave the window (its rows were judged for it already).
  const [tripRows, setTripRows] = useState<{ key: string; rows: AskTarget[] } | null>(null);
  const tripArgs = windowGiven ? {} : tripBoardArgs(ctx, kind);
  const tripKey = JSON.stringify(tripArgs);
  useEffect(() => {
    if (!visible || tripKey === '{}') return;
    let live = true;
    api.call<DriversBoard>('drivers_board', tripArgs).then((r) => {
      if (live) setTripRows({ key: tripKey, rows: askTargetsFromBoard(r.drivers, t) });
    }, () => undefined);
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, tripKey]);
  const drivers = tripKey !== '{}' && tripRows?.key === tripKey ? tripRows.rows : givenDrivers;

  // The drivers' list changed while the sheet was closed (a refresh): the ticks follow when nothing was sent yet.
  const listKey = drivers.map((d) => `${d.username ?? ''}:${d.free ? 1 : 0}`).join(',');
  const givenKey = (given ?? []).join(',');
  useEffect(() => {
    if (!visible || ask) return;
    setPicked(preticked(drivers, given));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listKey, givenKey, visible]);

  async function send() {
    if (busy || !canSend(kind, picked, ctx)) return;
    setBusy(true);
    setProblem(null);
    try {
      const out = await api.call<AskDriversResult>('ask_drivers', askInput(kind, picked, ctx));
      setAsk(out.ask);
    } catch (e) {
      setProblem(e as FleetError);
    } finally {
      setBusy(false);
    }
  }

  // The answers, every 10 s while the sheet is open and someone has still to answer.
  const askId = ask?.id ?? null;
  const polling = !!ask && keepPolling(ask);
  const askRef = useRef(ask);
  askRef.current = ask;
  const readAnswers = useCallback(() => {
    if (!askId) return;
    api.call<AskAnswers>('ask_answers', { ask_id: askId }).then((r) => {
      if (r.ask && askRef.current?.id === r.ask.id) setAsk(r.ask);
    }, () => undefined);
  }, [api, askId]);
  useEffect(() => {
    if (!visible || !askId || !polling) return;
    readAnswers();
    const timer = setInterval(readAnswers, ANSWERS_EVERY_MS);
    return () => clearInterval(timer);
  }, [visible, askId, polling, readAnswers]);

  const rows = mergeRows(drivers, ask);
  const sent = ask !== null;

  function startOver() {
    setAsk(null);
    setProblem(null);
    setPicked(preticked(drivers, given));
  }

  return (
    <Sheet visible={visible} title={t('office.ask.title')} onClose={onClose} testID="ask-sheet" actions={(
      <View style={{ flex: 1, gap: 8 }}>
          {!sent && kind === 'free_for_trip' && !windowGiven && picked.length > 0 && !canSend(kind, picked, ctx) && (
            <Txt variant="small" color={colors.amberText}>{t('office.ask.tripTimeNeeded')}</Txt>
          )}
          {!sent ? (
            <Button label={sendLabel(picked.length, t)} onPress={() => void send()} disabled={!canSend(kind, picked, ctx)} busy={busy} style={{ minHeight: 56 }} />
          ) : (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button kind="outline" label={t('office.ask.askAnother')} onPress={startOver} style={{ flex: 1, minHeight: 52 }} />
              <Button kind="dark" label={t('office.ask.close')} onPress={onClose} style={{ flex: 1, minHeight: 52 }} />
            </View>
          )}
          {ask?.expired && <Txt variant="small" color={colors.red} style={{ textAlign: 'center' }}>{t('office.ask.closed')}</Txt>}
          <Txt variant="small" style={{ textAlign: 'center' }}>
            {[t('office.ask.footer'), kind === 'free_for_trip' ? t('office.ask.footerTrip') : ''].filter(Boolean).join(' ')}
          </Txt>
      </View>
    )}>
            <Txt variant="label" color={colors.muted}>{t('office.ask.question').toUpperCase()}</Txt>
            {sent && ask ? (
              <View style={[styles.sentKind, pickedStyle]} testID="ask-kind-sent">
                <SelectMark kind="radio" on size={26} />
                <Txt variant="strong" size={16} style={{ flex: 1 }}>{ask.question || t(`office.ask.kind.${ask.kind}`)}</Txt>
              </View>
            ) : (
              <>
                <KindChip kind="free_for_trip" on={kind === 'free_for_trip'} onPress={() => setKind('free_for_trip')} label={t('office.ask.kind.free_for_trip')} detail={window ?? undefined} />
                {kind === 'free_for_trip' && !windowGiven && (
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TimeBox label={t('office.ask.tripFrom')} value={from} onChange={setFrom} />
                    <TimeBox label={t('office.ask.tripTo')} value={to} onChange={setTo} />
                  </View>
                )}
                <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: 8 }}>
                  {ASK_KINDS.filter((k) => k !== 'free_for_trip').map((k) => (
                    <KindChip key={k} kind={k} on={kind === k} onPress={() => setKind(k)} label={t(`office.ask.kind.${k}`)} small />
                  ))}
                </View>
              </>
            )}

            <View style={styles.sendTo}>
              <Txt variant="label" color={colors.muted} style={{ flex: 1 }}>
                {(sent && ask ? t('office.ask.sent', { time: ask.asked, answered: ask.counts.answered, asked: ask.counts.asked }) : t('office.ask.pickedCount', { n: picked.length })).toUpperCase()}
              </Txt>
              {!sent && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Pressable accessibilityRole="button" onPress={() => setPicked(allFree(drivers))} hitSlop={8} style={styles.link}>
                    <Txt variant="strong" size={15} color={colors.blue}>{t('office.ask.allFree')}</Txt>
                  </Pressable>
                  <Txt variant="muted" size={15}>·</Txt>
                  <Pressable accessibilityRole="button" onPress={() => setPicked([])} hitSlop={8} style={styles.link}>
                    <Txt variant="strong" size={15} color={colors.blue}>{t('office.ask.none')}</Txt>
                  </Pressable>
                </View>
              )}
            </View>
            {rows.length === 0 && <Txt variant="muted" style={{ padding: 6 }}>{t('office.ask.nobody')}</Txt>}
            {rows.map(({ target, row }) => {
              const askable = !!target.username;
              const on = askable && picked.includes(target.username as string);
              const answer = row ? answerOf(row) : null;
              const dim = sent ? !row : !askable;
              if (!sent) {
                // Not sent yet: pick many (the shared SelectableRow: the circle in front, the tint and the border when picked).
                return (
                  <SelectableRow
                    key={target.username ?? `name:${target.name}`}
                    selected={on}
                    onToggle={() => setPicked((p) => toggled(p, drivers, target.username as string))}
                    disabled={!askable}
                    disabledReason={askable ? undefined : t('office.ask.noAccount')}
                    accessibilityLabel={target.name}
                    testID={`ask-row-${target.username ?? target.name}`}
                  >
                    <Txt variant="strong" size={16} numberOfLines={1}>{target.name}</Txt>
                    {/* Round 48: the trip's chip ("Free Thu 29 Oct" / "Busy 09:00–13:00 that day · …") over the status now. */}
                    {target.chip ? <Pill text={target.chip} tone={target.free ? 'green' : 'blue'} size={13} /> : null}
                    {target.line ? <Txt variant="small" numberOfLines={2}>{target.line}</Txt> : null}
                  </SelectableRow>
                );
              }
              return (
                <View key={target.username ?? `name:${target.name}`} style={[styles.row, dim && { opacity: 0.55 }]} testID={`ask-row-${target.username ?? target.name}`}>
                  <Avatar name={target.name} size={40} />
                  <View style={{ flex: 1, gap: 1 }}>
                    <Txt variant="strong" size={16} numberOfLines={1}>{target.name}</Txt>
                    <Txt variant="small" numberOfLines={2}>{target.line || (askable ? '' : t('office.ask.noAccount'))}</Txt>
                  </View>
                  {answer && <Pill text={answerLabel(answer, t)} tone={answer.tone as Tone} size={13} />}
                  {!row && <Txt variant="small">{t('office.ask.notAsked')}</Txt>}
                  {answer?.use && onUse && target.username && (
                    <Pressable accessibilityRole="button" onPress={() => { onUse(target.username as string); onClose(); }} style={styles.use}>
                      <Txt variant="strong" size={15}>{t('office.ask.use')}</Txt>
                    </Pressable>
                  )}
                  {answer?.key === 'callMe' && answer.call && (
                    <Pressable accessibilityRole="button" accessibilityLabel={`${t('office.common.call')} ${target.name}`} onPress={() => open(answer.call as string)} style={styles.callBtn}>
                      <Phone size={18} color={colors.ink} strokeWidth={2.4} />
                      <Txt variant="strong" size={15}>{t('office.common.call')}</Txt>
                    </Pressable>
                  )}
                  {answer?.key === 'location' && answer.map && (
                    <Pressable accessibilityRole="button" accessibilityLabel={t('office.ask.maps')} onPress={() => open(answer.map as string)} style={styles.callBtn}>
                      <MapPin size={18} color={colors.ink} strokeWidth={2.4} />
                      <Txt variant="strong" size={15}>{t('office.ask.maps')}</Txt>
                    </Pressable>
                  )}
                </View>
              );
            })}
            {problem && <ErrorNotice error={problem} onRetry={() => void send()} />}
    </Sheet>
  );
}

/** One of the three question cards (pick one): the shared ChoiceCard with its radio, the icon, the words and, under Free
 *  for a trip?, the trip's window. */
function KindChip({ kind, on, onPress, label, detail, small = false }: { kind: AskKind; on: boolean; onPress: () => void; label: string; detail?: string; small?: boolean }) {
  const Icon = KIND_ICON[kind];
  return (
    <ChoiceCard selected={on} onPress={onPress} accessibilityLabel={label} testID={`ask-kind-${kind}`} style={small ? { flex: 1, paddingHorizontal: 10, gap: 8 } : undefined}>
      <View style={{ flexDirection: small ? 'column' : 'row', alignItems: small ? 'flex-start' : 'center', gap: small ? 2 : 8, flexWrap: 'wrap' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Icon size={small ? 18 : 20} color={on ? colors.blue : colors.ink} strokeWidth={2.2} />
          {!small && <Txt variant="strong" size={16}>{label}</Txt>}
        </View>
        {small && <Txt variant="strong" size={15}>{label}</Txt>}
        {detail ? <Txt variant="small" style={{ flexShrink: 1 }}>{detail}</Txt> : null}
      </View>
    </ChoiceCard>
  );
}

/** "From 09:00" / "To 12:00": the trip's time when the caller gave none (times are always mono, Latin digits). */
function TimeBox({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <TimeField label={label} value={value} onCommit={onChange} />;
}

const styles = StyleSheet.create({
  sentKind: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18 },
  sendTo: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  link: { minHeight: 44, justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 60, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card },
  use: { minHeight: 44, minWidth: 64, paddingHorizontal: 14, borderRadius: 10, backgroundColor: colors.amber, alignItems: 'center', justifyContent: 'center' },
  callBtn: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1.5, borderColor: colors.ink, backgroundColor: colors.card },
});
