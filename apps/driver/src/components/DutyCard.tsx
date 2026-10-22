// The driver's day on Today (Phase 7, docs/phase7-plan.md §1 and §2): whether the driver is at work, and with which
// vehicle.
// Round 4–7, item 12 (design/mockups/2026-10-22, mockup 5): the old dark header's duty card is now two tiles, the same
// actions in the mockup's style:
//   On duty (blue): "On duty", "since 08:12 · Office can see you", the switch: Finish work (asks first; not while a task
//             runs: "Finish the task first." under the tiles, as before).
//   Off duty (grey): "Off duty", "Start work to record trips and mileage.", the switch and Start work (the vehicle picker
//             in start mode).
//   The vehicle (white): the van, the vehicle check's state while the office's check is on ("✓ Checked" green, "Problem
//             reported" red, "Check needed" amber: it opens the check, app/vehicle-check.tsx, as Today's check card did),
//             the plate chip, "Toyota HiAce · Change" (Change vehicle; not while a task runs). No vehicle: "No vehicle ·
//             Choose" (off duty: the vehicle is chosen at Start work).
// Under the tiles, two notices: another driver took my vehicle (tap → choose one), and the server ended my duty (the
// day's cut-off or the office).

import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';

import { Check, Play, Radio, RadioOff, ShieldCheck, TriangleAlert, Van, X } from '@/components/icons';
import { Plate, Txt } from '@/components/ui';
import { colomboTime } from '@/lib/time';
import { checkToday } from '@/lib/vehicleCheck';
import { useApp } from '@/state/app';
import { colors, hoverStyle } from '@/theme';

/** Today's two tiles: on / off duty and the vehicle held. */
export function DutyTiles() {
  const { t, sharing, dutySince, tasks, finishWork } = useApp();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [taskFirst, setTaskFirst] = useState(false);
  const taskRunning = tasks.some((task) => task.status === 'in_progress');
  const startWork = () => router.push({ pathname: '/vehicle', params: { mode: 'start' } });

  function confirmFinish() {
    setTaskFirst(false);
    Alert.alert(t('duty.finishConfirm'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('duty.finishConfirmYes'),
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          const outcome = await finishWork();
          setBusy(false);
          setTaskFirst(outcome === 'task');
        },
      },
    ]);
  }

  return (
    <View style={{ gap: 8 }}>
      <View style={styles.tiles}>
        {sharing ? (
          <View style={[styles.tile, styles.onTile]} testID="duty-tile">
            <View style={styles.tileTop}>
              <Radio size={22} color="#ffffff" strokeWidth={2} />
              {/* The task holds the driver at work: no Finish work while it runs (the server refuses it too). */}
              <DutySwitch
                on
                busy={busy}
                disabled={taskRunning}
                label={t('today.sharing')}
                hint={t('duty.finishWork')}
                onPress={confirmFinish}
                testID="duty-switch"
              />
            </View>
            <View>
              <Txt variant="strong" size={15} color="#ffffff">{t('today.sharing')}</Txt>
              <Txt variant="small" size={12} color={colors.onBlueSoft}>
                {[dutySince ? t('todayCard.since', { time: colomboTime(dutySince) }) : null, t('duty.officeCanSee')].filter(Boolean).join(' · ')}
              </Txt>
            </View>
          </View>
        ) : (
          <View style={[styles.tile, styles.offTile]} testID="duty-tile">
            <View style={styles.tileTop}>
              <RadioOff size={22} color={colors.muted} strokeWidth={2} />
              <DutySwitch on={false} label={t('duty.offDuty')} hint={t('duty.startWork')} onPress={startWork} testID="duty-switch" />
            </View>
            <View>
              <Txt variant="strong" size={15}>{t('duty.offDuty')}</Txt>
              <Txt variant="small" size={12}>{t('duty.offDutyHint')}</Txt>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={startWork}
              style={(state) => [styles.startWork, hoverStyle(state), state.pressed && { opacity: 0.8 }]}
              testID="duty-start-work"
            >
              <Play size={16} color={colors.ink} strokeWidth={2.6} />
              <Txt variant="strong" size={14} style={{ flexShrink: 1 }}>{t('duty.startWork')}</Txt>
            </Pressable>
          </View>
        )}
        <VehicleTile taskRunning={taskRunning} />
      </View>
      {sharing && (taskRunning || taskFirst) && <Txt variant="small" style={{ marginHorizontal: 4 }}>{t('duty.finishTaskFirst')}</Txt>}
    </View>
  );
}

