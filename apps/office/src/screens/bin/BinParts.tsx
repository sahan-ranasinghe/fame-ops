// Round 52 (docs/phase8-plan.md §40): the site's one archive block, one Delete permanently block and one "Delete…" for a
// wrong entry, shared by every page that has them (one component per pattern, docs/ui-patterns.md §10):
//   ArchiveCard        Archive → "Yes, archive" (the confirm on the page, as the switch-off was) → the server's trips from
//                      today on (needs_confirm), each a link to its task, with "Archive anyway" (confirm true) and Keep;
//                      Restore on an archived record.
//   DeleteRecordCard   can_delete first: deletable → Delete permanently opens the sheet (a person or a vehicle only after
//                      typing the name or plate, GitHub's type-to-confirm; the others one confirm); not deletable → the
//                      account rule's sentence or "Has history (…): archive instead", and no button. Users only.
//   DeleteEntryButton  "Delete…" on a wrong entry (approve): the sheet reads delete_entry's preview (what it is, what goes
//                      with it), a reason is required, then Delete.
// After a delete: the toast "Deleted · in Recently deleted until <day>" and back where the person came from.
import { type ReactNode, useEffect, useState } from "react";
import { Link } from "react-router";
import { useFleet } from "../../app/FleetContext";
import { errText } from "../../transport/errors";
import { canOpenTask, type FleetError } from "../../transport/types";
import { Notice } from "../../ui/basics";
import { useAfterSave } from "../../ui/Page";
import { Sheet } from "../../ui/Sheet";
import { useToast } from "../../ui/Toast";
import {
  ARCHIVE_IDLE, type ArchiveState, archiveTripLine, type CanDeleteAnswer, type DeletedAnswer, deletedToast, type EntryKind, type EntryPreview,
  isNeedsConfirm, notDeletableLines, type RecordKind, REASON_MIN, reasonOk, typedMatches, typePrompt,
} from "./binLogic";

const msgOf = (e: unknown) => errText(e as FleetError)[0];

/** The trips from today on that archiving would leave without their driver or vehicle, each opening its task. */
export function ArchiveTripsList({ trips }: { trips: { task_id: string; title: string; when: string }[] }) {
  const { me } = useFleet();
  const open = canOpenTask(me);
  return (
    <ul className="small" style={{ margin: 0, paddingLeft: 18 }} data-testid="archive-trips">
      {trips.map((t) => (
        <li key={t.task_id}>{open ? <Link to={`/tasks/${t.task_id}`}>{archiveTripLine(t)}</Link> : archiveTripLine(t)}</li>
      ))}
    </ul>
  );
}

type Words = { title: string; text: string; button: string };

/**
 * Archive / Restore on a record's page. `archive(confirm)` makes the call and answers the server's answer (a needs_confirm
 * answer shows the trips); `restore()` makes the other one. `done` runs after either worked (the toast, back).
 */
export function ArchiveCard({ archived, words, restoreWords, archive, restore, onArchived, onRestored, testId = "archive-card" }: {
  archived: boolean;
  words: (s: ArchiveState) => Words;
  restoreWords: { title: string; text: string };
  archive: (confirm: boolean) => Promise<unknown>;
  restore: () => Promise<unknown>;
  onArchived: (answer: unknown) => void;
  onRestored: (answer: unknown) => void;
  testId?: string;
}) {
  const [s, setS] = useState<ArchiveState>(ARCHIVE_IDLE);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function press() {
    setErr(null);
    if (s.step === "idle") {
      setS({ step: "armed" });
      return;
    }
    setBusy(true);
    try {
      const answer = await archive(s.step === "trips");
      if (isNeedsConfirm(answer) && answer.trips.length) {
        setS({ step: "trips", trips: answer.trips, note: answer.note });
        setBusy(false);
        return;
      }
      setBusy(false);
      onArchived(answer);
    } catch (e) {
      setErr(msgOf(e));
      setBusy(false);
    }
  }
  async function back() {
    setErr(null);
    setBusy(true);
    try {
      const answer = await restore();
      setBusy(false);
      onRestored(answer);
    } catch (e) {
      setErr(msgOf(e));
      setBusy(false);
    }
  }

  if (archived) {
    return (
      <div className="confirm" style={{ borderColor: "var(--line)" }} data-testid={testId}>
        <div>
          <b>{restoreWords.title}</b>
          <p className="muted small" style={{ margin: "4px 0 0" }}>{restoreWords.text}</p>
        </div>
        {err && <Notice tone="bad">{err}</Notice>}
        <div className="acts"><button type="button" className="btn dark" disabled={busy} onClick={() => void back()}>{busy ? "Restoring…" : "Restore"}</button></div>
      </div>
    );
  }
  const w = words(s);
  return (
    <div className="confirm" style={s.step === "idle" ? { borderColor: "var(--line)" } : undefined} data-testid={testId}>
      <div>
        <b>{w.title}</b>
        <p className="muted small" style={{ margin: "4px 0 0" }}>{w.text}</p>
      </div>
      {s.step === "trips" && <ArchiveTripsList trips={s.trips} />}
      {err && <Notice tone="bad">{err}</Notice>}
      <div className="acts">
        <button type="button" className="btn danger" disabled={busy} onClick={() => void press()}>{busy ? "Archiving…" : w.button}</button>
        {s.step !== "idle" && <button type="button" className="btn" disabled={busy} onClick={() => { setS(ARCHIVE_IDLE); setErr(null); }}>Keep</button>}
      </div>
    </div>
  );
}

