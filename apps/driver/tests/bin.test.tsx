// Round 52 (docs/phase8-plan.md §40): Office mode's archive, delete and Recently deleted through the router, with the fake
// office API (tests/fakeOffice.tsx) recording every call:
//   - a driver: Archive asks first (Alert), trips from today on are listed (each opens its task), "Archive anyway" sends
//     confirm true; Delete permanently refused for history shows the words and no button; type-to-confirm enables Delete
//     only when the name matches; then delete_record, the snackbar and back to the list;
//   - an office user: the account guard's sentence and no button;
//   - a vehicle: Archive with the trips step (set_vehicle_active), the plate typed loosely (spaces, dashes, case);
//   - a place: Delete permanently with one confirm; the Archive words on Remove;
//   - wrong entries: the task's "Delete…" shows the preview's label and what goes with it, needs a reason, then delete_entry;
//     the request's and the issue's "Delete…";
//   - Recently deleted: the rows in words, Restore (the snackbar, the row leaves), a refusal in the server's words;
//   - Projects (Show archived sends archived true; Archive; a project with history: no Delete) and Rental companies (Delete
//     only for a company with no vehicle);
//   - More: the three rows for an admin.
/* eslint-disable @typescript-eslint/no-require-imports */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { Stack } from 'expo-router';
import { Alert, Text } from 'react-native';

import { answers, calls, failOnConsoleError, FIX, resetFake } from './fakeOffice';

jest.mock('@/office/client', () => ({ officeApi: require('./fakeOffice').mockOfficeApi }));
jest.mock('@/state/app', () => ({ useApp: () => require('./fakeOffice').mockUseApp() }));
jest.mock('@/office/store', () => ({ useOfficeMe: () => require('./fakeOffice').FIX('me'), getOfficeMe: () => require('./fakeOffice').FIX('me'), setOfficeMe: () => undefined }));

/* eslint-disable import/first */
import MoreTab from '@/app/office/(tabs)/more';
import IssueScreen from '@/app/office/issues/[id]';
import ManageDriver from '@/app/office/people/driver/[username]';
import ManageOfficeUser from '@/app/office/people/user/[email]';
import PlaceScreen from '@/app/office/places/[id]';
import ProjectsScreen from '@/app/office/projects';
import RecentlyDeletedScreen from '@/app/office/recently-deleted';
import RentalCompaniesScreen from '@/app/office/rental-companies';
import ApproveRequest from '@/app/office/request/[id]';
import TaskDetailScreen from '@/app/office/task/[id]';
import VehicleScreen from '@/app/office/vehicles/[reg]';
import { hideSnackbar, SnackbarHost } from '@/components/patterns/Snackbar';
import { dateWords } from '@/lib/dateWords';
import { OfficeProvider } from '@/office/state';
import type { Me } from '@/office/types';

const t = (key: string, vars?: Record<string, string | number>): string => require('./fakeOffice').mockUseApp().t(key, vars);
const argsOf = (tool: string) => calls.filter((c) => c.tool === tool).map((c) => c.args);
const NEW_TOOLS = ['set_vehicle_active', 'set_project_archived', 'set_rental_company_archived', 'list_projects', 'list_rental_companies', 'delete_entry', 'can_delete', 'delete_record', 'list_bin', 'restore_bin_item'];
const ME: Me = { ...FIX('me'), tools: [...FIX('me').tools, ...NEW_TOOLS] };

type Screens = Record<string, () => React.ReactElement | null>;
function routes(screens: Screens, me: Me = ME) {
  return {
    _layout: () => (
      <OfficeProvider me={me}>
        <Stack screenOptions={{ headerShown: false }} />
        <SnackbarHost />
      </OfficeProvider>
    ),
    'office/people/drivers': () => <Text>drivers list</Text>,
    'office/people/users': () => <Text>users list</Text>,
    'office/vehicles/index': () => <Text>vehicles list</Text>,
    'office/places/index': () => <Text>places list</Text>,
    'office/issues/index': () => <Text>issues list</Text>,
    'office/index': () => <Text>office home</Text>,
    'office/task/[id]': () => <Text>task page</Text>,
    'office/driver/[username]': () => null,
    'office/(tabs)/drivers': () => null,
    'office/vehicles/form': () => null,
    'office/vehicles/doc': () => null,
    ...screens,
  };
}

