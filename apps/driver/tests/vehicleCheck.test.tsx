// Round 4–7, feature 4 (docs/phase8-plan.md §33.1): the vehicle check screen (app/vehicle-check.tsx) through the router.
// "No, all good" is one tap and recorded at once, then Continue (and the optional four photos); "Yes" opens the report
// (Damage, up to 6 photos) and Send records the check with its report and goes back with the snackbar; back from the
// question leaves without answering (nothing recorded, no question asked); back from the report returns to the question.
// The words: en.json with the strings sidecar (src/i18n/parts) merged in while it exists; a missing key fails the test.
import { act, fireEvent, screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { router, Stack } from 'expo-router';
import { Pressable, Text } from 'react-native';

import { failOnConsoleError } from './fakeOffice';

let mockNeeded = true;
const mockAnswers: Record<string, unknown>[] = [];
const mockPhotos: unknown[] = [];
let mockShot = 0;

/** The English words: en.json, with this feature's strings sidecar merged in while it exists (the lead merges it into
 *  en.json and removes it; then en.json alone). */
function mockWords(): (key: string, vars?: Record<string, string | number>) => string {
  const merge = (into: Record<string, unknown>, from: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(from)) {
      const had = into[k];
      if (v && typeof v === 'object' && had && typeof had === 'object') merge(had as Record<string, unknown>, v as Record<string, unknown>);
      else into[k] = v;
    }
  };
  const en = JSON.parse(JSON.stringify(require('../src/i18n/en.json')));
  try {
    merge(en, require('../src/i18n/parts/vehicle-check.json').en ?? {});
  } catch {
    // Merged already: en.json has the words.
  }
  return (key, vars) => {
    const found = key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), en);
    if (typeof found !== 'string') throw new Error(`No text for "${key}"`);
    return Object.entries(vars ?? {}).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), found);
  };
}

let mockT: ReturnType<typeof mockWords> | null = null;
function mockApp() {
  mockT ??= mockWords();
  const t = mockT;
  return {
    t,
    tList: () => [],
    language: 'en',
    settings: require('../src/lib/api').DEFAULT_DRIVER_SETTINGS,
    dataAvailable: true,
    offline: false,
    me: { id: 'e1', name: 'Driver A' },
    tasks: [],
    vehicles: [{ id: 'v1', reg_no: 'WP CAB-4521', make_model: 'Toyota HiAce', current_odometer_km: 1200 }],
    vehicleChecks: [],
    checkNeeded: () => mockNeeded,
    answerVehicleCheck: (input: Record<string, unknown>) => {
      mockAnswers.push(input);
      mockNeeded = false;
      return { id: 'c1', vehicle_id: 'v1', employee_id: 'e1', task_id: null, checked_at: '2026-10-22T02:42:00.000Z', result: input.result, odometer_km: 1200, how: input.how };
    },
    addCheckPhotos: (_check: unknown, shots: unknown[]) => void mockPhotos.push(...shots),
    sendReport: () => {
      throw new Error('the check sends its report itself');
    },
  };
}

jest.mock('@/state/app', () => ({ useApp: () => mockApp() }));
jest.mock('@/components/Photos', () => ({ Thumb: () => null, useVehicleThumbs: () => ({}) }));
jest.mock('@/lib/photos', () => ({
  takePhoto: async () => ({ id: `p${++mockShot}`, uri: `file:///p${mockShot}.jpg`, takenAt: '2026-10-22T02:40:00.000Z', lat: null, lng: null }),
  discardPhoto: () => undefined,
}));

/* eslint-disable import/first */
import VehicleCheck from '@/app/vehicle-check';
import { hideSnackbar, shownSnackbar } from '@/components/patterns/Snackbar';

const routes = {
  _layout: () => <Stack screenOptions={{ headerShown: false }} />,
  index: () => (
    <>
      <Text>today</Text>
      <Pressable onPress={() => router.push({ pathname: '/vehicle-check', params: { vehicleId: 'v1', how: 'clock_in' } })}><Text>open check</Text></Pressable>
    </>
  ),
  'vehicle-check': VehicleCheck,
};

