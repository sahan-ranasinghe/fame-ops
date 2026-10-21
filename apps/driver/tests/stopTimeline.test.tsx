// Round 2: the live stop timeline (components/office/StopTimeline.tsx) as Office mode and /m/ draw it: the words, the
// late / early colours, the stop to come re-estimated, and nothing internal (a skip code in words).
import { render, screen } from '@testing-library/react-native';

jest.mock('@/state/app', () => ({ useApp: () => require('./fakeOffice').mockUseApp() }));

/* eslint-disable import/first */
import { StopTimeline } from '@/components/office/StopTimeline';
import type { Stop } from '@/office/types';
import { colors } from '@/theme';

const stops = [
  { id: 'a', seq: 1, n: 1, place: 'Office', status: 'done', progress: { planned_arrive: '09:00', arrived: '09:01', left: '09:06', arrive_delta_min: 1 } },
  { id: 'b', seq: 2, n: 2, place: 'Wariyapola', status: 'arrived', progress: { planned_arrive: '10:30', arrived: '10:52', arrive_delta_min: 22, current: true } },
  { id: 'c', seq: 3, n: 3, place: 'Kurunegala', status: 'pending', arrive_by: '12:30', progress: { planned_arrive: '12:00', estimate: { arrive: '12:22', updated: '10:52' } } },
  { id: 'd', seq: 4, n: 4, place: 'Site', status: 'skipped', skip_reason: 'nobody_there', progress: { planned_arrive: '13:00' } },
] as Stop[];

const flat = (style: unknown): Record<string, unknown> => (Array.isArray(style) ? Object.assign({}, ...style.flat(Infinity).filter(Boolean)) : (style as Record<string, unknown>) ?? {});

describe('the stop timeline', () => {
  it('planned, arrived and left in words; late amber, on time green; the next stop about 12:22 (updated 10:52); a skip in words', () => {
    render(<StopTimeline stops={stops} />);
    expect(screen.getByTestId('timeline-times-0').props.children).toBe('Planned 09:00 · Arrived 09:01 · Left 09:06');
    expect(screen.getByTestId('timeline-times-1').props.children).toBe('Planned 10:30 · Arrived 10:52');
    const late = screen.getByText('22 min late');
    expect(flat(late.props.style).color).toBe(colors.amberText);
    expect(flat(screen.getByText('On time').props.style).color).toBe(colors.green);
    expect(screen.getByTestId('timeline-estimate-2').props.children).toBe('About 12:22 (updated 10:52)');
    expect(screen.getByTestId('timeline-times-3').props.children).toBe('Planned 13:00 · Skipped · Nobody there');
    expect(screen.queryByText(/nobody_there/)).toBeNull();
  });
});
