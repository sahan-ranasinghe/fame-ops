// Round 4–7 (item 8, §33.7): Office mode's Issues and Maintenance through the router. Every action the screens had is
// still there (the header's chips, the Maintenance link, search, the Filter sheet, Sort, Load more, open an issue, the
// problem reports with their filter), and the new ones work: the tabs, the groups by kind with Show all, the ticks and
// the bulk Resolve / Dismiss with one required reason (update_issues), the vehicle cards. The words: en.json with the
// strings sidecar (src/i18n/parts/lists.json) merged in while it exists; a missing key fails the test.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { Stack } from 'expo-router';

import { answers, calls, failOnConsoleError, FIX, resetFake } from './fakeOffice';

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
    merge(en, require('../src/i18n/parts/lists.json').en ?? {});
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
function mockApp() {
  mockT ??= mockWords();
  const { DEFAULT_DRIVER_SETTINGS } = require('../src/lib/api');
  const { translateList } = require('../src/i18n');
  return { t: mockT, tList: (k: string) => translateList('en', k), language: 'en', setLanguage: jest.fn(), settings: DEFAULT_DRIVER_SETTINGS, dataAvailable: true };
}

jest.mock('@/office/client', () => ({ officeApi: require('./fakeOffice').mockOfficeApi }));
jest.mock('@/state/app', () => ({ useApp: () => mockApp() }));
jest.mock('@/office/store', () => ({ useOfficeMe: () => require('./fakeOffice').FIX('me'), getOfficeMe: () => require('./fakeOffice').FIX('me'), setOfficeMe: () => undefined }));

/* eslint-disable import/first */
import IssuesScreen from '@/app/office/issues/index';
import MaintenanceScreen from '@/app/office/maintenance/index';
import { hideSnackbar, SnackbarHost } from '@/components/patterns/Snackbar';
import { OfficeProvider } from '@/office/state';
import type { Issue, Me } from '@/office/types';

const t = () => (mockT ??= mockWords());

const issue = (over: Partial<Issue>): Issue => ({
  id: 'x', kind: 'missed_task', kind_text: 'Missed task', severity: 'warning', title: 'Missed task: Trip', headline: 'Kamal missed the trip', meta: 'WP CAB-4521 · Kamal · 2 h ago',
  vehicle: 'WP CAB-4521', status: 'open', opened: '2026-10-22 08:00', updated: '2026-10-22 08:00', ...over,
});
const MISSED = Array.from({ length: 5 }, (_, n) => issue({ id: `m${n + 1}`, headline: `Kamal missed trip ${n + 1}` }));
const BREAKDOWN = issue({ id: 'b1', kind: 'vehicle_report', kind_text: 'Vehicle problem', severity: 'critical', title: 'Vehicle problem: breakdown', headline: 'Breakdown', meta: 'WP KL-1234 · Sunil · 1 h ago', vehicle: 'WP KL-1234' });

function listIssues(args: Record<string, unknown>) {
  const counts = { status: String(args.status), count: 0, open: 6, in_progress: 0, snoozed: 1, needs_action: 6, critical: 1 };
  if (args.group) {
    return {
      ...counts, issues: [], groups: [
        { kind: 'vehicle_report', kind_text: 'Vehicle problem', severity: 'critical', count: 1, newest: [BREAKDOWN] },
        { kind: 'missed_task', kind_text: 'Missed task', severity: 'warning', count: 5, newest: MISSED.slice(0, 3) },
      ],
    };
  }
  const rows = args.snoozed === true ? [issue({ id: 's1', headline: 'Snoozed one', snoozed_until: '2026-10-23 07:00' })] : args.kind === 'missed_task' ? MISSED : [BREAKDOWN, ...MISSED];
  return { ...counts, count: rows.length, total: rows.length, issues: rows };
}

function routes(me: Me) {
  return {
    _layout: () => (
      <OfficeProvider me={me}>
        <Stack screenOptions={{ headerShown: false }} />
        <SnackbarHost />
      </OfficeProvider>
    ),
    'office/issues/index': IssuesScreen,
    'office/issues/[id]': () => null,
    'office/maintenance/index': MaintenanceScreen,
    'office/maintenance/[id]': () => null,
    'office/vehicles/[reg]': () => null,
  };
}

const ADMIN: Me = { ...FIX('me'), tools: [...FIX('me').tools, 'update_issues'] };
const argsOf = (tool: string) => calls.filter((c) => c.tool === tool).map((c) => c.args);

