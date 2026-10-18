// The counts on the menu (Hotfix 3, L4): the requests waiting on Requests (approve) and the open issues on Issues (the
// issues bell is gone: the notification tray is the one icon). The Shell watches the issues count (list_issues, active,
// every minute; on the web a change on the issues table reloads it within a second); the menu, the phone's tab bar and
// the More page read the counts here.
import { useEffect } from "react";
import { useEntry } from "../data/hooks";
import type { IssuesList, Overview } from "../data/types";
import { BELL_KEY, bellCount } from "../screens/issuesLogic";
import { can } from "../transport/types";
import { useFleet } from "./FleetContext";
import { ISSUES_NEED } from "./nav";

/** The issues count's query (the IssuePage patches the same entry after a change). */
export const ISSUES_COUNT_ARGS = { status: "active", limit: 10 };

/** Watches the open issues while the app is open (the Shell). */
export function useIssuesCountWatch(): void {
  const { me, store, noConnector, realtime } = useFleet();
  const show = !noConnector && can(me, ...ISSUES_NEED);
  useEffect(() => {
    if (!show) return;
    store.watch(BELL_KEY, "list_issues", ISSUES_COUNT_ARGS, 60000);
    return () => store.unwatch(BELL_KEY);
  }, [store, show]);
  // Web: a change on the issues table refreshes the count at once (one reload a second at most).
  useEffect(() => {
    // Web only: the artifact has no Realtime (its build carries no Supabase code).
    if (!show || !realtime?.issues) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const stop = realtime.issues(() => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void store.load(BELL_KEY, "list_issues", ISSUES_COUNT_ARGS);
      }, 1000);
    });
    return () => {
      if (timer) clearTimeout(timer);
      stop();
    };
  }, [store, show, realtime]);
}

/** The badge per menu key: requests (waiting, for approvers) and issues (open or in progress). 0 = no badge. */
export function useNavBadges(): Record<string, number> {
  const { me } = useFleet();
  const overview = useEntry<Overview>("overview");
  const issues = useEntry<IssuesList>(BELL_KEY);
  return {
    requests: can(me, "approve") ? overview.data?.requests?.waiting ?? 0 : 0,
    issues: can(me, ...ISSUES_NEED) ? bellCount(issues.data) : 0,
  };
}

/** "99+" above 99. */
export const badgeText = (n: number): string => (n > 99 ? "99+" : String(n));
