// Office mode (Phase 8, O2, item 7): one vehicle, read-only (the site's VehicleDetail): the photo when there is one,
// the status and availability, type · seats, rented from · until, the rent, the regular driver, who it is assigned to
// or held by, km this month against the allowance, the odometer, the next service, the garage, the document chips
// with what is missing, and the documents (vehicle_documents) as one row per kind (Stage 1, O3 item 5): the four every
// vehicle has, the lease when rented, each Other and "Another document"; a row opens the document's screen (Open in the
// browser, Take photo / Replace, the expiry date: vehicles/doc). The photo: Take photo / Replace photo with the camera or
// the phone's photos (photo_upload_url + set_vehicle_photo, straight to Storage). Each button only with its tools.
// Edit (update_vehicle) opens the form. Found by list_vehicles' search (one page; the active vehicles, then the returned
// ones).

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, Linking, Pressable, View } from 'react-native';

import { PhotoPick } from '@/components/office/PhotoPick';
import { Button, Mono, Notice, Txt } from '@/components/ui';
import { docTone, kmLine, vehicleTone } from '@/office/manageLogic';
import { uploadToTicket, type Shot } from '@/office/media';
import { canSetVehiclePhoto, canUploadDocs, documentRows, ticketOf } from '@/office/mediaLogic';
import { useOffice, useTool } from '@/office/state';
import type { FleetError, VehicleCard, VehicleDocuments, VehiclesList } from '@/office/types';
import { ListEmpty, SkeletonRows } from '@/components/patterns/ListState';
import { BackHeader, Divider, ErrorNotice, ListFailed, Pill, Screen, Section } from '@/office/ui';
import { showSnackbar } from '@/components/patterns/Snackbar';
import { useApp } from '@/state/app';
import { colors } from '@/theme';
import { dateWords, datesInWords } from '@/lib/dateWords';

const open = (url: string) => void Linking.openURL(url).catch(() => undefined);

