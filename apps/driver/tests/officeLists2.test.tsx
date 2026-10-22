// Round 4–7 (item 8, the lists cleaned up, second part): Office mode's reworked lists through the router. Each keeps its
// key actions (open a row, the search, the Filter, Load more / Show all, the row's own buttons: Call, Withdraw, Request a
// vehicle, Mark all read, Ask drivers, Assign a task, History, Register vehicle) and says each fact once: My trips' chip
// against its section and the "Approved by" line (25 at a time), Approve's requester and chip, the Alerts' chevron and the
// Unread filter asked of the server, Mileage's 5 rows per section, the Drivers tab's state, the Tasks tab's chips, the
// Vehicles' one status and quiet valid documents, the Task history and Activity log titles. The words: en.json with the
// sidecar (src/i18n/parts/lists2.json) merged in while it exists (tests/fakeOffice.tsx); a missing key fails the test.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { Stack } from 'expo-router';

import { answers, calls, failOnConsoleError, FIX, resetFake } from './fakeOffice';

jest.mock('@/office/client', () => ({ officeApi: require('./fakeOffice').mockOfficeApi }));
jest.mock('@/state/app', () => ({ useApp: () => require('./fakeOffice').mockUseApp() }));
jest.mock('@/office/store', () => ({ useOfficeMe: () => require('./fakeOffice').FIX('me'), getOfficeMe: () => require('./fakeOffice').FIX('me'), setOfficeMe: () => undefined }));

/* eslint-disable import/first */
import AlertsTab from '@/app/office/(tabs)/alerts';
import ApproveTab from '@/app/office/(tabs)/approve';
import DriversTab from '@/app/office/(tabs)/drivers';
import TasksTab from '@/app/office/(tabs)/tasks';
import TripsTab from '@/app/office/(tabs)/trips';
import ActivityLogScreen from '@/app/office/people/activity';
import ReportsScreen from '@/app/office/reports/index';
import TaskHistoryScreen from '@/app/office/task-history';
import VehiclesScreen from '@/app/office/vehicles/index';
import { hideSnackbar, SnackbarHost } from '@/components/patterns/Snackbar';
import { colomboDate } from '@/lib/time';
import { OfficeProvider } from '@/office/state';
import type { BoardCard, BoardDriver, CreatedTaskCard, InboxItem, Me, RequestCard, VehicleCard } from '@/office/types';

const t = (key: string, vars?: Record<string, string | number>): string => require('./fakeOffice').mockUseApp().t(key, vars);
const argsOf = (tool: string) => calls.filter((c) => c.tool === tool).map((c) => c.args);
const ME: Me = { ...FIX('me'), tools: [...FIX('me').tools, 'activity_log'] };

function routes(me: Me = ME) {
  return {
    _layout: () => (
      <OfficeProvider me={me}>
        <Stack screenOptions={{ headerShown: false }} />
        <SnackbarHost />
      </OfficeProvider>
    ),
    'office/(tabs)/trips': TripsTab,
    'office/(tabs)/approve': ApproveTab,
    'office/(tabs)/alerts': AlertsTab,
    'office/(tabs)/drivers': DriversTab,
    'office/(tabs)/tasks': TasksTab,
    'office/reports/index': ReportsScreen,
    'office/task-history': TaskHistoryScreen,
    'office/people/activity': ActivityLogScreen,
    'office/vehicles/index': VehiclesScreen,
    'office/vehicles/[reg]': () => null,
    'office/vehicles/form': () => null,
    'office/request/[id]': () => null,
    'office/task/[id]': () => null,
    'office/task/[id]/driver': () => null,
    'office/driver/[username]': () => null,
    'office/my-trip/[id]': () => null,
    'office/trip/where': () => null,
  };
}

/** Applies one choice in the Filter sheet (docs/ui-patterns.md §1): the button, the choice, Apply. */
function applyFilter(choice: RegExp) {
  fireEvent.press(screen.getByTestId('filter-button'));
  fireEvent.press(within(screen.getByTestId('filter-sheet')).getByText(choice));
  fireEvent.press(within(screen.getByTestId('filter-sheet')).getByText(t('patterns.apply')));
}

