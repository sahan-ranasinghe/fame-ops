// Office mode (Stage 1, O3 row 1): Tell requester, as the website's (RequestOutcome.tsx): the server's message for the
// moment (approved, driver changed, on the way, arrived, cancelled), "Tell <name> on WhatsApp" opening WhatsApp with the
// message ready (nothing is sent until the person sends it), and the requester's phone with Change / Add phone for an
// approver who may edit the request (update_request with its version; empty clears it). Shown on Approve a request.

import { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { MessageCircle } from '@/components/icons';
import { Button, Field, Mono, Txt } from '@/components/ui';
import { has } from '@/office/nav';
import { useOffice } from '@/office/state';
import type { FleetError, RequestCard } from '@/office/types';
import { ErrorNotice } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

export function TellRequester({ q, onSaved }: { q: RequestCard; onSaved: () => void }) {
  const { t } = useApp();
  const { me, api, signOut } = useOffice();
  const tell = q.tell_requester;
  const editable = has(me.permissions, 'approve') && me.tools.includes('update_request') && q.version != null && (q.status === 'waiting' || q.status === 'approved' || q.status === 'changed');
  const [editing, setEditing] = useState(false);
  const [phone, setPhone] = useState(q.requester_phone ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FleetError | null>(null);
  if (!tell && !q.requester_phone && !editable) return null;

  async function save() {
    const next = phone.trim();
    if (next === (q.requester_phone ?? '')) {
      setEditing(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.call('update_request', { request_id: q.id, version: q.version, requester_phone: next || null });
      setEditing(false);
      onSaved();
    } catch (e) {
      setError(e as FleetError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.card} testID="tell-requester">
      <Txt variant="label" color={colors.muted}>{(tell ? t('office.tell.title', { name: q.requested_by, moment: t(`office.tell.moment_${tell.moment}`) }) : t('office.tell.phoneTitle', { name: q.requested_by })).toUpperCase()}</Txt>
      {tell && (
        <>
          <Txt variant="strong" size={16}>{tell.message}</Txt>
          <Button kind="dark" icon={MessageCircle} label={t('office.tell.send', { name: q.requested_by })} onPress={() => void Linking.openURL(tell.whatsapp).catch(() => undefined)} style={{ minHeight: 56 }} />
          <Txt variant="small">{q.requester_phone ? t('office.tell.hint') : t('office.tell.hintNoPhone')}</Txt>
        </>
      )}
      {!editing && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }}>
          <Txt variant="muted" size={15} style={{ flex: 1 }}>
            {t('office.tell.phone')} {q.requester_phone ? <Mono size={15} bold>{q.requester_phone}</Mono> : t('office.tell.notSaved')}
          </Txt>
          {editable && (
            <Pressable accessibilityRole="button" onPress={() => { setPhone(q.requester_phone ?? ''); setEditing(true); setError(null); }} style={{ minHeight: 44, justifyContent: 'center' }}>
              <Txt variant="strong" size={15} color={colors.blue}>{q.requester_phone ? t('office.tell.change') : t('office.tell.addPhone')}</Txt>
            </Pressable>
          )}
        </View>
      )}
      {editing && (
        <View style={{ gap: 8 }}>
          <Field label={t('office.tell.phone')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={30} mono editable={!busy} placeholder="077 123 4567" />
          <Txt variant="small">{t('office.tell.emptyClears')}</Txt>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button kind="outline" label={t('office.common.cancel')} disabled={busy} onPress={() => setEditing(false)} style={{ flex: 1, minHeight: 52 }} />
            <Button label={t('office.common.save')} busy={busy} onPress={() => void save()} style={{ flex: 1, minHeight: 52 }} />
          </View>
        </View>
      )}
      {error && <ErrorNotice error={error} onRetry={() => void save()} onSignIn={() => void signOut()} />}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1, borderRadius: 18, padding: 16, gap: 10 },
});
