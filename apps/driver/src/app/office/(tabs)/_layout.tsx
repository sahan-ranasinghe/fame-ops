// Office mode (Phase 8, O1): the bottom tabs per permission set (office/nav.ts tabsFor; designs 02–05, 15–19), the active
// one on an amber pill as in the driver app. A tab the person may not use is not in the bar at all.

import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Bell, ClipboardCheck, Ellipsis, House, ListChecks, type LucideIcon, MapPin, Route, Users } from '@/components/icons';
import { Txt } from '@/components/ui';
import { type TabKey, tabsFor } from '@/office/nav';
import { useOffice } from '@/office/state';
import { Badge } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

const ICONS: Record<TabKey, LucideIcon> = {
  home: House,
  approve: ClipboardCheck,
  tasks: ListChecks,
  drivers: Users,
  live: MapPin,
  trips: Route,
  alerts: Bell,
  more: Ellipsis,
};

/** The route file of each tab. */
const ROUTE: Record<TabKey, string> = { home: 'index', approve: 'approve', tasks: 'tasks', drivers: 'drivers', live: 'live', trips: 'trips', alerts: 'alerts', more: 'more' };

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

function TabBar({ state, navigation }: TabBarProps) {
  const { t } = useApp();
  const { me, unread } = useOffice();
  const insets = useSafeAreaInsets();
  const tabs = tabsFor(me.permissions);
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      {tabs.map((tab) => {
        const index = state.routes.findIndex((r) => r.name === ROUTE[tab.key]);
        if (index < 0) return null;
        const route = state.routes[index];
        const active = state.index === index;
        const Icon = ICONS[tab.key];
        const badge = tab.key === 'alerts' ? unread : 0;
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
              {badge > 0 && <View style={{ position: 'absolute', top: -6, right: -2 }}><Badge n={badge} /></View>}
            </View>
            <Txt variant={active ? 'strong' : 'muted'} size={13} color={active ? colors.ink : colors.muted} numberOfLines={1}>
              {t(tab.label)}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function OfficeTabsLayout() {
  const { me } = useOffice();
  const mine = new Set(tabsFor(me.permissions).map((t) => ROUTE[t.key]));
  return (
    <Tabs initialRouteName="index" backBehavior="initialRoute" screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...props} />}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="approve" options={{ href: mine.has('approve') ? undefined : null }} />
      <Tabs.Screen name="tasks" options={{ href: mine.has('tasks') ? undefined : null }} />
      <Tabs.Screen name="drivers" options={{ href: mine.has('drivers') ? undefined : null }} />
      <Tabs.Screen name="live" options={{ href: mine.has('live') ? undefined : null }} />
      <Tabs.Screen name="trips" options={{ href: mine.has('trips') ? undefined : null }} />
      <Tabs.Screen name="alerts" />
      <Tabs.Screen name="more" />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 8 },
  tab: { flex: 1, alignItems: 'center', gap: 4, minHeight: 60 },
  pill: { width: 52, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
});