let errors: ReturnType<typeof failOnConsoleError>;
beforeEach(() => {
  resetFake();
  act(() => hideSnackbar());
  errors = failOnConsoleError();
});
afterEach(() => {
  errors.restore();
  expect(errors.seen.map((a) => String(a[0]))).toEqual([]);
});

// ---- My trips ------------------------------------------------------------------------------------------------------

const req = (n: number, over: Partial<RequestCard>): RequestCard => ({
  id: `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`, requested_by: 'Dilini', when: '2026-10-25 09:00', route: `Head office → Stop ${n}`, status: 'waiting', version: 1, ...over,
} as RequestCard);
const TRIPS: RequestCard[] = [
  req(1, { title: 'Waiting trip', live: { state: 'waiting', text: 'Waiting' } }),
  req(2, { title: 'Approved trip', status: 'approved', live: { state: 'approved', text: 'Approved' }, approved_by: { name: 'Palitha', at: 'Sun 16:40', call: 'tel:+94770000001' } }),
  req(3, { title: 'Accepted trip', status: 'approved', live: { state: 'accepted', text: 'Driver accepted · 10:42' }, approved_by: { name: 'Palitha', at: 'Sun 16:40' } }),
  req(4, { title: 'Done trip', status: 'approved', live: { state: 'completed', text: 'Completed · 14:20' } }),
  req(5, { title: 'Declined trip', status: 'declined', live: { state: 'declined', text: 'Declined · no van' } }),
  ...Array.from({ length: 25 }, (_, i) => req(i + 6, { title: `Old trip ${i + 6}`, status: 'approved', live: { state: 'completed', text: 'Completed · 09:00' } })),
];
const RIDING: CreatedTaskCard = { source: 'task', id: 't9', task_id: 't9', title: 'Riding along', when: '2026-10-25 08:00', status: 'in_progress', role: 'passenger', live: { state: 'on_the_way', text: 'On the way · 08:10' } } as CreatedTaskCard;

describe('Office mode: My trips (item 8)', () => {
  beforeEach(() => {
    answers.my_trips = (args) => {
      const all = [RIDING, ...TRIPS];
      const from = args.cursor ? Number(args.cursor) : 0;
      const page = all.slice(from, from + Number(args.limit));
      const next = from + page.length < all.length ? String(from + page.length) : undefined;
      return { from: args.from, to: args.to, include: 'all', count: page.length, total: all.length, ...(next ? { next } : {}), trips: page };
    };
  });

  it('25 at a time with Load more; the chip only when the section and the Approved-by line do not say it; Passenger, Call, Withdraw, Request a vehicle kept', async () => {
    renderRouter(routes(), { initialUrl: '/office/trips' });
    await screen.findByText('Waiting trip');
    expect(argsOf('my_trips')[0]).toMatchObject({ include: 'all', limit: 25 });
    expect(argsOf('my_trips')[0].cursor).toBeUndefined();
    // No "Waiting" chip under WAITING, no "Approved" chip beside "Approved by Palitha", no "Done" under DONE.
    expect(screen.queryByText(t('office.chip.waiting'))).toBeNull();
    expect(screen.queryByText(t('office.chip.approved'))).toBeNull();
    expect(screen.getAllByText(t('office.trips.approvedBy', { name: 'Palitha', at: 'Sun 16:40' }))).toHaveLength(2);
    expect(screen.queryByText(t('office.chip.done'))).toBeNull();
    // A chip that says something else stays (Accepted in Coming up, Declined in Done).
    expect(screen.getByText(t('office.chip.accepted'))).toBeTruthy();
    expect(screen.getByText(t('office.chip.declined'))).toBeTruthy();
    // The Passenger tag, Call the approver, Withdraw on the waiting one, Request a vehicle.
    expect(screen.getByText(t('office.passengers.tag'))).toBeTruthy();
    expect(screen.getByLabelText(t('office.trips.callName', { name: 'Palitha' }))).toBeTruthy();
    expect(screen.getByText(t('office.trips.withdraw'))).toBeTruthy();
    expect(screen.getAllByText(t('office.trip.requestVehicle')).length).toBeGreaterThan(0);
    expect(screen.getByTestId('filter-bar')).toBeTruthy();
    // Load more: the next 25 on my_trips' cursor.
    fireEvent.press(screen.getByText(t('patterns.loadMore')));
    await waitFor(() => expect(argsOf('my_trips').at(-1)).toMatchObject({ cursor: '25', limit: 25 }));
    expect(await screen.findByText('Old trip 30')).toBeTruthy();
    expect(screen.queryByText(t('patterns.loadMore'))).toBeNull();
  });
});