/** Alert.alert presses its last button (the confirm) at once, as the person would. */
let alert: jest.SpyInstance;
let errors: ReturnType<typeof failOnConsoleError>;
beforeEach(() => {
  resetFake();
  act(() => hideSnackbar());
  alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _body, buttons) => { buttons?.at(-1)?.onPress?.(); });
  errors = failOnConsoleError();
});
afterEach(() => {
  alert.mockRestore();
  errors.restore();
  expect(errors.seen.map((a) => String(a[0]))).toEqual([]);
});

const UNTIL = '2026-11-29';
const deletedSnack = () => t('office.bin.deletedSnack', { date: dateWords(t, UNTIL) });

// ---- A driver -------------------------------------------------------------------------------------------------------

function driverAnswers(can: Record<string, unknown>) {
  answers.driver_profile = () => ({ driver: { name: 'Kamal Perera', code: 'D-014', username: 'kamal', active: true, language: 'en' }, this_month: { month: '2026-10', tasks: 0, km: 0 }, not_available: [], missing: [] });
  answers.list_drivers = () => ({ drivers: [{ username: 'kamal', name: 'Kamal Perera', code: 'D-014', active: true }], total: 1 });
  answers.list_vehicles = () => ({ vehicles: [], counts: {} });
  answers.can_delete = () => ({ kind: 'driver', id: 'e1', label: 'Kamal Perera', ...can });
}

describe('Round 52: a driver', () => {
  it('Archive asks first, then lists the trips from today on; a trip opens its task; Archive anyway sends confirm true', async () => {
    driverAnswers({ deletable: false, history: { tasks: 3, fuel: 2 }, history_words: '3 tasks, 2 fills' });
    answers.set_driver_active = (args) => (args.confirm
      ? { active: false }
      : { needs_confirm: true, driver: 'Kamal Perera', username: 'kamal', trips: [{ task_id: 't-1', title: 'Team drop · Kandy', when: '2026-10-31 08:00' }], note: 'x' });
    renderRouter(routes({ 'office/people/driver/[username]': ManageDriver }), { initialUrl: '/office/people/driver/kamal' });
    fireEvent.press(await screen.findByText(t('office.people.switchOff', { name: 'Kamal' })));
    expect(alert.mock.calls[0][0]).toBe(t('office.people.switchOffTitle', { name: 'Kamal' }));
    expect(String(alert.mock.calls[0][1])).toContain('switched off');
    const sheet = await screen.findByTestId('archive-trips-sheet');
    expect(argsOf('set_driver_active')).toEqual([{ username: 'kamal', active: false }]);
    expect(within(sheet).getByText('Team drop · Kandy')).toBeTruthy();
    expect(within(sheet).getByText(t('office.bin.tripsBodyOne'))).toBeTruthy();
    fireEvent.press(within(sheet).getByTestId('archive-anyway'));
    await waitFor(() => expect(argsOf('set_driver_active').at(-1)).toEqual({ username: 'kamal', active: false, confirm: true }));
    expect(await screen.findByText(t('office.people.switchedOff', { name: 'Kamal' }))).toBeTruthy();
  });

  it('a trip in the list opens its task', async () => {
    driverAnswers({ deletable: false, history: { tasks: 1 } });
    answers.set_driver_active = () => ({ needs_confirm: true, trips: [{ task_id: 't-1', title: 'Team drop · Kandy', when: '2026-10-31 08:00' }], note: 'x' });
    renderRouter(routes({ 'office/people/driver/[username]': ManageDriver }), { initialUrl: '/office/people/driver/kamal' });
    fireEvent.press(await screen.findByText(t('office.people.switchOff', { name: 'Kamal' })));
    fireEvent.press(await screen.findByTestId('archive-trip'));
    expect(await screen.findByText('task page')).toBeTruthy();
  });

  it('a delete refused for history: the words "Has history (…): archive instead" and no Delete button', async () => {
    driverAnswers({ deletable: false, history: { tasks: 3, fuel: 2 }, history_words: '3 tasks, 2 fills' });
    renderRouter(routes({ 'office/people/driver/[username]': ManageDriver }), { initialUrl: '/office/people/driver/kamal' });
    expect(await screen.findByText(t('office.bin.hasHistory', { words: '3 tasks, 2 fills' }))).toBeTruthy();
    expect(argsOf('can_delete')).toEqual([{ kind: 'driver', ref: 'kamal' }]);
    expect(screen.queryByTestId('delete-forever')).toBeNull();
  });

  it('type-to-confirm: Delete only once the name is typed (case and spaces do not matter); then the snackbar and back to the list', async () => {
    driverAnswers({ deletable: true, confirm_with: 'Kamal Perera' });
    answers.delete_record = () => ({ deleted: 'Kamal Perera', kind: 'driver', bin_id: 'b1', until: UNTIL });
    renderRouter(routes({ 'office/people/driver/[username]': ManageDriver }), { initialUrl: '/office/people/driver/kamal' });
    fireEvent.press(await screen.findByTestId('delete-forever'));
    const sheet = await screen.findByTestId('delete-record-sheet');
    expect(within(sheet).getByText(t('office.bin.typeName', { text: 'Kamal Perera' }))).toBeTruthy();
    fireEvent.press(within(sheet).getByTestId('delete-record-confirm'));
    fireEvent.changeText(within(sheet).getByTestId('delete-type'), 'Kamal');
    fireEvent.press(within(sheet).getByTestId('delete-record-confirm'));
    expect(argsOf('delete_record')).toEqual([]);
    fireEvent.changeText(within(sheet).getByTestId('delete-type'), '  kamal   perera ');
    fireEvent.press(within(sheet).getByTestId('delete-record-confirm'));
    await waitFor(() => expect(argsOf('delete_record')).toEqual([{ kind: 'driver', ref: 'kamal', confirm_text: 'kamal   perera' }]));
    expect(await screen.findByText('drivers list')).toBeTruthy();
    expect(screen.getByText(deletedSnack())).toBeTruthy();
  });

  it('without the users permission: no can_delete, no Delete', async () => {
    driverAnswers({ deletable: true });
    const coordinator: Me = { ...ME, tools: ME.tools.filter((x) => !['can_delete', 'delete_record', 'list_bin', 'restore_bin_item'].includes(x)) };
    renderRouter(routes({ 'office/people/driver/[username]': ManageDriver }, coordinator), { initialUrl: '/office/people/driver/kamal' });
    await screen.findByText(t('office.people.switchOff', { name: 'Kamal' }));
    expect(argsOf('can_delete')).toEqual([]);
    expect(screen.queryByTestId('record-delete')).toBeNull();
  });
});

