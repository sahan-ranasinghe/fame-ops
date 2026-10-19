// Office mode (Phase 8, O1): the office screens, in their own route group. Only an office sign-in gets here (the session
// decides: office/store.ts); without one, Login. Nothing driver-side runs for an office person (no LocationGate, no duty).

import { Redirect, Stack } from 'expo-router';

import { OfficeProvider } from '@/office/state';
import { useOfficeMe } from '@/office/store';
import { colors } from '@/theme';

export default function OfficeLayout() {
  const me = useOfficeMe();
  if (!me) return <Redirect href="/login" />;
  return (
    <OfficeProvider me={me}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.page } }} />
    </OfficeProvider>
  );
}
