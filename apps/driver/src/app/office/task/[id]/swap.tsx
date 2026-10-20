// Office mode (Phase 8, O2, item 5): Swap vehicle during a task (a breakdown): the task goes on in another vehicle
// through move_driver_vehicle (the site's MoveVehicle swap), the readings at the swap typed here or left for the driver's
// phone, a reason for the history. The list is every active vehicle from list_vehicles: the task's vehicle first (shown,
// not offered), the free ones, the ones someone else holds (they are told), the garage, and the ones on another running
// task (not selectable). Not designed (docs/phase8-plan.md section 11).

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { useLeaveGuard } from '@/components/navigation';
import { showSnackbar } from '@/components/patterns/Snackbar';
import { ChoiceRow } from '@/components/patterns/Select';
import { Button, Mono, Plate, Txt } from '@/components/ui';
import { setSavedNotice } from '@/office/savedNotice';
import { useOffice, useTool } from '@/office/state';
import { canSwap, type SwapFields, type SwapResult, swapInput, swapPlates, swapRows, typedKm } from '@/office/taskExtrasLogic';
import { plateOf } from '@/office/taskLogic';
import type { FleetError, TaskDetail, VehiclesList } from '@/office/types';
import { BackHeader, Empty, ErrorNotice, Loading, Screen, StickyActions } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors, fonts } from '@/theme';