// ---- An office user ------------------------------------------------------------------------------------------------

describe('Round 52: an office user', () => {
  it("the account guard's sentence instead of Delete; Archive this account", async () => {
    answers.list_office_users = () => ({ users: [{ name: 'Dilini Silva', email: 'dilini@fame.lk', role: 'office', permissions: ['view', 'request'], active: true }], total: 1 });
    answers.can_delete = () => ({ kind: 'office_person', id: 'e2', label: 'Dilini Silva', deletable: false, problem: 'You cannot delete your own account. Ask another admin.' });
    renderRouter(routes({ 'office/people/user/[email]': ManageOfficeUser }), { initialUrl: '/office/people/user/dilini%40fame.lk' });
    expect(await screen.findByText('You cannot delete your own account. Ask another admin.')).toBeTruthy();
    expect(screen.queryByTestId('delete-forever')).toBeNull();
    expect(screen.getByText(t('office.people.switchOffUser'))).toBeTruthy();
    expect(argsOf('can_delete')).toEqual([{ kind: 'office_person', ref: 'dilini@fame.lk' }]);
  });
});

// ---- A vehicle -----------------------------------------------------------------------------------------------------

const VEHICLE = { reg_no: 'WP CAB-4521', make_model: 'Toyota HiAce', type: 'van', seats: 14, status: 'Available', active: true, documents: {} };

