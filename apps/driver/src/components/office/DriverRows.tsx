// Office mode (Hotfix O2-H1, Part B; Round 3): the one driver card. Round 3 (docs/phase8-plan.md §30, item 2) makes it
// driver-first, the pattern of Uber Fleet's and Samsara's driver lists: the photo (initials until there is one), the name,
// the state in words (on duty, off duty, on a task; "best match" with its reason), and the vehicle as a chip UNDER the
// name: the plate they hold today, their regular one ("regular"), "Vehicle: on the day" when the fleet setting
// vehicle_on_the_day is on and none is known, else "No vehicle yet" (never the server's English vehicle_note). The same
// card wherever a driver is picked or listed for a trip:
//   - DriverChoiceRow: one driver to pick (the shared ChoiceRow: the radio, the tint and the border when picked): the Who
//     step and Book now (Who's available), Change the task, Give it a driver, Approve, Book now's free drivers;
//   - DriverRows: Who's available as a list of those, with "Ask drivers" beside the title;
//   - VehicleChipView: the chip alone (the Drivers tab, Live's list);
//   - TaskDriverCard: a task's header (Task detail): the driver, the person who drives it themselves or someone else, with
//     a small word instead of the duty state ("Drives themselves", "Someone else") and Call / WhatsApp.

import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { MessageCircle, Phone } from '@/components/icons';
import { ChoiceRow } from '@/components/patterns/Select';
import { Plate, Txt } from '@/components/ui';
import { driverParts, driverPill, presenceLine, rankedDrivers, type VehicleChip, vehicleChip, vehicleChipText } from '@/office/approveLogic';
import { sentenceText } from '@/office/statusWords';
import { drivenByKey } from '@/office/trip/whoWords';
import type { Availability, AvailableDriver, DrivenBy } from '@/office/types';
import { ListEmpty, SkeletonRows } from '@/components/patterns/ListState';
import { Avatar, ListFailed, Pill, StatusChip, type Tone } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

const open = (url: string) => void Linking.openURL(url).catch(() => undefined);

/** The vehicle chip under a driver's name: the plate ("regular" beside a regular one), or the words when none is known. */
export function VehicleChipView({ chip, testID }: { chip: VehicleChip; testID?: string }) {
  const { t } = useApp();
  const words = vehicleChipText(chip, t);
  if (chip.kind === 'plate') {
    return (
      <View style={styles.chipRow} testID={testID}>
        <Plate regNo={chip.plate} />
        {words ? <Txt variant="small">{words}</Txt> : null}
      </View>
    );
  }
  return <View style={styles.chipRow} testID={testID}><Pill text={words} tone="muted" size={13} /></View>;
}

/** One driver to pick: the photo, the name (with "best match"), the state's line, the vehicle chip, last seen. */
export function DriverChoiceRow({ d, selected, onPress, onDay, lines, best = false, bestWhy, pill, disabled = false, disabledReason, presence, testID, card = true }: {
  d: { name: string; username?: string | null; photo_url?: string; vehicle?: { reg_no: string; source: 'on_duty' | 'regular' } | null };
  selected: boolean;
  onPress: () => void;
  /** The fleet setting vehicle_on_the_day (the chip says "Vehicle: on the day" when none is known). */
  onDay: boolean;
  /** The state's parts (driverParts), joined with " · ". */
  lines?: string[];
  best?: boolean;
  /** The best match's reason, in the person's words. */
  bestWhy?: string;
  pill?: { text: string; tone: Tone } | null;
  disabled?: boolean;
  disabledReason?: string;
  /** "Last seen 17:42 near Kadawatha · usually starts 07:40" (presenceLine). */
  presence?: string;
  testID?: string;
  card?: boolean;
}) {
  const { t } = useApp();
  return (
    <ChoiceRow
      card={card}
      selected={selected}
      onPress={onPress}
      disabled={disabled}
      disabledReason={disabledReason}
      leading={<Avatar name={d.name} size={48} photo={d.photo_url} />}
      mark="end"
      trailing={pill ? <StatusChip text={pill.text} tone={pill.tone} /> : null}
      accessibilityLabel={d.name}
      testID={testID}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Txt variant="strong" size={18}>{d.name}</Txt>
        {best && <Pill text={t('office.request.bestMatch')} tone="amber" size={13} />}
      </View>
      <VehicleChipView chip={vehicleChip(d, onDay)} testID={testID ? `${testID}-vehicle` : undefined} />
      {lines && lines.length > 0 ? <Txt variant="muted" size={15}>{lines.join(' · ')}</Txt> : null}
      {best && bestWhy ? <Txt variant="small" color={colors.amberText}>{bestWhy}</Txt> : null}
      {presence ? <Txt variant="small">{presence}</Txt> : null}
    </ChoiceRow>
  );
}

