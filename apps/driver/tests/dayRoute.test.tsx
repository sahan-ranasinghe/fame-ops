// §33.6 item 1 (Round 4–7, Sahan's decision; Samsara's driver day, Google Maps Timeline), rendered: Office mode's driver
// day (app/office/driver/[username]/route.tsx with components/office/DayRoute.tsx). ONE summary card above the map (GPS
// km, driving, stopped, stops, the first and last point, "No GPS for …"), the map, the day strip, the playback bar and the
// day's tasks keep their places; the day's timeline list is gone; a stop pin's tap says "Stopped near Peliyagoda ·
// 09:55–15:38 · 5 h 43 min" and moves the map to it (Whole route brings the day back).
// The words: en.json with the strings sidecar (src/i18n/parts/driver-3.json) merged in while it exists; a missing key fails the test.
import { act, fireEvent, screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { Stack } from 'expo-router';

import { answers, calls, failOnConsoleError, FIX, resetFake } from './fakeOffice';

/** The English words: en.json with the sidecars merged in while they exist (after the lead's merge, en.json alone). */
function mockWords(): (key: string, vars?: Record<string, string | number>) => string {
  const merge = (into: Record<string, unknown>, from: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(from)) {
      const had = into[k];
      if (v && typeof v === 'object' && had && typeof had === 'object') merge(had as Record<string, unknown>, v as Record<string, unknown>);
      else into[k] = v;
    }
  };
  const en = JSON.parse(JSON.stringify(require('../src/i18n/en.json')));
  try {
    merge(en, require('../src/i18n/parts/driver-3.json').en ?? {});
  } catch {
    // Merged already: en.json has the words.
  }
  return (key, vars) => {
    const found = key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), en);
    if (typeof found !== 'string') throw new Error(`No text for "${key}"`);
    return Object.entries(vars ?? {}).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), found);
  };
}
let mockT: ReturnType<typeof mockWords> | null = null;
const mockFocus: { frames: unknown[] } = { frames: [] };

jest.mock('@/office/client', () => ({ officeApi: require('./fakeOffice').mockOfficeApi }));
jest.mock('@/state/app', () => ({
  useApp: () => {
    mockT ??= mockWords();
    return { ...require('./fakeOffice').mockUseApp(), t: mockT };
  },
}));
jest.mock('@/office/store', () => ({ useOfficeMe: () => require('./fakeOffice').FIX('me'), getOfficeMe: () => require('./fakeOffice').FIX('me'), setOfficeMe: () => undefined }));
// The map needs a phone: the stand-in shows each stop pin as a button that taps it, and keeps the frames it is moved to.
jest.mock('@/components/RouteMap', () => {
  const { createElement } = require('react');
  const { Pressable, Text, View } = require('react-native');
  return {
    RouteMap: ({ stops, focus, onStop }: { stops: { key: string; label?: string }[]; focus: unknown; onStop?: (key: string) => void }) => {
      if (focus) mockFocus.frames.push(focus);
      return createElement(View, { testID: 'route-map-stub' }, stops.map((s) => createElement(Pressable, {
        key: s.key, accessibilityRole: 'button', accessibilityLabel: s.label, onPress: () => onStop?.(s.key), testID: `pin-${s.key}`,
      }, createElement(Text, null, s.key))));
    },
  };
});

/* eslint-disable import/first */
import DriverDayRoute from '@/app/office/driver/[username]/route';
import { hideSnackbar } from '@/components/patterns/Snackbar';
import { colomboDate } from '@/lib/time';
import { OfficeProvider } from '@/office/state';
import type { DriverRoute, Me as OfficeMe } from '@/office/types';

