// Hotfix O2-H2, Part 1c: a screen that throws shows the crash screen, never a white page: Something went wrong, Go back,
// Reload app, Show details with the scrubbed details. The stack's boundary is the one Office mode's layout exports.
import { fireEvent, screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { Stack } from 'expo-router';
import * as Updates from 'expo-updates';

import { failOnConsoleError } from './fakeOffice';

jest.mock('@/state/app', () => ({ useApp: () => require('./fakeOffice').mockUseApp() }));
jest.mock('@/office/store', () => ({ useOfficeMe: () => require('./fakeOffice').FIX('me'), getOfficeMe: () => require('./fakeOffice').FIX('me'), setOfficeMe: () => undefined }));
jest.mock('@/office/client', () => ({ officeApi: require('./fakeOffice').mockOfficeApi }));

/* eslint-disable import/first */
import { ErrorBoundary as OfficeBoundary } from '@/app/office/_layout';

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
});
