// Round 4–7, item 12 (docs/phase8-plan.md §33.13, "Restyle, never rebuild"): each office screen restyled to the approved
// mockups keeps its key actions. The four design pages (src/design: the REAL screens with the sample answers of
// sampleOffice.ts, no network) are rendered through the router, and per screen the actions are found and the ones that
// open a sheet or a place are pressed:
//   - Home: the stats row (each tile opens its list), Needs you now with its total, the requests, Give a driver, Snooze,
//     View all, Live map, Board, the bell, the avatar (My profile), New trip;
//   - Review: the facts, the route stepper, ⓘ (how it was planned), the driver with ✓ Checked and Change, who rides with
//     Edit, Back and the one primary button (Send to <driver>);
//   - the request: the banner, Call and WhatsApp the requester, the stepper, the best match with Choose another, Approve,
//     Decline (the reason sheet), ⋯ More with Change time and Ask drivers;
//   - the trip on the way: the banner (on the way, arrives about, the late chip; a tap opens Live), Call and WhatsApp the
//     driver, the stepper, who rides, the holder with Call and WhatsApp, the fuel card, the check, Change the task and
//     Change stops on the bar, ⋯ More with Swap vehicle, Show the driven route and Cancel task (its reason sheet).
// The words come from en.json merged with the sidecar src/i18n/parts/office-3.json while it exists (fakeOffice.mockUseApp).
/* eslint-disable @typescript-eslint/no-require-imports */
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { Stack } from 'expo-router';
import { Text } from 'react-native';

import { failOnConsoleError } from './fakeOffice';

jest.mock('@/state/app', () => ({ useApp: () => require('./fakeOffice').mockUseApp() }));

/* eslint-disable import/first */
import OfficeHomeDesign from '@/design/OfficeHome';
import OfficeRequestDesign from '@/design/OfficeRequest';
import OfficeReviewDesign from '@/design/OfficeReview';
import OfficeTripDesign from '@/design/OfficeTrip';
import { hideSnackbar } from '@/components/patterns/Snackbar';
import { setDraft } from '@/office/trip/draft';

const t = require('./fakeOffice').mockUseApp().t as (k: string, v?: Record<string, string | number>) => string;

const page = (name: string) => () => <Text>{`page ${name}`}</Text>;
const routes = {
  _layout: () => <Stack screenOptions={{ headerShown: false }} />,
  'design/office-home': OfficeHomeDesign,
  'design/office-review': OfficeReviewDesign,
  'design/office-request': OfficeRequestDesign,
  'design/office-trip': OfficeTripDesign,
  'office/(tabs)/approve': page('approve'),
  'office/(tabs)/tasks': page('tasks'),
  'office/(tabs)/live': page('live'),
  'office/(tabs)/alerts': page('alerts'),
  'office/(tabs)/trips': page('trips'),
  'office/(tabs)/index': page('home'),
  'office/issues/index': page('issues'),
  'office/issues/[id]': page('issue'),
  'office/vehicles/index': page('vehicles'),
  'office/reminders': page('reminders'),
  'office/profile': page('profile'),
  'office/request/[id]': page('request'),
  'office/request/[id]/time': page('change time'),
  'office/task/[id]': page('task'),
  'office/task/[id]/driver': page('give a driver'),
  'office/task/[id]/time': page('change the task'),
  'office/task/[id]/swap': page('swap'),
  'office/task/[id]/route': page('route'),
  'office/task/[id]/plan': page('plan'),
  'office/trip/where': page('where'),
  'office/holder-asks': page('asks'),
};

let errors: ReturnType<typeof failOnConsoleError>;
beforeEach(() => {
  act(() => hideSnackbar());
  errors = failOnConsoleError();
});
afterEach(() => {
  errors.restore();
  setDraft(null);
});

