// Round 2b: Settings → Activity log (users; Google Workspace's admin audit log): who changed what and when, from
// activity_log (office_audit's changes, newest first): when, who, through which channel, the action in words, what it was
// about, and done / refused (with the reason) / failed. The days (one date range button, default the last 7) and a
// person (the search box: a name, an e-mail or a driver's username). Reads are not listed.
import type { ActivityEntry, ActivityLog as ActivityLogData } from "../../data/types";
import { errText } from "../../transport/errors";
import { Notice, Pill } from "../../ui/basics";
import { DateRangePicker, useDateRange } from "../../ui/DateRangePicker";
import { EmptyLine, ListHeader, LoadMore, SearchBox, SkeletonRows, usePagedList, useUrlSearch } from "../../ui/ListKit";
import { PageTop } from "../../ui/Page";

/** The outcome's words and tone. */
export function outcomePill(e: Pick<ActivityEntry, "outcome">): { text: string; tone: "ok" | "bad" | "warn" | "" } {
  switch (e.outcome) {
    case "done":
      return { text: "Done", tone: "ok" };
    case "refused":
      return { text: "Refused", tone: "warn" };
    case "failed":
      return { text: "Failed", tone: "bad" };
    default:
      return { text: "In progress", tone: "" };
  }
}

export default function ActivityLogPage() {
  const dates = useDateRange("week", { maxDays: 92 });
  const [search, setSearch] = useUrlSearch();
  const args = { from: dates.from, to: dates.to, ...(search.trim() ? { person: search.trim() } : {}) };
  const list = usePagedList<ActivityEntry, ActivityLogData>("activity", "activity_log", dates.error ? null : args, (a) => a.entries, { every: 60_000 });
  const q = list.query;
  return (
    <section className="view" data-testid="activity-log">
      <PageTop title="Activity log" sub="Who changed what, and when" backTo="/settings" />
      <div className="stack">
        <div className="card card-b" style={{ display: "grid", gap: 12 }}>
          <DateRangePicker value={dates} />
          <SearchBox value={search} onChange={setSearch} placeholder="A person: name, e-mail or a driver's username" />
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
                <div className="row" key={e.id} data-testid="activity-row" style={{ alignItems: "flex-start" }}>
                  <span className="mono small" style={{ minWidth: 112 }}>{e.at}</span>
                  <div className="grow">
                    <div className="name">{e.action}{e.about ? <span className="muted"> · {e.about}</span> : null}</div>
                    <div className="sub">{[e.person, e.channel].filter(Boolean).join(" · ")}</div>
                    {e.reason && <div className="sub" style={{ color: "var(--warn)" }}>{e.reason}</div>}
                  </div>
                  <Pill tone={o.tone || undefined}>{o.text}</Pill>
                </div>
              );
            })}
            <LoadMore list={list} />
          </div>
        )}
      </div>
    </section>
  );
}
