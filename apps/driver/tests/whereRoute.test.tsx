// Fix B (29 October 2026): From / To / Add stop, Uber's and PickMe's route form (docs/phase8-plan.md §38.2). The trip
// editor's Where step run through the router with the office's real answers: a new trip is From (the base place) and one
// To with "Then back to the office" on; + Add stop puts a row before To; the types follow the rows (a visit between, the
// drop-off at To) and reach the server that way; ⋯ Options changes a type, the times, the details and the order; the drag
// handle moves a row; Next drops the rows with no place and waits while To has none; a resumed draft opens without its
// empty rows; Change stops uses the same layout; and every item of §38.2's inventory is still reachable (the key actions).
// The place box is the real one elsewhere (tests/whereSuggestions.test.tsx); here a stand-in that types and picks.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { Stack } from 'expo-router';
import { Switch, Text } from 'react-native';

import { answers, failOnConsoleError, FIX, mockUseApp, resetFake } from './fakeOffice';

jest.mock('@/office/client', () => ({ officeApi: require('./fakeOffice').mockOfficeApi }));
jest.mock('@/state/app', () => ({ useApp: () => require('./fakeOffice').mockUseApp() }));
jest.mock('@/office/store', () => ({ useOfficeMe: () => require('./fakeOffice').FIX('me'), getOfficeMe: () => require('./fakeOffice').FIX('me'), setOfficeMe: () => undefined }));
// The place box: a field that types (onText) and a "pick" that picks what is typed (our place, with a pin).
jest.mock('@/components/office/PlaceSearch', () => {
  const React = require('react');
  const { Pressable, Text: T, TextInput, View } = require('react-native');
  return {
    PlaceSearch: ({ value, placeholder, onText, onPick, myLocation }: { value: string; placeholder: string; onText: (s: string) => void; onPick: (p: unknown) => void; myLocation?: boolean }) =>
      React.createElement(View, null,
        React.createElement(TextInput, { accessibilityLabel: placeholder, value, onChangeText: onText, testID: 'place-input' }),
        myLocation ? React.createElement(T, { testID: 'my-location' }, 'my location') : null,
        React.createElement(Pressable, { testID: 'place-pick', onPress: () => onPick({ name: value || 'Somewhere', placeId: value === 'Head office' ? 'b1' : `id-${value}`, pinned: true, lat: 7, lng: 80 }) }, React.createElement(T, null, 'pick'))),
  };
});

/* eslint-disable import/first */
import TripWhere from '@/app/office/trip/where';
import { dropIndex } from '@/lib/patterns/dragLogic';
import { OfficeProvider } from '@/office/state';
import { getDraft, newDraft, setDraft } from '@/office/trip/draft';
import { newStop, startInput, type StopDraft, stopsInput } from '@/office/trip/stopsLogic';
import type { Me as OfficeMe } from '@/office/types';

const ME: OfficeMe = FIX('me');
const t = mockUseApp().t;
const BASE = { id: 'b1', name: 'Head office', address: 'Colombo 05', has_pin: true };

const routes = {
  _layout: () => <OfficeProvider me={ME}><Stack screenOptions={{ headerShown: false }} /></OfficeProvider>,
  'office/trip/where': TripWhere,
  'office/trip/when': () => <Text>when step</Text>,
  'office/index': () => <Text>home</Text>,
};

let errors: ReturnType<typeof failOnConsoleError>;
beforeEach(() => {
  resetFake();
  setDraft(null);
  answers.get_settings = () => ({ settings: { tasks_need_approval: false, self_drive_allowed: true, dwell_min: { pickup: 5, drop: 5, visit: 60 } }, base_place: BASE });
  errors = failOnConsoleError();
});
afterEach(() => {
  errors.restore();
  setDraft(null);
});