export default function VehicleScreen() {
  const { reg } = useLocalSearchParams<{ reg: string }>();
  const { t } = useApp();
  const { api, me, signOut } = useOffice();
  const router = useRouter();
  const [v, setV] = useState<VehicleCard | null>(null);
  const [error, setError] = useState<FleetError | null>(null);
  const [missing, setMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const canEdit = me.tools.includes('update_vehicle');
  const docsQ = useTool<VehicleDocuments>('vehicle_documents', { vehicle: reg }, { enabled: !!reg && me.tools.includes('vehicle_documents') });
  const mayPhoto = canSetVehiclePhoto(me.tools);
  const mayDocs = canUploadDocs(me.tools);
  const [photo, setPhoto] = useState<{ busy: boolean; error: FleetError | null; done: boolean; last: Shot | null }>({ busy: false, error: null, done: false, last: null });

  // The vehicle's photo: a place for it and its thumbnail, both files straight to Storage, then the vehicle points to them.
  async function savePhoto(shot: Shot) {
    setPhoto({ busy: true, error: null, done: false, last: shot });
    try {
      const answer = await api.call<{ upload: unknown; thumb?: unknown }>('photo_upload_url', { kind: 'vehicle', target: reg });
      const main = ticketOf(answer.upload);
      const thumb = ticketOf(answer.thumb);
      if (!main || !thumb || !shot.thumb) throw { code: 'tool_error', message: t('office.media.noTicket') } satisfies FleetError;
      await uploadToTicket(main, shot.photo.uri, 'image/jpeg');
      await uploadToTicket(thumb, shot.thumb.uri, 'image/jpeg');
      const r = await api.call<{ photo_url?: string }>('set_vehicle_photo', { vehicle: reg, path: main.path, thumb_path: thumb.path });
      setV((prev) => (prev ? { ...prev, photo_url: r.photo_url ?? shot.photo.uri } : prev));
      setPhoto({ busy: false, error: null, done: false, last: null });
      showSnackbar({ text: t('office.media.photoSaved') });
    } catch (e) {
      setPhoto({ busy: false, error: e as FleetError, done: false, last: shot });
    }
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const find = async (filter: 'all' | 'inactive') => (await api.call<VehiclesList>('list_vehicles', { filter, search: reg, limit: 25 })).vehicles.find((x) => x.reg_no === reg);
      const found = (await find('all')) ?? (await find('inactive'));
      setV(found ?? null);
      setMissing(!found);
    } catch (e) {
      setError(e as FleetError);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [reg]); // eslint-disable-line react-hooks/exhaustive-deps

  const km = v ? kmLine(v) : null;
  const fact = (label: string, value?: string | null, sub?: string | null) => (
    value ? (
      <View style={{ gap: 2 }}>
        <Txt variant="label" color={colors.muted}>{label.toUpperCase()}</Txt>
        <Txt variant="strong">{value}</Txt>
        {sub ? <Txt variant="small">{sub}</Txt> : null}
      </View>
    ) : null
  );
  const docs = v?.documents ?? {};

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <BackHeader title={reg} subtitle={v?.make_model} right={canEdit && v ? <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/office/vehicles/form', params: { reg } })} hitSlop={8} style={{ minHeight: 44, justifyContent: 'center' }}><Txt variant="strong" color="#ffffff">{t('office.vehicles.edit')}</Txt></Pressable> : undefined} />
      <Screen refreshing={loading && !!v} onRefresh={() => { void load(); void docsQ.reload(); }} bottom={16}>
        {loading && !v && !error && <SkeletonRows rows={4} lines={2} />}
        {error && !v && <ListFailed error={error} onRetry={() => void load()} onSignIn={() => void signOut()} />}
        {error && v && <ListFailed stale error={error} onRetry={() => void load()} onSignIn={() => void signOut()} />}
        {missing && !loading && <ListEmpty text={t('office.vehicles.notFound', { plate: reg })} />}
        {v && (
          <>
            {v.photo_url ? <Image source={{ uri: v.photo_url }} style={{ width: '100%', aspectRatio: 4 / 3, borderRadius: 18, backgroundColor: '#e9e7e0' }} resizeMode="cover" accessibilityLabel={reg} /> : null}
            {mayPhoto && v.active !== false && (
              <View style={{ gap: 8 }} testID="vehicle-photo">
                {!v.photo_url && <Txt variant="muted" size={15}>{t('office.media.noVehiclePhoto')}</Txt>}
                <PhotoPick use="vehicle" label={v.photo_url ? t('office.media.replacePhoto') : t('office.media.takePhoto')} onShot={(shot) => void savePhoto(shot)} disabled={photo.busy} />
                {photo.busy && <Txt variant="small">{t('office.media.sending')}</Txt>}
                {photo.error && <ErrorNotice error={photo.error} onRetry={photo.last ? () => void savePhoto(photo.last!) : undefined} onSignIn={() => void signOut()} />}
              </View>
            )}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <Pill text={v.active === false ? t('office.vehicles.returned') : v.status ?? ''} tone={vehicleTone(v)} size={15} />
              {v.availability ? <Txt variant="muted" size={15}>{v.availability}</Txt> : null}
            </View>
            <View style={{ backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1, borderRadius: 18, padding: 16, gap: 14 }}>
              {fact(t('office.vehicles.typeSeats'), [v.type ? t(`office.vehicles.type_${v.type}`) : '', v.seats ? t('office.vehicles.seats', { n: v.seats }) : ''].filter(Boolean).join(' · ') || null)}
              {fact(t('office.vehicles.rentedFrom'), v.rented_from, v.rent_until ? t('office.vehicles.until', { date: dateWords(t, v.rent_until) }) : null)}
              {fact(t('office.vehicles.monthlyRent'), v.monthly_rent_lkr != null ? `LKR ${Number(v.monthly_rent_lkr).toLocaleString('en-US')}` : null)}
              {fact(t('office.vehicles.regularDriver'), v.regular_driver)}
              {fact(t('office.vehicles.assigned'), v.assigned_to ?? t('office.vehicles.pool'), v.custodian_note)}
              {v.held_by ? fact(t('office.vehicles.heldNow'), v.held_by, v.held_since ? t('office.vehicles.since', { time: v.held_since }) : null) : null}
              <View style={{ gap: 2 }}>
                <Txt variant="label" color={colors.muted}>{t('office.vehicles.kmThisMonth').toUpperCase()}</Txt>
                <Mono size={18} bold color={km?.over ? colors.red : colors.ink}>{km?.allow ? t('office.vehicles.kmOf', { used: km.used.toLocaleString('en-US'), allow: km.allow.toLocaleString('en-US') }) : `${(km?.used ?? 0).toLocaleString('en-US')} km`}</Mono>
                {!km?.allow && v.km_allowance_note ? <Txt variant="small">{v.km_allowance_note}</Txt> : null}
              </View>
              {fact(t('office.vehicles.odometer'), v.odometer_km != null ? `${Number(v.odometer_km).toLocaleString('en-US')} km` : null)}
              {fact(t('office.vehicles.nextService'), v.next_service, v.service_state)}
              {fact(t('office.vehicles.garageBooked'), v.garage_booked ? dateWords(t, v.garage_booked) : v.garage_booked)}
              <View style={{ gap: 6 }}>
                <Txt variant="label" color={colors.muted}>{t('office.vehicles.documents').toUpperCase()}</Txt>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {(['lic', 'ins', 'emi'] as const).map((k) => {
                    const dc = docs[k];
                    return <Pill key={k} text={`${t(`office.vehicles.doc_${k}`)}${dc?.expiry ? ` · ${dateWords(t, dc.expiry)}` : ''}`} tone={docTone(dc?.chip)} />;
                  })}
                </View>
                {v.documents_missing_text ? <Txt variant="small" color={colors.amberText}>{v.documents_missing_text}</Txt> : null}
              </View>
            </View>
            {me.tools.includes('vehicle_documents') && (
              <Section title={t('office.vehicles.onFile')} count={docsQ.data?.documents.length}>
                {!docsQ.data && !docsQ.error && <SkeletonRows rows={2} lines={2} />}
                {docsQ.error && <ListFailed stale={!!docsQ.data} error={docsQ.error} onRetry={() => void docsQ.reload()} onSignIn={() => void signOut()} />}
                {docsQ.data && docsQ.data.missing_text ? <Notice text={docsQ.data.missing_text} /> : null}
                {docsQ.data && documentRows(docsQ.data, { rented: !!v.rented_from }).filter((r) => mayDocs || r.doc).map((r, i) => (
                  <View key={r.key}>
                    {i > 0 && <Divider />}
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => (mayDocs ? router.push({ pathname: '/office/vehicles/doc', params: { reg, kind: r.kind, ...(r.doc ? { id: r.doc.id } : {}) } }) : r.doc?.url ? open(r.doc.url) : undefined)}
                      style={({ pressed }) => [{ paddingVertical: 10, gap: 2, minHeight: 56 }, pressed && { opacity: 0.8 }]}
                      testID="vehicle-doc-row"
                    >
                      <Txt variant="strong">{r.adding ? t('office.media.anotherDoc') : r.doc ? `${r.doc.kind_name}${r.doc.name && r.doc.name !== r.doc.kind_name ? ` · ${r.doc.name}` : ''}` : t(`office.media.kind_${r.kind}`)}</Txt>
                      {r.doc ? (
                        <Txt variant="small">{[r.doc.expiry ? t('office.vehicles.expires', { date: dateWords(t, r.doc.expiry) }) : '', datesInWords(t, r.doc.uploaded)].filter(Boolean).join(' · ')}</Txt>
                      ) : !r.adding ? (
                        <Txt variant="small" color={r.missing ? colors.amberText : colors.muted}>{t('office.media.noFile')}</Txt>
                      ) : null}
                    </Pressable>
                  </View>
                ))}
                {docsQ.data && !mayDocs && docsQ.data.documents.length === 0 && <ListEmpty text={t('office.vehicles.noFiles')} />}
              </Section>
            )}
            {canEdit && <Button kind="dark" label={t('office.vehicles.editVehicle')} onPress={() => router.push({ pathname: '/office/vehicles/form', params: { reg } })} style={{ minHeight: 56 }} />}
          </>
        )}
      </Screen>
    </View>
  );
}
