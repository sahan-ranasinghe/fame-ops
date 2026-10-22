// Office mode and /m/ (Round 4–7, feature 6; phase8-plan.md §33.3): who rides, by name. Two pieces:
// - PassengersField, in the trip forms (Who: Assign a task, Request a vehicle and its edit; Change the task): Google
//   Calendar's guests on a phone: "Who rides (optional)", the picked people as chips with their photo and ✕, the search box
//   over the office people (find_people as you type: the photo, the name, the role; a picked one has its check), and "Add
//   someone without an account" in the one bottom sheet (a name and an optional Sri Lankan phone). Under it "Asha, Kamal
//   +3" with the count beside. The rules are the site's (office/trip/passengersLogic.ts, a copy).
// - PassengerRows, on a task and a request: a registered person with their photo ("Has the app"); someone without an
//   account with Call, WhatsApp and (a task) Share trip, the trip in words on WhatsApp (nothing is sent until they press
//   Send there).

import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { Check, Clock, MessageCircle, Navigation, Phone, X } from '@/components/icons';
import { RouteStepper, type StepperRow } from '@/components/patterns/RouteStepper';
import { StatusBanner } from '@/components/patterns/StatusBanner';
import { TaskDriverCard } from '@/components/office/DriverRows';
import { SearchBox } from '@/components/office/PeopleParts';
import { ListEmpty, SkeletonRows } from '@/components/patterns/ListState';
import { look } from '@/components/patterns/look';
import { SelectableRow } from '@/components/patterns/Select';
import { Sheet } from '@/components/patterns/Sheet';
import { Button, Field, Mono, Plate, Txt } from '@/components/ui';
import { phoneLocal } from '@/lib/profile';
import { useOffice, useTool } from '@/office/state';
import { addRider, MAX_PASSENGERS, passengerRow, removeRider, type Rider, riderKey, ridersLine, typedRider } from '@/office/trip/passengersLogic';
import { liveWords, passengerTone, stopWords } from '@/office/passengerView';
import type { FoundPeople, Passenger, PassengerTrip } from '@/office/types';
import { Avatar, ErrorNotice, Pill } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

/** How long typing settles before find_people is asked. */
const SEARCH_DEBOUNCE_MS = 300;

const open = (url: string) => void Linking.openURL(url).catch(() => undefined);