let errors: ReturnType<typeof failOnConsoleError>;
beforeEach(() => {
  act(() => hideSnackbar());
  mockNeeded = true;
  mockAnswers.length = 0;
  mockPhotos.length = 0;
  errors = failOnConsoleError();
});
afterEach(() => errors.restore());

async function openCheck() {
  const r = renderRouter(routes, { initialUrl: '/' });
  fireEvent.press(screen.getByText('open check'));
  await screen.findByText('Any damage or problem with');
  return r;
}

describe('The vehicle check', () => {
  it('asks about the plate, with the two answers and no skip', async () => {
    await openCheck();
    expect(screen.getAllByText('WP CAB-4521').length).toBeGreaterThan(0);
    expect(screen.getByText('No, all good')).toBeTruthy();
    expect(screen.getByText('Yes, report a problem')).toBeTruthy();
    expect(screen.queryByText(/skip/i)).toBeNull();
    expect(errors.seen.map((a) => String(a[0]))).toEqual([]);
  });

  it('"No, all good": one tap records it; Continue goes back to where it was opened', async () => {
    const r = await openCheck();
    fireEvent.press(screen.getByText('No, all good'));
    expect(mockAnswers).toEqual([{ vehicleId: 'v1', how: 'clock_in', taskId: null, result: 'ok' }]);
    await screen.findByText('All good');
    expect(screen.getByText('Add 4 photos (front, back, left, right)')).toBeTruthy();
    fireEvent.press(screen.getByText('Continue'));
    await screen.findByText('today');
    expect(r.getPathname()).toBe('/');
    expect(errors.seen.map((a) => String(a[0]))).toEqual([]);
  });

  it('back from the question leaves without answering, asking nothing', async () => {
    const r = await openCheck();
    act(() => router.back());
    await screen.findByText('today');
    expect(r.getPathname()).toBe('/');
    expect(mockAnswers).toEqual([]);
  });

  it('"Yes": the report with Damage; back returns to the question; Send records the check with its report', async () => {
    const r = await openCheck();
    fireEvent.press(screen.getByText('Yes, report a problem'));
    await screen.findByText('Damage');
    expect(screen.getByText('Photos (0 of 6)')).toBeTruthy();
    // Nothing entered: back is one step inside the screen, no question.
    act(() => router.back());
    await screen.findByText('No, all good');
    expect(r.getPathname()).toBe('/vehicle-check');

    fireEvent.press(screen.getByText('Yes, report a problem'));
    fireEvent.press(await screen.findByTestId('report-damage'));
    fireEvent.changeText(screen.getByPlaceholderText('A few words for the office'), 'Dent on the left door');
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Add photo'));
    });
    await screen.findByText('Photos (1 of 6)');
    fireEvent.press(screen.getByText('Send to office'));
    await screen.findByText('today');
    expect(mockAnswers).toHaveLength(1);
    expect(mockAnswers[0]).toMatchObject({ vehicleId: 'v1', how: 'clock_in', taskId: null, result: 'problem', report: { category: 'damage', note: 'Dent on the left door' } });
    expect((mockAnswers[0].report as { photos: unknown[] }).photos).toHaveLength(1);
    expect(shownSnackbar()?.text).toBe('Report sent · The office will see it.');
    expect(errors.seen.map((a) => String(a[0]))).toEqual([]);
  });

  it('the four photos: one labelled shot per side, then Save photos', async () => {
    await openCheck();
    fireEvent.press(screen.getByText('No, all good'));
    fireEvent.press(await screen.findByText('Add 4 photos (front, back, left, right)'));
    await act(async () => {
      fireEvent.press(await screen.findByText('Take photo: Front'));
    });
    await screen.findByText('Take photo: Back');
    fireEvent.press(screen.getAllByText('Save photos')[0]);
    await screen.findByText('Photos added: 1');
    expect(mockPhotos).toHaveLength(1);
    expect(mockPhotos[0]).toMatchObject({ side: 'front' });
    expect(errors.seen.map((a) => String(a[0]))).toEqual([]);
  });
});
