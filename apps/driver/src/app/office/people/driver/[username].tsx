// Office mode (Phase 8, O2, item 7): Manage a driver (design 20). The dark header: back, "Drivers · manage", the active
// pill, the avatar, the name, "D-014 · on duty since 07:02 · the plate", then Call, WhatsApp and Today's route (the
// driver's page, with driver_route). This week links to the Drivers board (drivers_board). Details: phone · WhatsApp with
// Edit (update_driver: the phone, WhatsApp, the licence number and expiry, the emergency contact; only what changed; the
// private fields only when the server sent the private part), the driving licence (the expiry with its chip, the photos
// count), the emergency contact (Call), "Phone changed by the driver · when" when the profile's changes say so. Account:
// the username, Reset PIN (reset_pin: a sheet with a 6-digit PIN typed or generated, shown once, never logged), the
// regular vehicle (list_vehicles' regular_driver; read-only here). "Switch off <name>…" with a confirmation
// (set_driver_active; the server's notes shown after). Data: driver_profile and the driver's row of list_drivers. Every
// button exists only when me.tools has its tool. The rules: office/peopleLogic.ts.

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChevronLeft, ChevronRight, MapPin, MessageCircle, Phone } from '@/components/icons';
import { showSnackbar } from '@/components/patterns/Snackbar';
import { Button, Field, Mono, Notice, Plate, Txt } from '@/components/ui';
import { firstName } from '@/lib/format';
import {
  activePill, editableFields, emergencyText, isPin, latestDriverPhoneChange, licenceOf, licencePhotos, licenceTone, longDate, profileFields, type ProfileFields,
  profilePatch, type ProfileProblem, randomPin, regularVehicleOf, seesPrivate, updateDriverInput, whenText,
} from '@/office/peopleLogic';
import { useOffice, useTool } from '@/office/state';
import type { DriverProfile, DriversList, FleetError, Vehicle, VehiclesList } from '@/office/types';
import { Avatar, Divider, Empty, ErrorNotice, Loading, Pill, Screen, Section } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors, fonts } from '@/theme';

type VehicleRow = Vehicle & { regular_driver?: string };

const open = (url: string) => void Linking.openURL(url).catch(() => undefined);

