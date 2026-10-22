// Round 4–7, item 12 (design/mockups/2026-10-22, mockup 6): the running task in the mockup's layout (the map, the sheet,
// the stops sheet) keeps every function it had. The real screen (app/task/[id].tsx TaskView) through the router, with the
// design pages' sample state (src/design/sampleDriver.ts) and a fixed position; the English words (en.json with the
// strings sidecar merged in while it exists):
//   "In progress since …", "Next stop · 2 of 3", the stats, Navigate, Call contact, the slide (the 300 m rule: near = the
//   arrive slide, far = the distance and the override), "Fill up on the way · Log fuel", "Problem with the vehicle?";
//   the stops button: every stop with Skip (its reasons), All stops in Google Maps, the start odometer, the GPS km,
//   every call with WhatsApp, Approved by, Running late, Complete task (waiting for the last stop); once every stop is
//   done, Complete task on the sheet (Log mileage, finish).
import { act, fireEvent, screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Linking, Text } from 'react-native';

import { failOnConsoleError } from './fakeOffice';

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
    merge(en, require('../src/i18n/parts/driver-3.json').en ?? {});
  } catch {
    // Merged already: en.json has the words.
  }
  return (key, vars) => {
    const found = key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), en);
    if (typeof found !== 'string') throw new Error(`No text for "${key}"`);
    return Object.entries(vars ?? {}).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), found);
  };
}

const NOW = Date.now();
let mockAllDone = false;
let mockValue: Record<string, unknown> | null = null;
const mockStopDone = jest.fn();
function mockApp() {
  if (!mockValue) {
    const { sampleApp } = require('../src/design/sampleDriver');
    const en = require('../src/i18n/en.json');
    const value = sampleApp({ language: 'en', now: NOW, running: true });
    if (mockAllDone) {
      for (const s of value.tasks[0].task_stops) s.status = 'done';
    }
    mockValue = { ...value, t: mockWords(), tList: (key: string) => (Array.isArray(en[key]) ? en[key] : []), markStopDone: mockStopDone };
  }
  return mockValue;
}

