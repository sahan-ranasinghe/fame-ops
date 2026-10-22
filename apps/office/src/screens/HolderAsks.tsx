// Round 4–7, feature 7 (22 October 2026): Asks (/tasks/asks): the asks for a busy driver or vehicle of the last 14 days
// (holder_asks), To me · By me · All (All with approve; ?which=), one trip's with ?task=<id>. Gmail's rows: the icon (a
// driver or a vehicle), one title (what and the trip), one grey line (when it is wanted, who asked whom, the note), the
// answer as a chip (Yes, No, Waiting). An ask to the person not answered yet has Yes / No (answer_holder_ask: the asker
// and the fleet admins are told; a Yes changes nothing by itself). A row's words open the trip for someone who may open
// tasks. Reached from More, the Timeline and a task page that has asks (TaskAsksLine).
import { useState } from "react";
import { Link } from "react-router";
import { useFleet } from "../app/FleetContext";
import type { HolderAsks as HolderAsksData } from "../data/types";
import { useQuery } from "../data/useQuery";
import { errText } from "../transport/errors";
import { can, canOpenTask, type FleetError } from "../transport/types";
import { Notice, Pill, Segmented } from "../ui/basics";
import { Icon } from "../ui/icons";
import { EmptyLine, ListHeader, SkeletonRows, useUrlFilter } from "../ui/ListKit";
import { PageTop } from "../ui/Page";
import { useToast } from "../ui/Toast";
import { answerChip, ASK_WHICH, askMeta, asksEmpty, asksFor, askTabs, askTitle, type AskWhich, canAnswer, type HolderAsk, taskAskCount, withAnswers } from "./holderAsksLogic";

export const HOLDER_ASKS_EVERY = 60_000;

/** One ask: the icon, the title and the grey line (a link to the trip when it may be opened), the chip or Yes / No. */
function AskRow({ a, which, opens, onAnswered }: { a: HolderAsk; which: AskWhich; opens: boolean; onAnswered: (id: string, answer: "yes" | "no") => void }) {
  const { transport } = useFleet();
  const toast = useToast();
  const [busy, setBusy] = useState<"yes" | "no" | null>(null);
  const [err, setErr] = useState<{ answer: "yes" | "no"; error: FleetError } | null>(null);
  async function answer(value: "yes" | "no") {
    if (busy) return;
    setBusy(value);
    setErr(null);
    try {
      await transport.call("answer_holder_ask", { ask_id: a.id, answer: value });
      onAnswered(a.id, value);
      toast(`You said ${value === "yes" ? "Yes" : "No"}`);
    } catch (e) {
      setErr({ answer: value, error: e as FleetError });
    }
    setBusy(null);
  }
  const chip = answerChip(a);
  const words = (
    <>
      <span className="name">{askTitle(a)}</span>
      <span className="sub" style={{ display: "block" }}>{askMeta(a, which)}</span>
    </>
  );
  return (
    <div className="row hask-row" data-testid="holder-ask-row" data-answer={a.answer ?? "waiting"}>
      <span className="hask-icon" aria-hidden="true"><Icon name={a.resource === "driver" ? "person" : "car"} /></span>
      {opens ? <Link className="grow hask-words" to={`/tasks/${a.task_id}`}>{words}</Link> : <span className="grow hask-words">{words}</span>}
      {canAnswer(a, which)
        ? (
          <span className="acts" role="group" aria-label={`Answer: ${askTitle(a)}`}>
            <button type="button" className="btn small primary" disabled={!!busy} onClick={() => void answer("yes")} data-testid="holder-ask-yes">{busy === "yes" ? "Sending…" : "Yes"}</button>
            <button type="button" className="btn small" disabled={!!busy} onClick={() => void answer("no")} data-testid="holder-ask-no">{busy === "no" ? "Sending…" : "No"}</button>
          </span>
        )
        : <Pill tone={chip.tone}>{chip.text}</Pill>}
      {err && (
        <div style={{ flex: "1 1 100%" }}>
          <Notice tone="bad" action={<button type="button" className="btn small" onClick={() => void answer(err.answer)}>Try again</button>}>{errText(err.error)[0]}</Notice>
        </div>
      )}
    </div>
  );
}

