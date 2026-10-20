// Office mode (Phase 8, O2): the trip editor's step 1, Where (design 06): Start from (the base place by default; Change
// opens the search, with My location), "Passengers get in here", the stops (each with its type, the place through the
// office's search, what is carried, remove, move up / down), Add another stop. The draft (office/trip/draft.ts) holds
// everything; Next: When. `?mode=request|task` starts a new flow (a draft worth keeping is offered first);
// `?mode=edit&id=` loads a request of mine.

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, View } from 'react-native';

import { ChevronDown, ChevronUp, X } from '@/components/icons';
import { Chips, MoreDetails } from '@/components/office/Controls';
import { PlaceSearch, type Picked } from '@/components/office/PlaceSearch';
import { TripFooter, TripHeader } from '@/components/office/TripShell';
import { Field, Mono, Txt } from '@/components/ui';
import { colomboDate, colomboTime } from '@/lib/time';
import { useOffice, useTool } from '@/office/state';
import { draftWorthKeeping, getDraft, newDraft, setDraft, type TripMode, updateDraft, useTripDraft } from '@/office/trip/draft';
import { pinText, placeBoxState, typedPatch } from '@/office/trip/locationLogic';
import { editFields } from '@/office/trip/requestLogic';
import { moveStop, newStop, pickupAtStart, type StopDraft, stopsInput, type StopType, tickStart, type What } from '@/office/trip/stopsLogic';
import { reasonText } from '@/office/trip/words';
import type { RequestsList, SettingsResult, TaskDetail } from '@/office/types';
import { draftsFromStops } from '@/office/trip/stopsLogic';
import { Empty, ErrorNotice, Loading, Screen } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

const TYPES: StopType[] = ['pickup', 'drop', 'visit'];
const WHATS: Exclude<What, ''>[] = ['people', 'goods', 'documents', 'other'];

