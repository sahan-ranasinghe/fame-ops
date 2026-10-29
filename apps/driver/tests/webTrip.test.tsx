// Round 50 (29 October 2026, phase8-plan.md §37.5): /m/ driver-lite's drive page (app/office/my-trip/[id]/drive.tsx)
// through the router with the fake office: Start (the check, the fuel card, the odometer photo and reading) sends ONE
// web_trip_action with the browser's one position; each stop's Arrived and Done slides; Finish with the odometer and the
// fuel; Try again sends the same client id; offline is refused at once with nothing sent; no position still saves, said
// so; a trip driven in the app says so; the trip page's offer shows in a browser only.
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { router, Stack } from 'expo-router';
import { Platform, Text } from 'react-native';

import { answers, calls, failOnConsoleError, FIX, mockUseApp, resetFake } from './fakeOffice';

let mockOnline: boolean | undefined = true;
let mockWhere: unknown = { ok: true, lat: 7.486398, lng: 80.362345, accuracy_m: 12 };
let mockUuid = 0;
let mockPhoto = 0;

jest.mock('@/office/client', () => ({ officeApi: require('./fakeOffice').mockOfficeApi }));
jest.mock('@/state/app', () => ({ useApp: () => require('./fakeOffice').mockUseApp() }));
jest.mock('@/office/store', () => ({ useOfficeMe: () => require('./fakeOffice').FIX('me'), getOfficeMe: () => require('./fakeOffice').FIX('me'), setOfficeMe: () => undefined }));
jest.mock('@/office/webPosition', () => ({ askOnePosition: async () => mockWhere, browserOnline: () => mockOnline }));
jest.mock('expo-crypto', () => ({ randomUUID: () => `uuid-${++mockUuid}` }));
jest.mock('@/office/media', () => ({ pickPhoto: async () => ({ photo: { uri: 'file:///shot.jpg', bytes: 1, width: 1, height: 1 } }) }));
jest.mock('@/office/myPhoto', () => ({ saveMyTripPhoto: async (kind: string) => ({ id: `${kind}-${++mockPhoto}` }) }));

/* eslint-disable import/first */
import DriveTrip from '@/app/office/my-trip/[id]/drive';
import { WebDriveOffer } from '@/components/office/WebDriveOffer';
import { hideSnackbar, shownSnackbar } from '@/components/patterns/Snackbar';
import { OfficeProvider } from '@/office/state';
import type { Me as OfficeMe, MyTrip, MyTripWeb } from '@/office/types';

const ME: OfficeMe = FIX('me');
const t = mockUseApp().t;
const TASK = '7d3c1f9e-0000-4000-8000-000000000001';

const STOPS: MyTripWeb['stops'] = [
  { id: 'stop-1', n: 1, type: 'pickup', place: 'Head office', status: 'pending' },
  { id: 'stop-2', n: 2, type: 'drop', place: 'Kurunegala site', status: 'pending' },
];
function trip(web: Partial<MyTripWeb> = {}, patch: Partial<MyTrip> = {}): MyTrip {
  return {
    viewer: 'owner', task_id: TASK, title: 'Site visit', date: '2026-10-29', leave_at: '08:00', vehicle: 'WP CAB-4521', driven_by: 'self',
    stops: [{ n: 1, type: 'pickup', place: 'Head office' }, { n: 2, type: 'drop', place: 'Kurunegala site' }], state: 'to_check',
    window: { opens_at: '06:00', open: true, past: false }, check_needed: true, can: { check: true, finish: false }, last_odometer_km: 45210,
    web: { allowed: true, started: false, check_needed: true, last_km: 45210, fuel_card: { asked: true, estimate_text: 'About 180 km · roughly 13–17 L diesel (approx.)' }, stops: STOPS, ...web },
    ...patch,
  };
}

