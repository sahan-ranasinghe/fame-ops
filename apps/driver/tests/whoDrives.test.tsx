// Round 3 (docs/phase8-plan.md §30): "Who drives?" and the driver-first card, rendered. The choice control's three rows and
// someone else's name and phone; the vehicle chip under a driver's name ("regular", "Vehicle: on the day", "No vehicle
// yet", never the server's English vehicle_note); last seen said once (no "Last seen Last seen"); a task's header for
// someone else; and Approve for a request the asker drives: no driver picked, the button disabled with "Pick the vehicle."
// until a vehicle is picked, then decide_request with the vehicle and no driver (the server refused one with neither).
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { router, Stack } from 'expo-router';
import { act, useState } from 'react';
import { Text } from 'react-native';

import { answers, calls, failOnConsoleError, FIX, mockUseApp, resetFake } from './fakeOffice';

jest.mock('@/office/client', () => ({ officeApi: require('./fakeOffice').mockOfficeApi }));
jest.mock('@/state/app', () => ({ useApp: () => require('./fakeOffice').mockUseApp() }));
jest.mock('@/office/store', () => ({ useOfficeMe: () => require('./fakeOffice').FIX('me'), getOfficeMe: () => require('./fakeOffice').FIX('me'), setOfficeMe: () => undefined }));

/* eslint-disable import/first */
import ApproveRequest from '@/app/office/request/[id]';
import { DriverChoiceRow, DriverRows, TaskDriverCard } from '@/components/office/DriverRows';
import { WhoDrivesChoice } from '@/components/office/WhoDrivesChoice';
import { hideSnackbar } from '@/components/patterns/Snackbar';
import { OfficeProvider } from '@/office/state';
import { emptyWho, type WhoDrivesValue } from '@/office/trip/whoDrivesLogic';
import type { Availability, AvailableDriver, Me as OfficeMe } from '@/office/types';

const t = mockUseApp().t;
const ME: OfficeMe = FIX('me');

function Controlled({ start, seen }: { start: WhoDrivesValue; seen: WhoDrivesValue[] }) {
  const [v, setV] = useState(start);
  return <WhoDrivesChoice value={v} onChange={(n) => { seen.push(n); setV(n); }} />;
}

describe('Who drives?', () => {
  it('three choices as radios; Someone else opens a name and a phone; a bad phone says so', () => {
    const seen: WhoDrivesValue[] = [];
    render(<Controlled start={emptyWho()} seen={seen} />);
    expect(screen.getByText(t('office.who.title'))).toBeTruthy();
    for (const c of ['driver', 'self', 'other'] as const) expect(screen.getByTestId(`who-drives-${c}`).props.accessibilityRole).toBe('radio');
    expect(screen.getByTestId('who-drives-driver').props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.queryByTestId('who-drives-details')).toBeNull();
    fireEvent.press(screen.getByTestId('who-drives-other'));
    expect(seen.at(-1)?.by).toBe('other');
    fireEvent.changeText(screen.getByTestId('who-drives-name'), 'Someone Else');
    fireEvent.changeText(screen.getByTestId('who-drives-phone'), '12345');
    expect(seen.at(-1)).toMatchObject({ by: 'other', name: 'Someone Else', phone: '12345' });
    expect(screen.getByText(t('office.who.phoneBad'))).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('who-drives-phone'), '077 123 4567');
    expect(screen.getByText(t('office.who.phoneHint'))).toBeTruthy();
    fireEvent.press(screen.getByTestId('who-drives-self'));
    expect(seen.at(-1)?.by).toBe('self');
    expect(screen.queryByTestId('who-drives-details')).toBeNull();
  });

  it('an older request the custodian drives reads as a driver, as on the site (nothing is sent unless it changes)', () => {
    render(<WhoDrivesChoice value={emptyWho()} onChange={() => undefined} />);
    expect(screen.getByTestId('who-drives-driver').props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.queryByTestId('who-drives-custodian')).toBeNull();
  });
});

