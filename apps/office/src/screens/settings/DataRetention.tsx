// Settings → Data retention (/settings/retention, the users permission; Round 4–7, item 9, docs/phase8-plan.md §33.8):
// Slack's and Google Workspace's retention settings. One table: each kind of data, how long it is kept (days, the minimum
// shown and checked before Save, saved through update_settings `retention`) and what the next run removes (before which
// day); fuel videos' months on the same table (their own setting). Under it "Never removed: …" (the preview's list) and
// Run now: the first press asks retention_preview (the counts, nothing removed), the second ("Remove N now") runs
// run_retention {confirm: true} and shows its line. The job also runs every night at 02:45. Rules: retentionLogic.ts.
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useFleet } from "../../app/FleetContext";
import type { RetentionDays, RetentionPreview, RetentionRun, SettingsResult } from "../../data/types";
import { useQuery } from "../../data/useQuery";
import { today } from "../../lib/format";
import { errText } from "../../transport/errors";
import type { FleetError } from "../../transport/types";
import { Notice, Pill } from "../../ui/basics";
import { dayText } from "../../ui/dateRange";
import { SkeletonRows } from "../../ui/ListKit";
import { PageTop } from "../../ui/Page";
import { useToast } from "../../ui/Toast";
import {
  daysInput, daysText, firstKeptDay, minimumOf, nightlyTime, periodsOf, previewLines, RETENTION_ROWS, type RetentionKey, removeLabel, savedText,
  withPeriod,
} from "./retentionLogic";

type RunState =
  | { step: "idle" }
  | { step: "checking" }
  | { step: "preview"; preview: RetentionPreview }
  | { step: "removing"; preview: RetentionPreview }
  | { step: "done"; run: RetentionRun };

