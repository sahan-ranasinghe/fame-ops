// Round 2 (21 October 2026): the slide-to-confirm (Uber's "slide to arrive") and the stop slides built on it. A tap never
// completes it; let go under 90 % it springs back; at 90 % or more it completes; the screen reader's "activate" completes
// it. The current stop: the arrive slide (the 300 m rule), the leave slide, "Slide to finish" on the last stop, Undo.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockApp = {
  markStopArrived: jest.fn(),
  markStopDone: jest.fn(),
  undoStopStep: jest.fn(),
};
jest.mock('@/state/app', () => ({ useApp: () => ({ ...require('./fakeOffice').mockUseApp(), ...mockApp }) }));

/* eslint-disable import/first */
import { ArrivalButton, type Here } from '@/components/ArrivalButton';
import { hideSnackbar, shownSnackbar } from '@/components/patterns/Snackbar';
import { SlideToConfirm } from '@/components/patterns/SlideToConfirm';
import type { TaskStop } from '@/lib/types';

const SAFE = { frame: { x: 0, y: 0, width: 412, height: 915 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
// A 400 px track: the thumb (56) with 4 px padding each side travels 336 px; 90 % = 302.4 px.
const WIDTH = 400;
const TRAVEL = 336;

function layout(testID: string) {
  fireEvent(screen.getByTestId(testID), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: WIDTH, height: 64 } } });
}
function drag(testID: string, dx: number) {
  const thumb = screen.getByTestId(`${testID}-thumb`);
  fireEvent(thumb, 'responderGrant', { nativeEvent: { pageX: 20 } });
  fireEvent(thumb, 'responderMove', { nativeEvent: { pageX: 20 + dx / 2 } });
  fireEvent(thumb, 'responderMove', { nativeEvent: { pageX: 20 + dx } });
  fireEvent(thumb, 'responderRelease', { nativeEvent: { pageX: 20 + dx } });
}
const offset = (testID: string): number => {
  const style = screen.getByTestId(`${testID}-thumb`).props.style;
  const flat = (Array.isArray(style) ? Object.assign({}, ...style.flat(Infinity)) : style) as { transform?: { translateX: number }[] };
  return flat.transform?.[0]?.translateX ?? 0;
};

function Slide(props: { onConfirm: () => void; disabled?: boolean; busy?: boolean }) {
  return (
    <SafeAreaProvider initialMetrics={SAFE}>
      <SlideToConfirm label="Slide when you arrive at Kurunegala site" testID="s" {...props} />
    </SafeAreaProvider>
  );
}

beforeEach(() => {
  jest.useFakeTimers();
  Object.values(mockApp).forEach((f) => f.mockClear());
  hideSnackbar();
});
afterEach(() => {
  jest.useRealTimers();
});

