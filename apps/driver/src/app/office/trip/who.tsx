// Office mode (Phase 8, O2): the trip editor's step 3, Who (design 08). Assign a task: Who's available at the leave-by
// (availability; the best match ticked), the vehicle (the driver's today, On the day when the setting allows, Any van /
// car / double cab / lorry, Choose… from the free vehicles), then the task's own fields (title, passengers, contact,
// notes, project). A request: passengers, the vehicle type needed, "A driver is needed" (when self-drive is allowed),
// a note, for whom and the project. Next: Review.

import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, TextInput, View } from 'react-native';

import { Check } from '@/components/icons';
import { TripFooter, TripHeader } from '@/components/office/TripShell';
import { Field, Plate, Txt } from '@/components/ui';
import { driverParts, driverPill, rankedDrivers } from '@/office/approveLogic';
import { useOffice, useTool } from '@/office/state';
import { updateDraft, useTripDraft } from '@/office/trip/draft';
import { whoArgs } from '@/office/trip/whoLogic';
import { ANY_TYPES, anyValue, ON_THE_DAY } from '@/office/trip/vehicleChoiceLogic';
import type { Availability, SettingsResult, SuggestedVehicle } from '@/office/types';
import { Avatar, Divider, Empty, ErrorNotice, Loading, Pill, Screen } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

const NEED_TYPES = ['car', 'van', 'double_cab', 'lorry'] as const;

