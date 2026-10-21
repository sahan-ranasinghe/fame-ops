// Round 1 item 6: the "Where" suggestions of an empty place box (docs/ui-patterns.md "Where suggestions"), on both place
// boxes of the app: Office mode's (and /m/'s) and the driver's Start a trip. At most 5 rows, our places first then 3 recent,
// an icon per row (never a text badge), no towns, "More places" for the rest; while typing the badges are translated.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { answers, FIX, resetFake } from './fakeOffice';

jest.mock('@/office/client', () => ({ officeApi: require('./fakeOffice').mockOfficeApi }));
jest.mock('@/state/app', () => ({ useApp: () => require('./fakeOffice').mockUseApp() }));
jest.mock('@/office/store', () => ({ useOfficeMe: () => require('./fakeOffice').FIX('me'), getOfficeMe: () => require('./fakeOffice').FIX('me'), setOfficeMe: () => undefined }));
jest.mock('@/components/office/PinAdjust', () => ({ PinAdjust: () => null }));
const mockSearch = jest.fn();
jest.mock('@/lib/driverApiClient', () => ({ driverApi: { searchPlaces: (...a: unknown[]) => mockSearch(...a) } }));

/* eslint-disable import/first */
import { PlaceSearch as DriverPlaceSearch } from '@/components/PlaceSearch';
import { PlaceSearch as OfficePlaceSearch } from '@/components/office/PlaceSearch';
import { OfficeProvider } from '@/office/state';
import type { Me as OfficeMe } from '@/office/types';
import type { KnownPlace } from '@/lib/trips';

const ME: OfficeMe = FIX('me');

const place = (name: string, kind = 'other', detail?: string) => ({ layer: 'place', badge: kind === 'office' ? 'Office' : 'Saved', name, kind, id: `p-${name}`, pinned: true, lat: 7, lng: 80, detail });
const recent = (name: string) => ({ layer: 'recent', badge: 'Used before', name, pinned: true, lat: 7, lng: 80, last_used: '2026-10-20 09:00' });
const town = (name: string) => ({ layer: 'town', badge: 'Town', name, pinned: true, lat: 7, lng: 80, detail: '3.2 km' });

beforeEach(() => {
  resetFake();
  mockSearch.mockReset();
});

function office() {
  return render(
    <OfficeProvider me={ME}>
      <OfficePlaceSearch value="" placeholder="Search a place" onText={() => undefined} onPick={() => undefined} />
    </OfficeProvider>,
  );
}

describe('Office mode: the empty box', () => {
  it('5 rows at most: ours first, then 3 recent; icons, not badges; no towns; More places opens the rest', async () => {
    answers.search_places = (args) => (args.suggest
      ? { text: '', suggested: true, results: [recent('Kandy depot'), recent('Galle site'), recent('Jaffna store'), recent('Matara'), place('Head office', 'office', 'Colombo 05 · 2.1 km'), place('Store A'), place('Store B'), town('Kurunegala'), town('Kegalle')] }
      : { text: args.text, results: [] });
    office();
    await waitFor(() => expect(screen.getAllByTestId('where-row')).toHaveLength(5));
    const names = screen.getAllByTestId('where-row').map((r) => r.props.accessibilityLabel as string);
    expect(names).toEqual(['Head office, Our place', 'Store A, Our place', 'Kandy depot, Used recently', 'Galle site, Used recently', 'Jaffna store, Used recently']);
    expect(screen.getAllByTestId('where-icon-building')).toHaveLength(2);
    expect(screen.getAllByTestId('where-icon-clock')).toHaveLength(3);
    expect(screen.queryByText('Used before')).toBeNull();
    expect(screen.queryByText('Office')).toBeNull();
    expect(screen.queryByText('Town')).toBeNull();
    expect(screen.queryByText('Kurunegala')).toBeNull();
    fireEvent.press(screen.getByTestId('where-more'));
    expect(screen.getAllByTestId('where-row')).toHaveLength(7);
    expect(screen.getByText('Store B')).toBeTruthy();
    expect(screen.getByText('Matara')).toBeTruthy();
    expect(screen.queryByText('Kurunegala')).toBeNull();
    expect(screen.queryByTestId('where-more')).toBeNull();
  });

  it('fewer places: fewer rows and no More places', async () => {
    answers.search_places = () => ({ text: '', suggested: true, results: [place('Head office', 'office'), town('Kegalle')] });
    office();
    await waitFor(() => expect(screen.getAllByTestId('where-row')).toHaveLength(1));
    expect(screen.queryByTestId('where-more')).toBeNull();
  });

  it('typing: the server badges in the phone\'s language (towns allowed), never an unknown English word raw', async () => {
    answers.search_places = (args) => (args.suggest
      ? { text: '', suggested: true, results: [] }
      : { text: args.text, results: [place('Head office', 'office'), { ...recent('Kandy depot') }, town('Kandy'), { layer: 'map', badge: 'Brand new word', name: 'Kandy Lake', pinned: true, lat: 7, lng: 80 }] });
    office();
    jest.useFakeTimers();
    fireEvent.changeText(screen.getByLabelText('Search a place'), 'Kan');
    await act(async () => { jest.advanceTimersByTime(400); });
    jest.useRealTimers();
    await waitFor(() => expect(screen.getByText('Kandy Lake')).toBeTruthy());
    expect(screen.getByText('Office')).toBeTruthy();
    expect(screen.getByText('Used before')).toBeTruthy();
    expect(screen.getByText('Town')).toBeTruthy();
    expect(screen.getByText('Map')).toBeTruthy();
    expect(screen.queryByText('Brand new word')).toBeNull();
  });
});

