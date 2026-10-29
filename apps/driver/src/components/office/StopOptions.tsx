// Fix B (29 October 2026): From / To / Add stop, Uber's and PickMe's route form. A row's ⋯ Options on the trip editor's
// Where step (app/office/trip/where.tsx), in the one bottom sheet (components/patterns/Sheet.tsx): no type picker on the
// row any more. A stop's sheet: "What happens there" (People get in / People get out / Visit · wait / Goods, the shared
// withRole), Arrive by (the clock) and Stay (the duration sheet), More details (what is carried, a pin typed by hand, the
// note for the driver), Move up / Move down (the drag's keyboard and screen-reader way). From's sheet: Leave from here /
// People get in / Goods (withStartRole); with people or goods, what gets in, the note at the start and the time there.
// The When step keeps its own Arrive by / Stay rows: both edit the same draft fields.

import { View } from 'react-native';

import { MoreDetails } from '@/components/office/Controls';
import { DurationField } from '@/components/patterns/DurationField';
import { ChoiceChip } from '@/components/patterns/Select';
import { Sheet } from '@/components/patterns/Sheet';
import { TimeField } from '@/components/patterns/TimeField';
import { Button, Field, Txt } from '@/components/ui';
import { durationText } from '@/lib/durations';
import { parseDwell, roleOf, START_ROLES, type StartFields, type StartRole, startRoleOf, STOP_ROLES, type StopDraft, type What, withRole, withStartRole } from '@/office/trip/stopsLogic';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

type T = (key: string, vars?: Record<string, string | number>) => string;

const WHATS: Exclude<What, ''>[] = ['people', 'goods', 'documents', 'other'];
const START_ROLE_KEY: Record<StartRole, string> = { leave: 'office.trip.leaveFromHere', in: 'office.trip.role_in', goods: 'office.trip.role_goods' };

/** The minutes a stay field holds ("1:30" → 90), or null. */
const stayOf = (v: string | undefined): number | null => {
  const m = parseDwell(v ?? '');
  return typeof m === 'number' ? m : null;
};

/** The row's caption: "Stop 2 · Visit", then what is set ("by 11:00", "1 h", "Goods", "Note"), so the sheet shows on the row. */
export function stopCaption(t: T, s: StopDraft, n: number): string {
  const parts = [t('office.trip.stopCaption', { n, type: t(`office.trip.type_${s.type}`) })];
  if (s.what) parts.push(t(`office.trip.what_${s.what}`));
  if (s.arriveBy) parts.push(t('office.trip.byTime', { time: s.arriveBy }));
  const stay = stayOf(s.dwell);
  if (stay !== null) parts.push(durationText(t, stay));
  if (s.pin.trim()) parts.push(t('office.trip.pinSet'));
  if (s.note.trim()) parts.push(t('office.trip.noteSet'));
  return parts.join(' · ');
}

/** From's line when it is a stop: "People get in · 15 min · Note" (nothing while the trip only leaves from there). */
export function startSummary(t: T, f: Pick<StartFields, 'startPax' | 'startWhat' | 'startNote' | 'startDwell'>): string | null {
  if (!f.startPax) return null;
  const role = startRoleOf(f);
  const parts = [t(START_ROLE_KEY[role])];
  if (f.startWhat && f.startWhat !== 'goods') parts.push(t(`office.trip.what_${f.startWhat}`));
  const stay = stayOf(f.startDwell);
  if (stay !== null) parts.push(durationText(t, stay));
  if ((f.startNote ?? '').trim()) parts.push(t('office.trip.noteSet'));
  return parts.join(' · ');
}