const rows = () => screen.queryAllByTestId(/^stop-row-\d+$/);
const caption = (i: number) => screen.getByTestId(`stop-caption-${i}`).props.children as string;
const places = () => getDraft()!.fields.stops.map((s) => s.place);
/** Types `text` into the first open place box and picks it. */
async function pickFirst(text: string) {
  fireEvent.changeText(screen.getAllByTestId('place-input')[0], text);
  fireEvent.press(screen.getAllByTestId('place-pick')[0]);
  await waitFor(() => expect(places()).toContain(text));
}
async function open(url = '/office/trip/where?mode=request') {
  const r = renderRouter(routes, { initialUrl: url });
  await screen.findByTestId('route-card');
  return r;
}
const caps = (k: string, v?: Record<string, string | number>) => t(k, v).toUpperCase();

describe('Where: From / To / Add stop', () => {
  it('a new trip: From is the base place, one To, back to the office on; Next waits with today\'s reason', async () => {
    await open();
    await waitFor(() => expect(screen.getByTestId('from-name').props.children).toBe('Head office'));
    expect(screen.getByText('Colombo 05')).toBeTruthy();
    expect(screen.getByText(caps('office.trip.from'))).toBeTruthy();
    expect(screen.getByText(caps('office.trip.to'))).toBeTruthy();
    expect(rows()).toHaveLength(1);
    expect(caption(0)).toBe('Stop 1 · Drop-off');
    // To alone has no ✕ (the trip keeps one row) and no drag handle.
    expect(screen.queryByTestId('stop-remove-0')).toBeNull();
    expect(screen.queryByTestId('stop-drag-0')).toBeNull();
    expect(within(screen.getByTestId('return-toggle')).UNSAFE_getByType(Switch).props.value).toBe(true);
    expect(screen.getByText(t('office.trip.backToOffice'))).toBeTruthy();
    expect(getDraft()!.fields.returnToBase).toBe(true);
    expect(screen.getByTestId('trip-primary')).toBeDisabled();
    expect(screen.getByText(t('office.trip.reasonStop'))).toBeTruthy();
    expect(errors.seen.map((a) => String(a[0]))).toEqual([]);
  });

  it('+ Add stop puts a row before To and opens its search; the types follow the rows and reach the server', async () => {
    const r = await open();
    await pickFirst('Galle site');
    fireEvent.press(screen.getByTestId('add-stop'));
    expect(rows()).toHaveLength(2);
    // The new row is between From and To, its box open; To keeps its place.
    expect(places()).toEqual(['', 'Galle site']);
    expect(caption(0)).toBe('Stop 1 · Visit');
    expect(caption(1)).toBe('Stop 2 · Drop-off');
    await pickFirst('Kandy depot');
    expect(screen.getByTestId('trip-primary')).toBeEnabled();
    // What Review sends (stopsInput, as review.tsx calls it).
    const sent = stopsInput(getDraft()!.fields.stops);
    expect('stops' in sent && sent.stops.map((s) => [s.type, s.place])).toEqual([['visit', 'Kandy depot'], ['drop', 'Galle site']]);
    fireEvent.press(screen.getByTestId('trip-primary'));
    await screen.findByText('when step');
    expect(r.getPathname()).toBe('/office/trip/when');
    expect(getDraft()!.step).toBe('when');
  });

  it('⋯ Options: what happens there changes the type (and says so on the row); the times and details are there', async () => {
    await open();
    await pickFirst('Galle site');
    fireEvent.press(screen.getByTestId('add-stop'));
    await pickFirst('Kandy depot');
    fireEvent.press(screen.getByTestId('stop-options-0'));
    const sheet = await screen.findByTestId('stop-options-sheet');
    expect(within(sheet).getByText(caps('office.trip.whatHappens'))).toBeTruthy();
    // The row's own role is picked: a visit between From and To.
    expect(within(sheet).getByTestId('role-visit').props.accessibilityState.selected).toBe(true);
    fireEvent.press(within(sheet).getByTestId('role-in'));
    expect(getDraft()!.fields.stops[0]).toMatchObject({ type: 'pickup', what: 'people', typeSet: true });
    expect(caption(0)).toBe('Stop 1 · Pickup · People');
    fireEvent.press(within(screen.getByTestId('stop-options-sheet')).getByTestId('role-goods'));
    // A pickup of goods stays a pickup.
    expect(getDraft()!.fields.stops[0]).toMatchObject({ type: 'pickup', what: 'goods' });
    fireEvent.press(within(screen.getByTestId('stop-options-sheet')).getByTestId('role-out'));
    expect(getDraft()!.fields.stops[0]).toMatchObject({ type: 'drop', what: 'people' });
    expect(within(screen.getByTestId('stop-options-sheet')).getByTestId('options-arrive')).toBeTruthy();
    expect(within(screen.getByTestId('stop-options-sheet')).getByTestId('options-stay')).toBeTruthy();
    // A chosen type stays when the row moves (Move down: it becomes To but keeps "People get out").
    fireEvent.press(within(screen.getByTestId('stop-options-sheet')).getByTestId('options-move-down'));
    expect(places()).toEqual(['Galle site', 'Kandy depot']);
    expect(getDraft()!.fields.stops.map((s) => s.type)).toEqual(['visit', 'drop']);
    fireEvent.press(screen.getByTestId('stop-options-done'));
    await waitFor(() => expect(screen.queryByTestId('stop-options-sheet')).toBeNull());
    const sent = stopsInput(getDraft()!.fields.stops);
    expect('stops' in sent && sent.stops.map((s) => [s.type, s.what, s.place])).toEqual([['visit', undefined, 'Galle site'], ['drop', 'people', 'Kandy depot']]);
  });

  it('Next drops the rows with no place once To has one; with no place on To it stays disabled and names the row', async () => {
    await open();
    fireEvent.press(screen.getByTestId('add-stop'));
    fireEvent.press(screen.getByTestId('add-stop'));
    expect(rows()).toHaveLength(3);
    await pickFirst('Kandy depot');
    expect(places()).toEqual(['Kandy depot', '', '']);
    expect(screen.getByTestId('trip-primary')).toBeDisabled();
    expect(screen.getByText(t('office.trip.reasonStopPlace', { n: 3 }))).toBeTruthy();
    // To gets a place: the empty middle row goes silently on Next.
    fireEvent.changeText(screen.getAllByTestId('place-input')[1], 'Galle site');
    fireEvent.press(screen.getAllByTestId('place-pick')[1]);
    await waitFor(() => expect(screen.getByTestId('trip-primary')).toBeEnabled());
    fireEvent.press(screen.getByTestId('trip-primary'));
    await screen.findByText('when step');
    expect(places()).toEqual(['Kandy depot', 'Galle site']);
    expect(getDraft()!.fields.stops.map((s) => s.type)).toEqual(['visit', 'drop']);
  });

  it('Save draft drops the empty rows too and leaves', async () => {
    await open();
    await pickFirst('Galle site');
    fireEvent.press(screen.getByTestId('add-stop'));
    expect(places()).toEqual(['', 'Galle site']);
    fireEvent.press(screen.getByText(t('office.trip.saveDraft')));
    await screen.findByText('home');
    expect(places()).toEqual(['Galle site']);
  });

  it('reorder: Move up / Move down in Options, and the drag by a row\'s handle', async () => {
    await open();
    await pickFirst('C');
    fireEvent.press(screen.getByTestId('add-stop'));
    await pickFirst('A');
    fireEvent.press(screen.getByTestId('add-stop'));
    await pickFirst('B');
    expect(places()).toEqual(['A', 'B', 'C']);
    fireEvent.press(screen.getByTestId('stop-options-1'));
    await screen.findByTestId('stop-options-sheet');
    fireEvent.press(screen.getByTestId('options-move-up'));
    expect(places()).toEqual(['B', 'A', 'C']);
    // The sheet follows its row: B is first now, so Move up is off.
    expect(screen.getByTestId('options-move-up')).toBeDisabled();
    fireEvent.press(screen.getByTestId('stop-options-done'));
    await waitFor(() => expect(screen.queryByTestId('stop-options-sheet')).toBeNull());
    // The drag: rows 100 high; B dragged 160 down lands after A (the line shows where), the types follow the places.
    for (let i = 0; i < 3; i++) fireEvent(screen.getByTestId(`stop-row-${i}`), 'layout', { nativeEvent: { layout: { x: 0, y: i * 100, width: 300, height: 100 } } });
    const handle = screen.getByTestId('stop-drag-0');
    expect(handle.props.accessibilityLabel).toBe(t('office.trip.dragToMove'));
    fireEvent(handle, 'responderGrant', { nativeEvent: { pageY: 300 } });
    fireEvent(handle, 'responderMove', { nativeEvent: { pageY: 460 } });
    expect(screen.getByTestId('drop-line')).toBeTruthy();
    fireEvent(handle, 'responderRelease', { nativeEvent: { pageY: 460 } });
    expect(places()).toEqual(['A', 'B', 'C']);
    // Dragged to the end, a middle row becomes To (the drop-off); the old To becomes a visit.
    for (let i = 0; i < 3; i++) fireEvent(screen.getByTestId(`stop-row-${i}`), 'layout', { nativeEvent: { layout: { x: 0, y: i * 100, width: 300, height: 100 } } });
    const first = screen.getByTestId('stop-drag-0');
    fireEvent(first, 'responderGrant', { nativeEvent: { pageY: 0 } });
    fireEvent(first, 'responderMove', { nativeEvent: { pageY: 260 } });
    fireEvent(first, 'responderRelease', { nativeEvent: { pageY: 260 } });
    expect(places()).toEqual(['B', 'C', 'A']);
    expect(getDraft()!.fields.stops.map((s) => s.type)).toEqual(['visit', 'visit', 'drop']);
    // A drag that is taken away changes nothing.
    fireEvent(screen.getByTestId('stop-drag-0'), 'responderGrant', { nativeEvent: { pageY: 0 } });
    fireEvent(screen.getByTestId('stop-drag-0'), 'responderTerminate', { nativeEvent: { pageY: 300 } });
    expect(places()).toEqual(['B', 'C', 'A']);
  });

  it('✕ removes a row; removing To makes the row before it To', async () => {
    await open();
    await pickFirst('Galle site');
    fireEvent.press(screen.getByTestId('add-stop'));
    await pickFirst('Kandy depot');
    fireEvent.press(screen.getByTestId('stop-remove-1'));
    expect(places()).toEqual(['Kandy depot']);
    expect(getDraft()!.fields.stops[0].type).toBe('drop');
    expect(caption(0)).toBe('Stop 1 · Drop-off');
    expect(screen.queryByTestId('stop-remove-0')).toBeNull();
  });

  it('From\'s Options: Leave from here by default; People get in makes the start Stop 1 with its own fields', async () => {
    await open();
    await pickFirst('Galle site');
    fireEvent.press(screen.getByTestId('from-options'));
    const sheet = await screen.findByTestId('start-options-sheet');
    expect(within(sheet).getByTestId('start-role-leave').props.accessibilityState.selected).toBe(true);
    expect(within(sheet).queryByTestId('start-details')).toBeNull();
    fireEvent.press(within(sheet).getByTestId('start-role-in'));
    expect(getDraft()!.fields.startPax).toBe(true);
    const details = screen.getByTestId('start-details');
    expect(within(details).getByText(t('office.trip.whatGetsIn'))).toBeTruthy();
    expect(within(details).getByTestId('start-stay')).toBeTruthy();
    fireEvent.changeText(within(details).getByTestId('start-note'), 'Gate 2');
    fireEvent.press(within(screen.getByTestId('start-options-sheet')).getByTestId('start-role-goods'));
    expect(getDraft()!.fields).toMatchObject({ startPax: true, startWhat: 'goods', startNote: 'Gate 2' });
    fireEvent.press(screen.getByTestId('start-options-done'));
    // The rows count after the start stop; the summary on From.
    expect(caption(0)).toBe('Stop 2 · Drop-off');
    expect(screen.getByTestId('from-summary').props.children).toBe(`${t('office.trip.role_goods')} · ${t('office.trip.noteSet')}`);
    expect(startInput(getDraft()!.fields, { id: BASE.id, name: BASE.name })).toEqual({ place_id: 'b1', place: 'Head office', passengers: true, what: 'goods', note: 'Gate 2' });
  });

  it('a resumed draft opens without its empty rows and keeps a chosen type; the Google note and the no-pin warning stay', async () => {
    const d = newDraft('request');
    const g: StopDraft = { ...newStop('pickup'), place: 'Google place', googlePlaceId: 'g1', picked: true };
    const empty: StopDraft = newStop('visit');
    const nopin: StopDraft = { ...newStop('drop'), place: 'Old site', placeId: 'p9', placePinned: false, picked: true };
    setDraft({ ...d, fields: { ...d.fields, stops: [g, empty, nopin] } });
    await open();
    expect(rows()).toHaveLength(2);
    expect(places()).toEqual(['Google place', 'Old site']);
    expect(getDraft()!.fields.stops[0]).toMatchObject({ type: 'pickup', typeSet: true });
    expect(caption(0)).toBe('Stop 1 · Pickup');
    expect(screen.getByText(t('office.trip.googleStop'))).toBeTruthy();
    expect(screen.getByText(t('office.trip.noPinWarning', { place: 'Old site' }))).toBeTruthy();
  });

  it('Change stops (a task\'s stops) uses the same From / To layout', async () => {
    const task = FIX('task_detail');
    await open(`/office/trip/where?mode=stops&id=${task.task.id}`);
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(screen.getByTestId('from-row')).toBeTruthy();
    expect(screen.getByText(caps('office.trip.to'))).toBeTruthy();
    expect(caption(0)).toMatch(/^Stop 1 · Pickup/);
    expect(caption(1)).toMatch(/^Stop 2 · Drop-off/);
    expect(screen.getByTestId('add-stop')).toBeTruthy();
  });
});

