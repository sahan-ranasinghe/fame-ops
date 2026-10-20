// Hotfix O2-H2: what every component test shares. The maps and the phone-only modules are stubbed; the office client is
// replaced by tests/fakeOffice.ts in each test that needs it.
/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('@/components/TaskMap', () => ({ TaskMap: () => null, GOOGLE_MAP_BUILD: false }));
jest.mock('@/components/RouteMap', () => ({ RouteMap: () => null }));
jest.mock('@/components/DriversMap', () => ({ DriversMap: () => null }));
jest.mock('@maplibre/maplibre-react-native', () => ({}));
jest.mock('react-native-maps', () => ({}));
jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: async () => ({ granted: false }),
  getLastKnownPositionAsync: async () => null,
  requestForegroundPermissionsAsync: async () => ({ granted: false }),
}));
jest.mock('expo-updates', () => ({ reloadAsync: jest.fn(async () => undefined), updateId: 'test-update', runtimeVersion: '1.3.0-gmaps', channel: 'preview' }));
// The phone's small key store (SQLite) as a map.
jest.mock('@/lib/kv', () => {
  const actual = jest.requireActual('@/lib/kv');
  const mem = new Map<string, string>();
  return {
    ...actual,
    getJson: (k: string) => (mem.has(k) ? JSON.parse(mem.get(k) as string) : null),
    setJson: (k: string, v: unknown) => { mem.set(k, JSON.stringify(v)); },
    remove: (k: string) => { mem.delete(k); },
    getString: (k: string) => mem.get(k) ?? null,
    setString: (k: string, v: string) => { mem.set(k, v); },
  };
});