describe('Mockup 1: Home keeps its actions', () => {
  it('the stats row, Needs you now, the requests, Give a driver, Snooze, the links, the bell, the avatar, New trip', async () => {
    renderRouter(routes, { initialUrl: '/design/office-home' });
    expect(await screen.findByTestId('fleet-design-page')).toBeTruthy();
    await screen.findByTestId('stat-road', {}, { timeout: 5000 });
    expect(screen.getByTestId('stat-free')).toBeTruthy();
    expect(screen.getByTestId('stat-garage')).toBeTruthy();
    expect(screen.getByTestId('needs-you-now')).toHaveTextContent(t('office.home.needsYouNow'));
    expect(await screen.findByText('Kelaniya → Maliyadeva')).toBeTruthy();
    expect(screen.getByText(t('office.home.giveDriver'))).toBeTruthy();
    expect(screen.getByTestId('attention-snooze')).toBeTruthy();
    expect(screen.getAllByText(t('office.common.viewAll')).length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText(t('office.home.liveMap'))).toBeTruthy();
    expect(screen.getByText(t('office.home.board'))).toBeTruthy();
    expect(screen.getByTestId('bell')).toBeTruthy();
    expect(screen.getByTestId('top-bar-avatar')).toBeTruthy();
    expect(screen.getByTestId('new-trip')).toHaveTextContent(t('office.home.newTrip'));
    // A tile opens its list; the avatar opens My profile; Give a driver opens its screen.
    fireEvent.press(screen.getByTestId('stat-road'));
    expect(await screen.findByText('page live')).toBeTruthy();
    expect(errors.seen.map((a) => String(a[0]))).toEqual([]);
  });

  // Round 51b (30 October 2026; Uber's trip card, Google Calendar's event card): a card opens its item, not only its button.
  it('a needs-a-driver row opens its task (Give a driver keeps its own); the three tiles open Live, Vehicles · Free, Vehicles · In garage', async () => {
    const r = renderRouter(routes, { initialUrl: '/design/office-home' });
    fireEvent.press(await screen.findByTestId('home-needs-driver-t-design-2', {}, { timeout: 5000 }));
    expect(await screen.findByText('page task')).toBeTruthy();
    expect(r.getPathname()).toBe('/office/task/t-design-2');
    r.unmount();
    for (const [tile, path, filter] of [['stat-road', '/office/live', undefined], ['stat-free', '/office/vehicles', 'available'], ['stat-garage', '/office/vehicles', 'in_garage']] as const) {
      const rr = renderRouter(routes, { initialUrl: '/design/office-home' });
      fireEvent.press(await screen.findByTestId(tile, {}, { timeout: 5000 }));
      await waitFor(() => expect(rr.getPathname()).toBe(path));
      if (filter) expect(rr.getSearchParams().filter).toBe(filter);
      rr.unmount();
    }
  });

  it('the avatar opens My profile', async () => {
    renderRouter(routes, { initialUrl: '/design/office-home' });
    fireEvent.press(await screen.findByTestId('top-bar-avatar', {}, { timeout: 5000 }));
    expect(await screen.findByText('page profile')).toBeTruthy();
  });

  it('Give a driver opens Give it a driver', async () => {
    renderRouter(routes, { initialUrl: '/design/office-home' });
    fireEvent.press(await screen.findByText(t('office.home.giveDriver'), {}, { timeout: 5000 }));
    expect(await screen.findByText('page give a driver')).toBeTruthy();
  });
});

describe('Mockup 2: Review keeps its actions', () => {
  it('the facts, the stepper, ⓘ, the driver with ✓ Checked and Change, who rides with Edit, Back and Send', async () => {
    renderRouter(routes, { initialUrl: '/design/office-review' });
    expect(await screen.findByTestId('fleet-design-page')).toBeTruthy();
    await screen.findByTestId('review-facts', {}, { timeout: 5000 });
    expect(screen.getByTestId('review-stepper')).toBeTruthy();
    expect(screen.getByText('Wariyapola Divisional Hospital')).toBeTruthy();
    expect(screen.getByText(t('office.request.backAt', { place: 'Fame Global Solutions' }))).toBeTruthy();
    expect(await screen.findByText(t('office.ui3.checked'))).toBeTruthy();
    expect(screen.getByTestId('review-change-driver')).toHaveTextContent(t('office.trip.change'));
    expect(screen.getByTestId('review-edit-riders')).toHaveTextContent(t('office.trip.edit'));
    expect(screen.getByTestId('trip-back')).toHaveTextContent(t('common.back'));
    expect(screen.getByTestId('trip-primary')).toHaveTextContent(t('office.trip.sendTo', { name: 'Kamal Fernando' }));
    fireEvent.press(screen.getByTestId('plan-info'));
    expect(await screen.findByTestId('plan-info-sheet')).toBeTruthy();
    expect(errors.seen.map((a) => String(a[0]))).toEqual([]);
  });
});

