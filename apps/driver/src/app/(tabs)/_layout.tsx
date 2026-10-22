// The five tabs: Today, Mileage, Fuel, Report, Me. The active one sits on an amber pill (components/TabBarView.tsx).

import { type ErrorBoundaryProps, Redirect, Tabs } from 'expo-router';
import type { ComponentProps } from 'react';

import { RouteCrash } from '@/components/patterns/CrashScreen';
import { TabBarView } from '@/components/TabBarView';
import { getJson, KEYS } from '@/lib/kv';
import { needsProfilePhoto, profilePhotoDeferred } from '@/lib/photoRules';
import { needsPhonePrompt, phonePromptDeferred } from '@/lib/profile';
import { useOfficeMe } from '@/office/store';
import { useApp } from '@/state/app';

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

function TabBar({ state, navigation }: TabBarProps) {
  return <TabBarView routes={state.routes} active={state.index} onPress={(name) => navigation.navigate(name)} />;
}

export default function TabsLayout() {
  const { me, meFresh, tasks } = useApp();
  const officeMe = useOfficeMe();
  // Office mode (Phase 8): the session decides the interface; an office sign-in never sees the driver's screens.
  if (!me && officeMe) return <Redirect href="/office" />;
  if (!me) return <Redirect href="/login" />;
  if (!getJson<boolean>(KEYS.permissionsSeen)) return <Redirect href="/permissions" />;
  const taskRunning = tasks.some((task) => task.status === 'in_progress');
  // Part 3b (G): "Your phone number" first, while the server says there is none (never over a running task; after
  // Continue with no connection, again at the next start).
  if (needsPhonePrompt(me, { fresh: meFresh, taskRunning, deferred: phonePromptDeferred() })) return <Redirect href="/phone-prompt" />;
  // Phase 7 §5: "Add your photo" after Permissions, while the server says there is none (never over a running task).
  if (needsProfilePhoto(me, { fresh: meFresh, taskRunning, deferred: profilePhotoDeferred() })) {
    return <Redirect href="/profile-photo" />;
  }

  return (
    <Tabs initialRouteName="index" backBehavior="initialRoute" screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...props} />}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="mileage" />
      <Tabs.Screen name="fuel" />
      <Tabs.Screen name="report" />
      <Tabs.Screen name="me" />
    </Tabs>
  );
}

/** Hotfix O2-H2: a crash in this stack shows the crash screen (Go back, Reload app, Show details), never a white page. */
export function ErrorBoundary(props: ErrorBoundaryProps) {
  return <RouteCrash {...props} home="/" />;
}
