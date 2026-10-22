// Office mode (Phase 8, O1): More, the hub (design 19, decision 4): the person with My profile at the top, then Work (the
// screens the person may use that are not on the bar), the laptop-only line, Sign out and the version. O2 (item 7):
// the management rows by permission: Vehicles and Reports under Work, People (Drivers, Office users) and Quick settings
// as their own sections (the design's switches live on the Quick settings page). O3 review: the search at the top (the
// shared FilterBar's search alone), the rows whose words match.

import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform, View } from 'react-native';

import { Bell, Calendar, ChartColumn, Clock, MessageCircle, ChevronRight, ClipboardCheck, ListChecks, type LucideIcon, MapPin, Route, ShieldCheck, SlidersHorizontal, TriangleAlert, User, UserCog, Users, Van, Wrench } from '@/components/icons';
import { Button, Txt } from '@/components/ui';
import { FilterBar } from '@/components/patterns/FilterBar';
import { ListEmpty } from '@/components/patterns/ListState';
import { MORE_SECTION, type MoreItem, type MoreSection, moreFor } from '@/office/nav';
import { useOffice } from '@/office/state';
import { useSwitch } from '@/office/switches';
import { Avatar, DarkHeader, Divider, Row, Screen, Section } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';
import { switchToDesktop } from '@/lib/viewChoice';

const ITEM: Record<MoreItem, { icon: LucideIcon; label: string; path: string }> = {
  approve: { icon: ClipboardCheck, label: 'office.tabs.approve', path: '/office/(tabs)/approve' },
  tasks: { icon: ListChecks, label: 'office.tabs.tasks', path: '/office/(tabs)/tasks' },
  task_history: { icon: Clock, label: 'office.history2.title', path: '/office/task-history' },
  drivers: { icon: Users, label: 'office.tabs.drivers', path: '/office/(tabs)/drivers' },
  trips: { icon: Route, label: 'office.tabs.trips', path: '/office/(tabs)/trips' },
  alerts: { icon: Bell, label: 'office.tabs.alerts', path: '/office/(tabs)/alerts' },
  issues: { icon: TriangleAlert, label: 'office.issues.title', path: '/office/issues' },
  asks: { icon: MessageCircle, label: 'office.asks.title', path: '/office/asks' },
  // Round 4–7 (7): the day per driver or vehicle, and the asks for a busy one.
  timeline: { icon: Calendar, label: 'office.holders.timelineTitle', path: '/office/timeline' },
  holder_asks: { icon: User, label: 'office.holders.asksTitle', path: '/office/holder-asks' },
  vehicles: { icon: Van, label: 'office.vehicles.title', path: '/office/vehicles' },
  reports: { icon: ChartColumn, label: 'office.reports.title', path: '/office/reports' },
  maintenance: { icon: Wrench, label: 'office.maint.title', path: '/office/maintenance' },
  places: { icon: MapPin, label: 'office.places.title', path: '/office/places' },
  people_drivers: { icon: Users, label: 'office.more.drivers', path: '/office/people/drivers' },
  people_users: { icon: UserCog, label: 'office.more.officeUsers', path: '/office/people/users' },
  settings: { icon: SlidersHorizontal, label: 'office.more.quickSettings', path: '/office/people/settings' },
  activity: { icon: ClipboardCheck, label: 'office.more.activity', path: '/office/people/activity' },
  retention: { icon: ShieldCheck, label: 'office.more.retention', path: '/office/people/retention' },
};
const SECTIONS: { key: MoreSection; label: string }[] = [
  { key: 'work', label: 'office.more.work' },
  { key: 'people', label: 'office.more.people' },
  { key: 'settings', label: 'office.more.settingsSection' },
];

