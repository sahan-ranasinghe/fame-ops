// The pickers (21 October 2026): the time field's sheet is the presets and the clock (Material 3's time picker, any minute,
// a keyboard toggle); nothing internal is shown. Runs on the app's components as Office mode, /m/ and the driver app use them.
import { fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

jest.mock('@/state/app', () => ({ useApp: () => require('./fakeOffice').mockUseApp() }));

/* eslint-disable import/first */
import { DurationField } from '@/components/patterns/DurationField';
import { TimeField } from '@/components/patterns/TimeField';

function Harness({ initial = '', suggested, onCommit }: { initial?: string; suggested?: string; onCommit: (v: string) => void }) {
  const [v, setV] = useState(initial);
  return (
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 412, height: 915 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      <TimeField value={v} onCommit={(x) => { setV(x); onCommit(x); }} label="Leave by" suggested={suggested} testID="leave" />
    </SafeAreaProvider>
  );
}

describe('The time field: presets and the clock', () => {
  it('a preset counts at once; Now is its own choice and every common time is there', () => {
    const commits: string[] = [];
    render(<Harness onCommit={(v) => commits.push(v)} />);
    fireEvent.press(screen.getByTestId('leave'));
    expect(screen.getByTestId('time-clock')).toBeTruthy();
    for (const c of ['08:00', '09:00', '12:00', '13:00', '17:00']) expect(screen.getByTestId(`time-quick-${c}`)).toBeTruthy();
    expect(screen.getByTestId('time-quick-now')).toBeTruthy();
    fireEvent.press(screen.getByTestId('time-quick-09:00'));
    expect(commits).toEqual(['09:00']);
  });

  it('the clock: the hour then the minute, any minute (its adjustable steps), then Done', () => {
    const commits: string[] = [];
    render(<Harness suggested="07:24" onCommit={(v) => commits.push(v)} />);
    fireEvent.press(screen.getByTestId('leave'));
    const dial = screen.getByTestId('time-dial');
    fireEvent(dial, 'onAccessibilityAction', { nativeEvent: { actionName: 'increment' } });
    fireEvent.press(screen.getByTestId('time-part-minute'));
    fireEvent(screen.getByTestId('time-dial'), 'onAccessibilityAction', { nativeEvent: { actionName: 'increment' } });
    fireEvent.press(screen.getByText('Done'));
    expect(commits).toEqual(['08:25']);
  });

  it('the keyboard toggle types the time', () => {
    const commits: string[] = [];
    render(<Harness onCommit={(v) => commits.push(v)} />);
    fireEvent.press(screen.getByTestId('leave'));
    fireEvent.press(screen.getByTestId('time-keyboard'));
    fireEvent.changeText(screen.getByTestId('time-type-hour'), '14');
    fireEvent.changeText(screen.getByTestId('time-type-minute'), '37');
    fireEvent.press(screen.getByText('Done'));
    expect(commits).toEqual(['14:37']);
  });
});

const SAFE = { frame: { x: 0, y: 0, width: 412, height: 915 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

function StayHarness({ suggestedMin, onCommit }: { suggestedMin?: number; onCommit: (v: string) => void }) {
  const [v, setV] = useState('');
  return (
    <SafeAreaProvider initialMetrics={SAFE}>
      <DurationField value={v} onCommit={(x) => { setV(x); onCommit(x); }} suggestedMin={suggestedMin} testID="stay" />
    </SafeAreaProvider>
  );
}

describe('The Stay field (Google Calendar\'s duration)', () => {
  it('shows the suggested stay in grey, then a preset counts at once', () => {
    const commits: string[] = [];
    render(<StayHarness suggestedMin={60} onCommit={(v) => commits.push(v)} />);
    expect(screen.getByText('1 h · suggested')).toBeTruthy();
    fireEvent.press(screen.getByTestId('stay'));
    for (const m of [5, 15, 30, 60, 120, 240]) expect(screen.getByTestId(`stay-${m}`)).toBeTruthy();
    fireEvent.press(screen.getByTestId('stay-30'));
    expect(commits).toEqual(['30']);
    expect(screen.getByText('30 min')).toBeTruthy();
  });

  it('Custom: an hours column and a minutes column, so 5 h is two taps', () => {
    const commits: string[] = [];
    render(<StayHarness onCommit={(v) => commits.push(v)} />);
    fireEvent.press(screen.getByTestId('stay'));
    fireEvent.press(screen.getByTestId('stay-custom'));
    fireEvent.press(screen.getByTestId('stay-hours-5'));
    fireEvent.press(screen.getByTestId('stay-minutes-0'));
    fireEvent.press(screen.getByText('Done'));
    expect(commits).toEqual(['300']);
  });
});