describe('Round 52: a vehicle', () => {
  beforeEach(() => {
    answers.list_vehicles = (args) => ({ filter: args.filter, counts: {}, total: 1, vehicles: args.filter === 'all' ? [VEHICLE] : [] });
    answers.vehicle_documents = (args) => ({ vehicle: args.vehicle, documents: [] });
  });

  it('Archive: the trips first, Archive anyway sends confirm true (set_vehicle_active)', async () => {
    answers.can_delete = () => ({ kind: 'vehicle', id: 'v1', label: 'WP CAB-4521', deletable: false, history: { tasks: 12 } });
    answers.set_vehicle_active = (args) => (args.confirm ? { vehicle: 'WP CAB-4521', active: false } : { needs_confirm: true, vehicle: 'WP CAB-4521', trips: [{ task_id: 't-2', title: 'Site visit', when: '2026-11-02 09:00' }, { task_id: 't-3', title: 'Team drop', when: '2026-11-03 07:30' }], note: 'x' });
    renderRouter(routes({ 'office/vehicles/[reg]': VehicleScreen }), { initialUrl: '/office/vehicles/WP CAB-4521' });
    fireEvent.press(await screen.findByTestId('vehicle-archive-button'));
    const sheet = await screen.findByTestId('archive-trips-sheet');
    expect(within(sheet).getByText(t('office.bin.tripsBody', { n: 2 }))).toBeTruthy();
    expect(argsOf('set_vehicle_active')).toEqual([{ reg_no: 'WP CAB-4521', active: false }]);
    fireEvent.press(within(sheet).getByTestId('archive-anyway'));
    await waitFor(() => expect(argsOf('set_vehicle_active').at(-1)).toEqual({ reg_no: 'WP CAB-4521', active: false, confirm: true }));
    expect(await screen.findByText(t('office.vehicles.archivedDone', { plate: 'WP CAB-4521' }))).toBeTruthy();
    expect(screen.getByText(t('office.bin.hasHistory', { words: t('office.bin.h.tasks', { n: 12 }) }))).toBeTruthy();
  });

  it('Delete permanently: the plate typed without its dash and in small letters is enough', async () => {
    answers.can_delete = () => ({ kind: 'vehicle', id: 'v1', label: 'WP CAB-4521', deletable: true, confirm_with: 'WP CAB-4521' });
    answers.delete_record = () => ({ deleted: 'WP CAB-4521', kind: 'vehicle', bin_id: 'b2', until: UNTIL });
    renderRouter(routes({ 'office/vehicles/[reg]': VehicleScreen }), { initialUrl: '/office/vehicles/WP CAB-4521' });
    fireEvent.press(await screen.findByTestId('delete-forever'));
    const sheet = await screen.findByTestId('delete-record-sheet');
    expect(within(sheet).getByText(t('office.bin.typePlate', { text: 'WP CAB-4521' }))).toBeTruthy();
    fireEvent.changeText(within(sheet).getByTestId('delete-type'), 'wp cab 452');
    fireEvent.press(within(sheet).getByTestId('delete-record-confirm'));
    expect(argsOf('delete_record')).toEqual([]);
    fireEvent.changeText(within(sheet).getByTestId('delete-type'), 'wpcab4521');
    fireEvent.press(within(sheet).getByTestId('delete-record-confirm'));
    await waitFor(() => expect(argsOf('delete_record')).toEqual([{ kind: 'vehicle', ref: 'WP CAB-4521', confirm_text: 'wpcab4521' }]));
    expect(await screen.findByText('vehicles list')).toBeTruthy();
  });

  it('an archived vehicle: Restore, no trips step', async () => {
    answers.list_vehicles = (args) => ({ filter: args.filter, counts: {}, total: 1, vehicles: args.filter === 'all' ? [{ ...VEHICLE, active: false }] : [] });
    answers.set_vehicle_active = () => ({ vehicle: 'WP CAB-4521', active: true });
    renderRouter(routes({ 'office/vehicles/[reg]': VehicleScreen }), { initialUrl: '/office/vehicles/WP CAB-4521' });
    fireEvent.press(await screen.findByText(t('office.vehicles.restore')));
    await waitFor(() => expect(argsOf('set_vehicle_active')).toEqual([{ reg_no: 'WP CAB-4521', active: true }]));
    expect(await screen.findByText(t('office.vehicles.restoredDone', { plate: 'WP CAB-4521' }))).toBeTruthy();
  });
});

// ---- A place -------------------------------------------------------------------------------------------------------

describe('Round 52: a place', () => {
  it('Archive this place (the Remove of before, same tool); Delete permanently with one confirm', async () => {
    answers.place_detail = () => ({ place: { id: 'p1', name: 'Old depot', badge: 'ours', active: true }, stops_90_days: 0 });
    answers.can_delete = () => ({ kind: 'place', id: 'p1', label: 'Old depot', deletable: true });
    answers.delete_record = () => ({ deleted: 'Old depot', kind: 'place', bin_id: 'b3', until: UNTIL });
    renderRouter(routes({ 'office/places/[id]': PlaceScreen }), { initialUrl: '/office/places/p1' });
    expect(await screen.findByText(t('office.places.remove'))).toBeTruthy();
    expect(t('office.places.remove')).toBe('Archive this place');
    fireEvent.press(await screen.findByTestId('delete-forever'));
    const sheet = await screen.findByTestId('delete-record-sheet');
    expect(within(sheet).queryByTestId('delete-type')).toBeNull();
    fireEvent.press(within(sheet).getByTestId('delete-record-confirm'));
    await waitFor(() => expect(argsOf('delete_record')).toEqual([{ kind: 'place', ref: 'p1' }]));
    expect(await screen.findByText('places list')).toBeTruthy();
    expect(screen.getByText(deletedSnack())).toBeTruthy();
  });
});

