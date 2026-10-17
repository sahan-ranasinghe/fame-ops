// The five tabs: Today, Mileage, Fuel, Report, Me. The active one sits on an amber pill.

import { Redirect, Tabs } from 'expo-router';
import { Fuel, Gauge, ListChecks, type LucideIcon, TriangleAlert, User } from '@/components/icons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Txt } from '@/components/ui';
import { getJson, KEYS } from '@/lib/kv';
import { needsProfilePhoto, profilePhotoDeferred } from '@/lib/photoRules';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

const TABS: Record<string, { icon: LucideIcon; label: string }> = {
  index: { icon: ListChecks, label: 'tabs.today' },
  mileage: { icon: Gauge, label: 'tabs.mileage' },
  fuel: { icon: Fuel, label: 'tabs.fuel' },
  report: { icon: TriangleAlert, label: 'tabs.report' },
  me: { icon: User, label: 'tabs.me' },
};

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

function TabBar({ state, navigation }: TabBarProps) {
  const { t } = useApp();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      {state.routes.map((route, index) => {
        const tab = TABS[route.name];
        if (!tab) return null;
        const active = state.index === index;
        const Icon = tab.icon;
        return (
          <Pressable
            key={route.key}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => navigation.navigate(route.name)}
            style={styles.tab}
          >
            <View style={[styles.pill, active && { backgroundColor: colors.amber }]}>
              <Icon size={24} color={active ? colors.ink : colors.muted} strokeWidth={active ? 2.6 : 2} />
            </View>
            <Txt variant={active ? 'strong' : 'muted'} size={14} color={active ? colors.ink : colors.muted} numberOfLines={1}>
              {t(tab.label)}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function TabsLayout() {
  const { me, meFresh, tasks } = useApp();
  if (!me) return <Redirect href="/login" />;
  if (!getJson<boolean>(KEYS.permissionsSeen)) return <Redirect href="/permissions" />;
  // Phase 7 §5: "Add your photo" after Permissions, while the server says there is none (never over a running task).
  if (needsProfilePhoto(me, { fresh: meFresh, taskRunning: tasks.some((task) => task.status === 'in_progress'), deferred: profilePhotoDeferred() })) {
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

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: 8,
  },
  tab: { flex: 1, alignItems: 'center', gap: 4, minHeight: 60 },
  pill: { width: 52, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
});
