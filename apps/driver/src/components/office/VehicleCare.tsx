// Office mode (Round 4–7, item 8, §33.7; Fleetio's service and documents per vehicle), shared by Maintenance and
// Reminders on the phone and on /m/: the summary (one line and the counts as chips) and one card per vehicle: the plate
// and the model, the service due by km and by date with its bar, the documents as chips (ok / expiring / expired /
// missing; the rental's end). A card opens the vehicle. The rules: office/vehicleCareLogic.ts (the website's).

import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Wrench } from '@/components/icons';
import { Plate, Txt } from '@/components/ui';
import { dateWords } from '@/lib/dateWords';
import { type CareCounts, docTone, docWords, serviceTone, serviceWords, summaryChips, type VehicleCare } from '@/office/vehicleCareLogic';
import { StatusChip, type Tone } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors, hoverStyle } from '@/theme';

const BAR: Record<Tone, string> = { red: colors.red, amber: colors.amber, green: colors.green, blue: colors.blue, muted: colors.muted };

/** The service's bar: full when due (progressbar for the screen reader). */
export function ServiceBar({ fill, tone }: { fill: number; tone: Tone }) {
  const { t } = useApp();
  const now = Math.round(fill * 100);
  return (
    <View style={styles.track} accessibilityRole="progressbar" accessibilityLabel={t('office.care.meter')} accessibilityValue={{ min: 0, max: 100, now }} testID="care-bar">
      <View style={[styles.fill, { width: `${now}%`, backgroundColor: BAR[tone] }]} />
    </View>
  );
}

/**
 * One vehicle: the service with its bar, the documents as chips; `children` adds rows under them (Reminders, which
 * shows the service only when it is due and the chips only when the server sent no rows).
 */
export function CareCard({ c, onPress, docs = true, service = true, children }: { c: VehicleCare; onPress?: () => void; docs?: boolean; service?: boolean; children?: ReactNode }) {
  const { t } = useApp();
  const day = (d: string) => dateWords(t, d);
  const tone = serviceTone(c.service.state);
  const set = c.service.state !== 'not_set';
  const body = (
    <>
      <View style={styles.head}>
        <Plate regNo={c.reg_no} />
        <Txt variant="muted" size={15} numberOfLines={1} style={{ flex: 1 }}>{c.make_model ?? ''}</Txt>
        {c.in_garage ? <StatusChip text={t('office.care.inGarage')} tone="amber" /> : null}
      </View>
      {service && <View style={{ gap: 6 }} testID="care-service">
        <View style={styles.head}>
          <Wrench size={18} color={colors.muted} />
          <Txt variant="strong" size={15}>{t('office.care.service')}</Txt>
          <Txt size={15} color={tone === 'red' ? colors.red : tone === 'amber' ? colors.amberText : colors.muted} style={{ flex: 1 }} numberOfLines={2}>
            {set ? serviceWords(c.service, t, day) : t('office.care.notSet')}
          </Txt>
          {c.service.state === 'overdue' ? <StatusChip text={t('office.care.overdue')} tone="red" /> : null}
          {c.service.state === 'due_soon' ? <StatusChip text={t('office.care.dueSoon')} tone="amber" /> : null}
        </View>
        {set ? <ServiceBar fill={c.service.fill} tone={tone} /> : null}
        {c.service.garage ? <Txt variant="small">{t('office.care.garage', { date: day(c.service.garage) })}</Txt> : null}
      </View>}
      {docs && (
        <View style={styles.chips} testID="care-docs">
          {c.docs.map((d) => <StatusChip key={d.kind} text={docWords(d, t, day)} tone={docTone(d.state)} />)}
        </View>
      )}
      {children}
    </>
  );
  if (!onPress) return <View style={styles.card} testID="care-card">{body}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={t('office.care.openVehicle', { plate: c.reg_no })} onPress={onPress} testID="care-card"
      style={(state) => [styles.card, hoverStyle(state), state.pressed && { opacity: 0.8 }]}>
      {body}
    </Pressable>
  );
}

/** The summary: "2 of 9 vehicles need attention" and the counts as chips. */
export function CareSummary({ counts }: { counts: CareCounts }) {
  const { t } = useApp();
  const chips = summaryChips(counts, t);
  return (
    <View style={{ gap: 8 }} testID="care-summary">
      <Txt variant="strong">{counts.attention ? t('office.care.summaryAttention', { n: counts.attention, total: counts.vehicles }) : t('office.care.summaryOk', { total: counts.vehicles })}</Txt>
      {chips.length > 0 && <View style={styles.chips}>{chips.map((c) => <StatusChip key={c.key} text={c.text} tone={c.tone} />)}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1, borderRadius: 18, padding: 16, gap: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  track: { height: 8, borderRadius: 4, backgroundColor: '#ebe9e3', overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
});
