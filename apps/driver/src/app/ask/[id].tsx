// A question from the office (Part 3b, H3; docs/phase7-plan.md "Part 3b"), opened from Today's banner (pushed: back
// returns to Today) or from the question's notification (Today underneath, like a task). One-tap answers:
//   - "Free for a trip?" with the trip's day and times → Yes / No / Call me;
//   - "When can you be at the office?" → the next quarter hours as big buttons (or a typed time) then Send, or Call me;
//   - "Where are you now?" → Share my location (one fix, the foreground permission asked for when missing; it never
//     starts recording or the location service), or Call me.
// Opening it marks it seen (online, best effort). An answer goes through the offline queue (ask_answer): "Answer sent",
// or "Will be sent when you are online"; the answer given shows with "Change answer" while the question is open, and
// "This question has closed." once it is not. Back with a time picked or typed asks "Discard changes?".

import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Check, ChevronLeft, LocateFixed, Phone, X } from '@/components/icons';
import { LocationDisclosure } from '@/components/LocationDisclosure';
import { useLeaveGuard } from '@/components/navigation';
import { useDateLabel, useNow } from '@/components/task';
import { ChoiceChip } from '@/components/patterns/Select';
import { Button, Card, Mono, Notice, Txt } from '@/components/ui';
import { type AskAnswer, type AskAnswerInput, answerWords, isOpen, questionKey, timeChoices, tripWhen, typedTime } from '@/lib/asks';
import { agreeLocationDisclosure, locationDisclosureAgreed } from '@/lib/disclosure';
import { locationPermissions, oneFix } from '@/lib/location';
import { colomboDate, colomboTime } from '@/lib/time';
import { useApp } from '@/state/app';
import { colors, fonts } from '@/theme';
import { failedText } from '@/lib/humanReason';

type Tone = 'info' | 'warn' | 'danger';

