// Office mode (Hotfix O2-H1, Part B): Who's available as rows, one pattern for the Who step, Book now and Change the
// task: the avatar, the name with "best match" (and its reason under it), the status words, last seen / usually starts,
// the radio (the shared ChoiceRow: the tint and the border when picked), the busy / off duty / not available pill; "Ask drivers" beside the title.

import { Pressable, View } from 'react-native';

import { ChoiceRow } from '@/components/patterns/Select';
import { Txt } from '@/components/ui';
import { driverParts, driverPill, rankedDrivers } from '@/office/approveLogic';
import type { Availability, AvailableDriver } from '@/office/types';
import { ListEmpty, SkeletonRows } from '@/components/patterns/ListState';
import { Avatar, ListFailed, Pill, StatusChip } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

export function DriverRows({ data, loading, error, picked, onPick, onRetry, onSignIn, onAsk, noWindow }: {
  data: Availability | null;
  loading: boolean;
  error: { code?: string; message: string } | null;
  /** The picked driver's username. */
  picked: string;
  onPick: (d: AvailableDriver) => void;
  onRetry: () => void;
  onSignIn: () => void;
  /** "Ask drivers" beside the title, only when the person may. */
  onAsk?: () => void;
  /** No leave time yet: the rows cannot be asked for. */
  noWindow?: boolean;
}) {
  const { t } = useApp();
  const drivers = data ? rankedDrivers(data.drivers) : [];
  const best = data?.best?.username ?? drivers.find((x) => x.name === data?.best?.name)?.username ?? '';
  return (
    <View style={{ gap: 10 }} testID="driver-rows">
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Txt variant="label" color={colors.muted} style={{ flex: 1 }}>{`${t('office.request.whosAvailable').toUpperCase()}${data ? ` · ${t('office.trip.nOfMFree', { free: data.counts.free, all: data.counts.all })}` : ''}`}</Txt>
        {onAsk && drivers.length > 0 && (
          <Pressable accessibilityRole="button" onPress={onAsk} hitSlop={8} style={{ minHeight: 44, justifyContent: 'center' }}>
            <Txt variant="strong" size={15} color={colors.blue}>{t('office.ask.open')}</Txt>
          </Pressable>
        )}
      </View>
      {noWindow && <ListEmpty text={t('office.trip.needLeaveFirst')} />}
      {loading && !data && !error && <SkeletonRows rows={3} lines={2} />}
      {error && <ListFailed stale={!!data} error={error as never} onRetry={onRetry} onSignIn={onSignIn} />}
      {data && !loading && drivers.length === 0 && <ListEmpty text={t('office.request.nobody')} />}
      {drivers.map((x) => {
        const on = !!x.username && x.username === picked;
        const pillKey = driverPill(x, best);
        return (
          <ChoiceRow
            key={x.username ?? x.name}
            card
            selected={on}
            onPress={() => onPick(x)}
            disabled={!x.username}
            disabledReason={x.username ? undefined : t('office.ask.noAccount')}
            leading={<Avatar name={x.name} size={48} photo={x.photo_url} />}
            mark="end"
            trailing={pillKey && pillKey !== 'best' ? <StatusChip text={t(`office.request.${pillKey}`)} tone={pillKey === 'not_available' ? 'red' : pillKey === 'busy' ? 'blue' : 'muted'} /> : null}
            accessibilityLabel={x.name}
            testID={`driver-row-${x.username ?? x.name}`}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Txt variant="strong" size={18}>{x.name}</Txt>
              {pillKey === 'best' && <Pill text={t('office.request.bestMatch')} tone="amber" size={13} />}
            </View>
            <Txt variant="muted" size={15}>{driverParts(x).join(' · ')}</Txt>
            {pillKey === 'best' && data?.best?.why ? <Txt variant="small" color={colors.amberText}>{data.best.why}</Txt> : null}
            {(x.last_seen || x.usual_start) && <Txt variant="small">{[x.last_seen ? t('office.trip.lastSeen', { when: x.last_seen }) : '', x.usual_start ? t('office.trip.usuallyStarts', { time: x.usual_start }) : ''].filter(Boolean).join(' · ')}</Txt>}
          </ChoiceRow>
        );
      })}
    </View>
  );
}
