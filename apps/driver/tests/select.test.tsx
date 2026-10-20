// Hotfix O2-H2, Part 3: the shared selection controls (components/patterns/Select.tsx) show their state with a mark AND
// the tint and the border, never colour alone, and say it to TalkBack; a disabled one is not pressable and says why.
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

jest.mock('@/state/app', () => ({ useApp: () => require('./fakeOffice').mockUseApp() }));
jest.mock('@/office/state', () => ({ useOffice: () => ({ api: require('./fakeOffice').mockOfficeApi }) }));

/* eslint-disable import/first */
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AskDriversSheet } from '@/components/office/AskDriversSheet';
import { Checkbox, ChoiceChip, ChoiceRow, Radio, SELECT, SelectableRow } from '@/components/patterns/Select';
import { colors } from '@/theme';

describe('SelectableRow (pick many)', () => {
  it('picked: the filled check circle, the blue chip tint, the 2 px blue border, checked for TalkBack', () => {
    render(<SelectableRow selected onToggle={() => undefined} testID="row" accessibilityLabel="Driver A"><Text>Driver A</Text></SelectableRow>);
    const row = screen.getByTestId('row');
    expect(screen.getByTestId('row-mark-on')).toBeTruthy();
    expect(screen.queryByTestId('row-mark-off')).toBeNull();
    expect(screen.getByTestId('row-mark-on')).toHaveStyle({ backgroundColor: SELECT.on, borderColor: SELECT.on });
    expect(row).toHaveStyle({ backgroundColor: '#e6edf8', borderColor: '#1e4fa0', borderWidth: 2 });
    expect(row.props.accessibilityRole).toBe('checkbox');
    expect(row.props.accessibilityState).toMatchObject({ checked: true, selected: true, disabled: false });
    expect(screen.getByRole('checkbox', { name: 'Driver A', checked: true })).toBeTruthy();
  });

  it('not picked: an empty circle outline in the same place, no tint, not checked', () => {
    render(<SelectableRow selected={false} onToggle={() => undefined} testID="row"><Text>Driver B</Text></SelectableRow>);
    const row = screen.getByTestId('row');
    const mark = screen.getByTestId('row-mark-off');
    expect(screen.queryByTestId('row-mark-on')).toBeNull();
    expect(mark).toHaveStyle({ borderColor: SELECT.off, backgroundColor: colors.card });
    expect(row).toHaveStyle({ backgroundColor: colors.card, borderColor: colors.line });
    expect(row.props.accessibilityState).toMatchObject({ checked: false });
  });

  it('a tap anywhere on the row toggles it', () => {
    const onToggle = jest.fn();
    render(<SelectableRow selected={false} onToggle={onToggle} testID="row"><Text>Driver C</Text></SelectableRow>);
    fireEvent.press(screen.getByText('Driver C'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('disabled: greyed, not pressable, says why (on screen and to TalkBack)', () => {
    const onToggle = jest.fn();
    render(<SelectableRow selected={false} onToggle={onToggle} disabled disabledReason="On a task" testID="row"><Text>Driver D</Text></SelectableRow>);
    const row = screen.getByTestId('row');
    fireEvent.press(screen.getByText('Driver D'));
    expect(onToggle).not.toHaveBeenCalled();
    expect(screen.getByText('On a task')).toBeTruthy();
    expect(row).toHaveStyle({ opacity: SELECT.disabledOpacity });
    expect(row.props.accessibilityState).toMatchObject({ disabled: true });
    expect(row.props.accessibilityHint).toBe('On a task');
  });
});

describe('ChoiceRow (pick one)', () => {
  it('picked: the radio with its dot, the tint and the border; radio role, checked', () => {
    render(<ChoiceRow selected onPress={() => undefined} testID="opt"><Text>Vehicle problem</Text></ChoiceRow>);
    const row = screen.getByTestId('opt');
    expect(screen.getByTestId('opt-mark-on')).toBeTruthy();
    expect(row).toHaveStyle({ backgroundColor: '#e6edf8', borderColor: '#1e4fa0', borderWidth: 2 });
    expect(row.props.accessibilityRole).toBe('radio');
    expect(row.props.accessibilityState).toMatchObject({ checked: true, selected: true });
  });

  it('not picked: the empty ring; disabled with a reason is not pressable', () => {
    const onPress = jest.fn();
    render(<ChoiceRow selected={false} onPress={onPress} disabled disabledReason="In garage" testID="opt"><Text>WP CAB-4521</Text></ChoiceRow>);
    expect(screen.getByTestId('opt-mark-off')).toBeTruthy();
    fireEvent.press(screen.getByText('WP CAB-4521'));
    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByText('In garage')).toBeTruthy();
  });
});

describe('ChoiceChip, Checkbox, Radio', () => {
  it('a picked chip has the check, the tint and the border; an unpicked one has none of them', () => {
    render(<><ChoiceChip label="Today" selected onPress={() => undefined} testID="today" /><ChoiceChip label="Tomorrow" selected={false} onPress={() => undefined} testID="tomorrow" /></>);
    expect(screen.getByTestId('today-check')).toBeTruthy();
    expect(screen.getByTestId('today')).toHaveStyle({ backgroundColor: '#e6edf8', borderColor: '#1e4fa0', borderWidth: 2 });
    expect(screen.queryByTestId('tomorrow-check')).toBeNull();
    expect(screen.getByRole('radio', { name: 'Today', checked: true })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Tomorrow', checked: false })).toBeTruthy();
  });

  it('Checkbox toggles with its box; Radio shows its dot', () => {
    const onChange = jest.fn();
    render(<><Checkbox label="Approve requests" checked={false} onChange={onChange} testID="perm" /><Radio label="Allowed" checked onPress={() => undefined} testID="trips" /></>);
    expect(screen.getByTestId('perm-off')).toBeTruthy();
    fireEvent.press(screen.getByText('Approve requests'));
    expect(onChange).toHaveBeenCalledWith(true);
    expect(screen.getByRole('checkbox', { name: 'Approve requests', checked: false })).toBeTruthy();
    expect(screen.getByTestId('trips-mark-on')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Allowed', checked: true })).toBeTruthy();
  });
});

describe('Ask drivers: "Send to · N picked" and the rows agree (the owner\'s report)', () => {
  const t = require('./fakeOffice').mockUseApp().t as (k: string, v?: Record<string, string | number>) => string;
  const drivers = [
    { name: 'Driver A', username: 'fixa', line: 'Free', free: true },
    { name: 'Driver B', username: 'fixb', line: 'Free', free: true },
    { name: 'Driver C', username: 'fixc', line: 'On a task', free: false },
    { name: 'Driver D', username: null, line: '', free: false },
  ];
  const metrics = { frame: { x: 0, y: 0, width: 412, height: 915 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

  it('the picked drivers show the check, the tint and the border; None empties them; a row without an account says why', () => {
    render(
      <SafeAreaProvider initialMetrics={metrics}>
        <AskDriversSheet visible onClose={() => undefined} drivers={drivers} context={{ date: '2026-10-20', from: '09:00', to: '12:00' }} />
      </SafeAreaProvider>,
    );
    expect(screen.getByText(t('office.ask.pickedCount', { n: 2 }).toUpperCase())).toBeTruthy();
    for (const u of ['fixa', 'fixb']) {
      expect(screen.getByTestId(`ask-row-${u}-mark-on`)).toBeTruthy();
      expect(screen.getByTestId(`ask-row-${u}`)).toHaveStyle({ backgroundColor: '#e6edf8', borderColor: '#1e4fa0', borderWidth: 2 });
    }
    expect(screen.getByTestId('ask-row-fixc-mark-off')).toBeTruthy();
    expect(screen.getByTestId('ask-row-Driver D').props.accessibilityState).toMatchObject({ disabled: true, checked: false });
    expect(screen.getByText(t('office.ask.noAccount'))).toBeTruthy();
    // Tap a row anywhere: it is picked, and the header counts it.
    fireEvent.press(screen.getByText('Driver C'));
    expect(screen.getByTestId('ask-row-fixc-mark-on')).toBeTruthy();
    expect(screen.getByText(t('office.ask.pickedCount', { n: 3 }).toUpperCase())).toBeTruthy();
    fireEvent.press(screen.getByText(t('office.ask.none')));
    expect(screen.getByText(t('office.ask.pickedCount', { n: 0 }).toUpperCase())).toBeTruthy();
    expect(screen.queryByTestId('ask-row-fixa-mark-on')).toBeNull();
    // The question as cards with a radio: the trip one picked.
    expect(screen.getByTestId('ask-kind-free_for_trip').props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByTestId('ask-kind-where_now').props.accessibilityState).toMatchObject({ checked: false });
  });
});
