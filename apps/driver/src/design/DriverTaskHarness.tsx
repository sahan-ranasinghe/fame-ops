// A design page, never in a deployed build (Part B design pass, docs/design-pass.md §5), on branch design-pilot-before only:
// the driver's task under way AS IT IS on main (app/task/[id].tsx's running sheet, copied with sample data: the stats box,
// the stop cards, Navigate and Call after the stops), for the "before" screenshot. The "after" page draws
// components/RunningSheet.tsx with the same data. Its route exists only in the e2e build (FLEET_DESIGN=1).

import { Check, ChevronLeft, Navigation, Phone } from '@/components/icons';
import { SlideToConfirm } from '@/components/patterns/SlideToConfirm';
import { Button, Mono, Notice, Txt } from '@/components/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

export default function DriverTaskHarness() {
  const { t } = useApp();
  const label = (n: number, type: 'pickup' | 'drop' | 'visit') => t('stop.label', { n, type: t(`stop.${type}`) });
  const stops = [
    { id: 's1', n: 1, type: 'pickup' as const, place: 'Head office, Colombo 05', detail: t('stop.start'), done: true },
    { id: 's2', n: 2, type: 'pickup' as const, place: 'Kelaniya East Dialog', detail: '07:30–07:40', done: true },
    { id: 's3', n: 3, type: 'drop' as const, place: 'Kurunegala site', detail: t('task.arriveBy', { time: '08:30' }), done: false, current: true },
    { id: 's4', n: 4, type: 'visit' as const, place: 'Kurunegala depot', detail: '', done: false },
  ];
  return (
    <View style={styles.page} testID="design-driver-task">
      <View style={styles.map}>
        <View style={styles.back}><ChevronLeft size={26} color={colors.ink} strokeWidth={2.6} /></View>
        <View style={styles.pill}><View style={styles.dot} /><Txt variant="strong" size={15}>{t('task.sharingLocation')}</Txt></View>
      </View>
      <ScrollView style={styles.sheet} contentContainerStyle={{ padding: 20, paddingBottom: 32, gap: 16 }}>
        <View style={styles.grabber} />
        <View style={styles.topRow}>
          <Txt variant="label" color={colors.blue}>{t('today.inProgress')}</Txt>
          <Mono size={16} color={colors.muted}>{t('task.started', { time: '07:06' })}</Mono>
        </View>
        <View>
          <Txt variant="title" size={28}>Kurunegala site</Txt>
          <Txt variant="muted" size={18}>Team drop · 5</Txt>
        </View>
        <View style={styles.stats}>
          <View style={{ flex: 1 }}>
            <Txt variant="muted" size={15}>{t('task.distanceLeftRoad')}</Txt>
            <Txt variant="heading" size={24}>{`38 ${t('common.km')}`}</Txt>
          </View>
          <View style={{ flex: 1 }}>
            <Txt variant="muted" size={15}>{t('task.startOdo')}</Txt>
            <Mono size={23} bold>84,512</Mono>
          </View>
        </View>
        <View style={{ gap: 8 }}>
          {stops.map((item) => (
            <View key={item.id} style={[styles.stopCard, item.current && styles.stopRowCurrent, item.done && { opacity: 0.6 }]}>
              <View style={styles.stopRow}>
                <View style={{ flex: 1 }}>
                  <Txt variant="muted" size={14}>{item.current ? `${t('task.currentStop')} · ` : ''}{label(item.n, item.type)}</Txt>
                  <Txt variant="strong">{item.place}</Txt>
                  {item.detail !== '' && <Txt variant="small">{item.detail}</Txt>}
                </View>
                {item.done ? (
                  <View style={styles.doneBadge}><Check size={18} color={colors.blue} strokeWidth={3} /></View>
                ) : (
                  <Pressable accessibilityRole="button" hitSlop={8} style={styles.skip}><Txt variant="small" color={colors.red}>{t('task.skip')}</Txt></Pressable>
                )}
              </View>
              {item.current && <SlideToConfirm label={t('task.slideArrive', { stop: item.place })} onConfirm={() => undefined} testID="design-slide" />}
            </View>
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Button kind="outline" icon={Navigation} label={t('task.navigate')} onPress={() => undefined} style={{ flex: 1 }} />
          <Button kind="outline" icon={Phone} label={t('task.callContact')} onPress={() => undefined} style={{ flex: 1 }} />
        </View>
        <Notice tone="warn" text={t('complete.needsLastStop')} />
        <Button kind="dark" icon={Check} label={t('task.complete')} disabled onPress={() => undefined} />
        <Button kind="danger-text" label={t('task.reportProblem')} onPress={() => undefined} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  map: { height: 340, backgroundColor: colors.mapLand },
  back: { position: 'absolute', left: 16, top: 12, width: 48, height: 48, borderRadius: 24, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  pill: { position: 'absolute', right: 16, top: 16, height: 40, paddingHorizontal: 14, borderRadius: 20, backgroundColor: colors.card, flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.blue },
  sheet: { flex: 1, marginTop: -22, backgroundColor: colors.card, borderTopLeftRadius: 26, borderTopRightRadius: 26 },
  grabber: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: '#dcd9d0', marginTop: -6 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  stats: { backgroundColor: colors.page, borderRadius: 14, padding: 16, flexDirection: 'row', gap: 12 },
  stopCard: { gap: 12, borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 12 },
  stopRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  skip: { minHeight: 32, justifyContent: 'center' },
  stopRowCurrent: { borderColor: colors.blue, borderWidth: 2, backgroundColor: colors.blueChip },
  doneBadge: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.blueChip, alignItems: 'center', justifyContent: 'center' },
});
