// Office mode (Phase 8, O1): the Profile (design 18), a stack screen from More → My profile. Who this is with the
// permission chips (never a role name), Contact (the phone drivers can call, edited in place → update_my_profile, then
// /me again so the number follows; the work e-mail), Notifications (a switch per event from my_notification_settings,
// each change sent on its own through set_my_notification_settings, optimistic and put back if refused), App (the
// language, the office phone from get_settings with Call, the privacy policy, the version) and Sign out. The phone has
// no office push yet, so the design's Sounds switch and "Test sound" are not shown (no dead UI). The banner "Add your
// phone number…" shows while /me says phone_required.

import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, View } from 'react-native';

import { ChevronRight, FileText, Phone } from '@/components/icons';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { Button, Field, Mono, Notice, Txt } from '@/components/ui';
import { PRIVACY_URL } from '@/config';
import { phoneDisplay } from '@/lib/contacts';
import { telLink } from '@/lib/format';
import { useOffice, useTool } from '@/office/state';
import { initials } from '@/office/text';
import type { FleetError, NotificationSettings, SettingsResult } from '@/office/types';
import { ListEmpty, SkeletonRows } from '@/components/patterns/ListState';
import { BackHeader, Divider, ErrorNotice, ListFailed, Screen, Section } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

interface ProfileAnswer {
  phone?: string;
  phone_display?: string;
}