export default function AskScreen() {
  const app = useApp();
  const { t } = app;
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const dateLabel = useDateLabel();
  const now = useNow(15_000);

  const ask = app.asks.find((item) => item.ask_id === id) ?? null;
  // What the server said when the screen opened: the phone's copy shows meanwhile, and offline.
  const [found, setFound] = useState<'loading' | 'ready' | 'gone' | 'offline'>(ask ? 'ready' : 'loading');
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState<AskAnswer | null>(null);
  const [disclosure, setDisclosure] = useState(false);
  const [result, setResult] = useState<{ text: string; tone: Tone } | null>(null);
  // The office time: a button picked (ISO), or a typed time.
  const [picked, setPicked] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState('');
  const [badTime, setBadTime] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const dirty = picked !== null || typed.trim() !== '';
  const { allowLeave } = useLeaveGuard(dirty, busy !== null);

  const { loadAsk, markAskSeen } = app;
  useEffect(() => {
    if (!id) return;
    let live = true;
    void loadAsk(id).then((row) => {
      if (!live) return;
      setFound(row === null ? 'gone' : row === 'offline' ? 'offline' : 'ready');
      if (row && row !== 'offline' && isOpen(row, Date.now())) markAskSeen(id);
    });
    return () => {
      live = false;
    };
  }, [id, loadAsk, markAskSeen]);

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const at = (iso: string) => (colomboDate(iso) === colomboDate(now) ? colomboTime(iso) : `${dateLabel(iso)} ${colomboTime(iso)}`);

  async function send(input: AskAnswerInput) {
    if (!ask || busy) return;
    setBusy(input.answer);
    setResult(null);
    setProblem(null);
    const outcome = await app.answerAsk(ask, input);
    setBusy(null);
    allowLeave();
    setChanging(false);
    setPicked(null);
    setTyping(false);
    setTyped('');
    setBadTime(false);
    setResult(
      outcome.kind === 'sent'
        ? { text: t('ask.sent'), tone: 'info' }
        : outcome.kind === 'queued'
        ? { text: t('ask.queued'), tone: 'warn' }
        : outcome.kind === 'failed'
        ? { text: failedText(t, 'ask.failed', outcome.message), tone: 'danger' }
        : { text: t('ask.expired'), tone: 'warn' },
    );
  }

  async function shareLocation() {
    if (busy) return;
    // Part 6: Android is about to ask for location: the disclosure first (once per driver), only Agree goes on.
    if (!locationDisclosureAgreed(app.me?.id) && !(await locationPermissions().catch(() => ({ location: false }))).location) {
      setDisclosure(true);
      return;
    }
    setBusy('location');
    setProblem(null);
    const fix = await oneFix();
    setBusy(null);
    if ('error' in fix) {
      const reason = t(fix.error === 'denied' ? 'gate.titlePermission' : fix.error === 'off' ? 'gate.title' : 'ask.noFix');
      setProblem(t('ask.locationFailed', { reason }));
      return;
    }
    await send({ answer: 'location', lat: fix.lat, lng: fix.lng, accuracy_m: fix.accuracyM });
  }

  function sendTime() {
    const chosen = typing ? typedTime(typed, Date.now()) : picked;
    if (!chosen) {
      setBadTime(true);
      return;
    }
    void send({ answer: 'time', answer_at: chosen });
  }

  const header = (
    <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={goBack} style={styles.back}>
        <ChevronLeft size={28} color={colors.ink} strokeWidth={2.6} />
      </Pressable>
      <Txt variant="title" size={28} style={{ flex: 1 }}>{t('ask.title')}</Txt>
    </View>
  );

  if (!ask) {
    return (
      <View style={[styles.page, { padding: 16, paddingTop: insets.top + 18, gap: 16 }]}>
        <StatusBar style="dark" />
        {header}
        {found === 'loading' && <ActivityIndicator size="large" color={colors.ink} style={{ marginTop: 40 }} />}
        {found === 'offline' && <Notice tone="warn" text={t('ask.noConnection')} />}
        {found === 'gone' && <Notice tone="warn" text={t('ask.expired')} />}
      </View>
    );
  }

  const open = isOpen(ask, now);
  const answered = ask.answered_at !== null && ask.answer !== null;
  const showAnswers = open && (!answered || changing);
  const when = tripWhen(dateLabel, ask);
  const given = answered ? answerWords(t, ask, dateLabel, now) : null;
  const waiting = app.asksWaiting.has(ask.ask_id);
  const typedAt = typing ? typedTime(typed, now) : null;
  const sendLabel = typing ? (typedAt ? t('ask.sendTime', { time: at(typedAt) }) : null) : picked ? t('ask.sendTime', { time: at(picked) }) : null;

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.page}>
      <StatusBar style="dark" />
      <LocationDisclosure
        visible={disclosure}
        onClose={() => setDisclosure(false)}
        onAgree={() => {
          if (app.me) agreeLocationDisclosure(app.me.id);
          setDisclosure(false);
          void shareLocation();
        }}
      />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingTop: insets.top + 18, paddingBottom: insets.bottom + 28, gap: 16 }}>
        {header}

        <Card style={{ gap: 10 }}>
          <Txt variant="title" size={30}>{t(questionKey(ask.kind))}</Txt>
          {when && <Mono size={20} bold>{when}</Mono>}
          {ask.asked_by_name !== '' && <Txt variant="muted">{t('ask.from', { name: ask.asked_by_name })}</Txt>}
          {ask.note && <Txt variant="body">{ask.note}</Txt>}
        </Card>

        {given && (
          <View style={styles.given}>
            <Check size={24} color={colors.blue} strokeWidth={3} />
            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="big">{t('ask.yourAnswer', { answer: given })}</Txt>
              <Txt variant="muted" color={waiting ? colors.amberText : colors.blue}>{t(waiting ? 'ask.queued' : 'ask.sent')}</Txt>
            </View>
          </View>
        )}
        {!open && <Notice tone="warn" text={t('ask.expired')} />}
        {/* Sent or waiting shows with the answer above; a closed question or a refusal here. */}
        {result && result.tone !== 'info' && !(given && result.text === t('ask.queued')) && <Notice tone={result.tone} text={result.text} />}
        {problem && <Notice tone="danger" text={problem} />}

        {open && answered && !changing && (
          <Button kind="outline" label={t('ask.change')} onPress={() => setChanging(true)} />
        )}

        {showAnswers && ask.kind === 'free_for_trip' && (
          <View style={{ gap: 12 }}>
            <Button icon={Check} label={t('ask.yes')} busy={busy === 'yes'} disabled={busy !== null} onPress={() => void send({ answer: 'yes' })} />
            <Button kind="dark" icon={X} label={t('ask.no')} busy={busy === 'no'} disabled={busy !== null} onPress={() => void send({ answer: 'no' })} />
          </View>
        )}

        {showAnswers && ask.kind === 'office_time' && (
          <View style={{ gap: 12 }}>
            <Txt variant="strong">{t('ask.pickTime')}</Txt>
            <View accessibilityRole="radiogroup" style={styles.times}>
              {timeChoices(now).map((choice) => {
                const on = !typing && picked === choice.at;
                return (
                  <ChoiceChip
                    key={choice.at}
                    mono
                    corner
                    size={22}
                    label={choice.label}
                    selected={on}
                    disabled={busy !== null}
                    onPress={() => {
                      setTyping(false);
                      setBadTime(false);
                      setPicked(choice.at);
                    }}
                    style={styles.time}
                    testID={`ask-time-${choice.label}`}
                  />
                );
              })}
            </View>
            {!typing ? (
              <Button kind="outline" label={t('ask.otherTime')} disabled={busy !== null} onPress={() => {
                setPicked(null);
                setTyping(true);
              }} />
            ) : (
              <TextInput
                value={typed}
                onChangeText={(text) => {
                  setTyped(text.replace(/[^\d:.]/g, '').slice(0, 5));
                  setBadTime(false);
                }}
                keyboardType="numbers-and-punctuation"
                autoFocus
                maxLength={5}
                accessibilityLabel={t('ask.pickTime')}
                style={[styles.input, { fontFamily: fonts.mono }]}
              />
            )}
            {(badTime || (typing && typed.length >= 4 && !typedAt)) && <Notice tone="danger" text={t('common.badTime')} />}
            {sendLabel && <Button label={sendLabel} busy={busy === 'time'} disabled={busy !== null} onPress={sendTime} />}
          </View>
        )}

        {showAnswers && ask.kind === 'where_now' && (
          <View style={{ gap: 8 }}>
            <Button icon={LocateFixed} label={t('ask.shareLocation')} busy={busy === 'location'} disabled={busy !== null} onPress={() => void shareLocation()} />
            <Txt variant="muted">{t('ask.shareNote')}</Txt>
          </View>
        )}

        {/* "Call me" on every question. */}
        {showAnswers && (
          <Button kind="outline" icon={Phone} label={t('ask.callMe')} busy={busy === 'call_me'} disabled={busy !== null} onPress={() => void send({ answer: 'call_me' })} />
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  back: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  given: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.blueChip, borderRadius: 16, padding: 16 },
  times: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  time: { width: '22%', flexGrow: 1, minHeight: 60, borderRadius: 14, justifyContent: 'center', paddingHorizontal: 6 },
  input: { minHeight: 60, borderWidth: 1.5, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 14, fontSize: 24, color: colors.ink, backgroundColor: colors.card },
});
