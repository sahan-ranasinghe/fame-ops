// Import sites (/settings/import-sites, the vehicles permission, web build;
// Phase 6, Part 4): choose the operator's spreadsheet, pick its preset (Dialog
// site list, Mobitel 4G-LTE, Mobitel EP list), Preview the counts (read in the
// browser with SheetJS, nothing sent yet), Import in batches of 500 with a
// progress bar, then the report: added, updated, attached, unchanged, no pin,
// repaired and skipped rows with their reasons, downloadable as CSV.
import { PRESETS, type Preset, presetRows, type PresetResult } from "@fleet/sites";
import { useState } from "react";
import { Link } from "react-router";
import { useFleet } from "../../app/FleetContext";
import type { ImportAnswer } from "../../data/types";
import { num } from "../../lib/format";
import { errText } from "../../transport/errors";
import type { FleetError } from "../../transport/types";
import { Notice } from "../../ui/basics";
import { PageTop } from "../../ui/Page";

export const BATCH = 500;

interface Report {
  added: number;
  updated: number;
  attached: number;
  unchanged: number;
  no_pin: number;
  skipped: { row: string; reason: string }[];
}

/** The report's rows as CSV (the skipped and the repaired, with their reasons). */
export function reportCsv(preview: PresetResult, report: Report): string {
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const lines = ["what,row,reason"];
  for (const s of preview.skipped) lines.push(`skipped in the file,${s.row},${q(s.reason)}`);
  for (const r of preview.repaired) lines.push(`repaired,${r.row},${q(r.note)}`);
  for (const s of report.skipped) lines.push(`skipped on import,${s.row},${q(s.reason)}`);
  return lines.join("\n") + "\n";
}