// ---- Approve -------------------------------------------------------------------------------------------------------

describe('Office mode: Approve (item 8)', () => {
  beforeEach(() => {
    answers.list_requests = (args) => {
      const rows: RequestCard[] = [
        req(11, { requested_by: 'Nimali', title: 'Team drop', need: 'any van', status: 'waiting' }),
        req(12, { requested_by: 'Sunil', title: undefined, route: undefined, project: undefined, need: 'car', status: 'changed' }),
      ];
      const shown = args.status === 'all' ? [...rows, req(13, { requested_by: 'Kasun', title: 'Approved one', status: 'approved' })] : rows;
      return { status: args.status, count: shown.length, total: shown.length, requests: shown };
    };
  });

  it('the requester once (the title is the trip); no Waiting chip in Waiting, Changed kept; All shows every chip; a row opens its request', async () => {
    const r = renderRouter(routes(), { initialUrl: '/office/approve' });
    await screen.findByText('Team drop');
    const rows = screen.getAllByTestId('request-row');
    // Nimali's: the trip as title, her name once in the line.
    expect(within(rows[0]).getAllByText(/Nimali/)).toHaveLength(1);
    expect(within(rows[0]).getByText(/^Nimali · /)).toBeTruthy();
    // Sunil's has no trip words: his name is the title and not in the line again.
    expect(within(rows[1]).getAllByText(/Sunil/)).toHaveLength(1);
    expect(within(rows[1]).getByText('Sunil')).toBeTruthy();
    // The chips: no Waiting under Waiting, Changed kept.
    expect(within(rows[0]).queryByText(t('office.requests.status_waiting'))).toBeNull();
    expect(within(rows[1]).getByText(t('office.requests.status_changed'))).toBeTruthy();
    expect(screen.getByTestId('filter-bar')).toBeTruthy();
    applyFilter(new RegExp(`^${t('office.common.all')}`));
    await waitFor(() => expect(argsOf('list_requests').at(-1)).toMatchObject({ status: 'all' }));
    await screen.findByText('Approved one');
    expect(screen.getByText(t('office.requests.status_waiting'))).toBeTruthy();
    expect(screen.getByText(t('office.requests.status_approved'))).toBeTruthy();
    fireEvent.press(screen.getAllByTestId('request-row')[0]);
    await waitFor(() => expect(r.getPathname()).toBe(`/office/request/${req(11, {}).id}`));
  });
});

// ---- Alerts --------------------------------------------------------------------------------------------------------

const item = (id: number, over: Partial<InboxItem>): InboxItem => ({ id, event: 'request.created', title: `Alert ${id}`, at: '2026-10-22 08:00', ago: '2 h ago', read: false, kind: 'urgent', ...over });

