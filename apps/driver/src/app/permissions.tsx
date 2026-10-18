// Permissions, asked once after sign-in and reachable later from Me:
// location ("Allow all the time"), notifications, no battery saving for this
// app, and then, once, the phone brand's own battery and auto-start steps with
// "Open <brand> settings" (OPPO, realme, Xiaomi, vivo, Samsung or any other
// phone; components/PhoneSetup.tsx, the same steps as Me → Phone setup).

import * as Battery from 'expo-battery';
import { Redirect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { BatteryCharging, Bell, Check, type LucideIcon, MapPin, ShieldCheck } from '@/components/icons';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LocationDisclosure } from '@/components/LocationDisclosure';
import { PhoneSetupSteps } from '@/components/PhoneSetup';
import { Button, Card, Txt } from '@/components/ui';
import { agreeLocationDisclosure, locationDisclosureAgreed } from '@/lib/disclosure';
import { KEYS, setJson } from '@/lib/kv';
import { askIgnoreBatteryOptimisation, locationPermissions, requestLocationPermissions } from '@/lib/location';
import { notificationsAllowed, requestNotifications, showTestNotification } from '@/lib/notifications';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

interface Status {
  location: boolean;
  background: boolean;
  notifications: boolean;
  battery: boolean;
}

async function readStatus(): Promise<Status> {
  const [location, notifications, batterySaving] = await Promise.all([
    locationPermissions(),
    notificationsAllowed(),
    Battery.isBatteryOptimizationEnabledAsync().catch(() => false),
  ]);
  return { ...location, notifications, battery: !batterySaving };
}

function Row({ icon: Icon, title, why, hint, done, action, onPress }: {
  icon: LucideIcon;
  title: string;
  why: string;
  hint?: string;
  /** undefined = the app cannot tell; the button is always shown. */
  done: boolean | undefined;
  action: string;
  onPress: () => void;
}) {
  const { t } = useApp();
  return (
    <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', gap: 14, alignItems: 'flex-start' }}>
        <View style={[styles.icon, done && { backgroundColor: colors.blueChip }]}>
          {done ? <Check size={24} color={colors.blue} strokeWidth={3} /> : <Icon size={24} color={colors.amber} />}
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="big">{title}</Txt>
          <Txt variant="muted">{why}</Txt>
          {!done && hint && <Txt variant="strong" size={15} color={colors.amberText} style={{ marginTop: 4 }}>{hint}</Txt>}
        </View>
      </View>
      {done
        ? <Txt variant="strong" color={colors.blue}>{t('permissions.allowed')}</Txt>
        : <Button kind={done === undefined ? 'outline' : 'dark'} label={action} onPress={onPress} />}
    </Card>
  );
}

export default function PermissionsScreen() {
  const { me, t, checkTrackingNow, registerPush } = useApp();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<Status | null>(null);
  const [askedLocation, setAskedLocation] = useState(false);
  const [disclosure, setDisclosure] = useState(false);

  const check = useCallback(() => {
    readStatus().then(setStatus).catch(() => undefined);
    void checkTrackingNow();
  }, [checkTrackingNow]);

  // The answers are given on Android's own screens, so look again whenever the app comes back.
  useEffect(() => {
    check();
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    return () => listener.remove();
  }, [check]);

  if (!me) return <Redirect href="/login" />;

  async function askLocation() {
    // After one refusal Android no longer shows its question: go to the app's settings instead.
    if (askedLocation && status && !status.location) {
      await Linking.openSettings();
      return;
    }
    // Part 6: the disclosure first, its own screen; Android's question only after Agree.
    if (!locationDisclosureAgreed(me?.id)) {
      setDisclosure(true);
      return;
    }
    setAskedLocation(true);
    await requestLocationPermissions();
    check();
  }

  function finish() {
    setJson(KEYS.permissionsSeen, true);
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  const locationDone = status?.location === true && status.background;

  return (
    <View style={styles.page}>
      <StatusBar style="dark" />
      <LocationDisclosure
        visible={disclosure}
        onClose={() => setDisclosure(false)}
        onAgree={() => {
          if (me) agreeLocationDisclosure(me.id);
          setDisclosure(false);
          void askLocation();
        }}
      />
      <ScrollView contentContainerStyle={{ padding: 16, paddingTop: insets.top + 24, paddingBottom: 24, gap: 14 }}>
        <Txt variant="title" style={{ marginBottom: 6 }}>{t('permissions.title')}</Txt>
        <Row
          icon={MapPin}
          title={t('permissions.location')}
          why={t('permissions.locationWhy')}
          hint={t('permissions.locationAlways')}
          done={locationDone}
          action={askedLocation && status?.location === false ? t('permissions.openSettings') : t('permissions.allow')}
          onPress={askLocation}
        />
        <Row
          icon={Bell}
          title={t('permissions.notifications')}
          why={t('permissions.notificationsWhy')}
          done={status?.notifications === true}
          action={t('permissions.allow')}
          onPress={() => requestNotifications().then(() => { check(); void registerPush(); })}
        />
        {status?.notifications === true && (
          <Button kind="outline" label={t('push.testSound')} onPress={() => void showTestNotification(t('push.testTitle'), t('push.testBody'))} />
        )}
        <Row
          icon={BatteryCharging}
          title={t('permissions.battery')}
          why={t('permissions.batteryWhy')}
          done={status?.battery === true}
          action={t('permissions.allow')}
          onPress={() => askIgnoreBatteryOptimisation().then(check)}
        />
        {/* Phase 7 item 7: after the battery step, once, the brand's own steps (they left Today's card). */}
        <Card style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', gap: 14, alignItems: 'flex-start' }}>
            <View style={styles.icon}>
              <ShieldCheck size={24} color={colors.amber} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="big">{t('permissions.background')}</Txt>
              <Txt variant="muted">{t('permissions.backgroundWhy')}</Txt>
            </View>
          </View>
          <PhoneSetupSteps />
        </Card>
      </ScrollView>
      <View style={{ padding: 16, paddingBottom: insets.bottom + 16, gap: 10 }}>
        <Button label={t('permissions.continue')} onPress={finish} />
        <Txt variant="small" style={{ textAlign: 'center' }}>{t('permissions.later')}</Txt>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  icon: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
