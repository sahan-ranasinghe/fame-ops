// Hotfix O2-H2, Part 2: Office mode's notification settings through the router. Profile shows one Notifications row with
// its summary (no switches); the Notifications screen shows only the groups this person's permissions can bring, each with
// its summary; a group's switch flips at once and turns back with a snackbar when the save fails; Pause all switches every
// shown event off and Resume puts them back.
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { Stack } from 'expo-router';

import { answers, calls, failOnConsoleError, FIX, mockOfficeApi, mockUseApp, resetFake } from './fakeOffice';

jest.mock('@/office/client', () => ({ officeApi: require('./fakeOffice').mockOfficeApi }));
jest.mock('@/state/app', () => ({ useApp: () => require('./fakeOffice').mockUseApp() }));
// Round 1 (7b): my own photo, saved through the driver's calls (mocked here: the picker and the save).
const mockPhoto = { uri: null as string | null, saved: [] as string[] };
jest.mock('@/office/myPhoto', () => ({
  useMyOfficePhoto: () => ({ uri: mockPhoto.uri, shown: (u: string) => { mockPhoto.uri = u; }, reload: () => undefined }),
  pickMyPhoto: async () => ({ id: 'p1', uri: 'file:///me.jpg', takenAt: '2026-10-21T05:00:00Z' }),
  saveMyOfficePhoto: async (photo: { id: string }) => { mockPhoto.saved.push(photo.id); return 'ok'; },
}));
jest.mock('@/office/store', () => ({ useOfficeMe: () => require('./fakeOffice').FIX('me'), getOfficeMe: () => require('./fakeOffice').FIX('me'), setOfficeMe: () => undefined }));

/* eslint-disable import/first */
import ProfileScreen from '@/app/office/profile';
import NotificationsScreen from '@/app/office/notifications/index';
import GroupScreen from '@/app/office/notifications/[group]';
import { hideSnackbar, SnackbarHost } from '@/components/patterns/Snackbar';
import { NOTIF_GROUPS } from '@/office/notificationGroups';
import { OfficeProvider } from '@/office/state';
import type { Me } from '@/office/types';

const t = mockUseApp().t;
const ALL_EVENTS = NOTIF_GROUPS.flatMap((g) => g.events);

/** The person's settings as the server keeps them (test-notif checks the needs against the server's EVENTS). */
let saved: Record<string, boolean> = {};

/** my_notification_settings: the events the permissions bring (`unfiltered`: every event, as an old answer might). */
function settingsAnswer(permissions: string[], unfiltered = false) {
  const events = ALL_EVENTS
    .filter((e) => unfiltered || e.needs.length === 0 || e.needs.some((p) => permissions.includes(p)))
    .map((e) => ({ event: e.event, label: `Server ${e.event}`, text: 'Server text', enabled: saved[e.event] ?? true }));
  return { events, devices: [], push: { configured: true } };
}

/** A save the test fails by hand (the switch is seen flipped before the answer). */
let failPending: (() => void) | null = null;

function setup(permissions: string[], opts: { unfiltered?: boolean; failSave?: boolean } = {}) {
  const me: Me = { ...FIX('me'), permissions };
  answers.my_notification_settings = () => settingsAnswer(permissions, opts.unfiltered);
  answers.set_my_notification_settings = (args) => {
    if (opts.failSave) {
      return new Promise((_, reject) => {
        failPending = () => reject({ code: 'network', message: 'Network request failed', write: true });
      });
    }
    Object.assign(saved, args.events as Record<string, boolean>);
    return settingsAnswer(permissions);
  };
  const routes = {
    _layout: () => (
      <OfficeProvider me={me}>
        <Stack screenOptions={{ headerShown: false }} />
        <SnackbarHost />
      </OfficeProvider>
    ),
    'office/profile': ProfileScreen,
    'office/notifications/index': NotificationsScreen,
    'office/notifications/[group]': GroupScreen,
  };
  return routes;
}

const checked = (testID: string) => screen.getByTestId(testID).props.accessibilityState?.checked;
const REQUESTER = ['view', 'request'];

