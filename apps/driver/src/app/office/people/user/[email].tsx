// Office mode (Phase 8, O2, item 7): Manage an office user (from People → Office users). The person found by
// list_office_users' search (one page). Name, phone and the permissions (the presets as quick picks, each permission
// toggled; view locked while another needs it; a person cannot drop their own users permission) → update_office_user with
// only what changed. "New set-password link" (reset_office_password) shows the link once with Share (WhatsApp); never
// logged. Switch off / on with a confirmation (set_office_user_active). Every button exists only when me.tools has its
// tool. The rules: office/peopleLogic.ts.

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';

import { PermissionPicker, SecretCard } from '@/components/office/PeopleParts';
import { showSnackbar } from '@/components/patterns/Snackbar';
import { Button, Field, Notice, Txt } from '@/components/ui';
import { activePill, findUserRow, permissionWords, phoneDisplay, updateUserInput, userFields, type UserFields, type UserProblem } from '@/office/peopleLogic';
import { normalisePermissions } from '@/office/permissions';
import { useOffice, useTool } from '@/office/state';
import type { FleetError, OfficeUsers, SetPasswordLinkResult, UpdateOfficeUserResult } from '@/office/types';
import { ListEmpty, SkeletonRows } from '@/components/patterns/ListState';
import { Avatar, BackHeader, ErrorNotice, ListFailed, Pill, Screen, Section } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

