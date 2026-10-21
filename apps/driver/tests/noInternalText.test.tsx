// Nothing internal is ever shown (Sahan, 21 October 2026): a screen fed the server's real answers shows no translation key
// ("office.status.Sent"), no enum name, no id. The words come from src/i18n (a missing key throws in the tests,
// src/i18n/index.ts); this test also reads every text on the screen for a key's shape.
import { screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { Stack } from 'expo-router';
import { act } from 'react';

import { answers, failOnConsoleError, FIX, resetFake } from './fakeOffice';

jest.mock('@/office/client', () => ({ officeApi: require('./fakeOffice').mockOfficeApi }));
jest.mock('@/state/app', () => ({ useApp: () => require('./fakeOffice').mockUseApp() }));
jest.mock('@/office/store', () => ({ useOfficeMe: () => require('./fakeOffice').FIX('me'), getOfficeMe: () => require('./fakeOffice').FIX('me'), setOfficeMe: () => undefined }));

/* eslint-disable import/first */
import Tasks from '@/app/office/(tabs)/tasks';
import { hideSnackbar } from '@/components/patterns/Snackbar';
import { OfficeProvider } from '@/office/state';
import type { Board, BoardCard, Me as OfficeMe } from '@/office/types';

const ME: OfficeMe = FIX('me');

/** "office.status.Sent", "common.back", "vehicleType.van": a dotted lowercase-first word chain (never in our sentences). */
const KEY_SHAPE = /\b[a-z][A-Za-z]+(?:\.[A-Za-z_][\w]*){1,}\b/;
/** Enum names and ids: in_progress, needs_driver, a uuid. */
const ENUM_SHAPE = /\b[a-z]+_[a-z_]+\b|[0-9a-f]{8}-[0-9a-f]{4}-/;

/** Every text the screen shows. */
function shownTexts(): string[] {
  const out: string[] = [];
  const walk = (n: unknown) => {
    if (n == null) return;
    if (typeof n === 'string') { out.push(n); return; }
    if (Array.isArray(n)) { n.forEach(walk); return; }
    const node = n as { children?: unknown[] };
    node.children?.forEach(walk);
  };
  walk(screen.toJSON());
  return out;
}

export function expectNoInternalText() {
  const bad = shownTexts().filter((s) => KEY_SHAPE.test(s) || ENUM_SHAPE.test(s));
  expect(bad).toEqual([]);
}

const card = (id: string, status: string, extra: Partial<BoardCard> = {}): BoardCard => ({
  id: `00000000-0000-4000-8000-00000000000${id}`, time: '09:00', title: `Trip ${id}`, driver: 'Kamal Perera', vehicle: 'WP CAB-4521',
  stops_count: 2, status, ...extra,
} as BoardCard);

// The server's own status sentences (supabase/functions/_shared/fleet/tools/tasks.ts statusLine), one per column.
const board = (): Board => ({
  date: '2026-10-21',
  counts: { assigned: 3, in_progress: 1, completed: 1, cancelled: 0, declined: 1 },
  assigned: [card('1', 'Sent · not opened yet'), card('2', 'Seen by driver 16:06'), card('3', 'Accepted 16:10', { accepted: '16:10' })],
  in_progress: [card('4', 'Started 07:06 · sharing location')],
  completed: [card('5', 'Completed 11:40 · 42 km')],
  declined: [card('6', 'Declined (Vehicle problem) · Flat tyre')],
});

const routes = {
  _layout: () => <OfficeProvider me={ME}><Stack screenOptions={{ headerShown: false }} /></OfficeProvider>,
  'office/(tabs)/tasks': Tasks,
};

let errors: ReturnType<typeof failOnConsoleError>;
beforeEach(() => {
  resetFake();
  act(() => hideSnackbar());
  answers.task_board = () => board();
  errors = failOnConsoleError();
});
afterEach(() => errors.restore());

describe('No internal text on the screens', () => {
  it('the task board with the server\'s status sentences in every column: words only, no key, no enum, no id', async () => {
    renderRouter(routes, { initialUrl: '/office/tasks' });
    await waitFor(() => expect(screen.getAllByText(/^Trip \d$/).length).toBeGreaterThan(0));
    expectNoInternalText();
  });
});