describe('Office notification settings', () => {
  let errors: ReturnType<typeof failOnConsoleError>;
  beforeEach(() => {
    resetFake();
    saved = {};
    failPending = null;
    act(() => hideSnackbar());
    errors = failOnConsoleError();
  });
  afterEach(() => {
    errors.restore();
    expect(errors.seen.map((a) => String(a[0]))).toEqual([]);
  });

  it('Profile: my initials until there is a photo; Change photo opens the sheet; the gallery pick is saved as mine', async () => {
    mockPhoto.uri = null;
    mockPhoto.saved = [];
    renderRouter(setup(REQUESTER), { initialUrl: '/office/profile' });
    const link = await screen.findByTestId('profile-change-photo');
    expect(screen.getByText(t('profilePhoto.title'))).toBeTruthy();
    fireEvent.press(link);
    fireEvent.press(await screen.findByTestId('photo-choose'));
    await waitFor(() => expect(mockPhoto.saved).toEqual(['p1']));
  });

  it('Profile shows one Notifications row with its summary and no switches; the row opens the Notifications screen', async () => {
    saved = { 'request.arrived': false };
    renderRouter(setup(REQUESTER), { initialUrl: '/office/profile' });
    const row = await screen.findByTestId('profile-notifications');
    await waitFor(() => expect(screen.getByText(t('office.notif.stateSomeOff'))).toBeTruthy());
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
    fireEvent.press(row);
    expect(await screen.findByTestId('notif-pause')).toBeTruthy();
  });

  it('shows only the groups the permissions bring, each with its summary, even when the answer lists more', async () => {
    saved = { 'request.arrived': false };
    renderRouter(setup(REQUESTER, { unfiltered: true }), { initialUrl: '/office/notifications' });
    await screen.findByTestId('notif-group-mine');
    for (const g of ['requests', 'tasks', 'vehicles', 'mine']) expect(screen.getByTestId(`notif-group-${g}`)).toBeTruthy();
    for (const g of ['issues', 'drivers', 'other']) expect(screen.queryByTestId(`notif-group-${g}`)).toBeNull();
    expect(screen.getByText(`${t('office.notif.group.mine.sub')} · ${t('office.notif.nOfM', { on: 6, total: 7 })}`)).toBeTruthy();
    expect(screen.getAllByText(t('office.notif.allOn'))).toHaveLength(3);
    expect(screen.getByTestId('notif-phone-sound')).toBeTruthy();

    fireEvent.press(screen.getByTestId('notif-group-tasks'));
    await screen.findByTestId('notif-ev-task.declined');
    expect(screen.getByTestId('notif-ev-task.not_accepted')).toBeTruthy();
    // Approvers' and dispatchers' events never show for a requester.
    for (const e of ['task.vehicle_needed', 'task.running_late', 'task.stop_skipped']) expect(screen.queryByTestId(`notif-ev-${e}`)).toBeNull();
    expect(screen.getByText(t('office.notif.ev.task_declined.title'))).toBeTruthy();
    expect(screen.getByText(t('office.notif.ev.task_declined.text'))).toBeTruthy();
  });

  it('a switch flips at once and saves only that event', async () => {
    renderRouter(setup(REQUESTER), { initialUrl: '/office/notifications/mine' });
    await screen.findByTestId('notif-ev-request.arrived');
    expect(checked('notif-ev-request.arrived')).toBe(true);
    fireEvent.press(screen.getByTestId('notif-ev-request.arrived'));
    expect(checked('notif-ev-request.arrived')).toBe(false);
    await waitFor(() => expect(calls.filter((c) => c.tool === 'set_my_notification_settings')).toHaveLength(1));
    expect(calls.find((c) => c.tool === 'set_my_notification_settings')?.args).toEqual({ events: { 'request.arrived': false } });
    expect(checked('notif-ev-request.arrived')).toBe(false);
    expect(screen.queryByTestId('snackbar')).toBeNull();
  });

  it('a failed save turns the switch back and says so in the snackbar with Try again', async () => {
    renderRouter(setup(REQUESTER, { failSave: true }), { initialUrl: '/office/notifications/mine' });
    await screen.findByTestId('notif-ev-request.on_the_way');
    fireEvent.press(screen.getByTestId('notif-ev-request.on_the_way'));
    expect(checked('notif-ev-request.on_the_way')).toBe(false); // flipped at once
    await waitFor(() => expect(failPending).not.toBeNull());
    await act(async () => failPending?.());
    const bar = await screen.findByTestId('snackbar');
    expect(bar).toBeTruthy();
    expect(screen.getByText(t('office.notif.notSaved'))).toBeTruthy();
    expect(screen.getByText(t('office.notif.tryAgain'))).toBeTruthy();
    expect(checked('notif-ev-request.on_the_way')).toBe(true);
  });

  it('Pause all switches every shown event off, and Resume puts back what each one was', async () => {
    saved = { 'request.arrived': false };
    renderRouter(setup(REQUESTER), { initialUrl: '/office/notifications' });
    await screen.findByTestId('notif-pause');
    expect(checked('notif-pause')).toBe(false);
    fireEvent.press(screen.getByTestId('notif-pause'));
    await waitFor(() => expect(checked('notif-pause')).toBe(true));
    const pauseCall = calls.find((c) => c.tool === 'set_my_notification_settings');
    const offs = pauseCall?.args.events as Record<string, boolean>;
    expect(Object.values(offs).every((v) => v === false)).toBe(true);
    expect('request.arrived' in offs).toBe(false); // already off
    expect('request.created' in offs).toBe(false); // hidden: keeps its value
    expect(screen.getByText(t('office.notif.pausedNote'))).toBeTruthy();
    expect(screen.getByTestId('notif-group-mine').props.accessibilityState?.disabled).toBe(true);

    fireEvent.press(screen.getByTestId('notif-pause'));
    await waitFor(() => expect(checked('notif-pause')).toBe(false));
    expect(saved['request.arrived']).toBe(false);
    expect(saved['request.on_the_way']).toBe(true);
    expect(screen.getByText(`${t('office.notif.group.mine.sub')} · ${t('office.notif.nOfM', { on: 6, total: 7 })}`)).toBeTruthy();
  });
});

void mockOfficeApi;
