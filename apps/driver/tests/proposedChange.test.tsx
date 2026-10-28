// Round 48 (item 1): a change to a task proposed by someone without approve, run through the router with the real
// answers. Give it a driver with a waiting answer goes back and says the task is unchanged (nothing flashed); the request
// page for a kind change is the change's own screen: an approver approves (decide_request with the version) or declines
// with a reason, the proposer reads "the fleet admin will decide" and may withdraw (cancel_request); the board's card
// says "Change waiting for approval · …" in words only and opens the request.
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { act } from 'react';
import { Text } from 'react-native';

import { answers, calls, failOnConsoleError, FIX, mockUseApp, resetFake } from './fakeOffice';
import { colomboDate } from '@/lib/time';

jest.mock('@/office/client', () => ({ officeApi: require('./fakeOffice').mockOfficeApi }));
jest.mock('@/state/app', () => ({ useApp: () => require('./fakeOffice').mockUseApp() }));
jest.mock('@/office/store', () => ({ useOfficeMe: () => require('./fakeOffice').FIX('me'), getOfficeMe: () => require('./fakeOffice').FIX('me'), setOfficeMe: () => undefined }));

/* eslint-disable import/first */
import ApproveRequest from '@/app/office/request/[id]';
import GiveDriver from '@/app/office/task/[id]/driver';
import Tasks from '@/app/office/(tabs)/tasks';
import { SavedNotice } from '@/components/office/SavedNotice';
import { hideSnackbar, shownSnackbar } from '@/components/patterns/Snackbar';
import { OfficeProvider } from '@/office/state';
import type { AvailableDriver, Board, BoardCard, Me as OfficeMe, PendingChange, RequestCard } from '@/office/types';

const ME: OfficeMe = FIX('me');
/** The dispatcher who proposes: assign_tasks without approve. */
const PROPOSER: OfficeMe = { ...ME, name: 'Sashen', permissions: ME.permissions.filter((p) => p !== 'approve'), tools: ME.tools.filter((x) => x !== 'decide_request') };
const t = mockUseApp().t;
const TASK_ID = FIX('task_detail').task.id as string;
const REQUEST_ID = '1b2c3d4e-0000-4000-8000-00000000abcd';

const changes = { driver: { from: 'Nuwan Perera', to: 'Kamal Silva' } };
const changeCard = (over: Partial<RequestCard> = {}): RequestCard => ({
  id: REQUEST_ID, kind: 'change', title: 'Team drop · Galle', requested_by: 'Sashen', when: 'Thu 29 Oct 10:00', status: 'waiting', asked: '10:42', version: 2,
  change: { task_id: TASK_ID, task_title: 'Team drop · Galle', tool: 'reassign_task', summary: 'driver Kamal Silva instead of Nuwan Perera', changes, task_was: 'declined' },
  proposed: { driver: 'Kamal Silva', username: 'kamal' },
  ...over,
} as RequestCard);
const pending: PendingChange = { request_id: REQUEST_ID, by: 'Sashen', at: '10:42', tool: 'reassign_task', summary: 'driver Kamal Silva instead of Nuwan Perera', changes, text: 'Change waiting for approval · Sashen · driver Kamal Silva instead of Nuwan Perera' };

const driverA: AvailableDriver = {
  name: 'Driver A', username: 'fixa', state: 'on_duty', status_text: 'On duty', accepted_today: 0, declined_today: 0,
  licence: { chip: 'ok' }, free: true, vehicle: { reg_no: 'FX 1', source: 'on_duty' }, rank: 1,
};
const availability = () => ({ drivers: [driverA], best: { name: 'Driver A', username: 'fixa' }, vehicles: { drivers_free: [] }, counts: { free: 1 } });

function TaskPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <><Text>{`task page ${id}`}</Text><SavedNotice noticeKey={`task:${id}`} /></>;
}

const routesFor = (me: OfficeMe) => ({
  _layout: () => <OfficeProvider me={me}><Stack screenOptions={{ headerShown: false }} /></OfficeProvider>,
  'office/(tabs)/index': () => <Text>home</Text>,
  'office/(tabs)/tasks': Tasks,
  'office/request/[id]': ApproveRequest,
  'office/task/[id]/index': TaskPage,
  'office/task/[id]/driver': GiveDriver,
});

/** Every text the screen shows (the no-internal-text rule: no key shape, no enum name, no id). */
function shownTexts(): string[] {
  const out: string[] = [];
  const walk = (n: unknown) => {
    if (n == null) return;
    if (typeof n === 'string') { out.push(n); return; }
    if (Array.isArray(n)) { n.forEach(walk); return; }
    (n as { children?: unknown[] }).children?.forEach(walk);
  };
  walk(screen.toJSON());
  return out;
}
const KEY_SHAPE = /\b[a-z][A-Za-z]+(?:\.[A-Za-z_][\w]*){1,}\b/;
const ENUM_SHAPE = /\b[a-z]+_[a-z_]+\b|[0-9a-f]{8}-[0-9a-f]{4}-/;