describe('Mockup 3: the request keeps its actions', () => {
  it('the banner, Call and WhatsApp, the stepper, the best match and Choose another, Approve, Decline, ⋯ with Change time and Ask drivers', async () => {
    renderRouter(routes, { initialUrl: '/design/office-request' });
    expect(await screen.findByTestId('fleet-design-page')).toBeTruthy();
    const banner = await screen.findByTestId('request-banner', {}, { timeout: 5000 });
    expect(banner).toHaveTextContent('Waiting for your OK', { exact: false });
    expect(screen.getByTestId('request-call')).toBeTruthy();
    expect(screen.getByTestId('request-whatsapp')).toBeTruthy();
    expect(screen.getByTestId('request-stepper')).toBeTruthy();
    expect(screen.getByTestId('request-facts')).toBeTruthy();
    await screen.findByTestId('approve-row-kamal', {}, { timeout: 5000 });
    expect(screen.queryByTestId('approve-row-nuwan')).toBeNull();
    fireEvent.press(screen.getByTestId('choose-another'));
    expect(await screen.findByTestId('approve-row-nuwan')).toBeTruthy();
    expect(screen.getByTestId('approve-button')).toHaveTextContent(t('office.request.approveSend', { name: 'Kamal Fernando' }));
    expect(screen.getByTestId('decline-button')).toHaveTextContent(t('office.request.decline'));
    fireEvent.press(screen.getByTestId('request-more'));
    expect(await screen.findByTestId('decide-change-time')).toHaveTextContent(t('office.decide.changeTime'));
    expect(screen.getByTestId('request-ask-drivers')).toHaveTextContent(t('office.ask.open'));
    expect(errors.seen.map((a) => String(a[0]))).toEqual([]);
  });

  it('Decline opens its reason sheet', async () => {
    renderRouter(routes, { initialUrl: '/design/office-request' });
    fireEvent.press(await screen.findByTestId('decline-button', {}, { timeout: 5000 }));
    expect(await screen.findByText(t('office.request.declineTitle'))).toBeTruthy();
  });
});

describe('Mockup 4: the trip on the way keeps its actions', () => {
  it('the banner, Call and WhatsApp, the stepper, who rides, the holder, the fuel card, the check, the bar and ⋯ More', async () => {
    renderRouter(routes, { initialUrl: '/design/office-trip' });
    expect(await screen.findByTestId('fleet-design-page')).toBeTruthy();
    const banner = await screen.findByTestId('task-banner', {}, { timeout: 5000 });
    expect(banner).toHaveTextContent(t('office.ui3.onTheWayTo', { place: 'Wariyapola' }), { exact: false });
    expect(screen.getByTestId('task-banner-line')).toHaveTextContent(t('office.ui3.arrivesAbout', { time: '10:52' }), { exact: false });
    expect(screen.getByText(t('office.task.minLate', { min: 7 }))).toBeTruthy();
    expect(screen.getByTestId('task-driver-call')).toBeTruthy();
    expect(screen.getByTestId('task-driver-whatsapp')).toBeTruthy();
    expect(screen.getByTestId('task-stops')).toBeTruthy();
    expect(screen.getByTestId('timeline-estimate-0')).toHaveTextContent(t('office.timeline.estimate', { time: '10:52', updated: '10:31' }));
    expect(screen.getByTestId('task-passengers')).toBeTruthy();
    expect(screen.getByTestId('passenger-call')).toBeTruthy();
    expect(screen.getByTestId('passenger-whatsapp')).toBeTruthy();
    expect(screen.getByTestId('task-holder')).toHaveTextContent(t('office.ui3.assignedBy', { name: 'Palitha Fernando · Fleet admin' }), { exact: false });
    expect(screen.getByTestId('task-holder-call')).toBeTruthy();
    expect(screen.getByTestId('task-holder-whatsapp')).toBeTruthy();
    expect(screen.getByTestId('fuel-card')).toBeTruthy();
    expect(screen.getByText(t('office.checks.title'))).toBeTruthy();
    expect(screen.getByTestId('task-change-time')).toHaveTextContent(t('office.task.changeTime'));
    expect(screen.getByTestId('task-change-stops')).toHaveTextContent(t('office.task.changeStops'));
    fireEvent.press(screen.getByTestId('task-more'));
    expect(await screen.findByTestId('task-swap')).toHaveTextContent(t('office.task.swapVehicle'));
    expect(screen.getByTestId('task-route')).toHaveTextContent(t('office.history.showDrivenRoute'));
    expect(screen.getByTestId('task-cancel')).toHaveTextContent(t('office.task.cancel'));
    fireEvent.press(screen.getByTestId('task-cancel'));
    await waitFor(() => expect(screen.getByText(t('office.task.cancelTitle'))).toBeTruthy());
    expect(errors.seen.map((a) => String(a[0]))).toEqual([]);
  });

  it('Change the task opens its screen', async () => {
    renderRouter(routes, { initialUrl: '/design/office-trip' });
    fireEvent.press(await screen.findByTestId('task-change-time', {}, { timeout: 5000 }));
    expect(await screen.findByText('page change the task')).toBeTruthy();
  });

  it('the banner opens Live', async () => {
    renderRouter(routes, { initialUrl: '/design/office-trip' });
    fireEvent.press(await screen.findByTestId('task-banner', {}, { timeout: 5000 }));
    expect(await screen.findByText('page live')).toBeTruthy();
  });
});
