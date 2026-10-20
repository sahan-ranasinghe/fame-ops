// Office mode (Stage 1, O3 item 3e): a driver-started trip's purpose, the site's TripPurposeCard as one job on its own
// screen (docs/phase8-plan.md §16): Company work or Personal, and for company work a project to attach (job number, short
// name or name; "internal" = Fame internal) with find_project's match line under it, then the sticky Save, disabled with
// its reason until something changes. set_trip_purpose (assign_tasks), only for a trip the driver started (kind self);
// the server's sentence when it refuses. Opened from Task detail's "Driver-started trip" card.

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, TextInput, View } from 'react-native';

import { useLeaveGuard } from '@/components/navigation';
import { ListEmpty, SkeletonRows } from '@/components/patterns/ListState';
import { Button, Segmented, Txt } from '@/components/ui';
import { useOffice, useTool } from '@/office/state';
import { chargedTo, purposeDoneText, purposeInput } from '@/office/taskDetailLogic';
import { projectMatch } from '@/office/trip/formsLogic';
import type { FindProject, FleetError, TaskDetail, TripPurpose, TripPurposeResult } from '@/office/types';
import { BackHeader, ErrorNotice, ListFailed, Screen, StickyActions } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors, fonts } from '@/theme';

/** find_project is asked this long after the last key (the trip editor's lookup). */
const LOOKUP_MS = 450;

export default function TripPurposeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, language } = useApp();
  const { me, api, signOut } = useOffice();
  const router = useRouter();
  const q = useTool<TaskDetail>('task_detail', { task_id: id });
  const task = q.data?.task;
  const was: TripPurpose = task?.purpose ?? 'company';
  const [choice, setChoice] = useState<TripPurpose | null>(null);
  const purpose = choice ?? was;
  const [project, setProject] = useState('');
  const [match, setMatch] = useState<{ text: string; bad: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<FleetError | null>(null);
  const { allowLeave } = useLeaveGuard(choice !== null || !!project.trim(), busy);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mayLookup = me.tools.includes('find_project');

  // The project typed: find_project's match line under the field (the person sees what the server will attach).
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    setMatch(null);
    const text = project.trim();
    if (!text || !mayLookup || /^(fame\s+)?internal$/i.test(text)) return;
    timer.current = setTimeout(() => {
      api.call<FindProject>('find_project', { text })
        .then((p) => {
          const m = projectMatch(p);
          setMatch({ text: m.key === 'none' ? t('office.trip.projectNone') : t(m.key === 'several' ? 'office.trip.projectSeveral' : 'office.trip.projectOne', { text: m.text }), bad: m.bad });
        })
        .catch(() => setMatch(null));
    }, LOOKUP_MS);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [project, mayLookup, api, t]);

  const r = task ? purposeInput(task.id, was, purpose, project) : null;
  const reason = !r ? null : 'error' in r ? t(r.error === 'nothing' ? 'office.task.purposeNothing' : 'office.task.purposeNoProject') : null;

  async function save() {
    if (!r || 'error' in r || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const out = await api.call<TripPurposeResult>('set_trip_purpose', r.input);
      allowLeave();
      Alert.alert(t('office.task.purposeSaved'), purposeDoneText(out, t), [{ text: t('office.common.ok'), onPress: () => router.back() }]);
    } catch (e) {
      setProblem(e as FleetError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <BackHeader title={t('office.task.purposeTitle')} subtitle={task ? [task.title, task.driver].filter(Boolean).join(' · ') : undefined} />
      <Screen bottom={16} refreshing={q.refreshing} onRefresh={() => void q.reload()}>
        {!q.data && !q.error && <SkeletonRows rows={2} lines={2} />}
        {q.error && <ListFailed stale={!!q.data} error={q.error} onRetry={() => void q.reload()} onSignIn={() => void signOut()} />}
        {q.data && (!task || task.kind !== 'self') && <ListEmpty text={t('office.task.purposeNotSelf')} />}
        {q.data && task && task.kind === 'self' && (
          <>
            <Txt variant="muted">
              {[t('office.task.purposeLine', { name: task.driver ? task.driver.split(' ')[0] : t('office.task.theDriver'), purpose: t(`office.task.purpose_${was}`) }), was === 'company' ? t('office.task.purposeCharged', { project: chargedTo(q.data, t) }) : '', t('office.task.purposeApart')].filter(Boolean).join(' ')}
            </Txt>
            <View style={{ gap: 6 }}>
              <Txt variant="strong" size={16}>{t('office.task.purposeQuestion')}</Txt>
              <Segmented<TripPurpose>
                options={[{ value: 'company', label: t('office.task.purpose_company') }, { value: 'personal', label: t('office.task.purpose_personal') }]}
                value={purpose}
                onChange={(v) => { setChoice(v === was ? null : v); if (v === 'personal') setProject(''); }}
              />
            </View>
            {purpose === 'company' && (
              <View style={{ gap: 6 }}>
                <Txt variant="strong" size={16}>{t('office.task.purposeProject')}</Txt>
                <TextInput value={project} onChangeText={setProject} maxLength={200} placeholder={t('office.task.purposeProjectPlaceholder')} placeholderTextColor="#9aa0a6" autoCorrect={false}
                  style={{ minHeight: 52, borderWidth: 1.5, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 14, fontSize: 17, color: colors.ink, backgroundColor: colors.card, fontFamily: language === 'si' ? fonts.sinhalaBody : fonts.body }}
                  accessibilityLabel={t('office.task.purposeProject')} />
                {match ? <Txt variant="small" color={match.bad ? colors.red : colors.green}>{match.text}</Txt> : null}
                <Txt variant="small">{t('office.task.purposeProjectHint')}</Txt>
              </View>
            )}
            {problem && <ErrorNotice error={problem} onRetry={() => void save()} />}
          </>
        )}
      </Screen>
      {task && task.kind === 'self' && me.tools.includes('set_trip_purpose') && (
        <StickyActions>
          <Button label={t('office.common.save')} onPress={() => void save()} busy={busy} disabled={!!reason} style={{ minHeight: 60 }} />
          {reason ? <Txt variant="small" style={{ textAlign: 'center' }}>{reason}</Txt> : null}
        </StickyActions>
      )}
    </View>
  );
}
