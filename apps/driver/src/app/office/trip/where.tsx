// Office mode (Phase 8, O2): the trip editor's step 1, Where (design 06): Start from (the base place by default; Change
// opens the search, with My location), "Passengers get in here", the stops (each with its type, the place through the
// office's search, what is carried, remove, move up / down), Add another stop. The draft (office/trip/draft.ts) holds
// everything; Next: When. `?mode=request|task` starts a new flow (a draft worth keeping is offered first);
// `?mode=edit&id=` loads a request of mine. Round 3 (A6): `?mode=request&again=<id>` is "Request again" on an expired
// request: the copied draft (office/trip/draftLogic.ts requestAgainDraft: everything but the day, which is tomorrow) is put
// in place by the button; a link straight here reads the request first. No "Resume draft?" for it.

// Fix B (29 October 2026): From / To / Add stop, Uber's and PickMe's route form (docs/phase8-plan.md §38.2). One route
// card: From (the start: the base place by default, Change, Use <base>, ⋯ Options: Leave from here / People get in /
// Goods), the rows on one line, the last row To; each row its place (the same search box), "Stop 2 · Visit" under it (the
// type follows the row's place until chosen), ⋯ Options (components/office/StopOptions.tsx: what happens there, Arrive by,
// Stay, More details, Move up / down) and ✕; a middle row moves by its drag handle. + Add stop inserts a short stop before
// To; "Then back to the office" (on for a new trip: To is then a visit with "Wait there" on the row; one-way, the
// drop-off) and No expressway under it. Next and Save draft drop the rows with nothing in them once To has one (tidyStops;
// a row with an arrive-by, a stay or a note but no place stays and is named); a draft opened again comes without its empty
// rows (openedDraft).

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, type GestureResponderEvent, Platform, Pressable, StyleSheet, View } from 'react-native';

import { Ellipsis, GripVertical, Plus, X } from '@/components/icons';
import { ToggleRow } from '@/components/office/Controls';
import { roleWord, StartOptionsSheet, startSummary, stopCaption, StopOptionsSheet } from '@/components/office/StopOptions';
import { DurationField } from '@/components/patterns/DurationField';
import { PlaceSearch, type Picked } from '@/components/office/PlaceSearch';
import { TripFooter, TripHeader } from '@/components/office/TripShell';
import { Mono, Txt } from '@/components/ui';
import { ListEmpty, SkeletonRows } from '@/components/patterns/ListState';
import { dropIndex, dragOffset, type RowBox } from '@/lib/patterns/dragLogic';
import { colomboDate, colomboTime } from '@/lib/time';
import { useOffice, useTool } from '@/office/state';
import { draftWorthKeeping, getDraft, newDraft, openedDraft, requestAgainDraft, setDraft, setDraftKeepDays, type TripMode, updateDraft, useTripDraft, withDriver } from '@/office/trip/draft';
import { pinText, placeBoxState, typedPatch } from '@/office/trip/locationLogic';
import { editFields } from '@/office/trip/requestLogic';
import { addStop, moveStopTo, parseDwell, pickupAtStart, removeStop, roleOf, type StopDraft, stopsInput, tickStart, tidyStops, typeDwell, withReturn } from '@/office/trip/stopsLogic';
import { reasonText } from '@/office/trip/words';
import type { RequestsList, SettingsResult, TaskDetail } from '@/office/types';
import { draftsFromStops } from '@/office/trip/stopsLogic';
import { ErrorNotice, Screen } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