describe('Office mode: Issues (Round 4–7, item 8)', () => {
  let errors: ReturnType<typeof failOnConsoleError>;
  beforeEach(() => {
    resetFake();
    act(() => hideSnackbar());
    answers.list_issues = listIssues;
    answers.list_vehicles = () => ({ filter: 'all', counts: {}, vehicles: [] });
    answers.update_issues = (args) => ({ status: args.status, done: (args.ids as string[]).length, note: args.note });
    errors = failOnConsoleError();
  });
  afterEach(() => {
    errors.restore();
    expect(errors.seen.map((a) => String(a[0]))).toEqual([]);
  });

  it('the Open tab: groups by kind, the most urgent first, Gmail rows; every old control is still there', async () => {
    renderRouter(routes(ADMIN), { initialUrl: '/office/issues' });
    await screen.findByTestId('issue-group-vehicle_report');
    expect(argsOf('list_issues')[0]).toMatchObject({ status: 'active', snoozed: false, group: true });
    // The header counts what needs action; its chips and the link to the problem reports stay.
    expect(screen.getByText(`${t()('office.issues.title')} · 6`)).toBeTruthy();
    expect(screen.getByText(t()('office.issues.chip_open'))).toBeTruthy();
    expect(screen.getByText(t()('office.issues.chip_snoozed'))).toBeTruthy();
    expect(screen.getByTestId('issues-maintenance')).toBeTruthy();
    // Search, the Filter button, Sort.
    expect(screen.getByTestId('filter-bar')).toBeTruthy();
    // The groups: their headings with the counts, 3 rows each, Show all for the rest.
    const missed = screen.getByTestId('issue-group-missed_task');
    expect(within(missed).getByText(t()('office.issues.group.missed_task').toUpperCase())).toBeTruthy();
    expect(within(missed).getAllByTestId('issue-row')).toHaveLength(3);
    expect(within(missed).getByText('Kamal missed trip 1')).toBeTruthy();
    expect(within(missed).queryByText(/Missed task/)).toBeNull();
    expect(within(missed).getByText(t()('office.issues.showAll', { n: 5 }))).toBeTruthy();
    // The tabs.
    for (const k of ['open', 'snoozed', 'resolved'] as const) expect(screen.getByText(new RegExp(`^${t()(`office.issues.tab.${k}`)}`))).toBeTruthy();
  });

  it('Show all N lists the kind (Load more pages it); a tab asks its own status', async () => {
    renderRouter(routes(ADMIN), { initialUrl: '/office/issues' });
    const missed = await screen.findByTestId('issue-group-missed_task');
    fireEvent.press(within(missed).getByText(t()('office.issues.showAll', { n: 5 })));
    await waitFor(() => expect(argsOf('list_issues').at(-1)).toMatchObject({ status: 'active', kind: 'missed_task', snoozed: false, limit: 50 }));
    expect(argsOf('list_issues').at(-1)?.group).toBeUndefined();
    await waitFor(() => expect(screen.getAllByTestId('issue-row')).toHaveLength(5));
    fireEvent.press(screen.getByText(new RegExp(`^${t()('office.issues.tab.snoozed')}`)));
    await waitFor(() => expect(argsOf('list_issues').at(-1)).toMatchObject({ status: 'active', snoozed: true }));
  });

  it('bulk: tick two rows, Resolve with a reason (required); one update_issues call; the snackbar says so', async () => {
    renderRouter(routes(ADMIN), { initialUrl: '/office/issues' });
    const missed = await screen.findByTestId('issue-group-missed_task');
    const ticks = within(missed).getAllByTestId('issue-tick');
    fireEvent.press(ticks[0]);
    fireEvent.press(ticks[1]);
    const bar = await screen.findByTestId('bulk-bar');
    expect(within(bar).getByText(t()('office.issues.selectedN', { n: 2 }))).toBeTruthy();
    fireEvent.press(within(bar).getByText(t()('office.issues.bulk.resolve')));
    const sheet = await screen.findByTestId('bulk-sheet');
    expect(within(sheet).getByText(t()('office.issues.bulk.reasonNeeded'))).toBeTruthy();
    fireEvent.press(within(sheet).getByText(t()('office.issues.reason.test')));
    await act(async () => { fireEvent.press(screen.getByTestId('bulk-confirm')); });
    await waitFor(() => expect(argsOf('update_issues')).toEqual([{ ids: ['m1', 'm2'], status: 'resolved', note: t()('office.issues.reason.test') }]));
    expect(await screen.findByText(t()('office.issues.bulk.doneResolved', { n: 2 }))).toBeTruthy();
    expect(screen.queryByTestId('bulk-bar')).toBeNull();
  });

  it("a group's tick, then Select all N in this group (every one of the kind); Dismiss them", async () => {
    renderRouter(routes(ADMIN), { initialUrl: '/office/issues' });
    const missed = await screen.findByTestId('issue-group-missed_task');
    fireEvent.press(within(missed).getByTestId('group-tick'));
    fireEvent.press(await screen.findByTestId('group-select-all'));
    await waitFor(() => expect(within(screen.getByTestId('bulk-bar')).getByText(t()('office.issues.selectedN', { n: 5 }))).toBeTruthy());
    expect(argsOf('list_issues').at(-1)).toMatchObject({ kind: 'missed_task', limit: 5 });
    fireEvent.press(within(screen.getByTestId('bulk-bar')).getByText(t()('office.issues.bulk.dismiss')));
    fireEvent.changeText(await screen.findByPlaceholderText(t()('office.issues.bulk.reasonPlaceholder')), 'Test phone');
    await act(async () => { fireEvent.press(screen.getByTestId('bulk-confirm')); });
    await waitFor(() => expect(argsOf('update_issues')).toEqual([{ ids: ['m1', 'm2', 'm3', 'm4', 'm5'], status: 'dismissed', note: 'Test phone' }]));
  });

  it('without update_issues: no ticks and no bar; the icon is not a tick (a tap opens the issue, as the row)', async () => {
    const r = renderRouter(routes(FIX('me')), { initialUrl: '/office/issues' });
    const missed = await screen.findByTestId('issue-group-missed_task');
    expect(within(missed).queryByTestId('group-tick')).toBeNull();
    expect(within(missed).getAllByTestId('issue-tick')[0].props.accessibilityRole).toBe('image');
    fireEvent.press(within(missed).getAllByTestId('issue-row')[0]);
    await waitFor(() => expect(r.getPathname()).toBe('/office/issues/m1'));
    expect(screen.queryByTestId('bulk-bar')).toBeNull();
  });
});

