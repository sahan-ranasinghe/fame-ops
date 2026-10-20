// Office mode (Phase 8, O2; Hotfix O2-H1 Part B): the trip editor's step 3, Who (design 08).
// Assign a task: Who's available at the leave-by (availability; the best match ticked, its reason under it), the vehicle
// (the driver's today, On the day when the setting allows, Any van / car / double cab / lorry, Choose… from the four
// groups), the task's title and passengers, and under More details the contact, the notes, the project split
// (find_project's match line, the percentages, Split equally) and the WhatsApp message option. A request: passengers,
// the vehicle type needed, "A driver is needed" (when self-drive is allowed), tools; under More details for whom, the
// requester's phone (approvers), the project and a note; for someone with book_vehicle the Book now card (the site's
// "Assign now"): the free drivers, the vehicle in four groups with the default line, the custodian driving, Who's
// available with Use. Next: Review.

import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ChevronDown, ChevronUp, X } from '@/components/icons';
import { DriverRows } from '@/components/office/DriverRows';
import { AskDriversSheet } from '@/components/office/AskDriversSheet';
import { Chips, MoreDetails, Stepper, ToggleRow } from '@/components/office/Controls';
import { TripFooter, TripHeader } from '@/components/office/TripShell';
import { ChoiceChip, ChoiceRow } from '@/components/patterns/Select';
import { Field, Mono, Plate, Txt } from '@/components/ui';
import { ListEmpty, SkeletonRows } from '@/components/patterns/ListState';
import { colomboDate } from '@/lib/time';
import { rankedDrivers } from '@/office/approveLogic';
import { askTargets } from '@/office/askLogic';
import { has } from '@/office/nav';
import { useOffice, useTool } from '@/office/state';
import type { ProjectRow } from '@/office/trip/assignLogic';
import { requestFieldsOf, type TripDraft, updateDraft, useTripDraft } from '@/office/trip/draft';
import { addProjectRow, custodianDrives, driverOptions, groupRows, projectMatch, removeProjectRow, setProjectRow, splitRows, splitState, vehicleLine } from '@/office/trip/formsLogic';
import { suggestInput } from '@/office/trip/requestLogic';
import { useTrip } from '@/office/trip/useTrip';
import { ANY_TYPES, anyValue, knownDef, ON_THE_DAY, shownVehicle, vehicleDefault } from '@/office/trip/vehicleChoiceLogic';
import { whoArgs } from '@/office/trip/whoLogic';
import type { Availability, FindProject, SettingsResult, SuggestedVehicle, Suggestions } from '@/office/types';
import { ErrorNotice, Screen } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

const NEED_TYPES = ['car', 'van', 'double_cab', 'lorry', 'other'] as const;
const PROJECT_LOOKUP_MS = 450;
const open = (url: string) => void Linking.openURL(url).catch(() => undefined);

/**
 * Hotfix O2-H2, the white screen: this step stays mounted under Review, and the save clears the draft. The step used to
 * return early on "no draft" before one of its hooks, so the render after the save called one hook fewer and React threw
 * "Rendered fewer hooks than expected" (a release build: a white screen, the trip already saved). The draft is now read
 * here, and the step with all its hooks exists only while there is a draft (`npm run lint:hooks` guards the rule).
 */
export default function TripWho() {
  const d = useTripDraft();
  if (!d) return <View style={{ flex: 1, backgroundColor: colors.page }}><Screen><SkeletonRows rows={3} lines={2} /></Screen></View>;
  return <WhoStep d={d} />;
}