export default function SwapVehicleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, language } = useApp();
  const { api, signOut } = useOffice();
  const router = useRouter();
  const q = useTool<TaskDetail>('task_detail', { task_id: id });
  const task = q.data?.task;
  const veh = useTool<VehiclesList>('list_vehicles', { filter: 'all' }, { every: 60_000 });
  const rows = useMemo(() => (task && veh.data ? swapRows(veh.data.vehicles, { name: task.driver ?? '', vehicle: task.vehicle }) : []), [task, veh.data]);
  const [choice, setChoice] = useState<string | null>(null);
  const [f, setF] = useState<SwapFields>({ oldKm: '', newKm: '', reason: '' });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<FleetError | null>(null);
  const [why, setWhy] = useState<string | null>(null);
  const running = task?.status === 'in_progress';
  const { allowLeave } = useLeaveGuard(!!choice || !!f.oldKm || !!f.newKm || !!f.reason, busy);
  const picked = choice ? rows.find((r) => r.reg_no === choice) : undefined;
  const mono = { fontFamily: fonts.monoSemiBold };
  const bodyFont = { fontFamily: language === 'si' ? fonts.sinhalaBody : fonts.body };

  const stateText = (r: (typeof rows)[number]) => {
    const since = r.held_since ? ` · ${t('office.task.swapSince', { time: r.held_since })}` : '';
    const base = r.state === 'current' ? t('office.task.swapCurrent')
      : r.state === 'on_task' ? [t('office.task.swapOnTask'), r.back_at ? t('office.task.swapBack', { time: r.back_at }) : ''].filter(Boolean).join(' · ')
      : r.state === 'garage' ? [t('office.task.swapGarage'), r.held_by ? t('office.task.swapWith', { name: r.held_by }) : ''].filter(Boolean).join(' · ')
      : r.state === 'held' ? `${t('office.task.swapWith', { name: r.held_by ?? '' })}${since}`
      : t('office.task.swapFree');
    return [base, r.booked].filter(Boolean).join(' · ');
  };

  async function swap() {
    if (!task || busy) return;
    const r = swapInput(task.driver ?? '', choice, f);
    if ('error' in r) {
      setWhy(r.error === 'pick' ? t('office.task.swapPick') : t(r.error === 'oldKm' ? 'office.task.swapOldKmBad' : 'office.task.swapNewKmBad', { why: t(`office.task.km_${r.detail ?? 'number'}`) }));
      return;
    }
    setWhy(null);
    setProblem(null);
    setBusy(true);
    try {
      const out = await api.call<SwapResult>('move_driver_vehicle', r.input);
      allowLeave();
      const plates = swapPlates(out);
      const reading = (v?: string) => {
        const km = typedKm(v);
        return km !== null ? t('office.task.swapTyped', { km: km.toLocaleString('en-US') }) : t('office.task.swapOnPhone');
      };
      const lines = [
        t('office.task.swapDoneBody', { plate: plates.to }),
        plates.from ? t('office.task.swapEndOf', { plate: plates.from, reading: reading(out.readings?.old_end) }) : '',
        t('office.task.swapStartOf', { plate: plates.to, reading: reading(out.readings?.new_start) }),
        out.note ?? '',
      ].filter(Boolean);
      // Hotfix O2-H2, Part 1b: back to the task, a snackbar, the readings wait on the task.
      setSavedNotice(`task:${id}`, lines, t('office.task.swapDoneTitle'));
      router.dismissTo({ pathname: '/office/task/[id]', params: { id } });
      showSnackbar({ text: t('office.task.swapDoneTitle') });
    } catch (e) {
      setProblem(e as FleetError);
      void q.reload();
      void veh.reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <BackHeader title={t('office.task.swapVehicle')} subtitle={task ? [task.title, task.driver].filter(Boolean).join(' · ') : undefined} />
      <Screen bottom={16} refreshing={veh.refreshing} onRefresh={() => void Promise.all([q.reload(), veh.reload()])}>
        {(q.loading || veh.loading) && rows.length === 0 && <Loading text={t('office.common.loading')} />}
        {q.error && !task && <ErrorNotice error={q.error} onRetry={() => void q.reload()} onSignIn={() => void signOut()} />}
        {veh.error && !veh.data && <ErrorNotice error={veh.error} onRetry={() => void veh.reload()} onSignIn={() => void signOut()} />}
        {q.data && !task && <Empty text={t('office.task.notFound')} />}
        {task && !running && <Empty text={t('office.task.swapNotRunning')} />}
        {task && running && (
          <>
            <Txt variant="muted">{t('office.task.swapIntro')}</Txt>
            <View accessibilityRole="radiogroup" style={{ gap: 8 }}>
              {rows.map((r) => {
                const on = choice === r.reg_no;
                return (
                  <ChoiceRow key={r.reg_no} selected={on} onPress={() => setChoice(r.reg_no)} disabled={r.disabled} accessibilityLabel={`${r.reg_no}, ${stateText(r)}`} testID={`swap-row-${r.reg_no}`}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <Plate regNo={plateOf(r.reg_no)} />
                      {r.what ? <Txt variant="muted" size={15}>{r.what}</Txt> : null}
                    </View>
                    <Txt variant={r.state === 'on_task' ? 'strong' : 'muted'} size={15} color={r.state === 'on_task' ? colors.red : r.state === 'held' || r.state === 'garage' ? colors.amberText : colors.muted}>{stateText(r)}</Txt>
                  </ChoiceRow>
                );
              })}
            </View>
            {picked && !picked.disabled && (
              <Txt variant="strong" size={15}>{picked.held_by ? t('office.task.swapTakes', { plate: picked.reg_no, name: picked.held_by }) : t('office.task.swapGoesOn', { plate: picked.reg_no })}</Txt>
            )}
            <View style={{ gap: 10 }}>
              <Txt variant="label" color={colors.muted}>{t('office.task.swapReadings').toUpperCase()}</Txt>
              <Txt variant="small">{t('office.task.swapReadingsNote')}</Txt>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1, gap: 4 }}>
                  <Txt variant="small">{t('office.task.swapOldKm', { plate: task.vehicle ? plateOf(task.vehicle) : '' })}</Txt>
                  <TextInput value={f.oldKm} onChangeText={(v) => setF({ ...f, oldKm: v })} keyboardType="number-pad" placeholder="—" placeholderTextColor="#9aa0a6" style={[styles.km, mono]} accessibilityLabel={t('office.task.swapOldKm', { plate: '' })} />
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <Txt variant="small">{t('office.task.swapNewKm', { plate: picked && !picked.disabled ? picked.reg_no : '' })}</Txt>
                  <TextInput value={f.newKm} onChangeText={(v) => setF({ ...f, newKm: v })} keyboardType="number-pad" placeholder="—" placeholderTextColor="#9aa0a6" style={[styles.km, mono]} accessibilityLabel={t('office.task.swapNewKm', { plate: '' })} />
                </View>
              </View>
              <TextInput value={f.reason} onChangeText={(v) => setF({ ...f, reason: v })} placeholder={t('office.task.swapReason')} placeholderTextColor="#9aa0a6" maxLength={200} style={[styles.input, bodyFont]} />
            </View>
            {why && <Txt variant="strong" color={colors.red}>{why}</Txt>}
            {problem && <ErrorNotice error={problem} onRetry={() => void swap()} />}
          </>
        )}
      </Screen>
      {task && running && (
        <StickyActions>
          <Button label={t('office.task.swapConfirm')} onPress={() => void swap()} busy={busy} disabled={!canSwap(rows, choice)} style={{ minHeight: 60 }} />
        </StickyActions>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  km: { minHeight: 56, borderWidth: 1.5, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 12, fontSize: 22, color: colors.ink, backgroundColor: colors.card },
  input: { minHeight: 52, borderWidth: 1.5, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 14, fontSize: 17, color: colors.ink, backgroundColor: colors.card },
});
