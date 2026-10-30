// Round 53 (c): the mobile website's own app state (state/app.web.tsx) gives Home's "You have a trip to drive" and More →
// Driving their reader. CI 41050400834: the provider had none, the tests mocked useApp, and the website's Home crashed
// ("h.current is not a function") for a person who can drive. Here the real web provider is used.
import { renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';

const mockFetchMe = jest.fn();
const mockFetchTasks = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: { tag: 'web-client' } }));
jest.mock('@/lib/api', () => ({
  ...jest.requireActual('@/lib/api'),
  fetchMe: (...args: unknown[]) => mockFetchMe(...args),
  fetchTasks: (...args: unknown[]) => mockFetchTasks(...args),
}));

/* eslint-disable import/first */
import { AppProvider, loadWebDriveTrips, useApp } from '@/state/app.web';

const me = { id: 'e-1', role: 'fleet_admin' };
const started = { id: 't-web', employee_id: 'e-1', driven_by: 'self', driven_in: 'web', status: 'in_progress', start_at: '2026-10-30T03:00:00Z' };
const toStart = { id: 't-new', employee_id: 'e-1', driven_by: 'self', driven_in: null, status: 'assigned', start_at: '2026-10-30T05:00:00Z' };

// The test renderer has no browser: the provider's online / offline listeners and the page's lang get stand-ins.
const win = globalThis as unknown as { addEventListener?: unknown; removeEventListener?: unknown; document?: unknown };
win.addEventListener = jest.fn();
win.removeEventListener = jest.fn();
win.document = { documentElement: { lang: '' } };

beforeEach(() => {
  mockFetchMe.mockReset();
  mockFetchTasks.mockReset();
});

it('the web provider has the reader Home and More call (never undefined)', () => {
  const { result } = renderHook(() => useApp(), { wrapper: ({ children }: { children: ReactNode }) => <AppProvider>{children}</AppProvider> });
  expect(typeof result.current.loadDriveTrips).toBe('function');
});

it('it reads the web\'s own trips with the person\'s session, and keeps one started on the web (Continue driving)', async () => {
  mockFetchMe.mockResolvedValue(me);
  mockFetchTasks.mockResolvedValue([started, toStart]);
  const answer = await loadWebDriveTrips();
  expect(mockFetchTasks).toHaveBeenCalledTimes(1);
  expect(mockFetchTasks.mock.calls[0][0]).toEqual({ tag: 'web-client' });
  expect(mockFetchTasks.mock.calls[0][2]).toEqual({ employeeId: 'e-1', selfOnly: true, on: 'web' });
  expect(answer?.tasks.map((t) => t.id)).toEqual(['t-web', 't-new']);
});

it('no own row (not signed in as an employee): nothing, and no task read', async () => {
  mockFetchMe.mockResolvedValue(null);
  expect(await loadWebDriveTrips()).toBeNull();
  expect(mockFetchTasks).not.toHaveBeenCalled();
});