describe('Office mode: Alerts (item 8)', () => {
  beforeEach(() => {
    answers.my_inbox = (args) => {
      const items = [
        item(1, { url: `/requests/${req(11, {}).id}` }),
        item(2, { read: true, title: 'No screen for this one' }),
      ].filter((i) => !args.unread || !i.read);
      return { unread: 1, count: items.length, total: items.length, items };
    };
    answers.mark_inbox_read = () => ({ ok: true });
  });

  it('a row with a screen has the chevron alone (no "Open" pill), one without none; Unread is asked of the server; Mark all read kept', async () => {
    const r = renderRouter(routes(), { initialUrl: '/office/alerts' });
    await screen.findByText('Alert 1');
    expect(screen.queryByText(t('office.alerts.open'))).toBeNull();
    expect(screen.getAllByTestId('alert-chevron')).toHaveLength(1);
    expect(screen.getByText(t('office.alerts.markAllRead'))).toBeTruthy();
    // The list's own calls (50 a page; the badge asks its count apart).
    const listArgs = () => argsOf('my_inbox').filter((a) => a.limit === 50);
    expect(listArgs()[0].unread).toBeUndefined();
    applyFilter(new RegExp(`^${t('office.alerts.unread')}`));
    await waitFor(() => expect(listArgs().at(-1)).toMatchObject({ unread: true, limit: 50 }));
    await waitFor(() => expect(screen.queryByText('No screen for this one')).toBeNull());
    // A tap opens its screen and marks it read.
    fireEvent.press(screen.getByText('Alert 1'));
    await waitFor(() => expect(r.getPathname()).toBe(`/office/request/${req(11, {}).id}`));
    expect(argsOf('mark_inbox_read')).toEqual([{ ids: [1] }]);
  });
});

// ---- Mileage (Reports) ---------------------------------------------------------------------------------------------

describe('Office mode: Mileage (item 8)', () => {
  beforeEach(() => {
    const rows = Array.from({ length: 32 }, (_, i) => ({ vehicle: `WP V-${1000 + i}`, task_km: 10 + i, odometer_km: 20 + i }));
    const totals = { tasks: 3, task_km: 42, fuel_litres: 30, fuel_lkr: 9000, unlogged_km_flags: 0, check_odometer: 0, between_tasks_km: 0, overnight_km: 0 };
    answers.mileage_summary = (args) => ({
      month: '2026-10', totals, vehicles: rows, biggest_gaps: [], unlogged_km: [], check_odometer: [],
      ...(args.from ? { range: { from: args.from, to: args.to, totals, vehicles: rows, biggest_gaps: [], unlogged_km: [], check_odometer: [] } } : {}),
    });
    answers.list_vehicles = () => ({ filter: 'all', counts: {}, vehicles: [{ reg_no: 'WP CAB-4521' }] });
    answers.list_drivers = () => ({ drivers: [{ name: 'Kamal Perera', username: 'kamal' }] });
  });

  it('each section shows 5 rows; Show all N shows 25, then Load more 25 at a time; the range, the Filter and the sections kept', async () => {
    renderRouter(routes(), { initialUrl: '/office/reports' });
    const section = await screen.findByTestId('mileage-vehicles');
    expect(within(section).getAllByText(/^WP V-/)).toHaveLength(5);
    expect(screen.getByTestId('reports-range')).toBeTruthy();
    expect(screen.getByTestId('reports-filter')).toBeTruthy();
    expect(screen.getByText(t('office.reports.fuel'))).toBeTruthy();
    fireEvent.press(within(section).getByText(t('office.lists2.showAll', { n: 32 })));
    expect(within(section).getAllByText(/^WP V-/)).toHaveLength(25);
    expect(within(section).getByText(t('patterns.shownOf', { n: 25, total: 32 }))).toBeTruthy();
    fireEvent.press(within(section).getByText(t('patterns.loadMore')));
    expect(within(section).getAllByText(/^WP V-/)).toHaveLength(32);
    expect(within(section).queryByText(t('patterns.loadMore'))).toBeNull();
    // The other sections' empty states are as before.
    expect(screen.getByText(t('office.reports.noGaps'))).toBeTruthy();
    // One answer: nothing asked again.
    expect(argsOf('mileage_summary')).toHaveLength(1);
  });
});

// ---- Drivers -------------------------------------------------------------------------------------------------------

const driver = (name: string, username: string, status: BoardDriver['status'], over: Partial<BoardDriver> = {}): BoardDriver =>
  ({ name, username, status, free_now: false, licence: { chip: 'ok' }, links: { call: 'tel:+94771112222' }, ...over } as BoardDriver);
const DRIVERS: BoardDriver[] = [
  driver('Kamal Perera', 'kamal', { kind: 'on_duty', text: 'On duty since 07:12' }, { free_now: true }),
  driver('Nuwan Silva', 'nuwan', { kind: 'on_task', text: 'On a task until ~15:40 (live)' }),
  driver('Sunil Fernando', 'sunil', { kind: 'off_duty', text: 'Off duty since 07:40' }, { usual_start: '07:30' }),
  driver('Ruwan Jaya', 'ruwan', { kind: 'not_available', text: 'Not available, back 13:00' }),
];

