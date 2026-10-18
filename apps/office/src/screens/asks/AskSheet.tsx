// Hotfix 4 (c): Ask drivers as its own step, a sheet over the page (Assign a task, Approve, Give it a driver, the Drivers
// board) instead of tick boxes on the rows: the question (Free for a trip? with the page's day and times, When at the
// office?, Where are you?), a note, its own list of drivers with tick boxes (the free ones ticked to start with; All free ·
// None), and Send. The answers come back on the page's rows (useAskAnswers); the sheet closes once it is sent.
// A dialog: Esc, the close button and a click on the shade close it; on a phone it sits at the bottom of the screen.
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useFleet } from "../../app/FleetContext";
import { useWatch } from "../../data/hooks";
import type { Ask, AskAnswers as AskAnswersData, AskDriverRow, AskDriversResult } from "../../data/types";
import { today } from "../../lib/format";
import { errText } from "../../transport/errors";
import type { FleetError } from "../../transport/types";
import { Avatar, Notice, Pill } from "../../ui/basics";
import { Icon } from "../../ui/icons";
import { TimeInput } from "../../ui/TimeInput";
import { useToast } from "../../ui/Toast";
import { ASK_EVERY, askKey } from "./AskAnswers";
import { answerChip, ASK_KINDS, type AskForm, askInput, MAX_ASK_NOTE } from "./askLogic";

/** A driver the sheet can ask: their username (ask_drivers names them so), name, photo, a status line and free or not. */
export interface AskCandidate {
  username: string;
  name: string;
  photo_url?: string | null;
  line?: string;
  free: boolean;
}

/** The sheet's form to start with: a trip question for the page's window, the free drivers ticked. Pure. */
export function sheetForm(candidates: readonly AskCandidate[], window: { date?: string; from?: string; to?: string }, todayIs: string): AskForm {
  return {
    kind: "free_for_trip",
    date: window.date ?? todayIs,
    from: window.from ?? "",
    to: window.to ?? "",
    note: "",
    who: "picked",
    drivers: candidates.filter((c) => c.free).map((c) => c.username),
  };
}

/** The free ones first, then the rest, each group in the page's order. Pure. */
export const freeFirst = (candidates: readonly AskCandidate[]): AskCandidate[] => [
  ...candidates.filter((c) => c.free),
  ...candidates.filter((c) => !c.free),
];

