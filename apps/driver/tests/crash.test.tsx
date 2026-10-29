// Hotfix O2-H2, Part 1c: a screen that throws shows the crash screen, never a white page: Something went wrong, Go back,
// Reload app, Show details with the scrubbed details. The stack's boundary is the one Office mode's layout exports.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import { Share } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { renderRouter } from 'expo-router/testing-library';
import { Stack } from 'expo-router';
import * as Updates from 'expo-updates';

import { failOnConsoleError } from './fakeOffice';

jest.mock('@/state/app', () => ({ useApp: () => require('./fakeOffice').mockUseApp() }));
jest.mock('@/office/store', () => ({ useOfficeMe: () => require('./fakeOffice').FIX('me'), getOfficeMe: () => require('./fakeOffice').FIX('me'), setOfficeMe: () => undefined }));
jest.mock('@/office/client', () => ({ officeApi: require('./fakeOffice').mockOfficeApi }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(() => Promise.resolve(true)) }));

/* eslint-disable import/first */
import { ErrorBoundary as OfficeBoundary } from '@/app/office/_layout';
import { CrashScreen } from '@/components/patterns/CrashScreen';

function Boom(): never {
  throw new Error('Cannot read property id of undefined (driver kamal@fame.lk, 0771234567, token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc)');
}

describe('the crash screen', () => {
  it('replaces a screen that throws, with Show details scrubbed, Go back and Reload app', async () => {
    const errors = failOnConsoleError();
    try {
      renderRouter({
        _layout: () => <Stack screenOptions={{ headerShown: false }} />,
        'office/_layout': { default: () => <Stack screenOptions={{ headerShown: false }} />, ErrorBoundary: OfficeBoundary },
        'office/index': () => null,
        'office/broken': Boom,
      }, { initialUrl: '/office/broken' });
      expect(await screen.findByTestId('crash-screen')).toBeTruthy();
      expect(screen.getByText('Something went wrong')).toBeTruthy();
      expect(screen.getByText('Your work was saved if you pressed Save.')).toBeTruthy();
      expect(screen.queryByTestId('crash-details')).toBeNull();
      fireEvent.press(screen.getByTestId('crash-details-toggle'));
      expect(screen.getByTestId('crash-details')).toBeTruthy();
      const text = String(screen.getByText(/Error: Cannot read property id of undefined/).props.children);
      expect(text).toMatch(/Screen: /);
      expect(text).toMatch(/App: /);
      expect(text).toMatch(/Update: /);
      expect(text).toMatch(/Runtime: /);
      expect(text).toMatch(/<email>/);
      expect(text).not.toMatch(/kamal@fame\.lk|0771234567|eyJhbGci/);
      expect(screen.getByTestId('crash-copy')).toBeTruthy();
      fireEvent.press(screen.getByTestId('crash-reload'));
      expect(Updates.reloadAsync).toHaveBeenCalled();
      expect(screen.getByTestId('crash-back')).toBeTruthy();
    } finally {
      errors.restore();
    }
  });

  // Release 1.4.0 (expo-clipboard): Copy puts the scrubbed details on the clipboard and says "Copied" for 2 s; Share (the
  // 1.3.0 way, the share sheet) stays beside it.
  it('Copy puts the details on the clipboard and says Copied; Share opens the share sheet', async () => {
    jest.useFakeTimers();
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    const crash = { screen: '/office/trip/review', appVersion: '1.4.0', updateId: null, runtime: '1.4.0-gmaps', side: 'office' as const,
      message: 'Error: boom', stack: ['at Review'], fatal: true, at: '2026-10-29T06:00:00Z' };
    render(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 400, height: 800 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
        <CrashScreen crash={crash} onReload={() => undefined} />
      </SafeAreaProvider>,
    );
    fireEvent.press(screen.getByTestId('crash-details-toggle'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('crash-copy'));
    });
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith(expect.stringContaining('Error: boom'));
    expect(screen.getByText('Copied')).toBeTruthy();
    act(() => {
      jest.advanceTimersByTime(2100);
    });
    expect(screen.queryByText('Copied')).toBeNull();
    expect(screen.getByText('Copy')).toBeTruthy();
    fireEvent.press(screen.getByTestId('crash-share'));
    expect(share).toHaveBeenCalledWith({ message: expect.stringContaining('Error: boom') });
    share.mockRestore();
    jest.useRealTimers();
  });
});
