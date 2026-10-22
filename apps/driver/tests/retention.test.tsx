// Round 4–7, item 9: Office mode's Data retention (More → Settings), rendered through the router with the fake office, in
// English and in Sinhala now that its strings are in en.json / si.json. The key actions are there and work:
//   - every kind's row with its period, fuel videos' months, "Never removed";
//   - a row opens the one sheet: below the minimum Save waits with the reason; a valid period is saved ALONE (the server
//     keeps the others as stored), with the snackbar;
//   - Run now: the preview first (nothing removed), then "Remove N now" → run_retention {confirm: true} once;
//   - without update_settings the rows only read; without the run tools there is no Run now;
//   - the Sinhala screen shows Sinhala words, never a key.
/* eslint-disable @typescript-eslint/no-require-imports */
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { Stack } from 'expo-router';

import { answers, calls, failOnConsoleError, FIX, resetFake } from './fakeOffice';

let mockLang: 'en' | 'si' = 'en';
jest.mock('@/office/client', () => ({ officeApi: require('./fakeOffice').mockOfficeApi }));
jest.mock('@/state/app', () => ({
  useApp: () => {
    const base = require('./fakeOffice').mockUseApp();
    if (mockLang === 'en') return base;
    const { translate, translateList } = require('../src/i18n');
    return { ...base, language: 'si', t: (k: string, v?: Record<string, string | number>) => translate('si', k, v), tList: (k: string) => translateList('si', k) };
  },
}));
jest.mock('@/office/store', () => ({ useOfficeMe: () => require('./fakeOffice').FIX('me'), getOfficeMe: () => require('./fakeOffice').FIX('me'), setOfficeMe: () => undefined }));

/* eslint-disable import/first */
import DataRetention from '@/app/office/people/retention';
import { hideSnackbar, shownSnackbar } from '@/components/patterns/Snackbar';
import { translate } from '@/i18n';
import { OfficeProvider } from '@/office/state';
import type { Me as OfficeMe } from '@/office/types';

const RUN_TOOLS = ['get_settings', 'update_settings', 'retention_preview', 'run_retention'];
const base = FIX('me') as OfficeMe;
const ME: OfficeMe = { ...base, tools: [...base.tools.filter((x: string) => !RUN_TOOLS.includes(x)), ...RUN_TOOLS] };

const PERIODS = {
  inbox_read_days: 30, inbox_unread_days: 90, delivery_days: 14, audit_routine_days: 30, audit_changes_days: 730,
  issues_resolved_days: 365, location_days: 183, heartbeats_days: 90, counters_days: 90, drafts_days: 30, app_errors_days: 90,
};
const PREVIEW = {
  periods: PERIODS,
  minimums: { location_days: 30, audit_changes_days: 183 },
  rules: [
    { key: 'inbox_read', what: 'read notifications', days: 30, before: '2026-09-22', count: 3 },
    { key: 'location_points', what: 'location points', days: 183, before: '2026-04-22', count: 0 },
  ],
  would_remove: 3,
  never: ['tasks and their stops', 'requests'],
  nightly: '02:45 Colombo',
  kinds: 14,
};

const routes = (me: OfficeMe) => ({
  _layout: () => <OfficeProvider me={me}><Stack screenOptions={{ headerShown: false }} /></OfficeProvider>,
  'office/people/retention': DataRetention,
});
const open = (me: OfficeMe = ME) => renderRouter(routes(me), { initialUrl: '/office/people/retention' });
const en = (k: string, v?: Record<string, string | number>) => translate('en', k, v);

let errors: ReturnType<typeof failOnConsoleError>;
beforeEach(() => {
  mockLang = 'en';
  resetFake();
  act(() => hideSnackbar());
  answers.get_settings = () => ({ settings: { tasks_need_approval: false, self_drive_allowed: true, retention: PERIODS, fuel_video_keep_months: 12 } });
  answers.retention_preview = () => PREVIEW;
  answers.run_retention = () => ({ line: 'Removed 3: read notifications 3.', counts: PREVIEW.rules.slice(0, 1), summarised: 0 });
  answers.update_settings = (a) => ({ key: a.key, value: a.value });
  errors = failOnConsoleError();
});
afterEach(() => {
  errors.restore();
  expect(errors.seen).toEqual([]);
});

describe('Data retention (Office mode)', () => {
  it('lists every kind with its period, fuel videos and what is never removed', async () => {
    open();
    await screen.findByTestId('retention-row-location_days', {}, { timeout: 6000 });
    for (const key of Object.keys(PERIODS)) expect(screen.getByTestId(`retention-row-${key}`)).toBeTruthy();
    expect(screen.getByTestId('retention-row-fuel')).toBeTruthy();
    expect(screen.getByTestId('retention-never')).toBeTruthy();
    expect(screen.getByTestId('retention-run')).toBeTruthy();
    expect(screen.queryByText(/office\.retention\./)).toBeNull();
  });

  it('a period below its minimum waits with the reason; a valid one is saved alone', async () => {
    open();
    fireEvent.press(await screen.findByTestId('retention-row-location_days', {}, { timeout: 6000 }));
    const field = await screen.findByTestId('retention-days');
    fireEvent.changeText(field, '10');
    expect(screen.getByTestId('retention-save')).toBeDisabled();
    expect(screen.getByText(en('office.retention.err.min', { n: '30' }))).toBeTruthy();
    fireEvent.changeText(field, '90');
    await waitFor(() => expect(screen.getByTestId('retention-save')).toBeEnabled());
    fireEvent.press(screen.getByTestId('retention-save'));
    await waitFor(() => expect(calls.filter((c) => c.tool === 'update_settings')).toHaveLength(1));
    expect(calls.find((c) => c.tool === 'update_settings')?.args).toEqual({ key: 'retention', value: { location_days: 90 } });
    await waitFor(() => expect(shownSnackbar()).toBeTruthy());
  });

  it('Run now: the preview first, then Remove N now runs once', async () => {
    open();
    fireEvent.press(await screen.findByTestId('retention-check', {}, { timeout: 6000 }));
    await screen.findByTestId('retention-preview');
    expect(calls.filter((c) => c.tool === 'run_retention')).toHaveLength(0);
    fireEvent.press(screen.getByTestId('retention-remove'));
    await screen.findByTestId('retention-done');
    expect(calls.filter((c) => c.tool === 'run_retention').map((c) => c.args)).toEqual([{ confirm: true }]);
  });

  it('without update_settings the rows only read; without the run tools there is no Run now', async () => {
    open({ ...ME, tools: ME.tools.filter((x: string) => x !== 'update_settings' && x !== 'run_retention') });
    await screen.findByTestId('retention-row-location_days', {}, { timeout: 6000 });
    expect(screen.queryByTestId('retention-run')).toBeNull();
    fireEvent.press(screen.getByTestId('retention-row-location_days'));
    expect(screen.queryByTestId('retention-days')).toBeNull();
  });

  it('in Sinhala: the title and rows in Sinhala, no key shown', async () => {
    mockLang = 'si';
    open();
    await screen.findByTestId('retention-row-location_days', {}, { timeout: 6000 });
    const title = translate('si', 'office.retention.title');
    expect(title).not.toEqual(en('office.retention.title'));
    expect(screen.getAllByText(title).length).toBeGreaterThan(0);
    expect(screen.queryByText(/office\.retention\./)).toBeNull();
    expect(screen.queryByText(en('office.retention.fuel'))).toBeNull();
  });
});