// ---- Wrong entries -------------------------------------------------------------------------------------------------

describe('Round 52: wrong entries (delete_entry)', () => {
  const PREVIEW = { label: 'Task · Team drop · Kandy · 2026-10-31 08:00', affects: ['its 2 stops', 'its fills and odometer readings stay, unlinked', 'its km leave the mileage'] };

  it("the task's Delete…: the preview's label and what goes with it, a reason needed, then delete_entry and back", async () => {
    const task = FIX('task_detail');
    answers.delete_entry = (args) => (args.preview ? { kind: 'task', id: args.id, ...PREVIEW } : { deleted: PREVIEW.label, kind: 'task', bin_id: 'b4', until: UNTIL, affects: PREVIEW.affects });
    renderRouter(routes({ 'office/task/[id]': TaskDetailScreen }), { initialUrl: `/office/task/${task.task.id}` });
    fireEvent.press(await screen.findByTestId('delete-task'));
    const sheet = await screen.findByTestId('delete-entry-sheet');
    expect(await within(sheet).findByText(PREVIEW.label)).toBeTruthy();
    expect(argsOf('delete_entry')).toEqual([{ kind: 'task', id: task.task.id, preview: true }]);
    for (const a of PREVIEW.affects) expect(within(sheet).getByText(`• ${a}`)).toBeTruthy();
    // No reason, then a too-short one: nothing deleted.
    fireEvent.press(within(sheet).getByTestId('delete-entry-confirm'));
    fireEvent.changeText(within(sheet).getByTestId('delete-reason'), 'ab');
    fireEvent.press(within(sheet).getByTestId('delete-entry-confirm'));
    expect(argsOf('delete_entry')).toHaveLength(1);
    expect(within(sheet).getByText(t('office.bin.reasonNeeded'))).toBeTruthy();
    fireEvent.changeText(within(sheet).getByTestId('delete-reason'), 'entered twice');
    fireEvent.press(within(sheet).getByTestId('delete-entry-confirm'));
    await waitFor(() => expect(argsOf('delete_entry').at(-1)).toEqual({ kind: 'task', id: task.task.id, reason: 'entered twice' }));
    expect(await screen.findByText('office home')).toBeTruthy();
    expect(screen.getByText(deletedSnack())).toBeTruthy();
  });

  it("a fill and a vehicle check on the task page have their own Delete…; a task under way has none", async () => {
    const base = FIX('task_detail');
    answers.task_detail = () => ({ ...base, task: { ...base.task, status: 'in_progress', vehicle_checks: [{ id: 'c1', date: '2026-10-30', at: '07:40', when: '07:40', employee_id: 'e1', result: 'ok', result_text: 'All fine', how: 'clock_in' }] }, fuel: [{ id: 'f1', litres: 20, amount_lkr: 7000, at: '2026-10-30 10:00' }], odometer: [{ id: 'o1', kind: 'task_start', reading_km: 45210, at: '2026-10-30 07:45' }] });
    answers.delete_entry = (args) => ({ kind: args.kind, id: args.id, label: `Fill · ${args.id}`, affects: ['its receipt photo'] });
    renderRouter(routes({ 'office/task/[id]': TaskDetailScreen }), { initialUrl: `/office/task/${base.task.id}` });
    await screen.findByTestId('task-banner');
    expect(screen.queryByTestId('delete-task')).toBeNull();
    expect(screen.getByTestId('delete-check')).toBeTruthy();
    fireEvent.press(screen.getByText(t('office.common.moreDetails')));
    fireEvent.press(await screen.findByTestId('delete-fill'));
    await waitFor(() => expect(argsOf('delete_entry')).toEqual([{ kind: 'fuel', id: 'f1', preview: true }]));
    expect(await screen.findByText('• its receipt photo')).toBeTruthy();
    fireEvent.press(within(screen.getByTestId('delete-entry-sheet')).getByText(t('office.common.cancel')));
    // Each odometer reading it lists has its own Delete… too (task_detail.odometer[].id).
    fireEvent.press(screen.getByTestId('delete-odometer'));
    await waitFor(() => expect(argsOf('delete_entry').at(-1)).toEqual({ kind: 'odometer', id: 'o1', preview: true }));
  });

  it('an odometer reading without an id (an older server): no Delete… on it', async () => {
    const base = FIX('task_detail');
    answers.task_detail = () => ({ ...base, odometer: [{ kind: 'task_start', reading_km: 45210, at: '2026-10-30 07:45' }] });
    renderRouter(routes({ 'office/task/[id]': TaskDetailScreen }), { initialUrl: `/office/task/${base.task.id}` });
    await screen.findByTestId('task-banner');
    fireEvent.press(screen.getByText(t('office.common.moreDetails')));
    await screen.findByTestId('odometer-row');
    expect(screen.queryByTestId('delete-odometer')).toBeNull();
  });

  it("the request's and the issue's Delete…", async () => {
    const card = FIX('list_requests_one').requests[0];
    answers.delete_entry = (args) => ({ kind: args.kind, id: args.id, label: 'Request · Dilini', affects: ['its task Team drop and that task\'s stops'] });
    const r = renderRouter(routes({ 'office/request/[id]': ApproveRequest }), { initialUrl: `/office/request/${card.id}` });
    fireEvent.press(await screen.findByTestId('delete-request'));
    await waitFor(() => expect(argsOf('delete_entry')).toEqual([{ kind: 'request', id: card.id, preview: true }]));
    expect(await screen.findByText("• its task Team drop and that task's stops")).toBeTruthy();
    r.unmount();

    answers.issue_history = () => ({ issue: { id: 'i1', kind: 'odometer_flag', severity: 'warning', title: 'Odometer typed by hand', status: 'open', opened: '2026-10-30 08:00', updated: '2026-10-30 08:00' }, events: [] });
    renderRouter(routes({ 'office/issues/[id]': IssueScreen }), { initialUrl: '/office/issues/i1' });
    fireEvent.press(await screen.findByTestId('delete-issue'));
    await waitFor(() => expect(argsOf('delete_entry').at(-1)).toEqual({ kind: 'issue', id: 'i1', preview: true }));
  });

  it('without approve (no delete_entry): no Delete…', async () => {
    const task = FIX('task_detail');
    const noApprove: Me = { ...ME, tools: ME.tools.filter((x) => x !== 'delete_entry') };
    renderRouter(routes({ 'office/task/[id]': TaskDetailScreen }, noApprove), { initialUrl: `/office/task/${task.task.id}` });
    await screen.findByTestId('task-banner');
    expect(screen.queryByTestId('delete-task')).toBeNull();
  });
});

