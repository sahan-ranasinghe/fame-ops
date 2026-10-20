// Office mode (Hotfix O2-H1, Part B): Who's available as rows, one pattern for the Who step, Book now and Change the
// task: the avatar, the name with "best match" (and its reason under it), the status words, last seen / usually starts,
// the tick on the picked one, the busy / off duty / not available pill on the rest; "Ask drivers" beside the title.

import { Pressable, StyleSheet, View } from 'react-native';

import { Check } from '@/components/icons';
import { Txt } from '@/components/ui';
import { driverParts, driverPill, rankedDrivers } from '@/office/approveLogic';
import type { Availability, AvailableDriver } from '@/office/types';
import { Avatar, Empty, ErrorNotice, Loading, Pill } from '@/office/ui';
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
      {noWindow && <Empty text={t('office.trip.needLeaveFirst')} />}
      {loading && !data && <Loading text={t('office.common.loading')} />}
      {error && !data && <ErrorNotice error={error as never} onRetry={onRetry} onSignIn={onSignIn} />}
      {drivers.map((x) => {
        const on = !!x.username && x.username === picked;
        const pillKey = driverPill(x, best);
        return (
          <Pressable key={x.username ?? x.name} accessibilityRole="button" accessibilityState={{ selected: on }} disabled={!x.username} onPress={() => onPick(x)} style={({ pressed }) => [styles.row, on && styles.rowOn, pressed && { opacity: 0.8 }]}>
            <Avatar name={x.name} size={48} />
            <View style={{ flex: 1, gap: 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Txt variant="strong" size={18}>{x.name}</Txt>
                {pillKey === 'best' && <Pill text={t('office.request.bestMatch')} tone="amber" size={13} />}
              </View>
              <Txt variant="muted" size={15}>{driverParts(x).join(' · ')}</Txt>
              {pillKey === 'best' && data?.best?.why ? <Txt variant="small" color={colors.amberText}>{data.best.why}</Txt> : null}
              {(x.last_seen || x.usual_start) && <Txt variant="small">{[x.last_seen ? t('office.trip.lastSeen', { when: x.last_seen }) : '', x.usual_start ? t('office.trip.usuallyStarts', { time: x.usual_start }) : ''].filter(Boolean).join(' · ')}</Txt>}
            </View>
            {on ? <Check size={26} color={colors.blue} strokeWidth={3} /> : pillKey && pillKey !== 'best' ? <Pill text={t(`office.request.${pillKey}`)} tone={pillKey === 'not_available' ? 'red' : pillKey === 'busy' ? 'blue' : 'muted'} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18, borderWidth: 2, borderColor: colors.line, backgroundColor: colors.card, minHeight: 72 },
  rowOn: { borderColor: colors.blue, backgroundColor: '#f2f5fb' },
});