describe('The driver\'s Start a trip: the empty box', () => {
  const known: KnownPlace[] = [
    { id: 'a', name: 'Store A', address: 'Kelaniya', lat: 7, lng: 80, kind: 'store' },
    { id: 'b', name: 'Store B', address: null, lat: 7, lng: 80, kind: 'store' },
    { id: 'h', name: 'Head office', address: 'Colombo 05', lat: 7, lng: 80, kind: 'office' },
    { id: 'c', name: 'Store C', address: null, lat: 7, lng: 80 },
    { id: 'd', name: 'Store D', address: null, lat: 7, lng: 80 },
    { id: 'e', name: 'Store E', address: null, lat: 7, lng: 80 },
  ];

  it('our places, the office first, 5 rows with a building icon, More places for the rest', () => {
    const picks: unknown[] = [];
    render(<DriverPlaceSearch online known={known} pick={null} onPick={(p) => picks.push(p)} text="" onTextChange={() => undefined} />);
    const rows = screen.getAllByTestId('where-row');
    expect(rows).toHaveLength(5);
    expect(rows[0].props.accessibilityLabel).toBe('Head office, Our place');
    expect(screen.getAllByTestId('where-icon-building')).toHaveLength(5);
    expect(screen.queryByTestId('where-icon-clock')).toBeNull();
    fireEvent.press(screen.getByTestId('where-more'));
    expect(screen.getAllByTestId('where-row')).toHaveLength(6);
    fireEvent.press(screen.getByText('Head office'));
    expect(picks).toHaveLength(1);
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('typing hides the suggestions; the server badges are translated', async () => {
    mockSearch.mockResolvedValue({ text: 'Sto', results: [{ layer: 'place', badge: 'Site · Dialog', name: 'Store A', id: 'a', pinned: true }, { layer: 'map', badge: 'Map', name: 'Store Rd', pinned: true }] });
    jest.useFakeTimers();
    render(<DriverPlaceSearch online known={known} pick={null} onPick={() => undefined} text="Sto" onTextChange={() => undefined} />);
    expect(screen.queryByTestId('where-row')).toBeNull();
    await act(async () => { jest.advanceTimersByTime(400); });
    jest.useRealTimers();
    await waitFor(() => expect(screen.getByText('Store Rd')).toBeTruthy());
    expect(screen.getByText('Site · Dialog')).toBeTruthy();
    // The group's title and the row's badge.
    expect(screen.getAllByText('Map')).toHaveLength(2);
  });
});
