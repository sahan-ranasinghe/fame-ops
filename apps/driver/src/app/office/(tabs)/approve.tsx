// Office mode (Phase 8, O1): the Approve tab, the queue of requests waiting for a decision (list_requests waiting, which
// includes changed = approved and edited since). A row opens Approve a request (design 10). Not designed as a list: the
// same rows as Home's "Requests to approve" card, with "Palitha is reviewing" when another approver has it open.

import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { Txt } from '@/components/ui';
import { requestLine, requestTitle } from '@/office/homeLogic';
import { useOffice, useTool } from '@/office/state';
import type { RequestsList } from '@/office/types';
import { Avatar, DarkHeader, Divider, Empty, ErrorNotice, Loading, Pill, Row, Screen, Section } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

export default function ApproveTab() {
  const { t } = useApp();
  const { signOut } = useOffice();
  const router = useRouter();
  const q = useTool<RequestsList>('list_requests', { status: 'waiting', limit: 50 }, { every: 60_000 });
  const rows = q.data?.requests ?? [];
  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <DarkHeader above={t('office.approve.above')} title={t('office.approve.title')} />
      <Screen refreshing={q.refreshing} onRefresh={() => void q.reload()}>
        {q.loading && <Loading text={t('office.common.loading')} />}
        {q.error && !q.data && <ErrorNotice error={q.error} onRetry={() => void q.reload()} onSignIn={() => void signOut()} />}
        {q.data && (
          <Section title={t('office.approve.waiting')} count={q.data.total ?? rows.length}>
            {rows.length === 0 && <Empty text={t('office.home.noRequests')} />}
            {rows.map((r, i) => {
              const reviewing = r.reviewing?.map((x) => x.name).join(', ');
              return (
                <View key={r.id}>
                  {i > 0 && <Divider />}
                  <Row
                    left={<Avatar name={r.requested_by} />}
                    title={requestTitle(r)}
                    line={requestLine(r)}
                    line2={reviewing ? t('office.approve.reviewing', { name: reviewing }) : r.late ? t('office.approve.late') : undefined}
                    right={<View style={{ alignItems: 'flex-end', gap: 4 }}>
                      <Pill text={t(r.status === 'changed' ? 'office.status.changed' : 'office.status.waiting')} tone={r.status === 'changed' ? 'amber' : 'amber'} />
                      {r.asked ? <Txt variant="small" style={{ maxWidth: 100, textAlign: 'right' }} numberOfLines={1}>{r.asked}</Txt> : null}
                    </View>}
                    onPress={() => router.push({ pathname: '/office/request/[id]', params: { id: r.id } })}
                  />
                </View>
              );
            })}
          </Section>
        )}
      </Screen>
    </View>
  );
}