export default function TripWhere() {
  // O3 row 7: Assign a task for a driver (from their page): ?driver=<username>&name=<name> picks them on a fresh draft.
  const { mode, id, driver: forDriver, name: forName, again } = useLocalSearchParams<{ mode?: TripMode; id?: string; driver?: string; name?: string; again?: string }>();
  const fresh = (m: TripMode) => withDriver(newDraft(m), m === 'task' ? forDriver : undefined, forName);
  const { t } = useApp();
  const { me, signOut } = useOffice();
  const router = useRouter();
  const d = useTripDraft();
  const settings = useTool<SettingsResult>('get_settings', {}, { enabled: me.tools.includes('get_settings') });
  const base = settings.data?.base_place ?? null;
  // Round 4–7 (item 9): the drafts' keep period (retention.drafts_days), remembered for the draft store.
  useEffect(() => setDraftKeepDays(settings.data?.settings.retention?.drafts_days), [settings.data]);
  const [editing, setEditing] = useState<string | null>(null); // the stop key whose search is open, or 'start'
  const [asked, setAsked] = useState(false);
  // Fix B: the row whose ⋯ Options is open (its key), From's Options, the drag under way and the rows as laid out.
  const [options, setOptions] = useState<string | null>(null);
  const [startOptions, setStartOptions] = useState(false);
  const [drag, setDrag] = useState<{ key: string; from: number; dy: number } | null>(null);
  const boxes = useRef(new Map<string, RowBox>());
  // edit: the request as list_requests answers it now.
  const req = useTool<RequestsList>('list_requests', { status: 'all', id: id ?? '', limit: 1 }, { enabled: mode === 'edit' && !!id });
  // stops: the task as task_detail answers it now (the pending stops become the rows; the reached ones keep their numbers).
  const taskQ = useTool<TaskDetail>('task_detail', { task_id: id ?? '' }, { enabled: mode === 'stops' && !!id });
  // Request again (Round 3, A6): the expired request, read only when its copy is not in place yet (a link straight here).
  const againQ = useTool<RequestsList>('list_requests', { status: 'all', id: again ?? '', limit: 1 }, { enabled: mode === 'request' && !!again && getDraft()?.againOf !== again });

  // Starting a flow: a draft of the same kind worth keeping is offered; else a fresh one.
  useEffect(() => {
    if (!mode || asked) return;
    setAsked(true);
    const current = getDraft();
    if (mode === 'edit' || mode === 'stops') return; // loaded below from the request or the task
    if (mode === 'request' && again) return; // Request again: the copy is in place, or read below
    if (current && current.mode === mode && draftWorthKeeping(current)) {
      setDraft(openedDraft(current)); // Fix B: a draft opened again comes without its empty rows (Discard starts afresh)
      Alert.alert(t('office.trip.resumeTitle'), t('office.trip.resumeBody', { time: colomboTime(current.at) }), [
        { text: t('office.trip.discard'), style: 'destructive', onPress: () => setDraft(fresh(mode)) },
        { text: t('office.trip.resume') },
      ]);
    } else if (!current || current.mode !== mode || (mode === 'task' && forDriver && current.fields.driver !== forDriver && !draftWorthKeeping(current))) setDraft(fresh(mode));
    else if (current) setDraft(openedDraft(current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, asked, t]);
  useEffect(() => {
    if (mode !== 'edit' || !id) return;
    const card = req.data?.requests[0];
    if (!card) return;
    const current = getDraft();
    if (current?.mode === 'edit' && current.requestId === id && current.version === card.version) return;
    const f = editFields(card);
    const { behalf, project, need, tools, note, requesterPhone, who, ...trip } = f;
    setDraft({
      mode: 'edit', requestId: id, version: card.version ?? 0, was: f, wasApproved: card.status === 'approved', step: 'where', at: Date.now(), rows: [],
      // Round 4–7 (item 10): someone else's request: the place boxes add the requester's recent places.
      ...(card.requested_by !== me.name ? { forRequest: id } : {}),
      fields: { ...trip, title: '', buffer: '', driver: '', vehicle: '', cname: '', cphone: '', notes: '', whatsapp: false },
      // Round 3: who drives, as the request asks it (the old custodian path reads as a driver, as on the site).
      req: { behalf, project, need, tools, note, requesterPhone: requesterPhone ?? '', who },
    });
  }, [mode, id, req.data, me.name]);

  useEffect(() => {
    if (mode !== 'request' || !again || getDraft()?.againOf === again) return;
    const card = againQ.data?.requests[0];
    if (card) setDraft(requestAgainDraft(card, colomboDate()));
  }, [mode, again, againQ.data]);

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
      mode: 'stops', taskId: id, planVersion: p.task.plan_version ?? 0, reached, running: p.task.status === 'in_progress', step: 'where', at: Date.now(), rows: [],
      fields: {
        date, leaveBy: p.task.leave_by_source === 'manual' && p.task.status === 'assigned' ? hhmm(p.task.leave_by) : '', end: hhmm(p.task.end_by),
        stops: draftsFromStops(pending.filter((s) => !s.is_start).map((s) => ({ type: s.type, what: s.what, place: s.place, place_id: s.place_id, google_place_id: s.google_place_id, lat: s.lat, lng: s.lng, dwell_min: s.dwell_min, arrive_by: s.arrive_by, note: s.note }))),
        start: p.task.start_place ?? '', startPlaceId: p.task.start_place_id, startGooglePlaceId: p.task.start_google_place_id, startLat: p.task.start_lat, startLng: p.task.start_lng,
        startPax: !!own, startWhat: (own?.what as never) ?? '', startNote: own?.note ?? '', startDwell: own?.dwell_min != null ? String(own.dwell_min) : '',
        returnToBase: !!p.task.return_to_base, avoidExpressway: !!p.task.avoid_expressway,
        title: p.task.title, buffer: '', driver: p.task.driver ?? '', vehicle: '', pax: '', cname: '', cphone: '', notes: '', whatsapp: false,
      },
      req: { behalf: '', project: '', need: '', tools: false, note: '', requesterPhone: '' },
    });
  }, [mode, id, taskQ.data]);

  if (mode === 'stops' && !d) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.page }}>
        <TripHeader step="where" mode="stops" above={t('office.trip.stopsAbove')} onBack={() => router.back()} />
        <Screen>{taskQ.loading ? <SkeletonRows rows={3} lines={2} /> : taskQ.error ? <ErrorNotice error={taskQ.error} onRetry={() => void taskQ.reload()} onSignIn={() => void signOut()} /> : <ListEmpty text={t('office.task.notFound')} />}</Screen>
      </View>
    );
  }
  if (mode === 'edit' && !d) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.page }}>
        <TripHeader step="where" above={t('office.trip.editAbove')} onBack={() => router.back()} />
        <Screen>{req.loading ? <SkeletonRows rows={3} lines={2} /> : req.error ? <ErrorNotice error={req.error} onRetry={() => void req.reload()} onSignIn={() => void signOut()} /> : <ListEmpty text={t('office.request.notFound')} />}</Screen>
      </View>
    );
  }
  if (mode === 'request' && again && d?.againOf !== again) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.page }}>
        <TripHeader step="where" above={t('office.trip.newAbove', { n: 1 })} onBack={() => router.back()} />
        <Screen>{againQ.error ? <ErrorNotice error={againQ.error} onRetry={() => void againQ.reload()} onSignIn={() => void signOut()} /> : againQ.data && !againQ.data.requests[0] ? <ListEmpty text={t('office.request.notFound')} /> : <SkeletonRows rows={3} lines={2} />}</Screen>
      </View>
    );
  }
  if (!d) return <View style={{ flex: 1, backgroundColor: colors.page }}><Screen><SkeletonRows rows={3} lines={2} /></Screen></View>;

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
  // A first pickup at the start (the same place): "Same as the start · Tick it" moves it into From's "People get in".
  const atStart = pickupAtStart(f.stops, startName ? { name: startName, lat: f.startLat, lng: f.startLng } : null, f.startPax);
  const tickIt = (i: number) => {
    const tk = tickStart(f.stops, i, f.returnToBase);
    setF({ stops: tk.list, startPax: true, ...tk.carried });
  };
  // The rows are numbered after the start stop and the stops already reached (mode stops).
  const offset = (f.startPax ? 1 : 0) + (d.reached ?? 0);
  // Fix B: the check reads the rows as Next sends them (tidyStops: rows with no place go once To has one); an empty To
  // keeps Next disabled with the row named ("Stop 3 needs a place.").
  const check = stopsInput(tidyStops(f.stops, f.returnToBase), offset);
  const problem = 'error' in check ? reasonText(t, check.error) : null;
  const above = d.mode === 'task' ? t('office.trip.assignAbove', { n: 1 }) : d.mode === 'edit' ? t('office.trip.editAbove') : d.mode === 'stops' ? t('office.trip.stopsAbove') : t('office.trip.newAbove', { n: 1 });
  const leave = () => (router.canGoBack() ? router.back() : router.replace('/office'));
  const tidy = () => updateDraft((x) => ({ ...x, fields: { ...x.fields, stops: tidyStops(x.fields.stops, x.fields.returnToBase) } }));
  const settingsNow = settings.data?.settings;
  const suggestedStay = (s: StopDraft) => (settingsNow?.planner_suggestions !== false ? typeDwell(s.type, settingsNow?.dwell_min) : undefined);
  // The drag (by a row's handle): where the row would land, shown as a line on that row; let go = moveStopTo.
  const laidOut = () => f.stops.map((s) => boxes.current.get(s.key));
  const target = drag ? dropIndex(drag.from, drag.dy, laidOut()) : -1;
  const drop = (from: number, dy: number | null) => {
    setDrag(null);
    if (dy === null) return;
    const to = dropIndex(from, dy, laidOut());
    if (to !== from) setStops(moveStopTo(f.stops, from, to, f.returnToBase));
  };
  const optIndex = options ? f.stops.findIndex((s) => s.key === options) : -1;
  const optStop = optIndex >= 0 ? f.stops[optIndex] : null;
  const summary = startSummary(t, f);

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <TripHeader step="where" mode={d.mode} above={above} onBack={leave} onSaveDraft={() => { tidy(); leave(); }} />
      <Screen bottom={16}>
        {/* Fix B: one route card. From (the start), the rows on one line, the last row To; + Add stop under the line. */}
        <View style={styles.card} testID="route-card">
          <View style={styles.row} testID="from-row">
            <View style={styles.rail}>
              <View style={[styles.mark, { backgroundColor: colors.amber }]}><Mono size={12} bold>S</Mono></View>
              <View style={styles.line} />
            </View>
            <View style={[styles.body, styles.bodyGap]}>
              <View style={styles.head}>
                <Txt variant="label" color={colors.muted} style={{ flex: 1 }}>{t('office.trip.from').toUpperCase()}</Txt>
                <OptionsButton label={t('office.trip.options')} onPress={() => setStartOptions(true)} testID="from-options" />
              </View>
              {editing === 'start' || (f.start.trim() && !startPicked) ? (
                <PlaceSearch value={f.start} placeholder={t('office.trip.searchPlace')} onText={(text) => updateDraft((x) => ({ ...x, fields: { ...x.fields, start: text, startPlaceId: undefined, startGooglePlaceId: undefined, startLat: undefined, startLng: undefined } }))} onPick={pickStart} myLocation autoFocus={editing === 'start'} editing={editing === 'start'} forRequest={d.forRequest} />
              ) : (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Txt variant="strong" testID="from-name">{startName || t('office.trip.noBase')}</Txt>
                    {!f.start.trim() && base?.address ? <Txt variant="small">{base.address}</Txt> : null}
                  </View>
                  <Pressable accessibilityRole="button" onPress={() => setEditing('start')} hitSlop={8} style={{ minHeight: 44, justifyContent: 'center' }} testID="from-change">
                    <Txt variant="strong" size={16} color={colors.blue}>{t('office.trip.change')}</Txt>
                  </Pressable>
                </View>
              )}
              {(editing === 'start' || !startPicked) && f.start.trim() ? (
                <Pressable accessibilityRole="button" onPress={() => { updateDraft((x) => ({ ...x, fields: { ...x.fields, start: '', startPlaceId: undefined, startGooglePlaceId: undefined, startLat: undefined, startLng: undefined } })); setEditing(null); }} style={{ minHeight: 44, justifyContent: 'center' }}>
                  <Txt variant="strong" size={15} color={colors.blue}>{t('office.trip.useBase', { name: base?.name ?? '' })}</Txt>
                </Pressable>
              ) : null}
              {summary ? <Txt variant="small" testID="from-summary">{summary}</Txt> : null}
            </View>
          </View>

          <View testID="stop-rows">
            {f.stops.map((s, i) => {
              const isTo = i === f.stops.length - 1;
              // Typing never chooses a place: the box stays a field until a pick (Hotfix O2-H1).
              const box = placeBoxState(s, editing === s.key);
              const open = box === 'field';
              const lifted = drag?.key === s.key;
              const lineAt = drag && !lifted && target === i ? (target < drag.from ? 'top' : 'bottom') : null;
              return (
                <View
                  key={s.key}
                  onLayout={(e) => { boxes.current.set(s.key, { y: e.nativeEvent.layout.y, h: e.nativeEvent.layout.height }); }}
                  style={[styles.row, lifted && drag ? [styles.lifted, { transform: [{ translateY: dragOffset(drag.from, drag.dy, laidOut()) }] }] : null]}
                  testID={`stop-row-${i}`}
                >
                  {lineAt ? <View pointerEvents="none" style={[styles.dropLine, lineAt === 'top' ? { top: -2 } : { bottom: -2 }]} testID="drop-line" /> : null}
                  <View style={styles.rail}>
                    <View style={styles.mark}><Mono size={12} bold color="#ffffff">{String(i + 1 + offset)}</Mono></View>
                    {!isTo ? <View style={styles.line} /> : null}
                  </View>
                  <View style={[styles.body, !isTo && styles.bodyGap]}>
                    <View style={styles.head}>
                      {!isTo ? <DragHandle label={t('office.trip.dragToMove')} onMove={(dy) => setDrag({ key: s.key, from: i, dy })} onDrop={(dy) => drop(i, dy)} testID={`stop-drag-${i}`} /> : null}
                      <View style={{ flex: 1, minWidth: 0 }}>
                        {isTo ? <Txt variant="label" color={colors.muted}>{t('office.trip.to').toUpperCase()}</Txt> : null}
                        <Txt variant="small" testID={`stop-caption-${i}`}>{stopCaption(t, s, i + 1 + offset, { isTo, shortMin: typeDwell('drop', settingsNow?.dwell_min) })}</Txt>
                      </View>
                      <OptionsButton label={t('office.trip.options')} onPress={() => setOptions(s.key)} testID={`stop-options-${i}`} />
                      {!isTo || f.stops.length > 1 ? (
                        <Pressable accessibilityRole="button" accessibilityLabel={t('office.trip.removeStop')} onPress={() => setStops(removeStop(f.stops, i, f.returnToBase))} hitSlop={4} style={styles.iconBtn} testID={`stop-remove-${i}`}>
                          <X size={20} color={colors.ink} />
                        </Pressable>
                      ) : null}
                    </View>
                    {box === 'picked' ? <Txt variant="strong" numberOfLines={2}>{s.place}</Txt> : null}
                    {open ? (
                      <PlaceSearch value={s.place} placeholder={t('office.trip.searchPlace')} onText={(text) => patchStop(s.key, typedPatch(text))} onPick={(p) => pickFor(s.key, p)} editing={editing === s.key} autoFocus={editing === s.key} forRequest={d.forRequest} />
                    ) : (
                      <Pressable accessibilityRole="button" onPress={() => setEditing(s.key)} hitSlop={8} style={{ minHeight: 40, justifyContent: 'center', alignSelf: 'flex-start' }}>
                        <Txt variant="strong" size={15} color={colors.blue}>{t('office.trip.changePlace')}</Txt>
                      </Pressable>
                    )}
                    {/* To while the trip goes back to the office: how long the driver waits there, on the row (the return is planned from it). */}
                    {isTo && f.returnToBase && s.type === 'visit' ? (
                      <DurationField label={t('office.trip.waitThere')} value={typeof parseDwell(s.dwell) === 'number' ? String(parseDwell(s.dwell)) : ''} onCommit={(dwell) => patchStop(s.key, { dwell })} suggestedMin={suggestedStay(s)} testID="to-wait" />
                    ) : null}
                    {s.placeId && s.placePinned === false && <Txt variant="small" color={colors.red}>{t('office.trip.noPinWarning', { place: s.place })}</Txt>}
                    {s.googlePlaceId && <Txt variant="small">{t('office.trip.googleStop')}</Txt>}
                    {i === atStart && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }} testID="same-as-start">
                        <Txt variant="small" color={colors.amberText} style={{ flex: 1 }}>{t('office.trip.sameAsStart')}</Txt>
                        <Pressable accessibilityRole="button" onPress={() => tickIt(i)} style={styles.chip}><Txt variant="strong" size={14}>{t('office.trip.tickIt')}</Txt></Pressable>
                      </View>
                    )}
                  </View>
                </View>
              );
            })}
          </View>

          <Pressable accessibilityRole="button" onPress={() => { const a = addStop(f.stops, f.returnToBase); setStops(a.list); setEditing(a.key); }} style={styles.addStop} testID="add-stop">
            <View style={styles.rail}><Plus size={20} color={colors.blue} strokeWidth={2.6} /></View>
            <Txt variant="strong" size={16} color={colors.blue} style={{ flex: 1, paddingLeft: 10 }}>{t('office.trip.addStop')}</Txt>
          </Pressable>
          <View style={styles.divider} />
          <ToggleRow label={t('office.trip.backToOffice')} value={f.returnToBase} onChange={(returnToBase) => setF({ returnToBase, stops: withReturn(f.stops, returnToBase) })} testID="return-toggle" />
          <ToggleRow label={t('office.trip.noExpressway')} value={f.avoidExpressway} onChange={(avoidExpressway) => setF({ avoidExpressway })} testID="expressway-toggle" />
        </View>
      </Screen>
      <TripFooter label={t('office.trip.nextWhen')} onPress={() => { updateDraft((x) => ({ ...x, step: 'when', fields: { ...x.fields, stops: tidyStops(x.fields.stops, x.fields.returnToBase) } })); router.push('/office/trip/when'); }} disabled={!!problem} problem={problem} />
      <StopOptionsSheet
        stop={optStop}
        index={optIndex}
        count={f.stops.length}
        title={optStop ? t('office.trip.stopCaption', { n: optIndex + 1 + offset, type: roleWord(t, roleOf(optStop), optIndex === f.stops.length - 1) }) : ''}
        suggestedMin={optStop ? suggestedStay(optStop) : undefined}
        onChange={(next) => setStops(f.stops.map((x) => (x.key === next.key ? next : x)))}
        onMove={(to) => setStops(moveStopTo(f.stops, optIndex, to, f.returnToBase))}
        onClose={() => setOptions(null)}
      />
      <StartOptionsSheet visible={startOptions} f={f} setF={setF} onClose={() => setStartOptions(false)} />
    </View>
  );
}

