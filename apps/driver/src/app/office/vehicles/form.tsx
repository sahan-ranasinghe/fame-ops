// Office mode (Phase 8, O2, item 7): Register a vehicle, or change one (?reg=<plate>): the same form as the site's
// VehicleForm; an update sends only the fields filled in (empty fields keep their value, the current one shown under the
// field). Numbers in mono, dates on the calendar (docs/ui-patterns.md §3), the type and the regular driver as chips, the rental company with
// "+ Add a company" (add_rental_company) when allowed, the custodian by name or e-mail ("none" clears). Register saves
// through register_vehicle, an update through update_vehicle; both go back to the vehicle. Documents and photos are
// laptop work (their upload tools are web-only).
// Round 4–7 (5): the fuel type as chips, required (the button waits with "Pick the fuel type" above it; an edit starts
// from the vehicle's own), and the grade that fits it (optional; Not set).

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { useLeaveGuard } from '@/components/navigation';
import { DateField } from '@/components/patterns/Calendar';
import { ChoiceChips } from '@/components/patterns/Select';
import { showSnackbar } from '@/components/patterns/Snackbar';
import { Button, Txt } from '@/components/ui';
import { companyInput, emptyVehicle, FUEL_TYPES, fuelMissing, fuelShown, gradesFor, VEHICLE_TYPES, vehicleFormDirty, type VehicleFields, vehicleInput, withFuelGrade, withFuelType } from '@/office/manageLogic';
import { useOffice, useTool } from '@/office/state';
import type { DriversList, FleetError, FuelGrade, FuelType, VehicleCard, VehiclesList } from '@/office/types';
import { BackHeader, ErrorNotice, Screen, StickyActions } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors, fonts } from '@/theme';
import { datesInWords } from '@/lib/dateWords';