describe('§38.2 inventory: every field and option is still reachable (the key actions)', () => {
  it('From, the rows, Options, the switches, Next and Save draft', async () => {
    await open();
    // Start from: Change opens the search with My location; typed text offers "Use <base>".
    fireEvent.press(screen.getByTestId('from-change'));
    expect(screen.getByTestId('my-location')).toBeTruthy();
    fireEvent.changeText(screen.getAllByTestId('place-input')[0], 'Somewhere else');
    expect(screen.getByText(t('office.trip.useBase', { name: 'Head office' }))).toBeTruthy();
    fireEvent.press(screen.getByText(t('office.trip.useBase', { name: 'Head office' })));
    await waitFor(() => expect(screen.getByTestId('from-name').props.children).toBe('Head office'));
    // Passengers get in here (+ what, note, time): From's Options.
    fireEvent.press(screen.getByTestId('from-options'));
    fireEvent.press(screen.getByTestId('start-role-in'));
    expect(screen.getByTestId('start-what-people')).toBeTruthy();
    expect(screen.getByTestId('start-note')).toBeTruthy();
    expect(screen.getByTestId('start-stay')).toBeTruthy();
    fireEvent.press(screen.getByTestId('start-role-leave'));
    fireEvent.press(screen.getByTestId('start-options-done'));
    // The stop's place (the same search box); the caption; Add stop.
    await pickFirst('Head office');
    expect(screen.getByText(t('office.trip.changePlace'))).toBeTruthy();
    fireEvent.press(screen.getByTestId('add-stop'));
    await pickFirst('Kandy depot');
    expect(screen.getByTestId('stop-caption-0')).toBeTruthy();
    // Type, What (Documents / Other), Arrive by, Stay, pin, note, Move up / down: the row's Options.
    fireEvent.press(screen.getByTestId('stop-options-0'));
    await screen.findByTestId('stop-options-sheet');
    for (const r of ['in', 'out', 'visit', 'goods']) expect(screen.getByTestId(`role-${r}`)).toBeTruthy();
    expect(screen.getByTestId('options-arrive')).toBeTruthy();
    expect(screen.getByTestId('options-stay')).toBeTruthy();
    fireEvent.press(within(screen.getByTestId('stop-details')).getByText(t('office.common.moreDetails')));
    fireEvent.press(screen.getByTestId('what-documents'));
    expect(getDraft()!.fields.stops[0].what).toBe('documents');
    fireEvent.changeText(screen.getByTestId('options-pin'), '6.93, 79.85');
    fireEvent.changeText(screen.getByTestId('options-note'), 'Ring the bell');
    expect(getDraft()!.fields.stops[0]).toMatchObject({ pin: '6.93, 79.85', note: 'Ring the bell' });
    expect(screen.getByTestId('options-move-up')).toBeTruthy();
    expect(screen.getByTestId('options-move-down')).toBeTruthy();
    fireEvent.press(screen.getByTestId('stop-options-done'));
    // The row says what is set.
    expect(caption(0)).toBe(`Stop 1 · Visit · ${t('office.trip.what_documents')} · ${t('office.trip.pinSet')} · ${t('office.trip.noteSet')}`);
    // Drag and remove on a middle row.
    expect(screen.getByTestId('stop-drag-0')).toBeTruthy();
    expect(screen.getByTestId('stop-remove-0')).toBeTruthy();
    // Same as start · Tick it: To at the start's place made People get in.
    fireEvent.press(screen.getByTestId('stop-remove-0'));
    fireEvent.press(screen.getByTestId('stop-options-0'));
    await screen.findByTestId('stop-options-sheet');
    fireEvent.press(screen.getByTestId('role-in'));
    fireEvent.press(screen.getByTestId('stop-options-done'));
    expect(screen.getByTestId('same-as-start')).toBeTruthy();
    fireEvent.press(screen.getByText(t('office.trip.tickIt')));
    expect(getDraft()!.fields.startPax).toBe(true);
    // The switches under To, Next and Save draft.
    fireEvent(within(screen.getByTestId('return-toggle')).UNSAFE_getByType(Switch), 'valueChange', false);
    expect(getDraft()!.fields.returnToBase).toBe(false);
    fireEvent(within(screen.getByTestId('expressway-toggle')).UNSAFE_getByType(Switch), 'valueChange', true);
    expect(getDraft()!.fields.avoidExpressway).toBe(true);
    expect(screen.getByTestId('trip-primary')).toBeTruthy();
    expect(screen.getByText(t('office.trip.saveDraft'))).toBeTruthy();
    await act(async () => undefined);
  });
});

describe('the drag\'s geometry', () => {
  const boxes = [0, 100, 200].map((y) => ({ y, h: 100 }));
  it('lands by the middles of the other rows', () => {
    expect(dropIndex(0, 0, boxes)).toBe(0);
    expect(dropIndex(0, 40, boxes)).toBe(0);
    expect(dropIndex(0, 160, boxes)).toBe(1);
    expect(dropIndex(0, 260, boxes)).toBe(2);
    expect(dropIndex(2, -160, boxes)).toBe(1);
    expect(dropIndex(2, -260, boxes)).toBe(0);
    expect(dropIndex(1, 160, [boxes[0], boxes[1], undefined])).toBe(1);
  });
});
