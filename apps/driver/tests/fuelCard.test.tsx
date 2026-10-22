// Round 4–7 (docs/phase8-plan.md §33.2, §33.3): the fuel card at Start task, the passengers on the task, and the "Fill up
// on the way" reminder, rendered. The card says the trip's km and roughly how many litres (the server's estimate, kept on
// the phone for no connection), asks "Enough fuel?" (Yes / I'll fill up on the way: optional, never holding the start),
// says "check the battery" for an electric vehicle without asking, and hides with no km or the switch off. The passengers:
// each name, Call only with a phone, nothing with the switch off. The reminder: 30 minutes, on the reminders channel, its
// tap carrying the task; cancelled with the one in the tray.
// The words: en.json with the strings sidecars (src/i18n/parts) merged in while they exist; a missing key fails the test.
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react-native';

let mockSettings: Record<string, unknown> = {};
let mockOffline = false;
const mockEstimate = jest.fn();
const mockSchedule = jest.fn(async (_req: unknown) => 'id');
const mockCancel = jest.fn(async (_id: string) => undefined);
const mockDismiss = jest.fn(async (_id: string) => undefined);

/** The English words: en.json with this piece's strings sidecar merged in while it exists (after the lead's merge, en.json alone). */
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
    merge(en, require('../src/i18n/parts/driver-2.json').en ?? {});
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

jest.mock('@/state/app', () => ({
  useApp: () => {
    mockT ??= mockWords();
    return {
      t: mockT,
      tList: () => [],
      language: 'en',
      settings: { ...require('../src/lib/api').DEFAULT_DRIVER_SETTINGS, ...mockSettings },
      offline: mockOffline,
      dataAvailable: !mockOffline,
    };
  },
}));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/api', () => ({ ...jest.requireActual('@/lib/api'), fetchFuelEstimate: (...a: unknown[]) => mockEstimate(...a) }));
jest.mock('@/office/store', () => ({ getOfficeMe: () => null, useOfficeMe: () => null, setOfficeMe: () => undefined }));
jest.mock('expo-application', () => ({ nativeApplicationVersion: '1.3.0' }));
jest.mock('expo-notifications', () => ({
  setNotificationHandler: () => undefined,
  getPermissionsAsync: async () => ({ granted: true }),
  setNotificationChannelAsync: async () => null,
  deleteNotificationChannelAsync: async () => undefined,
  getPresentedNotificationsAsync: async () => [],
  scheduleNotificationAsync: (req: unknown) => mockSchedule(req),
  cancelScheduledNotificationAsync: (id: string) => mockCancel(id),
  dismissNotificationAsync: (id: string) => mockDismiss(id),
  addNotificationReceivedListener: () => ({ remove: () => undefined }),
  addNotificationResponseReceivedListener: () => ({ remove: () => undefined }),
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval', WEEKLY: 'weekly' },
  AndroidImportance: { MAX: 5, HIGH: 4, DEFAULT: 3 },
  AndroidNotificationVisibility: { PUBLIC: 1 },
}));

/* eslint-disable import/first */
import { FuelCard } from '@/components/FuelCard';
import { PassengerList } from '@/components/Passengers';
import { getJson, KEYS, remove, setJson } from '@/lib/kv';
import { useFuelReminderSwitch } from '@/lib/fuelReminderSwitch';
import { armFuelReminder, disarmFuelReminder } from '@/lib/notifications';
import type { TaskWithStops, Vehicle } from '@/lib/types';

const task = { id: 't1', plan_json: { total_km: 180 }, fuel_answer: null, fuel_answer_at: null, task_passengers: [] } as unknown as TaskWithStops;
const van = { id: 'v1', reg_no: 'WP CAB-4521', fuel_type: 'petrol', fuel_grade: 'petrol_92' } as unknown as Vehicle;
const server = { task_id: 't1', km: 180, fuel_type: 'petrol', electric: false, km_per_l: 12, source: 'default', litres_low: 13, litres_high: 17 };

beforeEach(() => {
  mockSettings = {};
  mockOffline = false;
  mockEstimate.mockReset();
  mockSchedule.mockClear();
  mockCancel.mockClear();
  mockDismiss.mockClear();
  remove(KEYS.fuelEstimates);
});