export default function ImportSites() {
  const { transport } = useFleet();
  const [preset, setPreset] = useState<Preset>("dialog");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PresetResult | null>(null);
  const [sheetNote, setSheetNote] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function read() {
    if (!file) return;
    setErr(null);
    setReport(null);
    setPreview(null);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer());
      const want = PRESETS[preset].sheet;
      const name = wb.SheetNames.includes(want) ? want : wb.SheetNames.length === 1 ? wb.SheetNames[0] : null;
      if (!name) return setErr(`The file has no sheet called "${want}" (it has: ${wb.SheetNames.join(", ")}).`);
      setSheetNote(name === want ? `Sheet "${name}"` : `The only sheet, "${name}"`);
      const cells = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[name], { defval: null });
      setPreview(presetRows(preset, cells));
    } catch (e) {
      setErr(`The file could not be read: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function run() {
    if (!preview) return;
    const total: Report = { added: 0, updated: 0, attached: 0, unchanged: 0, no_pin: 0, skipped: [] };
    setErr(null);
    setProgress(0);
    try {
      for (let i = 0; i < preview.rows.length; i += BATCH) {
        const rows = preview.rows.slice(i, i + BATCH);
        const a = await transport.call<ImportAnswer>("import_places", { preset, rows });
        total.added += a.added;
        total.updated += a.updated;
        total.attached += a.attached;
        total.unchanged += a.unchanged ?? 0;
        total.no_pin += a.no_pin;
        for (const s of a.skipped ?? []) total.skipped.push({ row: `${i + s.row}`, reason: s.reason });
        setProgress(Math.min(preview.rows.length, i + BATCH));
      }
      setReport(total);
    } catch (e) {
      setErr(`Stopped at row ${(progress ?? 0) + 1}: ${errText(e as FleetError)[0]} The rows before it are saved; import the file again to finish (rows already there are updated, not doubled).`);
    } finally {
      setProgress(null);
    }
  }

  function download() {
    if (!preview || !report) return;
    const url = URL.createObjectURL(new Blob([reportCsv(preview, report)], { type: "text/csv" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `import-${preset}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="view" data-testid="import-sites">
      <PageTop title="Import sites" sub="Settings" backTo="/settings" />
      <form className="card card-b form" onSubmit={(e) => { e.preventDefault(); void read(); }}>
        <div className="grid2">
          <div className="field"><label htmlFor="is-preset">The list</label>
            <select id="is-preset" value={preset} onChange={(e) => { setPreset(e.target.value as Preset); setPreview(null); setReport(null); }}>
              {(Object.keys(PRESETS) as Preset[]).map((p) => <option key={p} value={p}>{PRESETS[p].label}</option>)}
            </select>
            <span className="sub">Sheet "{PRESETS[preset].sheet}": {PRESETS[preset].hint}</span></div>
          <div className="field"><label htmlFor="is-file">The spreadsheet</label>
            <input id="is-file" type="file" accept=".xlsx,.xls,.csv" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); setReport(null); }} /></div>
        </div>
        {preset === "mobitel_ep" && <span className="sub">Import the 4G-LTE list first: each EP id is attached to the Mobitel site within 100 m.</span>}
        <div className="acts"><button className="btn" type="submit" disabled={!file}>Preview</button></div>
      </form>
      {err && <Notice tone="bad">{err}</Notice>}
      {preview && (
        <div className="card card-b stack" data-testid="import-preview">
          <div className="sub">{sheetNote}</div>
          <dl className="kv">
            <div><dt>Rows read</dt><dd className="num">{num(preview.read)}</dd></div>
            <div><dt>Places</dt><dd className="num">{num(preview.rows.length)}</dd></div>
            <div><dt>With a pin</dt><dd className="num">{num(preview.with_pin)}</dd></div>
            <div><dt>Without a pin</dt><dd className="num">{num(preview.no_pin)}</dd></div>
            <div><dt>With an id</dt><dd className="num">{num(preview.rows.filter((r) => r.site_id).length)}</dd></div>
            <div><dt>Skipped in the file</dt><dd className="num">{num(preview.skipped.length)}</dd></div>
            <div><dt>Repaired</dt><dd className="num">{num(preview.repaired.length)}</dd></div>
          </dl>
          {preview.repaired.length > 0 && <div className="sub">{preview.repaired.slice(0, 5).map((r) => `Row ${r.row}: ${r.note}`).join(" · ")}</div>}
          <div className="acts">
            <button type="button" className="btn dark" disabled={progress !== null || preview.rows.length === 0} onClick={() => void run()}>Import {num(preview.rows.length)} places</button>
          </div>
          {progress !== null && (
            <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={preview.rows.length} aria-valuenow={progress}>
              <div style={{ width: `${Math.round((progress / Math.max(1, preview.rows.length)) * 100)}%` }} />
              <span className="sub">{num(progress)} of {num(preview.rows.length)}</span>
            </div>
          )}
        </div>
      )}
      {report && preview && (
        <div className="card card-b stack" data-testid="import-report">
          <h2>Imported</h2>
          <dl className="kv">
            <div><dt>Added</dt><dd className="num">{num(report.added)}</dd></div>
            <div><dt>Updated</dt><dd className="num">{num(report.updated)}</dd></div>
            {preset === "mobitel_ep" && <div><dt>Attached to a site</dt><dd className="num">{num(report.attached)}</dd></div>}
            {preset === "mobitel_ep" && <div><dt>Already there</dt><dd className="num">{num(report.unchanged)}</dd></div>}
            <div><dt>Added without a pin</dt><dd className="num">{num(report.no_pin)}</dd></div>
            <div><dt>Skipped</dt><dd className="num">{num(report.skipped.length + preview.skipped.length)}</dd></div>
          </dl>
          {report.skipped.slice(0, 5).map((s) => <div key={s.row} className="sub">Row {s.row}: {s.reason}</div>)}
          <div className="acts">
            <button type="button" className="btn" onClick={download}>Download the report (CSV)</button>
            <Link className="btn" to="/places?who=">Open Places</Link>
          </div>
        </div>
      )}
    </section>
  );
}