describe('Office mode: Drivers (item 8)', () => {
  beforeEach(() => {
    answers.drivers_board = (args) => ({
      as_of: '2026-10-22 08:00', filter: args.filter ?? 'all', counts: { all: 4, free_now: 1, on_task: 1, off_duty: 1, not_available: 1 },
      drivers: DRIVERS.filter((d) => !args.filter || args.filter === 'all' || (args.filter === 'free_now' ? d.free_now : d.status.kind === args.filter)),
    });
  });

  it('Not available once (the pill; the line "Back 13:00"); under a Show filter the line says only what it adds; Call, Ask drivers, a row opening kept', async () => {
    const r = renderRouter(routes(), { initialUrl: '/office/drivers' });
    await screen.findByText('Ruwan Jaya');
    const line = (u: string) => within(screen.getByTestId(`driver-row-${u}`)).queryByTestId('driver-line1')?.props.children;
    expect(line('kamal')).toBe('On duty since 07:12');
    expect(line('nuwan')).toBe('On a task until ~15:40 (live)');
    expect(line('ruwan')).toBe(t('office.lists2.rest.back', { time: '13:00' }));
    expect(within(screen.getByTestId('driver-row-ruwan')).getByText(t('office.drivers.pill.notAvailable'))).toBeTruthy();
    expect(screen.getAllByLabelText(new RegExp(`^${t('office.common.call')} `))).toHaveLength(3);
    expect(screen.getByText(t('office.drivers.now'))).toBeTruthy();
    expect(screen.getByText(t('office.ask.open'))).toBeTruthy();
    expect(screen.getByTestId('filter-bar')).toBeTruthy();
    // Under On a task: "Until ~15:40 (live)".
    applyFilter(new RegExp(`^${t('office.drivers.filter.on_task')}`));
    await waitFor(() => expect(argsOf('drivers_board').at(-1)).toMatchObject({ filter: 'on_task' }));
    await waitFor(() => expect(screen.queryByText('Kamal Perera')).toBeNull());
    expect(line('nuwan')).toBe(t('office.lists2.rest.untilLive', { time: '15:40' }));
    // Under Off duty: "Since 07:40 · usually starts 07:30".
    applyFilter(new RegExp(`^${t('office.drivers.filter.off_duty')}`));
    await waitFor(() => expect(screen.queryByText('Nuwan Silva')).toBeNull());
    expect(line('sunil')).toBe(`${t('office.lists2.rest.since', { time: '07:40' })} · ${t('office.drivers.usuallyStarts', { time: '07:30' })}`);
    // Under Not available: no pill (the filter says it), the line "Back 13:00", still no Call.
    applyFilter(new RegExp(`^${t('office.drivers.filter.not_available')}`));
    await waitFor(() => expect(screen.queryByText('Sunil Fernando')).toBeNull());
    expect(within(screen.getByTestId('driver-row-ruwan')).queryByText(t('office.drivers.pill.notAvailable'))).toBeNull();
    expect(line('ruwan')).toBe(t('office.lists2.rest.back', { time: '13:00' }));
    expect(screen.queryAllByLabelText(new RegExp(`^${t('office.common.call')} `))).toHaveLength(0);
    fireEvent.press(screen.getByTestId('driver-row-ruwan'));
    await waitFor(() => expect(r.getPathname()).toBe('/office/driver/ruwan'));
  });
});

// ---- Tasks ---------------------------------------------------------------------------------------------------------

const card = (id: string, status: string, extra: Partial<BoardCard> = {}): BoardCard =>
  ({ id: `00000000-0000-4000-8000-00000000000${id}`, time: '09:00', title: `Trip ${id}`, driver: 'Kamal Perera', vehicle: 'WP CAB-4521', stops_count: 2, status, ...extra } as BoardCard);

