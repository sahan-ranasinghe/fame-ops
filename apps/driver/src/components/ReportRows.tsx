// Round 4–7, item 8 (docs/phase8-plan.md §33.7): my reports as Gmail's rows, on the Report tab (the last 5 and "See all")
// and on app/my-reports.tsx (all of them, 20 at a time with Load more). A row: the category's icon, ONE specific line
// ("Tyre · Front left flat"), ONE grey line (the plate · when in words · "Vehicle check" for a check's report) with the
// status chip; the office's reply under it in blue when there is one. The words: lib/reportList.ts. Drawn by the app's one
// list row (components/patterns/ListRow.tsx).
// The pages: the reports the phone keeps (the newest, app.reports) first, then the server's older ones below the oldest
// held (Hotfix 3, L6: lib/lists.ts, api.fetchReportsBefore); offline the phone's own.

import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Car, CircleDot, MessageCircle, Siren, TriangleAlert, Wrench } from '@/components/icons';
import { ListRow, RowIcon } from '@/components/patterns/ListRow';
import type { ToneName } from '@/components/patterns/look';
import { Txt } from '@/components/ui';
import { fetchReportsBefore } from '@/lib/api';
import { loadMore, mergeNewest, oldestOf, PAGE, pageInfo, windowOf } from '@/lib/lists';
import { reportIcon, reportMeta, reportTitle } from '@/lib/reportList';
import { supabase } from '@/lib/supabase';
import type { VehicleReport } from '@/lib/types';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

const ICONS = { Wrench, Siren, CircleDot, TriangleAlert, Car, MessageCircle } as const;

/** A report's status as the row's chip: open red, in the garage amber, closed grey. */
const STATUS_TONE: Record<string, ToneName> = { open: 'red', in_garage: 'amber', closed: 'muted' };

export function ReportRow({ report, first }: { report: VehicleReport; first: boolean }) {
  const { t, vehicles } = useApp();
  const plate = vehicles.find((v) => v.id === report.vehicle_id)?.reg_no ?? null;
  const Icon = ICONS[reportIcon(report.category)];
  const danger = report.category === 'accident' || report.category === 'breakdown' || report.needs_vehicle;
  return (
    <View style={!first && styles.divider}>
      <ListRow
        inset
        left={<RowIcon icon={Icon} tone={danger ? 'red' : 'quiet'} />}
        title={reportTitle(t, report)}
        line={reportMeta(t, report, plate)}
        lineChip={{ text: t(`report.${report.status}`), tone: STATUS_TONE[report.status] ?? 'muted' }}
        below={report.office_note ? <Txt variant="small" color={colors.blue} numberOfLines={2}>{t('report.office', { note: report.office_note })}</Txt> : undefined}
        testID="report-row"
      />
    </View>
  );
}

/**
 * My reports, PAGE at a time: the ones on the phone (the newest, `base`) first, then the server's older ones below the
 * oldest held. The server's count of those is asked each time the screen is opened, so "20 of 45" is right.
 */
export function useReportPages(base: VehicleReport[]) {
  const [older, setOlder] = useState<VehicleReport[]>([]);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [shown, setShown] = useState(PAGE);
  const [busy, setBusy] = useState(false);
  const rows = useMemo(() => mergeNewest(base, older), [base, older]);
  // The newest of both, for the answers that come later (the cursor is always below the oldest report held now).
  const baseRef = useRef(base);
  baseRef.current = base;
  const olderRef = useRef(older);
  const keepOlder = useCallback((list: VehicleReport[]) => {
    olderRef.current = list;
    setOlder(list);
  }, []);
  const cursor = useCallback(() => oldestOf([...baseRef.current, ...olderRef.current]), []);
  // Only the newest answer counts (a count asked on opening must not undo a page that came after it).
  const asked = useRef(0);

  // A refresh that moved the end of the phone's newest reports (a report sent, the list read again) starts the list
  // again, so that no report falls between the phone's and the older pages.
  const baseEnd = oldestOf(base)?.id ?? '';
  const lastEnd = useRef(baseEnd);
  useEffect(() => {
    if (lastEnd.current === baseEnd) return;
    lastEnd.current = baseEnd;
    asked.current += 1;
    keepOlder([]);
    setRemaining(null);
    setShown(PAGE);
  }, [baseEnd, keepOlder]);

  // How many older ones the server has: asked each time the screen is opened, and when the list starts again.
  useFocusEffect(
    useCallback(() => {
      const mine = ++asked.current;
      fetchReportsBefore(supabase, cursor(), 0)
        .then((answer) => {
          if (mine === asked.current) setRemaining(answer.older);
        })
        .catch(() => undefined); // offline: the phone's reports only
    }, [baseEnd, cursor]),
  );

  async function more() {
    const step = loadMore(shown, rows.length, remaining);
    setShown(step.shown);
    if (!step.fetch || busy) return;
    const mine = ++asked.current;
    setBusy(true);
    try {
      const page = await fetchReportsBefore(supabase, cursor(), PAGE);
      if (mine !== asked.current) return;
      keepOlder(mergeNewest(olderRef.current, page.rows));
      setRemaining(Math.max(0, page.older - page.rows.length));
    } catch {
      // No connection: the rows the phone holds stay; Load more asks again.
    } finally {
      setBusy(false);
    }
  }

  return { rows, visible: windowOf(rows, shown), info: pageInfo(shown, rows.length, remaining), busy, more: () => void more() };
}

const styles = StyleSheet.create({
  divider: { borderTopWidth: 1, borderTopColor: colors.line },
});
