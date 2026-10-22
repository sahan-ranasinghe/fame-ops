// Round 4–7, feature 7 (Sahan, 22 October 2026): someone else has that driver or vehicle, Office mode through the router
// with the fake office. Per changed screen, the key actions are still there and the new ones work:
//   - Review's conflict card: Open that task, Call / WhatsApp the requester, Pick another driver (as before), plus the
//     holder with Call, WhatsApp and Ask for it (ask_for_it once, the snackbar);
//   - a saved notice's conflict card (Give it a driver, Change the task, Approve, Book now land on it): the lines and OK as
//     before, the holder card with Call, WhatsApp, Ask for it and Open that task;
//   - Who's available and the vehicle groups: a row still picks; a busy one names its holder with Ask (the wanted window);
//   - Alerts: open (its screen) and mark read, Mark all read as before; an item's Yes / No calls the tool with its args as
//     they are, marks it read, says "You said Yes"; a dropped answer says it may not have been saved, with Try again (the
//     same press, never sent again by itself);
//   - with no holder (the switch holder_contact off) nothing of it shows.
// The new strings are read from en.json merged with src/i18n/parts/holders.json while the sidecar exists.
/* eslint-disable @typescript-eslint/no-require-imports */
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';

import { answers, calls, failOnConsoleError, FIX, resetFake } from './fakeOffice';

jest.mock('@/office/client', () => ({ officeApi: require('./fakeOffice').mockOfficeApi }));
jest.mock('@/state/app', () => ({ useApp: () => mockWords() }));
jest.mock('@/office/store', () => ({ useOfficeMe: () => require('./fakeOffice').FIX('me'), getOfficeMe: () => require('./fakeOffice').FIX('me'), setOfficeMe: () => undefined }));

/** The app's provider as the other tests have it, with the sidecar's strings merged in (until the lead merges them). */
function mockWords() {
  const base = require('./fakeOffice').mockUseApp();
  // The sidecar while it exists (after the lead's merge the words are in en.json and this finds nothing).
  const parts: Record<string, unknown>[] = (() => {
    try {
      return [require('../src/i18n/parts/holders.json').en ?? {}];
    } catch {
      return [];
    }
  })();
  const find = (tree: unknown, key: string): unknown => key.split('.').reduce<unknown>((n, k) => (n && typeof n === 'object' ? (n as Record<string, unknown>)[k] : undefined), tree);
  return {
    ...base,
    t: (k: string, v?: Record<string, string | number>) => {
      const own = parts.map((p) => find(p, k)).find((x) => typeof x === 'string') as string | undefined;
      if (own === undefined) return base.t(k, v);
      let s = own;
      for (const [name, value] of Object.entries(v ?? {})) s = s.replaceAll(`{${name}}`, String(value));
      return s;
    },
  };
}

/* eslint-disable import/first */
import AlertsTab from '@/app/office/(tabs)/alerts';
import MoreTab from '@/app/office/(tabs)/more';
import ReviewScreen from '@/app/office/trip/review';
import { DriverRows } from '@/components/office/DriverRows';
import { ConflictCard } from '@/components/office/HolderParts';
import { SavedNotice } from '@/components/office/SavedNotice';
import { VehicleGroups } from '@/components/office/VehicleGroups';
import { hideSnackbar, shownSnackbar } from '@/components/patterns/Snackbar';
import { forgetAnswers } from '@/office/holderLogic';
import { setSavedNotice } from '@/office/savedNotice';
import { OfficeProvider } from '@/office/state';
import { forgetSwitches } from '@/office/switches';
import { groupRows } from '@/office/trip/formsLogic';
import { newDraft, setDraft } from '@/office/trip/draft';
import { newStop } from '@/office/trip/stopsLogic';
import type { Availability, AvailableDriver, Conflict, Holder, Inbox, Me as OfficeMe, SuggestedVehicle } from '@/office/types';

