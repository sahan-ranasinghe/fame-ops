// Phase 7 (§13): a trip a driver started in the app, on the office's side. The tags (board cards, the task page, the
// Overview's panel) and, on the task page for someone who may call set_trip_purpose, Company work ↔ Personal and
// "Attach a project" (job number, short name or name; "internal" = Fame internal). Saved on the page itself (no dialog);
// the task is loaded again in place and every list on screen fetches again quietly (no flash).
import { useState } from "react";
import { useFleet } from "../app/FleetContext";
import type { TaskKind, TripPurpose, TripPurposeResult } from "../data/types";
import { errText } from "../transport/errors";
import type { FleetError } from "../transport/types";
import { Notice, Pill } from "../ui/basics";
import { useToast } from "../ui/Toast";
import { PURPOSE_TEXT, purposeDoneText, purposeInput, tripTags } from "./tripPurposeLogic";

export function TripTags({ t }: { t: { kind?: TaskKind; purpose?: TripPurpose } }) {
  const tags = tripTags(t);
  if (!tags.length) return null;
  return (
    <span className="trip-tags" data-testid="trip-tags">
      {tags.map((g) => <Pill key={g.label} tone={g.tone}>{g.label}</Pill>)}
    </span>
  );
}

/** The task page's card for a driver-started trip: what it is now, and (set_trip_purpose) the switch and the project. */
export function TripPurposeCard({ taskId, purpose, driver, charged, onSaved }: {
  taskId: string;
  purpose?: TripPurpose;
  driver?: string;
  /** "Charged to" as the page shows it. */
  charged: string;
  onSaved: () => Promise<void>;
}) {
  const { me, transport, store } = useFleet();
  const toast = useToast();
  const now: TripPurpose = purpose ?? "company";
  const [choice, setChoice] = useState<TripPurpose>(now);
  const [project, setProject] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const edits = me.tools.includes("set_trip_purpose");
  const who = driver ? driver.split(" ")[0] : "The driver";

  async function save() {
    const v = purposeInput(taskId, now, choice, project);
    if ("error" in v) {
      setMsg({ tone: "bad", text: v.error });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const r = await transport.call<TripPurposeResult>("set_trip_purpose", v.input);
      const text = purposeDoneText(r);
      toast(text);
      setMsg({ tone: "ok", text });
      setProject("");
      void store.invalidate();
      await onSaved();
    } catch (e) {
      setMsg({ tone: "bad", text: errText(e as FleetError)[0] });
    }
    setBusy(false);
  }

  return (
    <div className="card card-b form" data-testid="trip-purpose">
      <h2>Driver-started trip</h2>
      <p className="muted small" style={{ margin: 0 }}>
        {who} started this trip in the app as <b>{PURPOSE_TEXT[now].toLowerCase()}</b>
        {now === "company" ? ` · charged to ${charged}` : ""}. Personal km are counted apart and never charged to a job.
      </p>
      {edits && (
        <>
          <div className="field">
            <span className="lab" id={`purpose-${taskId}`}>Company or personal</span>
            <div className="chips" role="group" aria-labelledby={`purpose-${taskId}`}>
              {(["company", "personal"] as const).map((p) => (
                <button key={p} type="button" className="chip" aria-pressed={choice === p} disabled={busy}
                  onClick={() => { setChoice(p); setMsg(null); if (p === "personal") setProject(""); }}>
                  {PURPOSE_TEXT[p]}
                </button>
              ))}
            </div>
          </div>
          {choice === "company" && (
            <div className="field">
              <label htmlFor={`trip-project-${taskId}`}>Attach a project</label>
              <input id={`trip-project-${taskId}`} value={project} maxLength={200} disabled={busy} onChange={(e) => { setProject(e.target.value); setMsg(null); }}
                placeholder="Job number, short name or name" />
              <span className="hint">The whole trip goes to it. Type internal for Fame internal.</span>
            </div>
          )}
          <div className="acts">
            <button type="button" className="btn dark" disabled={busy || (choice === now && !project.trim())} onClick={() => void save()}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </>
      )}
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
    </div>
  );
}
