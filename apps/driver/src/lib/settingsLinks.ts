// Hotfix O2-H2 (Part 2): Android's own notification page for this app (each channel's sound and vibration; WhatsApp's
// "Notification tones" link out), App info if the phone does not open it.
import * as Application from 'expo-application';
import * as IntentLauncher from 'expo-intent-launcher';
import { Linking } from 'react-native';

export async function openNotificationSettings(): Promise<void> {
  const appId = Application.applicationId ?? 'com.fameglobal.driver';
  await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.APP_NOTIFICATION_SETTINGS, {
    extra: { 'android.provider.extra.APP_PACKAGE': appId },
  }).catch(() => Linking.openSettings());
}
