// Hotfix O2-H2, Part 1a + 1b: the trip editor's last button, run through the router with the real answers. The steps stay
// mounted in the stack (Where → When → Who → Review); after the save the draft is cleared, and every step under Review
// re-renders with no draft. Before the fix the Who step then called one hook fewer ("Rendered fewer hooks than
// expected"): a white screen in a release build, the trip already saved. Since 1b the form closes, the saved item opens
// with a snackbar (Gmail's "Sent"), the warnings wait on it; a refused save keeps the form and is never sent again by
// itself.
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';

import { answers, calls, failOnConsoleError, FIX, mockOfficeApi, mockUseApp, resetFake } from './fakeOffice';

jest.mock('@/office/client', () => ({ officeApi: require('./fakeOffice').mockOfficeApi }));
jest.mock('@/state/app', () => ({ useApp: () => require('./fakeOffice').mockUseApp() }));
jest.mock('@/office/store', () => ({ useOfficeMe: () => require('./fakeOffice').FIX('me'), getOfficeMe: () => require('./fakeOffice').FIX('me'), setOfficeMe: () => undefined }));

/* eslint-disable import/first */
import WhoScreen from '@/app/office/trip/who';
import ReviewScreen from '@/app/office/trip/review';
import { SavedNotice } from '@/components/office/SavedNotice';
import { hideSnackbar, shownSnackbar } from '@/components/patterns/Snackbar';
import { newDraft, setDraft, getDraft } from '@/office/trip/draft';
import { newStop } from '@/office/trip/stopsLogic';
import { OfficeProvider } from '@/office/state';
import type { Me as OfficeMe } from '@/office/types';

const ME: OfficeMe = FIX('me');
const t = mockUseApp().t;
const TASK_ID = FIX('create_task').task_id as string;
const REQUEST_ID = FIX('create_request').request.id as string;

const stops = () => [
  { ...newStop('pickup'), place: 'Fixture office', placeId: '00000000-0000-4000-8000-000000000001', picked: true, lat: 6.9, lng: 79.86, what: 'people' as const },
  { ...newStop('drop'), place: 'Fixture site', placeId: '00000000-0000-4000-8000-000000000002', picked: true, lat: 7.48, lng: 80.36, what: 'people' as const, arriveBy: '11:00' },
];

function taskDraft() {
  const d = newDraft('task');
  return { ...d, step: 'who' as const, driverName: 'Driver A', fields: { ...d.fields, stops: stops(), driver: 'fixa', vehicle: 'FX 1', title: 'Team drop', leaveBy: '08:00', pax: '3' } };
}

function requestDraft() {
  const d = newDraft('request');
  return { ...d, step: 'review' as const, fields: { ...d.fields, stops: stops(), leaveBy: '08:00', pax: '3' } };
}

function TaskPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <><Text>{`task page ${id}`}</Text><SavedNotice noticeKey={`task:${id}`} /></>;
}
function RequestPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <><Text>{`request page ${id}`}</Text><SavedNotice noticeKey={`request:${id}`} /></>;
}

const routesFor = (me: OfficeMe) => ({
  _layout: () => <OfficeProvider me={me}><Stack screenOptions={{ headerShown: false }} /></OfficeProvider>,
  'office/trip/who': WhoScreen,
  'office/trip/review': ReviewScreen,
  'office/(tabs)/tasks': () => <Text>tasks list</Text>,
  'office/(tabs)/trips': () => <><Text>trips list</Text><SavedNotice noticeKey="/office/(tabs)/trips" /></>,
  'office/task/[id]': TaskPage,
  'office/request/[id]': RequestPage,
});

let errors: ReturnType<typeof failOnConsoleError>;
beforeEach(() => {
  resetFake();
  act(() => hideSnackbar());
  errors = failOnConsoleError();
});
afterEach(() => {
  errors.restore();
  setDraft(null);
});

