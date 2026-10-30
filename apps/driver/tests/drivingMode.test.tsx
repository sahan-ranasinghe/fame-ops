// Round 50 (docs/phase8-plan.md §37.4): Driving mode, an office person's own trips on the driver screens in the same
// account (Uber's driver mode switch), and a driver's screens unchanged:
//   - Today in Driving mode: their trip, the Driving mode card with Back to office; no Start work, no duty tiles, no Start a
//     trip, no Can't do this task / Running late; Back to office returns to Office mode. A driver's Today: Start work as before.
//   - Me in Driving mode: Back to office in place of Sign out; no Availability, Edit or Change vehicle; Phone setup stays. A
//     driver's Me: Sign out and Availability as before.
//   - Office mode's Home: "You have a trip to drive · Start driving" for a person who can drive (Driving mode opens), none
//     for one who cannot or with the setting off.
// The real screens through the router with the design pages' sample state (src/design/sampleDriver.ts, sampleOffice.ts).
/* eslint-disable @typescript-eslint/no-require-imports */
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { Stack } from 'expo-router';
import { Text } from 'react-native';

import { failOnConsoleError } from './fakeOffice';

let mockKind: 'office' | 'driver' = 'office';
let mockToday: 'accepted' | 'off' = 'accepted';
let mockOfficeApp: Record<string, unknown> | null = null;
const mockLeave = jest.fn(async () => 'drop' as const);
const mockEnter = jest.fn(async () => 'ok' as const);
const mockLoadTrips = jest.fn();
let mockValue: Record<string, unknown> | null = null;

/** The driver app's state for the driver screens: a driver's sample, or the same made an office person's (Driving mode). */
function mockApp() {
  if (mockOfficeApp) return mockOfficeApp;
  if (!mockValue) {
    const { sampleApp } = require('../src/design/sampleDriver');
    const base = sampleApp({ language: 'en', now: Date.now(), today: mockToday });
    const office = mockKind === 'office';
    const me = office ? { ...base.me, role: 'fleet_admin', name: 'Sahan Ranasinghe' } : { ...base.me, role: 'driver' };
    // In Driving mode the list holds only their own self-drive trips (the query and the phone's copy filter it).
    const tasks = office ? base.tasks.slice(0, 1).map((task: Record<string, unknown>) => ({ ...task, driven_by: 'self', employee_id: me.id })) : base.tasks;
    mockValue = {
      ...base,
      me,
      tasks,
      officeDriver: office,
      driving: true,
      leaveDriving: mockLeave,
      requireLocation: async (_purpose: string, action: () => void) => {
        action();
        return true;
      },
    };
  }
  return mockValue;
}

