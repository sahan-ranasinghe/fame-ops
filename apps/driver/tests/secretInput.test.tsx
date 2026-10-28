// The password / PIN box (components/SecretInput.tsx, Material's password field with the visibility toggle): dots by
// default (secureTextEntry), the eye shows the value and hides it again and says so to TalkBack in the person's words
// ("Show password" / "Hide password"; a PIN "Show PIN" / "Hide PIN"); the box keeps its keyboard, maxLength and value.
import { fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';

jest.mock('@/state/app', () => ({ useApp: () => require('./fakeOffice').mockUseApp() }));

/* eslint-disable import/first */
import { SecretInput } from '@/components/SecretInput';

function Box({ kind }: { kind?: 'password' | 'pin' }) {
  const [v, setV] = useState('');
  return kind === 'pin'
    ? <SecretInput kind="pin" label="6-digit PIN" value={v} onChangeText={(x) => setV(x.replace(/\D/g, '').slice(0, 6))} maxLength={6} keyboardType="number-pad" mono testID="pin" />
    : <SecretInput label="Password" value={v} onChangeText={setV} autoComplete="password" testID="pw" />;
}

describe('SecretInput', () => {
  it('a password: hidden by default, the eye shows it and hides it again, the words follow', () => {
    render(<Box />);
    const input = screen.getByTestId('pw');
    expect(input.props.secureTextEntry).toBe(true);
    expect(input.props.autoComplete).toBe('password');
    fireEvent.changeText(input, 'correct horse battery');
    expect(input.props.value).toBe('correct horse battery');

    const eye = screen.getByRole('button', { name: 'Show password' });
    expect(eye.props.accessibilityState).toMatchObject({ selected: false });
    fireEvent.press(eye);
    expect(screen.getByTestId('pw').props.secureTextEntry).toBe(false);
    expect(screen.getByTestId('pw').props.value).toBe('correct horse battery');
    expect(screen.queryByRole('button', { name: 'Show password' })).toBeNull();
    const hide = screen.getByRole('button', { name: 'Hide password' });
    expect(hide.props.accessibilityState).toMatchObject({ selected: true });
    fireEvent.press(hide);
    expect(screen.getByTestId('pw').props.secureTextEntry).toBe(true);
    expect(screen.getByRole('button', { name: 'Show password' })).toBeTruthy();
  });

  it('a PIN: Show PIN / Hide PIN; the number pad, 6 digits and the digits-only rule stay the box\'s own', () => {
    render(<Box kind="pin" />);
    const input = screen.getByTestId('pin');
    expect(input.props.secureTextEntry).toBe(true);
    expect(input.props.keyboardType).toBe('number-pad');
    expect(input.props.maxLength).toBe(6);
    fireEvent.changeText(input, '12a3456789');
    expect(screen.getByTestId('pin').props.value).toBe('123456');
    fireEvent.press(screen.getByRole('button', { name: 'Show PIN' }));
    expect(screen.getByTestId('pin').props.secureTextEntry).toBe(false);
    expect(screen.getByRole('button', { name: 'Hide PIN' })).toBeTruthy();
    expect(screen.getByTestId('pin-eye')).toBeTruthy();
  });
});
