// Round 4–7, item 12 (design/mockups/2026-10-22, mockup 5): the driver's Today in the mockup's layout keeps every action
// it had. The real screen through the router, with the design pages' sample state (src/design/sampleDriver.ts) and the
// English words (en.json with the strings sidecar merged in while it exists; a missing key fails the test):
//   the tiles: the duty switch (Finish work asks first), Start work off duty, Change vehicle, "✓ Checked" or "Check
//   needed" (which opens the check); the Next task card: the chip, the stepper, the people · km line, the call link and
//   ⋯ (every call with WhatsApp), Accept, Start task, Can't do this task, the card opening the task; Start a trip; the
//   "Later today · N" rows; All today's tasks; the language pill.
import { act, fireEvent, screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Alert, Linking, Text } from 'react-native';

import { failOnConsoleError } from './fakeOffice';

/** The English words: en.json with this round's strings sidecar merged in while it exists (after the lead's merge, en.json alone). */
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

let mockState: 'accepted' | 'new' | 'check' | 'off' = 'accepted';
const mockAccept = jest.fn();
const mockFinish = jest.fn(async () => 'off' as const);
let mockValue: Record<string, unknown> | null = null;
function mockApp() {
  if (!mockValue) {
    const { sampleApp } = require('../src/design/sampleDriver');
    const en = require('../src/i18n/en.json');
    mockValue = {
      ...sampleApp({ language: 'en', now: Date.now(), today: mockState }),
      t: mockWords(),
      tList: (key: string) => (Array.isArray(en[key]) ? en[key] : []),
      acceptTask: mockAccept,
      finishWork: mockFinish,
      requireLocation: async (_purpose: string, action: () => void) => {
        action();
        return true;
      },
    };
  }
  return mockValue;
}

jest.mock('@/state/app', () => ({ useApp: () => mockApp() }));
jest.mock('@/components/Photos', () => ({ Thumb: () => null, useVehicleThumbs: () => ({}) }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));

/* eslint-disable import/first */
import TodayScreen from '@/app/(tabs)/index';

/** A screen that says where it is and with what. */
const Where = (name: string) => function Shown() {
  const params = useLocalSearchParams();
  return <Text>{`${name} ${JSON.stringify(params)}`}</Text>;
};

const routes = {
  _layout: () => <Stack screenOptions={{ headerShown: false }} />,
  index: TodayScreen,
  'task/[id]': Where('task'),
  'log-mileage': Where('log-mileage'),
  vehicle: Where('vehicle'),
  'vehicle-check': Where('vehicle-check'),
  'start-trip': Where('start-trip'),
  'today-tasks': Where('today-tasks'),
};

let errors: ReturnType<typeof failOnConsoleError>;
let openURL: jest.SpyInstance;
let alert: jest.SpyInstance;
// The sample's later tasks are 6 and 8½ hours from now: the test's clock starts at 08:30 Colombo, so both are "later
// today" whenever it runs (CI at 15:59 put the second on tomorrow: "Later today · 1"). The clock runs on from there.
beforeAll(() => {
  jest.useFakeTimers({ advanceTimers: true, now: new Date('2026-10-22T03:00:00Z') });
});
afterAll(() => {
  jest.useRealTimers();
});
beforeEach(() => {
  mockValue = null;
  mockState = 'accepted';
  mockAccept.mockClear();
  mockFinish.mockClear();
  openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  errors = failOnConsoleError();
});
afterEach(() => {
  openURL.mockRestore();
  alert.mockRestore();
  errors.restore();
});

function show(state: typeof mockState = 'accepted') {
  mockState = state;
  return renderRouter(routes, { initialUrl: '/' });
}