export default function TripWho() {
  const { t } = useApp();
  const { me, signOut } = useOffice();
  const router = useRouter();
  const d = useTripDraft();
  const settings = useTool<SettingsResult>('get_settings', {}, { enabled: me.tools.includes('get_settings') });
  const isTask = d?.mode === 'task';
  const args = d && isTask ? whoArgs(d.fields) : null;
  const avail = useTool<Availability>('availability', args ?? {}, { enabled: !!args && me.tools.includes('availability'), every: 60_000 });
  const [choosing, setChoosing] = useState(false);
  const drivers0 = avail.data ? rankedDrivers(avail.data.drivers) : [];
  const best0 = avail.data?.best?.username ?? drivers0.find((x) => x.name === avail.data?.best?.name)?.username ?? '';
  // The best match is ticked first, once Who's available answers and nobody was picked.
  useEffect(() => {
    if (isTask && best0 && avail.data) updateDraft((x) => (x.fields.driver ? x : { ...x, fields: { ...x.fields, driver: best0 } }));
  }, [isTask, best0, avail.data]);
  if (!d) return <View style={{ flex: 1, backgroundColor: colors.page }}><Screen><Loading text={t('office.common.loading')} /></Screen></View>;
  const f = d.fields;
  const setF = (patch: Partial<typeof f>) => updateDraft((x) => ({ ...x, fields: { ...x.fields, ...patch } }));
  const setReq = (patch: Partial<typeof d.req>) => updateDraft((x) => ({ ...x, req: { ...x.req, ...patch } }));
  const drivers = drivers0;
  const bestUsername = best0;
  const picked = drivers.find((x) => x.username === f.driver);
  const onDay = settings.data?.settings.vehicle_on_the_day === true;
  const selfDrive = settings.data?.settings.self_drive_allowed !== false;
  const groups = avail.data?.vehicles.groups;
  const freeVehicles: SuggestedVehicle[] = groups ? [...groups.free_pool, ...groups.free_assigned] : [];
  const above = isTask ? t('office.trip.assignAbove', { n: 3 }) : d.mode === 'edit' ? t('office.trip.editAbove') : t('office.trip.newAbove', { n: 3 });
  const problem = isTask ? (!f.driver ? t('office.trip.needDriver') : !f.title.trim() ? t('office.trip.needTitle') : null) : null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <TripHeader step="who" above={`${above}${f.leaveBy ? ` · ${f.leaveBy}` : ''}`} onBack={() => router.back()} />
      <Screen bottom={16}>
        {isTask && (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Txt variant="label" color={colors.muted}>{`${t('office.request.whosAvailable').toUpperCase()}${avail.data ? ` · ${t('office.trip.nOfMFree', { free: avail.data.counts.free, all: avail.data.counts.all })}` : ''}`}</Txt>
            </View>
            {!args && <Empty text={t('office.trip.needLeaveFirst')} />}
            {avail.loading && <Loading text={t('office.common.loading')} />}
            {avail.error && !avail.data && <ErrorNotice error={avail.error} onRetry={() => void avail.reload()} onSignIn={() => void signOut()} />}
            {drivers.map((x) => {
              const on = !!x.username && x.username === f.driver;
              const pillKey = driverPill(x, bestUsername);
              return (
                <Pressable key={x.username ?? x.name} accessibilityRole="button" accessibilityState={{ selected: on }} disabled={!x.username} onPress={() => setF({ driver: x.username ?? '', vehicle: '' })} style={({ pressed }) => [styles.driverRow, on && styles.driverOn, pressed && { opacity: 0.8 }]}>
                  <Avatar name={x.name} size={48} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <Txt variant="strong" size={18}>{x.name}</Txt>
                      {pillKey === 'best' && <Pill text={t('office.request.bestMatch')} tone="amber" size={13} />}
                    </View>
                    <Txt variant="muted" size={15}>{driverParts(x).join(' · ')}</Txt>
                    {(x.last_seen || x.usual_start) && <Txt variant="small">{[x.last_seen ? t('office.trip.lastSeen', { when: x.last_seen }) : '', x.usual_start ? t('office.trip.usuallyStarts', { time: x.usual_start }) : ''].filter(Boolean).join(' · ')}</Txt>}
                  </View>
                  {on ? <Check size={26} color={colors.blue} strokeWidth={3} /> : pillKey && pillKey !== 'best' ? <Pill text={t(`office.request.${pillKey}`)} tone={pillKey === 'not_available' ? 'red' : pillKey === 'busy' ? 'blue' : 'muted'} /> : null}
                </Pressable>
              );
            })}

            <View style={styles.card}>
              <Txt variant="label" color={colors.muted}>{t('office.trip.vehicle').toUpperCase()}</Txt>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {picked?.vehicle && (
                  <Pressable accessibilityRole="button" accessibilityState={{ selected: f.vehicle === '' }} onPress={() => setF({ vehicle: '' })} style={[styles.chip, f.vehicle === '' && styles.chipOn]}>
                    <Plate regNo={picked.vehicle.reg_no} dark={f.vehicle === ''} />
                    <Txt variant="strong" size={15} color={f.vehicle === '' ? '#ffffff' : colors.ink}>{t(picked.vehicle.source === 'on_duty' ? 'office.trip.driversToday' : 'office.trip.driversRegular', { name: picked.name.split(' ')[0] })}</Txt>
                  </Pressable>
                )}
                {onDay && (
                  <Pressable accessibilityRole="button" accessibilityState={{ selected: f.vehicle === ON_THE_DAY }} onPress={() => setF({ vehicle: ON_THE_DAY })} style={[styles.chip, f.vehicle === ON_THE_DAY && styles.chipOn]}>
                    <Txt variant="strong" size={15} color={f.vehicle === ON_THE_DAY ? '#ffffff' : colors.ink}>{t('office.trip.onTheDay')}</Txt>
                  </Pressable>
                )}
                {onDay && ANY_TYPES.map(([type]) => (
                  <Pressable key={type} accessibilityRole="button" accessibilityState={{ selected: f.vehicle === anyValue(type) }} onPress={() => setF({ vehicle: anyValue(type) })} style={[styles.chip, f.vehicle === anyValue(type) && styles.chipOn]}>
                    <Txt variant="strong" size={15} color={f.vehicle === anyValue(type) ? '#ffffff' : colors.ink}>{t('office.trip.anyType', { type: t(`vehicleType.${type}`) })}</Txt>
                  </Pressable>
                ))}
                <Pressable accessibilityRole="button" onPress={() => setChoosing((v) => !v)} style={[styles.chip, choosing && styles.chipOn]}>
                  <Txt variant="strong" size={15} color={choosing ? '#ffffff' : colors.ink}>{f.vehicle && f.vehicle !== ON_THE_DAY && !/^any /.test(f.vehicle) ? f.vehicle : t('office.trip.choose')}</Txt>
                </Pressable>
              </View>
              {choosing && (
                <View style={{ gap: 2 }}>
                  {freeVehicles.length === 0 && <Empty text={t('office.trip.noFreeVehicles')} />}
                  {freeVehicles.map((v, i) => (
                    <View key={v.reg_no}>
                      {i > 0 && <Divider />}
                      <Pressable accessibilityRole="button" onPress={() => { setF({ vehicle: v.reg_no }); setChoosing(false); }} style={styles.vehicleRow}>
                        <Plate regNo={v.reg_no} />
                        <View style={{ flex: 1 }}>
                          <Txt variant="strong" size={15}>{[v.make_model, v.seats ? t('office.trip.seats', { n: v.seats }) : ''].filter(Boolean).join(' · ')}</Txt>
                          <Txt variant="small">{[v.availability, v.assigned_to ? t('office.trip.assignedTo', { name: v.assigned_to }) : '', v.note].filter(Boolean).join(' · ')}</Txt>
                        </View>
                        {f.vehicle === v.reg_no && <Check size={22} color={colors.blue} strokeWidth={3} />}
                      </Pressable>
                    </View>
                  ))}
                </View>
              )}
              {!picked?.vehicle && picked && !f.vehicle && <Txt variant="small" color={colors.amberText}>{t('office.trip.driverNoVehicle', { name: picked.name })}</Txt>}
            </View>

            <View style={styles.card}>
              <Field label={t('office.trip.title')} value={f.title} onChangeText={(title) => setF({ title })} placeholder={t('office.trip.titlePlaceholder')} maxLength={120} />
              <Field label={t('office.trip.passengers')} mono value={f.pax} onChangeText={(pax) => setF({ pax: pax.replace(/\D/g, '').slice(0, 2) })} keyboardType="number-pad" />
              <Field label={t('office.trip.contactName')} value={f.cname} onChangeText={(cname) => setF({ cname })} maxLength={120} />
              <Field label={t('office.trip.contactPhone')} mono value={f.cphone} onChangeText={(cphone) => setF({ cphone })} keyboardType="phone-pad" maxLength={30} />
              <Field label={t('office.trip.projectLabel')} value={d.rows[0]?.project ?? ''} onChangeText={(project) => updateDraft((x) => ({ ...x, rows: project.trim() ? [{ project, percent: 100 }] : [] }))} maxLength={60} />
              <View>
                <Txt variant="strong" size={16} style={{ marginBottom: 8 }}>{t('office.trip.notes')}</Txt>
                <TextInput value={f.notes} onChangeText={(notes) => setF({ notes })} multiline maxLength={1000} style={styles.notes} placeholderTextColor="#9aa0a6" placeholder={t('office.trip.notesPlaceholder')} />
              </View>
            </View>
          </>
        )}

        {!isTask && (
          <>
            <View style={styles.card}>
              <Field label={t('office.trip.passengers')} mono value={f.pax} onChangeText={(pax) => setF({ pax: pax.replace(/\D/g, '').slice(0, 2) })} keyboardType="number-pad" />
              <Txt variant="strong" size={16}>{t('office.trip.needType')}</Txt>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <Pressable accessibilityRole="button" accessibilityState={{ selected: d.req.need === '' }} onPress={() => setReq({ need: '' })} style={[styles.chip, d.req.need === '' && styles.chipOn]}>
                  <Txt variant="strong" size={15} color={d.req.need === '' ? '#ffffff' : colors.ink}>{t('office.trip.anyVehicle')}</Txt>
                </Pressable>
                {NEED_TYPES.map((type) => (
                  <Pressable key={type} accessibilityRole="button" accessibilityState={{ selected: d.req.need === type }} onPress={() => setReq({ need: type })} style={[styles.chip, d.req.need === type && styles.chipOn]}>
                    <Txt variant="strong" size={15} color={d.req.need === type ? '#ffffff' : colors.ink}>{t(`vehicleType.${type}`)}</Txt>
                  </Pressable>
                ))}
              </View>
              {selfDrive && (
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 }}>
                  <View style={{ flex: 1 }}>
                    <Txt variant="body">{t('office.trip.driverNeeded')}</Txt>
                    <Txt variant="small">{t('office.trip.driverNeededHint')}</Txt>
                  </View>
                  <Switch value={d.req.driverRequired} onValueChange={(v) => setReq({ driverRequired: v })} trackColor={{ true: colors.blue, false: colors.line }} thumbColor="#ffffff" />
                </View>
              )}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 }}>
                <Txt variant="body">{t('office.trip.tools')}</Txt>
                <Switch value={d.req.tools} onValueChange={(v) => setReq({ tools: v })} trackColor={{ true: colors.blue, false: colors.line }} thumbColor="#ffffff" />
              </View>
            </View>
            <View style={styles.card}>
              <Field label={t('office.trip.behalf')} value={d.req.behalf} onChangeText={(behalf) => setReq({ behalf })} maxLength={80} placeholder={t('office.trip.behalfPlaceholder')} />
              <Field label={t('office.trip.projectLabel')} value={d.req.project} onChangeText={(project) => setReq({ project })} maxLength={60} />
              <View>
                <Txt variant="strong" size={16} style={{ marginBottom: 8 }}>{t('office.trip.notes')}</Txt>
                <TextInput value={d.req.note} onChangeText={(note) => setReq({ note })} multiline maxLength={500} style={styles.notes} placeholderTextColor="#9aa0a6" placeholder={t('office.trip.notesPlaceholder')} />
              </View>
            </View>
          </>
        )}
      </Screen>
      <TripFooter label={t('office.trip.nextReview')} onPress={() => { updateDraft((x) => ({ ...x, step: 'review' })); router.push('/office/trip/review'); }} disabled={!!problem} problem={problem} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1, borderRadius: 18, padding: 16, gap: 14 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.card, justifyContent: 'center' },
  chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  driverRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18, borderWidth: 2, borderColor: colors.line, backgroundColor: colors.card, minHeight: 72 },
  driverOn: { borderColor: colors.blue, backgroundColor: '#f2f5fb' },
  vehicleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 8 },
  notes: { minHeight: 80, borderWidth: 1.5, borderColor: colors.line, borderRadius: 12, padding: 12, fontSize: 17, color: colors.ink, backgroundColor: colors.card, textAlignVertical: 'top' },
});