/** A stop's ⋯ Options. `onChange` gets the whole row back; `onMove` the index it moves to. */
export function StopOptionsSheet({ stop, index, count, title, suggestedMin, onChange, onMove, onClose }: {
  stop: StopDraft | null;
  index: number;
  count: number;
  title: string;
  /** The default stay for the row's type (the planner's usual time shows on the When step). */
  suggestedMin?: number;
  onChange: (s: StopDraft) => void;
  onMove: (to: number) => void;
  onClose: () => void;
}) {
  const { t } = useApp();
  const s = stop;
  const stay = s ? stayOf(s.dwell) : null;
  return (
    <Sheet visible={!!s} title={title} onClose={onClose} testID="stop-options-sheet" actions={(
      <Button label={t('patterns.done')} onPress={onClose} style={{ flex: 1, minHeight: 52 }} testID="stop-options-done" />
    )}>
      {s ? (
        <>
          <Txt variant="label" color={colors.muted}>{t('office.trip.whatHappens').toUpperCase()}</Txt>
          <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {STOP_ROLES.map((r) => (
              <ChoiceChip key={r} small label={t(`office.trip.role_${r}`)} selected={roleOf(s) === r} onPress={() => onChange(withRole(s, r))} testID={`role-${r}`} />
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <TimeField compact label={t('office.trip.arriveBy')} value={s.arriveBy} onCommit={(arriveBy) => onChange({ ...s, arriveBy })} testID="options-arrive" />
            <DurationField label={t('patterns.stay')} value={stay !== null ? String(stay) : ''} onCommit={(dwell) => onChange({ ...s, dwell })} suggestedMin={suggestedMin} testID="options-stay" />
          </View>
          {/* The site's "Details": what is carried, a pin typed by hand (a pasted one in the search box also works), the note. */}
          <MoreDetails filled={!!(s.pin.trim() || s.note.trim() || s.what === 'documents' || s.what === 'other')} testID="stop-details">
            <View style={{ gap: 6 }}>
              <Txt variant="strong" size={16}>{t('office.trip.whatCarried')}</Txt>
              <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {WHATS.map((w) => (
                  <ChoiceChip key={w} small label={t(`office.trip.what_${w}`)} selected={s.what === w} onPress={() => onChange({ ...s, what: s.what === w ? '' : w })} testID={`what-${w}`} />
                ))}
              </View>
            </View>
            <Field label={t('office.trip.pinTyped')} mono value={s.pin} onChangeText={(pin) => onChange({ ...s, pin, lat: undefined, lng: undefined })} placeholder={t('office.trip.pinPlaceholder')} keyboardType="numbers-and-punctuation" testID="options-pin" />
            <Field label={t('office.trip.stopNote')} value={s.note} onChangeText={(note) => onChange({ ...s, note })} maxLength={300} testID="options-note" />
          </MoreDetails>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button kind="outline" label={t('office.trip.moveUp')} disabled={index <= 0} onPress={() => onMove(index - 1)} style={{ flex: 1, minHeight: 48 }} testID="options-move-up" />
            <Button kind="outline" label={t('office.trip.moveDown')} disabled={index >= count - 1} onPress={() => onMove(index + 1)} style={{ flex: 1, minHeight: 48 }} testID="options-move-down" />
          </View>
        </>
      ) : null}
    </Sheet>
  );
}

/** From's ⋯ Options: Leave from here (the default) / People get in / Goods, and the start stop's own fields. */
export function StartOptionsSheet({ visible, f, setF, onClose }: {
  visible: boolean;
  f: Pick<StartFields, 'startPax' | 'startWhat' | 'startNote' | 'startDwell'>;
  setF: (patch: Partial<StartFields>) => void;
  onClose: () => void;
}) {
  const { t } = useApp();
  const role = startRoleOf(f);
  return (
    <Sheet visible={visible} title={t('office.trip.from')} onClose={onClose} testID="start-options-sheet" actions={(
      <Button label={t('patterns.done')} onPress={onClose} style={{ flex: 1, minHeight: 52 }} testID="start-options-done" />
    )}>
      <Txt variant="label" color={colors.muted}>{t('office.trip.whatHappens').toUpperCase()}</Txt>
      <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {START_ROLES.map((r) => (
          <ChoiceChip key={r} small label={t(START_ROLE_KEY[r])} selected={role === r} onPress={() => setF(withStartRole(f, r))} testID={`start-role-${r}`} />
        ))}
      </View>
      {f.startPax && (
        // The start stop's own fields (the site's StartFrom: what gets in, a note, the time there), optional.
        <View style={{ gap: 14 }} testID="start-details">
          <View style={{ gap: 6 }}>
            <Txt variant="strong" size={16}>{t('office.trip.whatGetsIn')}</Txt>
            <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {WHATS.map((w) => (
                <ChoiceChip key={w} small label={t(`office.trip.what_${w}`)} selected={(f.startWhat ?? '') === w} onPress={() => setF({ startWhat: f.startWhat === w ? '' : w })} testID={`start-what-${w}`} />
              ))}
            </View>
          </View>
          <Field label={t('office.trip.noteAtStart')} value={f.startNote ?? ''} onChangeText={(startNote) => setF({ startNote })} maxLength={300} testID="start-note" />
          <DurationField label={t('office.trip.timeAtStart')} value={f.startDwell ?? ''} onCommit={(startDwell) => setF({ startDwell })} testID="start-stay" />
        </View>
      )}
    </Sheet>
  );
}