jest.mock('@/state/app', () => ({ useApp: () => mockApp() }));
jest.mock('@/components/Photos', () => ({ Thumb: () => null, useVehicleThumbs: () => ({}), useMyPhoto: () => null, useLicencePhotos: () => ({}) }));
jest.mock('@/components/PhoneSetup', () => ({ useStoppedNote: () => ({ note: null }) }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
// Me's video line reads the queue's sizes (the offline store is the phone's): only the formatter is needed.
jest.mock('@/lib/video', () => ({ megabytes: (bytes: number) => `${Math.round(bytes / 1e6)} MB` }));

/* eslint-disable import/first */
import TodayScreen from '@/app/(tabs)/index';
import MeScreen from '@/app/(tabs)/me';
import OfficeHomeDesign from '@/design/OfficeHome';
import { hideSnackbar } from '@/components/patterns/Snackbar';
import { setOfficeMe } from '@/office/store';
import type { Me } from '@/office/types';

const page = (name: string) => () => <Text>{`page ${name}`}</Text>;
const routes = {
  _layout: () => <Stack screenOptions={{ headerShown: false }} />,
  index: TodayScreen,
  me: MeScreen,
  'design/office-home': OfficeHomeDesign,
  'office/index': page('office'),
  'office/(tabs)/approve': page('approve'),
  'office/(tabs)/tasks': page('tasks'),
  'office/(tabs)/live': page('live'),
  'office/(tabs)/trips': page('trips'),
  'office/issues/index': page('issues'),
  'office/profile': page('profile'),
  'office/my-trip/[id]': page('my trip'),
  'task/[id]': page('task'),
  'log-mileage': page('log-mileage'),
  vehicle: page('vehicle'),
  'vehicle-check': page('vehicle-check'),
  'start-trip': page('start-trip'),
  'today-tasks': page('today-tasks'),
  availability: page('availability'),
  'phone-setup': page('phone-setup'),
};

let errors: ReturnType<typeof failOnConsoleError>;
beforeAll(() => {
  // 08:30 in Colombo: the sample's trip is today.
  jest.useFakeTimers({ advanceTimers: true, now: new Date('2026-10-29T03:00:00Z') });
});
afterAll(() => {
  jest.useRealTimers();
});
beforeEach(() => {
  mockValue = null;
  mockOfficeApp = null;
  mockKind = 'office';
  mockToday = 'accepted';
  mockLeave.mockClear();
  mockEnter.mockClear();
  mockLoadTrips.mockReset();
  act(() => hideSnackbar());
  errors = failOnConsoleError();
});
afterEach(() => {
  errors.restore();
  act(() => setOfficeMe(null));
});

describe('Today in Driving mode', () => {
  it('shows their trip with the Driving mode card, and none of the driver\'s day', async () => {
    renderRouter(routes, { initialUrl: '/' });
    await screen.findByTestId('driving-card');
    expect(screen.getByText('Driving mode')).toBeTruthy();
    expect(screen.getByText('Your own trips · location is shared only during a trip')).toBeTruthy();
    expect(screen.getByText('Team drop · Kurunegala site')).toBeTruthy();
    // Only their own trip: the sample's two later tasks are not theirs to drive.
    expect(screen.queryByText('Kurunegala → Kandy depot')).toBeNull();
    // The driver's day is not theirs.
    expect(screen.queryByTestId('duty-tile')).toBeNull();
    expect(screen.queryByTestId('duty-switch')).toBeNull();
    expect(screen.queryByText('Start work')).toBeNull();
    expect(screen.queryByTestId('vehicle-tile-change')).toBeNull();
    expect(screen.queryByTestId('today-start-trip')).toBeNull();
    expect(screen.queryByText('Running late')).toBeNull();
    expect(screen.queryByText("Can't make it")).toBeNull();
    expect(screen.queryByTestId('today-decline')).toBeNull();
    // Start task is there as for a driver.
    expect(screen.getByTestId('today-start')).toBeTruthy();
    expect(errors.seen.map((a) => String(a[0]))).toEqual([]);
  });

  it('Back to office: the driver state is left (leaveDriving) and Office mode opens', async () => {
    const r = renderRouter(routes, { initialUrl: '/' });
    fireEvent.press(await screen.findByTestId('driving-back'));
    await screen.findByText('page office');
    expect(mockLeave).toHaveBeenCalledTimes(1);
    expect(r.getPathname()).toBe('/office');
  });

  it('a driver\'s Today is as before: the duty tiles with Start work, Start a trip on duty, no Driving mode card', async () => {
    mockKind = 'driver';
    mockToday = 'off';
    renderRouter(routes, { initialUrl: '/' });
    await screen.findByTestId('duty-tile');
    expect(screen.getAllByText('Start work').length).toBeGreaterThan(0);
    expect(screen.getByTestId('duty-start-work')).toBeTruthy();
    expect(screen.queryByTestId('driving-card')).toBeNull();
  });

  it('a driver on duty keeps Start a trip, Running late and Can\'t make it', async () => {
    mockKind = 'driver';
    renderRouter(routes, { initialUrl: '/' });
    await screen.findByTestId('today-start-trip');
    expect(screen.getByText('Running late')).toBeTruthy();
    expect(screen.getByText("Can't make it")).toBeTruthy();
    expect(screen.getByTestId('duty-switch')).toBeTruthy();
  });
});

describe('Me in Driving mode', () => {
  it('Back to office in place of Sign out; no Availability, Edit or Change vehicle; Phone setup stays', async () => {
    const r = renderRouter(routes, { initialUrl: '/me' });
    await screen.findByTestId('me-back-to-office');
    expect(screen.getByText('Back to office')).toBeTruthy();
    expect(screen.queryByText('Sign out')).toBeNull();
    expect(screen.queryByTestId('me-availability')).toBeNull();
    expect(screen.queryByText('Edit')).toBeNull();
    expect(screen.queryByText('Change vehicle')).toBeNull();
    expect(screen.getByTestId('me-phone-setup')).toBeTruthy();
    fireEvent.press(screen.getByTestId('me-back-to-office'));
    await screen.findByText('page office');
    expect(mockLeave).toHaveBeenCalledTimes(1);
    expect(r.getPathname()).toBe('/office');
  });

  it('a driver\'s Me is as before: Sign out, Availability, Edit, Change vehicle on duty', async () => {
    mockKind = 'driver';
    renderRouter(routes, { initialUrl: '/me' });
    await screen.findByText('Sign out');
    expect(screen.getByTestId('me-availability')).toBeTruthy();
    expect(screen.getByText('Edit')).toBeTruthy();
    expect(screen.getByText('Change vehicle')).toBeTruthy();
    expect(screen.queryByTestId('me-back-to-office')).toBeNull();
  });
});

describe('Office mode\'s Home: Start driving', () => {
  const officeMe = (over: Record<string, unknown>) => ({ name: 'Sahan Ranasinghe', email: 's@fame.lk', role: 'fleet_admin', permissions: ['view', 'approve', 'assign_tasks'], tools: [], ...over }) as unknown as Me;
  const trip = { id: 't-self-1', title: 'Site visit · Kandy', status: 'assigned', start_at: '2026-10-29T05:00:00Z', leave_by: '2026-10-29T05:00:00Z', employee_id: 'e-1', driven_by: 'self' };
  function useOfficeApp() {
    mockOfficeApp = { ...require('./fakeOffice').mockUseApp(), loadDriveTrips: mockLoadTrips, enterDriving: mockEnter };
  }

  it('a person who can drive: "You have a trip to drive · Start driving" opens Driving mode', async () => {
    useOfficeApp();
    mockLoadTrips.mockResolvedValue({ me: { id: 'e-1', role: 'fleet_admin' }, tasks: [trip] });
    act(() => setOfficeMe(officeMe({ can_drive: true })));
    const r = renderRouter({ ...routes, index: page('today') }, { initialUrl: '/design/office-home' });
    await screen.findByTestId('home-drive-line', {}, { timeout: 5000 });
    expect(screen.getByText('You have a trip to drive')).toBeTruthy();
    expect(screen.getByText('10:30 · Site visit · Kandy')).toBeTruthy();
    fireEvent.press(screen.getByTestId('home-start-driving'));
    await screen.findByText('page today');
    expect(mockEnter).toHaveBeenCalledTimes(1);
    expect(r.getPathname()).toBe('/');
  });

  // Round 51b (30 October 2026; Uber's upcoming-trip card): the whole card opens the trip; Start driving keeps its own action.
  it('the trip card itself opens the trip\'s page', async () => {
    useOfficeApp();
    mockLoadTrips.mockResolvedValue({ me: { id: 'e-1', role: 'fleet_admin' }, tasks: [trip] });
    act(() => setOfficeMe(officeMe({ can_drive: true })));
    const r = renderRouter(routes, { initialUrl: '/design/office-home' });
    fireEvent.press(await screen.findByTestId('home-drive-card', {}, { timeout: 5000 }));
    expect(await screen.findByText('page my trip')).toBeTruthy();
    expect(r.getPathname()).toBe('/office/my-trip/t-self-1');
    expect(mockEnter).not.toHaveBeenCalled();
  });

  it('a trip under way: "Your trip is under way · Continue driving"', async () => {
    useOfficeApp();
    mockLoadTrips.mockResolvedValue({ me: { id: 'e-1', role: 'fleet_admin' }, tasks: [{ ...trip, status: 'in_progress', start_at: '2026-10-28T05:00:00Z' }] });
    act(() => setOfficeMe(officeMe({ can_drive: true, self_drive_mode: true })));
    renderRouter(routes, { initialUrl: '/design/office-home' });
    await screen.findByTestId('home-drive-line', {}, { timeout: 5000 });
    expect(screen.getByText('Your trip is under way')).toBeTruthy();
    expect(screen.getByText('Continue driving')).toBeTruthy();
  });

  it('no line for a person who cannot drive, nor with the setting self_drive_mode off (nothing is read)', async () => {
    for (const over of [{}, { can_drive: false }, { can_drive: true, self_drive_mode: false }]) {
      useOfficeApp();
      mockLoadTrips.mockResolvedValue({ me: { id: 'e-1', role: 'fleet_admin' }, tasks: [trip] });
      act(() => setOfficeMe(officeMe(over)));
      const r = renderRouter(routes, { initialUrl: '/design/office-home' });
      await screen.findByTestId('stat-road', {}, { timeout: 5000 });
      await waitFor(() => expect(screen.queryByTestId('home-drive-line')).toBeNull());
      expect(mockLoadTrips).not.toHaveBeenCalled();
      r.unmount();
    }
  });
});