const t = mockWords().t;
const BASE: OfficeMe = FIX('me');
/** The fixture's admin, with the round's tools (the fixture was made before them). */
const ME: OfficeMe = { ...BASE, tools: [...BASE.tools, 'ask_for_it', 'answer_holder_ask', 'holder_asks', 'day_timeline'] };
const TASK = '1b2c3d4e-0000-4000-8000-00000000abcd';
const anoja: Holder = {
  task_id: TASK, employee_id: 'e1', name: 'Anoja Perera', label: 'Fleet admin', by: 'asked', window: '08:00–11:00', from: '08:00', to: '11:00',
  call: 'tel:+94771234567', whatsapp: 'https://wa.me/94771234567',
};
const vehicleConflict: Conflict = {
  kind: 'vehicle', text: 'FX 1 is on task Site visit 08:00–11:00 for Anoja Perera', task: { id: TASK, title: 'Site visit', window: '08:00–11:00' },
  requester: { name: 'Anoja Perera', call: 'tel:+94771234567', whatsapp: 'https://wa.me/94771234567' }, holder: anoja,
};

function TaskPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <><Text>{`task page ${id}`}</Text><SavedNotice noticeKey={`task:${id}`} /></>;
}

const routes = (screens: Record<string, () => React.ReactElement | null>, me: OfficeMe = ME) => ({
  _layout: () => <OfficeProvider me={me}><Stack screenOptions={{ headerShown: false }} /></OfficeProvider>,
  'office/task/[id]': TaskPage,
  'office/holder-asks': () => <Text>asks page</Text>,
  ...screens,
});

let errors: ReturnType<typeof failOnConsoleError>;
beforeEach(() => {
  resetFake();
  forgetAnswers();
  forgetSwitches();
  act(() => hideSnackbar());
  answers.ask_for_it = () => ({ ask_id: 'k1', asked: 'Anoja Perera', what: 'FX 1', wanted: 'Fri 24 Oct 08:00–11:00', next: 'Asked Anoja Perera.' });
  errors = failOnConsoleError();
});
afterEach(() => {
  errors.restore();
  setDraft(null);
});

/** Ask for it: the sheet, a note, Send twice (one call), the snackbar in the person's words. */
async function askThroughSheet(askButton: string, note = 'site visit') {
  fireEvent.press(screen.getByTestId(askButton));
  await screen.findByTestId('ask-for-it-sheet');
  fireEvent.changeText(screen.getByTestId('ask-for-it-note'), note);
  const send = screen.getByTestId('ask-for-it-send');
  fireEvent.press(send);
  fireEvent.press(send);
  await waitFor(() => expect(shownSnackbar()?.text).toBe(t('office.holders.askedSnack', { name: 'Anoja' })));
  const asked = calls.filter((c) => c.tool === 'ask_for_it');
  expect(asked).toHaveLength(1);
  return asked[0].args;
}

describe('Review: the conflict card', () => {
  it('keeps Open that task, Call / WhatsApp and Pick another driver, and adds the holder with Ask for it for this trip', async () => {
    answers.plan_task = () => ({ ...FIX('create_task'), conflicts: [vehicleConflict] });
    const d = newDraft('task');
    setDraft({ ...d, step: 'review', driverName: 'Driver A', fields: { ...d.fields, date: '2026-10-24', stops: [{ ...newStop('pickup'), place: 'Fixture office', picked: true, lat: 6.9, lng: 79.86 }, { ...newStop('drop'), place: 'Fixture site', picked: true, lat: 7.48, lng: 80.36, arriveBy: '11:00' }], driver: 'fixa', vehicle: 'FX 1', title: 'Team drop', leaveBy: '08:00' } });
    renderRouter(routes({ 'office/trip/review': ReviewScreen }), { initialUrl: '/office/trip/review' });
    await screen.findByText(vehicleConflict.text, {}, { timeout: 6000 });
    // As before.
    expect(screen.getByText(t('office.trip.openThatTask'))).toBeTruthy();
    expect(screen.getByText(t('office.trip.callName', { name: 'Anoja' }))).toBeTruthy();
    expect(screen.getByText(t('office.trip.whatsappName', { name: 'Anoja' }))).toBeTruthy();
    expect(screen.getByText(t('office.trip.pickAnotherVehicle'))).toBeTruthy();
    // The holder.
    expect(screen.getByText('Anoja Perera · Fleet admin')).toBeTruthy();
    expect(screen.getByText('Asked for it · 08:00–11:00')).toBeTruthy();
    expect(screen.getByTestId('conflict-holder-0-call')).toBeTruthy();
    expect(screen.getByTestId('conflict-holder-0-whatsapp')).toBeTruthy();
    const args = await askThroughSheet('conflict-holder-0-ask');
    expect(args).toMatchObject({ task_id: TASK, resource: 'vehicle', date: '2026-10-24', note: 'site visit' });
    expect(errors.seen.map((a) => String(a[0]))).toEqual([]);
  });

  it('no holder (holder_contact off): the card as before, nothing to ask', async () => {
    answers.plan_task = () => ({ ...FIX('create_task'), conflicts: [{ ...vehicleConflict, holder: undefined }] });
    const d = newDraft('task');
    setDraft({ ...d, step: 'review', driverName: 'Driver A', fields: { ...d.fields, stops: [{ ...newStop('pickup'), place: 'Fixture office', picked: true, lat: 6.9, lng: 79.86 }, { ...newStop('drop'), place: 'Fixture site', picked: true, lat: 7.48, lng: 80.36, arriveBy: '11:00' }], driver: 'fixa', vehicle: 'FX 1', title: 'Team drop', leaveBy: '08:00' } });
    renderRouter(routes({ 'office/trip/review': ReviewScreen }), { initialUrl: '/office/trip/review' });
    await screen.findByText(vehicleConflict.text, {}, { timeout: 6000 });
    expect(screen.getByText(t('office.trip.openThatTask'))).toBeTruthy();
    expect(screen.getByText(t('office.trip.callName', { name: 'Anoja' }))).toBeTruthy();
    expect(screen.queryByText(t('office.holders.askForIt'))).toBeNull();
    expect(screen.queryByTestId('conflict-holder-0')).toBeNull();
  });
});