describe('SlideToConfirm', () => {
  it('a tap or a press never completes it', () => {
    const onConfirm = jest.fn();
    render(<Slide onConfirm={onConfirm} />);
    layout('s');
    fireEvent.press(screen.getByTestId('s'));
    fireEvent.press(screen.getByTestId('s-thumb'));
    drag('s', 0);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('let go under 90 % it springs back and nothing happens', () => {
    const onConfirm = jest.fn();
    render(<Slide onConfirm={onConfirm} />);
    layout('s');
    const thumb = screen.getByTestId('s-thumb');
    fireEvent(thumb, 'responderGrant', { nativeEvent: { pageX: 0 } });
    fireEvent(thumb, 'responderMove', { nativeEvent: { pageX: Math.round(TRAVEL * 0.85) } });
    expect(offset('s')).toBe(Math.round(TRAVEL * 0.85));
    fireEvent(thumb, 'responderRelease', { nativeEvent: { pageX: Math.round(TRAVEL * 0.85) } });
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(offset('s')).toBeLessThan(1);
  });

  it('a drag past the end is held at the end; let go at 90 % or more it completes once', () => {
    const onConfirm = jest.fn();
    render(<Slide onConfirm={onConfirm} />);
    layout('s');
    const thumb = screen.getByTestId('s-thumb');
    fireEvent(thumb, 'responderGrant', { nativeEvent: { pageX: 0 } });
    fireEvent(thumb, 'responderMove', { nativeEvent: { pageX: 900 } });
    expect(offset('s')).toBe(TRAVEL);
    fireEvent(thumb, 'responderRelease', { nativeEvent: { pageX: 900 } });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    drag('s', Math.ceil(TRAVEL * 0.9));
    expect(onConfirm).toHaveBeenCalledTimes(2);
  });

  it('the screen reader\'s "activate" completes it (the one path without a drag)', () => {
    const onConfirm = jest.fn();
    render(<Slide onConfirm={onConfirm} />);
    const track = screen.getByTestId('s');
    expect(track.props.accessibilityRole).toBe('adjustable');
    expect(track.props.accessibilityActions).toEqual([{ name: 'activate', label: 'Slide when you arrive at Kurunegala site' }]);
    fireEvent(track, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent(track, 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('disabled or busy: neither a slide nor "activate" completes it', () => {
    for (const lock of [{ disabled: true }, { busy: true }]) {
      const onConfirm = jest.fn();
      const view = render(<Slide onConfirm={onConfirm} {...lock} />);
      layout('s');
      drag('s', TRAVEL);
      fireEvent(screen.getByTestId('s'), 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
      expect(onConfirm).not.toHaveBeenCalled();
      expect(screen.getByTestId('s').props.accessibilityState).toMatchObject({ disabled: true });
      view.unmount();
    }
  });
});

const stop = (over: Partial<TaskStop> = {}): TaskStop => ({
  id: 'stop-1', task_id: 'task-1', seq: 1, type: 'drop', status: 'pending', place_name: 'Kurunegala site',
  lat: 7.48, lng: 80.36, arrived_at: null, done_at: null, planned_arrive_at: null, planned_depart_at: null,
  ...over,
} as TaskStop);
const near: Here = { fix: { lat: 7.4801, lng: 80.3601, accuracyM: 10 }, now: Date.now() };
const far: Here = { fix: { lat: 7.9, lng: 80.36, accuracyM: 10 }, now: Date.now() };

function Arrival(props: { stop: TaskStop; here: Here; last?: boolean; onFinish?: (s: TaskStop) => void }) {
  return (
    <SafeAreaProvider initialMetrics={SAFE}>
      <ArrivalButton {...props} />
    </SafeAreaProvider>
  );
}

describe('The current stop\'s slides', () => {
  it('near the stop: "Slide when you arrive at …"; a tap does nothing; the slide marks Arrived (ok) with Undo', () => {
    render(<Arrival stop={stop()} here={near} />);
    expect(screen.getByText('Slide when you arrive at Kurunegala site')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Arrived' })).toBeNull();
    layout('slide-arrive');
    fireEvent.press(screen.getByTestId('slide-arrive'));
    expect(mockApp.markStopArrived).not.toHaveBeenCalled();
    drag('slide-arrive', TRAVEL);
    expect(mockApp.markStopArrived).toHaveBeenCalledTimes(1);
    expect(mockApp.markStopArrived.mock.calls[0][1]).toMatchObject({ flag: 'ok' });
    const snack = shownSnackbar();
    expect(snack?.text).toBe('Arrived at Kurunegala site');
    expect(snack?.ms).toBe(6000);
    snack?.action?.onPress();
    expect(mockApp.undoStopStep).toHaveBeenCalledWith(expect.objectContaining({ id: 'stop-1' }), 'arrived');
  });

  it('far from the stop: the override is a slide too, recorded as an override', () => {
    render(<Arrival stop={stop()} here={far} />);
    expect(screen.queryByTestId('slide-arrive')).toBeNull();
    layout('slide-override');
    drag('slide-override', TRAVEL);
    expect(mockApp.markStopArrived.mock.calls[0][1]).toMatchObject({ flag: 'override' });
  });

  it('arrived: "Slide when you leave …" marks Left with Undo', () => {
    render(<Arrival stop={stop({ status: 'arrived', arrived_at: '2026-10-21T05:00:00Z' })} here={near} />);
    layout('slide-leave');
    drag('slide-leave', TRAVEL);
    expect(mockApp.markStopDone).toHaveBeenCalledTimes(1);
    expect(shownSnackbar()?.text).toBe('Left Kurunegala site');
    shownSnackbar()?.action?.onPress();
    expect(mockApp.undoStopStep).toHaveBeenCalledWith(expect.objectContaining({ id: 'stop-1' }), 'left');
  });

  it('the last stop: "Slide to finish" hands over to the finish (Log mileage), no Undo', () => {
    const onFinish = jest.fn();
    render(<Arrival stop={stop({ status: 'arrived', arrived_at: '2026-10-21T05:00:00Z' })} here={near} last onFinish={onFinish} />);
    expect(screen.getByText('Slide to finish')).toBeTruthy();
    layout('slide-finish');
    fireEvent.press(screen.getByTestId('slide-finish'));
    expect(onFinish).not.toHaveBeenCalled();
    drag('slide-finish', TRAVEL);
    expect(onFinish).toHaveBeenCalledWith(expect.objectContaining({ id: 'stop-1' }));
    expect(mockApp.markStopDone).not.toHaveBeenCalled();
    expect(shownSnackbar()).toBeNull();
  });
});
