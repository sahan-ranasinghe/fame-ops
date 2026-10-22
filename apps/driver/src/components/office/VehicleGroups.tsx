// Office mode (Hotfix O2-H1, Part B; moved here in Round 3 so the Who step and Approve share it): the vehicles to choose
// from in the site's four groups (Free · Assigned to someone · On a task · In the garage), each a pick-one row (the shared
// ChoiceRow: the plate first, the radio at the end, the tint and the border when picked). A group that cannot be picked
// (the garage) is greyed and says why. A vehicle assigned to someone shows who, with Call and WhatsApp under the row (a
// radio row holds no other button: TalkBack reads them apart). Round 4–7 (7): a busy vehicle names who holds it under the
// row ("Anoja's · 08:00–11:00") with Ask for it.

import { Linking, Pressable, View } from 'react-native';

import { HolderStrip } from '@/components/office/HolderParts';
import { ListEmpty } from '@/components/patterns/ListState';
import { ChoiceRow } from '@/components/patterns/Select';
import { Plate, Txt } from '@/components/ui';
import { availabilityText } from '@/office/availabilityWords';
import { holderOf, type Wanted } from '@/office/holderLogic';
import { groupRows, vehicleLine } from '@/office/trip/formsLogic';
import type { SuggestedVehicle } from '@/office/types';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

const open = (url: string) => void Linking.openURL(url).catch(() => undefined);

export function VehicleRow({ v, selected, onPick, disabled, reason, wanted, ignoreTask }: { v: SuggestedVehicle; selected: boolean; onPick: () => void; disabled: boolean; reason?: string; wanted?: Wanted; ignoreTask?: string }) {
  const { t } = useApp();
  // Round 4–7 (7): a busy vehicle's holder under the row ("Anoja's · 08:00–11:00", Ask), never inside the pick row.
  const holder = holderOf(v);
  return (
    <View key={v.reg_no} style={{ gap: 4 }}>
      <ChoiceRow selected={selected} onPress={onPick} disabled={disabled} disabledReason={reason} leading={<Plate regNo={v.reg_no} />} mark="end" accessibilityLabel={v.reg_no} testID={`vehicle-row-${v.reg_no}`}>
        <Txt variant={v.pick === 'no' ? 'strong' : 'muted'} size={15} color={v.pick === 'no' ? colors.red : v.pick === 'possible' ? colors.amberText : colors.muted}>{vehicleLine(v, (n) => t('office.trip.seats', { n }), (line) => availabilityText(t, line))}</Txt>
        {v.assigned_to ? <Txt variant="small">{[t('office.trip.assignedTo', { name: v.assigned_to }), v.custodian_note, v.note].filter(Boolean).join(' · ')}</Txt> : null}
      </ChoiceRow>
      {v.assigned_to && (v.call || v.whatsapp) ? (
        <View style={{ flexDirection: 'row', gap: 18, paddingHorizontal: 14 }}>
          {v.call ? <Pressable accessibilityRole="button" accessibilityLabel={`${t('office.common.call')} ${v.assigned_to}`} onPress={() => open(v.call!)} hitSlop={8} style={{ minHeight: 40, justifyContent: 'center' }}><Txt variant="strong" size={14} color={colors.blue}>{t('office.common.call')}</Txt></Pressable> : null}
          {v.whatsapp ? <Pressable accessibilityRole="button" accessibilityLabel={`${t('office.common.whatsapp')} ${v.assigned_to}`} onPress={() => open(v.whatsapp!)} hitSlop={8} style={{ minHeight: 40, justifyContent: 'center' }}><Txt variant="strong" size={14} color={colors.blue}>{t('office.common.whatsapp')}</Txt></Pressable> : null}
        </View>
      ) : null}
      {holder && holder.task_id !== ignoreTask ? <HolderStrip holder={holder} resource="vehicle" what={v.reg_no} wanted={wanted} testID={`vehicle-holder-${v.reg_no}`} /> : null}
    </View>
  );
}

/** The groups (formsLogic.groupRows), each with its title, the vehicles as rows; `empty` when there is none. */
export function VehicleGroups({ rows, picked, onPick, empty, testID, wanted, ignoreTask }: {
  rows: ReturnType<typeof groupRows>;
  picked: string;
  onPick: (regNo: string) => void;
  empty: string;
  testID?: string;
  /** Round 4–7 (7): the trip being planned (Ask for it on a busy vehicle asks for that time). */
  wanted?: Wanted;
  /** The task being changed (its own vehicle names no holder to ask). */
  ignoreTask?: string;
}) {
  const { t } = useApp();
  return (
    <View style={{ gap: 6 }} testID={testID}>
      {rows.length === 0 && <ListEmpty text={empty} />}
      {rows.map((g) => (
        <View key={g.key} style={{ gap: 2 }}>
          <Txt variant="label" color={colors.muted} style={{ marginTop: 6 }}>{t(`office.trip.group_${g.key}`).toUpperCase()}</Txt>
          <View accessibilityRole="radiogroup" style={{ gap: 6 }}>
            {g.rows.map((v) => <VehicleRow key={v.reg_no} v={v} selected={picked === v.reg_no} onPick={() => onPick(v.reg_no)} disabled={g.disabled} reason={g.disabled ? t(`office.trip.group_${g.key}`) : undefined} wanted={wanted} ignoreTask={ignoreTask} />)}
          </View>
        </View>
      ))}
    </View>
  );
}