export default function VehicleFormScreen() {
  const { reg } = useLocalSearchParams<{ reg?: string }>();
  const plate = reg || null;
  const isNew = plate === null;
  const { t, language } = useApp();
  const { api, me, signOut } = useOffice();
  const router = useRouter();
  const [f, setF] = useState<VehicleFields>(emptyVehicle);
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState<string | null>(null);
  const [problem, setProblem] = useState<FleetError | null>(null);
  // The vehicle as it is (an edit): undefined while it loads, null when it could not be read.
  const [current, setCurrent] = useState<VehicleCard | null | undefined>(undefined);
  const [company, setCompany] = useState<{ open: boolean; name: string; phone: string; note: string | null; busy: boolean }>({ open: false, name: '', phone: '', note: null, busy: false });
  const drivers = useTool<DriversList>('list_drivers', { limit: 100 }, { enabled: me.tools.includes('list_drivers') });
  const { allowLeave } = useLeaveGuard(vehicleFormDirty(f), busy);
  const set = <K extends keyof VehicleFields>(k: K, v: VehicleFields[K]) => setF((x) => ({ ...x, [k]: v }));
  const bodyFont = { fontFamily: language === 'si' ? fonts.sinhalaBody : fonts.body };

  // An update shows what each field holds now, under it.
  useEffect(() => {
    if (!plate) return;
    let alive = true;
    void api.call<VehiclesList>('list_vehicles', { filter: 'all', search: plate, limit: 25 }).then((r) => {
      if (alive) setCurrent(r.vehicles.find((x) => x.reg_no === plate) ?? null);
    }).catch(() => { if (alive) setCurrent(null); });
    return () => { alive = false; };
  }, [plate]); // eslint-disable-line react-hooks/exhaustive-deps

  // Round 4–7 (5): the vehicle's fuel now (an edit; undefined while it loads), what the form shows, and what the save waits for.
  const now = isNew ? null : current === undefined ? undefined : current ? { fuel_type: current.fuel_type, fuel_grade: current.fuel_grade } : null;
  const fuel = fuelShown(f, now);
  const waits = fuelMissing(f, isNew, now) ? t('office.fuel.pickType') : !isNew && now === undefined ? t('office.common.loading') : null;

  async function save() {
    if (busy || waits) return;
    const v = vehicleInput(f, plate, now);
    if ('error' in v) {
      setWhy(v.error === 'plate' ? t('office.vehicles.needPlate') : v.error === 'fuel' ? t('office.fuel.pickType') : v.error === 'nothing' ? t('office.vehicles.nothing') : t(v.error === 'date' ? 'office.vehicles.badDate' : 'office.vehicles.badNumber', { field: t(`office.vehicles.f_${v.field ?? 'seats'}`) }));
      return;
    }
    setWhy(null);
    setProblem(null);
    setBusy(true);
    try {
      const out = await api.call<{ registered?: { reg_no?: string } }>(v.tool, v.input);
      const saved = out?.registered?.reg_no ?? String(v.input.reg_no);
      allowLeave();
      // Hotfix O2-H2, Part 1b: the vehicle opens (a new one in the form's place, an edit back to it), a snackbar says so.
      if (isNew) router.replace({ pathname: '/office/vehicles/[reg]', params: { reg: saved } });
      else router.back();
      showSnackbar(isNew ? { text: `${t('office.vehicles.registeredTitle', { plate: saved })} · ${t('office.vehicles.registeredBody')}`, ms: 6000 } : { text: t('office.vehicles.updatedTitle') });
    } catch (e) {
      setProblem(e as FleetError);
    } finally {
      setBusy(false);
    }
  }

  async function addCompany() {
    const input = companyInput(company.name, company.phone);
    if (!input) {
      setCompany({ ...company, note: t('office.vehicles.companyNeedName') });
      return;
    }
    setCompany({ ...company, busy: true, note: null });
    try {
      await api.call('add_rental_company', input);
      set('company', String(input.name));
      setCompany({ open: false, name: '', phone: '', note: t('office.vehicles.companyAdded', { name: String(input.name) }), busy: false });
    } catch (e) {
      setCompany({ ...company, busy: false, note: (e as FleetError).message });
    }
  }

  const field = (k: keyof VehicleFields, label: string, opts: { numeric?: boolean; date?: boolean; placeholder?: string; now?: string | number | null } = {}) => opts.date ? (
    // A date is picked on the calendar (docs/ui-patterns.md §3: a plain date), never typed.
    <View style={{ gap: 4 }}>
      <DateField label={label} value={f[k] as string} onChange={(v) => set(k, v as never)} testID={`vehicle-${k}`} />
      {!isNew && opts.now != null && opts.now !== '' ? <Txt variant="small">{t('office.vehicles.now', { value: datesInWords(t, String(opts.now)) })}</Txt> : null}
    </View>
  ) : (
    <View style={{ gap: 4 }}>
      <Txt variant="label" color={colors.muted}>{label.toUpperCase()}</Txt>
      <TextInput
        value={f[k]}
        onChangeText={(v) => set(k, v as never)}
        placeholder={opts.placeholder ?? ''}
        placeholderTextColor="#9aa0a6"
        keyboardType={opts.numeric ? 'number-pad' : 'default'}
        autoCapitalize={k === 'reg' ? 'characters' : 'sentences'}
        autoCorrect={false}
        maxLength={k === 'reg' ? 20 : 200}
        accessibilityLabel={label}
        style={[styles.input, (opts.numeric || opts.date) && { fontFamily: fonts.monoSemiBold, fontSize: 20 }, !(opts.numeric || opts.date) && bodyFont]}
      />
      {!isNew && opts.now != null && opts.now !== '' ? <Txt variant="small">{t('office.vehicles.now', { value: datesInWords(t, String(opts.now)) })}</Txt> : null}
    </View>
  );
  // The shared chips (patterns/Select): the check, the tint and the border on the picked one.
  const chips = <K extends string>(value: K | '', options: { key: K | ''; label: string }[], onPick: (k: K | '') => void) => (
    <ChoiceChips<K | ''> options={options} value={value} onChange={onPick} />
  );
  const keepOrNone = { key: '' as const, label: t(isNew ? 'office.vehicles.none' : 'office.vehicles.keep') };
  const activeDrivers = (drivers.data?.drivers ?? []).filter((d) => d.active !== false);

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <BackHeader title={isNew ? t('office.vehicles.register') : plate!} subtitle={isNew ? t('office.vehicles.newRented') : t('office.vehicles.changeVehicle')} />
      <Screen bottom={16}>
        {isNew ? field('reg', t('office.vehicles.f_reg'), { placeholder: 'WP CAB-4521' }) : <Txt variant="muted">{t('office.vehicles.onlyChanged')}</Txt>}
        {field('model', t('office.vehicles.f_model'), { placeholder: 'Toyota HiAce', now: current?.make_model })}
        <View style={{ gap: 6 }}>
          <Txt variant="label" color={colors.muted}>{t('office.vehicles.f_type').toUpperCase()}</Txt>
          {chips(f.type, [keepOrNone, ...VEHICLE_TYPES.map((k) => ({ key: k, label: t(`office.vehicles.type_${k}`) }))], (k) => set('type', k))}
          {!isNew && current?.type ? <Txt variant="small">{t('office.vehicles.now', { value: t(`office.vehicles.type_${current.type}`) })}</Txt> : null}
        </View>
        <View style={{ gap: 6 }} testID="vehicle-fuel">
          <Txt variant="label" color={colors.muted}>{t('office.vehicles.f_fuelType').toUpperCase()}</Txt>
          <ChoiceChips<FuelType> options={FUEL_TYPES.map((k) => ({ key: k, label: t(`office.fuel.type_${k}`) }))} value={fuel.type} onChange={(k) => setF((x) => ({ ...x, ...withFuelType(x, k, now) }))} />
        </View>
        {gradesFor(fuel.type).length > 0 && (
          <View style={{ gap: 6 }} testID="vehicle-grade">
            <Txt variant="label" color={colors.muted}>{t('office.vehicles.f_fuelGrade').toUpperCase()}</Txt>
            <ChoiceChips<FuelGrade | ''> options={[{ key: '' as const, label: t('office.fuel.gradeNone') }, ...gradesFor(fuel.type).map((g) => ({ key: g, label: t(`office.fuel.grade_${g}`) }))]} value={fuel.grade ?? ''} onChange={(k) => setF((x) => ({ ...x, ...withFuelGrade(x, k, now) }))} />
          </View>
        )}
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>{field('seats', t('office.vehicles.f_seats'), { numeric: true, now: current?.seats })}</View>
          <View style={{ flex: 1 }}>{field('allow', t('office.vehicles.f_allow'), { numeric: true, now: current?.km_allowance })}</View>
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>{field('odo', t('office.vehicles.f_odo'), { numeric: true, now: current?.odometer_km })}</View>
          <View style={{ flex: 1 }}>{field('rent', t('office.vehicles.f_rent'), { numeric: true, now: current?.monthly_rent_lkr })}</View>
        </View>
        {field('company', t('office.vehicles.f_company'), { now: current?.rented_from })}
        {me.tools.includes('add_rental_company') && (
          <View style={{ gap: 8 }}>
            {!company.open && <Pressable accessibilityRole="button" onPress={() => setCompany({ ...company, open: true, note: null })} hitSlop={8}><Txt variant="strong" size={15} color={colors.blue}>{t('office.vehicles.addCompany')}</Txt></Pressable>}
            {company.open && (
              <View style={styles.card}>
                <TextInput value={company.name} onChangeText={(v) => setCompany({ ...company, name: v })} placeholder={t('office.vehicles.f_company')} placeholderTextColor="#9aa0a6" maxLength={120} style={[styles.input, bodyFont]} />
                <TextInput value={company.phone} onChangeText={(v) => setCompany({ ...company, phone: v })} placeholder={t('office.vehicles.companyPhone')} placeholderTextColor="#9aa0a6" keyboardType="phone-pad" maxLength={30} style={[styles.input, { fontFamily: fonts.monoSemiBold }]} />
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Button kind="dark" label={t('office.vehicles.addCompanyConfirm')} onPress={() => void addCompany()} busy={company.busy} style={{ flex: 1, minHeight: 48 }} />
                  <Button kind="outline" label={t('office.common.cancel')} onPress={() => setCompany({ ...company, open: false })} style={{ flex: 1, minHeight: 48 }} />
                </View>
              </View>
            )}
            {company.note ? <Txt variant="small">{company.note}</Txt> : null}
          </View>
        )}
        {field('until', t('office.vehicles.f_until'), { date: true, now: current?.rent_until })}
        <View style={{ gap: 6 }}>
          <Txt variant="label" color={colors.muted}>{t('office.vehicles.f_driver').toUpperCase()}</Txt>
          {drivers.error && !drivers.data ? <ErrorNotice error={drivers.error} onRetry={() => void drivers.reload()} onSignIn={() => void signOut()} /> : null}
          {chips(f.driver, [keepOrNone, ...activeDrivers.map((d) => ({ key: d.username, label: d.name }))], (k) => set('driver', k))}
          {!isNew && current?.regular_driver ? <Txt variant="small">{t('office.vehicles.now', { value: current.regular_driver })}</Txt> : null}
        </View>
        {field('custodian', t('office.vehicles.f_custodian'), { placeholder: t(isNew ? 'office.vehicles.custodianHint' : 'office.vehicles.custodianHintEdit'), now: current?.assigned_to })}
        {field('custodianNote', t('office.vehicles.f_custodianNote'), { now: current?.custodian_note })}
        <Txt variant="small">{t('office.vehicles.custodianNote')}</Txt>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>{field('svcint', t('office.vehicles.f_svcint'), { numeric: true })}</View>
          <View style={{ flex: 1 }}>{field('svclast', t('office.vehicles.f_svclast'), { numeric: true })}</View>
        </View>
        {field('svcdate', t('office.vehicles.f_svcdate'), { date: true, now: current?.next_service })}
        {!isNew && field('garage', t('office.vehicles.f_garage'), { date: true, now: current?.garage_booked })}
        {field('lic', t('office.vehicles.f_lic'), { date: true, now: current?.documents?.lic?.expiry })}
        {field('ins', t('office.vehicles.f_ins'), { date: true, now: current?.documents?.ins?.expiry })}
        {field('emi', t('office.vehicles.f_emi'), { date: true, now: current?.documents?.emi?.expiry })}
        {!isNew && (
          <>
            <View style={{ gap: 6 }}>
              <Txt variant="label" color={colors.muted}>{t('office.vehicles.f_ingarage').toUpperCase()}</Txt>
              {chips(f.ingarage, [{ key: '', label: t('office.vehicles.keep') }, { key: 'true', label: t('common.yes') }, { key: 'false', label: t('common.no') }], (k) => set('ingarage', k))}
            </View>
            <View style={{ gap: 6 }}>
              <Txt variant="label" color={colors.muted}>{t('office.vehicles.f_active').toUpperCase()}</Txt>
              {chips(f.active, [{ key: '', label: t('office.vehicles.keep') }, { key: 'true', label: t('common.yes') }, { key: 'false', label: t('common.no') }], (k) => set('active', k))}
              <Txt variant="small">{t('office.vehicles.activeNote')}</Txt>
            </View>
          </>
        )}
        {why && <Txt variant="strong" color={colors.red}>{why}</Txt>}
        {problem && <ErrorNotice error={problem} onRetry={() => void save()} />}
      </Screen>
      <StickyActions>
        {/* The one reason the button waits (docs/phase8-plan.md §16): the fuel type, or the vehicle still loading. */}
        {waits ? <Txt variant="strong" size={15} color={colors.red} testID="vehicle-save-why">{waits}</Txt> : null}
        <Button label={isNew ? t('office.vehicles.register') : t('office.trip.saveChanges')} onPress={() => void save()} busy={busy} disabled={!!waits} style={{ minHeight: 60 }} />
      </StickyActions>
    </View>
  );
}

const styles = StyleSheet.create({
  input: { minHeight: 52, borderWidth: 1.5, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 14, fontSize: 17, color: colors.ink, backgroundColor: colors.card },
  card: { backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1, borderRadius: 14, padding: 12, gap: 10 },
});
