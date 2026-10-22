// Review of Round 4–7 (one stepper per codebase): the driver's task preview and a finished task draw their stops on the one
// route stepper (components/task.tsx StopTimeline → components/patterns/RouteStepper.tsx), every word as before: "Stop 2 ·
// Drop", the plan's "09:00–10:30 at Kurunegala site", the start's "Start · passengers get in here", the deadline, the Google
// credit; the preview's arrive / leave / by, the office's note, Changed on a changed stop and a removed stop struck through;
// the compact list's "Show all N stops" opening the rest in place.
// The words: en.json with the strings sidecars (src/i18n/parts) merged in while they exist; a missing key fails the test.
import { fireEvent, render, screen } from '@testing-library/react-native';

/* eslint-disable @typescript-eslint/no-require-imports */
declare const __dirname: string;

function mockWords(): (key: string, vars?: Record<string, string | number>) => string {
  const fs = require('fs') as { existsSync: (p: string) => boolean; readdirSync: (p: string) => string[]; readFileSync: (p: string, enc: 'utf8') => string };
  const path = require('path') as { join: (...parts: string[]) => string };
  const merge = (into: Record<string, unknown>, from: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(from)) {
      const had = into[k];
      if (v && typeof v === 'object' && had && typeof had === 'object') merge(had as Record<string, unknown>, v as Record<string, unknown>);
      else into[k] = v;
    }
  };
  const en = JSON.parse(JSON.stringify(require('../src/i18n/en.json')));
  const dir = path.join(__dirname, '..', 'src', 'i18n', 'parts');
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir).filter((x: string) => x.endsWith('.json')).sort()) merge(en, JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).en ?? {});
  return (key, vars) => {
    const found = key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), en);
    if (typeof found !== 'string') throw new Error(`No text for "${key}"`);
    return Object.entries(vars ?? {}).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), found);
  };
}
const mockT = mockWords();
jest.mock('@/state/app', () => ({ useApp: () => ({ t: mockT, tList: () => [], language: 'en' }) }));

/* eslint-disable import/first */
import { StopTimeline } from '@/components/task';
import type { TaskStop } from '@/lib/types';

const t = mockT;
const stop = (id: string, seq: number, over: Partial<TaskStop> = {}): TaskStop => ({
  id, seq, type: 'visit', place_name: `Place ${id}`, status: 'pending', arrive_by: null, planned_arrive_at: null, planned_depart_at: null,
  google_place_id: null, is_start: false, note: null, ...over,
} as unknown as TaskStop);

describe('the driver\'s stops on the route stepper', () => {
  it('a finished task: the start, each stop by its number, the plan\'s times at the stop, the deadline, the Google credit', () => {
    render(<StopTimeline stops={[
      stop('a', 1, { type: 'pickup', place_name: 'Head office', is_start: true, status: 'done' }),
      stop('b', 2, { type: 'drop', place_name: 'Kurunegala site', status: 'done', planned_arrive_at: '2026-10-23T03:30:00Z', planned_depart_at: '2026-10-23T05:00:00Z' }),
      stop('c', 3, { place_name: 'Wariyapola', status: 'skipped', arrive_by: '2026-10-23T06:30:00Z', google_place_id: 'g1' }),
    ]} />);
    expect(screen.getByTestId('stop-timeline')).toBeTruthy();
    expect(screen.getByText(t('stop.label', { n: 1, type: t('stop.pickup') }))).toBeTruthy();
    expect(screen.getByText(t('stop.start'))).toBeTruthy();
    expect(screen.getByText(t('stop.timeAt', { from: '09:00', to: '10:30', place: 'Kurunegala site' }))).toBeTruthy();
    expect(screen.getByText(t('stop.label', { n: 2, type: t('stop.drop') }))).toBeTruthy();
    expect(screen.getByText(`${t('stop.label', { n: 3, type: t('stop.visit') })} · ${t('task.arriveBy', { time: '12:00' })}`)).toBeTruthy();
    expect(screen.getByText('Google Maps')).toBeTruthy();
  });

  it('the preview of a changed task: arrive / leave / by, the note, Changed, a removed stop struck through', () => {
    render(<StopTimeline
      detailed
      stops={[
        stop('a', 1, { place_name: 'Head office', planned_arrive_at: '2026-10-23T03:30:00Z', planned_depart_at: '2026-10-23T05:00:00Z', arrive_by: '2026-10-23T04:30:00Z', note: 'Gate 2' }),
        stop('b', 2, { place_name: 'Kandy' }),
      ]}
      changes={{ b: 'added' }}
      removed={[{ place: 'Galle', type: 'drop' }]}
    />);
    expect(screen.getByText('Head office')).toBeTruthy();
    expect(screen.getByText([t('preview.arriveLeave', { arrive: '09:00', leave: '10:30' }), t('preview.arriveBy', { time: '10:00' })].join(' · '))).toBeTruthy();
    expect(screen.getByText('Gate 2')).toBeTruthy();
    expect(screen.getAllByText(t('preview.changed'))).toHaveLength(2);
    const gone = screen.getByText('Galle');
    const style = Object.assign({}, ...[gone.props.style].flat(Infinity).filter(Boolean));
    expect(style.textDecorationLine).toBe('line-through');
    expect(screen.getByText(t('stop.drop'))).toBeTruthy();
  });

  it('compact: four stops, then "Show all N stops" opens the rest in place', () => {
    render(<StopTimeline compact stops={[1, 2, 3, 4, 5, 6].map((n) => stop(`s${n}`, n))} />);
    expect(screen.queryByText('Place s5')).toBeNull();
    fireEvent.press(screen.getByText(t('preview.showAll', { n: 6 })));
    expect(screen.getByText('Place s6')).toBeTruthy();
    expect(screen.queryByText(t('preview.showAll', { n: 6 }))).toBeNull();
  });
});
