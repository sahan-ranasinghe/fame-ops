// Office mode (Phase 8, O2, item 7): Add an office user (from People → Office users, with create_office_user): the name,
// the e-mail, the mobile and the permissions (the presets as quick picks, then each permission; never a role name) →
// create_office_user. After it: the one-time set-password link shown once with Share (WhatsApp); Done goes back to the
// list. The link is never logged. The rules: office/peopleLogic.ts.

import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { useLeaveGuard } from '@/components/navigation';
import { PermissionPicker, SecretCard } from '@/components/office/PeopleParts';
import { Button, Field, Notice, Txt } from '@/components/ui';
import { emptyUser, linkValidWords, permissionWords, type UserFields, type UserProblem, validateNewUser } from '@/office/peopleLogic';
import { useOffice } from '@/office/state';
import type { CreateOfficeUserResult, FleetError } from '@/office/types';
import { BackHeader, ErrorNotice, Screen, StickyActions } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

export default function OfficeUserNew() {
  const { t } = useApp();
  const permWord = (p: string) => t(`office.permission.${p}`).toLowerCase();
  const { api, me, signOut } = useOffice();
  const router = useRouter();
  const [f, setF] = useState<UserFields>(emptyUser);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<UserProblem | null>(null);
  const [error, setError] = useState<FleetError | null>(null);
  const [done, setDone] = useState<CreateOfficeUserResult | null>(null);
  const dirty = !done && (f.name.trim() !== '' || f.email.trim() !== '' || f.phone.trim() !== '');
  const { allowLeave } = useLeaveGuard(dirty, busy);

  async function submit() {
    const v = validateNewUser(f);
    if ('error' in v) {
      setProblem(v.error);
      return;
    }
    setProblem(null);
    setError(null);
    setBusy(true);
    try {
      const r = await api.call<CreateOfficeUserResult>('create_office_user', v.input);
      allowLeave();
      setDone(r);
    } catch (e) {
      setError(e as FleetError);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.page }}>
        <BackHeader title={t('office.people.userCreated')} subtitle={`${done.created.name} · ${permissionWords(done.created.permissions, permWord)}`} />
        <Screen>
          <SecretCard
            title={t('office.people.linkTitle')}
            value={done.set_password_link}
            hint={t('office.people.linkValid', { for: linkValidWords(t, done.link_valid_for), name: done.created.name })}
            shareText={t('office.people.shareText', { name: done.created.name, link: done.set_password_link })}
            shareLabel={t('office.people.share')}
          />
          {done.next ? <Txt variant="small">{done.next}</Txt> : null}
        </Screen>
        <StickyActions>
          <Button kind="dark" label={t('office.people.done')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/office/people/users'))} />
        </StickyActions>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <BackHeader title={t('office.people.newUser')} subtitle={t('office.people.newUserHint')} />
      <Screen bottom={16}>
        <Field label={t('office.people.nameLabel')} value={f.name} onChangeText={(v) => setF({ ...f, name: v })} maxLength={120} autoFocus editable={!busy} />
        <Field label={t('office.people.emailLabel')} value={f.email} onChangeText={(v) => setF({ ...f, email: v })} maxLength={160} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} editable={!busy} />
        <Field label={t('office.people.phoneLabel')} value={f.phone} onChangeText={(v) => setF({ ...f, phone: v })} maxLength={30} keyboardType="phone-pad" placeholder="077 123 4567" editable={!busy} mono />
        <PermissionPicker value={f.permissions} onChange={(permissions) => setF({ ...f, permissions })} disabled={busy} holder={me.permissions} />
        {problem && <Notice tone="danger" text={t(`office.people.userErr.${problem}`)} />}
        {error && <ErrorNotice error={error} onRetry={() => void submit()} onSignIn={() => void signOut()} />}
      </Screen>
      <StickyActions>
        <Button kind="primary" label={t('office.people.createUser')} onPress={() => void submit()} busy={busy} />
      </StickyActions>
    </View>
  );
}
