// "Showing 20 of 45" and "Load more" under a list that grows (Hotfix 3, L6; the rules are lib/lists.ts). Nothing when
// every row is on screen.

import { View } from 'react-native';

import { Button, Txt } from '@/components/ui';
import type { PageInfo } from '@/lib/lists';
import { useApp } from '@/state/app';

export function LoadMore({ info, onPress, busy = false }: { info: PageInfo; onPress: () => void; busy?: boolean }) {
  const { t } = useApp();
  if (!info.more) return null;
  return (
    <View style={{ gap: 8 }}>
      <Txt variant="small" style={{ textAlign: 'center' }}>{t('list.showing', { n: info.n, total: info.total })}</Txt>
      <Button kind="outline" label={t(busy ? 'list.loading' : 'list.loadMore')} busy={busy} onPress={onPress} />
    </View>
  );
}
