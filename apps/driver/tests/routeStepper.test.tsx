// Part B (docs/design-pass.md §4.5): the RouteStepper, rendered. Compact (the driver's sheet): the step in focus open with
// its parts, a kept step open too, any other step opens with a tap; a stop's note is never hidden; done and skipped say so
// in words beside the colour (R3).
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { mockUseApp } from './fakeOffice';

jest.mock('@/state/app', () => ({ useApp: () => require('./fakeOffice').mockUseApp() }));

/* eslint-disable import/first */
import { RouteStepper, type Step } from '@/components/patterns/RouteStepper';

void mockUseApp;

const steps: Step[] = [
  { key: 'a', mark: '1', state: 'done', place: 'Office', type: 'Stop 1 · Pickup', times: 'Arrived 09:01 · Left 09:06', stateWord: 'Done' },
  { key: 'b', mark: '2', state: 'skipped', place: 'Closed shop', type: 'Stop 2 · Visit', times: 'Skipped · closed', stateWord: 'Skipped' },
  { key: 'c', mark: '3', state: 'next', place: 'Kurunegala site', type: 'Stop 3 · Drop', times: 'Arrive by 10:30', extra: <Text>slide here</Text> },
  { key: 'd', mark: '4', state: 'todo', place: 'Depot', type: 'Stop 4 · Visit', note: 'Gate code 4411', noteTone: 'amber' },
  { key: 'e', mark: '5', state: 'todo', place: 'Shop out of order', type: 'Stop 5 · Visit', keepOpen: true, extra: <Text>its own slide</Text> },
];

describe('RouteStepper', () => {
  it('compact: the focus open with its parts, a kept step open, the others one line until tapped', () => {
    render(<RouteStepper steps={steps} compact />);
    expect(screen.getByText('slide here')).toBeTruthy();
    expect(screen.getByText('its own slide')).toBeTruthy();
    expect(screen.queryByText('Stop 1 · Pickup')).toBeNull();
    expect(screen.queryByText('Arrived 09:01 · Left 09:06')).toBeNull();
    fireEvent.press(screen.getByTestId('route-stepper-open-a'));
    expect(screen.getByText('Stop 1 · Pickup')).toBeTruthy();
    expect(screen.getByText('Arrived 09:01 · Left 09:06')).toBeTruthy();
    fireEvent.press(screen.getByTestId('route-stepper-open-a'));
    expect(screen.queryByText('Arrived 09:01 · Left 09:06')).toBeNull();
  });

  it('a stop\'s note shows on a closed row; done and skipped say so in words', () => {
    render(<RouteStepper steps={steps} compact />);
    expect(screen.getByText('Gate code 4411')).toBeTruthy();
    expect(screen.getByText('Done')).toBeTruthy();
    expect(screen.getByText('Skipped')).toBeTruthy();
  });

  it('full (a detail page): every step open, nothing to tap', () => {
    render(<RouteStepper steps={steps} />);
    expect(screen.getByText('Stop 1 · Pickup')).toBeTruthy();
    expect(screen.getByText('Stop 4 · Visit')).toBeTruthy();
    expect(screen.queryByTestId('route-stepper-open-a')).toBeNull();
  });
});