export default function TripWhere() {
  const { mode, id } = useLocalSearchParams<{ mode?: TripMode; id?: string }>();
  const { t } = useApp();
  const { me, signOut } = useOffice();
  const router = useRouter();
  const d = useTripDraft();
  const settings = useTool<SettingsResult>('get_settings', {}, { enabled: me.tools.includes('get_settings') });
  const base = settings.data?.base_place ?? null;
  const [editing, setEditing] = useState<string | null>(null); // the stop key whose search is open, or 'start'
  const [asked, setAsked] = useState(false);
  // edit: the request as list_requests answers it now.
  const req = useTool<RequestsList>('list_requests', { status: 'all', id: id ?? '', limit: 1 }, { enabled: mode === 'edit' && !!id });
  // stops: the task as task_detail answers it now (the pending stops become the rows; the reached ones keep their numbers).
  const taskQ = useTool<TaskDetail>('task_detail', { task_id: id ?? '' }, { enabled: mode === 'stops' && !!id });

  // Starting a flow: a draft of the same kind worth keeping is offered; else a fresh one.
  useEffect(() => {
    if (!mode || asked) return;
    setAsked(true);
    const current = getDraft();
    if (mode === 'edit' || mode === 'stops') return; // loaded below from the request or the task
    if (current && current.mode === mode && draftWorthKeeping(current)) {
      Alert.alert(t('office.trip.resumeTitle'), t('office.trip.resumeBody', { time: colomboTime(current.at) }), [
        { text: t('office.trip.discard'), style: 'destructive', onPress: () => setDraft(newDraft(mode)) },
        { text: t('office.trip.resume') },
      ]);
    } else if (!current || current.mode !== mode) setDraft(newDraft(mode));
  }, [mode, asked, t]);
  useEffect(() => {
    if (mode !== 'edit' || !id) return;
    const card = req.data?.requests[0];
    if (!card) return;
    const current = getDraft();
    if (current?.mode === 'edit' && current.requestId === id && current.version === card.version) return;
    const f = editFields(card);
    const { behalf, project, need, tools, note, driver, requesterPhone, ...trip } = f;
    setDraft({
      mode: 'edit', requestId: id, version: card.version ?? 0, was: f, step: 'where', at: Date.now(), rows: [],
      fields: { ...trip, title: '', buffer: '', driver: '', vehicle: '', cname: '', cphone: '', notes: '', whatsapp: false },
      req: { behalf, project, need, tools, note, driverRequired: driver, requesterPhone: requesterPhone ?? '' },
    });
  }, [mode, id, req.data]);

  useEffect(() => {
    if (mode !== 'stops' || !id) return;
    const p = taskQ.data;
    if (!p) return;
    const current = getDraft();
    if (current?.mode === 'stops' && current.taskId === id && current.planVersion === p.task.plan_version) return;
    const pending = p.stops.filter((s) => s.status === 'pending');
    const own = pending.find((s) => s.is_start);
    const reached = p.stops.filter((s) => s.status !== 'pending' && s.status !== 'removed').length;
    const date = p.task.date ?? (p.task.leave_by && /^\d{4}-\d{2}-\d{2}/.test(p.task.leave_by) ? p.task.leave_by.slice(0, 10) : colomboDate());
    const hhmm = (v?: string) => v?.match(/\d{2}:\d{2}$/)?.[0] ?? '';
    setDraft({
      mode: 'stops', taskId: id, planVersion: p.task.plan_version ?? 0, reached, step: 'where', at: Date.now(), rows: [],
      fields: {
        date, leaveBy: p.task.leave_by_source === 'manual' && p.task.status === 'assigned' ? hhmm(p.task.leave_by) : '', end: hhmm(p.task.end_by),
        stops: draftsFromStops(pending.filter((s) => !s.is_start).map((s) => ({ type: s.type, what: s.what, place: s.place, place_id: s.place_id, google_place_id: s.google_place_id, lat: s.lat, lng: s.lng, dwell_min: s.dwell_min, arrive_by: s.arrive_by, note: s.note }))),
        start: p.task.start_place ?? '', startPlaceId: p.task.start_place_id, startGooglePlaceId: p.task.start_google_place_id, startLat: p.task.start_lat, startLng: p.task.start_lng,
        startPax: !!own, startWhat: (own?.what as never) ?? '', startNote: own?.note ?? '', startDwell: own?.dwell_min != null ? String(own.dwell_min) : '',
        returnToBase: !!p.task.return_to_base, avoidExpressway: !!p.task.avoid_expressway,
        title: p.task.title, buffer: '', driver: p.task.driver ?? '', vehicle: '', pax: '', cname: '', cphone: '', notes: '', whatsapp: false,
      },
      req: { behalf: '', project: '', need: '', tools: false, note: '', driverRequired: true, requesterPhone: '' },
    });
  }, [mode, id, taskQ.data]);

  if (mode === 'stops' && !d) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.page }}>
        <TripHeader step="where" mode="stops" above={t('office.trip.stopsAbove')} onBack={() => router.back()} />
        <Screen>{taskQ.loading ? <Loading text={t('office.common.loading')} /> : taskQ.error ? <ErrorNotice error={taskQ.error} onRetry={() => void taskQ.reload()} onSignIn={() => void signOut()} /> : <Empty text={t('office.task.notFound')} />}</Screen>
      </View>
    );
  }
  if (mode === 'edit' && !d) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.page }}>
        <TripHeader step="where" above={t('office.trip.editAbove')} onBack={() => router.back()} />
        <Screen>{req.loading ? <Loading text={t('office.common.loading')} /> : req.error ? <ErrorNotice error={req.error} onRetry={() => void req.reload()} onSignIn={() => void signOut()} /> : <Empty text={t('office.request.notFound')} />}</Screen>
      </View>
    );
  }
  if (!d) return <View style={{ flex: 1, backgroundColor: colors.page }}><Screen><Loading text={t('office.common.loading')} /></Screen></View>;

  const f = d.fields;
  const setStops = (stops: StopDraft[]) => updateDraft((x) => ({ ...x, fields: { ...x.fields, stops } }));
  const patchStop = (key: string, patch: Partial<StopDraft>) => setStops(f.stops.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  const pickFor = (key: string, p: Picked) => {
    if (p.googlePlaceId) patchStop(key, { place: p.name, picked: true, placeId: undefined, placePinned: undefined, googlePlaceId: p.googlePlaceId, pin: '', lat: p.lat, lng: p.lng });
    else patchStop(key, { place: p.name, picked: true, placeId: p.placeId, placePinned: p.placeId ? p.pinned : undefined, googlePlaceId: undefined, lat: p.lat, lng: p.lng, pin: !p.placeId && p.lat !== undefined && p.lng !== undefined ? pinText({ lat: p.lat, lng: p.lng }) : '' });
    setEditing(null);
  };
  const pickStart = (p: Picked) => {
    updateDraft((x) => ({ ...x, fields: { ...x.fields, start: p.name, startPlaceId: p.googlePlaceId ? undefined : p.placeId, startGooglePlaceId: p.googlePlaceId, startLat: p.lat, startLng: p.lng } }));
    setEditing(null);
  };
  const startName = f.start.trim() || base?.name || '';
  // The start is picked (a result, My location, a pin) or the base place; typed text alone keeps the box a field.
  const startPicked = !f.start.trim() || !!(f.startPlaceId || f.startGooglePlaceId || (f.startLat !== undefined && f.startLng !== undefined));
  const setF = (patch: Partial<typeof f>) => updateDraft((x) => ({ ...x, fields: { ...x.fields, ...patch } }));
  // A first pickup at the start (the same place): "Same as the start · Tick it" moves it into "Passengers get in here".
  const atStart = pickupAtStart(f.stops, startName ? { name: startName, lat: f.startLat, lng: f.startLng } : null, f.startPax);
  const tickIt = (i: number) => {
    const tk = tickStart(f.stops, i);
    setF({ stops: tk.list, startPax: true, ...tk.carried });
  };
  const check = stopsInput(f.stops, f.startPax ? 1 : 0);
  const problem = 'error' in check ? reasonText(t, check.error) : null;
  const above = d.mode === 'task' ? t('office.trip.assignAbove', { n: 1 }) : d.mode === 'edit' ? t('office.trip.editAbove') : d.mode === 'stops' ? t('office.trip.stopsAbove') : t('office.trip.newAbove', { n: 1 });

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <TripHeader step="where" mode={d.mode} above={above} onBack={() => (router.canGoBack() ? router.back() : router.replace('/office'))} onSaveDraft={() => router.canGoBack() ? router.back() : router.replace('/office')} />
      <Screen bottom={16}>
        {/* Start from */}
        <View style={styles.card}>
          <Txt variant="label" color={colors.muted}>{t('office.trip.startFrom').toUpperCase()}</Txt>
          {editing === 'start' || (f.start.trim() && !startPicked) ? (
            <PlaceSearch value={f.start} placeholder={t('office.trip.searchPlace')} onText={(text) => updateDraft((x) => ({ ...x, fields: { ...x.fields, start: text, startPlaceId: undefined, startGooglePlaceId: undefined, startLat: undefined, startLng: undefined } }))} onPick={pickStart} myLocation autoFocus={editing === 'start'} editing={editing === 'start'} />
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={[styles.mark, { backgroundColor: colors.amber }]}><Mono size={14} bold>S</Mono></View>
              <View style={{ flex: 1 }}>
                <Txt variant="strong">{startName || t('office.trip.noBase')}</Txt>
                {!f.start.trim() && base?.address ? <Txt variant="small">{base.address}</Txt> : null}
              </View>
              <Pressable accessibilityRole="button" onPress={() => setEditing('start')} hitSlop={8} style={{ minHeight: 44, justifyContent: 'center' }}>
                <Txt variant="strong" size={16} color={colors.blue}>{t('office.trip.change')}</Txt>
              </Pressable>
            </View>
          )}
          {(editing === 'start' || !startPicked) && f.start.trim() ? (
            <Pressable accessibilityRole="button" onPress={() => { updateDraft((x) => ({ ...x, fields: { ...x.fields, start: '', startPlaceId: undefined, startGooglePlaceId: undefined, startLat: undefined, startLng: undefined } })); setEditing(null); }} style={{ minHeight: 44, justifyContent: 'center' }}>
              <Txt variant="strong" size={15} color={colors.blue}>{t('office.trip.useBase', { name: base?.name ?? '' })}</Txt>
            </Pressable>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 }}>
            <Txt variant="body">{t('office.trip.passengersHere')}</Txt>
            <Switch value={f.startPax} onValueChange={(v) => updateDraft((x) => ({ ...x, fields: { ...x.fields, startPax: v } }))} trackColor={{ true: colors.blue, false: colors.line }} thumbColor="#ffffff" />
          </View>
          {f.startPax && (
            // The start stop's own fields (the site's StartFrom: what gets in, a note, the minutes there), optional.
            <MoreDetails filled={!!(f.startWhat || (f.startNote ?? '').trim() || (f.startDwell ?? '').trim())} testID="start-details">
              <View style={{ gap: 6 }}>
                <Txt variant="strong" size={16}>{t('office.trip.whatGetsIn')}</Txt>
                <Chips<What> options={WHATS.map((w) => ({ key: w, label: t(`office.trip.what_${w}`) }))} value={f.startWhat ?? ''} onChange={(w) => setF({ startWhat: f.startWhat === w ? '' : w })} small />
              </View>
              <Field label={t('office.trip.noteAtStart')} value={f.startNote ?? ''} onChangeText={(startNote) => setF({ startNote })} maxLength={300} />
              <Field label={t('office.trip.timeAtStart')} mono value={f.startDwell ?? ''} onChangeText={(v) => setF({ startDwell: v.replace(/\D/g, '').slice(0, 3) })} keyboardType="number-pad" placeholder="5" />
            </MoreDetails>
          )}
        </View>

        {/* Stops */}
        <View style={styles.card}>
          <Txt variant="label" color={colors.muted}>{t('office.trip.stops').toUpperCase()}</Txt>
          {f.stops.map((s, i) => {
            // Typing never chooses a place: the box stays a field until a pick (Hotfix O2-H1).
            const box = placeBoxState(s, editing === s.key);
            const open = box === 'field';
            return (
              <View key={s.key} style={{ gap: 10, paddingTop: i > 0 ? 12 : 0, borderTopWidth: i > 0 ? 1 : 0, borderTopColor: colors.line }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View style={styles.mark}><Mono size={14} bold color="#ffffff">{String(i + 1 + (f.startPax ? 1 : 0) + (d.reached ?? 0))}</Mono></View>
                  <View style={{ flex: 1 }}>
                    {box === 'picked' ? <Txt variant="strong" numberOfLines={2}>{s.place}</Txt> : <Txt variant="muted">{s.place.trim() ? t('office.trip.typing', { text: s.place.trim() }) : t('office.trip.stopNoPlace')}</Txt>}
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                      {TYPES.map((type) => (
                        <Pressable key={type} accessibilityRole="button" accessibilityState={{ selected: s.type === type }} onPress={() => patchStop(s.key, { type })} style={[styles.chip, s.type === type && styles.chipOn]}>
                          <Txt variant="strong" size={14} color={s.type === type ? '#ffffff' : colors.ink}>{t(`office.trip.type_${type}`)}</Txt>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                  <View style={{ gap: 4 }}>
                    <Pressable accessibilityRole="button" accessibilityLabel={t('office.trip.moveUp')} disabled={i === 0} onPress={() => setStops(moveStop(f.stops, i, -1))} style={[styles.iconBtn, i === 0 && { opacity: 0.3 }]}><ChevronUp size={20} color={colors.ink} /></Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel={t('office.trip.moveDown')} disabled={i === f.stops.length - 1} onPress={() => setStops(moveStop(f.stops, i, 1))} style={[styles.iconBtn, i === f.stops.length - 1 && { opacity: 0.3 }]}><ChevronDown size={20} color={colors.ink} /></Pressable>
                  </View>
                  <Pressable accessibilityRole="button" accessibilityLabel={t('office.trip.removeStop')} disabled={f.stops.length === 1} onPress={() => setStops(f.stops.filter((x) => x.key !== s.key))} style={[styles.iconBtn, f.stops.length === 1 && { opacity: 0.3 }]}><X size={22} color={colors.ink} /></Pressable>
                </View>
                {s.placeId && s.placePinned === false && <Txt variant="small" color={colors.red}>{t('office.trip.noPinWarning', { place: s.place })}</Txt>}
                {s.googlePlaceId && <Txt variant="small">{t('office.trip.googleStop')}</Txt>}
                {open ? (
                  <PlaceSearch value={s.place} placeholder={t('office.trip.searchPlace')} onText={(text) => patchStop(s.key, typedPatch(text))} onPick={(p) => pickFor(s.key, p)} editing={editing === s.key} autoFocus={editing === s.key} />
                ) : (
                  <Pressable accessibilityRole="button" onPress={() => setEditing(s.key)} hitSlop={8} style={{ minHeight: 40, justifyContent: 'center' }}>
                    <Txt variant="strong" size={15} color={colors.blue}>{t('office.trip.changePlace')}</Txt>
                  </Pressable>
                )}
                {i === atStart && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }} testID="same-as-start">
                    <Txt variant="small" color={colors.amberText} style={{ flex: 1 }}>{t('office.trip.sameAsStart')}</Txt>
                    <Pressable accessibilityRole="button" onPress={() => tickIt(i)} style={styles.chip}><Txt variant="strong" size={14}>{t('office.trip.tickIt')}</Txt></Pressable>
                  </View>
                )}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                  <Txt variant="small">{t('office.trip.what')}</Txt>
                  {WHATS.map((w) => (
                    <Pressable key={w} accessibilityRole="button" accessibilityState={{ selected: s.what === w }} onPress={() => patchStop(s.key, { what: s.what === w ? '' : w })} style={[styles.chip, s.what === w && styles.chipOn]}>
                      <Txt variant="strong" size={14} color={s.what === w ? '#ffffff' : colors.ink}>{t(`office.trip.what_${w}`)}</Txt>
                    </Pressable>
                  ))}
                </View>
                {/* The site's "Details": a pin typed by hand (a pasted one in the search box also works) and the note for the driver. */}
                <MoreDetails filled={!!(s.pin.trim() || s.note.trim())} testID={`stop-details-${i}`}>
                  <Field label={t('office.trip.pinTyped')} mono value={s.pin} onChangeText={(pin) => patchStop(s.key, { pin, lat: undefined, lng: undefined })} placeholder={t('office.trip.pinPlaceholder')} keyboardType="numbers-and-punctuation" />
                  <Field label={t('office.trip.stopNote')} value={s.note} onChangeText={(note) => patchStop(s.key, { note })} maxLength={300} />
                </MoreDetails>
              </View>
            );
          })}
          <Pressable accessibilityRole="button" onPress={() => { const n = newStop(f.stops.length || f.startPax ? 'drop' : 'pickup'); setStops([...f.stops, n]); setEditing(n.key); }} style={styles.addStop}>
            <Txt variant="strong">{`+ ${t('office.trip.addStop')}`}</Txt>
          </Pressable>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Pressable accessibilityRole="button" accessibilityState={{ selected: f.returnToBase }} onPress={() => updateDraft((x) => ({ ...x, fields: { ...x.fields, returnToBase: !x.fields.returnToBase } }))} style={[styles.chip, f.returnToBase && styles.chipOn]}>
            <Txt variant="strong" size={14} color={f.returnToBase ? '#ffffff' : colors.ink}>{t('office.trip.returnToBase')}</Txt>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityState={{ selected: f.avoidExpressway }} onPress={() => updateDraft((x) => ({ ...x, fields: { ...x.fields, avoidExpressway: !x.fields.avoidExpressway } }))} style={[styles.chip, f.avoidExpressway && styles.chipOn]}>
            <Txt variant="strong" size={14} color={f.avoidExpressway ? '#ffffff' : colors.ink}>{t('office.trip.noExpressway')}</Txt>
          </Pressable>
        </View>
      </Screen>
      <TripFooter label={t('office.trip.nextWhen')} onPress={() => { updateDraft((x) => ({ ...x, step: 'when' })); router.push('/office/trip/when'); }} disabled={!!problem} problem={problem} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1, borderRadius: 18, padding: 16, gap: 12 },
  mark: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  chip: { minHeight: 36, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.card, justifyContent: 'center' },
  chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  iconBtn: { width: 40, height: 40, borderRadius: 10, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  addStop: { minHeight: 56, borderRadius: 16, borderWidth: 2, borderStyle: 'dashed', borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
});
