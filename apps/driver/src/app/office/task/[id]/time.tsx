// Office mode (Phase 8, O2, item 5; Hotfix O2-H1 Part B): Change the task (the site's TaskEdit) through update_task with
// the plan version it was shown with (a stale one is refused: the page loads the task again). On the screen: the title,
// the day, Leave by and Vehicle free by, the passengers; under More details the contact and the notes; then the driver
// (Who's available, the best match marked; Ask drivers) and the vehicle (Keep, the new driver's own, On the day / Any
// type with the setting, Choose… from the four groups). A running task keeps its day, leave-by and driver: the words,
// the end and the vehicle only. One sticky Save, disabled until something changed, with the reason under it.
// Round 4–7 (6): Who rides under the passengers (the names alone go as task_id, plan_version and passenger_list); hidden
// with the passengers switch off.

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { ChevronDown, ChevronUp } from '@/components/icons';
import { useLeaveGuard } from '@/components/navigation';
import { showSnackbar } from '@/components/patterns/Snackbar';
import { AskDriversSheet } from '@/components/office/AskDriversSheet';
import { MoreDetails, Stepper } from '@/components/office/Controls';
import { DriverRows } from '@/components/office/DriverRows';
import { PassengersField } from '@/components/office/Passengers';
import { passengersOn } from '@/office/trip/passengersLogic';
import { HolderStrip } from '@/components/office/HolderParts';
import { TripDayPicker } from '@/components/patterns/Calendar';
import { TimeField } from '@/components/patterns/TimeField';
import { DepartureNote } from '@/components/office/TripShell';
import { ChoiceChip, ChoiceRow } from '@/components/patterns/Select';
import { Button, Field, Plate, Txt } from '@/components/ui';
import { ListEmpty, SkeletonRows } from '@/components/patterns/ListState';
import { askTargets } from '@/office/askLogic';
import { availabilityText } from '@/office/availabilityWords';
import { holderOf, wantedOfWindow } from '@/office/holderLogic';
import { setSavedNotice } from '@/office/savedNotice';
import { useOffice, useTool } from '@/office/state';
import { type ChangeFields, changeFieldsOf, changeTaskInput, timeLocked } from '@/office/taskExtrasLogic';
import { availabilityArgsForTask, plateOf } from '@/office/taskLogic';
import { checkDeparture, departurePlan } from '@/office/trip/departureLogic';
import { groupRows, vehicleLine } from '@/office/trip/formsLogic';
import { departureText } from '@/office/trip/words';
import { ANY_TYPES, anyValue, ON_THE_DAY } from '@/office/trip/vehicleChoiceLogic';
import type { Availability, Conflict, FleetError, SettingsResult, SuggestedVehicle, TaskDetail, UpdateTaskResult } from '@/office/types';
import { BackHeader, ErrorNotice, Screen, StickyActions } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

/** HH:MM rounded down to 5 minutes (a plan moving by a minute does not ask Who's available again). */
const floor5 = (t: string) => { const m = /^(\d{2}):(\d{2})$/.exec(t.trim()); return m ? `${m[1]}:${String(Math.floor(Number(m[2]) / 5) * 5).padStart(2, '0')}` : t; };