/** ⋯ on a row: its Options sheet. */
function OptionsButton({ label, onPress, testID }: { label: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={4} style={styles.iconBtn} testID={testID}>
      <Ellipsis size={22} color={colors.ink} strokeWidth={2.4} />
    </Pressable>
  );
}

/**
 * A row's drag handle (Google Maps' and Uber's ≡ on a route's stops): press it and drag. React Native's own touch
 * responder (as SlideToConfirm), so the same handle runs on the phone and on the web (/m/); the list never takes the drag
 * away half way, and Android's scroll view is told not to scroll while it runs (the grant answers true).
 */
function DragHandle({ label, onMove, onDrop, testID }: { label: string; onMove: (dy: number) => void; onDrop: (dy: number | null) => void; testID?: string }) {
  const start = useRef<number | null>(null);
  const y = (e: GestureResponderEvent) => e.nativeEvent.pageY ?? 0;
  return (
    <View
      accessible
      accessibilityLabel={label}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(e) => {
        start.current = y(e);
        return true;
      }}
      onResponderMove={(e) => {
        if (start.current !== null) onMove(y(e) - start.current);
      }}
      onResponderRelease={(e) => {
        const from = start.current;
        start.current = null;
        onDrop(from === null ? null : y(e) - from);
      }}
      onResponderTerminate={() => {
        start.current = null;
        onDrop(null);
      }}
      style={[styles.handle, Platform.OS === 'web' ? (WEB_GRAB as object) : null]}
      testID={testID}
    >
      <GripVertical size={20} color={colors.muted} />
    </View>
  );
}