let errors: ReturnType<typeof failOnConsoleError>;
beforeEach(() => {
  resetFake();
  act(() => hideSnackbar());
  answers.availability = availability;
  errors = failOnConsoleError();
});
afterEach(() => errors.restore());

describe('Give it a driver without approve', () => {
  it('a waiting answer goes back with "the task is unchanged", sends nothing else and flashes nothing', async () => {
    answers.reassign_task = () => ({ waiting_for_approval: true, request_id: REQUEST_ID, task_id: TASK_ID, task_unchanged: true, summary: 'driver Driver A instead of Driver A f902', next: "Waiting for the fleet admin's OK · you'll be notified." });
    const r = renderRouter(routesFor(PROPOSER), { initialUrl: '/office' });
    act(() => router.push(`/office/task/${TASK_ID}`));
    await screen.findByText(`task page ${TASK_ID}`);
    act(() => router.push(`/office/task/${TASK_ID}/driver`));
    await waitFor(() => expect(screen.getAllByText('Driver A').length).toBeGreaterThan(0), { timeout: 5000 });
    fireEvent.press(screen.getAllByText('Driver A')[0]);
    const give = await screen.findByText(t('office.give.giveTo', { name: 'Driver A', plate: 'FX 1' }));
    fireEvent.press(give);
    fireEvent.press(give);
    await waitFor(() => expect(r.getPathname()).toBe(`/office/task/${TASK_ID}`), { timeout: 5000 });
    expect(calls.filter((c) => c.tool === 'reassign_task')).toHaveLength(1);
    expect(calls.map((c) => c.tool)).not.toContain('update_task');
    expect(shownSnackbar()?.text).toBe(t('office.saved.changeWaiting'));
    expect(screen.queryByText(t('office.saved.driverGiven', { name: 'Driver A' }))).toBeNull();
    expect(screen.queryByText(t('office.saved.warningsTitle'))).toBeNull();
    expect(errors.seen.map((a) => String(a[0]))).toEqual([]);
  });
});

describe('Approve a change', () => {
  it('shows the task, who proposes what and each line from → to; Approve sends decide_request with the version, the page stays with Done', async () => {
    answers.list_requests = () => ({ status: 'all', count: 1, total: 1, requests: [changeCard()] });
    answers.decide_request = () => ({ request: changeCard({ status: 'approved', approved_by: { name: 'Fixture Admin', at: '10:50' } }), decision: 'approved', task_id: TASK_ID, applied: { driver: 'Kamal Silva' } });
    const r = renderRouter(routesFor(ME), { initialUrl: '/office' });
    act(() => router.push(`/office/request/${REQUEST_ID}`));
    const approve = await screen.findByTestId('change-approve', {}, { timeout: 5000 });
    expect(screen.getAllByText('Team drop · Galle').length).toBeGreaterThan(0);
    expect(screen.getByTestId('change-line').props.children).toBe(`${t('office.change.wasLine', { label: t('office.change.field_driver'), to: 'Kamal Silva', from: 'Nuwan Perera' })} · ${t('office.change.proposedBy', { name: 'Sashen' })}`);
    expect(screen.getByText('Nuwan Perera → Kamal Silva')).toBeTruthy();
    expect(screen.getByText(`${t('office.change.untouched')} ${t('office.change.needsDriver')}`)).toBeTruthy();
    expect(screen.getByTestId('change-open-task')).toBeTruthy();
    expect(screen.queryByTestId('change-withdraw')).toBeNull();
    const bad = shownTexts().filter((s) => KEY_SHAPE.test(s) || ENUM_SHAPE.test(s));
    expect(bad).toEqual([]);
    fireEvent.press(approve);
    fireEvent.press(approve);
    await waitFor(() => expect(shownSnackbar()?.text).toBe(t('office.change.approvedTitle')), { timeout: 5000 });
    const decided = calls.filter((c) => c.tool === 'decide_request');
    expect(decided).toHaveLength(1);
    expect(decided[0].args).toEqual({ request_id: REQUEST_ID, decision: 'approve', version: 2 });
    expect(r.getPathname()).toBe(`/office/request/${REQUEST_ID}`);
    expect(await screen.findByTestId('change-done')).toBeTruthy();
    expect(screen.queryByTestId('change-approve')).toBeNull();
    expect(shownSnackbar()?.action?.label).toBe(t('office.saved.view'));
    expect(errors.seen.map((a) => String(a[0]))).toEqual([]);
  });

  it('Decline asks its reason in the sheet, sends it with the version and goes back; the task is as it was', async () => {
    answers.list_requests = () => ({ status: 'all', count: 1, total: 1, requests: [changeCard()] });
    answers.decide_request = () => ({ request: changeCard({ status: 'declined' }), decision: 'declined' });
    const r = renderRouter(routesFor(ME), { initialUrl: '/office' });
    act(() => router.push(`/office/request/${REQUEST_ID}`));
    fireEvent.press(await screen.findByTestId('change-decline', {}, { timeout: 5000 }));
    expect(await screen.findByText(t('office.change.declineTitle'))).toBeTruthy();
    fireEvent.press(screen.getByTestId('reason-keep'));
    fireEvent.press(screen.getByText(t('office.change.declineConfirm')));
    await waitFor(() => expect(shownSnackbar()?.text).toBe(t('office.change.declinedTitle')), { timeout: 5000 });
    const decided = calls.filter((c) => c.tool === 'decide_request');
    expect(decided).toHaveLength(1);
    expect(decided[0].args).toEqual({ request_id: REQUEST_ID, decision: 'decline', version: 2, reason: 'Keep the task as it is' });
    await waitFor(() => expect(r.getPathname()).toBe('/office'), { timeout: 5000 });
    expect(errors.seen.map((a) => String(a[0]))).toEqual([]);
  });

  it('a refused decision stays on the change with the reason and reads the card again', async () => {
    answers.list_requests = () => ({ status: 'all', count: 1, total: 1, requests: [changeCard()] });
    answers.decide_request = () => {
      throw { code: 'tool_error', message: 'Already approved by Palitha at 10:42.' };
    };
    const r = renderRouter(routesFor(ME), { initialUrl: '/office' });
    act(() => router.push(`/office/request/${REQUEST_ID}`));
    fireEvent.press(await screen.findByTestId('change-approve', {}, { timeout: 5000 }));
    expect(await screen.findByText(/Already approved by Palitha/)).toBeTruthy();
    expect(r.getPathname()).toBe(`/office/request/${REQUEST_ID}`);
    expect(calls.filter((c) => c.tool === 'list_requests').length).toBeGreaterThan(1);
    expect(errors.seen.map((a) => String(a[0]))).toEqual([]);
  });

  it('the proposer reads that the fleet admin decides, cannot approve, and may withdraw the change', async () => {
    answers.list_requests = () => ({ status: 'all', count: 1, total: 1, requests: [changeCard()] });
    answers.cancel_request = () => ({ note: 'Change withdrawn' });
    renderRouter(routesFor(PROPOSER), { initialUrl: '/office' });
    act(() => router.push(`/office/request/${REQUEST_ID}`));
    expect(await screen.findByTestId('change-will-decide', {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.queryByTestId('change-approve')).toBeNull();
    expect(screen.queryByTestId('change-decline')).toBeNull();
    fireEvent.press(screen.getByTestId('change-withdraw'));
    expect(await screen.findByText(t('office.change.withdrawTitle'))).toBeTruthy();
    fireEvent.press(screen.getByTestId('reason-not_needed'));
    // The bar's Withdraw and the sheet's confirm share the words: the sheet's is the last one drawn.
    fireEvent.press(screen.getAllByText(t('office.change.withdrawConfirm')).at(-1)!);
    await waitFor(() => expect(shownSnackbar()?.text).toBe(t('office.change.withdrawnTitle')), { timeout: 5000 });
    const cancelled = calls.filter((c) => c.tool === 'cancel_request');
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0].args).toEqual({ request_id: REQUEST_ID, reason: 'Not needed any more' });
    expect(errors.seen.map((a) => String(a[0]))).toEqual([]);
  });
});

