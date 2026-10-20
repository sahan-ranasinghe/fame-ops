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
// The phone's small key store (expo-sqlite's kv-store) as a map.
jest.mock('expo-sqlite/kv-store', () => {
  const mem = new Map<string, string>();
  const Storage = {
    getItemSync: (k: string) => (mem.has(k) ? (mem.get(k) as string) : null),
    setItemSync: (k: string, v: string) => { mem.set(k, v); },
    removeItemSync: (k: string) => { mem.delete(k); },
    getItem: async (k: string) => (mem.has(k) ? (mem.get(k) as string) : null),
    setItem: async (k: string, v: string) => { mem.set(k, v); },
    removeItem: async (k: string) => { mem.delete(k); },
    clearSync: () => mem.clear(),
  };
  return { __esModule: true, default: Storage, Storage };
});
