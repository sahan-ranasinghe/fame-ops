// Part 3b (H1): add, change or remove when a driver is not available for dispatch. The day, the last day (full days only),
// When (Full day · Morning until 13:00 · Afternoon from 13:00 · From–to; the split is the setting half_day_split), from and
// to (From–to only), the reason (Leave · Half day · Personal · Other) and a note. Save → set_unavailability (with the
// entry's id when changing it); Remove → remove_unavailability after a second click ("Remove? Click again"). It sits in the
// page (the week view, the driver's page): no dialog, nothing closes on a click outside it.
import { type FormEvent, useState } from "react";
import { useFleet } from "../app/FleetContext";
import type { SetUnavailabilityResult, UnavailableEntry } from "../data/types";
import { today } from "../lib/format";
import { asFleetError, errText } from "../transport/errors";
import { Chips, Notice } from "../ui/basics";
import { TimeInput } from "../ui/TimeInput";
import { useToast } from "../ui/Toast";
import { useFleetSettings } from "./dispatchParts";
import { entryError, entryForm, type EntryForm, partChoices, REASONS, setUnavailabilityArgs, shortDay, splitOf } from "./unavailabilityLogic";

export function UnavailabilityEditor({ driver, driverName, entry, day, onDone }: {
  /** The driver's username (or code or name). */
  driver: string;
  driverName: string;
  /** The entry to change; none = a new one. */
  entry?: UnavailableEntry | null;
  /** A new entry's day (YYYY-MM-DD). */
  day?: string;
  /** Saved, removed or closed: the page closes the editor (and reloads what it shows). */
  onDone: (outcome: "saved" | "removed" | "closed") => void;
}) {
  const { me, store, transport } = useFleet();
  const toast = useToast();
  const settings = useFleetSettings();
  // The setting half_day_split (13:00 when it is absent or not a time).
  const split = splitOf(settings.data?.settings?.half_day_split);
  const [f, setF] = useState<EntryForm>(() => entryForm(entry, day ?? today()));
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const canSave = me.tools.includes("set_unavailability");
  const canRemove = !!entry && me.tools.includes("remove_unavailability");
  const set = <K extends keyof EntryForm>(k: K, v: EntryForm[K]) => {
    setF((x) => ({ ...x, [k]: v }));
    setArmed(false);
    setMsg(null);
  };
  const first = driverName.split(" ")[0] || driverName;

  async function save(ev: FormEvent) {
    ev.preventDefault();
    const bad = entryError(f, today());
    if (bad) {
      setMsg(bad);
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const r = await transport.call<SetUnavailabilityResult>("set_unavailability", setUnavailabilityArgs(driver, f, entry?.id));
      toast(`${r.saved === "changed" ? "Changed" : "Saved"}: ${first} · ${r.entry?.text ?? "not available"}`);
      void store.invalidate();
      onDone("saved");
    } catch (e) {
      setMsg(errText(asFleetError(e))[0]);
      setBusy(false);
    }
  }

  async function remove() {
    if (!entry) return;
    if (!armed) {
      setArmed(true);
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await transport.call("remove_unavailability", { id: entry.id });
      toast(`Removed: ${first} is available ${shortDay(entry.day)}`);
      void store.invalidate();
      onDone("removed");
    } catch (e) {
      setMsg(errText(asFleetError(e))[0]);
      setArmed(false);
      setBusy(false);
    }
  }

  const id = entry?.id ?? "new";
  return (
    <form className="card card-b form unav-editor" data-testid="unav-editor" onSubmit={(e) => void save(e)} aria-label={`Not available: ${driverName}`}>
      <div className="unav-editor-h">
        <h3>{entry ? "Change: not available" : "Not available"} · {driverName}</h3>
        {entry && <span className="muted small">Added by {entry.added_by} · {entry.added}{entry.changed_by ? ` · changed by ${entry.changed_by}` : ""}</span>}
      </div>
      <div className="grid2">
        <div className="field">
          <label htmlFor={`unav-day-${id}`}>Day</label>
          <input type="date" id={`unav-day-${id}`} value={f.day} min={today()} disabled={!canSave} onChange={(e) => set("day", e.target.value)} />
        </div>
        {f.part === "full_day" && (
          <div className="field">
            <label htmlFor={`unav-last-${id}`}>Last day <span className="muted small">(several days)</span></label>
            <input type="date" id={`unav-last-${id}`} value={f.last_day} min={f.day || today()} disabled={!canSave} onChange={(e) => set("last_day", e.target.value)} />
          </div>
        )}
      </div>
      <div className="field">
        <span className="lab" id={`unav-when-${id}`}>When</span>
        <div role="group" aria-labelledby={`unav-when-${id}`}>
          <Chips options={partChoices(split)} value={f.part} onChange={(p) => canSave && set("part", p)} />
        </div>
      </div>
      {f.part === "hours" && (
        <div className="grid2">
          <div className="field"><label htmlFor={`unav-from-${id}`}>From</label><TimeInput id={`unav-from-${id}`} value={f.from} disabled={!canSave} onCommit={(v) => set("from", v)} /></div>
          <div className="field"><label htmlFor={`unav-to-${id}`}>To</label><TimeInput id={`unav-to-${id}`} value={f.to} disabled={!canSave} onCommit={(v) => set("to", v)} /></div>
        </div>
      )}
      <div className="field">
        <span className="lab" id={`unav-reason-${id}`}>Reason</span>
        <div role="group" aria-labelledby={`unav-reason-${id}`}>
          <Chips options={REASONS} value={f.reason} onChange={(r) => canSave && set("reason", r)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor={`unav-note-${id}`}>Note <span className="muted small">(optional)</span></label>
        <input id={`unav-note-${id}`} maxLength={300} value={f.note} disabled={!canSave} onChange={(e) => set("note", e.target.value)} />
      </div>
      {msg && <Notice tone="bad">{msg}</Notice>}
      <div className="acts">
        {canSave && <button type="submit" className="btn dark" disabled={busy}>{busy && !armed ? "Saving…" : entry ? "Save changes" : "Save"}</button>}
        <button type="button" className="btn" disabled={busy} onClick={() => onDone("closed")}>{canSave ? "Cancel" : "Close"}</button>
        {canRemove && (
          <button type="button" className="btn danger" disabled={busy} onClick={() => void remove()} data-testid="unav-remove">
            {armed ? "Remove? Click again" : "Remove"}
          </button>
        )}
      </div>
    </form>
  );
}
