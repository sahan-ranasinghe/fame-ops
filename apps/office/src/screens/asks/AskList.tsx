// Questions to drivers (/drivers/asks, Part 3b H3): ask_answers without ask_id, the last 7 days, newest first, 25 at a
// time (page numbers on a desktop, Load more on a phone); each row the question, when and by whom, open or closed, the
// counts, opening its answers page. "Ask drivers" for someone who may ask.
// Round 4–7 (item 10, per person): the person's OWN questions by default (ask_answers answers only those); someone with
// approve has "Mine · Everyone's" (ask_answers all: true), kept in the address (?whose=all).
import { Link } from "react-router";
import { useFleet } from "../../app/FleetContext";
import type { Ask, AskAnswers } from "../../data/types";
import { joinDots } from "../../lib/format";
import { errText } from "../../transport/errors";
import { Notice, Pill, Segmented } from "../../ui/basics";
import { EmptyLine, ListHeader, LoadMore, Pager, usePagedList, SkeletonRows, useUrlFilter } from "../../ui/ListKit";
import { PageTop } from "../../ui/Page";
import { countsLine, openLine } from "./askLogic";

/** The list's query key. */
export const ASKS_QUERY = "asks";

/** Whose questions: the person's own, or (approve) everyone's. */
export type Whose = "mine" | "all";
export const WHOSE: readonly (readonly [Whose, string])[] = [["mine", "Mine"], ["all", "Everyone's"]];
/** ask_answers' arguments for the list: everyone's only for an approver who chose it. */
export const asksArgs = (whose: Whose, approver: boolean): Record<string, unknown> => (approver && whose === "all" ? { all: true } : {});

export function AskList() {
  const { me, noConnector } = useFleet();
  const approver = me.permissions.includes("approve");
  const [whose, setWhose] = useUrlFilter<Whose>("whose", "mine", ["mine", "all"]);
  const list = usePagedList<Ask, AskAnswers>(ASKS_QUERY, "ask_answers", asksArgs(whose, approver), (a) => a.asks ?? [], { every: 60_000, enabled: !noConnector });
  const q = list.query;
  return (
    <section className="view" data-testid="ask-list">
      <PageTop title="Questions to drivers" sub="Drivers · the last 7 days" backTo="/drivers"
        actions={me.tools.includes("ask_drivers") ? <Link className="btn small primary" to="/drivers/ask">Ask drivers</Link> : undefined} />
      {approver && <div style={{ marginBottom: 12 }}><Segmented label="Whose questions" options={WHOSE} value={whose} onChange={setWhose} /></div>}
      <div className="card">
        <ListHeader title={approver && whose === "all" ? "Everyone's questions" : "Questions"} count={q.data ? list.total : undefined} updating={q.updating} />
        {q.err && !q.data && <div className="card-b"><Notice tone="bad">{errText(q.err)[0]} <button type="button" className="btn small" onClick={q.refetch}>Try again</button></Notice></div>}
        {q.loading && <SkeletonRows label="Loading the questions…" />}
        {q.data && !list.items.length && <EmptyLine>No questions to drivers in the last 7 days.</EmptyLine>}
        <div className="rows">
          {list.items.map((a) => (
            <Link key={a.id} className="row link-row" to={`/drivers/asks/${a.id}`} data-testid="ask-list-row">
              <span className="grow">
                <span className="name">{a.question}</span>
                <span className="sub" style={{ display: "block" }}>{joinDots([`${a.asked_day} ${a.asked}`, `by ${a.asked_by}`, countsLine(a)])}</span>
                {a.note && <span className="sub" style={{ display: "block" }}>“{a.note}”</span>}
              </span>
              <Pill tone={a.expired ? "" : "live"}>{openLine(a)}</Pill>
            </Link>
          ))}
        </div>
        <LoadMore list={list} />
        <Pager list={list} />
      </div>
    </section>
  );
}
