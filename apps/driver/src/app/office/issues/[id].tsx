// Office mode (Phase 8, O2): one issue (the site's /issues/:id on a phone; no design: the O1 screens' look), from
// issue_history: the pills (severity, status, snoozed), the detail, the facts (opened, opened by, taken by, due, resolved
// or dismissed at and by, updated), the vehicle's plate and the driver with Call and WhatsApp, the resolution, the
// linked task (a link with assign_tasks only) and request (with approve only), the driver's report with its photos
// (the server's 1-hour links, shown inline, a tap opens the photo), the history, and the actions in a sticky bar when
// the person may call update_issue: Take (assign to me, in progress), Add a note, Resolve, Dismiss (each a sheet with
// a text box), Reopen on a closed one. The answer's card is merged in place and the page read again for the events; a
// dropped write shows the error with Try again, never repeated by itself. Back means back.

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, Linking, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ChevronRight, MessageCircle, Phone } from '@/components/icons';
import { ListEmpty, SkeletonRows } from '@/components/patterns/ListState';
import { Sheet } from '@/components/patterns/Sheet';
import { Button, Mono, Plate, Txt } from '@/components/ui';
import { colomboDate, colomboTime } from '@/lib/time';
import {
  dueWords, eventParts, type IssueAction, issueActions, issueFacts, kindText, linksFor, noteRequired, patchHistory, REPORT_STATUS_KEYS, reportCategoryKey,
  severityTone, snoozeParts, statusTone, updateInput,
} from '@/office/issuesLogic';
import { useOffice, useTool } from '@/office/state';
import type { FleetError, Issue, IssueHistory } from '@/office/types';
import { Avatar, BackHeader, Divider, ErrorNotice, ListFailed, Pill, Row, Screen, Section, StickyActions } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors, fonts } from '@/theme';
import { dateWords, whenWords } from '@/lib/dateWords';

/** update_issue's answer. */
interface UpdateIssueAnswer {
  issue: Issue;
  changed?: string[];
}

const open = (url: string) => void Linking.openURL(url).catch(() => undefined);

/** The sheet of the actions that take words: a text box (needed for a note, optional otherwise), confirm, Cancel. */
function NoteSheet({ visible, action, subtitle, onConfirm, onClose }: {
  visible: boolean;
  action: IssueAction | null;
  subtitle?: string | null;
  onConfirm: (action: IssueAction, note: string) => void;
  onClose: () => void;
}) {
  const { t, language } = useApp();
  const [note, setNote] = useState('');
  useEffect(() => {
    if (!visible) setNote('');
  }, [visible]);
  if (!action) return null;
  const required = noteRequired(action);
  return (
    <Sheet
      visible={visible}
      title={t(`office.issues.sheet.${action}Title`)}
      onClose={onClose}
      testID="issue-note-sheet"
      actions={(
        <>
          <Button label={t('common.cancel')} kind="outline" onPress={onClose} style={{ flex: 1, minHeight: 52 }} />
          <Button label={t(`office.issues.sheet.${action}Confirm`)} kind="dark" disabled={required && !note.trim()} onPress={() => onConfirm(action, note)} style={{ flex: 1.4, minHeight: 52 }} />
        </>
      )}
    >
      {subtitle ? <Txt variant="muted" numberOfLines={2}>{subtitle}</Txt> : null}
      <TextInput
        placeholder={t(`office.issues.sheet.${action}Placeholder`)}
        placeholderTextColor="#9aa0a6"
        value={note}
        onChangeText={setNote}
        maxLength={500}
        multiline
        autoFocus
        textAlignVertical="top"
        style={[styles.input, { fontFamily: language === 'si' ? fonts.sinhalaBody : fonts.body }]}
      />
    </Sheet>
  );
}