/** The browser's own touch scrolling stays off the handle (else a phone browser scrolls the page instead of dragging). */
const WEB_GRAB = { cursor: 'grab', touchAction: 'none' };

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1, borderRadius: 18, padding: 16, gap: 0 },
  row: { flexDirection: 'row', backgroundColor: colors.card },
  lifted: { zIndex: 2, elevation: 4, borderRadius: 12, shadowColor: '#000000', shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
  dropLine: { position: 'absolute', left: 0, right: 0, height: 3, borderRadius: 2, backgroundColor: colors.blue },
  rail: { width: 28, alignItems: 'center' },
  mark: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center', marginTop: 9 },
  line: { flex: 1, width: 2, minHeight: 12, backgroundColor: colors.rail, marginTop: 2 },
  body: { flex: 1, minWidth: 0, paddingLeft: 10, gap: 6 },
  bodyGap: { paddingBottom: 16 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44 },
  handle: { width: 32, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: -6 },
  chip: { minHeight: 36, paddingHorizontal: 12, borderRadius: 999, borderWidth: 2, borderColor: colors.line, backgroundColor: colors.card, justifyContent: 'center' },
  iconBtn: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  addStop: { flexDirection: 'row', alignItems: 'center', minHeight: 52 },
  divider: { height: 1, backgroundColor: colors.divider, marginVertical: 8 },
});