export default function OfficeProfile() {
  const { t } = useApp();
  const { me, api, refreshMe, signOut } = useOffice();
  const router = useRouter();
  const settings = useTool<SettingsResult>('get_settings', {});
  const notif = useTool<NotificationSettings>('my_notification_settings', {});

  // The phone, edited in place. The server's answer is shown until /me follows (a dropped /me keeps the saved number).
  const [editing, setEditing] = useState(false);
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<FleetError | null>(null);
  const [saved, setSaved] = useState<ProfileAnswer | null>(null);
  const shownPhone = saved ? (saved.phone_display ?? (saved.phone ? phoneDisplay(saved.phone) : undefined)) : me.phone_display;

  const [toggleError, setToggleError] = useState<{ event: string; next: boolean; error: FleetError } | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  function startEdit() {
    setPhone(shownPhone ?? '');
    setSaveError(null);
    setSaved(null);
    setEditing(true);
  }

  async function savePhone() {
    const value = phone.trim();
    setSaving(true);
    setSaveError(null);
    try {
      const answer = await api.call<ProfileAnswer>('update_my_profile', { phone: value === '' ? null : value });
      setSaved(answer ?? {});
      setEditing(false);
      await refreshMe();
    } catch (e) {
      setSaveError(e as FleetError);
    } finally {
      setSaving(false);
    }
  }

  async function toggle(event: string, next: boolean) {
    setToggleError(null);
    const set = (on: boolean) => notif.patch((p) => ({ ...p, events: p.events.map((x) => (x.event === event ? { ...x, enabled: on } : x)) }));
    set(next);
    try {
      await api.call('set_my_notification_settings', { events: { [event]: next } });
    } catch (e) {
      set(!next);
      setToggleError({ event, next, error: e as FleetError });
    }
  }

  function confirmSignOut() {
    Alert.alert(t('office.common.signOut'), t('office.more.signOutBody'), [
      { text: t('office.common.cancel'), style: 'cancel' },
      {
        text: t('office.common.signOut'),
        style: 'destructive',
        onPress: () => {
          setSigningOut(true);
          void signOut().then(() => router.replace('/login'));
        },
      },
    ]);
  }

  const officePhone = settings.data?.settings.office_phone ?? null;
  const officeTel = telLink(officePhone);
  const version = Constants.expoConfig?.version ?? '';

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <BackHeader title={t('office.more.profile')} />
      <Screen>
        {me.phone_required && !shownPhone && <Notice text={t('office.profile.phoneNeeded')} />}

        {/* Who this is (design 18): the big initial, the name, the permission chips. */}
        <View style={styles.hero}>
          <View style={styles.bigAvatar}>
            <Txt variant="heading" size={26} color={colors.ink}>{initials(me.name)}</Txt>
          </View>
          <View style={{ flex: 1, gap: 8 }}>
            <Txt variant="title" size={26} color="#ffffff" numberOfLines={2}>{me.name}</Txt>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {me.permissions.map((p) => (
                <View key={p} style={styles.permChip}>
                  <Txt variant="strong" size={14} color="#ffffff">{t(`office.permission.${p}`).toLowerCase()}</Txt>
                </View>
              ))}
            </View>
          </View>
        </View>

        <Section title={t('office.profile.contact')}>
          <View style={styles.row}>
            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="muted" size={15}>{t('office.profile.myPhone')}</Txt>
              {!editing && (shownPhone
                ? <Mono size={19} bold>{shownPhone}</Mono>
                : <Txt variant="strong" color={colors.amberText}>{t('office.profile.noPhone')}</Txt>)}
            </View>
            {!editing && (
              <Pressable accessibilityRole="button" onPress={startEdit} style={styles.textBtn}>
                <Txt variant="strong" size={16} color={colors.blue}>{t('office.profile.edit')}</Txt>
              </Pressable>
            )}
          </View>
          {editing && (
            <View style={{ gap: 10, paddingBottom: 12 }}>
              <Field
                label={t('office.profile.phoneLabel')}
                mono
                keyboardType="phone-pad"
                autoFocus
                value={phone}
                onChangeText={setPhone}
                placeholder={t('office.profile.phonePlaceholder')}
                editable={!saving}
                maxLength={20}
              />
              {saveError && <ErrorNotice error={saveError} onRetry={() => void savePhone()} onSignIn={() => void signOut()} />}
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Button kind="outline" label={t('office.common.cancel')} disabled={saving} onPress={() => setEditing(false)} style={{ flex: 1, minHeight: 52 }} />
                <Button kind="primary" label={t('office.common.save')} busy={saving} onPress={() => void savePhone()} style={{ flex: 1, minHeight: 52 }} />
              </View>
            </View>
          )}
          {saved && !editing && <Txt variant="small" color={colors.green} style={{ paddingBottom: 6 }}>{t('office.profile.saved')}</Txt>}
          <Divider />
          <View style={styles.row}>
            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="muted" size={15}>{t('office.profile.email')}</Txt>
              <Txt variant="strong" size={17}>{me.email ?? '–'}</Txt>
            </View>
          </View>
        </Section>

        <Section title={t('office.profile.notifications')}>
          {!notif.data && !notif.error && <SkeletonRows rows={3} lines={2} />}
          {notif.error && <ListFailed stale={!!notif.data} error={notif.error} onRetry={() => void notif.reload()} onSignIn={() => void signOut()} />}
          {notif.data && notif.data.events.length === 0 && <ListEmpty text={t('office.profile.noEvents')} />}
          {notif.data?.events.map((ev, i) => (
            <View key={ev.event}>
              {i > 0 && <Divider />}
              <Pressable accessibilityRole="switch" accessibilityState={{ checked: ev.enabled }} onPress={() => void toggle(ev.event, !ev.enabled)} style={styles.row}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt variant="strong" size={17}>{ev.label}</Txt>
                  {ev.text ? <Txt variant="muted" size={15}>{ev.text}</Txt> : null}
                </View>
                <View style={[styles.toggle, ev.enabled && { backgroundColor: colors.blue }]}>
                  <View style={[styles.knob, ev.enabled && { alignSelf: 'flex-end' }]} />
                </View>
              </Pressable>
              {toggleError?.event === ev.event && (
                <View style={{ paddingBottom: 10 }}>
                  <ErrorNotice error={toggleError.error} onRetry={() => void toggle(ev.event, toggleError.next)} onSignIn={() => void signOut()} />
                </View>
              )}
            </View>
          ))}
        </Section>

        <Section title={t('office.profile.app')}>
          <View style={{ gap: 10, paddingVertical: 10 }}>
            <Txt variant="strong" size={17}>{t('office.profile.language')}</Txt>
            <LanguageSwitch />
          </View>
          <Divider />
          <View style={styles.row}>
            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="strong" size={17}>{t('office.profile.officePhone')}</Txt>
              {officePhone
                ? <Mono size={17}>{phoneDisplay(officePhone)}</Mono>
                : settings.error && !settings.data
                ? <ErrorNotice error={settings.error} onRetry={() => void settings.reload()} />
                : <Txt variant="muted" size={15}>{settings.data ? t('office.profile.officePhoneNone') : '—'}</Txt>}
            </View>
            {officeTel && (
              <Pressable accessibilityRole="button" accessibilityLabel={t('office.common.callOffice')} onPress={() => void Linking.openURL(officeTel)} style={styles.iconBtn}>
                <Phone size={20} color={colors.ink} strokeWidth={2.2} />
              </Pressable>
            )}
          </View>
          <Divider />
          <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(PRIVACY_URL)} style={styles.row}>
            <FileText size={22} color={colors.ink} />
            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="strong" size={17}>{t('common.privacy')}</Txt>
              <Txt variant="muted" size={15}>{t('office.profile.privacyHint')}</Txt>
            </View>
            <ChevronRight size={22} color={colors.muted} />
          </Pressable>
          <Divider />
          <View style={styles.row}>
            <Txt variant="muted" size={15}>{t('login.version', { version })}</Txt>
          </View>
        </Section>

        <Button kind="outline" label={t('office.common.signOut')} onPress={confirmSignOut} busy={signingOut} />
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'center', gap: 16, backgroundColor: colors.ink, borderRadius: 18, padding: 18 },
  bigAvatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.amber, alignItems: 'center', justifyContent: 'center' },
  permChip: { backgroundColor: colors.darkSurface, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, minHeight: 56 },
  textBtn: { minHeight: 48, minWidth: 48, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 8 },
  iconBtn: { width: 48, height: 48, borderRadius: 12, borderWidth: 1.5, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card },
  toggle: { width: 52, height: 30, borderRadius: 15, backgroundColor: '#c9c5bb', padding: 3, justifyContent: 'center' },
  knob: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.card },
});
