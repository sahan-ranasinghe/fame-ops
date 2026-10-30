// The place search as someone types (30 October 2026: the map search had stopped on the server, Round 51b): Office
// mode's Where step with the REAL place box on From, To and a middle stop. Each empty box first shows Saved (our places)
// and Recent (the person's own); typing asks search_places once the typing pauses (300 ms, however many letters went in),
// and the results show. The /m/ build runs the same screen in a browser (e2e/mobile.spec.ts), the site its own box
// (e2e/placeSearch.spec.ts).
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { Stack } from 'expo-router';
import { Text } from 'react-native';

import { answers, calls, FIX, failOnConsoleError, mockUseApp, resetFake } from './fakeOffice';

jest.mock('@/office/client', () => ({ officeApi: require('./fakeOffice').mockOfficeApi }));
jest.mock('@/state/app', () => ({ useApp: () => require('./fakeOffice').mockUseApp() }));
jest.mock('@/office/store', () => ({ useOfficeMe: () => require('./fakeOffice').FIX('me'), getOfficeMe: () => require('./fakeOffice').FIX('me'), setOfficeMe: () => undefined }));
jest.mock('@/components/office/PinAdjust', () => ({ PinAdjust: () => null }));

/* eslint-disable import/first */
import TripWhere from '@/app/office/trip/where';
import { OfficeProvider } from '@/office/state';
import { getDraft, setDraft } from '@/office/trip/draft';
import type { Me as OfficeMe } from '@/office/types';

const ME: OfficeMe = FIX('me');
const t = mockUseApp().t;
const BASE = { id: 'b1', name: 'Head office', address: 'Colombo 05', has_pin: true };
const routes = {
  _layout: () => <OfficeProvider me={ME}><Stack screenOptions={{ headerShown: false }} /></OfficeProvider>,
  'office/trip/where': TripWhere,
  'office/trip/when': () => <Text>when step</Text>,
  'office/index': () => <Text>home</Text>,
};

let errors: ReturnType<typeof failOnConsoleError>;
beforeEach(() => {
  resetFake();
  setDraft(null);
  answers.get_settings = () => ({ settings: { tasks_need_approval: false, self_drive_allowed: true, dwell_min: { pickup: 5, drop: 5, visit: 60 } }, base_place: BASE });
  // An empty box: Saved (the company's places), then Recent (the person's own). Typed: the places for the words.
  answers.search_places = (args) => (args.suggest
    ? { text: '', suggested: true, results: [
      { layer: 'place', badge: 'Office', name: 'Head office', kind: 'office', id: 'b1', pinned: true, lat: 6.9, lng: 79.85, group: 'saved', group_label: 'Saved' },
      { layer: 'recent', badge: 'Used before', name: 'Kandy depot', pinned: true, lat: 7.29, lng: 80.63, last_used: '2026-10-28 09:00', group: 'recent', group_label: 'Recent' },
    ] }
    : { text: args.text, results: [{ layer: 'place', badge: 'Saved', name: `${String(args.text)} depot`, kind: 'other', id: `p-${String(args.text)}`, pinned: true, lat: 7, lng: 80 }] });
  errors = failOnConsoleError();
});
afterEach(() => {
  errors.restore();
  setDraft(null);
});

const searches = () => calls.filter((c) => c.tool === 'search_places' && typeof c.args.text === 'string').map((c) => c.args.text);
const boxes = () => screen.getAllByLabelText(t('office.trip.searchPlace'));
/** Types a word letter by letter into the box (faster than the 300 ms pause): one search for the whole word. */
function typeInto(box: ReturnType<typeof boxes>[number], word: string) {
  for (let i = 1; i <= word.length; i++) fireEvent.changeText(box, word.slice(0, i));
}

describe('Where: typing reaches the search on From, To and a stop', () => {
  it('Saved and Recent first, then one search per pause, and its results, on each box', async () => {
    renderRouter(routes, { initialUrl: '/office/trip/where?mode=request' });
    await screen.findByTestId('route-card');

    // From: Change opens the box; Saved and Recent show before anything is typed.
    fireEvent.press(await screen.findByTestId('from-change'));
    await waitFor(() => expect(screen.getAllByTestId('where-row').map((r) => r.props.accessibilityLabel as string)).toEqual(expect.arrayContaining(['Head office, Our place', 'Kandy depot, Recent'])));
    typeInto(boxes()[0], 'Kalutara');
    fireEvent.press(await screen.findByText('Kalutara depot'));
    await waitFor(() => expect(getDraft()!.fields.start).toBe('Kalutara depot'));
    expect(searches()).toEqual(['Kalutara']);

    // To: its own box, the same.
    typeInto(boxes()[0], 'Galle');
    fireEvent.press(await screen.findByText('Galle depot'));
    await waitFor(() => expect(getDraft()!.fields.stops.map((s) => s.place)).toEqual(['Galle depot']));
    expect(searches()).toEqual(['Kalutara', 'Galle']);

    // A stop between From and To: + Add stop opens its box.
    fireEvent.press(screen.getByTestId('add-stop'));
    typeInto(boxes()[0], 'Matara');
    fireEvent.press(await screen.findByText('Matara depot'));
    await waitFor(() => expect(getDraft()!.fields.stops.map((s) => s.place)).toEqual(['Matara depot', 'Galle depot']));
    expect(searches()).toEqual(['Kalutara', 'Galle', 'Matara']);
    expect(errors.seen.map((a) => String(a[0]))).toEqual([]);
  });
});
