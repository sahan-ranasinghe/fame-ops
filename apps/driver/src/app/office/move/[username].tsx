// Office mode (Stage 1, O3 item 4c): Move to vehicle, opened from Live's card for a driver on duty without a task (the
// site's MoveVehicle, /drivers/:username/vehicle). One vehicle, one driver: taking a vehicle someone holds takes it from
// them, and they are told. The search field at the top (plate or model), No vehicle, then every active vehicle from
// list_vehicles (the driver's own first, the free ones, the held ones, the garage; one on another driver's running task
// shown, not selectable), the line under the list saying what Move will do, and the sticky Move, disabled with its reason
// until another choice is made. move_driver_vehicle (assign_tasks or vehicles); the server's sentence when it refuses
// (off duty, a task just started, a vehicle on a running task). A driver on a task gets Task detail's Swap vehicle instead.
// The rules: office/moveLogic.ts.

import { useLocalSearchParams, useRouter } from 'expo-router';
import { type ReactNode, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { useLeaveGuard } from '@/components/navigation';
import { FilterBar } from '@/components/patterns/FilterBar';
import { ListEmpty, SkeletonRows } from '@/components/patterns/ListState';
import { Button, Plate, Txt } from '@/components/ui';
import { dutyOf } from '@/office/liveLogic';
import { canMove, currentChoice, type MoveResult, moveHint, moveInput, moveSentences, NO_VEHICLE, searchRows } from '@/office/moveLogic';
import { useOffice, useTool } from '@/office/state';
import { type SwapRow, swapRows } from '@/office/taskExtrasLogic';
import type { FleetError, LiveDrivers, VehiclesList } from '@/office/types';
import { BackHeader, ErrorNotice, ListFailed, Screen, StickyActions } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

export default function MoveVehicleScreen() {
  const { username } = useLocalSearchParams<{ username: string }>();
  const { t } = useApp();
  const { me, api, signOut } = useOffice();
  const router = useRouter();
  const live = useTool<LiveDrivers>('live_drivers', {});
  const veh = useTool<VehiclesList>('list_vehicles', { filter: 'all' }, { every: 60_000 });
  const d = live.data?.drivers.find((x) => x.username === username) ?? null;
  const rows = useMemo(() => (d && veh.data ? swapRows(veh.data.vehicles, { name: d.driver, vehicle: d.vehicle }) : []), [d, veh.data]);
  const [choice, setChoice] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<FleetError | null>(null);
  const { allowLeave } = useLeaveGuard(choice !== null, busy);
  const first = d ? d.driver.split(' ')[0] : '';
  const duty = d ? dutyOf(d) : null;
  const shown = searchRows(rows, text);
  const hint = moveHint(rows, choice, first);
  const ok = canMove(rows, choice);
  const now = currentChoice(rows);

  const stateText = (r: SwapRow) => {
    const since = r.held_since ? ` · ${t('office.task.swapSince', { time: r.held_since })}` : '';
    const base = r.state === 'current' ? `${t('office.live.moveCurrent')}${since}`
      : r.state === 'on_task' ? [t('office.task.swapOnTask'), r.back_at ? t('office.task.swapBack', { time: r.back_at }) : ''].filter(Boolean).join(' · ')
      : r.state === 'garage' ? [t('office.task.swapGarage'), r.held_by ? t('office.task.swapWith', { name: r.held_by }) : ''].filter(Boolean).join(' · ')
      : r.state === 'held' ? `${t('office.task.swapWith', { name: r.held_by ?? '' })}${since}`
      : t('office.task.swapFree');
    return [base, r.booked].filter(Boolean).join(' · ');
  };

  async function move() {
    if (!d || choice === null || !ok || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const out = await api.call<MoveResult>('move_driver_vehicle', moveInput(d.username, choice));
      allowLeave();
      Alert.alert(t('office.live.movedTitle'), moveSentences(out).map((x) => t(x.key, x.vars)).join(' '), [{ text: t('office.common.ok'), onPress: () => router.back() }]);
    } catch (e) {
      setProblem(e as FleetError);
      void live.reload();
      void veh.reload();
    } finally {
      setBusy(false);
    }
  }

  const option = (key: string, on: boolean, disabled: boolean, body: ReactNode) => (
    <Pressable key={key || 'none'} accessibilityRole="radio" accessibilityState={{ selected: on, disabled }} disabled={disabled} onPress={() => setChoice(key)}
      style={[styles.option, on && styles.optionOn, disabled && { opacity: 0.55 }]} testID={`move-${key || 'none'}`}>
      <View style={[styles.radio, on && { borderColor: colors.ink, backgroundColor: colors.ink }]} />
      <View style={{ flex: 1, gap: 2 }}>{body}</View>
    </Pressable>
  );
  const picked = choice ?? now;

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <BackHeader title={t('office.live.moveVehicle')} subtitle={d?.driver} />
      <Screen bottom={16} refreshing={veh.refreshing} onRefresh={() => void Promise.all([live.reload(), veh.reload()])}>
        {(!live.data || !veh.data) && !live.error && !veh.error && <SkeletonRows rows={4} lines={2} />}
        {live.error && <ListFailed stale={!!live.data} error={live.error} onRetry={() => void live.reload()} onSignIn={() => void signOut()} />}
        {veh.error && <ListFailed stale={!!veh.data} error={veh.error} onRetry={() => void veh.reload()} onSignIn={() => void signOut()} />}
        {live.data && !d && <ListEmpty text={t('office.live.notFound')} />}
        {d && duty === 'off_duty' && <ListEmpty text={t('office.live.moveOffDuty', { name: first })} />}
        {d && duty === 'on_task' && (
          <ListEmpty text={t('office.live.moveOnTaskDriver', { name: first })} action={d.task_id && me.tools.includes('move_driver_vehicle') ? t('office.task.swapVehicle') : undefined}
            onAction={d.task_id ? () => router.replace({ pathname: '/office/task/[id]/swap', params: { id: d.task_id! } }) : undefined} />
        )}
        {d && duty === 'on_duty' && veh.data && (
          <>
            <Txt variant="muted">{t('office.live.moveIntro')}</Txt>
            <FilterBar search={text} onSearch={setText} placeholder={t('office.live.moveSearch')} defs={[]} values={{}} onApply={() => undefined} testID="move-search" />
            <View style={{ gap: 8 }}>
              {!text.trim() && option(NO_VEHICLE, picked === NO_VEHICLE, false, (
                <>
                  <Txt variant="strong">{t('office.live.noVehicle')}</Txt>
                  {now === NO_VEHICLE ? <Txt variant="muted" size={15}>{t('office.live.moveCurrent')}</Txt> : null}
                </>
              ))}
              {shown.map((r) => option(r.reg_no, picked === r.reg_no, r.state === 'on_task', (
                <>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <Plate regNo={r.reg_no} />
                    {r.what ? <Txt variant="muted" size={15}>{r.what}</Txt> : null}
                  </View>
                  <Txt variant={r.state === 'on_task' ? 'strong' : 'muted'} size={15} color={r.state === 'on_task' ? colors.red : r.state === 'held' || r.state === 'garage' ? colors.amberText : colors.muted}>{stateText(r)}</Txt>
                </>
              )))}
              {text.trim() && shown.length === 0 && <ListEmpty text={t('office.live.moveNoMatch')} />}
            </View>
            {problem && <ErrorNotice error={problem} onRetry={() => void move()} />}
          </>
        )}
      </Screen>
      {d && duty === 'on_duty' && veh.data && (
        <StickyActions>
          <Button label={t('office.live.moveConfirm')} onPress={() => void move()} busy={busy} disabled={!ok} style={{ minHeight: 60 }} />
          <Txt variant="small" style={{ textAlign: 'center' }} testID="move-hint">{t(hint.key, hint.vars)}</Txt>
        </StickyActions>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1.5, borderColor: colors.line, borderRadius: 14, padding: 14, backgroundColor: colors.card },
  optionOn: { borderColor: colors.ink },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2.5, borderColor: '#8b9198' },
});