export function HolderAsks() {
  const { me, noConnector } = useFleet();
  const approve = can(me, "approve");
  const tabs = askTabs(approve);
  const [rawWhich, setWhich] = useUrlFilter<AskWhich>("which", "to_me", ASK_WHICH);
  const which: AskWhich = tabs.some(([k]) => k === rawWhich) ? rawWhich : "to_me";
  const [task, setTask] = useUrlFilter<string>("task", "");
  const q = useQuery<HolderAsksData>("holderAsks", "holder_asks", { which }, { every: HOLDER_ASKS_EVERY, keep: true, enabled: !noConnector });
  // Answers given here, shown at once (the next answer from the server says the same).
  const [given, setGiven] = useState<Map<string, "yes" | "no">>(() => new Map());
  const rows = q.data && q.data.which === which ? withAnswers(asksFor(q.data.asks, task || null), given) : [];
  const opens = canOpenTask(me);
  return (
    <section className="view" data-testid="holder-asks">
      <PageTop title="Asks" sub="For a busy driver or vehicle · the last 14 days" backTo={task ? `/tasks/${task}` : can(me, "view") ? "/schedule" : "/"}
        actions={can(me, "view") && me.tools.includes("day_timeline") ? <Link className="btn small" to="/schedule">Timeline</Link> : undefined} />
      <div className="stack" style={{ maxWidth: 820 }}>
        <Segmented label="Asks" options={tabs} value={which} onChange={setWhich} />
        {task && (
          <p className="muted small" style={{ margin: 0 }} data-testid="holder-asks-one-trip">
            The asks about one trip. <button type="button" className="linkish" onClick={() => setTask("")}>Show all</button>
          </p>
        )}
        <div className="card" aria-busy={q.updating || undefined}>
          <ListHeader title={tabs.find(([k]) => k === which)?.[1] ?? "Asks"} count={q.data && !q.stale ? rows.length : undefined} updating={q.updating} />
          {q.err && !q.data && (
            <div className="card-b">
              <Notice tone="bad" action={<button type="button" className="btn small" onClick={q.refetch}>Try again</button>}>{errText(q.err)[0]}</Notice>
            </div>
          )}
          {(q.loading || q.stale) && <SkeletonRows rows={3} label="Loading the asks…" />}
          {q.data && !q.stale && rows.length === 0 && <EmptyLine>{asksEmpty(which, !!task)}</EmptyLine>}
          {!q.stale && rows.length > 0 && (
            <div className="rows">
              {rows.map((a) => <AskRow key={a.id} a={a} which={which} opens={opens} onAnswered={(id, v) => setGiven((m) => new Map(m).set(id, v))} />)}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** How many asks are about this task (approve: all of them; else the person's own, to and by them). */
export function useTaskAsks(taskId: string): number {
  const { me, noConnector } = useFleet();
  const on = !noConnector && !!taskId && me.tools.includes("holder_asks");
  const approve = can(me, "approve");
  const all = useQuery<HolderAsksData>("holderAsks", "holder_asks", { which: "all" }, { enabled: on && approve, every: HOLDER_ASKS_EVERY });
  const toMe = useQuery<HolderAsksData>("holderAsks", "holder_asks", { which: "to_me" }, { enabled: on && !approve, every: HOLDER_ASKS_EVERY });
  const byMe = useQuery<HolderAsksData>("holderAsks", "holder_asks", { which: "by_me" }, { enabled: on && !approve, every: HOLDER_ASKS_EVERY });
  if (!on) return 0;
  return taskAskCount(approve ? [all.data] : [toMe.data, byMe.data], taskId);
}

/** The task page's line: "Asks about this trip · 2", opening the Asks page with this trip's. */
export function TaskAsksLine({ taskId }: { taskId: string }) {
  const n = useTaskAsks(taskId);
  if (!n) return null;
  return (
    <p className="muted small" style={{ margin: 0 }} data-testid="task-asks">
      <Link to={`/tasks/asks?task=${taskId}`}>Asks about this trip · {n}</Link>
    </p>
  );
}