describe('Office mode: Maintenance (Round 4–7, item 8)', () => {
  let errors: ReturnType<typeof failOnConsoleError>;
  beforeEach(() => {
    resetFake();
    act(() => hideSnackbar());
    answers.list_vehicles = () => ({
      filter: 'all', counts: {}, vehicles: [
        { reg_no: 'WP CAB-4521', make_model: 'Toyota HiAce', next_service: '320 km over', service_state: 'overdue', documents: { lic: { expiry: '2027-03-01', days_left: 130 } }, documents_missing: ['insurance'] },
        { reg_no: 'WP KL-1234', make_model: 'Suzuki Every', next_service: 'In 9,000 km', service_state: 'ok', documents: { lic: { expiry: '2027-03-01', days_left: 130 }, ins: { expiry: '2027-03-01', days_left: 130 }, emi: { expiry: '2027-03-01', days_left: 130 } } },
      ],
    });
    answers.fleet_overview = () => ({ reminders: { count: 1, window_days: 14 }, needs_attention: [{ what: 'Missed task', kind: 'missed_task', level: 'red', issue_id: 'i9' }] });
    answers.list_vehicle_reports = (args) => ({ status: args.status, count: 1, total: 1, reports: [{ id: 'r1', reported: '2026-10-22 09:10', vehicle: 'WP CAB-4521', driver: 'Kamal', category: 'tyre', status: 'open', photos: [] }] });
    errors = failOnConsoleError();
  });
  afterEach(() => {
    errors.restore();
    expect(errors.seen.map((a) => String(a[0]))).toEqual([]);
  });

  it('Service and documents: the summary, one card per vehicle that needs attention, the line to Issues; the reports are one tap away', async () => {
    renderRouter(routes(ADMIN), { initialUrl: '/office/maintenance' });
    await screen.findByTestId('care-summary');
    expect(screen.getByText(t()('office.care.summaryAttention', { n: 1, total: 2 }))).toBeTruthy();
    expect(screen.getAllByTestId('care-card')).toHaveLength(1);
    expect(screen.getByTestId('care-bar').props.accessibilityValue).toEqual({ min: 0, max: 100, now: 100 });
    expect(await screen.findByTestId('maintenance-issues')).toBeTruthy();
    fireEvent.press(screen.getByText(t()('office.care.show.all')));
    expect(screen.getAllByTestId('care-card')).toHaveLength(2);
    // The problem reports: the second view, with its search, Filter and rows, as before.
    fireEvent.press(screen.getByText(t()('office.care.view.reports')));
    expect(await screen.findByTestId('report-row')).toBeTruthy();
    expect(argsOf('list_vehicle_reports')[0]).toEqual({ status: 'not_closed', limit: 25 });
    expect(screen.getByTestId('filter-bar')).toBeTruthy();
  });

  it('the Issues header opens the problem reports directly', async () => {
    renderRouter(routes(ADMIN), { initialUrl: '/office/maintenance?view=reports' });
    expect(await screen.findByTestId('report-row')).toBeTruthy();
    expect(screen.queryByTestId('care-summary')).toBeNull();
  });
});