// ---- Recently deleted ----------------------------------------------------------------------------------------------

const BIN = [
  { id: 'b1', kind: 'vehicle', record_id: 'v1', label: 'WP CAB-4521', detail: 'Toyota HiAce', deleted_by: 'Sahan', deleted_at: '2026-10-30 14:05', until: '2026-11-29', days_left: 30 },
  { id: 'b2', kind: 'fuel', record_id: 'f1', label: 'Fill · WP KL-1234 · 20 L', reason: 'entered twice', deleted_by: 'Palitha', deleted_at: '2026-10-29 09:00', until: '2026-11-28', days_left: 1 },
];

describe('Round 52: Recently deleted', () => {
  it('the rows in words; Restore asks nothing (the snackbar, the row leaves); a refusal shows the server\'s sentence', async () => {
    answers.list_bin = () => ({ items: BIN, total: 2 });
    answers.restore_bin_item = (args) => {
      if (args.id === 'b1') throw { code: 'tool_error', message: 'Something with the same name, plate or username exists now. Rename or archive it first, then restore this.' };
      return { restored: 'Fill · WP KL-1234 · 20 L', kind: 'fuel', record_id: 'f1' };
    };
    renderRouter(routes({ 'office/recently-deleted': RecentlyDeletedScreen }), { initialUrl: '/office/recently-deleted' });
    expect(await screen.findByText('WP CAB-4521')).toBeTruthy();
    expect(argsOf('list_bin')[0]).toEqual({ limit: 25 });
    expect(screen.getByText(`Toyota HiAce · ${t('office.bin.deletedBy', { name: 'Sahan', at: dateWords(t, '2026-10-30 14:05') })}`)).toBeTruthy();
    expect(screen.getByText(t('office.bin.reason', { reason: 'entered twice' }))).toBeTruthy();
    expect(screen.getByText(t('office.bin.until', { date: dateWords(t, '2026-11-29'), n: 30 }))).toBeTruthy();
    expect(screen.getByText(t('office.bin.untilOne', { date: dateWords(t, '2026-11-28') }))).toBeTruthy();
    expect(screen.getByText(t('office.bin.kind_vehicle'))).toBeTruthy();
    const rows = screen.getAllByTestId('bin-row');
    fireEvent.press(within(rows[0]).getByTestId('bin-restore'));
    expect(await screen.findByText(/Rename or archive it first/)).toBeTruthy();
    expect(alert).not.toHaveBeenCalled();
    fireEvent.press(within(rows[1]).getByTestId('bin-restore'));
    expect(await screen.findByText(t('office.bin.restored', { label: 'Fill · WP KL-1234 · 20 L' }))).toBeTruthy();
    await waitFor(() => expect(screen.getAllByTestId('bin-row')).toHaveLength(1));
    expect(argsOf('restore_bin_item')).toEqual([{ id: 'b1' }, { id: 'b2' }]);
  });

  it('the search goes to list_bin; nothing found says so', async () => {
    answers.list_bin = (args) => ({ items: args.search ? [] : BIN, total: args.search ? 0 : 2 });
    renderRouter(routes({ 'office/recently-deleted': RecentlyDeletedScreen }), { initialUrl: '/office/recently-deleted' });
    await screen.findByText('WP CAB-4521');
    fireEvent.changeText(screen.getByPlaceholderText(t('office.bin.search')), 'kandy');
    expect(await screen.findByText(t('office.bin.emptySearch', { search: 'kandy' }), {}, { timeout: 3000 })).toBeTruthy();
    expect(argsOf('list_bin').at(-1)).toEqual({ limit: 25, search: 'kandy' });
  });
});