const routes = {
  _layout: () => <OfficeProvider me={ME}><Stack screenOptions={{ headerShown: false }} /></OfficeProvider>,
  'office/(tabs)/index': () => <Text>home</Text>,
  'office/my-trip/[id]': () => <Text>trip page</Text>,
  'office/my-trip/[id]/drive': DriveTrip,
};

let errors: ReturnType<typeof failOnConsoleError>;
beforeEach(() => {
  resetFake();
  act(() => hideSnackbar());
  mockOnline = true;
  mockUuid = 0;
  mockPhoto = 0;
  mockWhere = { ok: true, lat: 7.486398, lng: 80.362345, accuracy_m: 12 };
  errors = failOnConsoleError();
});
afterEach(() => errors.restore());

async function open(answer: MyTrip) {
  answers.my_trip ??= () => answer;
  const r = renderRouter(routes, { initialUrl: '/office' });
  act(() => router.push(`/office/my-trip/${TASK}/drive`));
  await screen.findByText('Site visit', {}, { timeout: 5000 });
  return r;
}
const actions = () => calls.filter((c) => c.tool === 'web_trip_action').map((c) => c.args);

/** The server as the page sees it: web_trip_action changes the trip my_trip answers next (the page asks again after it). */
function server(start: MyTrip, after: (args: Record<string, unknown>) => Record<string, unknown>) {
  let now = start;
  answers.my_trip = () => now;
  answers.web_trip_action = (args) => {
    const r = after(args);
    const w = now.web!;
    const stop = r.stop as { id: string; status: 'arrived' | 'done'; at: string } | undefined;
    now = {
      ...now,
      ...(r.status === 'completed' ? { state: 'done' as const, km: r.km as number } : {}),
      web: {
        ...w,
        started: true,
        driven_in: 'web',
        ...(r.status === 'completed' ? { allowed: false } : {}),
        stops: w.stops.map((x) => (stop && x.id === stop.id ? { ...x, status: stop.status } : x)),
      },
    };
    return r;
  };
}

