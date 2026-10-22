// The driver app's five tabs (Today, Mileage, Fuel, Report, Me), drawn: the active one on an amber pill. The router's tab
// bar (app/(tabs)/_layout.tsx) passes the routes and the one in front; the design page of Today draws it with no router.
// Round 4–7, item 12 (design/mockups/2026-10-22, mockup 5): the mockup's sizes (a 56 × 30 pill, 20 pt icons, 12 pt words,
// the bar's thin top line); each tab keeps its whole column as the target.

import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Fuel, Gauge, ListChecks, type LucideIcon, TriangleAlert, User } from '@/components/icons';
import { Txt } from '@/components/ui';
import { useApp } from '@/state/app';
import { colors, hoverStyle } from '@/theme';

export const TABS: Record<string, { icon: LucideIcon; label: string }> = {
  index: { icon: ListChecks, label: 'tabs.today' },
  mileage: { icon: Gauge, label: 'tabs.mileage' },
  fuel: { icon: Fuel, label: 'tabs.fuel' },
  report: { icon: TriangleAlert, label: 'tabs.report' },
  me: { icon: User, label: 'tabs.me' },
};

export function TabBarView({ routes, active, onPress }: {
  routes: readonly { key: string; name: string }[];
  /** The index of the tab in front. */
  active: number;
  onPress: (name: string) => void;
}) {
  const { t } = useApp();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      {routes.map((route, index) => {
        const tab = TABS[route.name];
        if (!tab) return null;
        const on = active === index;
        const Icon = tab.icon;
        return (
          <Pressable
            key={route.key}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => onPress(route.name)}
            style={(state) => [styles.tab, hoverStyle(state)]}
            testID={`tab-${route.name}`}
          >
            <View style={[styles.pill, on && { backgroundColor: colors.amber }]}>
              <Icon size={20} color={on ? colors.ink : colors.muted} strokeWidth={on ? 2.4 : 2} />
            </View>
            <Txt variant={on ? 'strong' : 'muted'} size={12} color={on ? colors.ink : colors.muted} numberOfLines={1}>
              {t(tab.label)}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.cardLine,
    paddingTop: 10,
  },
  tab: { flex: 1, alignItems: 'center', gap: 4, minHeight: 56 },
  pill: { width: 56, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
});