// ---- Projects and rental companies ---------------------------------------------------------------------------------

describe('Round 52: Projects', () => {
  it('Show archived asks for the archived ones; Archive (asks first) and a project with history has no Delete', async () => {
    answers.list_projects = (args) => ({ projects: args.archived ? [{ id: 'p9', name: 'Old tower', short_name: 'OLD1', archived: '2026-10-01 by Sahan', archived_on: '2026-10-01', archived_by: 'Sahan' }] : [{ id: 'p1', name: 'Kandy towers', short_name: 'TRKAN1', job_no: '13021', customer: 'Mobitel' }], total: 1 });
    answers.set_project_archived = () => ({ project: 'Kandy towers', archived: true });
    answers.can_delete = () => ({ kind: 'project', id: 'p1', label: 'Kandy towers', deletable: false, history: { tasks: 4 } });
    renderRouter(routes({ 'office/projects': ProjectsScreen }), { initialUrl: '/office/projects' });
    fireEvent.press(await screen.findByText('TRKAN1 · Kandy towers'));
    const actions = await screen.findByTestId('project-actions');
    fireEvent.press(within(actions).getByTestId('project-archive'));
    await waitFor(() => expect(argsOf('set_project_archived')).toEqual([{ project: 'p1', archived: true }]));
    expect(await screen.findByText(t('office.bin.archivedDone', { name: 'TRKAN1 · Kandy towers' }))).toBeTruthy();
    // Delete permanently: can_delete in the sheet; history = the words, no Delete button.
    fireEvent.press(screen.getByText('TRKAN1 · Kandy towers'));
    fireEvent.press(within(await screen.findByTestId('project-actions')).getByTestId('project-delete'));
    const sheet = await screen.findByTestId('delete-record-sheet');
    expect(await within(sheet).findByText(t('office.bin.hasHistory', { words: t('office.bin.h.tasks', { n: 4 }) }))).toBeTruthy();
    expect(within(sheet).queryByTestId('delete-record-confirm')).toBeNull();
    fireEvent.press(within(sheet).getByText(t('office.common.cancel')));
    // Show archived.
    fireEvent.press(screen.getByTestId('filter-button'));
    fireEvent.press(within(screen.getByTestId('filter-sheet')).getByText(t('office.bin.showArchived')));
    fireEvent.press(within(screen.getByTestId('filter-sheet')).getByText(t('patterns.apply')));
    expect(await screen.findByText('OLD1 · Old tower')).toBeTruthy();
    expect(argsOf('list_projects').at(-1)).toEqual({ limit: 25, archived: true });
    // The archive in the app's own words (the date in words, Latin digits), never the server's English sentence.
    expect(screen.getByText(t('office.bin.archivedOnBy', { date: dateWords(t, '2026-10-01'), name: 'Sahan' }))).toBeTruthy();
    expect(screen.queryByText('2026-10-01 by Sahan')).toBeNull();
  });

  it('someone with view only: rows, no actions', async () => {
    answers.list_projects = () => ({ projects: [{ id: 'p1', name: 'Kandy towers' }], total: 1 });
    const viewer: Me = { ...ME, permissions: ['view'], tools: ['list_projects', 'get_settings', 'my_inbox'] };
    renderRouter(routes({ 'office/projects': ProjectsScreen }, viewer), { initialUrl: '/office/projects' });
    fireEvent.press(await screen.findByText('Kandy towers'));
    expect(screen.queryByTestId('project-actions')).toBeNull();
  });
});

