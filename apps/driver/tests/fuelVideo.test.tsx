// Release 1.4.0 (docs/release-1.4.0.md item 2): the fuel video player (app/office/fuel-video.tsx) with a fake expo-video
// player: the bookmarks and pieces, a bookmark in another piece loads that piece, the pieces play one after another,
// Open in the browser stays, and nothing handed over says so instead of a blank page.
import { act, fireEvent, screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { Stack } from 'expo-router';
import { Linking } from 'react-native';

import { failOnConsoleError } from './fakeOffice';

jest.mock('@/state/app', () => ({ useApp: () => require('./fakeOffice').mockUseApp() }));
jest.mock('@/office/store', () => ({ useOfficeMe: () => require('./fakeOffice').FIX('me'), getOfficeMe: () => require('./fakeOffice').FIX('me'), setOfficeMe: () => undefined }));
jest.mock('@/office/client', () => ({ officeApi: require('./fakeOffice').mockOfficeApi }));

type Listener = (payload?: unknown) => void;
const fake = {
  listeners: {} as Record<string, Listener[]>,
  played: 0,
  sources: [] as string[],
  currentTime: 0,
  status: 'idle',
  play() {
    fake.played += 1;
  },
  replaceAsync(url: string) {
    fake.sources.push(url);
    return Promise.resolve();
  },
  addListener(name: string, fn: Listener) {
    (fake.listeners[name] ??= []).push(fn);
    return { remove: () => undefined };
  },
  emit(name: string, payload?: unknown) {
    for (const fn of fake.listeners[name] ?? []) fn(payload);
  },
};
jest.mock('expo-video', () => {
  const { View } = require('react-native');
  return {
    useVideoPlayer: (source: string, setup?: (p: unknown) => void) => {
      const React = require('react');
      React.useState(() => {
        fake.sources.push(source);
        setup?.(fake);
        return null;
      });
      return fake;
    },
    VideoView: () => <View testID="video-view" />,
  };
});

/* eslint-disable import/first */
import FuelVideo from '@/app/office/fuel-video';
import { handToPlayer } from '@/office/fuelPlayer';

const routes = { _layout: () => <Stack screenOptions={{ headerShown: false }} />, 'office/index': () => null, 'office/fuel-video': FuelVideo };

describe('the fuel video player', () => {
  beforeEach(() => {
    fake.listeners = {};
    fake.sources = [];
    fake.played = 0;
  });

  it('nothing handed over: says the video is no longer open', async () => {
    const errors = failOnConsoleError();
    try {
      renderRouter(routes, { initialUrl: '/office/fuel-video' });
      expect(await screen.findByText('This video is no longer open. Open it again from the fill.')).toBeTruthy();
    } finally {
      errors.restore();
    }
  });

  it('plays the pieces one after another; a bookmark opens the right piece; Open in the browser stays', async () => {
    const errors = failOnConsoleError();
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    try {
      handToPlayer({
        title: 'Today 09:12',
        sub: 'WP CAB-4521 · Kamal',
        start: 0,
        video: {
          status: 'uploaded', duration_s: 300, bytes: 16 * 1024 * 1024, interrupted: true,
          segments: [{ url: 'https://x.test/a.mp4', duration_s: 120 }, { url: 'https://x.test/b.mp4', duration_s: 180 }],
          marks: [{ key: 'plate', label: 'Plate', at_s: 4, clock: '0:04' }, { key: 'final', label: 'Final', at_s: 232, clock: '3:52' }],
        },
      });
      renderRouter(routes, { initialUrl: '/office/fuel-video' });
      expect(await screen.findByTestId('fuel-player')).toBeTruthy();
      expect(screen.getByText('Today 09:12')).toBeTruthy();
      expect(fake.sources[0]).toBe('https://x.test/a.mp4');
      expect(screen.getByText('Plate 0:04')).toBeTruthy();
      expect(screen.getByText('Interrupted · 2 pieces')).toBeTruthy();
      // A bookmark in the second piece: that piece is loaded.
      await act(async () => {
        fireEvent.press(screen.getByText('Final 3:52'));
      });
      expect(fake.sources.at(-1)).toBe('https://x.test/b.mp4');
      // Back to the first piece, then its end plays the second.
      await act(async () => {
        fireEvent.press(screen.getByText('Piece 1 · 2:00'));
      });
      expect(fake.sources.at(-1)).toBe('https://x.test/a.mp4');
      await act(async () => {
        fake.emit('playToEnd');
      });
      expect(fake.sources.at(-1)).toBe('https://x.test/b.mp4');
      fireEvent.press(screen.getByTestId('fuel-video-browser'));
      expect(open).toHaveBeenCalledWith('https://x.test/b.mp4');
    } finally {
      open.mockRestore();
      errors.restore();
    }
  });
});
