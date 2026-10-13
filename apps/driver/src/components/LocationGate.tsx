// "Turn on Location": the full-screen cover shown when the driver needs
// Location for work (as ride-hailing apps do when going online).
//
//   - starting a task or switching sharing on with Location off: one big
//     button opens Android's own "turn on Location" dialog; once Location is
//     on, the thing the driver was doing continues; "Not now" cancels it
//   - a task in progress with Location switched off: the cover stays over
//     the whole app until Location is back, with "Call office" and "Report a
//     problem" still reachable
//   - the permission is not "Allow all the time": the same cover explains
//     and opens the app's settings
//
// Everything else (Me, Report, Mileage, sign-out when no task runs) works
// with Location off: the cover only appears for the three cases above.

import { usePathname, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MapPin } from '@/components/icons';
import { Button, Txt } from '@/components/ui';
import { OFFICE_PHONE } from '@/config';
import { enableLocation, openAppSettings, readiness } from '@/lib/location';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

const LOOK_EVERY_MS = 2_000;

export function LocationGate() {
  const { t, gate, resolveGate, tasks } = useApp();
  const router = useRouter();
  const pathname = usePathname();
  const [busy, setBusy] = useState(false);
  const insets = useSafeAreaInsets();
  const running = tasks.find((task) => task.status === 'in_progress');

  // While the cover is up: look every 2 s; the moment Location is on, carry on.
  useEffect(() => {
    if (!gate) return;
    let alive = true;
    const timer = setInterval(() => {
      void readiness().then((ready) => {
        if (alive && ready.ok) resolveGate('ready');
      });
    }, LOOK_EVERY_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [gate, resolveGate]);

  // The report form and the phone call stay reachable: the cover steps aside for them.
  if (!gate || pathname.startsWith('/report-problem')) return null;

  const permission = gate.reason === 'permission';
  const body = permission
    ? t('gate.permissionBody')
    : gate.purpose === 'task'
    ? t('gate.taskBody')
    : gate.purpose === 'sharing'
    ? t('gate.sharingBody')
    : t('gate.startBody');

  async function fix() {
    setBusy(true);
    try {
      if (permission) await openAppSettings();
      else {
        const on = await enableLocation();
        if (on && (await readiness()).ok) resolveGate('ready');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[styles.cover, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24 }]} accessibilityViewIsModal>
      <View style={styles.body}>
        <View style={styles.icon}><MapPin size={44} color={colors.red} /></View>
        <Txt variant="title" style={styles.title}>{t(permission ? 'gate.titlePermission' : 'gate.title')}</Txt>
        <Txt size={17} style={styles.text}>{body}</Txt>
        <Button label={t(permission ? 'gate.openSettings' : 'gate.turnOn')} onPress={() => void fix()} busy={busy} />
        <Txt variant="small" style={styles.text}>{t('gate.checking')}</Txt>
      </View>
      <View style={styles.actions}>
        {gate.purpose === 'task' && running && (
          <>
            {OFFICE_PHONE !== '' && <Button kind="outline" label={t('gate.callOffice')} onPress={() => void Linking.openURL(`tel:${OFFICE_PHONE}`)} />}
            <Button
              kind="outline"
              label={t('gate.reportProblem')}
              onPress={() => router.push({ pathname: '/report-problem', params: { taskId: running.id, vehicleId: running.vehicle_id } })}
            />
          </>
        )}
        {gate.purpose !== 'task' && <Button kind="outline" label={t('gate.notNow')} onPress={() => resolveGate('cancelled')} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  cover: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.page, paddingHorizontal: 24, justifyContent: 'space-between', zIndex: 1000, elevation: 1000 },
  body: { gap: 18, alignItems: 'stretch' },
  icon: { width: 84, height: 84, borderRadius: 42, backgroundColor: '#fbeceb', alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
  title: { textAlign: 'center' },
  text: { textAlign: 'center' },
  actions: { gap: 12 },
});
