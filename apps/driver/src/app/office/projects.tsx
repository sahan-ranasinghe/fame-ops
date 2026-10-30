// Round 52 (docs/phase8-plan.md §40): Projects under More (the site's /projects; view or request): list_projects with the one
// search field (name, short name, job number; sent half a second after the last key), one Filter (Active / Show archived),
// 25 a page with Load more, skeletons, an empty state, Try again. A row opens its actions (only for someone who has one):
// Archive / Restore (set_project_archived, the vehicles permission) and Delete permanently for a project no task or request
// ever used (users; can_delete in the sheet, then delete_record). The rules: office/binLogic.ts.

import { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';

import { DeleteRecordSheet } from '@/components/office/BinParts';
import { FilterBar } from '@/components/patterns/FilterBar';
import { ListEmpty, LoadMore, SkeletonRows } from '@/components/patterns/ListState';
import { Sheet } from '@/components/patterns/Sheet';
import { showSnackbar } from '@/components/patterns/Snackbar';
import { Button, Txt } from '@/components/ui';
import type { FilterValues } from '@/lib/patterns/filterLogic';
import { appendProjects, archivedFilterDefs, archivedWords, BIN_SEARCH_MS, projectLine, projectsArgs, projectTitle, showArchivedOf } from '@/office/binLogic';
import { useOffice, useTool } from '@/office/state';
import type { FleetError, ProjectRow, ProjectsList } from '@/office/types';
import { BackHeader, Divider, ErrorNotice, ListFailed, Pill, Row, Screen, Section } from '@/office/ui';
import { dateWords } from '@/lib/dateWords';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

export default function ProjectsScreen() {
  const { t } = useApp();
  const { api, me, signOut } = useOffice();
  const [values, setValues] = useState<FilterValues>({ show: 'active' });
  const archived = showArchivedOf(values);
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setSearch(text.trim()), BIN_SEARCH_MS);
    return () => clearTimeout(timer);
  }, [text]);
  const q = useTool<ProjectsList>('list_projects', projectsArgs(archived, search));
  const d = q.data;
  const rows = d?.projects ?? [];
  const [more, setMore] = useState<{ busy: boolean; error: FleetError | null }>({ busy: false, error: null });
  const mayArchive = me.tools.includes('set_project_archived');
  const mayDelete = me.tools.includes('can_delete') && me.tools.includes('delete_record');
  const [picked, setPicked] = useState<ProjectRow | null>(null);
  const [deleting, setDeleting] = useState<ProjectRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FleetError | null>(null);

  async function loadMore() {
    const k = q.key;
    if (!d?.next || more.busy) return;
    setMore({ busy: true, error: null });
    try {
      const page = await api.call<ProjectsList>('list_projects', projectsArgs(archived, search, d.next));
      q.patch((p) => appendProjects(p, page), k, true);
      setMore({ busy: false, error: null });
    } catch (e) {
      setMore({ busy: false, error: e as FleetError });
    }
  }

  async function setArchived(p: ProjectRow, want: boolean) {
    setBusy(true);
    setError(null);
    try {
      await api.call('set_project_archived', { project: p.id, archived: want });
      setPicked(null);
      showSnackbar({ text: t(want ? 'office.bin.archivedDone' : 'office.bin.restoredDone', { name: projectTitle(p) }) });
      void q.reload();
    } catch (e) {
      setError(e as FleetError);
    } finally {
      setBusy(false);
    }
  }
  function askArchive(p: ProjectRow) {
    Alert.alert(t('office.bin.archiveAsk', { name: projectTitle(p) }), t('office.projects.archiveBody'), [
      { text: t('office.common.cancel'), style: 'cancel' },
      { text: t('office.bin.archive'), style: 'destructive', onPress: () => void setArchived(p, true) },
    ]);
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <BackHeader title={t('office.projects.title')} subtitle={t('office.projects.above')} />
      <Screen refreshing={q.refreshing} onRefresh={() => void q.reload()}>
        <FilterBar search={text} onSearch={(v) => { setText(v); if (!v) setSearch(''); }} placeholder={t('office.projects.search')} defs={archivedFilterDefs(t)} values={values} onApply={setValues} />
        {!d && !q.error && <SkeletonRows rows={5} lines={2} />}
        {q.error && <ListFailed stale={!!d} error={q.error} onRetry={() => void q.reload()} onSignIn={() => void signOut()} />}
        {d && (
          <Section title={t(archived ? 'office.bin.showArchived' : 'office.projects.title')} count={d.total ?? rows.length}>
            {rows.length === 0 && <ListEmpty text={search ? t('office.projects.emptySearch', { search }) : t(archived ? 'office.projects.emptyArchived' : 'office.projects.empty')} />}
            {rows.map((p, i) => (
              <View key={p.id}>
                {i > 0 && <Divider />}
                <Row
                  title={projectTitle(p)}
                  line={projectLine(p) || undefined}
                  line2={archivedWords(p, t, (d) => dateWords(t, d))}
                  right={p.archived ? <Pill text={t('office.bin.archived')} tone="muted" /> : undefined}
                  chevron={mayArchive || mayDelete}
                  onPress={mayArchive || mayDelete ? () => { setError(null); setPicked(p); } : undefined}
                  accessibilityLabel={mayArchive || mayDelete ? t('office.bin.rowActions', { name: projectTitle(p) }) : undefined}
                  testID="project-row"
                />
              </View>
            ))}
            {more.error && <ListFailed error={more.error} onRetry={() => void loadMore()} onSignIn={() => void signOut()} />}
            {d.next && <LoadMore shown={rows.length} total={d.total} busy={more.busy} onPress={() => void loadMore()} />}
          </Section>
        )}
      </Screen>
      <Sheet visible={!!picked} title={picked ? projectTitle(picked) : ''} onClose={() => { if (!busy) setPicked(null); }} testID="project-actions">
        {picked && (
          <View style={{ gap: 10 }}>
            {projectLine(picked) ? <Txt variant="muted">{projectLine(picked)}</Txt> : null}
            {mayArchive && (picked.archived
              ? <Button kind="outline" label={t('office.bin.restore')} busy={busy} onPress={() => void setArchived(picked, false)} style={{ minHeight: 52 }} testID="project-restore" />
              : <Button kind="outline" label={t('office.bin.archive')} busy={busy} onPress={() => askArchive(picked)} style={{ minHeight: 52, borderColor: colors.red }} testID="project-archive" />)}
            {mayDelete && <Button kind="danger-text" label={t('office.bin.deleteForever')} disabled={busy} onPress={() => { setDeleting(picked); setPicked(null); }} style={{ minHeight: 52 }} testID="project-delete" />}
            {error && <ErrorNotice error={error} onSignIn={() => void signOut()} />}
          </View>
        )}
      </Sheet>
      {deleting && (
        <DeleteRecordSheet visible kind="project" refText={deleting.id} onClose={() => setDeleting(null)} onDeleted={() => { setDeleting(null); void q.reload(); }} />
      )}
    </View>
  );
}
