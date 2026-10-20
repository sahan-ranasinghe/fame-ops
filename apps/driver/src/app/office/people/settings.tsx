// Office mode (Phase 8, O2, item 7): Quick settings (design 19's card as a page, section 4 of the plan): get_settings, and
// each row saved at once through update_settings {key, value} with Saved or the error under it (a dropped write says it
// may not have been saved, Try again). The rows: new tasks need the fleet admin's OK and vehicle on the day (switches),
// drivers' personal trips (four choices, one line each), the auto clock-out (HH:MM, empty = off), the accept window
// (minutes) and the office phone (typed as 077…, stored +94…). The controls show only with update_settings (no dead UI);
// with get_settings alone the values are read. The laptop-only line at the bottom. The rules: office/peopleLogic.ts.

import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { TimeInput } from '@/components/office/TimeInput';
import { Toggle } from '@/components/office/PeopleParts';
import { Button, Txt } from '@/components/ui';
import {
  cutoffValue, minutesValue, officePhoneValue, PERSONAL_TRIPS, type PersonalTrips, personalTripsValue, type QuickKey, QUICK_SETTINGS, type QuickRow, settingInput,
  type SettingProblem, switchValue, withSetting,
} from '@/office/peopleLogic';
import { useOffice, useTool } from '@/office/state';
import type { FleetError, SettingsResult } from '@/office/types';
import { BackHeader, Divider, ErrorNotice, Loading, Screen, Section } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors, fonts } from '@/theme';

interface RowState {
  busy?: boolean;
  saved?: boolean;
  error?: FleetError | null;
  problem?: SettingProblem | null;
  /** What was being saved when it failed (Try again sends it again). */
  pending?: unknown;
}

const SAVED_FOR_MS = 2_500;
const ROW: Record<QuickKey, QuickRow> = Object.fromEntries(QUICK_SETTINGS.map((r) => [r.key, r])) as Record<QuickKey, QuickRow>;