/**
 * Delete permanently (users). On a page (the block) can_delete is asked when it shows: a record with history says so and has
 * no button. On a list's row (`compact`) the button shows first and can_delete is asked when it is pressed (a page of rows
 * never asks 25 times): the sheet then says why not, with no Delete, or asks to confirm. `refValue` is what the tools take
 * (a plate, a username, an e-mail, an id). `onDeleted` replaces the default (the toast, then back to `fallback`).
 */
export function DeleteRecordCard({ kind, refValue, fallback, onDeleted, compact = false }: {
  kind: RecordKind;
  refValue: string;
  fallback: string;
  onDeleted?: (answer: DeletedAnswer) => void;
  /** A row's own small control (a list), not a block of the page. */
  compact?: boolean;
}) {
  const { me, transport, store } = useFleet();
  const toast = useToast();
  const afterSave = useAfterSave();
  const allowed = me.tools.includes("can_delete") && me.tools.includes("delete_record");
  const [c, setC] = useState<CanDeleteAnswer | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // A row asks only once pressed; a page's block at once.
  const ask = allowed && !!refValue && (!compact || open);

  useEffect(() => {
    if (!ask) return;
    let alive = true;
    setC(null);
    setLoadErr(null);
    transport.call<CanDeleteAnswer>("can_delete", { kind, ref: refValue })
      .then((a) => { if (alive) setC(a); })
      .catch((e) => { if (alive) setLoadErr(msgOf(e)); });
    return () => { alive = false; };
  }, [ask, kind, refValue, transport, tries]);

  if (!allowed) return null;
  const expected = c?.confirm_with;
  const matches = !expected || typedMatches(kind, typed, expected);

  async function remove() {
    if (!c?.deletable || !matches) return;
    setBusy(true);
    setErr(null);
    try {
      const a = await transport.call<DeletedAnswer>("delete_record", { kind, ref: refValue, ...(expected ? { confirm_text: typed.trim() } : {}) });
      setBusy(false);
      setOpen(false);
      void store.invalidate();
      if (onDeleted) onDeleted(a);
      else {
        toast(deletedToast(a.until));
        afterSave(fallback);
      }
    } catch (e) {
      setErr(msgOf(e));
      setBusy(false);
    }
  }

  const retry = <button type="button" className="btn small" onClick={() => setTries((n) => n + 1)}>Try again</button>;
  const blocked = c && !c.deletable && (
    <div data-testid="delete-blocked">
      {notDeletableLines(c).map((l) => <p key={l} className="muted small" style={{ margin: 0 }}>{l}</p>)}
    </div>
  );
  const openButton = (
    <button type="button" className={`btn danger${compact ? " small" : ""}`} onClick={() => { setOpen(true); setTyped(""); setErr(null); }} data-testid="delete-permanently">
      Delete permanently
    </button>
  );

  const sheet = (
    <Sheet
      open={open && (compact || !!c?.deletable)}
      onClose={() => { if (!busy) setOpen(false); }}
      title={c ? `Delete ${c.label} permanently?` : "Delete permanently?"}
      testId="delete-record-sheet"
      footer={(
        <>
          <button type="button" className="btn" disabled={busy} onClick={() => setOpen(false)}>{c && !c.deletable ? "Close" : "Cancel"}</button>
          {c?.deletable && (
            <button type="button" className="btn danger" disabled={busy || !matches} onClick={() => void remove()} data-testid="delete-record-confirm">
              {busy ? "Deleting…" : "Delete permanently"}
            </button>
          )}
        </>
      )}
    >
      <div className="stack" style={{ gap: 10 }}>
        {loadErr ? <Notice tone="bad" action={retry}>{loadErr}</Notice>
          : !c ? <p className="muted" style={{ margin: 0 }}>Checking whether it can be deleted…</p>
          : !c.deletable ? blocked
          : <p style={{ margin: 0 }}>It goes to Recently deleted for 30 days, where an admin can restore it. After that it is gone for good.</p>}
        {c?.deletable && expected && (
          <div className="field">
            <label htmlFor="delete-type">{typePrompt(kind, expected)}</label>
            <input id="delete-type" autoComplete="off" spellCheck={false} className={kind === "vehicle" ? "mono" : undefined} value={typed}
              onChange={(e) => setTyped(e.target.value)} data-testid="delete-type" />
            {!matches && <span className="hint" data-testid="delete-type-why">{typed.trim() ? `That is not ${kind === "vehicle" ? "the plate" : "the name"} yet.` : "Delete permanently waits until it matches."}</span>}
          </div>
        )}
        {err && <Notice tone="bad">{err}</Notice>}
      </div>
    </Sheet>
  );

  if (compact) return <>{openButton}{sheet}</>;
  let body: ReactNode;
  if (loadErr) body = <Notice tone="bad" action={retry}>{loadErr}</Notice>;
  else if (!c) body = <p className="muted small" style={{ margin: 0 }}>Checking whether it can be deleted…</p>;
  else if (!c.deletable) body = blocked;
  else body = openButton;
  return (
    <div className="confirm" style={{ borderColor: "var(--line)" }} data-testid="delete-record">
      <div>
        <b>Delete permanently</b>
        <p className="muted small" style={{ margin: "4px 0 0" }}>Only for something added by mistake that was never used.</p>
      </div>
      {body}
      {sheet}
    </div>
  );
}

