// Office mode (Phase 8, O2, item 7): one vehicle, read-only (the site's VehicleDetail): the photo when there is one,
// the status and availability, type · seats, rented from · until, the rent, the regular driver, who it is assigned to
// or held by, km this month against the allowance, the odometer, the next service, the garage, the document chips
// with what is missing, and the documents on file (vehicle_documents: Open in the browser; adding them is laptop work,
// the upload tools are web-only). Edit (update_vehicle) opens the form. Found by list_vehicles' search (one page; the
// active vehicles, then the returned ones).

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, Linking, Pressable, View } from 'react-native';

import { Button, Mono, Txt } from '@/components/ui';
import { docTone, kmLine, vehicleTone } from '@/office/manageLogic';
import { useOffice, useTool } from '@/office/state';
import type { FleetError, VehicleCard, VehicleDocuments, VehiclesList } from '@/office/types';
import { BackHeader, Empty, ErrorNotice, Loading, Pill, Screen, Section } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

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
        {loading && !v && <Loading text={t('office.common.loading')} />}
        {error && !v && <ErrorNotice error={error} onRetry={() => void load()} onSignIn={() => void signOut()} />}
        {missing && !loading && <Empty text={t('office.vehicles.notFound', { plate: reg })} />}
        {v && (
          <>
            {v.photo_url ? <Image source={{ uri: v.photo_url }} style={{ width: '100%', aspectRatio: 4 / 3, borderRadius: 18, backgroundColor: '#e9e7e0' }} resizeMode="cover" accessibilityLabel={reg} /> : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <Pill text={v.active === false ? t('office.vehicles.returned') : v.status ?? ''} tone={vehicleTone(v)} size={15} />
              {v.availability ? <Txt variant="muted" size={15}>{v.availability}</Txt> : null}
            </View>
            <View style={{ backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1, borderRadius: 18, padding: 16, gap: 14 }}>
              {fact(t('office.vehicles.typeSeats'), [v.type ? t(`office.vehicles.type_${v.type}`) : '', v.seats ? t('office.vehicles.seats', { n: v.seats }) : ''].filter(Boolean).join(' · ') || null)}
              {fact(t('office.vehicles.rentedFrom'), v.rented_from, v.rent_until ? t('office.vehicles.until', { date: v.rent_until }) : null)}
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
              {fact(t('office.vehicles.garageBooked'), v.garage_booked)}
              <View style={{ gap: 6 }}>
                <Txt variant="label" color={colors.muted}>{t('office.vehicles.documents').toUpperCase()}</Txt>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {(['lic', 'ins', 'emi'] as const).map((k) => {
                    const dc = docs[k];
                    return <Pill key={k} text={`${t(`office.vehicles.doc_${k}`)}${dc?.expiry ? ` · ${dc.expiry}` : ''}`} tone={docTone(dc?.chip)} />;
                  })}
                </View>
                {v.documents_missing_text ? <Txt variant="small" color={colors.amberText}>{v.documents_missing_text}</Txt> : null}
              </View>
            </View>
            {me.tools.includes('vehicle_documents') && (
              <Section title={t('office.vehicles.onFile')} count={docsQ.data?.documents.length}>
                {docsQ.loading && !docsQ.data && <Loading text={t('office.common.loading')} />}
                {docsQ.error && !docsQ.data && <ErrorNotice error={docsQ.error} onRetry={() => void docsQ.reload()} onSignIn={() => void signOut()} />}
                {docsQ.data && docsQ.data.documents.length === 0 && <Empty text={t('office.vehicles.noFiles')} />}
                {docsQ.data?.documents.map((doc) => (
                  <Pressable key={doc.id} accessibilityRole={doc.url ? 'link' : undefined} onPress={doc.url ? () => open(doc.url!) : undefined} style={{ paddingVertical: 10, gap: 2 }}>
                    <Txt variant="strong">{doc.kind_name}{doc.name && doc.name !== doc.kind_name ? ` · ${doc.name}` : ''}</Txt>
                    <Txt variant="small">{[doc.expiry ? t('office.vehicles.expires', { date: doc.expiry }) : '', doc.uploaded].filter(Boolean).join(' · ')}</Txt>
                    {doc.url ? <Txt variant="strong" size={15} color={colors.blue}>{t('office.vehicles.open')}</Txt> : null}
                  </Pressable>
                ))}
                <Txt variant="small">{t('office.vehicles.filesLaptop')}</Txt>
              </Section>
            )}
            {canEdit && <Button kind="dark" label={t('office.vehicles.editVehicle')} onPress={() => router.push({ pathname: '/office/vehicles/form', params: { reg } })} style={{ minHeight: 56 }} />}
          </>
        )}
      </Screen>
    </View>
  );
}
