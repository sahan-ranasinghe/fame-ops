// Office mode (Phase 8, O1): the Profile (design 18), a stack screen from More → My profile. Who this is with the work
// e-mail and the permission chips (never a role name), Contact (the phone drivers can call, edited in place →
// update_my_profile, then /me again so the number follows), App (Notifications as ONE row with its summary, opening its
// own screen: Hotfix O2-H2 Part 2, Instagram's and WhatsApp's settings; the language, the office phone from get_settings
// with Call, the privacy policy, the version) and Sign out. The banner "Add your phone number…" shows while /me says
// phone_required.

import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, View } from 'react-native';

import { ChevronRight, FileText, Phone } from '@/components/icons';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { LinkRow } from '@/components/office/NotifParts';
import { Button, Field, Mono, Notice, Txt } from '@/components/ui';
import { PRIVACY_URL } from '@/config';
import { phoneDisplay } from '@/lib/contacts';
import { telLink } from '@/lib/format';
import { notifState } from '@/office/notificationGroups';
import { STATE_KEY } from '@/office/notifLogic';
import { useOffice, useTool } from '@/office/state';
import { initials } from '@/office/text';
import type { FleetError, NotificationSettings, SettingsResult } from '@/office/types';
import { BackHeader, Divider, ErrorNotice, Screen, Section } from '@/office/ui';
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
  // The Notifications row's one line: On, Paused, Some off (office/notificationGroups.ts).
  const notifLine = notif.data ? t(STATE_KEY[notifState(notif.data.events, me.permissions)]) : notif.error ? undefined : t('office.common.loading');

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
            {me.email ? <Txt variant="muted" size={15} color="#c9ccd1" numberOfLines={1}>{me.email}</Txt> : null}
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
        </Section>

        <Section title={t('office.profile.app')}>
          <LinkRow title={t('office.notif.title')} line={notifLine} onPress={() => router.push('/office/notifications')} testID="profile-notifications" />
          <Divider />
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
});