export default function ManageDriver() {
  const { username } = useLocalSearchParams<{ username: string }>();
  const { t, tList } = useApp();
  const { me, api, signOut } = useOffice();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const names = { days: tList('days'), months: tList('months') };

  const profile = useTool<DriverProfile>('driver_profile', { driver: username });
  const list = useTool<DriversList>('list_drivers', { search: username, include_inactive: true, limit: 25 });
  const mayVehicles = me.tools.includes('list_vehicles');
  const vehicles = useTool<VehiclesList>('list_vehicles', { filter: 'all' }, { enabled: mayVehicles });
  const canEdit = me.tools.includes('update_driver');
  const canPin = me.tools.includes('reset_pin');
  const canSwitch = me.tools.includes('set_driver_active');
  const mayRoute = me.tools.includes('driver_route');
  const mayBoard = me.tools.includes('drivers_board');

  const p = profile.data;
  const d = p?.driver;
  const row = list.data?.drivers.find((x) => x.username === username) ?? null;
  const name = d?.name ?? row?.name ?? username;
  const first = firstName(name);
  const active = d ? d.active : row?.active;
  const pill = activePill(active);
  const priv = seesPrivate(p);
  const licence = licenceOf(p, row);
  const photos = licencePhotos(p?.licence);
  const changedAt = latestDriverPhoneChange(p?.changes);
  const regular = d ? regularVehicleOf(vehicles.data?.vehicles as VehicleRow[] | undefined, d.name) : undefined;
  const links = d?.links ?? (row ? { call: row.call, whatsapp: row.whatsapp } : {});

  // The details editor (in place under the Phone row): only what changed goes to update_driver.
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState<ProfileFields>(profileFields(null, null));
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<ProfileProblem | 'nothing' | null>(null);
  const [saveError, setSaveError] = useState<FleetError | null>(null);
  const [saved, setSaved] = useState(false);
  const fields = editableFields(p);

  function startEdit() {
    setF(profileFields(p, row));
    setProblem(null);
    setSaveError(null);
    setSaved(false);
    setEditing(true);
  }
  async function saveDetails() {
    const r = profilePatch(profileFields(p, row), f, fields);
    if ('error' in r) {
      setProblem(r.error);
      return;
    }
    if (Object.keys(r.patch).length === 0) {
      setProblem('nothing');
      return;
    }
    setProblem(null);
    setSaveError(null);
    setSaving(true);
    try {
      await api.call('update_driver', updateDriverInput(username, r.patch));
      setEditing(false);
      setSaved(true);
      void profile.reload();
      void list.reload();
    } catch (e) {
      setSaveError(e as FleetError);
    } finally {
      setSaving(false);
    }
  }

  // Reset PIN: a sheet; the new PIN is shown once after reset_pin and forgotten when the sheet closes.
  const [pinOpen, setPinOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [pinBusy, setPinBusy] = useState(false);
  const [pinBad, setPinBad] = useState(false);
  const [pinError, setPinError] = useState<FleetError | null>(null);
  const [pinDone, setPinDone] = useState<string | null>(null);
  function closePin() {
    setPinOpen(false);
    setPin('');
    setPinBad(false);
    setPinError(null);
    setPinDone(null);
  }
  async function setNewPin() {
    const value = pin.trim();
    if (!isPin(value)) {
      setPinBad(true);
      return;
    }
    setPinBad(false);
    setPinError(null);
    setPinBusy(true);
    try {
      await api.call('reset_pin', { username, pin: value });
      setPinDone(value);
    } catch (e) {
      setPinError(e as FleetError);
    } finally {
      setPinBusy(false);
    }
  }

  // Switch off / on with a second confirmation; the server's notes (open tasks to reassign) shown after.
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<FleetError | null>(null);
  function confirmSwitch() {
    const off = active !== false;
    Alert.alert(t(off ? 'office.people.switchOffTitle' : 'office.people.switchOnTitle', { name: first }), t(off ? 'office.people.switchOffBody' : 'office.people.switchOnBody'), [
      { text: t('office.common.cancel'), style: 'cancel' },
      { text: t(off ? 'office.people.switchOffConfirm' : 'office.people.switchOnConfirm'), style: off ? 'destructive' : 'default', onPress: () => void doSwitch(!off) },
    ]);
  }
  async function doSwitch(want: boolean) {
    setSwitchError(null);
    setSwitching(true);
    try {
      const out = await api.call<{ notes?: string[] }>('set_driver_active', { username, active: want });
      void profile.reload();
      void list.reload();
      // Hotfix O2-H2, Part 1b: stays on the driver (the switch shows the new state), a snackbar with the server's notes.
      const notes = out.notes ?? [];
      showSnackbar({ text: [t(want ? 'office.people.switchedOn' : 'office.people.switchedOff', { name: first }), ...notes].join(' · '), ...(notes.length ? { ms: 8000 } : {}) });
    } catch (e) {
      setSwitchError(e as FleetError);
    } finally {
      setSwitching(false);
    }
  }

  const refresh = () => void Promise.all([profile.reload(), list.reload(), mayVehicles ? vehicles.reload() : Promise.resolve()]);
  const meta = [d?.code ?? row?.code ?? '', row?.on_duty_since ? t('office.people.onDutySince', { time: row.on_duty_since }) : row?.off_duty_since ? t('office.people.offDutySince', { time: row.off_duty_since }) : ''].filter(Boolean).join(' · ');
  const plate = d?.current_vehicle ?? row?.current_vehicle;
  const notFound = profile.data && !d && list.data && !row;

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      {/* The dark header of design 20. */}
      <View style={[styles.dark, { paddingTop: insets.top + 8 }]}>
        <View style={styles.darkTop}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/office/people/drivers'))} style={styles.darkBtn}>
            <ChevronLeft size={24} color="#ffffff" strokeWidth={2.4} />
          </Pressable>
          <Txt variant="muted" size={15} color="#c9ccd1" style={{ flex: 1 }} numberOfLines={1}>{t('office.people.manageAbove')}</Txt>
          {(d || row) && <Pill text={t(`office.people.${pill.key}`)} tone={pill.tone} size={13} />}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <View style={[styles.bigAvatar, row?.on_duty_since ? { borderColor: colors.green } : null]}>
            <Avatar name={name} size={58} />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Txt variant="title" size={26} color="#ffffff" numberOfLines={2}>{name}</Txt>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {meta ? <Txt variant="muted" size={14} color="#c9ccd1">{meta}</Txt> : null}
              {plate ? <Plate regNo={plate.split(' · ')[0]} dark /> : null}
            </View>
          </View>
        </View>
        {(links.call || links.whatsapp || mayRoute) && (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {links.call && (
              <Pressable accessibilityRole="button" accessibilityLabel={t('office.common.call')} onPress={() => open(links.call as string)} style={styles.darkBtn}>
                <Phone size={20} color="#ffffff" strokeWidth={2.2} />
              </Pressable>
            )}
            {links.whatsapp && (
              <Pressable accessibilityRole="button" accessibilityLabel={t('office.common.whatsapp')} onPress={() => open(links.whatsapp as string)} style={styles.darkBtn}>
                <MessageCircle size={20} color="#ffffff" strokeWidth={2.2} />
              </Pressable>
            )}
            {mayRoute && (
              <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/office/driver/[username]', params: { username } })} style={[styles.darkBtn, { width: undefined, paddingHorizontal: 14, flexDirection: 'row', gap: 8 }]}>
                <MapPin size={18} color="#ffffff" strokeWidth={2.2} />
                <Txt variant="strong" size={15} color="#ffffff">{t('office.people.todayRoute')}</Txt>
              </Pressable>
            )}
          </View>
        )}
      </View>

      <Screen refreshing={profile.refreshing} onRefresh={refresh}>
        {(profile.loading || list.loading) && !d && !row && <Loading text={t('office.common.loading')} />}
        {profile.error && !p && <ErrorNotice error={profile.error} onRetry={refresh} onSignIn={() => void signOut()} />}
        {notFound && <Empty text={t('office.people.notFound', { username })} />}
        {p && p.missing.length > 0 && <Notice text={t('office.people.missing', { list: p.missing.join(', ') })} />}

        {mayBoard && (
          <Pressable accessibilityRole="button" onPress={() => router.push('/office/(tabs)/drivers')} style={styles.linkRow}>
            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="strong" size={17}>{t('office.people.thisWeek')}</Txt>
              <Txt variant="muted" size={15}>{t('office.people.thisWeekHint')}</Txt>
            </View>
            <ChevronRight size={22} color={colors.muted} />
          </Pressable>
        )}

        {(d || row) && (
          <Section title={t('office.people.details')}>
            <View style={styles.row}>
              <View style={{ flex: 1, gap: 2 }}>
                <Txt variant="muted" size={15}>{t('office.people.phoneWhatsapp')}</Txt>
                {!editing && (
                  <Mono size={19} bold>{[d?.phone_display ?? (row?.phone ?? ''), d?.whatsapp_display && d.whatsapp_display !== d.phone_display ? d.whatsapp_display : ''].filter(Boolean).join(' · ') || '—'}</Mono>
                )}
              </View>
              {canEdit && !editing && (
                <Pressable accessibilityRole="button" onPress={startEdit} style={styles.textBtn}>
                  <Txt variant="strong" size={16} color={colors.blue}>{t('office.people.edit')}</Txt>
                </Pressable>
              )}
            </View>
            {editing && (
              <View style={{ gap: 10, paddingBottom: 12 }}>
                {fields.map((k) => (
                  <Field
                    key={k}
                    label={t(`office.people.field.${k}`)}
                    value={f[k]}
                    onChangeText={(v) => setF({ ...f, [k]: v })}
                    editable={!saving}
                    mono={k === 'phone' || k === 'whatsapp' || k === 'emergency_phone' || k === 'licence_no' || k === 'licence_expiry'}
                    keyboardType={k === 'phone' || k === 'whatsapp' || k === 'emergency_phone' ? 'phone-pad' : k === 'licence_expiry' ? 'numbers-and-punctuation' : 'default'}
                    placeholder={k === 'licence_expiry' ? 'YYYY-MM-DD' : undefined}
                    maxLength={k === 'emergency_name' ? 120 : k === 'emergency_relation' ? 60 : k === 'licence_no' ? 40 : k === 'licence_expiry' ? 10 : 30}
                    autoCapitalize={k === 'licence_no' ? 'characters' : 'sentences'}
                  />
                ))}
                {problem && <Notice tone="danger" text={problem === 'nothing' ? t('office.people.nothingChanged') : t(`office.people.err.${problem}`)} />}
                {saveError && <ErrorNotice error={saveError} onRetry={() => void saveDetails()} onSignIn={() => void signOut()} />}
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Button kind="outline" label={t('office.common.cancel')} disabled={saving} onPress={() => setEditing(false)} style={{ flex: 1, minHeight: 52 }} />
                  <Button kind="primary" label={t('office.common.save')} busy={saving} onPress={() => void saveDetails()} style={{ flex: 1, minHeight: 52 }} />
                </View>
              </View>
            )}
            {saved && !editing && <Txt variant="small" color={colors.green} style={{ paddingBottom: 6 }}>{t('office.people.saved')}</Txt>}
            <Divider />
            <View style={styles.row}>
              <View style={{ flex: 1, gap: 2 }}>
                <Txt variant="muted" size={15}>{t('office.people.drivingLicence')}</Txt>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Pill text={licence.expiry ? t('office.people.expires', { date: longDate(names, licence.expiry) }) : t('office.people.expiryNotSet')} tone={licence.expiry ? licenceTone(licence.chip) : 'muted'} size={13} />
                  {p?.licence?.number ? <Mono size={14} color={colors.muted}>{p.licence.number}</Mono> : null}
                </View>
              </View>
              {priv && <Pill text={photos === 0 ? t('office.people.noPhotos') : photos === 1 ? t('office.people.photosOne') : t('office.people.photos', { n: photos })} tone="muted" size={13} />}
            </View>
            {priv && (
              <>
                <Divider />
                <View style={styles.row}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Txt variant="muted" size={15}>{t('office.people.emergency')}</Txt>
                    <Txt variant="strong" size={17} numberOfLines={2}>{emergencyText(p?.emergency) || t('office.people.emergencyNone')}</Txt>
                  </View>
                  {p?.emergency?.links?.call && (
                    <Pressable accessibilityRole="button" accessibilityLabel={t('office.common.call')} onPress={() => open(p.emergency!.links!.call as string)} style={styles.iconBtn}>
                      <Phone size={20} color={colors.ink} strokeWidth={2.4} />
                    </Pressable>
                  )}
                </View>
              </>
            )}
            {changedAt && <Txt variant="strong" size={14} color={colors.amberText} style={{ paddingVertical: 8 }}>{t('office.people.phoneChangedByDriver', { when: whenText(names, changedAt) })}</Txt>}
            {p?.private_hidden && <Txt variant="small" style={{ paddingVertical: 6 }}>{p.private_hidden}</Txt>}
          </Section>
        )}

        {(d || row) && (
          <Section title={t('office.people.account')}>
            <View style={styles.row}>
              <View style={{ flex: 1, gap: 2 }}>
                <Txt variant="muted" size={15}>{t('office.people.username')}</Txt>
                <Mono size={19} bold>{username}</Mono>
              </View>
            </View>
            {canPin && (
              <>
                <Divider />
                <Pressable accessibilityRole="button" onPress={() => setPinOpen(true)} style={styles.row}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Txt variant="strong" size={17}>{t('office.people.resetPin')}</Txt>
                    <Txt variant="muted" size={15}>{t('office.people.resetPinHint', { name: first })}</Txt>
                  </View>
                  <ChevronRight size={22} color={colors.muted} />
                </Pressable>
              </>
            )}
            <Divider />
            <View style={styles.row}>
              <View style={{ flex: 1, gap: 4 }}>
                <Txt variant="strong" size={17}>{t(mayVehicles ? 'office.people.regularVehicle' : 'office.people.vehicleToday')}</Txt>
                {mayVehicles
                  ? regular
                    ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Plate regNo={regular.reg_no} />{regular.make_model ? <Txt variant="muted" size={15}>{regular.make_model}</Txt> : null}</View>
                    : <Txt variant="muted" size={15}>{vehicles.loading ? t('office.common.loading') : t('office.people.noVehicle')}</Txt>
                  : plate
                  ? <Plate regNo={plate.split(' · ')[0]} />
                  : <Txt variant="muted" size={15}>{t('office.people.noVehicle')}</Txt>}
              </View>
            </View>
          </Section>
        )}

        {canSwitch && (d || row) && (
          <View style={{ gap: 10 }}>
            {switchError && <ErrorNotice error={switchError} onRetry={confirmSwitch} onSignIn={() => void signOut()} />}
            <Button
              kind="outline"
              label={t(active !== false ? 'office.people.switchOff' : 'office.people.switchOn', { name: first })}
              onPress={confirmSwitch}
              busy={switching}
              style={active !== false ? { borderColor: colors.red } : { borderColor: colors.ink }}
            />
          </View>
        )}
      </Screen>

      {/* Reset PIN: the sheet. */}
      <Modal visible={pinOpen} transparent animationType="slide" onRequestClose={closePin}>
        <View style={styles.shade}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
            {pinDone ? (
              <>
                <Txt variant="heading">{t('office.people.pinDone', { name: first })}</Txt>
                <Mono size={40} bold selectable style={{ textAlign: 'center', paddingVertical: 8 }}>{pinDone}</Mono>
                <Txt variant="strong" size={15} color={colors.amberText}>{t('office.people.pinTell', { name: first })}</Txt>
                <Button kind="dark" label={t('office.people.done')} onPress={closePin} />
              </>
            ) : (
              <>
                <Txt variant="heading">{t('office.people.pinTitle')}</Txt>
                <Txt variant="muted">{name}</Txt>
                <Txt variant="small">{t('office.people.pinHint')}</Txt>
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10 }}>
                  <Field label={t('office.people.pinLabel')} value={pin} onChangeText={(v) => setPin(v.replace(/\D/g, '').slice(0, 6))} maxLength={6} keyboardType="number-pad" editable={!pinBusy} mono style={{ fontSize: 26, fontFamily: fonts.monoSemiBold }} autoFocus />
                  <Button kind="outline" label={t('office.people.generate')} onPress={() => setPin(randomPin())} disabled={pinBusy} style={{ minHeight: 56 }} />
                </View>
                {pinBad && <Notice tone="danger" text={t('office.people.pinBad')} />}
                {pinError && <ErrorNotice error={pinError} onRetry={() => void setNewPin()} onSignIn={() => void signOut()} />}
                <Button kind="dark" label={t('office.people.setPin')} onPress={() => void setNewPin()} busy={pinBusy} disabled={pin.length !== 6} />
                <Button kind="outline" label={t('office.common.cancel')} onPress={closePin} disabled={pinBusy} />
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  dark: { backgroundColor: colors.ink, paddingHorizontal: 20, paddingBottom: 18, gap: 12 },
  darkTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  darkBtn: { width: 48, height: 48, borderRadius: 14, backgroundColor: colors.darkSurface, alignItems: 'center', justifyContent: 'center' },
  bigAvatar: { width: 66, height: 66, borderRadius: 33, borderWidth: 3, borderColor: colors.darkSurface, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.darkSurface },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1, borderRadius: 18, padding: 16, minHeight: 64 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, minHeight: 56 },
  textBtn: { minHeight: 48, minWidth: 48, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 8 },
  iconBtn: { width: 48, height: 48, borderRadius: 12, borderWidth: 1.5, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  shade: { flex: 1, backgroundColor: 'rgba(10,12,14,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, gap: 12 },
});
