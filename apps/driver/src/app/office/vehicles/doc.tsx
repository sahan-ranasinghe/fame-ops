// Office mode (Stage 1, O3 item 5): one of a vehicle's documents, opened from its row on the vehicle's page (?reg=&kind=
// and ?id= for one already on file). The file on record (Open in the browser: its 1-hour link), then the new one: Take
// photo or Choose from photos (made at 2000 px so the text stays readable), the expiry date for a kind that has one (the
// vehicle's date follows), the name for an Other document; Save sticky at the bottom, disabled with the reason. Save =
// vehicle_document_upload_url (a one-time place in vehicle-docs), the file straight to Storage, save_vehicle_document;
// the old file is kept under Removed documents on the website. With both tools (the vehicles permission). PDFs stay
// laptop work (no file picker in the 1.3.0 build).

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Image, Linking, Pressable, View } from 'react-native';

import { PhotoPick } from '@/components/office/PhotoPick';
import { DateField } from '@/components/patterns/Calendar';
import { SkeletonRows } from '@/components/patterns/ListState';
import { Button, Field, Txt } from '@/components/ui';
import { uploadToTicket, type Shot } from '@/office/media';
import { canUploadDocs, docKindOf, docSaveBlock, EXPIRES, saveDocInput, ticketOf } from '@/office/mediaLogic';
import { useOffice, useTool } from '@/office/state';
import type { FleetError, VehicleDocuments } from '@/office/types';
import { BackHeader, ErrorNotice, ListFailed, Screen, Section, StickyActions } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

export default function VehicleDocScreen() {
  const params = useLocalSearchParams<{ reg: string; kind?: string; id?: string }>();
  const reg = params.reg;
  const kind = docKindOf(params.kind);
  const { t } = useApp();
  const { api, me, signOut } = useOffice();
  const router = useRouter();
  const docsQ = useTool<VehicleDocuments>('vehicle_documents', { vehicle: reg }, { enabled: !!reg });
  const doc = params.id ? docsQ.data?.documents.find((d) => d.id === params.id) : kind !== 'other' ? docsQ.data?.documents.find((d) => d.kind === kind) : undefined;
  const title = doc?.kind_name ?? (params.id || kind !== 'other' ? t(`office.media.kind_${kind}`) : t('office.media.anotherDoc'));

  const [shot, setShot] = useState<Shot | null>(null);
  const [expiry, setExpiry] = useState('');
  const [name, setName] = useState(doc?.name ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FleetError | null>(null);
  const shownExpiry = expiry || doc?.expiry || '';
  const block = docSaveBlock({ kind, hasPhoto: !!shot, name: kind === 'other' ? (name || doc?.name || '') : 'x', bytes: shot?.photo.bytes ?? 0 });

  async function save() {
    if (!shot || block || busy) return;
    setBusy(true);
    setError(null);
    try {
      const answer = await api.call<{ upload: unknown }>('vehicle_document_upload_url', { vehicle: reg, kind, content_type: 'image/jpeg', bytes: shot.photo.bytes });
      const ticket = ticketOf(answer.upload);
      if (!ticket) throw { code: 'tool_error', message: t('office.media.noTicket') } satisfies FleetError;
      await uploadToTicket(ticket, shot.photo.uri, 'image/jpeg');
      await api.call('save_vehicle_document', saveDocInput({ vehicle: reg, kind, path: ticket.path, contentType: 'image/jpeg', bytes: shot.photo.bytes, expiry: shownExpiry, name: name || doc?.name }));
      if (router.canGoBack()) router.back();
      else router.replace({ pathname: '/office/vehicles/[reg]', params: { reg } });
    } catch (e) {
      setError(e as FleetError);
      setBusy(false);
    }
  }

  if (!canUploadDocs(me.tools)) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.page }}>
        <BackHeader title={title} subtitle={reg} />
        <Screen><Txt variant="muted">{t('office.media.noAccess')}</Txt></Screen>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <BackHeader title={title} subtitle={reg} />
      <Screen bottom={120}>
        {!docsQ.data && !docsQ.error && <SkeletonRows rows={2} lines={2} />}
        {docsQ.error && <ListFailed stale={!!docsQ.data} error={docsQ.error} onRetry={() => void docsQ.reload()} onSignIn={() => void signOut()} />}
        {doc && (
          <Section title={t('office.media.onRecord')}>
            <Txt variant="small">{[doc.expiry ? t('office.vehicles.expires', { date: doc.expiry }) : '', doc.uploaded].filter(Boolean).join(' · ')}</Txt>
            {doc.url ? (
              <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(doc.url!).catch(() => undefined)} style={{ minHeight: 48, justifyContent: 'center' }}>
                <Txt variant="strong" size={15} color={colors.blue}>{t('office.vehicles.open')}</Txt>
              </Pressable>
            ) : null}
          </Section>
        )}
        <Section title={doc ? t('office.media.replaceWith') : t('office.media.newFile')}>
          {shot && <Image source={{ uri: shot.photo.uri }} style={{ width: '100%', aspectRatio: shot.photo.width / Math.max(1, shot.photo.height), borderRadius: 14, backgroundColor: '#e9e7e0' }} resizeMode="contain" accessibilityLabel={title} />}
          <PhotoPick use="document" label={shot ? t('office.media.retake') : t('office.media.takePhoto')} onShot={setShot} disabled={busy} testID="doc-photo-pick" />
          {kind === 'other' && !doc && (
            <Field label={t('office.media.docName')} value={name} onChangeText={setName} maxLength={80} placeholder={t('office.media.docNameHint')} editable={!busy} />
          )}
          {EXPIRES[kind] && (
            <DateField label={t('office.media.expiry')} value={shownExpiry} onChange={setExpiry} testID="doc-expiry" />
          )}
          <Txt variant="small">{t('office.media.pdfLaptop')}</Txt>
          {error && <ErrorNotice error={error} onRetry={() => void save()} onSignIn={() => void signOut()} />}
        </Section>
      </Screen>
      <StickyActions>
        <Button kind="primary" label={t('office.common.save')} busy={busy} disabled={!!block} onPress={() => void save()} style={{ minHeight: 56 }} />
        {block && <Txt variant="small" style={{ textAlign: 'center' }}>{t(`office.media.block_${block}`)}</Txt>}
      </StickyActions>
    </View>
  );
}
