// Office mode (Phase 8, O2, item 7): People → Office users (design 19's "Office users · permissions, set-password link"
// row): list_office_users with the search box (name or e-mail), 25 a page with Load more on the cursor, pull to refresh.
// A row (the name, the e-mail and phone, the permissions as lower-case words, never a role name, the active pill) opens
// Manage an office user. "+ Add office user" only with create_office_user. The rules: office/peopleLogic.ts.

import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { FilterBar } from '@/components/patterns/FilterBar';
import { ListEmpty, LoadMore, SkeletonRows } from '@/components/patterns/ListState';
import { Button } from '@/components/ui';
import { activePill, appendUsers, permissionWords, SEARCH_DEBOUNCE_MS, userLine, usersArgs } from '@/office/peopleLogic';
import { useOffice, useTool } from '@/office/state';
import type { FleetError, OfficeUser, OfficeUsers } from '@/office/types';
import { Avatar, BackHeader, Divider, ListFailed, Pill, Row, Screen, Section } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

export default function OfficeUsersPeople() {
  const { t } = useApp();
  const permWord = (p: string) => t(`office.permission.${p}`).toLowerCase();
  const { me, api, signOut } = useOffice();
  const router = useRouter();
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const [more, setMore] = useState<{ busy: boolean; error: FleetError | null }>({ busy: false, error: null });

  useEffect(() => {
    const timer = setTimeout(() => setSearch(text.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  const q = useTool<OfficeUsers>('list_office_users', usersArgs(search));
  const d = q.data;
  const canAdd = me.tools.includes('create_office_user');

  async function loadMore() {
    if (!d?.next || more.busy) return;
    setMore({ busy: true, error: null });
    try {
      const page = await api.call<OfficeUsers>('list_office_users', usersArgs(search, d.next));
      q.patch((p) => appendUsers(p, page));
      setMore({ busy: false, error: null });
    } catch (e) {
      setMore({ busy: false, error: e as FleetError });
    }
  }

  const renderRow = (u: OfficeUser) => {
    const pill = activePill(u.active);
    return (
      <Row
        left={<Avatar name={u.name} size={44} />}
        title={u.name}
        line={userLine(u)}
        line2={permissionWords(u.permissions, permWord)}
        right={<Pill text={t(`office.people.${pill.key}`)} tone={pill.tone} size={13} />}
        onPress={() => u.email && router.push({ pathname: '/office/people/user/[email]', params: { email: u.email } })}
      />
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <BackHeader title={t('office.people.users')} subtitle={t('office.people.usersAbove')} />
      <Screen refreshing={q.refreshing} onRefresh={() => void q.reload()}>
        {canAdd && <Button kind="primary" label={t('office.people.addUser')} onPress={() => router.push('/office/people/user-new')} style={{ minHeight: 56 }} />}
        <FilterBar search={text} onSearch={(v) => { setText(v); if (!v) setSearch(''); }} placeholder={t('office.people.searchUsers')} defs={[]} values={{}} onApply={() => undefined} />
        {!d && q.error && <ListFailed error={q.error} onRetry={() => void q.reload()} onSignIn={() => void signOut()} />}
        {!d && !q.error && <SkeletonRows rows={5} lines={2} />}
        {d && q.error && <ListFailed stale error={q.error} onRetry={() => void q.reload()} onSignIn={() => void signOut()} />}
        {d && (
          <Section title={t('office.people.users')} count={d.total ?? d.users.length}>
            {d.users.length === 0
              ? (search
                ? <ListEmpty text={t('office.people.emptySearch', { search })} />
                : <ListEmpty text={t('office.people.emptyUsers')} action={canAdd ? t('office.people.addUser') : undefined} onAction={canAdd ? () => router.push('/office/people/user-new') : undefined} />)
              : d.users.map((u, i) => <View key={u.email ?? `${u.name}-${i}`}>{i > 0 && <Divider />}{renderRow(u)}</View>)}
            {d.total !== undefined && d.total > d.users.length && (
              <View style={{ gap: 10, paddingTop: 12 }}>
                {more.error && <ListFailed error={more.error} onRetry={() => void loadMore()} onSignIn={() => void signOut()} />}
                {d.next && <LoadMore shown={d.users.length} total={d.total} busy={more.busy} onPress={() => void loadMore()} />}
              </View>
            )}
          </Section>
        )}
      </Screen>
    </View>
  );
}