describe('A save\'s notice with the conflicts', () => {
  it('keeps the lines and OK; the holder card has Call, WhatsApp, Ask for it and Open that task', async () => {
    setSavedNotice(`task:${TASK}`, ['FX 1 is over its monthly km allowance', vehicleConflict.text], undefined, [vehicleConflict]);
    renderRouter(routes({}), { initialUrl: `/office/task/${TASK}` });
    await screen.findByText('FX 1 is over its monthly km allowance');
    expect(screen.getByText(vehicleConflict.text)).toBeTruthy();
    expect(screen.getByTestId('saved-conflict-0-holder-call')).toBeTruthy();
    expect(screen.getByTestId('saved-conflict-0-holder-whatsapp')).toBeTruthy();
    expect(screen.getByTestId('saved-conflict-0-open')).toBeTruthy();
    const args = await askThroughSheet('saved-conflict-0-holder-ask', '');
    expect(args).toEqual({ task_id: TASK, resource: 'vehicle' });
    fireEvent.press(screen.getByTestId('saved-notice-ok'));
    await waitFor(() => expect(screen.queryByTestId('saved-notice')).toBeNull());
  });

  it('never offers to ask oneself, and a person without ask_for_it gets Call and WhatsApp only', async () => {
    const mine: Conflict = { ...vehicleConflict, holder: { ...anoja, name: ME.name } };
    renderRouter(routes({ 'office/one': () => <View><ConflictCard c={mine} testID="c" /><ConflictCard c={vehicleConflict} testID="d" /></View> }, { ...ME, tools: BASE.tools }), { initialUrl: '/office/one' });
    await screen.findByTestId('c');
    expect(screen.queryByTestId('c-holder-ask')).toBeNull();
    expect(screen.queryByTestId('c-holder-call')).toBeNull();
    expect(screen.getByText(t('office.holders.you'))).toBeTruthy();
    expect(screen.getByTestId('d-holder-call')).toBeTruthy();
    expect(screen.queryByTestId('d-holder-ask')).toBeNull();
  });
});