export default function ChangeTaskScreen() {
  // back=1: opened from Give a driver (design 11, Move the time): the save goes back there, not to the task.
  const { id, back } = useLocalSearchParams<{ id: string; back?: string }>();
  const { t } = useApp();
  const { api, me, signOut } = useOffice();
  const router = useRouter();
  const q = useTool<TaskDetail>('task_detail', { task_id: id });
  const p = q.data;
  const task = p?.task;
  const settings = useTool<SettingsResult>('get_settings', {}, { enabled: me.tools.includes('get_settings') });
  const [f, setF] = useState<ChangeFields | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<FleetError | null>(null);
  const [why, setWhy] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [asking, setAsking] = useState(false);
  const [driverName, setDriverName] = useState('');
  const locked = task ? timeLocked(task) : false;
  const { allowLeave } = useLeaveGuard(!!task && !!f && JSON.stringify(f) !== JSON.stringify(changeFieldsOf(task)), busy);
  // Who's available for the task's window as the form has it (the site's TaskEdit): not while it runs.
  const availArgs = p && !locked
    ? availabilityArgsForTask({ ...p, task: { ...p.task, date: f?.date || p.task.date, leave_by: f?.time ? undefined : p.task.leave_by, time: f?.time ? floor5(f.time) : p.task.time, end_by: f?.end || p.task.end_by } })
    : null;
  const avail = useTool<Availability>('availability', availArgs ?? {}, { enabled: !!availArgs && me.tools.includes('availability'), every: 60_000 });
  const mayAsk = me.tools.includes('ask_drivers');

  // The form starts from the task as it is now (once; a reload after a stale version starts it again).
  useEffect(() => {
    if (task) setF(changeFieldsOf(task));
  }, [task?.id, task?.plan_version]); // eslint-disable-line react-hooks/exhaustive-deps

  const onDay = settings.data?.settings.vehicle_on_the_day === true;
  const picked = f?.driver ? avail.data?.drivers.find((x) => x.username === f.driver) : undefined;
  const currentPlate = task?.vehicle ? plateOf(task.vehicle) : '';
  const groups = avail.data?.vehicles.groups;
  const rows = groupRows(groups ? { groups, vehicles: [] } : null);
  const set = (patch: Partial<ChangeFields>) => setF((x) => (x ? { ...x, ...patch } : x));
  // A new driver brings their vehicle (the site's vehicleToSend): named in the call when it differs from the task's.
  const vehicleToSend = f?.vehicle || (picked?.vehicle && picked.vehicle.reg_no !== currentPlate ? picked.vehicle.reg_no : '');
  // Round 4–7 (6): the passengers switch off: the names are left as they are.
  const riding = passengersOn(settings.data);
  const noNames = riding ? {} : { riders: undefined };
  const result = task && f ? changeTaskInput(task.id, task.plan_version ?? 0, { ...f, vehicle: vehicleToSend, ...noNames }, task) : null;
  const changed = !!result && 'input' in result;
  // The leave-by checked at once against the stops' arrive-by times (the site's TaskEdit).
  const check = !locked && p && f ? checkDeparture(f.time, departurePlan(p.timeline, p.plan?.buffer_min)) : null;

  async function save() {
    if (!task || !f || busy) return;
    const r = changeTaskInput(task.id, task.plan_version ?? 0, { ...f, vehicle: vehicleToSend, ...noNames }, task);
    if ('error' in r) {
      setWhy(t(r.error === 'nothing' ? 'office.task.timeNothing' : 'office.task.timeEndBeforeStart'));
      return;
    }
    setWhy(null);
    setProblem(null);
    setBusy(true);
    try {
      const out = await api.call<UpdateTaskResult & { warnings?: string[] }>('update_task', r.input);
      allowLeave();
      const warnings = out.warnings ?? [];
      const conflicts = (out as { conflicts?: Conflict[] }).conflicts;
      // Hotfix O2-H2, Part 1b: back to the task, a snackbar ("The driver is told."), the warnings wait on the task. Round 4–7
      // (7): with the conflicts that name who holds the driver or vehicle (Call, WhatsApp, Ask for it).
      setSavedNotice(`task:${id}`, [...warnings, ...(conflicts ?? []).map((c) => c.text)], undefined, conflicts);
      if (back === '1' && router.canGoBack()) router.back();
      else router.dismissTo({ pathname: '/office/task/[id]', params: { id } });
      showSnackbar({ text: [driverName && r.input.driver ? t('office.task.changedSentTitle', { name: driverName }) : t('office.task.changedTitle'), t('office.task.timeSavedBody')].join(' · ') });
    } catch (e) {
      setProblem(e as FleetError);
      void q.reload();
    } finally {
      setBusy(false);
    }
  }

  const vehicleRow = (v: SuggestedVehicle, disabled: boolean, reason?: string) => (
    <ChoiceRow key={v.reg_no} selected={f?.vehicle === v.reg_no} onPress={() => { set({ vehicle: v.reg_no }); setChoosing(false); }} disabled={disabled} disabledReason={reason} leading={<Plate regNo={v.reg_no} />} mark="end" accessibilityLabel={v.reg_no} testID={`vehicle-row-${v.reg_no}`}>
      <Txt variant="muted" size={15} color={v.pick === 'no' ? colors.red : v.pick === 'possible' ? colors.amberText : colors.muted}>{vehicleLine(v, (n) => t('office.trip.seats', { n }), (line) => availabilityText(t, line))}</Txt>
      {v.assigned_to ? <Txt variant="small">{[t('office.trip.assignedTo', { name: v.assigned_to }), v.custodian_note, v.note].filter(Boolean).join(' · ')}</Txt> : null}
    </ChoiceRow>
  );
  // Round 4–7 (7): a busy vehicle's holder under its row (never this task's own), with Ask for it for the new time.
  const vehicleHolder = (v: SuggestedVehicle) => {
    const h = holderOf(v);
    return h && task && h.task_id !== task.id ? <HolderStrip key={`${v.reg_no}-holder`} holder={h} resource="vehicle" what={v.reg_no} wanted={wantedOfWindow(avail.data?.window)} testID={`vehicle-holder-${v.reg_no}`} /> : null;
  };
  // The shared chip (patterns/Select): the check, the tint and the border when picked.
  const chip = (key: string, on: boolean, label: string, onPress: () => void, plate?: string) => (
    <ChoiceChip key={key} selected={on} label={label} onPress={onPress} before={plate ? <Plate regNo={plate} /> : undefined} />
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <BackHeader title={t('office.task.changeTask')} subtitle={task?.title} />
      <Screen bottom={16}>
        {q.loading && !task && <SkeletonRows rows={3} lines={2} />}
        {q.error && !task && <ErrorNotice error={q.error} onRetry={() => void q.reload()} onSignIn={() => void signOut()} />}
        {q.data && !task && <ListEmpty text={t('office.task.notFound')} />}
        {task && f && (
          <>
            {task.needs_driver && (
              <View style={styles.needs}>
                <Txt variant="strong" color={colors.red}>{task.needs_driver.reason === 'declined' ? t('office.task.declinedWhy', { name: task.driver ?? '', why: task.needs_driver.reason_text ?? '' }) : t('office.task.notAccepted', { name: task.driver ?? '' })}</Txt>
              </View>
            )}
            <View style={styles.card}>
              <Field label={t('office.trip.title')} value={f.title} onChangeText={(title) => set({ title })} maxLength={120} />
              {locked ? (
                <Txt variant="muted">{t('office.task.timeLocked', { time: task.leave_by ?? task.time ?? task.start })}</Txt>
              ) : (
                <>
                  <Txt variant="label" color={colors.muted}>{t('office.task.timeDay').toUpperCase()}</Txt>
                  <TripDayPicker value={f.date} onChange={(date) => set({ date })} testID="task-day" />
                  <TimeField label={t('office.task.timeLeave')} value={f.time} onCommit={(v) => set({ time: v })} testID="time-leave" />
                  {check && check.kind === 'late' && <DepartureNote text={departureText(t, check)} tone={check.tone} useLabel={t('office.trip.use', { time: check.leaveBy })} onUse={() => set({ time: check.leaveBy })} />}
                  {check && check.kind === 'early' && <Txt variant="small">{departureText(t, check)}</Txt>}
                  <TimeField label={t('office.trip.freeBy')} value={f.end} onCommit={(v) => set({ end: v })} testID="time-end" />
                </>
              )}
              <Stepper label={t('office.trip.passengers')} value={f.passengers} onChange={(passengers) => set({ passengers })} />
              {riding && <PassengersField value={f.riders ?? []} onChange={(riders) => set({ riders })} count={f.passengers} />}
              <MoreDetails filled={!!(f.contactName || f.contactPhone || f.notes)} testID="change-details">
                <Field label={t('office.trip.contactName')} value={f.contactName} onChangeText={(contactName) => set({ contactName })} maxLength={120} />
                <Field label={t('office.trip.contactPhone')} mono value={f.contactPhone} onChangeText={(contactPhone) => set({ contactPhone })} keyboardType="phone-pad" maxLength={30} />
                <View>
                  <Txt variant="strong" size={16} style={{ marginBottom: 8 }}>{t('office.trip.notes')}</Txt>
                  <TextInput value={f.notes} onChangeText={(notes) => set({ notes })} multiline maxLength={1000} style={styles.notes} placeholderTextColor="#9aa0a6" placeholder={t('office.trip.notesPlaceholder')} />
                </View>
              </MoreDetails>
              <Txt variant="small">{t('office.task.timeNote')}</Txt>
            </View>

            {!locked && (
              <DriverRows data={avail.data} loading={avail.loading} error={avail.error} picked={f.driver} onPick={(x) => { set({ driver: x.username ?? '', vehicle: '' }); setDriverName(x.name); }} onRetry={() => void avail.reload()} onSignIn={() => void signOut()} onAsk={mayAsk ? () => setAsking(true) : undefined} noWindow={!availArgs} onDay={onDay} ignoreTask={task.id} />
            )}

            {!locked && <View style={styles.card}>
              <Txt variant="label" color={colors.muted}>{t('office.trip.vehicle').toUpperCase()}</Txt>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {chip('keep', f.vehicle === '' && !picked?.vehicle, currentPlate ? t('office.task.keepVehicle', { plate: currentPlate }) : task.vehicle_text ? t('office.task.keepVehicle', { plate: task.vehicle_text }) : t('office.vehicles.keep'), () => set({ vehicle: '' }))}
                {picked?.vehicle && chip('own', f.vehicle === '', t(picked.vehicle.source === 'on_duty' ? 'office.trip.driversToday' : 'office.trip.driversRegular', { name: picked.name.split(' ')[0] }), () => set({ vehicle: '' }), picked.vehicle.reg_no)}
                {onDay && !locked && chip('day', f.vehicle === ON_THE_DAY, t('office.trip.onTheDay'), () => set({ vehicle: ON_THE_DAY }))}
                {onDay && !locked && ANY_TYPES.map(([type]) => chip(`any-${type}`, f.vehicle === anyValue(type), t('office.trip.anyType', { type: t(`vehicleType.${type}`) }), () => set({ vehicle: anyValue(type) })))}
                <ChoiceChip
                  selected={!!f.vehicle && f.vehicle !== ON_THE_DAY && !/^any /.test(f.vehicle)}
                  label={f.vehicle && f.vehicle !== ON_THE_DAY && !/^any /.test(f.vehicle) ? f.vehicle : t('office.trip.choose')}
                  onPress={() => setChoosing((v) => !v)}
                  after={choosing ? <ChevronUp size={18} color={colors.muted} /> : <ChevronDown size={18} color={colors.muted} />}
                />
              </View>
              {choosing && (
                <View style={{ gap: 6 }}>
                  {rows.length === 0 && <ListEmpty text={t('office.trip.noFreeVehicles')} />}
                  {rows.map((g) => (
                    <View key={g.key} style={{ gap: 2 }}>
                      <Txt variant="label" color={colors.muted} style={{ marginTop: 6 }}>{t(`office.trip.group_${g.key}`).toUpperCase()}</Txt>
                      <View accessibilityRole="radiogroup" style={{ gap: 6 }}>{g.rows.map((v) => [vehicleRow(v, g.disabled, g.disabled ? t(`office.trip.group_${g.key}`) : undefined), vehicleHolder(v)])}</View>
                    </View>
                  ))}
                </View>
              )}
            </View>}
            {why && <Txt variant="strong" color={colors.red}>{why}</Txt>}
            {problem && <ErrorNotice error={problem} onRetry={() => void save()} />}
          </>
        )}
      </Screen>
      {task && f && (
        <StickyActions>
          {!changed && <Txt variant="small" color={result && 'error' in result && result.error === 'endBeforeStart' ? colors.red : colors.muted} style={{ textAlign: 'center' }}>{t(result && 'error' in result && result.error === 'endBeforeStart' ? 'office.task.timeEndBeforeStart' : 'office.task.changeNothingYet')}</Txt>}
          <Button label={driverName && f.driver ? t('office.task.sendToDriver', { name: driverName }) : t('office.trip.saveChanges')} onPress={() => void save()} busy={busy} disabled={!changed} style={{ minHeight: 60 }} />
        </StickyActions>
      )}
      {!locked && mayAsk && p && task && (
        <AskDriversSheet
          visible={asking}
          onClose={() => setAsking(false)}
          drivers={askTargets(avail.data?.drivers ?? [], t)}
          context={{ date: f?.date || task.date, from: (f?.time || task.leave_by || task.time || '').match(/\d{2}:\d{2}/)?.[0], to: (f?.end || task.end_by || '').match(/\d{2}:\d{2}/)?.[0], note: p.stops.find((s) => !s.is_start)?.place, task_id: task.id }}
          onUse={(username) => { const x = avail.data?.drivers.find((y) => y.username === username); set({ driver: username, vehicle: '' }); setDriverName(x?.name ?? username); }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1, borderRadius: 18, padding: 16, gap: 14 },
  needs: { backgroundColor: colors.redChip, borderRadius: 12, padding: 12 },
  notes: { minHeight: 80, borderWidth: 1.5, borderColor: colors.line, borderRadius: 12, padding: 12, fontSize: 17, color: colors.ink, backgroundColor: colors.card, textAlignVertical: 'top' },
});
