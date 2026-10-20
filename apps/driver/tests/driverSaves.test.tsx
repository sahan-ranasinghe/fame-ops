// Hotfix O2-H2, Part 1b: the driver side's saves. A report is written to the phone's queue at once; the screen goes back to
// where it was opened and a snackbar says it went (or waits on the phone), with Call office when another vehicle is
// needed and there is no connection. No dialog to close, never a throw.
import { act, fireEvent, screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { router, Stack } from 'expo-router';
import { Pressable, Text } from 'react-native';

import { failOnConsoleError, mockUseApp } from './fakeOffice';

let mockOffline = false;
jest.mock('@/state/app', () => ({
  useApp: () => ({
    ...require('./fakeOffice').mockUseApp(),
    me: { id: 'e1', name: 'Driver A' },
    tasks: [],
    vehicles: [{ id: 'v1', reg_no: 'FX 1' }],
    workVehicle: { id: 'v1', reg_no: 'FX 1' },
    offline: mockOffline,
  }),
}));
jest.mock('@/config', () => ({ ...jest.requireActual('@/config'), OFFICE_PHONE: '0112345678' }));
// The form itself (camera, photos) is not what is tested here: its Send hands the screen what was sent.
jest.mock('@/components/ReportForm', () => ({
  ReportForm: ({ onSent }: { onSent: (o: { needsVehicle: boolean }) => void }) => {
    const { Pressable: P, Text: T } = require('react-native');
    return (
      <>
        <P onPress={() => onSent({ needsVehicle: false })}><T>send plain</T></P>
        <P onPress={() => onSent({ needsVehicle: true })}><T>send needs vehicle</T></P>
      </>
    );
  },
}));

/* eslint-disable import/first */
import ReportProblem from '@/app/report-problem';
import { hideSnackbar, shownSnackbar } from '@/components/patterns/Snackbar';

const t = mockUseApp().t;
const routes = {
  _layout: () => <Stack screenOptions={{ headerShown: false }} />,
  index: () => <><Text>today</Text><Pressable onPress={() => router.push('/report-problem')}><Text>open report</Text></Pressable></>,
  'report-problem': ReportProblem,
};

let errors: ReturnType<typeof failOnConsoleError>;
beforeEach(() => {
  act(() => hideSnackbar());
  errors = failOnConsoleError();
});
afterEach(() => errors.restore());

describe('Report a problem: after Send', () => {
  it('goes back to where it was opened and says it was sent', async () => {
    mockOffline = false;
    const r = renderRouter(routes, { initialUrl: '/' });
    fireEvent.press(screen.getByText('open report'));
    fireEvent.press(await screen.findByText('send plain'));
    await screen.findByText('today');
    expect(r.getPathname()).toBe('/');
    expect(shownSnackbar()?.text).toBe(`${t('report.sentTitle')} · ${t('report.sentBody')}`);
    expect(shownSnackbar()?.action).toBeUndefined();
    expect(errors.seen.map((a) => String(a[0]))).toEqual([]);
  });

  it('with no connection and another vehicle needed: waits on the phone, with Call office', async () => {
    mockOffline = true;
    renderRouter(routes, { initialUrl: '/' });
    fireEvent.press(screen.getByText('open report'));
    fireEvent.press(await screen.findByText('send needs vehicle'));
    await screen.findByText('today');
    expect(shownSnackbar()?.text).toBe(`${t('report.sentTitle')} · ${t('common.savedOffline')}`);
    expect(shownSnackbar()?.action?.label).toBe(t('gate.callOffice'));
    expect(errors.seen.map((a) => String(a[0]))).toEqual([]);
  });
});