export default function DataRetention() {
  const { me, transport } = useFleet();
  const toast = useToast();
  const settings = useQuery<SettingsResult>("settings", "get_settings", {}, { enabled: me.tools.includes("get_settings"), onWrite: false });
  const canEdit = me.tools.includes("update_settings");
  const canRun = me.tools.includes("retention_preview") && me.tools.includes("run_retention");
  // The preview on opening the page: the minimums, what is never removed and the nightly time (its counts wait for Run now).
  const [about, setAbout] = useState<RetentionPreview | null>(null);
  const [aboutErr, setAboutErr] = useState<string | null>(null);
  const [aboutTry, setAboutTry] = useState(0);
  // The periods as last saved here (an answer from the server replaces them): the next save starts from them.
  const [saved, setSaved] = useState<RetentionDays | null>(null);
  const [typed, setTyped] = useState<Partial<Record<RetentionKey, string>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [rowErr, setRowErr] = useState<Partial<Record<RetentionKey | "fuel", string>>>({});
  const [run, setRun] = useState<RunState>({ step: "idle" });
  const [runErr, setRunErr] = useState<string | null>(null);
  // Mounted: set again in the effect's body, so React's StrictMode remount in development (unmount, mount again) leaves it
  // true; set only once, Save stayed "Saving…" and Run now "Checking…" on `npm run dev`.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    if (!me.tools.includes("retention_preview")) return;
    let on = true;
    transport.call<RetentionPreview>("retention_preview", {})
      .then((p) => { if (on) { setAbout(p); setAboutErr(null); } })
      .catch((e) => { if (on) setAboutErr(errText(e as FleetError)[0]); });
    return () => { on = false; };
  }, [transport, me.tools, aboutTry]);

  const s = settings.data?.settings;
  const periods = saved ?? periodsOf(s?.retention ?? about?.periods);
  const minimums = about?.minimums;
  const at = nightlyTime(about?.nightly);
  const loading = !settings.data && !settings.err && !about;
  const day = today();

  async function savePeriod(key: RetentionKey, ev: FormEvent) {
    ev.preventDefault();
    const v = daysInput(typed[key] ?? String(periods[key]), minimumOf(key, minimums));
    if ("error" in v) return setRowErr((r) => ({ ...r, [key]: v.error }));
    const next = withPeriod(periods, key, v.days);
    setBusy(key);
    setRowErr((r) => ({ ...r, [key]: undefined }));
    try {
      // Only the period that changed: the server keeps the others as stored (two people editing two periods both win).
      await transport.call("update_settings", { key: "retention", value: { [key]: v.days } });
      if (!alive.current) return;
      setSaved(next);
      setTyped((t) => ({ ...t, [key]: undefined }));
      toast(savedText(key, v.days));
      settings.refetch();
    } catch (e) {
      if (alive.current) setRowErr((r) => ({ ...r, [key]: errText(e as FleetError)[0] }));
    } finally {
      if (alive.current) setBusy(null);
    }
  }

  async function saveFuel(months: 6 | 12) {
    setBusy("fuel");
    setRowErr((r) => ({ ...r, fuel: undefined }));
    try {
      await transport.call("update_settings", { key: "fuel_video_keep_months", value: months });
      if (!alive.current) return;
      toast(`Fuel videos: kept ${months} months`);
      settings.refetch();
    } catch (e) {
      if (alive.current) setRowErr((r) => ({ ...r, fuel: errText(e as FleetError)[0] }));
    } finally {
      if (alive.current) setBusy(null);
    }
  }

  async function check() {
    setRun({ step: "checking" });
    setRunErr(null);
    try {
      const p = await transport.call<RetentionPreview>("retention_preview", {});
      if (!alive.current) return;
      setAbout(p);
      setRun({ step: "preview", preview: p });
    } catch (e) {
      if (!alive.current) return;
      setRun({ step: "idle" });
      setRunErr(errText(e as FleetError)[0]);
    }
  }

  async function remove(preview: RetentionPreview) {
    setRun({ step: "removing", preview });
    setRunErr(null);
    try {
      const r = await transport.call<RetentionRun>("run_retention", { confirm: true });
      if (!alive.current) return;
      setRun({ step: "done", run: r });
      toast("Old data removed");
    } catch (e) {
      if (!alive.current) return;
      setRun({ step: "preview", preview });
      setRunErr(errText(e as FleetError)[0]);
    }
  }

  const fuelMonths = s?.fuel_video_keep_months ?? 12;
  return (
    <section className="view" data-testid="data-retention">
      <PageTop title="Data retention" sub="Settings" backTo="/settings" />
      <p className="muted" style={{ marginTop: 0 }}>
        How long each kind of data is kept. Anything older is removed every night at <span className="mono">{at}</span>. Business records are never removed.
      </p>
      {loading && <SkeletonRows rows={6} label="Loading the periods…" lines={1} />}
      {settings.err && !settings.data && !about && (
        <Notice tone="bad" action={<button type="button" className="btn small" onClick={() => { settings.refetch(); setAboutTry((n) => n + 1); }}>Try again</button>}>{errText(settings.err)[0]}</Notice>
      )}
      {!loading && (settings.data || about) && (
        <div className="stack">
          <div className="card">
            <div className="tbl-wrap">
              <table data-testid="retention-table">
                <thead><tr><th>What</th><th>Kept</th><th>Removed</th></tr></thead>
                <tbody>
                  {RETENTION_ROWS.map((row) => {
                    const min = minimumOf(row.key, minimums);
                    const text = typed[row.key] ?? String(periods[row.key]);
                    const check = daysInput(text, min);
                    const changed = text.trim() !== String(periods[row.key]);
                    const problem = changed && "error" in check ? check.error : rowErr[row.key];
                    return (
                      <tr key={row.key} data-testid={`retention-row-${row.key}`}>
                        <td data-label="What">
                          <div><b>{row.what}</b>{row.note && <div className="sub">{row.note}</div>}</div>
                        </td>
                        <td data-label="Kept">
                          {canEdit ? (
                            <form className="retention-days" onSubmit={(ev) => void savePeriod(row.key, ev)} noValidate>
                              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                                <input aria-label={`${row.what}: days kept`} className="mono" type="text" inputMode="numeric" maxLength={4} style={{ width: 80 }}
                                  value={text} disabled={busy !== null} onChange={(e) => setTyped((t) => ({ ...t, [row.key]: e.target.value.replace(/[^\d]/g, "") }))} />
                                <span className="muted">days</span>
                                {changed && <button className="btn small dark" type="submit" disabled={busy !== null || "error" in check}>{busy === row.key ? "Saving…" : "Save"}</button>}
                              </div>
                              {min > 1 && <div className="hint">At least {daysText(min)}</div>}
                              {problem && <div className="sub bad-text" role="alert">{problem}</div>}
                            </form>
                          ) : (
                            <span className="mono">{daysText(periods[row.key])}</span>
                          )}
                        </td>
                        <td data-label="Removed">
                          {row.key === "drafts_days"
                            ? <span className="sub">When opened, on the browser or phone</span>
                            : <span className="sub">Before {dayText(firstKeptDay(day, Number(changed && !("error" in check) ? check.days : periods[row.key])), true)}</span>}
                        </td>
                      </tr>
                    );
                  })}
                  <tr data-testid="retention-row-fuel">
                    <td data-label="What"><div><b>Fuel videos</b><div className="sub">The video files; the fuel entries stay</div></div></td>
                    <td data-label="Kept">
                      {canEdit ? (
                        <div>
                          <select aria-label="Fuel videos: months kept" value={String(fuelMonths)} disabled={busy !== null || !settings.data}
                            onChange={(e) => void saveFuel(Number(e.target.value) as 6 | 12)}>
                            <option value="12">12 months</option>
                            <option value="6">6 months</option>
                          </select>
                          {rowErr.fuel && <div className="sub bad-text" role="alert">{rowErr.fuel}</div>}
                        </div>
                      ) : <span className="mono">{fuelMonths} months</span>}
                    </td>
                    <td data-label="Removed"><span className="sub">Once a month, the oldest first</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {about?.never && about.never.length > 0 && (
            <Notice tone="info"><b>Never removed:</b> {about.never.join(", ")}.</Notice>
          )}

          {canRun && (
            <div className="card card-b form" data-testid="retention-run">
              <h2 style={{ margin: 0 }}>Run now</h2>
              <p className="muted small" style={{ margin: 0 }}>
                The job runs every night at <span className="mono">{at}</span>. Run now first shows what it would remove; nothing goes until you press Remove.
              </p>
              {aboutErr && !about && <Notice tone="bad" action={<button type="button" className="btn small" onClick={() => setAboutTry((n) => n + 1)}>Try again</button>}>{aboutErr}</Notice>}
              {(run.step === "preview" || run.step === "removing") && <PreviewList preview={run.preview} />}
              {run.step === "done" && (
                <Notice tone="ok">
                  <span data-testid="retention-result">{run.run.line}.</span>
                  {run.run.summarised > 0 && <> {run.run.summarised.toLocaleString("en-US")} driver days kept as summaries.</>}
                </Notice>
              )}
              {runErr && <Notice tone="bad">{runErr}</Notice>}
              <div className="acts">
                {(run.step === "idle" || run.step === "checking" || run.step === "done") && (
                  <button type="button" className="btn" data-testid="retention-check" disabled={run.step === "checking"} onClick={() => void check()}>
                    {run.step === "checking" ? "Checking…" : "Run now"}
                  </button>
                )}
                {(run.step === "preview" || run.step === "removing") && previewLines(run.preview).total > 0 && (
                  <button type="button" className="btn danger" data-testid="retention-remove" disabled={run.step === "removing"} onClick={() => void remove(run.preview)}>
                    {run.step === "removing" ? "Removing…" : removeLabel(previewLines(run.preview).total)}
                  </button>
                )}
                {(run.step === "preview" || run.step === "removing") && (
                  <button type="button" className="btn" disabled={run.step === "removing"} onClick={() => setRun({ step: "idle" })}>{previewLines(run.preview).total > 0 ? "Cancel" : "Close"}</button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** What a run would remove now, by kind (the server's words), or that nothing is old enough. */
function PreviewList({ preview }: { preview: RetentionPreview }) {
  const { lines, total } = previewLines(preview);
  if (total === 0) return <Notice tone="info"><span data-testid="retention-nothing">Nothing is old enough to remove.</span></Notice>;
  return (
    <div data-testid="retention-preview">
      <div className="sub">Would remove now (nothing is removed yet):</div>
      <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
        {lines.map((l) => (
          <li key={l.key} data-testid="retention-preview-line">
            <span className="mono">{l.count.toLocaleString("en-US")}</span> {l.what} <span className="muted">older than {daysText(l.days)}</span>
          </li>
        ))}
      </ul>
      <div style={{ marginTop: 6 }}><Pill tone="warn">{total.toLocaleString("en-US")} in all</Pill></div>
    </div>
  );
}
