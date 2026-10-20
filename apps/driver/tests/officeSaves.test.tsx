// Hotfix O2-H2, Part 1b: the Office-mode saves outside the trip editor, run through the router with the real answers.
// After a save: back to where the person came from or on to the item, a snackbar (with View where it helps), the warnings
// waiting on the item, and never a throw (the white screen).
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { act } from 'react';
import { Text } from 'react-native';

import { answers, calls, failOnConsoleError, FIX, mockUseApp, resetFake } from './fakeOffice';

jest.mock('@/office/client', () => ({ officeApi: require('./fakeOffice').mockOfficeApi }));
jest.mock('@/state/app', () => ({ useApp: () => require('./fakeOffice').mockUseApp() }));
jest.mock('@/office/store', () => ({ useOfficeMe: () => require('./fakeOffice').FIX('me'), getOfficeMe: () => require('./fakeOffice').FIX('me'), setOfficeMe: () => undefined }));

/* eslint-disable import/first */
import ApproveRequest from '@/app/office/request/[id]';
import GiveDriver from '@/app/office/task/[id]/driver';
import { SavedNotice } from '@/components/office/SavedNotice';
import { hideSnackbar, shownSnackbar } from '@/components/patterns/Snackbar';
import { OfficeProvider } from '@/office/state';
import type { AvailableDriver, Me as OfficeMe } from '@/office/types';

const ME: OfficeMe = FIX('me');
const t = mockUseApp().t;
const REQUEST_ID = FIX('list_requests_one').requests[0].id as string;
const DECIDED_TASK = FIX('decide_request_approve').task_id as string;
const TASK_ID = FIX('task_detail').task.id as string;

const driverA: AvailableDriver = {
  name: 'Driver A', username: 'fixa', state: 'on_duty', status_text: 'On duty', accepted_today: 0, declined_today: 0,
  licence: { chip: 'ok' }, free: true, vehicle: { reg_no: 'FX 1', source: 'on_duty' }, rank: 1,
};
const availability = () => ({ drivers: [driverA], best: { name: 'Driver A', username: 'fixa' }, vehicles: { drivers_free: [] }, counts: { free: 1 } });

function TaskPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <><Text>{`task page ${id}`}</Text><SavedNotice noticeKey={`task:${id}`} /></>;
}

const routes = {
  _layout: () => <OfficeProvider me={ME}><Stack screenOptions={{ headerShown: false }} /></OfficeProvider>,
  'office/(tabs)/index': () => <Text>home</Text>,
  'office/request/[id]': ApproveRequest,
  'office/task/[id]/index': TaskPage,
  'office/task/[id]/driver': GiveDriver,
};

let errors: ReturnType<typeof failOnConsoleError>;
beforeEach(() => {
  resetFake();
  act(() => hideSnackbar());
  answers.availability = availability;
  errors = failOnConsoleError();
});
afterEach(() => errors.restore());

describe('Approve a request', () => {
  it('approves once, goes back to the queue, and the snackbar\'s View opens the new task with its warnings', async () => {
    answers.decide_request = () => ({ ...FIX('decide_request_approve'), warnings: ['FX 1 is over its monthly km allowance'] });
    const r = renderRouter(routes, { initialUrl: '/office' });
    act(() => router.push(`/office/request/${REQUEST_ID}`));
    const approve = await screen.findByText(t('office.request.approveSend', { name: 'Driver A' }), {}, { timeout: 5000 });
    fireEvent.press(approve);
    fireEvent.press(approve);
    await screen.findByText('home', {}, { timeout: 5000 });
    expect(calls.filter((c) => c.tool === 'decide_request')).toHaveLength(1);
    const snack = shownSnackbar();
    expect(snack?.text).toBe(t('office.request.approvedTitle', { name: 'Driver A' }));
    expect(snack?.action?.label).toBe(t('office.saved.view'));
    act(() => snack!.action!.onPress());
    await screen.findByText(`task page ${DECIDED_TASK}`);
    expect(screen.getByText('FX 1 is over its monthly km allowance')).toBeTruthy();
    expect(errors.seen.map((a) => String(a[0]))).toEqual([]);
  });

  it('a refused approval stays on the request with the reason', async () => {
    answers.decide_request = () => {
      throw { code: 'tool_error', message: 'Already decided by Admin A.' };
    };
    const r = renderRouter(routes, { initialUrl: '/office' });
    act(() => router.push(`/office/request/${REQUEST_ID}`));
    fireEvent.press(await screen.findByText(t('office.request.approveSend', { name: 'Driver A' }), {}, { timeout: 5000 }));
    await screen.findByText(/Already decided by Admin A/);
    expect(r.getPathname()).toBe(`/office/request/${REQUEST_ID}`);
    expect(shownSnackbar()).toBeNull();
    expect(errors.seen.map((a) => String(a[0]))).toEqual([]);
  });
});

describe('Give it a driver', () => {
  it('sends the task, lands on the task under it with "Task sent to <name>" and the warnings', async () => {
    answers.reassign_task = () => ({ ...FIX('reassign_task'), warnings: ['Driver A has another task at 09:00'] });
    const r = renderRouter(routes, { initialUrl: '/office' });
    act(() => router.push(`/office/task/${TASK_ID}`));
    await screen.findByText(`task page ${TASK_ID}`);
    act(() => router.push(`/office/task/${TASK_ID}/driver`));
    await waitFor(() => expect(screen.getAllByText('Driver A').length).toBeGreaterThan(0), { timeout: 5000 });
    fireEvent.press(screen.getAllByText('Driver A')[0]);
    const give = await screen.findByText(t('office.give.giveTo', { name: 'Driver A', plate: 'FX 1' }));
    fireEvent.press(give);
    await waitFor(() => expect(r.getPathname()).toBe(`/office/task/${TASK_ID}`), { timeout: 5000 });
    expect(calls.filter((c) => c.tool === 'reassign_task')).toHaveLength(1);
    expect(shownSnackbar()?.text).toBe(t('office.saved.driverGiven', { name: 'Driver A' }));
    expect(await screen.findByText('Driver A has another task at 09:00')).toBeTruthy();
    expect(errors.seen.map((a) => String(a[0]))).toEqual([]);
  });
});