function WhoStep({ d }: { d: TripDraft }) {
  const { t } = useApp();
  const { me, api, signOut } = useOffice();
  const router = useRouter();
  const settings = useTool<SettingsResult>('get_settings', {}, { enabled: me.tools.includes('get_settings') });
  const isTask = d?.mode === 'task';
  const books = !isTask && me.tools.includes('book_vehicle');
  const approver = has(me.permissions, 'approve');
  // The plan's leave-by stands in for an empty typed one (Who's available and the free vehicles need a time).
  const trip = useTrip(d ?? { mode: 'request', fields: { date: '', leaveBy: '', stops: [], returnToBase: false, avoidExpressway: false, end: '', start: '', startPax: false, title: '', buffer: '', driver: '', vehicle: '', pax: '', cname: '', cphone: '', notes: '', whatsapp: false }, req: { behalf: '', project: '', need: '', tools: false, note: '', driverRequired: true, requesterPhone: '' }, rows: [], step: 'who', at: 0 }, settings.data ?? null);
  const leave = d?.fields.leaveBy || trip.preview?.leave_by?.slice(-5) || '';
  const args = d && (isTask || books) ? whoArgs({ ...d.fields, leaveBy: leave }, { base: trip.base?.name, need: isTask ? undefined : d.req.need, pax: isTask ? undefined : d.fields.pax }) : null;
  const avail = useTool<Availability>('availability', args ?? {}, { enabled: !!args && me.tools.includes('availability'), every: 60_000 });
  const sugArgs = d && books ? suggestInput(requestFieldsOf(d), leave) : null;
  const sug = useTool<Suggestions>('suggest_vehicles', sugArgs ?? {}, { enabled: !!sugArgs && me.tools.includes('suggest_vehicles'), every: 60_000 });
  const [choosing, setChoosing] = useState(false);
  const [asking, setAsking] = useState(false);
  const mayAsk = me.tools.includes('ask_drivers');
  const drivers0 = avail.data ? rankedDrivers(avail.data.drivers) : [];
  const best0 = avail.data?.best?.username ?? drivers0.find((x) => x.name === avail.data?.best?.name)?.username ?? '';
  // The best match is ticked first, once Who's available answers and nobody was picked (a task).
  useEffect(() => {
    if (isTask && best0 && avail.data) updateDraft((x) => (x.fields.driver ? x : { ...x, driverName: avail.data?.best?.name ?? best0, driverWhatsapp: avail.data?.drivers.find((y) => y.username === best0)?.phone?.whatsapp, fields: { ...x.fields, driver: best0 } }));
  }, [isTask, best0, avail.data]);
  // find_project 450 ms after the last key in a project row (the site's lookup).
  const lookupTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  useEffect(() => () => Object.values(lookupTimers.current).forEach(clearTimeout), []);
  const f = d.fields;
  const setF = (patch: Partial<typeof f>) => updateDraft((x) => ({ ...x, fields: { ...x.fields, ...patch } }));
  const setReq = (patch: Partial<typeof d.req>) => updateDraft((x) => ({ ...x, req: { ...x.req, ...patch } }));
  const setRows = (fn: (rows: ProjectRow[]) => ProjectRow[]) => updateDraft((x) => ({ ...x, rows: fn(x.rows) }));
  // The driver's name (and WhatsApp link) travel with the username: Review and the outcome say "Kamal", never "kamal.p".
  const pick = (username: string, name: string, whatsapp?: string) => updateDraft((x) => ({ ...x, driverName: name, driverWhatsapp: whatsapp, fields: { ...x.fields, driver: username, vehicle: '' } }));
  const drivers = drivers0;
  const picked = drivers.find((x) => x.username === f.driver);
  const onDay = settings.data?.settings.vehicle_on_the_day === true;
  const selfDrive = settings.data?.settings.self_drive_allowed !== false;
  const today = colomboDate();
  const groups = avail.data?.vehicles.groups;
  const taskGroups = groupRows(groups ? { groups, vehicles: [] } : null);
  const above = isTask ? t('office.trip.assignAbove', { n: 3 }) : d.mode === 'edit' ? t('office.trip.editAbove') : t('office.trip.newAbove', { n: 3 });
  const split = splitState(d.rows);

  // Book now (a request, with book_vehicle): the site's rules for the driver's default vehicle and the custodian.
  const known = !!avail.data || !me.tools.includes('availability');
  const def = picked?.vehicle ? { reg_no: picked.vehicle.reg_no, why: t(picked.vehicle.source === 'on_duty' ? 'office.trip.driversToday' : 'office.trip.driversRegular', { name: picked.name.split(' ')[0] }) } : null;
  const dflt = vehicleDefault({ on: onDay, date: f.date, today, driver: f.driver, def: knownDef(def, known) });
  const dayDefault = dflt?.kind === 'on_the_day';
  const shown = shownVehicle(f.vehicle, dflt);
  const allSuggested: SuggestedVehicle[] = sug.data ? (sug.data.groups ? Object.values(sug.data.groups).flat() : sug.data.vehicles) : [];
  const pickedVehicle = allSuggested.find((v) => v.reg_no === shown);
  const custodian = custodianDrives(selfDrive, d.req.driverRequired, pickedVehicle);
  const problem = isTask ? (!f.driver ? t('office.trip.needDriver') : !f.title.trim() ? t('office.trip.needTitle') : !split.ok ? t('office.trip.reasonSplit', { total: split.total }) : known && !def && !f.vehicle && !dayDefault ? t('office.trip.needVehicle') : null) : null;
  const free = sug.data?.drivers_free ?? sug.data?.drivers.filter((x) => /free/.test(x.availability)).map((x) => ({ name: x.name, username: x.username })) ?? [];
  const options = driverOptions(free, f.driver, d.driverName);
  // What Review needs beside the pick: the driver's default vehicle (a task too: the site's "Add a vehicle" rule) and the custodian.
  useEffect(() => {
    if (!isTask && !books) return;
    updateDraft((x) => ({ ...x, book: { hasCustodian: !!pickedVehicle?.assigned_to, defaultVehicle: def?.reg_no ?? (known ? null : undefined), custodianDrives: custodian } }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTask, books, pickedVehicle?.assigned_to, def?.reg_no, known, custodian]);

  function lookup(i: number, text: string) {
    if (lookupTimers.current[i]) clearTimeout(lookupTimers.current[i]);
    lookupTimers.current[i] = setTimeout(async () => {
      if (!text.trim()) return;
      try {
        const p = await api.call<FindProject>('find_project', { text: text.trim() });
        const m = projectMatch(p);
        setRows((rows) => setProjectRow(rows, i, { match: m.key === 'none' ? t('office.trip.projectNone') : t(m.key === 'several' ? 'office.trip.projectSeveral' : 'office.trip.projectOne', { text: m.text }), bad: m.bad }));
      } catch (e) {
        setRows((rows) => setProjectRow(rows, i, { match: (e as { message?: string }).message ?? '', bad: true }));
      }
    }, PROJECT_LOOKUP_MS);
  }

  const whoAvailable = (
    <DriverRows data={avail.data} loading={avail.loading} error={avail.error} picked={f.driver} onPick={(x) => pick(x.username ?? '', x.name, x.phone?.whatsapp)} onRetry={() => void avail.reload()} onSignIn={() => void signOut()} onAsk={mayAsk && drivers.length > 0 ? () => setAsking(true) : undefined} noWindow={!args} />
  );

  // The custodian's Call and WhatsApp sit under the row, never inside it (a radio row holds no other button: TalkBack reads
  // them apart).
  const vehicleRow = (v: SuggestedVehicle, disabled: boolean, reason?: string) => (
    <View key={v.reg_no} style={{ gap: 4 }}>
      <ChoiceRow selected={shown === v.reg_no} onPress={() => { setF({ vehicle: v.reg_no }); setChoosing(false); }} disabled={disabled} disabledReason={reason} leading={<Plate regNo={v.reg_no} />} mark="end" accessibilityLabel={v.reg_no} testID={`vehicle-row-${v.reg_no}`}>
        <Txt variant={v.pick === 'no' ? 'strong' : 'muted'} size={15} color={v.pick === 'no' ? colors.red : v.pick === 'possible' ? colors.amberText : colors.muted}>{vehicleLine(v, (n) => t('office.trip.seats', { n }))}</Txt>
        {v.assigned_to ? <Txt variant="small">{[t('office.trip.assignedTo', { name: v.assigned_to }), v.custodian_note, v.note].filter(Boolean).join(' · ')}</Txt> : null}
      </ChoiceRow>
      {v.assigned_to && (v.call || v.whatsapp) ? (
        <View style={{ flexDirection: 'row', gap: 18, paddingHorizontal: 14 }}>
          {v.call ? <Pressable accessibilityRole="button" accessibilityLabel={`${t('office.common.call')} ${v.assigned_to}`} onPress={() => open(v.call!)} hitSlop={8} style={{ minHeight: 40, justifyContent: 'center' }}><Txt variant="strong" size={14} color={colors.blue}>{t('office.common.call')}</Txt></Pressable> : null}
          {v.whatsapp ? <Pressable accessibilityRole="button" accessibilityLabel={`${t('office.common.whatsapp')} ${v.assigned_to}`} onPress={() => open(v.whatsapp!)} hitSlop={8} style={{ minHeight: 40, justifyContent: 'center' }}><Txt variant="strong" size={14} color={colors.blue}>{t('office.common.whatsapp')}</Txt></Pressable> : null}
        </View>
      ) : null}
    </View>
  );

  const vehicleGroups = (rows: ReturnType<typeof groupRows>, empty: string) => (
    <View style={{ gap: 6 }}>
      {rows.length === 0 && <ListEmpty text={empty} />}
      {rows.map((g) => (
        <View key={g.key} style={{ gap: 2 }}>
          <Txt variant="label" color={colors.muted} style={{ marginTop: 6 }}>{t(`office.trip.group_${g.key}`).toUpperCase()}</Txt>
          <View accessibilityRole="radiogroup" style={{ gap: 6 }}>{g.rows.map((v) => vehicleRow(v, g.disabled, g.disabled ? t(`office.trip.group_${g.key}`) : undefined))}</View>
        </View>
      ))}
    </View>
  );

  const onDayChips = onDay && (
    <>
      <ChoiceChip label={t('office.trip.onTheDay')} selected={shown === ON_THE_DAY} onPress={() => setF({ vehicle: dayDefault ? '' : ON_THE_DAY })} />
      {ANY_TYPES.map(([type]) => (
        <ChoiceChip key={type} label={t('office.trip.anyType', { type: t(`vehicleType.${type}`) })} selected={shown === anyValue(type)} onPress={() => setF({ vehicle: anyValue(type) })} />
      ))}
    </>
  );

  // The line under the driver about the vehicle the call takes (the site's "vehicle-default" hint).
  // The chosen vehicle's facts (design 08: "Toyota HiAce · 12 seats · Free"), from the groups when they know it.
  const chosenReg = f.vehicle && f.vehicle !== ON_THE_DAY && !/^any /.test(f.vehicle) ? f.vehicle : picked?.vehicle?.reg_no ?? '';
  const chosenV = chosenReg ? [...taskGroups.flatMap((g) => g.rows), ...allSuggested].find((v) => v.reg_no === chosenReg) : undefined;
  const chosenFacts = chosenV ? vehicleLine(chosenV, (n) => t('office.trip.seats', { n })) : '';
  const defaultLine = f.driver && !custodian
    ? dayDefault
      ? (f.vehicle && f.vehicle !== ON_THE_DAY ? t('office.trip.defaultDayInstead') : t('office.trip.defaultDay'))
      : f.vehicle && def && f.vehicle !== def.reg_no ? t('office.trip.insteadOf', { why: def.why, plate: def.reg_no })
      : def ? t('office.trip.defaultVehicle', { plate: def.reg_no, why: def.why })
      : known ? t('office.trip.noDefaultVehicle') : null
    : null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <TripHeader step="who" mode={d.mode} above={`${above}${leave ? ` · ${leave}` : ''}`} onBack={() => router.back()} />
      <Screen bottom={16}>
        {isTask && (
          <>
            {whoAvailable}
            <View style={styles.card}>
              <Txt variant="label" color={colors.muted}>{t('office.trip.vehicle').toUpperCase()}</Txt>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {picked?.vehicle && (
                  <ChoiceChip selected={f.vehicle === ''} onPress={() => setF({ vehicle: '' })} before={<Plate regNo={picked.vehicle.reg_no} />} label={t(picked.vehicle.source === 'on_duty' ? 'office.trip.driversToday' : 'office.trip.driversRegular', { name: picked.name.split(' ')[0] })} />
                )}
                {onDayChips}
                <ChoiceChip
                  selected={!!f.vehicle && f.vehicle !== ON_THE_DAY && !/^any /.test(f.vehicle)}
                  onPress={() => setChoosing((v) => !v)}
                  label={f.vehicle && f.vehicle !== ON_THE_DAY && !/^any /.test(f.vehicle) ? f.vehicle : t('office.trip.choose')}
                  after={choosing ? <ChevronUp size={18} color={colors.muted} /> : <ChevronDown size={18} color={colors.muted} />}
                />
              </View>
              {choosing && vehicleGroups(taskGroups, t('office.trip.noFreeVehicles'))}
              {defaultLine ? <Txt variant="small" color={!def && known ? colors.amberText : colors.muted}>{defaultLine}</Txt> : null}
              {chosenFacts ? <Txt variant="small" testID="vehicle-facts">{chosenFacts}</Txt> : null}
            </View>

            <View style={styles.card}>
              <Field label={t('office.trip.title')} value={f.title} onChangeText={(title) => setF({ title })} placeholder={t('office.trip.titlePlaceholder')} maxLength={120} />
              <Stepper label={t('office.trip.passengers')} value={f.pax} onChange={(pax) => setF({ pax })} testID="pax-stepper" />
              <MoreDetails filled={!!(f.cname || f.cphone || f.notes || d.rows.length || f.whatsapp)} testID="task-details">
                <Field label={t('office.trip.contactName')} value={f.cname} onChangeText={(cname) => setF({ cname })} maxLength={120} />
                <Field label={t('office.trip.contactPhone')} mono value={f.cphone} onChangeText={(cphone) => setF({ cphone })} keyboardType="phone-pad" maxLength={30} />
                <View>
                  <Txt variant="strong" size={16} style={{ marginBottom: 8 }}>{t('office.trip.notes')}</Txt>
                  <TextInput value={f.notes} onChangeText={(notes) => setF({ notes })} multiline maxLength={1000} style={styles.notes} placeholderTextColor="#9aa0a6" placeholder={t('office.trip.notesPlaceholder')} />
                </View>
                <View style={{ gap: 8 }} testID="project-split">
                  <Txt variant="strong" size={16}>{t('office.trip.projects')}</Txt>
                  {d.rows.map((r, i) => (
                    <View key={i} style={{ gap: 4 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <TextInput value={r.project} onChangeText={(project) => { setRows((rows) => setProjectRow(rows, i, { project, match: undefined, bad: undefined })); lookup(i, project); }} placeholder={t('office.trip.projectPlaceholder')} placeholderTextColor="#9aa0a6" accessibilityLabel={`${t('office.trip.projects')} ${i + 1}`} style={[styles.input, { flex: 1 }]} autoCapitalize="characters" autoCorrect={false} />
                        <TextInput value={String(r.percent)} onChangeText={(percent) => setRows((rows) => setProjectRow(rows, i, { percent: percent.replace(/[^\d.]/g, '').slice(0, 5) }))} keyboardType="decimal-pad" accessibilityLabel={`${t('office.trip.percent')} ${i + 1}`} style={[styles.input, { width: 72, textAlign: 'center' }]} />
                        <Mono size={16} color={colors.muted}>%</Mono>
                        <Pressable accessibilityRole="button" accessibilityLabel={t('office.trip.removeProject')} onPress={() => setRows((rows) => removeProjectRow(rows, i))} style={styles.iconBtn}><X size={20} color={colors.ink} /></Pressable>
                      </View>
                      {r.match ? <Txt variant="small" color={r.bad ? colors.red : colors.muted}>{r.match}</Txt> : null}
                    </View>
                  ))}
                  {d.rows.length > 0 && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                      <Pressable accessibilityRole="button" onPress={() => setRows(splitRows)} hitSlop={8}><Txt variant="strong" size={15} color={colors.blue}>{t('office.trip.splitEqually')}</Txt></Pressable>
                      <Txt variant="strong" size={15} color={split.ok ? colors.blue : colors.red}>{t('office.trip.splitTotal', { total: Math.round(split.total * 100) / 100 })}</Txt>
                    </View>
                  )}
                  <Pressable accessibilityRole="button" onPress={() => setRows(addProjectRow)} style={styles.addRow}><Txt variant="strong" size={15}>{t('office.trip.addProject')}</Txt></Pressable>
                  <Txt variant="small">{t('office.trip.projectsHint')}</Txt>
                </View>
                <ToggleRow label={t('office.trip.whatsappToo')} value={f.whatsapp} onChange={(whatsapp) => setF({ whatsapp })} testID="whatsapp-toggle" />
              </MoreDetails>
            </View>
          </>
        )}

        {!isTask && (
          <>
            <View style={styles.card}>
              <Stepper label={t('office.trip.passengers')} value={f.pax} onChange={(pax) => setF({ pax })} testID="pax-stepper" />
              <Txt variant="strong" size={16}>{t('office.trip.needType')}</Txt>
              <Chips options={[{ key: '', label: t('office.trip.anyVehicle') } as { key: string; label: string }, ...NEED_TYPES.map((type) => ({ key: type as string, label: t(`office.vehicles.type_${type}`) }))]} value={d.req.need} onChange={(need) => setReq({ need })} />
              {selfDrive && <ToggleRow label={t('office.trip.driverNeeded')} hint={t('office.trip.driverNeededHint')} value={d.req.driverRequired} onChange={(driverRequired) => setReq({ driverRequired })} />}
              <ToggleRow label={t('office.trip.tools')} value={d.req.tools} onChange={(tools) => setReq({ tools })} />
              <MoreDetails filled={!!(d.req.behalf || d.req.requesterPhone || d.req.project || d.req.note)} testID="request-details">
                <Txt variant="small" testID="asked-by">{t('office.trip.askedBy', { name: me.name, phone: me.phone ?? '' }).replace(/ · $/, '')}</Txt>
                <Field label={t('office.trip.behalf')} value={d.req.behalf} onChangeText={(behalf) => setReq({ behalf })} maxLength={120} placeholder={t('office.trip.behalfPlaceholder')} />
                {approver && (
                  <View>
                    <Field label={t('office.trip.requesterPhone')} mono value={d.req.requesterPhone} onChangeText={(requesterPhone) => setReq({ requesterPhone })} keyboardType="phone-pad" maxLength={30} placeholder="077 123 4567" />
                    <Txt variant="small" style={{ marginTop: 4 }}>{t('office.trip.requesterPhoneHint')}</Txt>
                  </View>
                )}
                <Field label={t('office.trip.projectLabel')} value={d.req.project} onChangeText={(project) => setReq({ project })} maxLength={200} />
                <View>
                  <Txt variant="strong" size={16} style={{ marginBottom: 8 }}>{t('office.trip.notes')}</Txt>
                  <TextInput value={d.req.note} onChangeText={(note) => setReq({ note })} multiline maxLength={1000} style={styles.notes} placeholderTextColor="#9aa0a6" placeholder={t('office.trip.notesPlaceholder')} />
                </View>
              </MoreDetails>
            </View>

            {books && (
              <View style={styles.card} testID="book-now">
                <Txt variant="label" color={colors.muted}>{t('office.trip.bookNowAbove').toUpperCase()}</Txt>
                {!sugArgs && <Txt variant="small">{t('office.trip.fillDayFirst')}</Txt>}
                {sugArgs && sug.loading && !sug.data && <SkeletonRows rows={3} lines={2} />}
                {sug.error && !sug.data && <ErrorNotice error={sug.error} onRetry={() => void sug.reload()} onSignIn={() => void signOut()} />}
                {sug.data && (
                  <>
                    <Txt variant="strong" size={16}>{t('office.trip.freeDrivers')}</Txt>
                    {custodian ? (
                      <Txt variant="muted" size={15}>{t('office.trip.custodianDrives', { name: pickedVehicle?.assigned_to ?? '' })}</Txt>
                    ) : (
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                        {options.length === 0 && <Txt variant="small">{t('office.trip.pickFreeDriver')}</Txt>}
                        {options.map((o) => (
                          <ChoiceChip key={o.username} label={o.name} selected={f.driver === o.username} onPress={() => (f.driver === o.username ? pick('', '') : pick(o.username, o.name, drivers.find((x) => x.username === o.username)?.phone?.whatsapp))} />
                        ))}
                      </View>
                    )}
                    <Txt variant="strong" size={16}>{t('office.trip.vehicle')}</Txt>
                    {defaultLine ? <Txt variant="small" color={!def && known ? colors.amberText : colors.muted}>{defaultLine}</Txt> : null}
                    {dayDefault && f.vehicle && f.vehicle !== ON_THE_DAY && !custodian ? <Pressable accessibilityRole="button" onPress={() => setF({ vehicle: '' })} hitSlop={8}><Txt variant="strong" size={15} color={colors.blue}>{t('office.trip.leaveToDay')}</Txt></Pressable> : null}
                    {!dayDefault && f.vehicle && def && f.vehicle !== def.reg_no && !custodian ? <Pressable accessibilityRole="button" onPress={() => setF({ vehicle: '' })} hitSlop={8}><Txt variant="strong" size={15} color={colors.blue}>{t('office.trip.useVehicle', { plate: def.reg_no })}</Txt></Pressable> : null}
                    {!custodian && onDay ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{onDayChips}</View> : null}
                    {vehicleGroups(groupRows(sug.data), t('office.trip.noVehicles'))}
                  </>
                )}
              </View>
            )}
            {books && !custodian && whoAvailable}
          </>
        )}
      </Screen>
      <TripFooter label={t('office.trip.nextReview')} onPress={() => { updateDraft((x) => ({ ...x, step: 'review' })); router.push('/office/trip/review'); }} disabled={!!problem} problem={problem} />
      {(isTask || books) && mayAsk && (
        <AskDriversSheet
          visible={asking}
          onClose={() => setAsking(false)}
          drivers={askTargets(drivers)}
          context={{
            date: f.date,
            from: leave || undefined,
            to: f.end && f.end > leave ? f.end : undefined,
            note: f.stops.find((s) => s.place.trim())?.place.trim() || undefined,
          }}
          onUse={(username) => { const x = drivers.find((y) => y.username === username); pick(username, x?.name ?? username, x?.phone?.whatsapp); }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1, borderRadius: 18, padding: 16, gap: 14 },
  notes: { minHeight: 80, borderWidth: 1.5, borderColor: colors.line, borderRadius: 12, padding: 12, fontSize: 17, color: colors.ink, backgroundColor: colors.card, textAlignVertical: 'top' },
  input: { minHeight: 48, borderWidth: 1.5, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 12, fontSize: 16, color: colors.ink, backgroundColor: colors.card },
  iconBtn: { width: 40, height: 40, borderRadius: 10, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  addRow: { minHeight: 48, borderRadius: 12, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
});