describe('The board with a pending change', () => {
  it('the card says "Change waiting for approval · …" in words only, and the line opens the request', async () => {
    const card: BoardCard = { id: TASK_ID, time: '09:00', title: 'Team drop · Galle', driver: 'Nuwan Perera', vehicle: 'WP CAB-4521', stops_count: 2, status: 'Declined (Not available)', pending_change: pending } as BoardCard;
    const board: Board = {
      date: colomboDate(new Date()),
      counts: { assigned: 0, in_progress: 0, completed: 0, cancelled: 0, declined: 1 },
      assigned: [], in_progress: [], completed: [], declined: [card],
      needs_driver: [{ task_id: TASK_ID, title: 'Team drop · Galle', start: 'Thu 29 Oct 10:00', line: 'Nuwan Perera declined · Not available', minutes_to_start: 40, when: 'in 40 min', pending_change: pending }],
    } as unknown as Board;
    answers.task_board = () => board;
    answers.list_requests = () => ({ status: 'all', count: 1, total: 1, requests: [changeCard()] });
    const r = renderRouter(routesFor(ME), { initialUrl: '/office/tasks' });
    const line = await screen.findByTestId(`needs-pending-change-${TASK_ID}`, {}, { timeout: 5000 });
    const expected = t('office.change.waitingLine', { name: 'Sashen', summary: t('office.change.wasLine', { label: t('office.change.field_driver'), to: 'Kamal Silva', from: 'Nuwan Perera' }) });
    expect(screen.getAllByText(expected).length).toBeGreaterThan(0);
    const bad = shownTexts().filter((s) => KEY_SHAPE.test(s) || ENUM_SHAPE.test(s));
    expect(bad).toEqual([]);
    fireEvent.press(line);
    await waitFor(() => expect(r.getPathname()).toBe(`/office/request/${REQUEST_ID}`), { timeout: 5000 });
    expect(await screen.findByTestId('change-approve', {}, { timeout: 5000 })).toBeTruthy();
    expect(errors.seen.map((a) => String(a[0]))).toEqual([]);
  });
});