describe('Round 52: Rental companies', () => {
  it('the vehicles count; Delete permanently only for a company with no vehicle; one confirm', async () => {
    answers.list_rental_companies = () => ({ companies: [{ id: 'r1', name: 'Malkey', phone: '+94112345678', vehicles: 3 }, { id: 'r2', name: 'Casons', vehicles: 0, archived: '2026-09-15 by Palitha', archived_on: '2026-09-15', archived_by: 'Palitha' }] });
    answers.can_delete = () => ({ kind: 'rental_company', id: 'r2', label: 'Casons', deletable: true });
    answers.delete_record = () => ({ deleted: 'Casons', kind: 'rental_company', bin_id: 'b5', until: UNTIL });
    renderRouter(routes({ 'office/rental-companies': RentalCompaniesScreen }), { initialUrl: '/office/rental-companies' });
    expect(await screen.findByText(`+94112345678 · ${t('office.rentals.vehicles', { n: 3 })}`)).toBeTruthy();
    expect(screen.getByText(t('office.bin.archivedOnBy', { date: dateWords(t, '2026-09-15'), name: 'Palitha' }))).toBeTruthy();
    expect(screen.queryByText('2026-09-15 by Palitha', { exact: false })).toBeNull();
    fireEvent.press(screen.getByText('Malkey'));
    let actions = await screen.findByTestId('company-actions');
    expect(within(actions).queryByTestId('company-delete')).toBeNull();
    expect(within(actions).getByTestId('company-archive')).toBeTruthy();
    fireEvent.press(within(actions).getByLabelText(t('patterns.close')));
    fireEvent.press(screen.getByText('Casons'));
    actions = await screen.findByTestId('company-actions');
    fireEvent.press(within(actions).getByTestId('company-delete'));
    const sheet = await screen.findByTestId('delete-record-sheet');
    fireEvent.press(await within(sheet).findByTestId('delete-record-confirm'));
    await waitFor(() => expect(argsOf('delete_record')).toEqual([{ kind: 'rental_company', ref: 'r2' }]));
    expect(await screen.findByText(deletedSnack())).toBeTruthy();
  });
});

// ---- More ----------------------------------------------------------------------------------------------------------

describe('Round 52: More', () => {
  it('an admin sees Projects, Rental companies and Recently deleted; each opens its screen', async () => {
    answers.list_bin = () => ({ items: [], total: 0 });
    renderRouter(routes({ 'office/(tabs)/more': MoreTab, 'office/recently-deleted': RecentlyDeletedScreen, 'office/projects': () => <Text>projects</Text>, 'office/rental-companies': () => <Text>rentals</Text>, 'office/profile': () => null }), { initialUrl: '/office/more' });
    expect(await screen.findByText(t('office.projects.title'))).toBeTruthy();
    expect(screen.getByText(t('office.rentals.title'))).toBeTruthy();
    fireEvent.press(screen.getByText(t('office.bin.title')));
    expect(await screen.findByText(t('office.bin.empty'))).toBeTruthy();
  });

  it('without the users permission: no Recently deleted', async () => {
    const noUsers: Me = { ...ME, permissions: ME.permissions.filter((p) => p !== 'users'), tools: ME.tools.filter((x) => x !== 'list_bin') };
    renderRouter(routes({ 'office/(tabs)/more': MoreTab, 'office/profile': () => null }, noUsers), { initialUrl: '/office/more' });
    await screen.findByText(t('office.projects.title'));
    expect(screen.queryByText(t('office.bin.title'))).toBeNull();
  });
});