jest.mock('@/state/app', () => ({ useApp: () => mockApp() }));
jest.mock('@/components/Photos', () => ({ Thumb: () => null, useVehicleThumbs: () => ({}) }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
// The phone's background arrival notification (its queue is SQLite): nothing to quiet in a test.
jest.mock('@/lib/arrival', () => ({ setTaskOnScreen: () => undefined }));
// The map is drawn by its own tests (test:maps); the screen asks which engine for its line note.
jest.mock('@/components/TaskMap', () => ({ TaskMap: () => null, GOOGLE_MAP_BUILD: false, useMapEngine: () => 'open' }));

/* eslint-disable import/first */
import { TaskView } from '@/app/task/[id]';
import { sampleHere } from '@/design/sampleDriver';
import { hideSnackbar } from '@/components/patterns/Snackbar';

let mockFar = false;
const Where = (name: string) => function Shown() {
  const params = useLocalSearchParams();
  return <Text>{`${name} ${JSON.stringify(params)}`}</Text>;
};
function Running() {
  return <TaskView id="t-sample-1" design={{ here: sampleHere(mockFar ? 'far' : 'near', NOW), map: null }} />;
}

const routes = {
  _layout: () => <Stack screenOptions={{ headerShown: false }} />,
  index: Where('today'),
  'task/[id]': Running,
  'log-mileage': Where('log-mileage'),
  'report-problem': Where('report-problem'),
  'add-stop': Where('add-stop'),
};

let errors: ReturnType<typeof failOnConsoleError>;
let openURL: jest.SpyInstance;
beforeEach(() => {
  act(() => hideSnackbar());
  mockValue = null;
  mockAllDone = false;
  mockFar = false;
  mockStopDone.mockClear();
  openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  errors = failOnConsoleError();
});
afterEach(() => {
  openURL.mockRestore();
  errors.restore();
});

const show = () => renderRouter(routes, { initialUrl: '/task/t-sample-1' });

describe('The running task in the mockup\'s layout keeps every function', () => {
  it('the pill, "Next stop · 2 of 3", the stats and the slide with the short words', async () => {
    show();
    await screen.findByText('Next stop · 2 of 3');
    expect(screen.getByText('In progress')).toBeTruthy();
    expect(screen.getByText('since ')).toBeTruthy();
    expect(screen.getByText('Kurunegala site')).toBeTruthy();
    expect(screen.getByText(/^Team drop · Kurunegala site · 3 passengers · Contact: Ashan W\./)).toBeTruthy();
    expect(screen.getByText('left, approx.')).toBeTruthy();
    expect(screen.getByText('arrive about')).toBeTruthy();
    expect(screen.getByText('be there by')).toBeTruthy();
    // The slide: the short words on the track, the stop for a screen reader.
    const slide = screen.getByTestId('slide-arrive');
    expect(slide.props.accessibilityLabel).toBe('Slide when you arrive at Kurunegala site');
    expect(screen.getByText('Slide when you arrive')).toBeTruthy();
    expect(screen.getByText('Fill up on the way')).toBeTruthy();
    expect(errors.seen.map((a) => String(a[0]))).toEqual([]);
  });

  it('far from the stop: the distance and the override slide (the 300 m rule)', async () => {
    mockFar = true;
    show();
    await screen.findByText(/^You are \d+ km from Kurunegala site$/);
    expect(screen.queryByTestId('slide-arrive')).toBeNull();
    expect(screen.getByTestId('slide-override')).toBeTruthy();
  });

  it('Navigate opens Google Maps to the stop; Call calls the contact', async () => {
    show();
    fireEvent.press(await screen.findByTestId('task-navigate'));
    expect(openURL.mock.calls[0][0]).toMatch(/^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=7\.4867%2C80\.3647/);
    fireEvent.press(screen.getByTestId('task-call'));
    expect(openURL).toHaveBeenLastCalledWith('tel:+94771234567');
  });

  it('Problem with the vehicle? opens the report with the task and its vehicle', async () => {
    const r = show();
    fireEvent.press(await screen.findByText('Problem with the vehicle?'));
    await screen.findByText(/^report-problem /);
    expect(r.getPathname()).toBe('/report-problem');
    expect(screen.getByText(/^report-problem /).props.children).toContain('"taskId":"t-sample-1"');
    expect(screen.getByText(/^report-problem /).props.children).toContain('"vehicleId":"v-sample-1"');
  });

  it('the fill-up line opens Log fuel for the task', async () => {
    const r = show();
    fireEvent.press(await screen.findByTestId('fill-on-way'));
    await screen.findByText(/^log-mileage /);
    expect(r.getPathname()).toBe('/log-mileage');
    expect(screen.getByText(/^log-mileage /).props.children).toContain('"mode":"fuel"');
  });

  it('the stops button: every stop with Skip, All stops in Google Maps, the odometer, calls, Running late, Complete task', async () => {
    show();
    fireEvent.press(await screen.findByTestId('task-stops'));
    await screen.findByTestId('task-stops-sheet');
    expect(screen.getByText('Stops')).toBeTruthy();
    expect(screen.getAllByText(/Head office, Colombo 05|Kurunegala site|Kandy depot/).length).toBeGreaterThanOrEqual(3);
    expect(screen.getByTestId('stop-skip-s-sample-2')).toBeTruthy();
    expect(screen.getByText('All stops in Google Maps')).toBeTruthy();
    expect(screen.getByText('Start odo')).toBeTruthy();
    expect(screen.getByText('Call requester')).toBeTruthy();
    expect(screen.getByText(/^Approved by Palitha/)).toBeTruthy();
    expect(screen.getByText('Running late')).toBeTruthy();
    // Complete task waits for the last stop, as before.
    expect(screen.getByTestId('stops-complete').props.accessibilityState).toMatchObject({ disabled: true });
    // Skip closes the stops sheet and asks why.
    fireEvent.press(screen.getByTestId('stop-skip-s-sample-2'));
    await screen.findByText('Skip this stop?');
  });

  it('every stop done: Complete task on the sheet opens Log mileage to finish', async () => {
    mockAllDone = true;
    const r = show();
    await screen.findByText('All stops done');
    fireEvent.press(screen.getByTestId('task-complete'));
    await screen.findByText(/^log-mileage /);
    expect(r.getPathname()).toBe('/log-mileage');
    expect(screen.getByText(/^log-mileage /).props.children).toContain('"mode":"finish"');
  });
});
