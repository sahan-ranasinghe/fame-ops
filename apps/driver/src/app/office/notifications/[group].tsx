// Hotfix O2-H2, Part 2: one group of Office mode's notifications (Notifications → a group): a switch per event this
// person can get, a short title and at most one grey line each. A switch saves at once; a failed save turns it back with a
// snackbar (office/useNotifSettings.ts). An unknown group, or one with nothing for this person, says so.

import { useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import { RowCard, SwitchRow } from '@/components/office/NotifParts';
import { Txt } from '@/components/ui';
import { ListEmpty, SkeletonRows } from '@/components/patterns/ListState';
import { eventText, eventTitle, groupSub, groupTitle, isGroupKey } from '@/office/notifLogic';
import { useOffice } from '@/office/state';
import { useNotifSettings } from '@/office/useNotifSettings';
import { BackHeader, Divider, ErrorNotice, Screen } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

export default function OfficeNotificationGroup() {
  const { t } = useApp();
  const { signOut } = useOffice();
  const { group } = useLocalSearchParams<{ group: string }>();
  const n = useNotifSettings();
  const { tool } = n;
  const known = isGroupKey(group);
  const shown = n.groups.find((g) => g.key === group);

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <BackHeader title={known ? groupTitle(t, group) : t('office.notif.title')} subtitle={known ? groupSub(t, group) : undefined} />
      <Screen refreshing={tool.refreshing} onRefresh={() => void tool.reload()}>
        {tool.loading && <SkeletonRows rows={3} lines={2} />}
        {tool.error && !tool.data && <ErrorNotice error={tool.error} onRetry={() => void tool.reload()} onSignIn={() => void signOut()} />}
        {tool.data && !shown && <ListEmpty text={t('office.notif.noEvents')} />}
        {n.paused && shown && <Txt variant="small" color={colors.amberText}>{t('office.notif.pausedNote')}</Txt>}
        {shown && (
          <RowCard>
            {shown.events.map((e, i) => (
              <View key={e.event}>
                {i > 0 && <Divider />}
                <SwitchRow
                  title={eventTitle(t, e)}
                  text={eventText(t, e)}
                  value={e.enabled}
                  onChange={(on) => void n.setEvent(e.event, on)}
                  disabled={n.paused}
                  testID={`notif-ev-${e.event}`}
                />
              </View>
            ))}
          </RowCard>
        )}
      </Screen>
    </View>
  );
}