export default function IssueScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const { t } = useApp();
  const { api, me, signOut } = useOffice();
  const router = useRouter();
  const q = useTool<IssueHistory>('issue_history', { id }, { enabled: !!id });
  // The answer for another issue is never shown under this one.
  const h = q.data && q.data.issue.id === id ? q.data : null;
  const i = h?.issue;
  const [sheet, setSheet] = useState<IssueAction | null>(null);
  const [busy, setBusy] = useState<IssueAction | null>(null);
  const [done, setDone] = useState<IssueAction | null>(null);
  const [problem, setProblem] = useState<{ error: FleetError; action: IssueAction; input: Record<string, unknown> } | null>(null);

  async function change(action: IssueAction, input: Record<string, unknown>) {
    if (busy) return;
    setBusy(action);
    setProblem(null);
    setDone(null);
    try {
      const r = await api.call<UpdateIssueAnswer>('update_issue', input);
      // The card changes at once; the read after brings the events and the server's own words.
      const takenAt = `${colomboDate()} ${colomboTime(Date.now())}`;
      q.patch((p) => patchHistory(p, r.issue, takenAt));
      setDone(action);
      void q.reload();
    } catch (e) {
      setProblem({ error: e as FleetError, action, input });
    } finally {
      setBusy(null);
    }
  }
  function act(action: IssueAction, note = '') {
    const input = updateInput(id, action, note);
    if (input) void change(action, input);
  }

  const actions = i ? issueActions(i, me.tools) : [];
  const links = h ? linksFor(h, me.permissions) : {};
  const facts = i ? issueFacts({ ...i, due: i.due ? dueWords(t, i.due) : i.due }, { system: t('office.issues.system'), nobody: t('office.issues.nobody'), by: (name) => t('office.issues.by', { name }), when: (at) => dateWords(t, at) }) : [];
  const statusWord = (s?: string) => (s ? t(`office.issues.status.${s}`) : '—');
  // A request's "declined" is a decision, not a task without a driver (office.status.declined says "needs a driver").
  const requestStatusWord = (s: string) => (s === 'declined' ? t('office.request.declinedTitle') : t(`office.status.${s}`));
  const snooze = i ? snoozeParts(i) : undefined;
  const eventText = (e: IssueHistory['events'][number]) => {
    const p = eventParts(e);
    const who = p.who ?? t('office.issues.someone');
    switch (p.key) {
      case 'opened':
        return t('office.issues.event.opened', { who });
      case 'assigned':
        return t('office.issues.event.assigned', { who, to: p.to ?? t('office.issues.toNobody') });
      case 'note':
        return t('office.issues.event.note', { who, note: p.note ?? '' });
      case 'status':
        return `${t('office.issues.event.status', { who, to: statusWord(p.to) })}${p.note ? ` · ${p.note}` : ''}`;
      case 'statusFrom':
        return `${t('office.issues.event.statusFrom', { who, from: statusWord(p.from), to: statusWord(p.to) })}${p.note ? ` · ${p.note}` : ''}`;
      case 'autoResolved':
        return t('office.issues.event.autoResolved');
      default:
        return t('office.issues.event.other', { who, action: p.action ?? '' });
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <BackHeader title={i?.title ?? t('office.issues.issue')} subtitle={i ? kindText(i, t) : undefined} />
      <Screen refreshing={q.refreshing} onRefresh={() => void q.reload()} bottom={16}>
        {!q.data && !q.error && <SkeletonRows rows={4} lines={2} />}
        {q.error && <ListFailed stale={!!q.data} error={q.error} onRetry={() => void q.reload()} onSignIn={() => void signOut()} />}
        {q.data && !q.data.issue && <ListEmpty text={t('office.issues.notFound')} />}
        {i && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {i.pre_trip ? <Pill text={t('office.checks.preTrip')} tone="amber" size={15} /> : null}
            <Pill text={t(`office.issues.severity.${i.severity}`)} tone={severityTone(i.severity)} size={15} />
            <Pill text={statusWord(i.status)} tone={statusTone(i.status)} size={15} />
            {snooze && <Pill text={t('office.issues.snoozed')} tone="muted" size={15} />}
          </View>
        )}
        {done && <Txt variant="strong" size={15} color={colors.green}>{t(`office.issues.done.${done}`)}</Txt>}
        {i && (
          <View style={styles.card}>
            {i.detail ? <Txt variant="body" size={17}>{i.detail}</Txt> : null}
            {snooze && (
              <Txt variant="small" color={colors.amberText}>
                {snooze.by ? t('office.issues.snoozedUntilBy', { at: dateWords(t, snooze.until), name: snooze.by }) : t('office.issues.snoozedUntil', { at: dateWords(t, snooze.until) })}
              </Txt>
            )}
            <View style={{ gap: 6 }}>
              {facts.map((f) => (
                <View key={f.key} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                  <Txt variant="muted" size={15} style={{ width: 110 }}>{t(`office.issues.fact.${f.key}`)}</Txt>
                  {/* Round 3: the assignee's photo beside "Taken by". */}
                  {f.key === 'takenBy' && i.assigned_to ? <Avatar name={i.assigned_to.name} size={28} photo={i.assigned_to.photo_url} /> : null}
                  <Txt variant="strong" size={15} style={{ flex: 1 }}>{f.value}</Txt>
                </View>
              ))}
            </View>
            {i.resolution_note ? (
              <View style={styles.resolution}>
                <Txt variant="strong" size={15} color={colors.green}>
                  {i.status === 'dismissed'
                    ? t('office.issues.dismissedBy', { name: i.resolved_by ?? '—', at: dateWords(t, i.resolved_at ?? i.resolved ?? '') })
                    : t('office.issues.resolvedBy', { name: i.resolved_by ?? '—', at: dateWords(t, i.resolved_at ?? i.resolved ?? '') })}
                </Txt>
                <Txt variant="body" size={15}>{i.resolution_note}</Txt>
              </View>
            ) : null}
          </View>
        )}
        {i && (i.vehicle || i.driver) && (
          <View style={styles.card}>
            {i.vehicle ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Txt variant="muted" size={15} style={{ width: 110 }}>{t('office.issues.vehicle')}</Txt>
                <Plate regNo={i.vehicle} />
              </View>
            ) : null}
            {i.driver ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Avatar name={i.driver} size={44} />
                <View style={{ flex: 1 }}>
                  <Txt variant="muted" size={14}>{t('office.issues.driver')}</Txt>
                  <Txt variant="strong" size={17}>{i.driver}</Txt>
                </View>
                {i.driver_links?.call && (
                  <Pressable accessibilityRole="button" accessibilityLabel={t('office.common.call')} onPress={() => open(i.driver_links!.call!)} style={styles.iconBtn}><Phone size={22} color={colors.ink} strokeWidth={2.4} /></Pressable>
                )}
                {i.driver_links?.whatsapp && (
                  <Pressable accessibilityRole="button" accessibilityLabel={t('office.common.whatsapp')} onPress={() => open(i.driver_links!.whatsapp!)} style={styles.iconBtn}><MessageCircle size={22} color={colors.ink} strokeWidth={2.4} /></Pressable>
                )}
              </View>
            ) : null}
          </View>
        )}
        {h && (h.task || h.request) && (
          <View style={styles.card}>
            {h.task && (
              <Row
                title={t('office.issues.taskLink', { title: h.task.title })}
                line={[h.task.driver, h.task.vehicle, h.task.leave_by ? whenWords(t, h.task.leave_by) : ''].filter(Boolean).join(' · ')}
                line2={h.task.status ? t(`office.status.${h.task.status}`) : undefined}
                right={links.task ? <ChevronRight size={22} color={colors.ink} strokeWidth={2.4} /> : undefined}
                onPress={links.task ? () => router.push({ pathname: '/office/task/[id]', params: { id: h.task!.id } }) : undefined}
              />
            )}
            {h.task && h.request && <Divider />}
            {h.request && (
              <Row
                title={t('office.issues.requestLink', { name: h.request.requested_by })}
                line={[h.request.route, h.request.when ? whenWords(t, h.request.when) : ''].filter(Boolean).join(' · ')}
                line2={h.request.status ? requestStatusWord(h.request.status) : undefined}
                right={links.request ? <ChevronRight size={22} color={colors.ink} strokeWidth={2.4} /> : undefined}
                onPress={links.request ? () => router.push({ pathname: '/office/request/[id]', params: { id: h.request!.id } }) : undefined}
              />
            )}
          </View>
        )}
        {h?.report && (
          <Section title={t('office.issues.report')}>
            <View style={{ gap: 6, paddingTop: 4 }}>
              <Txt variant="strong" size={16}>
                {[reportCategoryKey(h.report.category) ? t(reportCategoryKey(h.report.category)!) : null, h.report.driver, t('office.issues.reported', { at: dateWords(t, h.report.reported) })].filter(Boolean).join(' · ')}
              </Txt>
              {REPORT_STATUS_KEYS[h.report.status] ? <Pill text={t(REPORT_STATUS_KEYS[h.report.status])} tone={h.report.status === 'open' ? 'red' : h.report.status === 'in_garage' ? 'amber' : 'muted'} /> : null}
              {h.report.note ? <Txt variant="body" size={16}>{h.report.note}</Txt> : null}
              {h.report.office_note ? <Txt variant="muted" size={15}>{t('office.issues.officeNote', { note: h.report.office_note })}</Txt> : null}
              {h.report.photos.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingTop: 6 }}>
                  {h.report.photos.map((u, n) => (
                    <Pressable key={n} accessibilityRole="imagebutton" accessibilityLabel={t('office.issues.photo', { n: n + 1 })} onPress={() => open(u)}>
                      <Image source={{ uri: u }} style={styles.photo} resizeMode="cover" />
                    </Pressable>
                  ))}
                </ScrollView>
              )}
            </View>
          </Section>
        )}
        {h && (
          <Section title={t('office.issues.history')}>
            {h.events.length === 0 && <ListEmpty text={t('office.issues.noHistory')} />}
            {h.events.map((e, n) => (
              <View key={n}>
                {n > 0 && <Divider />}
                <View style={{ paddingVertical: 10, gap: 2 }}>
                  <Mono size={13} color={colors.muted}>{dateWords(t, e.at)}</Mono>
                  <Txt variant="body" size={16}>{eventText(e)}</Txt>
                </View>
              </View>
            ))}
          </Section>
        )}
        {problem && <ErrorNotice error={problem.error} onRetry={() => void change(problem.action, problem.input)} onSignIn={() => void signOut()} />}
      </Screen>
      {i && actions.length > 0 && (
        <StickyActions>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {actions.map((a) => (
              <Button
                key={a}
                kind={a === 'resolve' || a === 'reopen' ? 'dark' : 'outline'}
                label={t(`office.issues.action.${a}`)}
                busy={busy === a}
                disabled={busy !== null && busy !== a}
                onPress={() => (a === 'take' ? act('take') : setSheet(a))}
                style={[{ flexGrow: 1, flexBasis: '45%', minHeight: 52 }, a === 'dismiss' && { borderColor: colors.red }]}
              />
            ))}
          </View>
        </StickyActions>
      )}
      <NoteSheet
        visible={sheet !== null}
        action={sheet}
        subtitle={i?.title ?? null}
        onConfirm={(action, note) => {
          setSheet(null);
          act(action, note);
        }}
        onClose={() => setSheet(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1, borderRadius: 18, padding: 16, gap: 12 },
  resolution: { backgroundColor: colors.greenChip, borderRadius: 12, padding: 12, gap: 4 },
  iconBtn: { width: 52, height: 52, borderRadius: 14, borderWidth: 1.5, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  photo: { width: 150, height: 112, borderRadius: 12, backgroundColor: '#ebe9e3' },
  input: { minHeight: 96, borderWidth: 1.5, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 17, color: colors.ink },
});