describe('Office mode: Tasks (item 8)', () => {
  beforeEach(() => {
    answers.task_board = () => ({
      date: colomboDate(new Date()),
      counts: { assigned: 3, in_progress: 2, completed: 2, cancelled: 0, declined: 0 },
      assigned: [card('1', 'Sent · not opened yet'), card('2', 'Seen by driver 16:06'), card('3', 'Accepted 16:10', { accepted: '16:10' })],
      in_progress: [card('4', 'Started 07:06 · sharing location'), card('5', 'Started 07:30 · sharing location', { late_min: 12 })],
      completed: [card('6', 'Done 11:40 · 42 km logged'), card('7', 'Done 12:00 · 10 km logged', { finish_flag: { kind: 'not_confirmed', text: 'Closed at 09:00 the next day without the odometer' } })],
    });
  });

  it('no Done in DONE, no Under way in On the way, no Sent / Seen / Accepted beside the same sentence; Late and Not confirmed kept; Assign a task, History, a row opening kept', async () => {
    const r = renderRouter(routes(), { initialUrl: '/office/tasks' });
    await screen.findByText('Trip 1');
    for (const k of ['done', 'underWay', 'sent', 'seen', 'accepted']) expect(screen.queryByText(t(`office.chip.${k}`))).toBeNull();
    expect(screen.getByText(t('office.chip.late', { min: 12 }))).toBeTruthy();
    expect(screen.getByText(t('office.chip.notConfirmed'))).toBeTruthy();
    // The lines keep the sentence with its time.
    expect(screen.getByText(`Kamal Perera · ${t('office.line.done', { time: '11:40', km: '42' })}`)).toBeTruthy();
    expect(screen.getByText(`Kamal Perera · ${t('office.line.seen', { time: '16:06' })}`)).toBeTruthy();
    expect(screen.getByText(t('office.trip.assignTask'))).toBeTruthy();
    expect(screen.getByTestId('tasks-history')).toBeTruthy();
    expect(screen.getByTestId('tasks-day')).toBeTruthy();
    fireEvent.press(screen.getByText('Trip 6'));
    await waitFor(() => expect(r.getPathname()).toBe(`/office/task/${card('6', '').id}`));
  });
});

// ---- Vehicles ------------------------------------------------------------------------------------------------------

const vehicle = (reg: string, over: Partial<VehicleCard> = {}): VehicleCard => ({
  reg_no: reg, make_model: 'Toyota HiAce', seats: 14, status: 'Available', availability: 'Free', km_this_month: 100, km_allowance: 2500, active: true,
  documents: { lic: { chip: 'ok' }, ins: { chip: 'orange' }, emi: { chip: 'red' } }, ...over,
} as VehicleCard);

describe('Office mode: Vehicles (item 8)', () => {
  beforeEach(() => {
    const rows = [
      vehicle('WP CAB-4521'),
      vehicle('WP GA-1111', { status: 'In garage', availability: 'In garage', in_garage: true }),
      vehicle('WP NO-0001', { make_model: undefined, seats: undefined, type: 'van' }),
      vehicle('WP RT-0002', { active: false }),
      ...Array.from({ length: 24 }, (_, i) => vehicle(`WP V-${1000 + i}`)),
    ];
    answers.list_vehicles = (args) => {
      const from = args.cursor ? Number(args.cursor) : 0;
      const page = rows.slice(from, from + 25);
      const next = from + page.length < rows.length ? String(from + page.length) : undefined;
      return { filter: args.filter, counts: { all: rows.length, on_task: 0, available: 26, in_garage: 1, documents_expiring: 28 }, total: rows.length, ...(next ? { next } : {}), vehicles: page };
    };
  });

  it('the plate once, one status (the line; In garage and Returned as the pill), a valid document quiet; Register, the Filter, Load more, a row opening kept', async () => {
    const r = renderRouter(routes(), { initialUrl: '/office/vehicles' });
    await screen.findByText('WP GA-1111');
    // No "Available" pill: the line says Free.
    expect(screen.queryByText('Available')).toBeNull();
    expect(screen.getAllByText(/^Free · /).length).toBeGreaterThan(0);
    // In garage: the pill, and the line without "In garage" again.
    expect(screen.getAllByText(t('office.vehicles.filter_in_garage'))).toHaveLength(1);
    expect(screen.getByText(t('office.vehicles.returned'))).toBeTruthy();
    // No make: the type, never the plate a second time.
    expect(screen.getAllByText('WP NO-0001')).toHaveLength(1);
    expect(screen.getByText(t('office.vehicles.type_van'))).toBeTruthy();
    // Lic valid and quiet (still said to the screen reader), Ins and Emi in colour.
    expect(screen.getAllByLabelText(t('office.lists2.vehicles.docValid', { doc: t('office.vehicles.doc_lic') })).length).toBeGreaterThan(0);
    expect(screen.getAllByText(t('office.vehicles.doc_ins')).length).toBeGreaterThan(0);
    expect(screen.getAllByText(t('office.vehicles.register')).length).toBeGreaterThan(0);
    expect(screen.getByTestId('filter-bar')).toBeTruthy();
    fireEvent.press(screen.getByText(t('patterns.loadMore')));
    await waitFor(() => expect(argsOf('list_vehicles').at(-1)).toMatchObject({ cursor: '25' }));
    expect(await screen.findByText('WP V-1023')).toBeTruthy();
    fireEvent.press(screen.getByText('WP GA-1111'));
    await waitFor(() => expect(r.getPathname()).toBe('/office/vehicles/WP GA-1111'));
  });
});