/** The duty switch (Material's switch: the track and its knob), 44 × 26 drawn inside a 48 dp target. */
function DutySwitch({ on, busy = false, disabled = false, label, hint, onPress, testID }: {
  on: boolean;
  busy?: boolean;
  disabled?: boolean;
  label: string;
  hint: string;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ checked: on, disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      hitSlop={8}
      testID={testID}
      style={(state) => [styles.switchTarget, hoverStyle(state)]}
    >
      <View style={[styles.track, on ? styles.trackOn : styles.trackOff, disabled && { opacity: 0.6 }]}>
        {busy
          ? <ActivityIndicator size="small" color={colors.blue} />
          : <View style={[styles.knob, on ? styles.knobOn : styles.knobOff]} />}
      </View>
    </Pressable>
  );
}

/** The vehicle held: its check today, the plate, the model and Change. */
function VehicleTile({ taskRunning }: { taskRunning: boolean }) {
  const { t, me, sharing, vehicle, settings, vehicleChecks, checkNeeded, heldHow } = useApp();
  const router = useRouter();
  const held = sharing ? vehicle : null;
  // Off duty the vehicle is chosen at Start work; on duty it is changed (not while a task holds it).
  const choose = () => router.push({ pathname: '/vehicle', params: { mode: sharing ? 'change' : 'start' } });
  const canChoose = !taskRunning;
  const needed = held ? checkNeeded(held.id) : false;
  const today = held && settings.vehicle_check && !needed ? checkToday(held.id, vehicleChecks, Date.now(), me?.id) : null;
  const openCheck = () => held && router.push({ pathname: '/vehicle-check', params: { vehicleId: held.id, how: heldHow(held.id) } });

  return (
    <View style={[styles.tile, styles.vehicleTile]} testID="vehicle-tile">
      <View style={styles.tileTop}>
        <Van size={22} color={colors.iconInk} strokeWidth={2} />
        {needed && held ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${t('vehicleCheck.cardTitle', { plate: held.reg_no })}. ${t('vehicleCheck.cardBody')}`}
            onPress={openCheck}
            hitSlop={10}
            style={(state) => [styles.badge, { backgroundColor: colors.amberSoft }, hoverStyle(state), state.pressed && { opacity: 0.8 }]}
            testID="vehicle-check-now"
          >
            <ShieldCheck size={14} color={colors.amberText} strokeWidth={2.6} />
            <Txt variant="strong" size={12} color={colors.amberText} numberOfLines={2} style={{ flexShrink: 1 }}>{t('todayCard.checkNeeded')}</Txt>
          </Pressable>
        ) : today ? (
          <View style={styles.badgeText} testID="vehicle-check-state">
            {today.result === 'ok'
              ? <Check size={14} color={colors.greenText} strokeWidth={2.6} />
              : <TriangleAlert size={14} color={colors.red} strokeWidth={2.4} />}
            <Txt variant="strong" size={12} color={today.result === 'ok' ? colors.greenText : colors.red} numberOfLines={2} style={{ flexShrink: 1 }}>
              {t(today.result === 'ok' ? 'todayCard.checked' : 'todayCard.checkProblem')}
            </Txt>
          </View>
        ) : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={held ? `${held.reg_no} ${held.make_model ?? ''}`.trim() : t('duty.noVehicle')}
        accessibilityHint={canChoose ? t(held ? 'vehicle.change' : 'today.choose') : undefined}
        disabled={!canChoose}
        onPress={choose}
        style={(state) => [hoverStyle(state), state.pressed && { opacity: 0.8 }]}
        testID="vehicle-tile-change"
      >
        {held ? (
          <Plate regNo={held.reg_no} />
        ) : (
          <Txt variant="strong" size={14}>{t('duty.noVehicle')}</Txt>
        )}
        <Txt variant="small" size={12} numberOfLines={2} style={{ marginTop: 4 }}>
          {[held?.make_model ?? null, canChoose ? t(held ? 'today.change' : 'today.choose') : null].filter(Boolean).join(' · ')}
        </Txt>
      </Pressable>
    </View>
  );
}

/** The notices about the driver's day under the tiles: a vehicle taken over, a duty ended by the server. */
export function DutyNotices() {
  const { t, vehicleTaken, dismissVehicleTaken, dutyEnded, clearDutyEnded } = useApp();
  const router = useRouter();
  const ended = dutyEnded && dutyEnded.reason !== 'driver' ? dutyEnded : null;
  if (!vehicleTaken && !ended) return null;
  return (
    <>
      {vehicleTaken && (
        <View style={styles.notice}>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/vehicle', params: { mode: 'change' } })}
            style={{ flex: 1 }}
          >
            <Txt variant="strong" size={16} color={colors.amberText}>
              {t('vehicle.takenBanner', { plate: vehicleTaken.plate, name: vehicleTaken.name })}
            </Txt>
          </Pressable>
          <Close label={t('common.close')} onPress={dismissVehicleTaken} />
        </View>
      )}
      {ended && (
        <View style={styles.notice}>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt variant="strong" size={16} color={colors.amberText}>{t('duty.autoOutTitle')}</Txt>
            <Txt variant="body" size={15} color={colors.ink}>
              {t(ended.reason === 'admin' ? 'duty.officeOutBody' : 'duty.autoOutBody', { time: colomboTime(ended.at) })}
            </Txt>
          </View>
          <Close label={t('common.close')} onPress={clearDutyEnded} />
        </View>
      )}
    </>
  );
}

function Close({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={8} style={styles.close}>
      <X size={22} color={colors.amberText} strokeWidth={2.6} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // The mockup's two tiles side by side (each half the width, the same height).
  tiles: { flexDirection: 'row', gap: 10, alignItems: 'stretch' },
  tile: { flex: 1, minWidth: 0, borderRadius: 16, padding: 14, gap: 10 },
  onTile: { backgroundColor: colors.blue },
  offTile: { backgroundColor: '#e7e5df' },
  vehicleTile: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardLine },
  tileTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 26 },
  switchTarget: { minWidth: 48, minHeight: 32, alignItems: 'flex-end', justifyContent: 'center' },
  track: { width: 44, height: 26, borderRadius: 13, justifyContent: 'center', paddingHorizontal: 3 },
  trackOn: { backgroundColor: '#ffffff', alignItems: 'flex-end' },
  trackOff: { backgroundColor: '#c9c6be', alignItems: 'flex-start' },
  knob: { width: 20, height: 20, borderRadius: 10 },
  knobOn: { backgroundColor: colors.blue },
  knobOff: { backgroundColor: '#ffffff' },
  startWork: { minHeight: 40, borderRadius: 12, backgroundColor: colors.amber, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 8 },
  // The check's state beside the van: it shrinks (and wraps) before it leaves the tile (Sinhala at 390 px).
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 10, paddingHorizontal: 8, minHeight: 26, flexShrink: 1, marginLeft: 8 },
  badgeText: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1, marginLeft: 8 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, paddingVertical: 12, paddingLeft: 14, paddingRight: 6, backgroundColor: colors.amberSoft },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