describe('Who\'s available and the vehicle groups', () => {
  const free: AvailableDriver = { name: 'Driver A', username: 'fixa', state: 'on_duty', status_text: 'On duty', accepted_today: 0, declined_today: 0, licence: { chip: 'ok' }, free: true };
  const busy = { ...free, name: 'Sunil Silva', username: 'sunil', state: 'on_task', status_text: 'On a task', free: false, holder: anoja } as AvailableDriver;
  const data = { as_of: '', window: { from: 'Fri 24 Oct 09:00', until: '12:00', day: '2026-10-24' }, drivers: [free, busy], counts: { free: 1, on_duty: 2, all: 2 }, vehicles: { groups: { free_pool: [], free_assigned: [], busy: [], in_garage: [] }, drivers_free: [] } } as Availability;
  const busyVehicle = { reg_no: 'FX 2', make_model: 'Toyota HiAce', availability: 'booked 08:00–11:00 · Site visit', pick: 'no', back: 'back ~11:00', holder: anoja } as SuggestedVehicle;

  it('a row still picks; a busy driver names the holder under the row, and Ask asks for the window shown', async () => {
    const onPick = jest.fn();
    renderRouter(routes({ 'office/rows': () => <DriverRows data={data} loading={false} error={null} picked="" onPick={onPick} onRetry={() => undefined} onSignIn={() => undefined} onAsk={() => undefined} /> }), { initialUrl: '/office/rows' });
    await screen.findByTestId('driver-row-fixa');
    fireEvent.press(screen.getByTestId('driver-row-sunil'));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ username: 'sunil' }));
    expect(screen.getByText(t('office.ask.open'))).toBeTruthy();
    expect(screen.queryByTestId('driver-holder-fixa')).toBeNull();
    expect(screen.getByText("Anoja's · 08:00–11:00")).toBeTruthy();
    const args = await askThroughSheet('driver-holder-sunil-ask', '');
    expect(args).toEqual({ task_id: TASK, resource: 'driver', date: '2026-10-24', from: '09:00', until: '12:00' });
  });

  it('a busy vehicle still picks and names its holder; the garage stays greyed', async () => {
    const onPick = jest.fn();
    const rows = groupRows({ groups: { free_pool: [], free_assigned: [], busy: [busyVehicle], in_garage: [{ reg_no: 'FX 3', availability: 'in garage', pick: 'no' }] }, vehicles: [] });
    renderRouter(routes({ 'office/vehicles': () => <VehicleGroups rows={rows} picked="" onPick={onPick} empty="none" wanted={{ date: '2026-10-24', from: '09:00' }} /> }), { initialUrl: '/office/vehicles' });
    await screen.findByTestId('vehicle-row-FX 2');
    fireEvent.press(screen.getByTestId('vehicle-row-FX 2'));
    expect(onPick).toHaveBeenCalledWith('FX 2');
    fireEvent.press(screen.getByTestId('vehicle-row-FX 3'));
    expect(onPick).toHaveBeenCalledTimes(1);
    const args = await askThroughSheet('vehicle-holder-FX 2-ask', '');
    expect(args).toEqual({ task_id: TASK, resource: 'vehicle', date: '2026-10-24', from: '09:00' });
  });
});