export default function QuickSettings() {
  const { t } = useApp();
  const { me, api, signOut } = useOffice();
  const q = useTool<SettingsResult>('get_settings', {});
  const canEdit = me.tools.includes('update_settings');
  const [rows, setRows] = useState<Partial<Record<QuickKey, RowState>>>({});
  const [minutesText, setMinutesText] = useState<Partial<Record<'accept_within_min' | 'accept_before_leave_min', string>>>({});
  const [phoneText, setPhoneText] = useState<string | null>(null);
  const settings = q.data?.settings ?? null;
  const defaults = q.data?.defaults ?? null;

  const setRow = (key: QuickKey, patch: RowState) => setRows((r) => ({ ...r, [key]: { ...r[key], ...patch } }));

  async function save(key: QuickKey, raw: unknown): Promise<boolean> {
    const r = settingInput(ROW[key], raw);
    if ('error' in r) {
      setRow(key, { problem: r.error, error: null, saved: false });
      return false;
    }
    setRow(key, { busy: true, problem: null, error: null, saved: false, pending: raw });
    try {
      await api.call('update_settings', r.input);
      q.patch((p) => ({ ...p, settings: withSetting(p.settings, key, r.input.value) }));
      setRow(key, { busy: false, saved: true });
      setTimeout(() => setRow(key, { saved: false }), SAVED_FOR_MS);
      return true;
    } catch (e) {
      setRow(key, { busy: false, error: e as FleetError });
      return false;
    }
  }

  const status = (key: QuickKey) => {
    const s = rows[key];
    if (!s) return null;
    return (
      <View style={{ gap: 6 }}>
        {s.problem && <Txt variant="strong" size={14} color={colors.red}>{t(`office.people.err.${s.problem}`)}</Txt>}
        {s.error && <ErrorNotice error={s.error} onRetry={() => void save(key, s.pending)} onSignIn={() => void signOut()} />}
        {s.busy && <Txt variant="small">{t('office.people.saving')}</Txt>}
        {s.saved && <Txt variant="small" color={colors.green}>{t('office.people.saved')}</Txt>}
      </View>
    );
  };

  const switchRow = (key: 'tasks_need_approval' | 'vehicle_on_the_day', label: string, hint: string) => {
    const on = switchValue(key, settings, defaults);
    return (
      <View style={{ gap: 6, paddingVertical: 10 }}>
        <View style={styles.row}>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt variant="strong" size={17}>{label}</Txt>
            <Txt variant="small">{hint}</Txt>
          </View>
          {canEdit
            ? <Toggle on={on} label={label} disabled={!!rows[key]?.busy} onPress={() => void save(key, !on)} />
            : <Txt variant="strong" size={15}>{on ? t('office.people.active') : t('office.people.off')}</Txt>}
        </View>
        {status(key)}
      </View>
    );
  };

  const trips = personalTripsValue(settings?.driver_personal_trips, defaults?.driver_personal_trips);
  const cutoff = cutoffValue(settings, defaults);
  const within = minutesValue('accept_within_min', settings, defaults);
  const before = minutesValue('accept_before_leave_min', settings, defaults);
  const phoneShown = phoneText ?? officePhoneValue(settings);
  const minutesRow = (key: 'accept_within_min' | 'accept_before_leave_min', label: string, hint: string, current: number) => {
    const text = minutesText[key] ?? String(current);
    const changed = text.trim() !== String(current);
    return (
      <View style={{ gap: 6, paddingVertical: 10 }}>
        <Txt variant="strong" size={17}>{label}</Txt>
        <View style={styles.row}>
          {canEdit ? (
            <>
              <TextInput
                value={text}
                onChangeText={(v) => setMinutesText((m) => ({ ...m, [key]: v.replace(/\D/g, '').slice(0, 4) }))}
                keyboardType="number-pad"
                maxLength={4}
                editable={!rows[key]?.busy}
                accessibilityLabel={label}
                style={styles.number}
              />
              <Txt variant="muted" size={15} style={{ flex: 1 }}>{`${t('office.people.minutes')} · ${hint}`}</Txt>
              <Button kind="dark" label={t('office.common.save')} onPress={() => void save(key, text).then((ok) => { if (ok) setMinutesText((m) => ({ ...m, [key]: undefined })); })} busy={!!rows[key]?.busy} disabled={!changed} style={{ minHeight: 48, paddingHorizontal: 14 }} />
            </>
          ) : (
            <Txt variant="strong" size={17} style={{ fontFamily: fonts.monoSemiBold }}>{`${current} ${t('office.people.minutes')} · ${hint}`}</Txt>
          )}
        </View>
        {status(key)}
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <BackHeader title={t('office.people.settings')} subtitle={t('office.people.settingsAbove')} />
      <Screen refreshing={q.refreshing} onRefresh={() => void q.reload()}>
        {q.loading && <Loading text={t('office.common.loading')} />}
        {q.error && !q.data && <ErrorNotice error={q.error} onRetry={() => void q.reload()} onSignIn={() => void signOut()} />}
        {q.data && (
          <>
            <Section title={t('office.people.settings')}>
              {switchRow('tasks_need_approval', t('office.people.tasksNeedApproval'), t('office.people.tasksNeedApprovalHint'))}
              <Divider />
              {switchRow('vehicle_on_the_day', t('office.people.vehicleOnTheDay'), t('office.people.vehicleOnTheDayHint'))}
              <Divider />
              <View style={{ gap: 8, paddingVertical: 10 }}>
                <Txt variant="strong" size={17}>{t('office.people.personalTrips')}</Txt>
                <Txt variant="small">{t('office.people.personalTripsHint')}</Txt>
                <View style={{ gap: 6 }}>
                  {PERSONAL_TRIPS.map((v: PersonalTrips) => {
                    const on = trips === v;
                    return (
                      <Pressable
                        key={v}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: on, disabled: !canEdit || !!rows.driver_personal_trips?.busy }}
                        disabled={!canEdit || !!rows.driver_personal_trips?.busy}
                        onPress={() => void save('driver_personal_trips', v)}
                        style={[styles.option, on && styles.optionOn]}
                      >
                        <View style={[styles.radio, on && { borderColor: colors.ink, backgroundColor: colors.ink }]} />
                        <View style={{ flex: 1, gap: 2 }}>
                          <Txt variant="strong" size={16}>{t(`office.people.trips.${v}`)}</Txt>
                          <Txt variant="small">{t(`office.people.trips.${v}Hint`)}</Txt>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
                {status('driver_personal_trips')}
              </View>
              <Divider />
              <View style={{ gap: 8, paddingVertical: 10 }}>
                <View style={styles.row}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Txt variant="strong" size={17}>{t('office.people.cutoff')}</Txt>
                    <Txt variant="small">{t('office.people.cutoffHint')}</Txt>
                  </View>
                  {canEdit
                    ? <View style={{ width: 150 }}><TimeInput value={cutoff} onCommit={(v) => { if (v !== cutoff) void save('duty_cutoff', v); }} /></View>
                    : <Txt variant="strong" size={22} style={{ fontFamily: fonts.monoSemiBold }}>{cutoff || '—'}</Txt>}
                </View>
                <Txt variant="small">{cutoff === '' ? t('office.people.cutoffOff') : t('office.people.cutoffAt', { time: cutoff })}</Txt>
                {status('duty_cutoff')}
              </View>
              <Divider />
              {minutesRow('accept_within_min', t('office.people.acceptWithin'), t('office.people.acceptWithinHint'), within)}
              <Divider />
              {minutesRow('accept_before_leave_min', t('office.people.acceptBefore'), t('office.people.acceptBeforeHint'), before)}
              <Divider />
              <View style={{ gap: 8, paddingVertical: 10 }}>
                <Txt variant="strong" size={17}>{t('office.people.officePhone')}</Txt>
                {canEdit ? (
                  <View style={styles.row}>
                    <TextInput
                      value={phoneShown}
                      onChangeText={setPhoneText}
                      keyboardType="phone-pad"
                      maxLength={30}
                      placeholder="011 234 5678"
                      placeholderTextColor="#9aa0a6"
                      editable={!rows.office_phone?.busy}
                      accessibilityLabel={t('office.people.officePhone')}
                      style={[styles.number, { flex: 1 }]}
                    />
                    <Button kind="dark" label={t('office.common.save')} onPress={() => void save('office_phone', phoneShown).then((ok) => { if (ok) setPhoneText(null); })} busy={!!rows.office_phone?.busy} disabled={phoneText === null || phoneText === officePhoneValue(settings)} style={{ minHeight: 48, paddingHorizontal: 14 }} />
                  </View>
                ) : (
                  <Txt variant="strong" size={17} style={{ fontFamily: fonts.monoSemiBold }}>{officePhoneValue(settings) || '—'}</Txt>
                )}
                <Txt variant="small">{settings?.office_phone ? t('office.people.officePhoneHint') : t('office.people.officePhoneNone')}</Txt>
                {status('office_phone')}
              </View>
            </Section>
            <Txt variant="small" style={{ paddingHorizontal: 4 }}>{t('office.more.laptopOnly')}</Txt>
          </>
        )}
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1.5, borderColor: colors.line, borderRadius: 12, padding: 12, backgroundColor: colors.card, minHeight: 56 },
  optionOn: { borderColor: colors.ink },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2.5, borderColor: '#8b9198' },
  number: { minHeight: 52, width: 92, borderWidth: 1.5, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 12, fontSize: 22, fontFamily: fonts.monoSemiBold, color: colors.ink, backgroundColor: colors.card },
});