describe('/m/ driver-lite: the drive page', () => {
  it('says live tracking needs the app, and Start waits for the check, the fuel answer and the odometer photo', async () => {
    await open(trip());
    expect(screen.getByText(t('office.webTrip.noTracking'))).toBeTruthy();
    expect(screen.getByText(t('office.webTrip.why.check'))).toBeTruthy();
    fireEvent.press(screen.getByText(t('office.myTrip.allGood')));
    expect(screen.getByText(t('office.webTrip.why.fuel'))).toBeTruthy();
    expect(screen.getByText(t('office.fuel.estimate', { km: '180', litres: '13–17', fuel: t('office.fuel.word_diesel') }))).toBeTruthy();
    fireEvent.press(screen.getByText(t('office.webTrip.fuelEnough')));
    expect(screen.getByText(t('office.webTrip.why.odoPhoto'))).toBeTruthy();
    fireEvent.press(screen.getByText(t('office.webTrip.startButton')));
    expect(actions()).toHaveLength(0);
    expect(errors.seen.map((a) => String(a[0]))).toEqual([]);
  });

  it('Start sends one web_trip_action with the check, the fuel answer, the photo, the reading and one position', async () => {
    server(trip(), () => ({ task_id: TASK, status: 'in_progress', driven_in: 'web', next: 'Arrive at Head office' }));
    await open(trip());
    fireEvent.press(screen.getByText(t('office.myTrip.allGood')));
    fireEvent.press(screen.getByText(t('office.webTrip.fuelEnough')));
    fireEvent.press(screen.getByText(t('office.webTrip.odoPhoto')));
    await screen.findByText(t('office.myTrip.odometerPhoto'));
    fireEvent.changeText(screen.getByTestId('web-odometer'), '45230');
    await waitFor(() => expect(screen.queryByTestId('web-start-why')).toBeNull());
    fireEvent.press(screen.getByText(t('office.webTrip.startButton')));
    await waitFor(() => expect(shownSnackbar()?.text).toBe(t('office.webTrip.done.started')));
    expect(actions()).toEqual([{
      task_id: TASK, client_id: 'uuid-1', action: 'start', position: { lat: 7.486398, lng: 80.362345, accuracy_m: 12 }, odometer_km: 45230,
      odometer_photo_id: 'odometer-1', check: { result: 'ok' }, fuel_answer: 'enough',
    }]);
    // The next step at once: the first stop's Arrived slide.
    expect(await screen.findByTestId('web-slide-arrive')).toBeTruthy();
    expect(errors.seen.map((a) => String(a[0]))).toEqual([]);
  });

  it('each stop: Arrived, then Done, each with its own client id and the stop', async () => {
    let n = 0;
    server(trip({ started: true }), (args) => ({ task_id: TASK, status: 'in_progress', driven_in: 'web', stop: { id: args.stop_id, status: args.action === 'arrive' ? 'arrived' : 'done', at: ++n === 1 ? '08:40' : '08:45' }, next: '' }));
    await open(trip({ started: true }));
    expect(screen.getAllByText('Head office').length).toBeGreaterThan(0);
    fireEvent(screen.getByTestId('web-slide-arrive'), 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
    await waitFor(() => expect(shownSnackbar()?.text).toBe(t('office.webTrip.done.arrived', { place: 'Head office', time: '08:40' })));
    const leave = await screen.findByTestId('web-slide-leave');
    fireEvent(leave, 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
    await waitFor(() => expect(shownSnackbar()?.text).toBe(t('office.webTrip.done.left', { place: 'Head office', time: '08:45' })));
    const sent = actions();
    expect(sent.map((a) => [a.action, a.stop_id])).toEqual([['arrive', 'stop-1'], ['leave', 'stop-1']]);
    expect(new Set(sent.map((a) => a.client_id)).size).toBe(2);
    expect(await screen.findByText(t('task.slideArrive', { stop: 'Kurunegala site' }))).toBeTruthy();
    expect(errors.seen.map((a) => String(a[0]))).toEqual([]);
  });

  it('a dropped connection: the error with Try again, which sends the same client id', async () => {
    let first = true;
    answers.web_trip_action = (args) => {
      if (first) {
        first = false;
        throw { code: 'network', message: 'No connection to Fame Fleet.', write: true };
      }
      return { task_id: TASK, status: 'in_progress', driven_in: 'web', stop: { id: args.stop_id, status: 'arrived', at: '08:40' }, next: '' };
    };
    await open(trip({ started: true }));
    fireEvent(screen.getByTestId('web-slide-arrive'), 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
    const again = await screen.findByText(t('office.common.tryAgain'));
    fireEvent.press(again);
    await waitFor(() => expect(shownSnackbar()?.text).toBe(t('office.webTrip.done.arrived', { place: 'Head office', time: '08:40' })));
    const sent = actions();
    expect(sent).toHaveLength(2);
    expect(sent[0].client_id).toBe(sent[1].client_id);
  });

  it('offline: refused at once, nothing sent (no queue on the web)', async () => {
    mockOnline = false;
    await open(trip({ started: true }));
    fireEvent(screen.getByTestId('web-slide-arrive'), 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
    expect(await screen.findByText(t('office.common.tryAgain'))).toBeTruthy();
    expect(actions()).toHaveLength(0);
  });

  it('no position: the action still saves without one, and the page says why', async () => {
    mockWhere = { ok: false, reason: 'denied' };
    answers.web_trip_action = (args) => ({ task_id: TASK, status: 'in_progress', driven_in: 'web', stop: { id: args.stop_id, status: 'arrived', at: '08:40' }, next: '' });
    await open(trip({ started: true }));
    fireEvent(screen.getByTestId('web-slide-arrive'), 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
    expect(await screen.findByText(t('office.webTrip.noPosition.denied'))).toBeTruthy();
    expect(actions()[0].position).toBeUndefined();
  });

  it('Finish: the odometer photo and reading (km as typed), the fuel with its receipt, no video; then the done card', async () => {
    const done = STOPS.map((x) => ({ ...x, status: 'done' as const }));
    server(trip({ started: true, stops: done }, { start_odometer_km: 45230, state: 'on_the_way' }), () => ({ task_id: TASK, status: 'completed', driven_in: 'web', km: 42, next: '' }));
    await open(trip({ started: true, stops: done }, { start_odometer_km: 45230, state: 'on_the_way' }));
    expect(screen.getByText(t('office.webTrip.why.odoPhoto'))).toBeTruthy();
    fireEvent.press(screen.getByText(t('office.webTrip.odoPhoto')));
    await screen.findByText(t('office.myTrip.odometerPhoto'));
    fireEvent.changeText(screen.getByTestId('web-odometer-end'), '45272');
    expect(await screen.findByText(`${t('office.webTrip.startWas', { km: '45,230' })} · ${t('office.webTrip.kmSoFar', { km: '42' })}`)).toBeTruthy();
    fireEvent.press(screen.getByText(t('office.common.moreDetails')));
    expect(screen.getByText(t('office.webTrip.noVideo'))).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('web-litres'), '12.5');
    fireEvent.changeText(screen.getByTestId('web-lkr'), '4500');
    fireEvent.press(screen.getAllByText(t('office.media.takePhoto'))[0]);
    await screen.findByText(t('office.webTrip.receipt'), {}, { timeout: 3000 });
    await waitFor(() => expect(screen.queryByTestId('web-finish-why')).toBeNull());
    fireEvent.press(screen.getByText(t('office.webTrip.finishButton')));
    await waitFor(() => expect(shownSnackbar()?.text).toBe(t('office.webTrip.done.finished', { km: '42' })));
    expect(actions()).toEqual([{
      task_id: TASK, client_id: expect.stringMatching(/^uuid-/), action: 'finish', position: { lat: 7.486398, lng: 80.362345, accuracy_m: 12 }, odometer_km: 45272,
      odometer_photo_id: 'odometer-1', fuel: { litres: 12.5, lkr: 4500, receipt_photo_id: 'fuel_receipt-2' },
    }]);
    expect(await screen.findByTestId('web-trip-done')).toBeTruthy();
    expect(errors.seen.map((a) => String(a[0]))).toEqual([]);
  });

  it('a trip driven in the app: says so, offers nothing', async () => {
    await open(trip({ allowed: false, driven_in: 'app', started: true }));
    expect(screen.getByText(t('office.webTrip.inApp'))).toBeTruthy();
    expect(screen.queryByTestId('web-slide-arrive')).toBeNull();
    expect(screen.queryByText(t('office.webTrip.startButton'))).toBeNull();
  });
});

describe('The trip page\'s offer', () => {
  const OS = Platform.OS;
  afterEach(() => { Object.defineProperty(Platform, 'OS', { value: OS, configurable: true }); });

  it('never on the phone app (it has Driving mode)', () => {
    const r = renderRouter({ _layout: () => <Stack screenOptions={{ headerShown: false }} />, index: () => <WebDriveOffer trip={trip()} /> }, { initialUrl: '/' });
    expect(r.queryByTestId('web-drive-offer')).toBeNull();
  });

  it('in a browser when my_trip allows it: "Drive this trip here" opens the drive page', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
    const r = renderRouter({
      _layout: () => <Stack screenOptions={{ headerShown: false }} />,
      index: () => <><WebDriveOffer trip={trip()} /><WebDriveOffer trip={trip({ allowed: false })} /></>,
      'office/my-trip/[id]/drive': () => <Text>drive page</Text>,
    }, { initialUrl: '/' });
    expect(r.getAllByTestId('web-drive-offer')).toHaveLength(1);
    fireEvent.press(screen.getByText(t('office.webTrip.offer')));
    await screen.findByText('drive page');
    expect(r.getPathname()).toBe(`/office/my-trip/${TASK}/drive`);
  });
});
