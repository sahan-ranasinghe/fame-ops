// Hotfix O2-H2, Part 1a: the trip editor's last button, run through the router with the real answers. The steps stay
// mounted in the stack (Where → When → Who → Review); after the save the draft is cleared, and every step under Review
// re-renders with no draft. Before the fix the Who step then called one hook fewer ("Rendered fewer hooks than
// expected"): a white screen in a release build, the trip already saved.
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { Stack } from 'expo-router';

import { calls, failOnConsoleError, FIX, mockOfficeApi, mockUseApp, resetFake } from './fakeOffice';

jest.mock('@/office/client', () => ({ officeApi: require('./fakeOffice').mockOfficeApi }));
jest.mock('@/state/app', () => ({ useApp: () => require('./fakeOffice').mockUseApp() }));
jest.mock('@/office/store', () => ({ useOfficeMe: () => require('./fakeOffice').FIX('me'), getOfficeMe: () => require('./fakeOffice').FIX('me'), setOfficeMe: () => undefined }));

/* eslint-disable import/first */
import WhoScreen from '@/app/office/trip/who';
import ReviewScreen from '@/app/office/trip/review';
import { newDraft, setDraft, getDraft } from '@/office/trip/draft';
import { newStop } from '@/office/trip/stopsLogic';
import { OfficeProvider } from '@/office/state';

const me = FIX('me');
const t = mockUseApp().t;

function taskDraft() {
  const d = newDraft('task');
  const pickup = { ...newStop('pickup'), place: 'Fixture office', placeId: '00000000-0000-4000-8000-000000000001', picked: true, lat: 6.9, lng: 79.86, what: 'people' as const };
  const drop = { ...newStop('drop'), place: 'Fixture site', placeId: '00000000-0000-4000-8000-000000000002', picked: true, lat: 7.48, lng: 80.36, what: 'people' as const, arriveBy: '11:00' };
  return { ...d, step: 'who' as const, driverName: 'Driver A', fields: { ...d.fields, stops: [pickup, drop], driver: 'fixa', vehicle: 'FX 1', title: 'Team drop', leaveBy: '08:00', pax: '3' } };
}

const routes = {
  _layout: () => <OfficeProvider me={me}><Stack screenOptions={{ headerShown: false }} /></OfficeProvider>,
  'office/trip/who': WhoScreen,
  'office/trip/review': ReviewScreen,
  'office/(tabs)/tasks': () => null,
  'office/task/[id]': () => null,
};

describe('Assign a task: the last button', () => {
  beforeEach(() => {
    resetFake();
    setDraft(taskDraft());
  });

  it('saves, clears the draft and shows the screen after success without throwing (the white screen)', async () => {
    const errors = failOnConsoleError();
    try {
      renderRouter(routes, { initialUrl: '/office/trip/who' });
      await waitFor(() => expect(screen.getByText(t('office.trip.nextReview'))).toBeTruthy());
      fireEvent.press(screen.getByText(t('office.trip.nextReview')));
      const send = await screen.findByText(t('office.trip.sendTo', { name: 'Driver A' }));
      fireEvent.press(send);
      await waitFor(() => expect(calls.some((c) => c.tool === 'create_task')).toBe(true));
      // The screen after success is drawn (and every step under it re-rendered with no draft).
      await screen.findByTestId('outcome-card', {}, { timeout: 5000 });
      expect(getDraft()).toBeNull();
      expect(errors.seen.map((a) => String(a[0]))).toEqual([]);
    } finally {
      errors.restore();
    }
  });
});

void mockOfficeApi;
