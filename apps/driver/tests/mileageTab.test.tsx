// Round 51b (Sahan, 30 October 2026: one job per tab): the Mileage tab rendered. Log odometer is its one action (Log fuel
// is on the Fuel tab); Recent shows only odometer readings and finished trips with their km (a gauge or a route, each row
// with its own plate), never a fill; the This month card's plate is the vehicle its figures are for: a month kept on the
// phone for another vehicle (TEST-0001's readings under a TEST-0002 plate) is never shown.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

/** The English words from en.json; a missing key fails the test. */
function mockWords(): (key: string, vars?: Record<string, string | number>) => string {
  const en = require('../src/i18n/en.json');
  return (key, vars) => {
    const found = key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), en);
    if (typeof found !== 'string') throw new Error(`No text for "${key}"`);
    return Object.entries(vars ?? {}).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), found);
  };
}
const mockT = mockWords();
const mockPush = jest.fn();
const mockFetch = jest.fn();
const mockV1 = { id: 'v1', reg_no: 'TEST-0001', current_odometer_km: 195400, monthly_km_allowance: 3000 };
const mockV2 = { id: 'v2', reg_no: 'TEST-0002', current_odometer_km: 50100, monthly_km_allowance: 3000 };
const mockDone = { id: 't-today', title: 'Team drop', status: 'completed', start_at: new Date().toISOString(), completed_at: new Date().toISOString(), vehicle_id: 'v2', start_odometer_km: 50000, end_odometer_km: 50030, km: 30, stops: [] };

jest.mock('@/state/app', () => ({
  useApp: () => ({
    t: mockT, tList: () => [], language: 'en', workVehicle: mockV2, vehicles: [mockV1, mockV2], tasks: [mockDone], queue: { ops: 0 },
    refreshing: false, refresh: () => undefined, me: { id: 'e-1' }, wifiOnly: false,
  }),
}));
jest.mock('expo-router', () => {
  const React = require('react');
  return { useRouter: () => ({ push: mockPush }), useFocusEffect: (cb: () => void | (() => void)) => React.useEffect(() => cb(), [cb]) };
});
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }), SafeAreaProvider: ({ children }: { children: unknown }) => children }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/api', () => ({ ...jest.requireActual('@/lib/api'), fetchMileage: (...a: unknown[]) => mockFetch(...a) }));
jest.mock('@/sync', () => ({ pendingOdometerLogs: () => [], videoUploads: () => [] }));
jest.mock('@/office/store', () => ({ getOfficeMe: () => null, useOfficeMe: () => null, setOfficeMe: () => undefined }));

/* eslint-disable import/first */
import MileageScreen from '@/app/(tabs)/mileage';
import { remove, setJson } from '@/lib/kv';

const day = (d: number) => new Date(Date.now() - d * 86400000).toISOString();
const plates = () => screen.queryAllByTestId(/^log-row-/).map((r) => [r.props.testID as string, String(r.props.accessibilityLabel)]);

beforeEach(() => {
  mockPush.mockReset();
  mockFetch.mockReset();
  remove('cache.mileage');
});

describe('Mileage: one job per tab', () => {
  it('Log odometer is the one action; Log fuel is not here', () => {
    mockFetch.mockReturnValue(new Promise(() => undefined));
    render(<MileageScreen />);
    expect(screen.getByTestId('mileage-log-odometer')).toBeTruthy();
    expect(screen.queryByText(mockT('fuel.logFuel'))).toBeNull();
    fireEvent.press(screen.getByTestId('mileage-log-odometer'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/log-mileage', params: { mode: 'manual' } });
  });

  it('a month kept for another vehicle never shows under this plate: TEST-0002 above no TEST-0001 readings', () => {
    // The copy on the phone is TEST-0001's (the driver changed vehicle; no connection yet).
    setJson('cache.mileage', { vehicleId: 'v1', baselineKm: 195000, odometer: [{ id: 'old-1', vehicle_id: 'v1', reading_km: 195400, logged_at: day(1) }], fuel: [] });
    mockFetch.mockReturnValue(new Promise(() => undefined));
    render(<MileageScreen />);
    expect(screen.getByText('TEST-0002')).toBeTruthy();
    expect(plates().some(([, label]) => label.includes('TEST-0001'))).toBe(false);
    expect(screen.queryByText('400')).toBeNull(); // 195,400 − 195,000 would be TEST-0001's month
  });

  it('Recent: readings and finished trips only, each with its own plate, never a fill; See all opens the history', async () => {
    mockFetch.mockResolvedValue({
      vehicleId: 'v2', baselineKm: 50000,
      odometer: [{ id: 'o-v2', vehicle_id: 'v2', reading_km: 50100, logged_at: day(0) }],
      fuel: [{ id: 'f-1', vehicle_id: 'v2', litres: 20, amount_cents: 800000, logged_at: day(0) }],
      recentOdometer: [{ id: 'o-v1', vehicle_id: 'v1', reading_km: 195400, logged_at: day(2) }],
      recentTrips: [{ id: 't-old', completed_at: day(3), vehicle_id: 'v1', km: 42 }],
    });
    render(<MileageScreen />);
    await waitFor(() => expect(plates().length).toBe(4));
    expect(mockFetch).toHaveBeenCalledWith({}, 'v2', expect.any(Date), 'e-1');
    const rows = plates();
    expect(rows.map(([id]) => id).sort()).toEqual(['log-row-odometer', 'log-row-odometer', 'log-row-trip', 'log-row-trip']);
    expect(rows.find(([, l]) => l.includes('42 km'))?.[1]).toContain('TEST-0001');
    expect(rows.find(([, l]) => l.includes('30 km'))?.[1]).toContain('TEST-0002');
    expect(rows.find(([, l]) => l.includes('195,400'))?.[1]).toContain('TEST-0001');
    expect(rows.find(([, l]) => l.includes('50,100'))?.[1]).toContain('TEST-0002');
    expect(screen.queryByTestId('log-row-fuel')).toBeNull();
    // This month: TEST-0002's 100 km (50,100 − 50,000) under the TEST-0002 plate.
    expect(screen.getByText('100')).toBeTruthy();
    // A finished trip's row opens its trip; See all opens the readings and trips.
    await act(async () => fireEvent.press(screen.getAllByTestId('log-row-trip')[0]));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/task/[id]', params: { id: 't-today' } });
    fireEvent.press(screen.getByText(mockT('logHistory.seeAll')));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/history', params: { kind: 'all' } });
  });
});
