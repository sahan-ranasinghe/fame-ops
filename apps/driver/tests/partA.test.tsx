// Round 3 Part A (docs/phase8-plan.md §30), rendered: My profile's Driving licence (the number and the expiry in place,
// update_my_profile with only the change, the state in a word, the expiry in words), the approver's "Self-drive · …" line
// on a request the asker drives, and an expired request (its badge, its line, Request again: the trip editor with the copy
// in place for tomorrow).
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { router, Stack } from 'expo-router';
import { act } from 'react';
import { Text } from 'react-native';

import { answers, calls, failOnConsoleError, FIX, mockUseApp, resetFake } from './fakeOffice';

jest.mock('@/office/client', () => ({ officeApi: require('./fakeOffice').mockOfficeApi }));
jest.mock('@/state/app', () => ({ useApp: () => require('./fakeOffice').mockUseApp() }));
jest.mock('@/office/store', () => ({ useOfficeMe: () => require('./fakeOffice').FIX('me'), getOfficeMe: () => require('./fakeOffice').FIX('me'), setOfficeMe: () => undefined }));
jest.mock('@/office/myPhoto', () => ({
  useMyOfficePhoto: () => ({ uri: null, shown: () => undefined, reload: () => undefined }),
  pickMyPhoto: jest.fn(),
  saveMyOfficePhoto: jest.fn(),
  saveMyLicencePhoto: jest.fn(),
}));

/* eslint-disable import/first */
import OfficeProfile from '@/app/office/profile';
import ApproveRequest from '@/app/office/request/[id]';
import { hideSnackbar } from '@/components/patterns/Snackbar';
import { dateWords } from '@/lib/dateWords';
import { addDays, colomboDate } from '@/lib/time';
import { OfficeProvider } from '@/office/state';
import { getDraft, setDraft } from '@/office/trip/draft';
import type { Me as OfficeMe } from '@/office/types';

const t = mockUseApp().t;
const ME: OfficeMe = FIX('me');

const routesFor = (me: OfficeMe) => ({
  _layout: () => <OfficeProvider me={me}><Stack screenOptions={{ headerShown: false }} /></OfficeProvider>,
  'office/(tabs)/index': () => <Text>home</Text>,
  'office/profile': OfficeProfile,
  'office/request/[id]': ApproveRequest,
  'office/trip/where': () => <Text>where step</Text>,
});

let errors: ReturnType<typeof failOnConsoleError>;
beforeEach(() => {
  resetFake();
  act(() => hideSnackbar());
  answers.my_notification_settings = () => ({ events: [], devices: [], push: { configured: false } });
  errors = failOnConsoleError();
});
afterEach(() => errors.restore());

describe('My profile: the driving licence', () => {
  it('shows the number, the expiry in words and the state; Save sends only what changed', async () => {
    const me = { ...ME, licence: { number: 'B1234567', expiry: '2028-05-01', state: 'on_file' as const } };
    renderRouter(routesFor(me), { initialUrl: '/office' });
    act(() => router.push('/office/profile'));
    expect(await screen.findByTestId('profile-licence', {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByText('B1234567')).toBeTruthy();
    expect(screen.getByText(t('office.profile.licenceExpires', { date: dateWords(t, '2028-05-01') }))).toBeTruthy();
    expect(screen.queryByText(/2028-05-01/)).toBeNull();
    expect(screen.getByText(t('office.profile.licenceOnFile'))).toBeTruthy();
    // The front and the back: Take photo / Choose for each.
    expect(screen.getByTestId('profile-licence-front-pick')).toBeTruthy();
    expect(screen.getByTestId('profile-licence-back-pick')).toBeTruthy();
    fireEvent.press(screen.getByTestId('profile-licence-edit'));
    fireEvent.changeText(screen.getByTestId('profile-licence-no'), ' B7654321 ');
    fireEvent.press(screen.getByTestId('profile-licence-save'));
    await waitFor(() => expect(calls.filter((c) => c.tool === 'update_my_profile')).toHaveLength(1), { timeout: 5000 });
    expect(calls.find((c) => c.tool === 'update_my_profile')!.args).toEqual({ licence_no: 'B7654321' });
    expect(errors.seen.map((a) => String(a[0]))).toEqual([]);
  });

  it('none on file: says so in amber words; the language switch is here', async () => {
    renderRouter(routesFor({ ...ME, licence: { state: 'none' } }), { initialUrl: '/office' });
    act(() => router.push('/office/profile'));
    expect(await screen.findByText(t('office.profile.licenceNone'), {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByText(t('office.profile.licenceNoExpiry'))).toBeTruthy();
    expect(screen.getByText('සිංහල')).toBeTruthy();
  });
});

describe("The approver: a request the asker drives", () => {
  it('"Self-drive · no licence on file" (a warning, the approval still possible)', async () => {
    const card = { ...FIX('list_requests_one').requests[0], driven_by: 'self', driver_required: false, self_drive_licence: 'none' };
    answers.list_requests = () => ({ requests: [card], count: 1 });
    renderRouter(routesFor(ME), { initialUrl: '/office' });
    act(() => router.push(`/office/request/${card.id}`));
    const line = await screen.findByTestId('request-self-licence', {}, { timeout: 5000 });
    expect(line).toHaveTextContent(t('office.who.licenceNone'));
    expect(screen.getByTestId('approve-button')).toBeTruthy();
  });

  it('"Self-drive · licence on file ✓"', async () => {
    const card = { ...FIX('list_requests_one').requests[0], driven_by: 'self', driver_required: false, self_drive_licence: 'on_file' };
    answers.list_requests = () => ({ requests: [card], count: 1 });
    renderRouter(routesFor(ME), { initialUrl: '/office' });
    act(() => router.push(`/office/request/${card.id}`));
    expect(await screen.findByTestId('request-self-licence', {}, { timeout: 5000 })).toHaveTextContent(t('office.who.licenceOnFile'));
  });
});

describe('An expired request', () => {
  it('its badge, its line in words and Request again (everything copied, the day tomorrow)', async () => {
    setDraft(null);
    const base = FIX('list_requests_one').requests[0];
    const card = { ...base, status: 'expired', expired: `${colomboDate()} 00:15`, timeline: { ...base.timeline, expired: `${colomboDate()} 00:15` }, project: 'TRKAN1' };
    answers.list_requests = () => ({ requests: [card], count: 1 });
    renderRouter(routesFor(ME), { initialUrl: '/office' });
    act(() => router.push(`/office/request/${card.id}`));
    expect(await screen.findByTestId('request-expired-line', {}, { timeout: 5000 })).toHaveTextContent(t('office.requests.expiredLine', { at: `${t('date.today')} 00:15` }));
    expect(screen.getAllByText(t('office.requests.status_expired')).length).toBeGreaterThan(0);
    expect(screen.queryByTestId('approve-button')).toBeNull();
    fireEvent.press(screen.getByTestId('request-again'));
    expect(await screen.findByText('where step', {}, { timeout: 5000 })).toBeTruthy();
    const d = getDraft();
    expect(d).toMatchObject({ mode: 'request', againOf: card.id });
    expect(d!.fields.date).toBe(addDays(colomboDate(), 1));
    expect(d!.req.project).toBe('TRKAN1');
    expect(d!.fields.stops.length).toBeGreaterThan(0);
    expect(errors.seen.map((a) => String(a[0]))).toEqual([]);
  });
});
