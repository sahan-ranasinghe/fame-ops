// Ask drivers (/drivers/ask, Part 3b H3; people with ask_drivers): one question with one-tap answers in the drivers'
// app, instead of calling around. The question as three cards (Free for a trip? · When can you be at the office? · Where
// are you now?), the trip's day, From and To for a trip question, a note, and who: the drivers the link names (Who's
// available, the Drivers board) as chips, "Add drivers" from the Drivers board, or All free ones. Send → ask_drivers (with
// the link's task or request) → the answers page. The form keeps a draft like every form; a new link opens a fresh one.
import { type FormEvent, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { useFleet } from "../../app/FleetContext";
import { useFormDraft } from "../../data/drafts";
import type { AskDriversResult, BoardDriver, DriversBoard } from "../../data/types";
import { useQuery } from "../../data/useQuery";
import { today } from "../../lib/format";
import { errText } from "../../transport/errors";
import { canOpenTask, type FleetError } from "../../transport/types";
import { Chips, Notice, Pill } from "../../ui/basics";
import { ChoiceCard, SelectableRow } from "../../ui/Select";
import { DraftBanner } from "../../ui/DraftBanner";
import { Icon } from "../../ui/icons";
import { PageTop, StickyActions } from "../../ui/Page";
import { TimeInput } from "../../ui/TimeInput";
import { useToast } from "../../ui/Toast";
import { readAskLink } from "./askLink";
import { ASK_KINDS, type AskForm, askFormFrom, askInput, type AskWho, MAX_ASK_NOTE } from "./askLogic";

/** A driver as ask_drivers names them: the username, else the name. */
const idOf = (d: Pick<BoardDriver, "username" | "name">) => d.username ?? d.name;

/** The page: a new link (another driver, another trip) opens a fresh form. */
export function AskDrivers() {
  const { search } = useLocation();
  return <AskDriversForm key={search} />;
}

function AskDriversForm() {
  const { me, store, transport } = useFleet();
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const [link] = useState(() => readAskLink(params));
  const [f, setF, draft] = useFormDraft<AskForm>("ask-drivers", null, () => askFormFrom(link, today()));
  const set = <K extends keyof AskForm>(k: K, v: AskForm[K]) => setF((x) => ({ ...x, [k]: v }));
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // The drivers' names and status for the chips and the picker (the Drivers board: every active driver now).
  const boardQ = useQuery<DriversBoard>("askBoard", "drivers_board", {}, { enabled: me.tools.includes("drivers_board"), keep: true });
  const board = boardQ.data;
  const nameOf = (id: string) => board?.drivers.find((d) => idOf(d) === id)?.name ?? id;
  const toggle = (id: string) => setF((x) => ({ ...x, drivers: x.drivers.includes(id) ? x.drivers.filter((d) => d !== id) : [...x.drivers, id] }));
  const trip = f.kind === "free_for_trip";

  async function send(ev: FormEvent) {
    ev.preventDefault();
    const v = askInput(f, { task: link.task, request: link.request });
    if ("error" in v) {
      setMsg(v.error);
      return;
    }
    setMsg(null);
    setBusy(true);
    try {
      const r = await transport.call<AskDriversResult>("ask_drivers", v.input);
      draft.clear();
      const n = r.ask.counts.asked;
      toast(`Asked ${n} driver${n === 1 ? "" : "s"}`);
      void store.invalidate();
      navigate(`/drivers/asks/${r.ask.id}`, { replace: true, state: { ask: r.ask } });
    } catch (e) {
      setMsg(errText(e as FleetError)[0]);
      setBusy(false);
    }
  }

  return (
    <section className="view" data-testid="ask-drivers">
      <PageTop title="Ask drivers" sub="Drivers · one question, one-tap answers"
        actions={me.tools.includes("ask_answers") ? <Link className="btn small" to="/drivers/asks">Earlier questions</Link> : undefined} />
      <DraftBanner draft={draft} />
      <form className="page-form" onSubmit={send} noValidate>
        {(link.task || link.request) && (
          <Notice tone="info">
            For {link.task ? (canOpenTask(me) ? <Link to={`/tasks/${link.task}`}>this task</Link> : "this task") : <Link to={`/requests/${link.request}`}>this request</Link>}: a Yes on the
            answers page gets Assign.
          </Notice>
        )}
        <div className="card card-b form">
          <div className="field" role="radiogroup" aria-label="The question">
            <span className="lab">The question</span>
            <div className="ask-kinds">
              {ASK_KINDS.map((k) => (
                <ChoiceCard key={k.kind} className="ask-kind" selected={f.kind === k.kind} onPick={() => set("kind", k.kind)} testId={`ask-kind-${k.kind}`}>
                  <b>{k.title}</b>
                  <span className="sub">{k.sub}</span>
                </ChoiceCard>
              ))}
            </div>
          </div>
          {trip && (
            <div className="ask-trip">
              <div className="field"><label htmlFor="ask-date">Day</label><input type="date" id="ask-date" value={f.date} min={today()} onChange={(e) => set("date", e.target.value)} /></div>
              <div className="field"><label htmlFor="ask-from">From</label><TimeInput id="ask-from" value={f.from} onCommit={(v) => set("from", v)} /></div>
              <div className="field"><label htmlFor="ask-to">To <span className="muted" style={{ fontWeight: 400 }}>(optional)</span></label><TimeInput id="ask-to" value={f.to} onCommit={(v) => set("to", v)} /></div>
            </div>
          )}
          <div className="field">
            <label htmlFor="ask-note">Note <span className="muted" style={{ fontWeight: 400 }}>(optional)</span></label>
            <input id="ask-note" maxLength={MAX_ASK_NOTE} placeholder={trip ? "e.g. Team drop to Kurunegala, 6 people" : "A line under the question"} value={f.note}
              onChange={(e) => set("note", e.target.value)} />
            <span className="hint">
              {trip ? "The question closes when the trip starts." : f.kind === "where_now" ? "The driver shares one point, once, if they agree. It closes after 2 hours." : "It closes after 2 hours."}
            </span>
          </div>
        </div>

        <div className="card card-b form">
          <div className="field">
            <span className="lab">Who</span>
            <Chips<AskWho> options={[["picked", "Drivers I choose"], ["all_free", "All free ones"]]} value={f.who} onChange={(w) => set("who", w)} />
          </div>
          {f.who === "all_free" ? (
            <p className="hint" style={{ margin: 0 }} data-testid="all-free-line">
              {trip
                ? "Every driver free for the trip then: no other task and not marked not available."
                : `Every driver on duty and not on a task now${board ? ` (${board.counts.free_now} now)` : ""}.`}
            </p>
          ) : (
            <>
              <div className="chips" data-testid="ask-picked">
                {f.drivers.map((id) => (
                  <span key={id} className="ask-chip">
                    {nameOf(id)}
                    <button type="button" className="ask-chip-x" aria-label={`Remove ${nameOf(id)}`} onClick={() => toggle(id)}><Icon name="close" /></button>
                  </span>
                ))}
                {!f.drivers.length && <span className="muted small">No drivers chosen yet.</span>}
              </div>
              <div className="acts">
                <button type="button" className="btn small" onClick={() => setPicking((p) => !p)} aria-expanded={picking} data-testid="add-drivers">
                  <Icon name="plus" />{picking ? "Close the list" : "Add drivers"}
                </button>
              </div>
              {picking && <DriverPicker board={board} loading={boardQ.loading} error={boardQ.err ? errText(boardQ.err)[0] : undefined}
                picked={f.drivers} onToggle={toggle} onDone={() => setPicking(false)} />}
            </>
          )}
        </div>

        {msg && <Notice tone="bad">{msg}</Notice>}
        <StickyActions>
          <button className="btn primary" type="submit" disabled={busy} data-testid="ask-send">{busy ? "Sending…" : "Send the question"}</button>
        </StickyActions>
      </form>
    </section>
  );
}

/** The Drivers board as a list to tick: name, status now, Free now; a search over the names. */
function DriverPicker({ board, loading, error, picked, onToggle, onDone }: {
  board?: DriversBoard;
  loading: boolean;
  error?: string;
  picked: string[];
  onToggle: (id: string) => void;
  onDone: () => void;
}) {
  const [text, setText] = useState("");
  const rows = useMemo(() => {
    const key = text.trim().toLowerCase();
    const all = board?.drivers ?? [];
    // The free ones first, then by name (the board's own order inside each).
    const sorted = [...all.filter((d) => d.free_now), ...all.filter((d) => !d.free_now)];
    return key ? sorted.filter((d) => `${d.name} ${d.username ?? ""}`.toLowerCase().includes(key)) : sorted;
  }, [board, text]);
  return (
    <div className="ask-picker" data-testid="driver-picker">
      <input type="search" aria-label="Find a driver" placeholder="Find a driver" value={text} onChange={(e) => setText(e.target.value)} />
      {error && !board && <Notice tone="bad">{error}</Notice>}
      {loading && !board && <div className="muted small">Loading the drivers…</div>}
      {board && (
        <div className="rows">
          {rows.map((d) => {
            const id = idOf(d);
            const on = picked.includes(id);
            return (
              <SelectableRow key={id} selected={on} onToggle={() => onToggle(id)} label={d.name} testId="picker-row" className="ask-pick-row">
                <span className="name">{d.name}{d.free_now && <Pill tone="ok">Free now</Pill>}</span>
                <span className="sub" style={{ display: "block" }}>{d.status.text}</span>
              </SelectableRow>
            );
          })}
          {!rows.length && <div className="row muted small">{text.trim() ? "No driver by that name." : "No active drivers."}</div>}
        </div>
      )}
      <div className="acts"><button type="button" className="btn small dark" onClick={onDone}>Done</button></div>
    </div>
  );
}