export default function ManageOfficeUser() {
  const { email: raw } = useLocalSearchParams<{ email: string }>();
  const email = decodeURIComponent(raw ?? '');
  const { t } = useApp();
  const permWord = (p: string) => t(`office.permission.${p}`).toLowerCase();
  const { me, api, signOut } = useOffice();
  const router = useRouter();
  const q = useTool<OfficeUsers>('list_office_users', { search: email, limit: 25 });
  const u = findUserRow(q.data, email);
  const canEdit = me.tools.includes('update_office_user');
  const canLink = me.tools.includes('reset_office_password');
  const canSwitch = me.tools.includes('set_office_user_active');

  const [f, setF] = useState<UserFields | null>(null);
  useEffect(() => {
    if (u && f === null) setF(userFields(u, email));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [u]);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<UserProblem | 'nothing' | null>(null);
  const [saveError, setSaveError] = useState<FleetError | null>(null);
  const [savedText, setSavedText] = useState<string | null>(null);
  const [secret, setSecret] = useState<SetPasswordLinkResult | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState<FleetError | null>(null);
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<FleetError | null>(null);

  async function save() {
    if (!u || !f) return;
    const before = { email, name: u.name, phone: u.phone, permissions: normalisePermissions(u.permissions) };
    const v = updateUserInput(before, f, me.email);
    if ('error' in v) {
      setProblem(v.error);
      return;
    }
    if ('nothing' in v) {
      setProblem('nothing');
      return;
    }
    setProblem(null);
    setSaveError(null);
    setSavedText(null);
    setSaving(true);
    try {
      const r = await api.call<UpdateOfficeUserResult>('update_office_user', v.input);
      const phone = r.updated.phone === undefined ? u.phone : r.updated.phone;
      q.patch((p) => ({
        ...p,
        users: p.users.map((x) => ((x.email ?? '').toLowerCase() === email.toLowerCase()
          ? { ...x, name: r.updated.name, permissions: r.updated.permissions, phone, phone_display: phone ? phoneDisplay(phone) : undefined }
          : x)),
      }));
      setF({ ...f, name: r.updated.name, phone: phone ? phoneDisplay(phone) : '', permissions: normalisePermissions(r.updated.permissions) });
      setSavedText(t('office.people.userSaved', { name: r.updated.name, list: permissionWords(r.updated.permissions, permWord) || '—' }));
    } catch (e) {
      setSaveError(e as FleetError);
    } finally {
      setSaving(false);
    }
  }

  async function newLink() {
    setLinkError(null);
    setLinkBusy(true);
    try {
      setSecret(await api.call<SetPasswordLinkResult>('reset_office_password', { email }));
    } catch (e) {
      setLinkError(e as FleetError);
    } finally {
      setLinkBusy(false);
    }
  }

  function confirmSwitch() {
    if (!u) return;
    const off = u.active;
    Alert.alert(t(off ? 'office.people.switchOffUser' : 'office.people.switchOnUser'), t(off ? 'office.people.switchOffUserBody' : 'office.people.switchOnUserBody'), [
      { text: t('office.common.cancel'), style: 'cancel' },
      { text: t(off ? 'office.people.switchOffConfirm' : 'office.people.switchOnConfirm'), style: off ? 'destructive' : 'default', onPress: () => void doSwitch(!off) },
    ]);
  }
  async function doSwitch(want: boolean) {
    setSwitchError(null);
    setSwitching(true);
    try {
      await api.call('set_office_user_active', { email, active: want });
      q.patch((p) => ({ ...p, users: p.users.map((x) => ((x.email ?? '').toLowerCase() === email.toLowerCase() ? { ...x, active: want } : x)) }));
      // Hotfix O2-H2, Part 1b: switched off = back to the list (Google Contacts after a delete); on = stays; a snackbar.
      if (!want && router.canGoBack()) router.back();
      showSnackbar({ text: t(want ? 'office.people.switchedOn' : 'office.people.switchedOff', { name: u?.name ?? email }) });
    } catch (e) {
      setSwitchError(e as FleetError);
    } finally {
      setSwitching(false);
    }
  }

  const pill = u ? activePill(u.active) : null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <BackHeader title={u?.name ?? t('office.people.manageUser')} subtitle={email} right={pill ? <Pill text={t(`office.people.${pill.key}`)} tone={pill.tone} size={13} /> : undefined} />
      <Screen refreshing={q.refreshing} onRefresh={() => void q.reload()}>
        {!q.data && !q.error && <SkeletonRows rows={3} lines={2} />}
        {q.error && <ListFailed stale={!!q.data} error={q.error} onRetry={() => void q.reload()} onSignIn={() => void signOut()} />}
        {q.data && !u && <ListEmpty text={t('office.people.userNotFound', { email })} />}
        {secret && (
          <SecretCard
            title={t('office.people.linkTitle')}
            value={secret.set_password_link}
            hint={t('office.people.linkValid', { for: secret.link_valid_for ?? '1 hour', name: secret.name })}
            shareText={t('office.people.shareText', { name: secret.name, link: secret.set_password_link })}
            shareLabel={t('office.people.share')}
          />
        )}
        {u && f && (
          <Section title={t('office.people.details')}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 }}>
              <Avatar name={u.name} size={44} />
              <View style={{ flex: 1 }}>
                <Txt variant="strong" size={17}>{u.name}</Txt>
                <Txt variant="small">{permissionWords(u.permissions, permWord) || '—'}</Txt>
              </View>
            </View>
            {u.active && canEdit ? (
              <View style={{ gap: 12, paddingVertical: 8 }}>
                <Field label={t('office.people.nameLabel')} value={f.name} onChangeText={(v) => setF({ ...f, name: v })} maxLength={120} editable={!saving} />
                <View style={{ gap: 6 }}>
                  <Field label={t('office.people.phoneLabel')} value={f.phone} onChangeText={(v) => setF({ ...f, phone: v })} maxLength={30} keyboardType="phone-pad" placeholder="077 123 4567" editable={!saving} mono />
                  <Txt variant="small">{t('office.people.phoneHint')}</Txt>
                </View>
                <PermissionPicker value={f.permissions} onChange={(permissions) => setF({ ...f, permissions })} disabled={saving} />
                {problem && <Notice tone="danger" text={problem === 'nothing' ? t('office.people.nothingChanged') : t(`office.people.userErr.${problem}`)} />}
                {saveError && <ErrorNotice error={saveError} onRetry={() => void save()} onSignIn={() => void signOut()} />}
                {savedText && <Txt variant="small" color={colors.green}>{savedText}</Txt>}
                <Button kind="primary" label={t('office.common.save')} onPress={() => void save()} busy={saving} style={{ minHeight: 56 }} />
              </View>
            ) : (
              <View style={{ gap: 4, paddingVertical: 8 }}>
                <Txt variant="muted" size={15}>{t('office.people.phoneLabel')}</Txt>
                <Txt variant="strong" size={17}>{u.phone_display ?? (u.phone ? phoneDisplay(u.phone) : '—')}</Txt>
              </View>
            )}
          </Section>
        )}
        {u && u.active && canLink && (
          <Section title={t('office.people.signIn')}>
            <View style={{ gap: 10, paddingVertical: 8 }}>
              <Txt variant="muted" size={15}>{t('office.people.newLinkHint')}</Txt>
              {linkError && <ErrorNotice error={linkError} onRetry={() => void newLink()} onSignIn={() => void signOut()} />}
              <Button kind="outline" label={t('office.people.newLink')} onPress={() => void newLink()} busy={linkBusy} style={{ minHeight: 56 }} />
            </View>
          </Section>
        )}
        {u && canSwitch && (
          <View style={{ gap: 10 }}>
            <Txt variant="small">{t(u.active ? 'office.people.switchOffUserBody' : 'office.people.switchOnUserBody')}</Txt>
            {switchError && <ErrorNotice error={switchError} onRetry={confirmSwitch} onSignIn={() => void signOut()} />}
            <Button kind="outline" label={t(u.active ? 'office.people.switchOffUser' : 'office.people.switchOnUser')} onPress={confirmSwitch} busy={switching} style={{ borderColor: u.active ? colors.red : colors.ink }} />
          </View>
        )}
      </Screen>
    </View>
  );
}
