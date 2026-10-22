// A design page, never in a deployed build (Part B design pass, docs/design-pass.md §5): the driver's task under way with
// sample data, for the before / after screenshots (apps/office/e2e/design-pilot.spec.ts). The mobile website has no driver
// side, so the sheet (components/RunningSheet.tsx, the one the phone draws) is shown here with the design's own numbers
// (design/png/Driver · Task in progress.png) and a grey stand-in for the map. Its route exists only in the e2e build:
// scripts/make-web-routes.mjs writes src/web-app/design/ with FLEET_DESIGN=1 and removes it otherwise, and
// apps/office/scripts/deploy-pages.sh stops when the page is in what would be uploaded.

import { ChevronLeft } from '@/components/icons';
import { SlideToConfirm } from '@/components/patterns/SlideToConfirm';
import type { Step } from '@/components/patterns/RouteStepper';
import { RunningSheet } from '@/components/RunningSheet';
import { Txt } from '@/components/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';
import { ScrollView, StyleSheet, View } from 'react-native';

export default function DriverTaskHarness() {
  const { t } = useApp();
  const label = (n: number, type: 'pickup' | 'drop' | 'visit') => t('stop.label', { n, type: t(`stop.${type}`) });
  const steps: Step[] = [
    { key: 's1', mark: '1', state: 'done', place: 'Head office, Colombo 05', type: label(1, 'pickup'), time: '07:00', times: t('stop.start') },
    { key: 's2', mark: '2', state: 'done', place: 'Kelaniya East Dialog', type: label(2, 'pickup'), time: '07:30', times: '07:30–07:40' },
    {
      key: 's3', mark: '3', state: 'next', place: 'Kurunegala site', type: label(3, 'drop'), time: '08:25', times: t('task.arriveBy', { time: '08:30' }),
      extra: <View style={{ paddingTop: 6 }}><SlideToConfirm label={t('task.slideArrive', { stop: 'Kurunegala site' })} onConfirm={() => undefined} testID="design-slide" /></View>,
    },
    { key: 's4', mark: '4', state: 'todo', place: 'Kurunegala depot', type: label(4, 'visit'), time: '10:15' },
  ];
  return (
    <View style={styles.page} testID="design-driver-task">
      <View style={styles.map}>
        <View style={[styles.back]}><ChevronLeft size={26} color={colors.ink} strokeWidth={2.6} /></View>
        <View style={styles.pill}><View style={styles.dot} /><Txt variant="strong" size={15}>{t('task.sharingLocation')}</Txt></View>
      </View>
      <ScrollView style={styles.sheet} contentContainerStyle={{ padding: 20, paddingBottom: 32, gap: 16 }}>
        <View style={styles.grabber} />
        <RunningSheet
          startedLine={t('task.started', { time: '07:06' })}
          title="Kurunegala site"
          subtitle="Team drop · 5"
          stats={[
            { key: 'left', label: t('task.distanceLeft'), value: `38 ${t('common.km')}`, sub: t('task.byRoad') },
            { key: 'arrive', label: t('task.arriveAbout'), value: '08:25' },
            { key: 'odo', label: t('task.startOdo'), value: '84,512' },
          ]}
          steps={steps}
          focus="s3"
          onNavigate={() => undefined}
          onCall={() => undefined}
          onComplete={() => undefined}
          lastOpen
          onReport={() => undefined}
        />
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
  grabber: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: colors.line, marginTop: -6 },
});