const ME: OfficeMe = FIX('me');
const day = colomboDate();
const iso = (hhmm: string) => `${day}T${hhmm}:00+05:30`;
const ROUTE: DriverRoute = {
  driver: 'Nuwan Perera', date: day, recorded_points: 830, first_point: '08:01', last_point: '16:31', km: 41.2, driving_minutes: 95, stopped_minutes: 343, stops_count: 1,
  stops_over_10_min: [{ from: '09:55', to: '15:38', minutes: 343, near: 'Peliyagoda', lat: 6.96, lng: 79.89 }],
  gaps: [{ from: '14:00', to: '14:56', minutes: 56 }],
  timeline: [
    { kind: 'driving', from: '08:01', to: '09:55', from_at: iso('08:01'), to_at: iso('09:55'), minutes: 114, km: 31.1, text: '08:01–09:55 Driving · 31.1 km' },
    { kind: 'stopped', from: '09:55', to: '14:00', from_at: iso('09:55'), to_at: iso('14:00'), minutes: 245, near: 'Peliyagoda', lat: 6.96, lng: 79.89, text: '09:55–14:00 Stopped near Peliyagoda' },
    { kind: 'no_gps', from: '14:00', to: '14:56', from_at: iso('14:00'), to_at: iso('14:56'), minutes: 56, text: '14:00–14:56 Stopped · no GPS signal' },
  ],
  route: { columns: ['time', 'lat', 'lng', 'km/h', 'at'], points: [['08:01', 6.88, 79.86, 0, iso('08:01')], ['09:55', 6.96, 79.89, 38, iso('09:55')], ['14:00', 6.96, 79.89, 0, iso('14:00')]] },
} as DriverRoute;

const routes = {
  _layout: () => <OfficeProvider me={ME}><Stack screenOptions={{ headerShown: false }} /></OfficeProvider>,
  'office/driver/[username]/route': DriverDayRoute,
};

let errors: ReturnType<typeof failOnConsoleError>;
beforeEach(() => {
  resetFake();
  mockFocus.frames = [];
  act(() => hideSnackbar());
  answers.driver_profile = () => ({ driver: { name: 'Nuwan Perera', username: 'nuwan.p' } });
  answers.driver_route = () => ROUTE;
  answers.list_tasks = () => ({ from: day, to: day, count: 1, totals: { completed: 1, cancelled: 0, km: 31, driver_started: 0, personal: 0 }, tasks: [{ id: 't1', date: day, time: '08:00', title: 'Team drop', kind: 'dispatch', purpose: 'company', status: 'completed', vehicle: 'WP CAB-4521', km: 31 }] });
  errors = failOnConsoleError();
});
afterEach(() => errors.restore());