export function AskSheet({ candidates, window: trip, askFor, onSent, onClose }: {
  candidates: readonly AskCandidate[];
  /** The page's trip: the day and times the question starts with. */
  window: { date?: string; from?: string; to?: string };
  /** The task or the request the question is for (a Yes then offers it). */
  askFor?: { task?: string; request?: string };
  onSent: (ask: Ask) => void;
  onClose: () => void;
}) {
  const { transport, store } = useFleet();
  const toast = useToast();
  const [f, setF] = useState<AskForm>(() => sheetForm(candidates, trip, today()));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const first = useRef<HTMLButtonElement>(null);
  const set = <K extends keyof AskForm>(k: K, v: AskForm[K]) => setF((x) => ({ ...x, [k]: v }));
  const toggle = (u: string) => setF((x) => ({ ...x, drivers: x.drivers.includes(u) ? x.drivers.filter((d) => d !== u) : [...x.drivers, u] }));
  const rows = freeFirst(candidates);
  const trip_ = f.kind === "free_for_trip";

  useEffect(() => {
    first.current?.focus();
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function send(ev: FormEvent) {
    ev.preventDefault();
    const v = askInput(f, askFor ?? {});
    if ("error" in v) {
      setMsg(v.error);
      return;
    }
    setMsg(null);
    setBusy(true);
    try {
      const r = await transport.call<AskDriversResult>("ask_drivers", v.input);
      const n = r.ask.counts.asked;
      toast(`Asked ${n} driver${n === 1 ? "" : "s"}: the answers show on the list`);
      void store.invalidate();
      onSent(r.ask);
      onClose();
    } catch (e) {
      setMsg(errText(e as FleetError)[0]);
      setBusy(false);
    }
  }

  return (
    <div className="sheet-shade" onClick={onClose} data-testid="ask-sheet-shade">
      <form className="sheet" role="dialog" aria-modal="true" aria-label="Ask drivers" onClick={(e) => e.stopPropagation()} onSubmit={send} noValidate
        data-testid="ask-sheet">
        <div className="sheet-h">
          <h2>Ask drivers</h2>
          <button type="button" className="btn icon-btn" aria-label="Close" onClick={onClose}><Icon name="close" /></button>
        </div>
        <div className="field" role="radiogroup" aria-label="The question">
          <span className="lab">Question</span>
          <div className="ask-kinds">
            {ASK_KINDS.map((k, i) => (
              <button key={k.kind} ref={i === 0 ? first : undefined} type="button" className="ask-kind" role="radio" aria-checked={f.kind === k.kind}
                onClick={() => set("kind", k.kind)} data-testid={`sheet-kind-${k.kind}`}>
                <b>{k.title}</b>
                <span className="sub">{k.sub}</span>
              </button>
            ))}
          </div>
        </div>
        {trip_ && (
          <div className="ask-trip">
            <div className="field"><label htmlFor="sheet-date">Day</label><input type="date" id="sheet-date" value={f.date} min={today()} onChange={(e) => set("date", e.target.value)} /></div>
            <div className="field"><label htmlFor="sheet-from">From</label><TimeInput id="sheet-from" value={f.from} onCommit={(v) => set("from", v)} /></div>
            <div className="field"><label htmlFor="sheet-to">To <span className="muted" style={{ fontWeight: 400 }}>(optional)</span></label><TimeInput id="sheet-to" value={f.to} onCommit={(v) => set("to", v)} /></div>
          </div>
        )}
        <div className="field">
          <label htmlFor="sheet-note">Note <span className="muted" style={{ fontWeight: 400 }}>(optional)</span></label>
          <input id="sheet-note" maxLength={MAX_ASK_NOTE} value={f.note} onChange={(e) => set("note", e.target.value)}
            placeholder={trip_ ? "e.g. Team drop to Kurunegala, 6 people" : "A line under the question"} />
        </div>
        <div className="field">
          <div className="sheet-who">
            <span className="lab">Send to · {f.drivers.length} picked</span>
            <span className="acts">
              <button type="button" className="btn small" onClick={() => set("drivers", candidates.filter((c) => c.free).map((c) => c.username))}>All free</button>
              <button type="button" className="btn small" onClick={() => set("drivers", [])}>None</button>
            </span>
          </div>
          <div className="rows sheet-rows">
            {rows.map((c) => (
              <label key={c.username} className="row ask-pick-row" data-testid="sheet-row">
                <input type="checkbox" checked={f.drivers.includes(c.username)} onChange={() => toggle(c.username)} aria-label={`Ask ${c.name}`} />
                <Avatar name={c.name} src={c.photo_url ?? undefined} small />
                <span className="grow">
                  <span className="name">{c.name}{c.free && <Pill tone="ok">Free</Pill>}</span>
                  {c.line && <span className="sub" style={{ display: "block" }}>{c.line}</span>}
                </span>
              </label>
            ))}
            {!rows.length && <div className="row muted small">No drivers to ask.</div>}
          </div>
        </div>
        {msg && <Notice tone="bad">{msg}</Notice>}
        <button className="btn primary wide" type="submit" disabled={busy || !f.drivers.length} data-testid="sheet-send">
          {busy ? "Sending…" : `Send to ${f.drivers.length} driver${f.drivers.length === 1 ? "" : "s"}`}
        </button>
        <p className="hint" style={{ margin: 0 }}>They answer with one tap. Answers show on this list and in Notifications.{trip_ ? " The question closes when the trip starts." : ""}</p>
      </form>
    </div>
  );
}

/**
 * Hotfix 4 (c): a question's answers, live, for the page that sent it: on the web Realtime on driver_ask_answers asks again
 * at once (a slow poll behind it), the artifact every 10 s. The answer just sent stands in until ask_answers comes.
 */
export function useAskAnswers(ask: Ask | null): Ask | null {
  const { store, noConnector, realtime } = useFleet();
  const id = ask?.id ?? "";
  const key = askKey(id || "none");
  const live = !!realtime?.askAnswers;
  const entry = useWatch<AskAnswersData>(key, "ask_answers", { ask_id: id }, live ? ASK_EVERY.behindRealtime : ASK_EVERY.poll, !noConnector && !!id);
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
  const loaded = entry.data?.ask;
  return loaded && loaded.id === id ? loaded : ask;
}

/**
 * The question a page sent, kept while the tab is open (sessionStorage under `key`, e.g. "task.<id>", "request.<id>",
 * "board"; only on the page without a key), so a refresh keeps the answers on the rows.
 */
export function usePageAsk(key: string | null): [Ask | null, (ask: Ask) => void] {
  const stored = key ? `fame.ask.${key}` : null;
  const [ask, setAsk] = useState<Ask | null>(() => {
    if (!stored) return null;
    try {
      const raw = sessionStorage.getItem(stored);
      return raw ? (JSON.parse(raw) as Ask) : null;
    } catch {
      return null;
    }
  });
  const keep = (a: Ask) => {
    setAsk(a);
    if (!stored) return;
    try {
      sessionStorage.setItem(stored, JSON.stringify(a));
    } catch {
      // A private window: kept for this page only.
    }
  };
  return [ask, keep];
}

/** A driver's answer under their row: the chip (Yes green, No grey, Call me amber, a time), or that it is still awaited. */
export function AnswerLine({ row, testId }: { row: AskDriverRow; testId?: string }) {
  const chip = answerChip(row);
  return (
    <span className="sub drow-line ask-answer" data-testid={testId}>
      {chip ? <Pill tone={chip.tone}>{chip.text}</Pill> : <span className="muted">Asked · {row.state === "seen" ? "seen, no answer yet" : "waiting…"}</span>}
    </span>
  );
}