/**
 * "Delete…" on a wrong entry (approve): the sheet shows what it is and what goes with it (delete_entry's preview), asks for
 * the reason, then deletes. `onDeleted` replaces the default (the toast, then back to `fallback`): a row in a list
 * refreshes the list instead.
 */
export function DeleteEntryButton({ kind, id, fallback, onDeleted, className = "btn danger", label = "Delete…" }: {
  kind: EntryKind;
  id: string;
  fallback: string;
  onDeleted?: (answer: DeletedAnswer) => void;
  className?: string;
  label?: string;
}) {
  const { me, transport, store } = useFleet();
  const toast = useToast();
  const afterSave = useAfterSave();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<EntryPreview | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!me.tools.includes("delete_entry") || !id) return null;

  async function start() {
    setOpen(true);
    setPreview(null);
    setPreviewErr(null);
    setReason("");
    setErr(null);
    try {
      setPreview(await transport.call<EntryPreview>("delete_entry", { kind, id, preview: true }));
    } catch (e) {
      setPreviewErr(msgOf(e));
    }
  }
  async function remove() {
    if (!preview || !reasonOk(reason)) return;
    setBusy(true);
    setErr(null);
    try {
      const a = await transport.call<DeletedAnswer>("delete_entry", { kind, id, reason: reason.trim() });
      setBusy(false);
      setOpen(false);
      void store.invalidate();
      toast(deletedToast(a.until));
      if (onDeleted) onDeleted(a);
      else afterSave(fallback);
    } catch (e) {
      setErr(msgOf(e));
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className={className} onClick={() => void start()} data-testid={`delete-entry-${kind}`}>{label}</button>
      <Sheet
        open={open}
        onClose={() => { if (!busy) setOpen(false); }}
        title={preview ? `Delete ${preview.label}?` : "Delete…"}
        testId="delete-entry-sheet"
        footer={(
          <>
            <button type="button" className="btn" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
            <button type="button" className="btn danger" disabled={busy || !preview || !reasonOk(reason)} onClick={() => void remove()} data-testid="delete-entry-confirm">
              {busy ? "Deleting…" : "Delete"}
            </button>
          </>
        )}
      >
        <div className="stack" style={{ gap: 10 }}>
          {previewErr ? <Notice tone="bad">{previewErr}</Notice> : !preview ? <p className="muted" style={{ margin: 0 }}>Checking what goes with it…</p> : (
            <>
              <p style={{ margin: 0 }}><b data-testid="delete-entry-label">{preview.label}</b></p>
              {preview.affects.length > 0 && (
                <div>
                  <p className="muted small" style={{ margin: 0 }}>With it:</p>
                  <ul className="small" style={{ margin: "4px 0 0", paddingLeft: 18 }} data-testid="delete-entry-affects">
                    {preview.affects.map((a) => <li key={a}>{a}</li>)}
                  </ul>
                </div>
              )}
              <p className="muted small" style={{ margin: 0 }}>It waits in Recently deleted for 30 days, where an admin can restore it.</p>
              <div className="field">
                <label htmlFor={`delete-reason-${id}`}>Why is it wrong?</label>
                <textarea id={`delete-reason-${id}`} rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Logged twice by mistake" data-testid="delete-entry-reason" />
                {!reasonOk(reason) && <span className="hint" data-testid="delete-entry-why">Write the reason first (at least {REASON_MIN} characters).</span>}
              </div>
            </>
          )}
          {err && <Notice tone="bad">{err}</Notice>}
        </div>
      </Sheet>
    </>
  );
}