export function PassengersField({ value, onChange, count, testID = 'passengers-field' }: {
  value: Rider[];
  onChange: (riders: Rider[]) => void;
  /** The passenger count as set beside it (for "Asha, Kamal +3"). */
  count?: string;
  testID?: string;
}) {
  const { t } = useApp();
  const { me, signOut } = useOffice();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [typed, setTyped] = useState<{ name: string; phone: string; err: 'name' | 'phone' | null } | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);
  const mayFind = me.tools.includes('find_people');
  const found = useTool<FoundPeople>('find_people', { text: query }, { enabled: !!query && mayFind });
  const full = value.length >= MAX_PASSENGERS;
  const picked = new Set(value.map(riderKey));
  const n = parseInt((count ?? '').trim(), 10);
  const line = ridersLine(value.map((r) => r.name), Number.isFinite(n) ? n : null);

  const toggle = (p: FoundPeople['people'][number]) => {
    const key = `p:${p.id}`;
    onChange(picked.has(key) ? removeRider(value, key) : addRider(value, { person: p.id, name: p.name, label: p.label, ...(p.photo_url ? { photo_url: p.photo_url } : {}) }));
  };
  const addTyped = () => {
    if (!typed) return;
    const r = typedRider(typed.name, typed.phone);
    if ('error' in r) {
      setTyped({ ...typed, err: r.error });
      return;
    }
    onChange(addRider(value, r.rider));
    setTyped(null);
  };

  return (
    <View style={{ gap: 10 }} testID={testID}>
      <Txt variant="strong" size={16}>{t('office.passengers.title')} <Txt variant="muted" size={15}>{t('office.passengers.optional')}</Txt></Txt>
      {value.length > 0 && (
        <View style={styles.chips} testID="passenger-chips">
          {value.map((r) => (
            <View key={riderKey(r)} style={styles.chip} testID="passenger-chip">
              <Avatar name={r.name} size={28} photo={r.photo_url} />
              <Txt variant="strong" size={15} numberOfLines={1} style={{ flexShrink: 1 }}>{r.name}</Txt>
              {!r.person && r.phone ? <Mono size={13} color={colors.muted}>{phoneLocal(r.phone)}</Mono> : null}
              <Pressable accessibilityRole="button" accessibilityLabel={t('office.passengers.remove', { name: r.name })} onPress={() => onChange(removeRider(value, riderKey(r)))} style={styles.x} testID="passenger-remove">
                <X size={18} color={colors.ink} strokeWidth={2.4} />
              </Pressable>
            </View>
          ))}
        </View>
      )}
      {full ? <Txt variant="small">{t('office.passengers.max', { n: MAX_PASSENGERS })}</Txt> : mayFind ? (
        <>
          <SearchBox value={text} onChange={setText} onSubmit={() => setQuery(text.trim())} placeholder={t('office.passengers.search')} clearLabel={t('office.common.clear')} />
          {!!query && (
            <View style={{ gap: 6 }} testID="people-results">
              {found.loading && !found.data && <SkeletonRows rows={2} lines={1} />}
              {found.error && !found.data && <ErrorNotice error={found.error} onRetry={() => void found.reload()} onSignIn={() => void signOut()} />}
              {found.data && found.data.people.length === 0 && <ListEmpty text={t('office.passengers.none')} />}
              {found.data?.people.map((p) => (
                <SelectableRow key={p.id} selected={picked.has(`p:${p.id}`)} onToggle={() => toggle(p)} accessibilityLabel={p.name} testID={`people-row-${p.id}`}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Avatar name={p.name} size={36} photo={p.photo_url} />
                    <View style={{ flex: 1 }}>
                      <Txt variant="strong" size={16} numberOfLines={1}>{p.name}</Txt>
                      <Txt variant="small" numberOfLines={1}>{p.label}</Txt>
                    </View>
                  </View>
                </SelectableRow>
              ))}
            </View>
          )}
        </>
      ) : null}
      {!full && (
        <Pressable accessibilityRole="button" onPress={() => setTyped({ name: query, phone: '', err: null })} style={styles.link} testID="add-typed">
          <Txt variant="strong" size={15} color={colors.blue}>{t('office.passengers.addTyped')}</Txt>
        </Pressable>
      )}
      <Txt variant="small">{line ? `${line} · ` : ''}{t('office.passengers.hint')}</Txt>
      <Sheet
        visible={!!typed}
        title={t('office.passengers.typedTitle')}
        onClose={() => setTyped(null)}
        testID="typed-passenger"
        actions={(
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button kind="outline" label={t('office.common.cancel')} onPress={() => setTyped(null)} style={{ flex: 1 }} />
            <Button label={t('office.passengers.add')} onPress={addTyped} disabled={!typed?.name.trim()} style={{ flex: 1 }} testID="typed-add" />
          </View>
        )}
      >
        {typed && (
          <View style={{ gap: 14 }}>
            <Field label={t('office.passengers.typedName')} value={typed.name} onChangeText={(name) => setTyped({ ...typed, name, err: null })} maxLength={120} autoFocus testID="typed-name" />
            <Field label={t('office.passengers.typedPhone')} mono value={typed.phone} onChangeText={(phone) => setTyped({ ...typed, phone, err: null })} keyboardType="phone-pad" maxLength={30} placeholder="077 123 4567" />
            {typed.err ? <Txt variant="strong" size={15} color={colors.red} testID="typed-error">{t(typed.err === 'name' ? 'office.passengers.needName' : 'office.passengers.badPhone')}</Txt> : null}
            <Txt variant="small">{t('office.passengers.typedHint')}</Txt>
          </View>
        )}
      </Sheet>
    </View>
  );
}

