// §33.6 item 1 (Round 4–7, Sahan's decision; Samsara's driver day, Google Maps Timeline), rendered: Office mode's driver
// day (app/office/driver/[username]/route.tsx with components/office/DayRoute.tsx). ONE summary card above the map (GPS
// km, driving, stopped, stops, the first and last point, "No GPS for …"), the map, the day strip, the playback bar and the
// day's tasks keep their places; the day's timeline list is gone; a stop pin's tap says "Stopped near Peliyagoda ·
// 09:55–15:38 · 5 h 43 min" and moves the map to it (Whole route brings the day back).
// The words: en.json with the strings sidecar (src/i18n/parts/driver-3.json) merged in while it exists; a missing key fails the test.
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
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
/** The map engine the stand-in RouteMap reports (Round 48: snap to roads is asked on Google's map only, or under the open package). */
const mockEngine: { value: 'google' | 'open' } = { value: 'google' };
/** The signed-in person (the fixture's package is open; a test sets google to stand for a phone whose Google map failed). */
const mockMe: { value: Record<string, unknown> } = { value: require('../src/office/__fixtures__/me.json') };

jest.mock('@/office/client', () => ({ officeApi: require('./fakeOffice').mockOfficeApi }));
jest.mock('@/state/app', () => ({
  useApp: () => {
    mockT ??= mockWords();
    return { ...require('./fakeOffice').mockUseApp(), t: mockT };
  },
}));
jest.mock('@/office/store', () => ({ useOfficeMe: () => mockMe.value, getOfficeMe: () => mockMe.value, setOfficeMe: () => undefined }));
// The map needs a phone: the stand-in shows each stop pin as a button that taps it, and keeps the frames it is moved to.
jest.mock('@/components/RouteMap', () => {
  const { createElement } = require('react');
  const { Pressable, Text, View } = require('react-native');
  return {
    useRouteMapEngine: () => mockEngine.value,
    RouteMap: ({ stops, focus, onStop, controls, lines }: { stops: { key: string; label?: string }[]; focus: unknown; onStop?: (key: string) => void; controls?: unknown; lines: { points: unknown[] }[] }) => {
      if (focus) mockFocus.frames.push(focus);
      // The distinct points drawn (legs share their joints): the snapped line's count or the recorded points'.
      const drawn = new Set(lines.flatMap((l) => (l.points as { lat: number; lng: number }[]).map((p) => `${p.lat},${p.lng}`))).size;
      return createElement(View, { testID: 'route-map-stub', accessibilityValue: { text: String(drawn) } }, [
        ...stops.map((s) => createElement(Pressable, {
          key: s.key, accessibilityRole: 'button', accessibilityLabel: s.label, onPress: () => onStop?.(s.key), testID: `pin-${s.key}`,
        }, createElement(Text, null, s.key))),
        createElement(View, { key: 'controls', testID: 'route-map-controls-stub' }, controls ?? null),
      ]);
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
  _layout: () => <OfficeProvider me={mockMe.value as unknown as OfficeMe}><Stack screenOptions={{ headerShown: false }} /></OfficeProvider>,
  'office/driver/[username]/route': DriverDayRoute,
};

let errors: ReturnType<typeof failOnConsoleError>;
beforeEach(() => {
  resetFake();
  mockFocus.frames = [];
  mockEngine.value = 'google';
  mockMe.value = ME as unknown as Record<string, unknown>;
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
    // The pins need no legend row (Sahan, Checkpoint 48).
    expect(screen.queryByTestId('legend-start')).toBeNull();
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

  // Round 48 item 5: snap to roads on Google's map, the chip, the fallback (office/snapLogic.ts).
  it("Google's map: driver_route is asked with snap, the snapped line is drawn and said so; the chip brings the GPS line back", async () => {
    const SNAPPED: DriverRoute = {
      ...ROUTE,
      route_snapped: { columns: ['time', 'lat', 'lng', 'km/h', 'at', 'acc', 'snapped'], points: [['08:01', 6.88, 79.86, 0, iso('08:01'), null, 0], ['08:30', 6.9, 79.87, 30, iso('08:30'), null, 1], ['09:55', 6.96, 79.89, 38, iso('09:55'), null, 1], ['14:00', 6.96, 79.89, 0, iso('14:00'), null, 0]] },
      snapped: { provider: 'google_roads', status: 'ok', legs: 1, matched: 1 },
    };
    answers.driver_route = (args: Record<string, unknown>) => (args.snap === true ? SNAPPED : { ...ROUTE, snapped: { provider: 'google_roads', status: 'off' } });
    renderRouter(routes, { initialUrl: '/office/driver/nuwan.p/route' });
    await screen.findByTestId('day-summary', {}, { timeout: 5000 });
    expect(calls.filter((c) => c.tool === 'driver_route').every((c) => c.args.snap === true)).toBe(true);
    // The snapped line is drawn (its road vertex at 08:30 makes 3 distinct places; the recorded points are 2), the note
    // says so, the km stay the server's.
    expect(screen.getByTestId('route-map-stub').props.accessibilityValue.text).toBe('3');
    expect(screen.getByTestId('snap-note').props.children).toBe(mockT!('office.live.snap_snapped'));
    expect(screen.getByText('41.2')).toBeTruthy();
    const chip = screen.getByTestId('snap-chip');
    expect(chip.props.accessibilityState.checked).toBe(true);
    expect(screen.getByText(mockT!('office.live.snapOn'))).toBeTruthy();
    // Off: asked again without snap; the GPS line (2 distinct places) and its words.
    fireEvent.press(chip);
    await waitFor(() => expect(screen.getByTestId('snap-chip').props.accessibilityState.checked).toBe(false), { timeout: 5000 });
    await waitFor(() => expect(calls.filter((c) => c.tool === 'driver_route').at(-1)!.args.snap).toBeUndefined(), { timeout: 5000 });
    expect(screen.getByTestId('route-map-stub').props.accessibilityValue.text).toBe('2');
    expect(screen.getByTestId('snap-note').props.children).toBe(mockT!('office.live.snap_gps'));
    expect(errors.seen).toEqual([]);
  });

  it("the free map under the google package (Google's failed on this phone): never asked with snap, no chip, the GPS line said", async () => {
    mockEngine.value = 'open';
    mockMe.value = { ...(ME as unknown as Record<string, unknown>), map: { package: 'google', places: true } };
    answers.driver_route = () => ({ ...ROUTE, snapped: { provider: 'google_roads', status: 'off' } });
    renderRouter(routes, { initialUrl: '/office/driver/nuwan.p/route' });
    await screen.findByTestId('day-summary', {}, { timeout: 5000 });
    expect(calls.filter((c) => c.tool === 'driver_route').every((c) => !('snap' in c.args))).toBe(true);
    expect(screen.queryByTestId('snap-chip')).toBeNull();
    expect(screen.getByTestId('snap-note').props.children).toBe(mockT!('office.live.snap_gps'));
    expect(errors.seen).toEqual([]);
  });

  it('no provider on the server: nothing new on the screen', async () => {
    answers.driver_route = () => ({ ...ROUTE, snapped: { provider: 'none', status: 'off' } });
    renderRouter(routes, { initialUrl: '/office/driver/nuwan.p/route' });
    await screen.findByTestId('day-summary', {}, { timeout: 5000 });
    expect(screen.queryByTestId('snap-chip')).toBeNull();
    expect(screen.queryByTestId('snap-note')).toBeNull();
  });

  it('no gaps: no "No GPS" line', async () => {
    answers.driver_route = () => ({ ...ROUTE, gaps: [] });
    renderRouter(routes, { initialUrl: '/office/driver/nuwan.p/route' });
    await screen.findByTestId('day-summary', {}, { timeout: 5000 });
    expect(screen.queryByTestId('day-gaps')).toBeNull();
  });
});