describe('Assign a task: the last button', () => {
  it('saves once, opens the new task with a snackbar and its warnings, and never throws (the white screen)', async () => {
    answers.create_task = () => ({ ...FIX('create_task'), warnings: ['FX 1 is over its monthly km allowance'] });
    setDraft(taskDraft());
    const r = renderRouter(routesFor(ME), { initialUrl: '/office/trip/who' });
    await waitFor(() => expect(screen.getByText(t('office.trip.nextReview'))).toBeTruthy());
    fireEvent.press(screen.getByText(t('office.trip.nextReview')));
    const send = await screen.findByText(t('office.trip.sendTo', { name: 'Driver A' }));
    fireEvent.press(send);
    fireEvent.press(send); // a second press while the first is on its way does nothing
    await screen.findByText(`task page ${TASK_ID}`, {}, { timeout: 5000 });
    expect(r.getPathname()).toBe(`/office/task/${TASK_ID}`);
    expect(calls.filter((c) => c.tool === 'create_task')).toHaveLength(1);
    expect(shownSnackbar()?.text).toBe(t('office.saved.taskAssigned', { name: 'Driver A' }));
    expect(screen.getByTestId('saved-notice')).toBeTruthy();
    expect(screen.getByText('FX 1 is over its monthly km allowance')).toBeTruthy();
    expect(getDraft()).toBeNull();
    expect(errors.seen.map((a) => String(a[0]))).toEqual([]);
  });

  it('a refused save keeps the form, says why with Try again, and is not sent again by itself', async () => {
    answers.create_task = () => {
      throw { code: 'network', message: 'No connection to Fame Fleet.', write: true };
    };
    setDraft({ ...taskDraft(), step: 'review' as const });
    const r = renderRouter(routesFor(ME), { initialUrl: '/office/trip/review' });
    fireEvent.press(await screen.findByText(t('office.trip.sendTo', { name: 'Driver A' })));
    await waitFor(() => expect(calls.filter((c) => c.tool === 'create_task')).toHaveLength(1));
    expect(await screen.findByText(t('office.error.writeDropped'))).toBeTruthy();
    expect(screen.getByText(t('office.common.tryAgain'))).toBeTruthy();
    expect(r.getPathname()).toBe('/office/trip/review');
    expect(getDraft()).not.toBeNull();
    expect(shownSnackbar()).toBeNull();
    // Try again sends the same call once more, on the person's press only.
    fireEvent.press(screen.getByText(t('office.common.tryAgain')));
    await waitFor(() => expect(calls.filter((c) => c.tool === 'create_task')).toHaveLength(2));
    const sent = calls.filter((c) => c.tool === 'create_task');
    expect(sent[1].args).toEqual(sent[0].args);
    expect(errors.seen.map((a) => String(a[0]))).toEqual([]);
  });
});

describe('Request a vehicle: the last button', () => {
  it('an approver lands on the new request, with "Request sent"', async () => {
    setDraft(requestDraft());
    const r = renderRouter(routesFor({ ...ME, tools: ME.tools.filter((x: string) => x !== 'book_vehicle') }), { initialUrl: '/office/trip/review' });
    fireEvent.press(await screen.findByText(t('office.trip.sendRequest')));
    await screen.findByText(`request page ${REQUEST_ID}`, {}, { timeout: 5000 });
    expect(r.getPathname()).toBe(`/office/request/${REQUEST_ID}`);
    expect(shownSnackbar()?.text).toBe(t('office.saved.requestSent'));
    expect(getDraft()).toBeNull();
    expect(errors.seen.map((a) => String(a[0]))).toEqual([]);
  });

  it('someone who only asks lands on My trips (they cannot open the approver\'s page)', async () => {
    setDraft(requestDraft());
    const asker: OfficeMe = { ...ME, permissions: ['request'], tools: ME.tools.filter((x: string) => !['book_vehicle', 'create_task', 'decide_request'].includes(x)) };
    const r = renderRouter(routesFor(asker), { initialUrl: '/office/trip/review' });
    fireEvent.press(await screen.findByText(t('office.trip.sendRequest')));
    await screen.findByText('trips list', {}, { timeout: 5000 });
    expect(r.getPathname()).toBe('/office/trips');
    expect(shownSnackbar()?.text).toBe(t('office.saved.requestSent'));
    expect(errors.seen.map((a) => String(a[0]))).toEqual([]);
  });
});

void mockOfficeApi;
