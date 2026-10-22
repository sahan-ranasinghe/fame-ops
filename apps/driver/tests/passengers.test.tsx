// Round 4–7, feature 6 (phase8-plan.md §33.3): Who rides on Assign a task, run through the router with the office's
// answers: find_people as typed, a person picked as a chip, someone without an account added in the sheet (a wrong number
// refused), then Review sends create_task with passenger_list; with the passengers switch off the field is not there.
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';

import { answers, calls, failOnConsoleError, FIX, mockUseApp, resetFake } from './fakeOffice';

jest.mock('@/office/client', () => ({ officeApi: require('./fakeOffice').mockOfficeApi }));
jest.mock('@/state/app', () => ({ useApp: () => require('./fakeOffice').mockUseApp() }));
jest.mock('@/office/store', () => ({ useOfficeMe: () => require('./fakeOffice').FIX('me'), getOfficeMe: () => require('./fakeOffice').FIX('me'), setOfficeMe: () => undefined }));

/* eslint-disable import/first */
import WhoScreen from '@/app/office/trip/who';
import ReviewScreen from '@/app/office/trip/review';
import { hideSnackbar } from '@/components/patterns/Snackbar';
import { newDraft, setDraft } from '@/office/trip/draft';
import { newStop } from '@/office/trip/stopsLogic';
import { OfficeProvider } from '@/office/state';
import type { Me as OfficeMe } from '@/office/types';

const BASE: OfficeMe = FIX('me');
const ME: OfficeMe = { ...BASE, tools: [...BASE.tools, 'find_people'] };
const t = mockUseApp().t;
const TASK_ID = FIX('create_task').task_id as string;

function taskDraft() {
  const d = newDraft('task');
  const stops = [
    { ...newStop('pickup'), place: 'Fixture office', placeId: '00000000-0000-4000-8000-000000000001', picked: true, lat: 6.9, lng: 79.86, what: 'people' as const },
    { ...newStop('drop'), place: 'Fixture site', placeId: '00000000-0000-4000-8000-000000000002', picked: true, lat: 7.48, lng: 80.36, what: 'people' as const, arriveBy: '11:00' },
  ];
  return { ...d, step: 'who' as const, driverName: 'Driver A', fields: { ...d.fields, stops, driver: 'fixa', vehicle: 'FX 1', title: 'Team drop', leaveBy: '08:00', pax: '5' } };
}

function TaskPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Text>{`task page ${id}`}</Text>;
}

const routes = (me: OfficeMe) => ({
  _layout: () => <OfficeProvider me={me}><Stack screenOptions={{ headerShown: false }} /></OfficeProvider>,
  'office/trip/who': WhoScreen,
  'office/trip/review': ReviewScreen,
  'office/task/[id]': TaskPage,
});

let errors: ReturnType<typeof failOnConsoleError>;
beforeEach(() => {
  resetFake();
  act(() => hideSnackbar());
  errors = failOnConsoleError();
});
afterEach(() => {
  errors.restore();
  setDraft(null);
});

describe('Who rides on Assign a task', () => {
  it('finds a person, adds someone without an account, and create_task carries passenger_list', async () => {
    answers.find_people = () => ({ count: 1, people: [{ id: 'e1', name: 'Asha Fernando', label: 'Office' }] });
    setDraft(taskDraft());
    renderRouter(routes(ME), { initialUrl: '/office/trip/who' });
    fireEvent.changeText(await screen.findByPlaceholderText(t('office.passengers.search')), 'As');
    fireEvent.press(await screen.findByTestId('people-row-e1', {}, { timeout: 3000 }));
    expect(calls.filter((c) => c.tool === 'find_people').map((c) => c.args)).toEqual([{ text: 'As' }]);
    expect(screen.getAllByTestId('passenger-chip')).toHaveLength(1);
    // Someone without an account: a wrong number is refused in the sheet, a right one becomes a chip.
    fireEvent.press(screen.getByTestId('add-typed'));
    expect(screen.getByTestId('typed-name').props.value).toBe('As'); // the typed words carried over
    fireEvent.changeText(screen.getByTestId('typed-name'), 'Ruwan');
    fireEvent.changeText(screen.getByPlaceholderText('077 123 4567'), '12345');
    fireEvent.press(screen.getByTestId('typed-add'));
    expect(screen.getByTestId('typed-error')).toBeTruthy();
    fireEvent.changeText(screen.getByPlaceholderText('077 123 4567'), '077 123 4567');
    fireEvent.press(screen.getByTestId('typed-add'));
    await waitFor(() => expect(screen.getAllByTestId('passenger-chip')).toHaveLength(2));
    expect(screen.getByText(`Asha Fernando, Ruwan +3 · ${t('office.passengers.hint')}`)).toBeTruthy();
    fireEvent.press(screen.getByText(t('office.trip.nextReview')));
    expect(await screen.findByText('Asha Fernando, Ruwan +3')).toBeTruthy();
    fireEvent.press(await screen.findByText(t('office.trip.sendTo', { name: 'Driver A' })));
    await screen.findByText(`task page ${TASK_ID}`, {}, { timeout: 5000 });
    const sent = calls.filter((c) => c.tool === 'create_task');
    expect(sent).toHaveLength(1);
    expect(sent[0].args.passenger_list).toEqual([{ person: 'e1' }, { name: 'Ruwan', phone: '+94771234567' }]);
    expect(sent[0].args.passengers).toBe(5);
    expect(errors.seen.map((a) => String(a[0]))).toEqual([]);
  });

  it('with the passengers switch off the field is not there and no names are sent', async () => {
    answers.get_settings = () => ({ settings: { tasks_need_approval: false, self_drive_allowed: true, passengers: false } });
    setDraft({ ...taskDraft(), fields: { ...taskDraft().fields, riders: [{ person: 'e1', name: 'Asha Fernando' }] } });
    renderRouter(routes(ME), { initialUrl: '/office/trip/who' });
    await waitFor(() => expect(screen.getByText(t('office.trip.nextReview'))).toBeTruthy());
    await waitFor(() => expect(calls.some((c) => c.tool === 'get_settings')).toBe(true));
    expect(screen.queryByTestId('passengers-field')).toBeNull();
    fireEvent.press(screen.getByText(t('office.trip.nextReview')));
    fireEvent.press(await screen.findByText(t('office.trip.sendTo', { name: 'Driver A' })));
    await screen.findByText(`task page ${TASK_ID}`, {}, { timeout: 5000 });
    expect(calls.find((c) => c.tool === 'create_task')?.args.passenger_list).toBeUndefined();
  });
});