// ---- Task history and Activity log ---------------------------------------------------------------------------------

describe('Office mode: Task history and Activity log (item 8)', () => {
  it('Task history: the header says it, the section says Tasks; a row opens its task; Load more, the range and the Filter kept', async () => {
    answers.list_tasks = (args) => ({
      from: args.from, to: args.to, count: 1, total: 2, next: '1', totals: { tasks: 2, km: 0 },
      tasks: [{ id: '00000000-0000-4000-8000-000000000001', date: '2026-10-21', time: '09:00', title: 'Old trip', driver: 'Kamal', status: 'completed' }],
    });
    answers.list_vehicles = () => ({ filter: 'all', counts: {}, vehicles: [] });
    answers.list_drivers = () => ({ drivers: [] });
    const r = renderRouter(routes(), { initialUrl: '/office/task-history' });
    await screen.findByText('Old trip');
    expect(screen.getAllByText(t('office.history2.title'))).toHaveLength(1);
    expect(screen.getByText(t('office.lists2.history.section').toUpperCase())).toBeTruthy();
    expect(screen.getByTestId('history-range')).toBeTruthy();
    expect(screen.getByTestId('history-filter')).toBeTruthy();
    expect(screen.getByText(t('patterns.loadMore'))).toBeTruthy();
    fireEvent.press(screen.getByTestId('history-row'));
    await waitFor(() => expect(r.getPathname()).toBe('/office/task/00000000-0000-4000-8000-000000000001'));
  });

  it('Activity log: the header says it, the section says Changes; the outcome chip (not "Done": Sahan, 22 October 2026) and Load more kept', async () => {
    answers.activity_log = () => ({
      from: '2026-10-15', to: '2026-10-22', count: 2, total: 3, next: '2',
      entries: [
        { id: 1, at: '2026-10-22 09:00', person: 'Sahan', channel: 'Website or app', action: 'Approved a request', outcome: 'done' },
        { id: 2, at: '2026-10-22 09:05', person: 'Sahan', channel: 'Website or app', action: 'Cancelled a task', outcome: 'refused' },
      ],
    });
    renderRouter(routes(), { initialUrl: '/office/people/activity' });
    await screen.findByText('Approved a request');
    expect(screen.getAllByText(t('office.activity.title'))).toHaveLength(1);
    expect(screen.getByText(t('office.lists2.activity.section').toUpperCase())).toBeTruthy();
    // A done row says nothing more; a refused one keeps its chip.
    expect(screen.queryByText(t('office.activity.done'))).toBeNull();
    expect(screen.getByText(t('office.activity.refused'))).toBeTruthy();
    expect(screen.getByText(t('patterns.loadMore'))).toBeTruthy();
  });
});