/** Who's available as rows (the Who step, Book now, Change the task): one DriverChoiceRow per driver. */
export function DriverRows({ data, loading, error, picked, onPick, onRetry, onSignIn, onAsk, noWindow, onDay = false }: {
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
  /** The fleet setting vehicle_on_the_day. */
  onDay?: boolean;
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
        const pillKey = driverPill(x, best);
        return (
          <DriverChoiceRow
            key={x.username ?? x.name}
            d={x}
            selected={!!x.username && x.username === picked}
            onPress={() => onPick(x)}
            onDay={onDay}
            lines={driverParts(x, t)}
            best={pillKey === 'best'}
            bestWhy={data?.best?.why ? sentenceText(t, data.best.why) : undefined}
            pill={pillKey && pillKey !== 'best' ? { text: t(`office.request.${pillKey}`), tone: pillKey === 'not_available' ? 'red' : pillKey === 'busy' ? 'blue' : 'muted' } : null}
            disabled={!x.username}
            disabledReason={x.username ? undefined : t('office.ask.noAccount')}
            presence={presenceLine(x, t)}
            testID={`driver-row-${x.username ?? x.name}`}
          />
        );
      })}
    </View>
  );
}

/**
 * A task's driver at the top of Task detail: the driver-first card. A driver: the photo, the name, the plate. The person
 * who drives it themselves: their photo with "Drives themselves". Someone not in Fame Fleet: their initials, their name
 * with "Someone else", and their Call / WhatsApp. No duty state for a trip with no app (there is no app to say it).
 */
export function TaskDriverCard({ name, photo, drivenBy, plate, vehicleText, details, call, whatsapp, emptyName }: {
  name?: string;
  photo?: string;
  drivenBy?: DrivenBy;
  plate?: string;
  /** "Vehicle: on the day", "Any van" while no plate is set. */
  vehicleText?: string;
  /** The line under (the vehicle's model, the start odometer). */
  details?: string;
  call?: string;
  whatsapp?: string;
  /** When there is no driver at all ("No driver yet"). */
  emptyName: string;
}) {
  const { t } = useApp();
  const word = drivenByKey(drivenBy);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }} testID="task-driver-card">
      {name ? <Avatar name={name} size={52} photo={drivenBy === 'other' ? undefined : photo} /> : null}
      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Txt variant="strong" size={18}>{name ?? emptyName}</Txt>
          {word ? <Pill text={t(word)} tone="muted" size={13} /> : null}
        </View>
        {plate ? <View style={styles.chipRow}><Plate regNo={plate} /></View> : vehicleText ? <View style={styles.chipRow}><Pill text={vehicleText} tone="muted" size={13} /></View> : null}
        {details ? <Txt variant="muted" size={15}>{details}</Txt> : null}
      </View>
      {call ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`${t('office.common.call')} ${name ?? ''}`.trim()} onPress={() => open(call)} style={styles.iconBtn} testID="task-driver-call">
          <Phone size={22} color={colors.ink} strokeWidth={2.4} />
        </Pressable>
      ) : null}
      {whatsapp ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`${t('office.common.whatsapp')} ${name ?? ''}`.trim()} onPress={() => open(whatsapp)} style={styles.iconBtn} testID="task-driver-whatsapp">
          <MessageCircle size={22} color={colors.ink} strokeWidth={2.4} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 2 },
  iconBtn: { width: 52, height: 52, borderRadius: 14, borderWidth: 1.5, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
});
