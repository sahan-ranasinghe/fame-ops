// Hotfix O2-H2, Part 2: Office mode's Notifications (Profile → Notifications). Instagram's and WhatsApp's settings:
// "Pause all notifications" on top, then one row per group with its summary ("4 of 5 on") opening the group's own screen,
// then "Phone sound and vibration", which opens Android's settings for this app (the sound is set per channel there).
// Only the groups with an event this person can get (office/notificationGroups.ts). A switch saves at once in the
// background; a failed save turns it back with a snackbar (office/useNotifSettings.ts).

import { useRouter } from 'expo-router';
import { Platform, View } from 'react-native';

import { LinkRow, RowCard, SwitchRow } from '@/components/office/NotifParts';
import { Notice, Txt } from '@/components/ui';
import { ListEmpty, SkeletonRows } from '@/components/patterns/ListState';
import { openNotificationSettings } from '@/lib/settingsLinks';
import { groupSub, groupSummaryLine, groupTitle } from '@/office/notifLogic';
import { useOffice } from '@/office/state';
import { useNotifSettings } from '@/office/useNotifSettings';
import { BackHeader, Divider, ErrorNotice, Screen, Section } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

export default function OfficeNotifications() {
  const { t } = useApp();
  const { signOut } = useOffice();
  const router = useRouter();
  const n = useNotifSettings();
  const { tool } = n;

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <BackHeader title={t('office.notif.title')} />
      <Screen refreshing={tool.refreshing} onRefresh={() => void tool.reload()}>
        {/* O4: the mobile website has no web push yet (step 5); the switches are the person's own and reach the app. */}
        {Platform.OS === 'web' && <Notice tone="info" text={t('web.pushLater')} />}
        {tool.loading && <SkeletonRows rows={3} lines={2} />}
        {tool.error && !tool.data && <ErrorNotice error={tool.error} onRetry={() => void tool.reload()} onSignIn={() => void signOut()} />}
        {tool.data && n.groups.length === 0 && <ListEmpty text={t('office.notif.noEvents')} />}
        {tool.data && n.groups.length > 0 && (
          <>
            <RowCard>
              <SwitchRow
                title={t('office.notif.pause')}
                text={t('office.notif.pauseText')}
                value={n.paused}
                onChange={(on) => void (on ? n.pause() : n.resume())}
                testID="notif-pause"
              />
            </RowCard>
            <Section title={t('office.notif.tellMe')}>
              {n.paused && <Txt variant="small" color={colors.amberText} style={{ paddingVertical: 4 }}>{t('office.notif.pausedNote')}</Txt>}
              {n.groups.map((g, i) => {
                const sub = groupSub(t, g.key);
                const summary = n.paused ? t('office.notif.statePaused') : groupSummaryLine(t, g.on, g.total);
                return (
                  <View key={g.key}>
                    {i > 0 && <Divider />}
                    <LinkRow
                      title={groupTitle(t, g.key)}
                      line={sub ? `${sub} · ${summary}` : summary}
                      disabled={n.paused}
                      onPress={() => router.push({ pathname: '/office/notifications/[group]', params: { group: g.key } })}
                      testID={`notif-group-${g.key}`}
                    />
                  </View>
                );
              })}
            </Section>
          </>
        )}
        {Platform.OS !== 'web' && <RowCard>
          <LinkRow title={t('office.notif.phoneSound')} line={t('office.notif.phoneSoundText')} onPress={() => void openNotificationSettings().catch(() => undefined)} testID="notif-phone-sound" />
        </RowCard>}
      </Screen>
    </View>
  );
}