/** Who rides on a task or a request, a row each; `share` only where the answer has it (a task's). */
export function PassengerRows({ list }: { list: Passenger[] }) {
  const { t } = useApp();
  if (!list.length) return null;
  return (
    <View style={{ gap: 4 }} testID="passenger-rows">
      {list.map((p, i) => {
        const row = passengerRow(p);
        return (
          <View key={`${p.employee_id ?? p.name}-${i}`} style={[styles.row, i > 0 && styles.rowLine]} testID={row.registered ? 'passenger-row-app' : 'passenger-row-typed'}>
            <Avatar name={p.name} size={40} photo={p.photo_url} />
            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="strong" size={16} numberOfLines={1}>{p.name}</Txt>
              <Txt variant="small" numberOfLines={1}>{row.registered ? t('office.passengers.hasApp') : row.phone ? `${t('office.passengers.noAccount')} · ${row.phone}` : t('office.passengers.noNumber')}</Txt>
            </View>
            {!row.registered && row.call ? (
              <Pressable accessibilityRole="button" accessibilityLabel={`${t('office.common.call')} ${p.name}`} onPress={() => open(row.call!)} style={styles.iconBtn} testID="passenger-call">
                <Phone size={20} color={colors.ink} strokeWidth={2.4} />
              </Pressable>
            ) : null}
            {!row.registered && row.whatsapp ? (
              <Pressable accessibilityRole="button" accessibilityLabel={`${t('office.common.whatsapp')} ${p.name}`} onPress={() => open(row.whatsapp!)} style={styles.iconBtn} testID="passenger-whatsapp">
                <MessageCircle size={20} color={colors.ink} strokeWidth={2.4} />
              </Pressable>
            ) : null}
            {!row.registered && row.share ? (
              <Pressable accessibilityRole="button" accessibilityLabel={`${t('office.passengers.share')} · ${p.name}`} onPress={() => open(row.share!)} style={[styles.iconBtn, styles.share]} testID="passenger-share">
                <Txt variant="strong" size={14}>{t('office.passengers.share')}</Txt>
              </Pressable>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

/** Round 4–7, item 12 (the approved mockups 2 and 4): who rides as overlapping avatars (the photo, else the initials), at
 *  most three, each ringed white. */
export function AvatarStack({ people, size = 32, testID = 'avatar-stack' }: { people: readonly { name: string; photo_url?: string }[]; size?: number; testID?: string }) {
  if (people.length === 0) return null;
  return (
    <View style={{ flexDirection: 'row' }} testID={testID}>
      {people.slice(0, 3).map((p, i) => (
        <View key={`${p.name}-${i}`} style={[styles.stacked, { borderRadius: (size + 4) / 2, marginLeft: i === 0 ? 0 : -10 }]}>
          <Avatar name={p.name} size={size} photo={p.photo_url} />
        </View>
      ))}
    </View>
  );
}

const STOP_KEY: Record<string, string> = { pickup: 'office.trip.type_pickup', drop: 'office.trip.type_drop', visit: 'office.trip.type_visit' };

/**
 * A trip the person rides in (my_trip's passenger view), view only: the Passenger tag and where it is now (read every
 * minute by the page), the plate with the leave and back-by times, the driver with Call / WhatsApp, the stops as they go.
 * Round 4–7, item 12 (the approved mockup 4, the passenger's view: the same page without the office's actions): the state
 * as the one status banner with the Passenger chip, the driver card, the stops on the route stepper.
 */
export function PassengerTripCard({ trip }: { trip: PassengerTrip }) {
  const { t } = useApp();
  const live = liveWords(trip.live_text);
  const tone = passengerTone(trip.status);
  const rows: StepperRow[] = trip.stops.map((s) => {
    const w = stopWords(s);
    return {
      key: String(s.n),
      mark: String(s.n),
      kind: 'stop',
      state: s.status === 'done' ? 'done' : s.status === 'skipped' ? 'skipped' : s.status === 'arrived' ? 'current' : 'todo',
      time: s.arrived ?? s.planned,
      timeTone: s.status === 'arrived' ? 'blue' : 'ink',
      title: s.place,
      titleLines: 2,
      meta: [
        ...(STOP_KEY[s.type] ? [{ text: t(STOP_KEY[s.type]) }] : []),
        ...(w ? [{ text: t(w.key, w.vars), tone: s.status === 'skipped' ? ('amber' as const) : undefined }] : []),
      ],
      testID: 'passenger-stop',
    };
  });
  return (
    <View style={{ gap: 12 }} testID="passenger-trip">
      <StatusBanner
        tone={tone}
        icon={trip.status === 'in_progress' ? Navigation : trip.status === 'completed' ? Check : trip.status === 'cancelled' ? X : Clock}
        title={'key' in live ? t(live.key, live.vars) : live.text}
        line={trip.back_by ? t('office.myTrip.leaveBack', { leave: trip.leave_at, back: trip.back_by }) : t('office.myTrip.leave', { leave: trip.leave_at })}
        chip={{ text: t('office.passengers.tag'), tone: 'blue' }}
        testID="passenger-banner"
      />
      <View style={styles.card}>
        <TaskDriverCard name={trip.driver ?? undefined} plate={trip.vehicle ?? undefined} call={trip.call} whatsapp={trip.whatsapp} emptyName={t('office.passengers.driverNone')} />
      </View>
      {rows.length > 0 && <RouteStepper rows={rows} live={trip.status === 'in_progress'} testID="passenger-stepper" />}
      <Txt variant="small" testID="passenger-note">{t('office.passengers.viewNote', { time: trip.seen_at })}</Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderColor: look.border, borderWidth: 1, borderRadius: look.radius, padding: 14, gap: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingLeft: 6, paddingRight: 4, borderRadius: 999, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.card, maxWidth: '100%' },
  x: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  link: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  rowLine: { borderTopWidth: 1, borderTopColor: colors.line },
  iconBtn: { minWidth: 44, height: 44, borderRadius: 12, borderWidth: 1.5, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  share: { flexDirection: 'row', gap: 6, paddingHorizontal: 10 },
  stacked: { borderWidth: 2, borderColor: colors.card },
});