export default function MoreTab() {
  const { t } = useApp();
  const { me, signOut } = useOffice();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // Task history also needs its tool (list_tasks): never a row that would open a screen the person cannot use.
  // Round 4–7 (7): the timeline and the asks need their tools too (day_timeline, holder_asks).
  // The asks for a busy driver or vehicle are the holder feature's: none while holder_contact is off (office/switches.ts).
  const holders = useSwitch('holder_contact');
  const items = moreFor(me.permissions).filter((key) => (key !== 'task_history' || me.tools.includes('list_tasks')) && (key !== 'timeline' || me.tools.includes('day_timeline')) && (key !== 'holder_asks' || (holders && me.tools.includes('holder_asks'))));
  // The search at the top of More (docs/phase8-plan.md §16): the rows whose words match, as the person types.
  const [find, setFind] = useState('');
  const lineOf = (key: MoreItem) => (key === 'people_drivers' ? t('office.more.driversLine') : key === 'people_users' ? t('office.more.officeUsersLine') : key === 'settings' ? t('office.more.quickSettingsLine') : key === 'activity' ? t('office.more.activityLine') : key === 'timeline' ? t('office.holders.timelineLine') : key === 'holder_asks' ? t('office.holders.asksLine') : key === 'retention' ? t('office.more.retentionLine') : undefined);
  const needle = find.trim().toLowerCase();
  const matches = (key: MoreItem) => !needle || [t(ITEM[key].label), lineOf(key) ?? ''].some((w) => w.toLowerCase().includes(needle));
  const shown = items.filter(matches);

  function confirmSignOut() {
    Alert.alert(t('office.common.signOut'), t('office.more.signOutBody'), [
      { text: t('office.common.cancel'), style: 'cancel' },
      {
        text: t('office.common.signOut'),
        style: 'destructive',
        onPress: () => {
          setBusy(true);
          void signOut().then(() => router.replace('/login'));
        },
      },
    ]);
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <DarkHeader above={t('office.more.above')} title={t('office.tabs.more')} />
      <Screen>
        {/* Round 2b (Instagram / WhatsApp): the profile card first; it opens My profile (once, never a second row). */}
        {!needle && <Section title={t('office.more.me')}>
          <Row
            left={<Avatar name={me.name} size={48} photo={me.photo_url} />}
            title={me.name}
            line={me.email}
            line2={me.permissions.map((p) => t(`office.permission.${p}`).toLowerCase()).join(' · ')}
            right={<ChevronRight size={22} color={colors.muted} />}
            onPress={() => router.push('/office/profile')}
            testID="more-profile"
          />
        </Section>}
        <FilterBar search={find} onSearch={setFind} placeholder={t('office.more.search')} defs={[]} values={{}} onApply={() => undefined} testID="more-search" />
        {needle && shown.length === 0 && <ListEmpty text={t('office.more.noMatch', { text: find.trim() })} />}
        {SECTIONS.map((s) => {
          const rows = shown.filter((key) => MORE_SECTION[key] === s.key);
          if (rows.length === 0) return null;
          return (
            <Section key={s.key} title={t(s.label)}>
              {rows.map((key, i) => {
                const it = ITEM[key];
                const Icon = it.icon;
                return (
                  <View key={key}>
                    {i > 0 && <Divider />}
                    <Row left={<Icon size={24} color={colors.ink} />} title={t(it.label)} line={lineOf(key)} right={<ChevronRight size={22} color={colors.muted} />} onPress={() => router.push(it.path as never)} />
                  </View>
                );
              })}
            </Section>
          );
        })}
        <Txt variant="small" style={{ paddingHorizontal: 4 }}>{t('office.more.laptopOnly')}</Txt>
        {/* The mobile website (O4): the desktop site instead, remembered in this browser. */}
        {Platform.OS === 'web' && <Button kind="outline" label={t('web.desktopView')} onPress={switchToDesktop} testID="switch-desktop" />}
        <Button kind="outline" label={t('office.common.signOut')} onPress={confirmSignOut} busy={busy} />
        <Txt variant="small" style={{ textAlign: 'center' }}>{t('login.version', { version: Constants.expoConfig?.version ?? '' })}</Txt>
      </Screen>
    </View>
  );
}