describe('Alerts: the buttons of an item', () => {
  const item = {
    id: 5, event: 'holder.asked', title: 'Kamal asks for FX 1', body: 'your trip "Site visit"', url: `/tasks/${TASK}`, who: 'Kamal', at: '2026-10-22 10:00', ago: '5 min ago', read: false, kind: 'urgent' as const,
    actions: [{ label: 'Yes', tool: 'answer_holder_ask', args: { ask_id: 'a1', answer: 'yes' } }, { label: 'No', tool: 'answer_holder_ask', args: { ask_id: 'a1', answer: 'no' } }],
  };
  const plain = { id: 6, event: 'request.decided', title: 'Your request was approved', url: `/tasks/${TASK}`, at: '2026-10-22 09:00', ago: '1 h ago', read: false, kind: 'alert' as const };
  const inbox = (): Inbox => ({ unread: 2, items: [item, plain] });

  it('Yes calls the tool with its args as they are, marks the item read and says "You said Yes"; the others keep opening', async () => {
    answers.my_inbox = inbox;
    answers.answer_holder_ask = () => ({ ask_id: 'a1', answer: 'yes' });
    renderRouter(routes({ 'office/alerts': AlertsTab }), { initialUrl: '/office/alerts' });
    await screen.findByText(item.title);
    expect(screen.getAllByTestId('inbox-actions')).toHaveLength(1);
    fireEvent.press(screen.getByTestId('inbox-action-yes'));
    await screen.findByText(t('office.holders.youSaid', { answer: 'Yes' }));
    expect(calls.filter((c) => c.tool === 'answer_holder_ask').map((c) => c.args)).toEqual([{ ask_id: 'a1', answer: 'yes' }]);
    expect(calls.filter((c) => c.tool === 'mark_inbox_read').map((c) => c.args)).toEqual([{ ids: [5] }]);
    expect(screen.queryByTestId('inbox-action-no')).toBeNull();
    // Kept: Mark all read, and a tap on an item opens its screen and marks it read.
    expect(screen.getByText(t('office.alerts.markAllRead'))).toBeTruthy();
    fireEvent.press(screen.getByText(plain.title));
    await screen.findByText(`task page ${TASK}`);
    expect(calls.filter((c) => c.tool === 'mark_inbox_read').map((c) => c.args)).toEqual([{ ids: [5] }, { ids: [6] }]);
  });

  it('a dropped answer may not have been saved: the sentence with Try again (the same press), never sent again by itself', async () => {
    answers.my_inbox = inbox;
    let n = 0;
    answers.answer_holder_ask = () => {
      n += 1;
      if (n === 1) throw { code: 'network', message: 'Network request failed', write: true };
      return { ask_id: 'a1', answer: 'no' };
    };
    renderRouter(routes({ 'office/alerts': AlertsTab }), { initialUrl: '/office/alerts' });
    await screen.findByText(item.title);
    fireEvent.press(screen.getByTestId('inbox-action-no'));
    await screen.findByText(t('office.error.writeDropped'));
    // Nothing is sent again by itself: still one call while the sentence shows.
    await act(async () => { await Promise.resolve(); });
    expect(n).toBe(1);
    expect(calls.filter((c) => c.tool === 'mark_inbox_read')).toHaveLength(0);
    fireEvent.press(screen.getByText(t('office.common.tryAgain')));
    await screen.findByText(t('office.holders.youSaid', { answer: 'No' }));
    expect(calls.filter((c) => c.tool === 'answer_holder_ask').map((c) => c.args)).toEqual([{ ask_id: 'a1', answer: 'no' }, { ask_id: 'a1', answer: 'no' }]);
  });

  it('Mark all read still reads them all', async () => {
    answers.my_inbox = inbox;
    renderRouter(routes({ 'office/alerts': AlertsTab }), { initialUrl: '/office/alerts' });
    await screen.findByText(item.title);
    fireEvent.press(screen.getByText(t('office.alerts.markAllRead')));
    await waitFor(() => expect(calls.some((c) => c.tool === 'mark_inbox_read' && (c.args as { all?: boolean }).all === true)).toBe(true));
  });

  it('an item without buttons (holder_contact off, any other event): no buttons', async () => {
    answers.my_inbox = () => ({ unread: 1, items: [{ ...item, actions: undefined }] });
    renderRouter(routes({ 'office/alerts': AlertsTab }), { initialUrl: '/office/alerts' });
    await screen.findByText(item.title);
    expect(screen.queryByTestId('inbox-actions')).toBeNull();
  });

  // Review of Round 4–7: the switch is read by the screen too, so an item answered before the switch went off has no buttons.
  it('holder_contact off (get_settings): an item that still carries Yes / No shows none; the item still opens', async () => {
    answers.my_inbox = inbox;
    answers.get_settings = () => ({ settings: { holder_contact: false } });
    renderRouter(routes({ 'office/alerts': AlertsTab }), { initialUrl: '/office/alerts' });
    await screen.findByText(item.title);
    await waitFor(() => expect(screen.queryByTestId('inbox-actions')).toBeNull());
    fireEvent.press(screen.getByText(plain.title));
    await screen.findByText(`task page ${TASK}`);
  });
});

describe('More: the asks for a busy driver or vehicle follow the switch', () => {
  it('holder_contact off: no Asks row; on: the row', async () => {
    answers.get_settings = () => ({ settings: { holder_contact: false } });
    const first = renderRouter(routes({ 'office/(tabs)/more': MoreTab }), { initialUrl: '/office/more' });
    await screen.findByText(t('office.holders.timelineTitle'));
    await waitFor(() => expect(screen.queryByText(t('office.holders.asksTitle'))).toBeNull());
    first.unmount();
    forgetSwitches();
    answers.get_settings = () => ({ settings: { holder_contact: true } });
    renderRouter(routes({ 'office/(tabs)/more': MoreTab }), { initialUrl: '/office/more' });
    expect(await screen.findByText(t('office.holders.asksTitle'))).toBeTruthy();
  });
});
