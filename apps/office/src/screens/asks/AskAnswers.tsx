// A question's answers (/drivers/asks/:id, Part 3b H3; the ask.answered notification opens it): the question, who asked
// and when, open until … or closed, the counts, and one row per driver: the photo, the name, Sent · Seen · Answered, the
// answer as a chip (Yes green, No grey, Call me amber, the time, the point they shared with the town, its accuracy and a
// map link), Call and WhatsApp, and Assign on a Yes (the task's change page, the request's decide page, or a new task on
// the trip's day and time, with the driver filled in). Live: on the web a Realtime channel on driver_ask_answers reloads
// it at once (and a slow poll stands behind it); the artifact asks again every 10 seconds.
import { useEffect } from "react";
import { Link, useLocation, useParams } from "react-router";
import { useFleet } from "../../app/FleetContext";
import { useWatch } from "../../data/hooks";
import type { Ask, AskAnswers as AskAnswersData, AskDriverRow } from "../../data/types";
import { joinDots } from "../../lib/format";
import { Avatar, ErrBox, Loading, Pill, StaleNote, Updated } from "../../ui/basics";
import { ContactButtons } from "../../ui/ContactButtons";
import { ListHeader } from "../../ui/ListKit";
import { PageTop } from "../../ui/Page";
import { linksFromCall } from "../../ui/phoneLinks";
import { answerChip, assignLink, countsLine, openLine, placeLine, stateLine } from "./askLogic";

/** How often the answers are asked again: the artifact has no Realtime; on the web Realtime does the work. */
export const ASK_EVERY = { poll: 10_000, behindRealtime: 60_000 } as const;

export const askKey = (id: string) => `ask:${id}`;

export function AskAnswers() {
  const { id = "" } = useParams();
  const { me, store, noConnector, managePermissions, realtime } = useFleet();
  const { state } = useLocation();
  const key = askKey(id);
  const live = !!realtime?.askAnswers;
  const entry = useWatch<AskAnswersData>(key, "ask_answers", { ask_id: id }, live ? ASK_EVERY.behindRealtime : ASK_EVERY.poll, !noConnector && !!id);

  // Web: a driver's row changed (seen, answered): ask again at once (two changes in a row: one reload).
  useEffect(() => {
    if (!id || !realtime?.askAnswers) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const stop = realtime.askAnswers(id, () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void store.load(key, "ask_answers", { ask_id: id });
      }, 500);
    });
    return () => {
      if (timer) clearTimeout(timer);
      stop();
    };
  }, [store, realtime, id, key]);

  // Just sent: the page shows ask_drivers' answer until ask_answers comes.
  const sent = (state as { ask?: Ask } | null)?.ask;
  const ask = entry.data?.ask ?? (sent?.id === id ? sent : undefined);

  if (!ask) {
    return (
      <section className="view" data-testid="ask-answers">
        <PageTop title="Answers from drivers" sub="Ask drivers" backTo="/drivers/asks" />
        <ErrBox entry={entry} onRetry={() => void store.load(key, "ask_answers", { ask_id: id })} onFix={(f) => { if (f === "perms") void managePermissions?.(); }} />
        {!entry.err && !noConnector && <Loading>Loading the answers…</Loading>}
      </section>
    );
  }

  const tools = me.tools;
  return (
    <section className="view" data-testid="ask-answers">
      <PageTop title={ask.question} sub="Ask drivers" backTo="/drivers/asks" />
      <div className="stack">
        <StaleNote entry={entry} />
        <div className="card card-b ask-head">
          <div className="name">
            <Pill tone={ask.expired ? "" : "live"}>{openLine(ask)}</Pill>
            <span className="sub" data-testid="ask-asked">{joinDots([`Asked by ${ask.asked_by}`, `${ask.asked_day} ${ask.asked}`])}</span>
          </div>
          {ask.note && <p className="ask-note">“{ask.note}”</p>}
          {(ask.task_id || ask.request_id) && (
            <p className="sub" style={{ margin: 0 }}>
              For {ask.task_id ? <Link to={`/tasks/${ask.task_id}`}>a task</Link> : <Link to={`/requests/${ask.request_id}`}>a request</Link>}
            </p>
          )}
          <dl className="facts" data-testid="ask-counts" aria-label={countsLine(ask)}>
            <div><dt>Asked</dt><dd className="num">{ask.counts.asked}</dd></div>
            <div><dt>Seen</dt><dd className="num">{ask.counts.seen}</dd></div>
            <div><dt>Answered</dt><dd className="num">{ask.counts.answered}</dd></div>
            {ask.kind === "free_for_trip" && <div><dt>Yes</dt><dd className="num">{ask.counts.yes}</dd></div>}
          </dl>
        </div>
        <div className="card">
          <ListHeader title="Drivers" count={ask.drivers.length} right={<Updated entry={entry} />} />
          <div className="rows">
            {ask.drivers.map((r) => <AnswerRow key={r.username ?? r.name} r={r} assign={assignLink(ask, r, tools)} />)}
          </div>
        </div>
      </div>
    </section>
  );
}

function AnswerRow({ r, assign }: { r: AskDriverRow; assign: string | null }) {
  const chip = answerChip(r);
  return (
    <div className="row ask-row" data-testid="ask-row" data-state={r.state}>
      <Avatar name={r.name} src={r.photo_url} />
      <div className="grow">
        <div className="name">
          {r.name}
          {chip ? <Pill tone={chip.tone}>{chip.text}</Pill> : <span className="muted small" style={{ fontWeight: 400 }}>No answer yet</span>}
        </div>
        <div className="sub">{stateLine(r)}</div>
        {r.location && (
          <div className="sub" data-testid="ask-location">
            {placeLine(r.location)} · <a href={r.location.map} target="_blank" rel="noopener">Map</a>
          </div>
        )}
      </div>
      <div className="acts">
        {assign && <Link className="btn small primary" to={assign} data-testid="ask-assign">Assign</Link>}
        <ContactButtons phone={linksFromCall(r.links)} label="Call" />
      </div>
    </div>
  );
}