describe("Office mode: a driver's day (§33.6 item 1)", () => {
  it('the summary card, the map (fixed above it since Round 48), the day strip, the playback and the day\'s tasks; no timeline list', async () => {
    renderRouter(routes, { initialUrl: '/office/driver/nuwan.p/route' });
    const summary = await screen.findByTestId('day-summary', {}, { timeout: 5000 });
    expect(summary).toBeTruthy();
    // The numbers, the first and last point, the gaps in one line.
    expect(screen.getByText('41.2')).toBeTruthy();
    expect(screen.getByText('1 h 35 min')).toBeTruthy();
    expect(screen.getByText('5 h 43 min')).toBeTruthy();
    expect(screen.getByText(mockT!('office.drivers.route.stops'))).toBeTruthy();
    expect(screen.getByTestId('day-span').props.children).toBe('08:01–16:31');
    expect(screen.getByText('No GPS for 56 min')).toBeTruthy();
    // The map, the day strip, the playback bar, the day's tasks.
    expect(screen.getByTestId('driver-route-map')).toBeTruthy();
    expect(screen.getByTestId('route-map-stub')).toBeTruthy();
    expect(screen.getByTestId('history-day')).toBeTruthy();
    expect(screen.getByTestId('live-play')).toBeTruthy();
    expect(screen.getByTestId('live-slider')).toBeTruthy();
    expect(await screen.findByTestId('history-task')).toBeTruthy();
    // Gone (Sahan's decision): the timeline rows.
    expect(screen.queryAllByTestId('route-row')).toHaveLength(0);
    expect(screen.queryByText('08:01–09:55 Driving · 31.1 km')).toBeNull();
    expect(calls.some((c) => c.tool === 'driver_route' && c.args.date === day && c.args.estimate_gaps === true)).toBe(true);
    expect(errors.seen).toEqual([]);
  });

  it('a stop pin tapped: its words on the map and the map moved to it; Close and Whole route', async () => {
    renderRouter(routes, { initialUrl: '/office/driver/nuwan.p/route' });
    const pin = await screen.findByLabelText('Stopped near Peliyagoda · 09:55–15:38 · 5 h 43 min', {}, { timeout: 5000 });
    expect(screen.queryByTestId('stop-card')).toBeNull();
    fireEvent.press(pin);
    expect(screen.getByTestId('stop-card')).toBeTruthy();
    expect(screen.getByText('Stopped near Peliyagoda · 09:55–15:38 · 5 h 43 min')).toBeTruthy();
    expect(mockFocus.frames.at(-1)).toMatchObject({ frame: { kind: 'point', center: { lat: 6.96, lng: 79.89 } }, nonce: 1 });
    fireEvent.press(pin);
    expect(mockFocus.frames.at(-1)).toMatchObject({ nonce: 2 }); // again on a second tap
    fireEvent.press(screen.getByLabelText(mockT!('common.close')));
    expect(screen.queryByTestId('stop-card')).toBeNull();
    fireEvent.press(pin);
    fireEvent.press(screen.getByText(mockT!('office.history.wholeRoute')));
    expect(screen.queryByTestId('stop-card')).toBeNull();
    expect(screen.queryByText(mockT!('office.history.wholeRoute'))).toBeNull();
    expect(errors.seen).toEqual([]);
  });

  // Round 48 (items 2 and 3): the legend and the map data behind ⓘ in the one sheet; the gaps line opens the gaps sheet, a
  // row highlights its spot on the map (its card, the map moved there) with the Gaps layer still off.
  it('ⓘ opens the legend and the map data; the gaps line opens the gaps sheet and a row highlights the gap', async () => {
    renderRouter(routes, { initialUrl: '/office/driver/nuwan.p/route' });
    await screen.findByTestId('day-summary', {}, { timeout: 5000 });
    expect(screen.queryByTestId('route-about-sheet')).toBeNull();
    fireEvent.press(screen.getByTestId('route-about'));
    expect(screen.getByTestId('route-about-sheet')).toBeTruthy();
    expect(screen.getByTestId('legend-start')).toBeTruthy();
    expect(screen.getByText(mockT!('dayRoute.legendCluster'))).toBeTruthy();
    // The free map in the tests (no Android key): the map data names OpenStreetMap and OpenFreeMap, in English.
    expect(screen.getByText('© OpenStreetMap contributors · OpenFreeMap')).toBeTruthy();
    fireEvent.press(screen.getAllByLabelText(mockT!('patterns.close'))[0]);
    // The gaps: the summary's line, the sheet, the row, the card on the map.
    fireEvent.press(screen.getByTestId('day-gaps-button'));
    const row = await screen.findByTestId('route-gap-row');
    expect(screen.getByText('No GPS signal · 14:00–14:56 · 56 min')).toBeTruthy();
    fireEvent.press(row);
    expect(screen.getByTestId('gap-card')).toBeTruthy();
    expect(mockFocus.frames.at(-1)).toMatchObject({ frame: { kind: 'point', center: { lat: 6.96, lng: 79.89 } } });
    // The Layers filter: one Filter button, nothing on by default.
    expect(screen.getByTestId('route-filter')).toBeTruthy();
    expect(screen.queryByTestId('filter-chip')).toBeNull();
    expect(errors.seen).toEqual([]);
  });

  it('no gaps: no "No GPS" line', async () => {
    answers.driver_route = () => ({ ...ROUTE, gaps: [] });
    renderRouter(routes, { initialUrl: '/office/driver/nuwan.p/route' });
    await screen.findByTestId('day-summary', {}, { timeout: 5000 });
    expect(screen.queryByTestId('day-gaps')).toBeNull();
  });
});