describe("Today in the mockup's layout keeps every action", () => {
  it('the top bar, the tiles and the Next task card with its stepper and facts', async () => {
    show();
    await screen.findByText('Next task');
    expect(screen.getByText(/^Good (morning|afternoon|evening), Kamal$/)).toBeTruthy();
    expect(screen.getByText('සිංහල')).toBeTruthy();
    // The duty tile: on duty since …, the office sees the driver.
    expect(screen.getByText('On duty')).toBeTruthy();
    expect(screen.getByText(/since \d\d:\d\d · Office can see you/)).toBeTruthy();
    expect(screen.getByTestId('duty-switch').props.accessibilityState).toMatchObject({ checked: true });
    // The vehicle tile: checked today, the plate, the model and Change.
    expect(screen.getByText('Checked')).toBeTruthy();
    expect(screen.getByText('WP CAB-4521')).toBeTruthy();
    expect(screen.getByText('Toyota HiAce · Change')).toBeTruthy();
    // The card.
    expect(screen.getByTestId('next-task-chip')).toBeTruthy();
    expect(screen.getByText(/^Leave in (24|25) min$/)).toBeTruthy();
    expect(screen.getByText('leave from Head office, Colombo 05')).toBeTruthy();
    expect(screen.getByText('Team drop · Kurunegala site')).toBeTruthy();
    expect(screen.getByText('S')).toBeTruthy();
    expect(screen.getByText('Head office, Colombo 05 · pickup')).toBeTruthy();
    expect(screen.getByText('Kurunegala site · drop')).toBeTruthy();
    expect(screen.getByText('Kandy depot')).toBeTruthy();
    expect(screen.getByText('Back at base')).toBeTruthy();
    expect(screen.getByText(/^by \d\d:\d\d$/)).toBeTruthy();
    expect(screen.getByText('3 people')).toBeTruthy();
    expect(screen.getByText('197 km')).toBeTruthy();
    expect(screen.getByText(/^Accepted ✓ \d\d:\d\d$/)).toBeTruthy();
    expect(screen.getByText('Running late')).toBeTruthy();
    expect(screen.getByText("Can't make it")).toBeTruthy();
    expect(errors.seen.map((a) => String(a[0]))).toEqual([]);
  });

  it('Start task: the odometer screen of that task (Location first, as before)', async () => {
    const r = show();
    fireEvent.press(await screen.findByText('Start task'));
    await screen.findByText(/^log-mileage /);
    expect(r.getPathname()).toBe('/log-mileage');
    expect(screen.getByText(/^log-mileage /).props.children).toContain('"mode":"start"');
    expect(screen.getByText(/^log-mileage /).props.children).toContain('"taskId":"t-sample-1"');
  });

  it('the card opens the whole task', async () => {
    const r = show();
    fireEvent.press(await screen.findByTestId('next-task-open'));
    await screen.findByText(/^task /);
    expect(r.getPathname()).toBe('/task/t-sample-1');
  });

  it('Call: the contact at once; ⋯ lists every person with WhatsApp', async () => {
    show();
    fireEvent.press(await screen.findByText('Ashan W.'));
    expect(openURL).toHaveBeenCalledWith('tel:+94771234567');
    fireEvent.press(screen.getByTestId('today-calls-more'));
    await screen.findByText('Call or WhatsApp');
    expect(screen.getByText('Call requester')).toBeTruthy();
    expect(screen.getAllByLabelText(/^WhatsApp /).length).toBeGreaterThan(1);
  });

  it('Later today · 2: the rows open their task; All today\'s tasks; Start a trip; Change vehicle', async () => {
    const r = show();
    await screen.findByText('Later today · 2');
    expect(screen.getByText('Kurunegala → Kandy depot')).toBeTruthy();
    expect(screen.getByText('Not accepted yet')).toBeTruthy();
    expect(screen.getByText('Accepted')).toBeTruthy();
    expect(screen.getByText(/^2 people · 58 km/)).toBeTruthy();
    fireEvent.press(screen.getByText('Kurunegala → Kandy depot'));
    await screen.findByText(/^task /);
    expect(r.getPathname()).toBe('/task/t-sample-2');
    act(() => router.back());
    fireEvent.press(await screen.findByText("All today's tasks"));
    await screen.findByText(/^today-tasks/);
    act(() => router.back());
    fireEvent.press(await screen.findByText('Start a trip'));
    await screen.findByText(/^start-trip/);
    act(() => router.back());
    fireEvent.press(await screen.findByTestId('vehicle-tile-change'));
    await screen.findByText(/^vehicle /);
    expect(screen.getByText(/^vehicle /).props.children).toContain('"mode":"change"');
  });

  it('the duty switch is Finish work, asked first', async () => {
    show();
    fireEvent.press(await screen.findByTestId('duty-switch'));
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0][0]).toBe('Finish work? Location stops.');
    const yes = (alert.mock.calls[0][2] as { text: string; onPress?: () => void }[]).find((b) => b.text === 'Finish work');
    await act(async () => yes?.onPress?.());
    expect(mockFinish).toHaveBeenCalledTimes(1);
  });

  it('not accepted yet: Accept, Start task and Can\'t do this task (its reasons)', async () => {
    show('new');
    fireEvent.press(await screen.findByText('Accept'));
    expect(mockAccept).toHaveBeenCalledWith(expect.objectContaining({ id: 't-sample-1' }));
    expect(screen.getByText('Start task')).toBeTruthy();
    fireEvent.press(screen.getByText("Can't do this task"));
    await screen.findByText("Can't do this task?");
  });

  it('the vehicle check needed: "Check needed" opens the check for the vehicle held', async () => {
    const r = show('check');
    fireEvent.press(await screen.findByText('Check needed'));
    await screen.findByText(/^vehicle-check /);
    expect(r.getPathname()).toBe('/vehicle-check');
    expect(screen.getByText(/^vehicle-check /).props.children).toContain('"vehicleId":"v-sample-1"');
    expect(screen.getByText(/^vehicle-check /).props.children).toContain('"how":"clock_in"');
  });

  it('off duty: the grey tile with Start work (the vehicle picker), no Start a trip', async () => {
    const r = show('off');
    await screen.findByText('Off duty');
    expect(screen.getByText('Start work to record trips and mileage.')).toBeTruthy();
    expect(screen.queryByText('Start a trip')).toBeNull();
    expect(screen.getByText('No vehicle')).toBeTruthy();
    fireEvent.press(screen.getByTestId('duty-start-work'));
    await screen.findByText(/^vehicle /);
    expect(r.getPathname()).toBe('/vehicle');
    expect(screen.getByText(/^vehicle /).props.children).toContain('"mode":"start"');
  });
});
