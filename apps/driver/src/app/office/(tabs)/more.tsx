// Office mode (Phase 8, O1): More, the hub (design 19, decision 4): the person with My profile at the top, then Work (the
// screens the person may use that are not on the bar), the laptop-only line, Sign out and the version. O2 (item 7):
// the management rows by permission: Vehicles and Reports under Work, People (Drivers, Office users) and Quick settings
// as their own sections (the design's switches live on the Quick settings page).

import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';

import { Bell, ChartColumn, MessageCircle, ChevronRight, ClipboardCheck, ListChecks, type LucideIcon, Route, SlidersHorizontal, TriangleAlert, User, UserCog, Users, Van } from '@/components/icons';
import { Button, Txt } from '@/components/ui';
import { MORE_SECTION, type MoreItem, type MoreSection, moreFor } from '@/office/nav';
import { useOffice } from '@/office/state';
import { Avatar, DarkHeader, Divider, Row, Screen, Section } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

const ITEM: Record<MoreItem, { icon: LucideIcon; label: string; path: string }> = {
  approve: { icon: ClipboardCheck, label: 'office.tabs.approve', path: '/office/(tabs)/approve' },
  tasks: { icon: ListChecks, label: 'office.tabs.tasks', path: '/office/(tabs)/tasks' },
  drivers: { icon: Users, label: 'office.tabs.drivers', path: '/office/(tabs)/drivers' },
  trips: { icon: Route, label: 'office.tabs.trips', path: '/office/(tabs)/trips' },
  alerts: { icon: Bell, label: 'office.tabs.alerts', path: '/office/(tabs)/alerts' },
  issues: { icon: TriangleAlert, label: 'office.issues.title', path: '/office/issues' },
  asks: { icon: MessageCircle, label: 'office.asks.title', path: '/office/asks' },
  vehicles: { icon: Van, label: 'office.vehicles.title', path: '/office/vehicles' },
  reports: { icon: ChartColumn, label: 'office.reports.title', path: '/office/reports' },
  people_drivers: { icon: Users, label: 'office.more.drivers', path: '/office/people/drivers' },
  people_users: { icon: UserCog, label: 'office.more.officeUsers', path: '/office/people/users' },
  settings: { icon: SlidersHorizontal, label: 'office.more.quickSettings', path: '/office/people/settings' },
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
  const items = moreFor(me.permissions);

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
        <Section title={t('office.more.me')}>
          <Row
            left={<Avatar name={me.name} size={48} />}
            title={me.name}
            line={me.email}
            line2={me.permissions.map((p) => t(`office.permission.${p}`).toLowerCase()).join(' · ')}
          />
          <Divider />
          <Row left={<User size={24} color={colors.ink} />} title={t('office.more.profile')} right={<ChevronRight size={22} color={colors.muted} />} onPress={() => router.push('/office/profile')} />
        </Section>
        {SECTIONS.map((s) => {
          const rows = items.filter((key) => MORE_SECTION[key] === s.key);
          if (rows.length === 0) return null;
          return (
            <Section key={s.key} title={t(s.label)}>
              {rows.map((key, i) => {
                const it = ITEM[key];
                const Icon = it.icon;
                return (
                  <View key={key}>
                    {i > 0 && <Divider />}
                    <Row left={<Icon size={24} color={colors.ink} />} title={t(it.label)} line={key === 'people_drivers' ? t('office.more.driversLine') : key === 'people_users' ? t('office.more.officeUsersLine') : key === 'settings' ? t('office.more.quickSettingsLine') : undefined} right={<ChevronRight size={22} color={colors.muted} />} onPress={() => router.push(it.path as never)} />
                  </View>
                );
              })}
            </Section>
          );
        })}
        <Txt variant="small" style={{ paddingHorizontal: 4 }}>{t('office.more.laptopOnly')}</Txt>
        <Button kind="outline" label={t('office.common.signOut')} onPress={confirmSignOut} busy={busy} />
        <Txt variant="small" style={{ textAlign: 'center' }}>{t('login.version', { version: Constants.expoConfig?.version ?? '' })}</Txt>
      </Screen>
    </View>
  );
}