describe('The driver-first card', () => {
  const base: AvailableDriver = { name: 'Driver A', username: 'fixa', state: 'on_duty', status_text: 'On duty since 07:12', accepted_today: 0, declined_today: 0, licence: { chip: 'ok' }, free: true };
  it('the vehicle chip under the name: the plate, "regular", on the day, no vehicle yet; never the server\'s vehicle_note', () => {
    const { rerender } = render(<DriverChoiceRow d={{ ...base, vehicle: { reg_no: 'FX 1', source: 'on_duty' } }} selected={false} onPress={() => undefined} onDay={false} testID="r" />);
    expect(screen.getByText('FX 1')).toBeTruthy();
    expect(screen.queryByText(t('office.who.regular'))).toBeNull();
    rerender(<DriverChoiceRow d={{ ...base, vehicle: { reg_no: 'FX 2', source: 'regular' } }} selected={false} onPress={() => undefined} onDay={false} testID="r" />);
    expect(screen.getByText('FX 2')).toBeTruthy();
    expect(screen.getByText(t('office.who.regular'))).toBeTruthy();
    rerender(<DriverChoiceRow d={base} selected={false} onPress={() => undefined} onDay testID="r" />);
    expect(screen.getByText(t('office.who.vehicleOnTheDay'))).toBeTruthy();
    rerender(<DriverChoiceRow d={base} selected={false} onPress={() => undefined} onDay={false} testID="r" />);
    expect(screen.getByText(t('office.who.noVehicleYet'))).toBeTruthy();
  });

  it('Who\'s available says last seen once, the vehicle note never', () => {
    const data = {
      as_of: '', window: { from: '', until: '', day: '' }, counts: { free: 1, on_duty: 1, all: 1 },
      vehicles: { groups: { free_pool: [], free_assigned: [], busy: [], in_garage: [] }, drivers_free: [] },
      drivers: [{ ...base, last_seen: 'Last seen 17:42 near Kadawatha', usual_start: '07:40', vehicle_note: 'no vehicle yet · regular: FX 9' }],
    } as Availability;
    render(<DriverRows data={data} loading={false} error={null} picked="" onPick={() => undefined} onRetry={() => undefined} onSignIn={() => undefined} />);
    expect(screen.getByText(`Last seen 17:42 near Kadawatha · ${t('office.trip.usuallyStarts', { time: '07:40' })}`)).toBeTruthy();
    expect(screen.queryByText(/Last seen Last seen/)).toBeNull();
    expect(screen.queryByText(/no vehicle yet · regular/)).toBeNull();
  });

  it('a task someone else drives: their initials and name, "Someone else" instead of the duty word, Call and WhatsApp', () => {
    render(<TaskDriverCard name="Other Person" drivenBy="other" photo="https://example.invalid/p.jpg" plate="FX 1" call="tel:+94771234567" whatsapp="https://wa.me/94771234567" emptyName="—" />);
    expect(screen.getByText('Other Person')).toBeTruthy();
    expect(screen.getByText(t('office.who.someoneElse'))).toBeTruthy();
    expect(screen.getByText('OP')).toBeTruthy();
    expect(screen.getByTestId('task-driver-call')).toBeTruthy();
    expect(screen.getByTestId('task-driver-whatsapp')).toBeTruthy();
  });
});

describe('Approve a request the asker drives themselves', () => {
  const card = { ...FIX('list_requests_one').requests[0], driven_by: 'self', driver_required: false };
  const vehicle = { reg_no: 'FX 7', availability: 'Free', pick: 'yes' };
  const driverA: AvailableDriver = { name: 'Driver A', username: 'fixa', state: 'on_duty', status_text: 'On duty', accepted_today: 0, declined_today: 0, licence: { chip: 'ok' }, free: true, rank: 1 };
  const routes = {
    _layout: () => <OfficeProvider me={ME}><Stack screenOptions={{ headerShown: false }} /></OfficeProvider>,
    'office/(tabs)/index': () => <Text>home</Text>,
    'office/request/[id]': ApproveRequest,
  };
  let errors: ReturnType<typeof failOnConsoleError>;
  beforeEach(() => {
    resetFake();
    act(() => hideSnackbar());
    answers.list_requests = () => ({ requests: [card], count: 1 });
    answers.availability = () => ({ drivers: [driverA], best: { name: 'Driver A', username: 'fixa', why: 'On duty · free 08:00–17:00 · 1 task today' }, counts: { free: 1, on_duty: 1, all: 1 }, vehicles: { groups: { free_pool: [vehicle], free_assigned: [], busy: [], in_garage: [] }, drivers_free: [] } });
    errors = failOnConsoleError();
  });
  afterEach(() => errors.restore());

  it('says what was asked, picks no driver, needs the vehicle, then sends it with no driver', async () => {
    renderRouter(routes, { initialUrl: '/office' });
    act(() => router.push(`/office/request/${card.id}`));
    expect(await screen.findByText(t('office.who.askedSelf', { name: card.requested_by }), {}, { timeout: 5000 })).toBeTruthy();
    await screen.findByTestId('vehicle-row-FX 7', {}, { timeout: 5000 });
    expect(screen.getByTestId('approve-reason')).toHaveTextContent(t('office.who.pickVehicle'));
    expect(screen.getByTestId('approve-button').props.accessibilityState).toMatchObject({ disabled: true });
    fireEvent.press(screen.getByTestId('vehicle-row-FX 7'));
    const approve = await screen.findByText(t('office.who.approveVehicle', { plate: 'FX 7' }));
    expect(screen.queryByTestId('approve-reason')).toBeNull();
    fireEvent.press(approve);
    await waitFor(() => expect(calls.filter((c) => c.tool === 'decide_request')).toHaveLength(1), { timeout: 5000 });
    const sent = calls.find((c) => c.tool === 'decide_request')!.args;
    expect(sent).toMatchObject({ request_id: card.id, decision: 'approve', vehicle: 'FX 7' });
    expect(sent.driver).toBeUndefined();
    expect(errors.seen.map((a) => String(a[0]))).toEqual([]);
  });

  it('Give a driver instead: the best match is picked and sent as the driver', async () => {
    renderRouter(routes, { initialUrl: '/office' });
    act(() => router.push(`/office/request/${card.id}`));
    fireEvent.press(await screen.findByTestId('approve-give-driver', {}, { timeout: 5000 }));
    fireEvent.press(await screen.findByText(t('office.request.approveSend', { name: 'Driver A' }), {}, { timeout: 5000 }));
    await waitFor(() => expect(calls.filter((c) => c.tool === 'decide_request')).toHaveLength(1), { timeout: 5000 });
    expect(calls.find((c) => c.tool === 'decide_request')!.args).toMatchObject({ decision: 'approve', driver: 'fixa' });
    expect(errors.seen.map((a) => String(a[0]))).toEqual([]);
  });
});
