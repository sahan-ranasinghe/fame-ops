// Round 52 (docs/phase8-plan.md §40): Rental companies under More (the vehicles permission; list_rental_companies): each
// company with its phone and how many vehicles name it, the one search field (the list comes whole: the words filter it on
// the phone), one Filter (Active / Show archived), skeletons, an empty state, Try again. A row opens its actions (only for
// someone who has one): Archive / Restore (set_rental_company_archived) and Delete permanently for a company no vehicle
// names (users; can_delete in the sheet, then delete_record). The rules: office/binLogic.ts.

import { useState } from 'react';
import { Alert, View } from 'react-native';

import { DeleteRecordSheet } from '@/components/office/BinParts';
import { FilterBar } from '@/components/patterns/FilterBar';
import { ListEmpty, SkeletonRows } from '@/components/patterns/ListState';
import { Sheet } from '@/components/patterns/Sheet';
import { showSnackbar } from '@/components/patterns/Snackbar';
import { Button, Txt } from '@/components/ui';
import type { FilterValues } from '@/lib/patterns/filterLogic';
import { archivedFilterDefs, companiesShown, companyDeletable, showArchivedOf } from '@/office/binLogic';
import { useOffice, useTool } from '@/office/state';
import type { FleetError, RentalCompaniesList, RentalCompanyRow } from '@/office/types';
import { BackHeader, Divider, ErrorNotice, ListFailed, Pill, Row, Screen, Section } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

export default function RentalCompaniesScreen() {
  const { t } = useApp();
  const { api, me, signOut } = useOffice();
  const [values, setValues] = useState<FilterValues>({ show: 'active' });
  const archived = showArchivedOf(values);
  const [text, setText] = useState('');
  const q = useTool<RentalCompaniesList>('list_rental_companies', archived ? { archived: true } : {});
  const d = q.data;
  const rows = companiesShown(d?.companies ?? [], text);
  const mayArchive = me.tools.includes('set_rental_company_archived');
  const mayDelete = me.tools.includes('can_delete') && me.tools.includes('delete_record');
  const [picked, setPicked] = useState<RentalCompanyRow | null>(null);
  const [deleting, setDeleting] = useState<RentalCompanyRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FleetError | null>(null);
  const actionsFor = (c: RentalCompanyRow) => mayArchive || (mayDelete && companyDeletable(c));
  const count = (n: number) => (n === 0 ? t('office.rentals.vehiclesNone') : n === 1 ? t('office.rentals.vehiclesOne') : t('office.rentals.vehicles', { n }));

  async function setArchived(c: RentalCompanyRow, want: boolean) {
    setBusy(true);
    setError(null);
    try {
      await api.call('set_rental_company_archived', { company: c.id, archived: want });
      setPicked(null);
      showSnackbar({ text: t(want ? 'office.bin.archivedDone' : 'office.bin.restoredDone', { name: c.name }) });
      void q.reload();
    } catch (e) {
      setError(e as FleetError);
    } finally {
      setBusy(false);
    }
  }
  function askArchive(c: RentalCompanyRow) {
    Alert.alert(t('office.bin.archiveAsk', { name: c.name }), t('office.rentals.archiveBody'), [
      { text: t('office.common.cancel'), style: 'cancel' },
      { text: t('office.bin.archive'), style: 'destructive', onPress: () => void setArchived(c, true) },
    ]);
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <BackHeader title={t('office.rentals.title')} />
      <Screen refreshing={q.refreshing} onRefresh={() => void q.reload()}>
        <FilterBar search={text} onSearch={setText} placeholder={t('office.rentals.search')} defs={archivedFilterDefs(t)} values={values} onApply={setValues} />
        {!d && !q.error && <SkeletonRows rows={4} lines={2} />}
        {q.error && <ListFailed stale={!!d} error={q.error} onRetry={() => void q.reload()} onSignIn={() => void signOut()} />}
        {d && (
          <Section title={t(archived ? 'office.bin.showArchived' : 'office.rentals.title')} count={rows.length}>
            {rows.length === 0 && <ListEmpty text={text.trim() ? t('office.rentals.emptySearch', { search: text.trim() }) : t(archived ? 'office.rentals.emptyArchived' : 'office.rentals.empty')} />}
            {rows.map((c, i) => (
              <View key={c.id}>
                {i > 0 && <Divider />}
                <Row
                  title={c.name}
                  line={[c.phone, count(c.vehicles)].filter(Boolean).join(' · ')}
                  line2={c.archived ? t('office.bin.archivedOn', { when: c.archived }) : undefined}
                  right={c.archived ? <Pill text={t('office.bin.archived')} tone="muted" /> : undefined}
                  chevron={actionsFor(c)}
                  onPress={actionsFor(c) ? () => { setError(null); setPicked(c); } : undefined}
                  accessibilityLabel={actionsFor(c) ? t('office.bin.rowActions', { name: c.name }) : undefined}
                  testID="company-row"
                />
              </View>
            ))}
          </Section>
        )}
      </Screen>
      <Sheet visible={!!picked} title={picked?.name ?? ''} onClose={() => { if (!busy) setPicked(null); }} testID="company-actions">
        {picked && (
          <View style={{ gap: 10 }}>
            <Txt variant="muted">{[picked.phone, count(picked.vehicles)].filter(Boolean).join(' · ')}</Txt>
            {mayArchive && (picked.archived
              ? <Button kind="outline" label={t('office.bin.restore')} busy={busy} onPress={() => void setArchived(picked, false)} style={{ minHeight: 52 }} testID="company-restore" />
              : <Button kind="outline" label={t('office.bin.archive')} busy={busy} onPress={() => askArchive(picked)} style={{ minHeight: 52, borderColor: colors.red }} testID="company-archive" />)}
            {mayDelete && companyDeletable(picked) && (
              <Button kind="danger-text" label={t('office.bin.deleteForever')} disabled={busy} onPress={() => { setDeleting(picked); setPicked(null); }} style={{ minHeight: 52 }} testID="company-delete" />
            )}
            {error && <ErrorNotice error={error} onSignIn={() => void signOut()} />}
          </View>
        )}
      </Sheet>
      {deleting && (
        <DeleteRecordSheet visible kind="rental_company" refText={deleting.id} onClose={() => setDeleting(null)} onDeleted={() => { setDeleting(null); void q.reload(); }} />
      )}
    </View>
  );
}
