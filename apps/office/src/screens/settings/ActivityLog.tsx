// Round 2b: Settings → Activity log (users; Google Workspace's admin audit log): who changed what and when, from
// activity_log (office_audit's changes, newest first): when, who, through which channel, the action in words, what it was
// about, and done / refused (with the reason) / failed. The days (one date range button, default the last 7) and a
// person (the search box: a name, an e-mail or a driver's username). Reads are not listed.
// Round 3 (Google Workspace's and GitHub's audit logs): routine actions (watching drivers, reading a notification, loading
// a map) are hidden unless "Show routine actions" is on (off by default, kept in the URL as ?routine=1); refused and
// failed ones always show. A routine row is quieter (muted).
// Round 4–7 (the list audit's proposed removal, approved by Sahan 22 October 2026): a done row carries no "Done" pill (nearly
// every row is done: the pill said it on each); Refused, Failed and In progress keep theirs.
import type { ActivityEntry, ActivityLog as ActivityLogData } from "../../data/types";
import { errText } from "../../transport/errors";
import { Notice, Pill, SwitchLine } from "../../ui/basics";
import { DateRangePicker, useDateRange } from "../../ui/DateRangePicker";
import { EmptyLine, ListHeader, LoadMore, Pager, SearchBox, SkeletonRows, usePagedList, useUrlFilter, useUrlSearch } from "../../ui/ListKit";
import { PageTop } from "../../ui/Page";
import { whenText } from "../../lib/when";

/** The outcome's words and tone; none for a done row (the row says it by having no pill). */
export function outcomePill(e: Pick<ActivityEntry, "outcome">): { text: string; tone: "bad" | "warn" | "" } | null {
  switch (e.outcome) {
    case "done":
      return null;
    case "refused":
      return { text: "Refused", tone: "warn" };
    case "failed":
      return { text: "Failed", tone: "bad" };
    default:
      return { text: "In progress", tone: "" };
  }
}

/** activity_log's arguments: the days, the person when one is typed, include_routine only when the switch is on. */
export function activityArgs(from: string, to: string, search: string, routine: boolean): Record<string, unknown> {
  return { from, to, ...(search.trim() ? { person: search.trim() } : {}), ...(routine ? { include_routine: true } : {}) };
}

export default function ActivityLogPage() {
  const dates = useDateRange("week", { maxDays: 92 });
  const [search, setSearch] = useUrlSearch();
  const [routineParam, setRoutine] = useUrlFilter<"0" | "1">("routine", "0", ["0", "1"]);
  const routine = routineParam === "1";
  const args = activityArgs(dates.from, dates.to, search, routine);
  const list = usePagedList<ActivityEntry, ActivityLogData>("activity", "activity_log", dates.error ? null : args, (a) => a.entries, { every: 60_000 });
  const q = list.query;
  return (
    <section className="view" data-testid="activity-log">
      <PageTop title="Activity log" sub="Who changed what, and when" backTo="/settings" />
      <div className="stack">
        <div className="card card-b" style={{ display: "grid", gap: 12 }}>
          <DateRangePicker value={dates} />
          <SearchBox value={search} onChange={setSearch} placeholder="A person: name, e-mail or a driver's username" />
          <SwitchLine title="Show routine actions" text="Watching drivers, reading notifications, loading a map and the like. Refused and failed ones always show."
            on={routine} onChange={(on) => setRoutine(on ? "1" : "0")} testId="routine-switch" />
        </div>
        {!q.data ? (
          q.err ? <Notice tone="bad" action={<button type="button" className="btn small" onClick={q.refetch}>Try again</button>}>{errText(q.err)[0]}</Notice>
            : <div className="card"><SkeletonRows label="Loading the activity…" /></div>
        ) : (
          <div className="card">
            <ListHeader title="Changes" count={list.total} />
            {list.items.length === 0 ? <EmptyLine>No changes on these days{search.trim() ? " by this person" : ""}.</EmptyLine> : list.items.map((e) => {
              const o = outcomePill(e);
              return (
                <div className={`row${e.routine ? " routine" : ""}`} key={e.id} data-testid="activity-row" data-routine={e.routine ? "" : undefined} style={{ alignItems: "flex-start" }}>
                  <span className="small" style={{ minWidth: 112 }}>{whenText(e.at)}</span>
                  <div className="grow">
                    <div className="name">{e.action}{e.about ? <span className="muted"> · {e.about}</span> : null}</div>
                    <div className="sub">{[e.person, e.channel].filter(Boolean).join(" · ")}</div>
                    {e.reason && <div className="sub" style={{ color: "var(--warn)" }}>{e.reason}</div>}
                  </div>
                  {o && <Pill tone={o.tone || undefined}>{o.text}</Pill>}
                </div>
              );
            })}
            <LoadMore list={list} />
            {/* Round 4–7 (item 8): a desktop pages by number (before, only a phone could reach past the first 25). */}
            <Pager list={list} />
          </div>
        )}
      </div>
    </section>
  );
}