describe('Start task: the Trip info card', () => {
  it('the km and the litres from the server, "Enough fuel?" with Yes / I\'ll fill up on the way (optional)', async () => {
    mockEstimate.mockResolvedValue(require('@/lib/fuelCard').parseFuelEstimate(server));
    const answers: string[] = [];
    const view = render(<FuelCard task={task} vehicle={van} answer={null} onAnswer={(a) => answers.push(a)} />);
    // At once what the phone knows (the plan's km), then the server's litres.
    expect(screen.getByTestId('fuel-card-line').props.children).toBe('About 180 km');
    await waitFor(() => expect(screen.getByTestId('fuel-card-line').props.children).toBe('About 180 km · roughly 13–17 L petrol (approx.)'));
    expect(mockEstimate).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Enough fuel?')).toBeTruthy();
    expect(screen.getByText('A rough figure for this kind of vehicle')).toBeTruthy();
    fireEvent.press(screen.getByText("I'll fill up on the way"));
    expect(answers).toEqual(['fill_on_way']);
    view.rerender(<FuelCard task={task} vehicle={van} answer="fill_on_way" onAnswer={(a) => answers.push(a)} />);
    expect(screen.getByText("We'll remind you in 30 min to log the fill.")).toBeTruthy();
    // Kept on the phone for the next time (no connection).
    expect(getJson<Record<string, unknown>>(KEYS.fuelEstimates)?.t1).toBeTruthy();
  });

  it('no connection: the copy kept on the phone, nothing asked', async () => {
    mockOffline = true;
    setJson(KEYS.fuelEstimates, { t1: require('@/lib/fuelCard').parseFuelEstimate({ ...server, litres_low: 12, litres_high: 12 }) });
    render(<FuelCard task={task} vehicle={van} answer={null} onAnswer={() => undefined} />);
    expect(screen.getByTestId('fuel-card-line').props.children).toBe('About 180 km · roughly 12 L petrol (approx.)');
    await act(async () => undefined);
    expect(mockEstimate).not.toHaveBeenCalled();
  });

  it('electric: "check the battery", no question', async () => {
    mockEstimate.mockResolvedValue(require('@/lib/fuelCard').parseFuelEstimate({ task_id: 't1', km: 180, fuel_type: 'electric', electric: true }));
    render(<FuelCard task={task} vehicle={{ ...van, fuel_type: 'electric' }} answer={null} onAnswer={() => undefined} />);
    await waitFor(() => expect(screen.getByTestId('fuel-card-line').props.children).toBe('About 180 km · check the battery'));
    expect(screen.queryByText('Enough fuel?')).toBeNull();
  });

  it('no km (no plan), or the switch off: no card', async () => {
    mockEstimate.mockResolvedValue(null);
    const noPlan = { ...task, plan_json: null } as TaskWithStops;
    const view = render(<FuelCard task={noPlan} vehicle={van} answer={null} onAnswer={() => undefined} />);
    await act(async () => undefined);
    expect(screen.queryByTestId('fuel-card')).toBeNull();
    view.unmount();
    mockSettings = { fuel_card: false };
    render(<FuelCard task={task} vehicle={van} answer={null} onAnswer={() => undefined} />);
    await act(async () => undefined);
    expect(screen.queryByTestId('fuel-card')).toBeNull();
    expect(mockEstimate).toHaveBeenCalledTimes(1);
  });
});

describe('The passengers on the task', () => {
  const riding = {
    ...task,
    task_passengers: [
      { id: 'p1', name: 'Nimal Perera', phone: '+94771234567', removed_at: null },
      { id: 'p2', name: 'Kamal Silva', phone: null, removed_at: null },
    ],
  } as TaskWithStops;

  it('each name; Call only for those with a phone', () => {
    render(<PassengerList task={riding} />);
    expect(screen.getByText('Passengers')).toBeTruthy();
    expect(screen.getByText('Nimal Perera')).toBeTruthy();
    expect(screen.getByText('077 123 4567')).toBeTruthy();
    expect(screen.getByText('Kamal Silva')).toBeTruthy();
    expect(screen.getAllByTestId('passenger-call')).toHaveLength(1);
    expect(screen.getByLabelText('Call Nimal Perera')).toBeTruthy();
  });

  it('the switch off, or nobody named: nothing', () => {
    mockSettings = { passengers: false };
    const view = render(<PassengerList task={riding} />);
    expect(screen.queryByTestId('passenger-list')).toBeNull();
    view.unmount();
    mockSettings = {};
    render(<PassengerList task={task} />);
    expect(screen.queryByTestId('passenger-list')).toBeNull();
  });
});

describe('"Fill up on the way? Log fuel"', () => {
  it('30 minutes on, on the reminders channel, its tap carrying the task; cancelled with the one in the tray', async () => {
    await armFuelReminder('t1', { title: 'Fill up on the way?', body: 'Tap to log fuel.' }, 30 * 60_000);
    expect(mockSchedule).toHaveBeenCalledWith({
      identifier: 'fuel-reminder',
      content: { title: 'Fill up on the way?', body: 'Tap to log fuel.', data: { kind: 'fuel', taskId: 't1' } },
      trigger: { type: 'timeInterval', seconds: 1800, channelId: 'task-reminders' },
    });
    await disarmFuelReminder();
    expect(mockCancel).toHaveBeenCalledWith('fuel-reminder');
    expect(mockDismiss).toHaveBeenCalledWith('fuel-reminder');
  });

  // Review of Round 4–7: the office turns the switch fuel_card off while a reminder is armed: it never fires.
  it('the switch going off cancels a reminder already armed (and the one in the tray); on, nothing is cancelled', async () => {
    await armFuelReminder('t1', { title: 'Fill up on the way?', body: 'Tap to log fuel.' }, 30 * 60_000);
    mockCancel.mockClear();
    mockDismiss.mockClear();
    const { rerender } = renderHook(({ on }: { on: boolean }) => useFuelReminderSwitch(on), { initialProps: { on: true } });
    await act(async () => undefined);
    expect(mockCancel).not.toHaveBeenCalled();
    rerender({ on: false });
    await waitFor(() => expect(mockCancel).toHaveBeenCalledWith('fuel-reminder'));
    expect(mockDismiss).toHaveBeenCalledWith('fuel-reminder');
  });
});
