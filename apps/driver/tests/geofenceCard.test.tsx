// Round 2b (21 October 2026): a stop driven past. 60 s within 150 m of the next stop while the current one was never
// Arrived: "Did you stop at …?" with the slide "Yes, I was there" (Arrived and Left now, marked as a far-away Arrived is,
// Undo reverts both) and "Skip it" (the skip sheet's reasons).
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockApp = {
  markStopArrived: jest.fn(),
  markStopDone: jest.fn(),
  markStopPassed: jest.fn(),
  undoStopStep: jest.fn(),
};
jest.mock('@/state/app', () => ({ useApp: () => ({ ...require('./fakeOffice').mockUseApp(), ...mockApp }) }));

/* eslint-disable import/first */
import type { Here } from '@/components/ArrivalButton';
import { GeofenceCard } from '@/components/GeofenceCard';
import { hideSnackbar, shownSnackbar } from '@/components/patterns/Snackbar';
import type { TaskStop, TaskWithStops } from '@/lib/types';

const SAFE = { frame: { x: 0, y: 0, width: 412, height: 915 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const T0 = Date.parse('2026-10-21T04:00:00Z');
const stop = (seq: number): TaskStop => ({
  id: `s${seq}`, task_id: 'task', seq, type: 'drop', status: 'pending', place_name: `Place ${seq}`,
  lat: 7 + seq / 100, lng: 80, arrived_at: null, done_at: null,
} as TaskStop);
const task = { id: 'task', status: 'in_progress', task_stops: [stop(1), stop(2)] } as unknown as TaskWithStops;
// At Stop 2 (about 1.1 km past Stop 1).
const atNext = (now: number): Here => ({ fix: { lat: 7.02, lng: 80, accuracyM: 10 }, now });

function Card({ here, onSkip }: { here: Here; onSkip: (s: TaskStop) => void }) {
  return (
    <SafeAreaProvider initialMetrics={SAFE}>
      <GeofenceCard task={task} here={here} onSkip={onSkip} />
    </SafeAreaProvider>
  );
}

function slideAll(testID: string) {
  fireEvent(screen.getByTestId(testID), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 64 } } });
  const thumb = screen.getByTestId(`${testID}-thumb`);
  fireEvent(thumb, 'responderGrant', { nativeEvent: { pageX: 0 } });
  fireEvent(thumb, 'responderMove', { nativeEvent: { pageX: 400 } });
  fireEvent(thumb, 'responderRelease', { nativeEvent: { pageX: 400 } });
}

beforeEach(() => {
  jest.useFakeTimers();
  Object.values(mockApp).forEach((f) => f.mockClear());
  hideSnackbar();
});
afterEach(() => {
  jest.useRealTimers();
});

describe('GeofenceCard: a stop driven past', () => {
  it('asks only after 60 s at the next stop', () => {
    const onSkip = jest.fn();
    const view = render(<Card here={atNext(T0)} onSkip={onSkip} />);
    expect(screen.queryByTestId('geofence-card')).toBeNull();
    view.rerender(<Card here={atNext(T0 + 30_000)} onSkip={onSkip} />);
    expect(screen.queryByTestId('geofence-card')).toBeNull();
    view.rerender(<Card here={atNext(T0 + 60_000)} onSkip={onSkip} />);
    expect(screen.getByText('Did you stop at Place 1?')).toBeTruthy();
    expect(screen.getByText('Yes, I was there')).toBeTruthy();
    expect(screen.getByText('Skip it')).toBeTruthy();
  });

  it('"Yes, I was there" marks it Arrived and Left, flagged with the distance, with Undo for both', () => {
    const view = render(<Card here={atNext(T0)} onSkip={jest.fn()} />);
    view.rerender(<Card here={atNext(T0 + 60_000)} onSkip={jest.fn()} />);
    slideAll('geofence-passed-yes');
    act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(mockApp.markStopPassed).toHaveBeenCalledTimes(1);
    const [passed, record] = mockApp.markStopPassed.mock.calls[0];
    expect(passed.id).toBe('s1');
    expect(record.flag).toBe('override');
    expect(record.distanceM).toBeGreaterThan(1000);
    const snack = shownSnackbar();
    expect(snack?.text).toBe('Place 1 marked as visited');
    act(() => snack?.action?.onPress());
    expect(mockApp.undoStopStep.mock.calls.map((c) => c[1])).toEqual(['left', 'arrived']);
  });

  it('"Skip it" opens the skip reasons for the passed stop', () => {
    const onSkip = jest.fn();
    const view = render(<Card here={atNext(T0)} onSkip={onSkip} />);
    view.rerender(<Card here={atNext(T0 + 60_000)} onSkip={onSkip} />);
    fireEvent.press(screen.getByTestId('geofence-passed-skip'));
    expect(onSkip).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }));
    expect(mockApp.markStopPassed).not.toHaveBeenCalled();
  });
});
