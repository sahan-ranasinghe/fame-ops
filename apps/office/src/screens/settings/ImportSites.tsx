// Import sites (/settings/import-sites, the vehicles permission, web build;
// Phase 6, Parts 4 and 4b): any .xlsx, .xls or .csv. Pick a preset (the
// built-in Dialog, Mobitel 4G-LTE and Mobitel EP lists, or a mapping saved by
// name) or map the columns yourself: the sheet, the row with the column names,
// a drop-down per field (name required; latitude and longitude, or one "lat,
// lng" column; the operator as a column or one value). Preview reads the file in
// the browser (SheetJS) with the same engine the server's tests use
// (@fleet/sites): counts and the first 20 problem rows (outside Sri Lanka, an
// id twice, no name: skipped, never fatal; swapped coordinates repaired and
// said). Import sends batches of 500 with a progress bar and records the import
// (who, when, the file, the preset, the counts); the history below has "Undo
// this import" (added places switched off, updated ones put back, nothing
// deleted). "Save this mapping as a preset" keeps it for the next file.
import { FIELDS, type Field, headersAt, type Mapping, mappingProblems, mapTable, type Operator, type PresetResult } from "@fleet/sites";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useFleet } from "../../app/FleetContext";
import type { ImportAnswer, ImportPreset, PlaceImport, UndoAnswer } from "../../data/types";
import { num } from "../../lib/format";
import { errText } from "../../transport/errors";
import type { FleetError } from "../../transport/types";
import { Notice, Pill } from "../../ui/basics";
import { PageTop } from "../../ui/Page";
import { useToast } from "../../ui/Toast";
import { guessMapping, presetKeyFor, problemRows } from "./importLogic";

export const BATCH = 500;
const CUSTOM = "__custom__";

interface Report {
  import_id: string | null;
  added: number;
  updated: number;
  attached: number;
  unchanged: number;
  no_pin: number;
  skipped: { row: string; reason: string }[];
}

/** The report's rows as CSV (the problems in the file, the repairs, the rows the import skipped). */
export function reportCsv(preview: PresetResult, report: { skipped: { row: string; reason: string }[] }): string {
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const lines = ["what,row,reason"];
  for (const s of preview.skipped) lines.push(`skipped in the file,${s.row},${q(s.reason)}`);
  for (const r of preview.repaired) lines.push(`repaired,${r.row},${q(r.note)}`);
  for (const s of report.skipped) lines.push(`skipped on import,${s.row},${q(s.reason)}`);
  return lines.join("\n") + "\n";
}

type Workbook = { SheetNames: string[]; tables: Record<string, unknown[][]> };

export default function ImportSites() {
  const { transport } = useFleet();
  const toast = useToast();
  const [presets, setPresets] = useState<ImportPreset[]>([]);
  const [imports, setImports] = useState<PlaceImport[] | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [book, setBook] = useState<Workbook | null>(null);
  const [sheet, setSheet] = useState("");
  const [presetKey, setPresetKey] = useState<string>(CUSTOM);
  const [mapping, setMapping] = useState<Mapping>({ header_row: 1, columns: {}, operator: "other" });
  const [latlngMode, setLatlngMode] = useState<"two" | "one">("two");
  const [opMode, setOpMode] = useState<"fixed" | "column">("fixed");
  const [preview, setPreview] = useState<PresetResult | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saveName, setSaveName] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadLists() {
    try {
      const [p, i] = await Promise.all([
        transport.call<{ presets: ImportPreset[] }>("list_import_presets", {}),
        transport.call<{ imports: PlaceImport[] }>("list_place_imports", { limit: 20 }),
      ]);
      setPresets(p.presets);
      setImports(i.imports);
    } catch (e) {
      setErr(errText(e as FleetError)[0]);
    }
  }
  useEffect(() => { void loadLists(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const preset = presets.find((p) => p.key === presetKey) ?? null;
  const table = book && sheet ? book.tables[sheet] ?? [] : [];
  const headers = useMemo(() => headersAt(table, mapping.header_row), [table, mapping.header_row]);
  const problems = book ? mappingProblems(table, mapping) : [];
  const keyNow = presetKeyFor(preset, mapping);

  function applyPreset(key: string, wb: Workbook | null = book) {
    setPresetKey(key);
    setPreview(null);
    setReport(null);
    const p = presets.find((x) => x.key === key);
    if (p) {
      setMapping(p.mapping);
      if (wb && p.mapping.sheet && wb.SheetNames.includes(p.mapping.sheet)) setSheet(p.mapping.sheet);
      setLatlngMode(p.mapping.columns.latlng ? "one" : "two");
      setOpMode(p.mapping.columns.operator ? "column" : "fixed");
    } else if (wb) {
      const s = sheet && wb.SheetNames.includes(sheet) ? sheet : wb.SheetNames[0];
      const guessed = guessMapping(headersAt(wb.tables[s] ?? [], 1), 1);
      setMapping(guessed);
      setLatlngMode(guessed.columns.latlng ? "one" : "two");
      setOpMode(guessed.columns.operator ? "column" : "fixed");
    }
  }

  async function readFile(f: File | null) {
    setFile(f);
    setBook(null);
    setPreview(null);
    setReport(null);
    setErr(null);
    if (!f) return;
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await f.arrayBuffer());
      const tables: Record<string, unknown[][]> = {};
      for (const name of wb.SheetNames) tables[name] = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: null, raw: true, blankrows: true });
      const loaded = { SheetNames: wb.SheetNames, tables };
      setBook(loaded);
      // A preset whose sheet is in this file is chosen for it; else the first sheet, mapped by guess.
      const match = presets.find((p) => p.mapping.sheet && wb.SheetNames.includes(p.mapping.sheet));
      setSheet(match?.mapping.sheet ?? wb.SheetNames[0]);
      applyPreset(match ? match.key : CUSTOM, loaded);
    } catch (e) {
      setErr(`The file could not be read: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const setColumn = (field: Field, header: string) => {
    setPreview(null);
    setMapping((m) => ({ ...m, columns: { ...m.columns, [field]: header || undefined } }));
  };

  async function run() {
    if (!preview || !file) return;
    const total: Report = { import_id: null, added: 0, updated: 0, attached: 0, unchanged: 0, no_pin: 0, skipped: [] };
    setErr(null);
    setProgress(0);
    try {
      for (let i = 0; i < preview.rows.length; i += BATCH) {
        const rows = preview.rows.slice(i, i + BATCH);
        const a = await transport.call<ImportAnswer>("import_places", {
          preset: keyNow.key, rows,
          ...(total.import_id ? { import_id: total.import_id } : { file_name: file.name.slice(0, 200), preset_label: keyNow.label.slice(0, 120) }),
          ...(mapping.attach_within_m && keyNow.key !== "mobitel_ep" ? { attach_within_m: mapping.attach_within_m } : {}),
        });
        total.import_id = a.import_id;
        total.added += a.added;
        total.updated += a.updated;
        total.attached += a.attached;
        total.unchanged += a.unchanged ?? 0;
        total.no_pin += a.no_pin;
        for (const s of a.skipped ?? []) total.skipped.push({ row: `${i + s.row}`, reason: s.reason });
        setProgress(Math.min(preview.rows.length, i + BATCH));
      }
      setReport(total);
      void loadLists();
    } catch (e) {
      setErr(`Stopped: ${errText(e as FleetError)[0]} The rows before it are saved and recorded; import the file again to finish (rows already there are updated, not doubled).`);
      setReport(total.import_id ? total : null);
      void loadLists();
    } finally {
      setProgress(null);
    }
  }

  async function saveMapping() {
    if (!saveName.trim()) return;
    setBusy(true);
    try {
      const { special: _special, ...rest } = mapping;
      const r = await transport.call<{ key: string; name: string; replaced: boolean }>("save_import_preset", { name: saveName.trim(), mapping: { ...rest, sheet: sheet || undefined } });
      toast(r.replaced ? `Mapping "${r.name}" replaced` : `Mapping "${r.name}" saved`);
      await loadLists();
      setPresetKey(r.key);
      setSaveName("");
    } catch (e) {
      setErr(errText(e as FleetError)[0]);
    } finally {
      setBusy(false);
    }
  }

  async function undo(i: PlaceImport) {
    if (!window.confirm(`Undo the import of ${i.file ?? "this list"} (${i.at})? The places it added are switched off, the ones it changed are put back. Nothing is deleted.`)) return;
    setBusy(true);
    try {
      const r = await transport.call<UndoAnswer>("undo_place_import", { import_id: i.id });
      toast(`Undone: ${r.switched_off} switched off, ${r.restored} put back${r.left_as_is ? `, ${r.left_as_is} changed since and left as they are` : ""}`);
      await loadLists();
    } catch (e) {
      setErr(errText(e as FleetError)[0]);
    } finally {
      setBusy(false);
    }
  }

  function download() {
    if (!preview || !report) return;
    const url = URL.createObjectURL(new Blob([reportCsv(preview, report)], { type: "text/csv" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `import-${keyNow.key.replace(/[^a-z0-9_-]/gi, "-")}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  }

  const shown = preview ? problemRows(preview.skipped, preview.repaired) : [];
  const special = mapping.special === "mobitel_4g";
  return (
    <section className="view" data-testid="import-sites">
      <PageTop title="Import sites" sub="Settings" backTo="/settings" />
      <div className="card card-b form">
        <div className="grid2">
          <div className="field"><label htmlFor="is-file">The spreadsheet</label>
            <input id="is-file" type="file" accept=".xlsx,.xls,.csv" onChange={(e) => void readFile(e.target.files?.[0] ?? null)} /></div>
          <div className="field"><label htmlFor="is-preset">The preset</label>
            <select id="is-preset" value={presetKey} onChange={(e) => applyPreset(e.target.value)}>
              {presets.map((p) => <option key={p.key} value={p.key}>{p.name}{p.built_in ? "" : " (saved mapping)"}</option>)}
              <option value={CUSTOM}>Map the columns myself</option>
            </select></div>
        </div>
        {preset?.key === "mobitel_ep" && <span className="sub">Import the 4G-LTE list first: each EP id is attached to the Mobitel site within 100 m.</span>}
      </div>

      {book && (
        <div className="card card-b form" data-testid="import-mapping">
          <h2>Which column is which</h2>
          <div className="grid2">
            <div className="field"><label htmlFor="is-sheet">Sheet</label>
              <select id="is-sheet" value={sheet} onChange={(e) => { setSheet(e.target.value); setPreview(null); }}>
                {book.SheetNames.map((n) => <option key={n} value={n}>{n} ({num(Math.max(0, (book.tables[n]?.length ?? 0)))} rows)</option>)}
              </select></div>
            <div className="field"><label htmlFor="is-header">Row with the column names</label>
              <input id="is-header" type="number" min={1} max={100} value={mapping.header_row} onChange={(e) => { setPreview(null); setMapping({ ...mapping, header_row: Math.max(1, Math.min(100, Number(e.target.value) || 1)) }); }} />
              <span className="sub">{headers.filter(Boolean).slice(0, 6).join(" · ") || "That row is empty."}</span></div>
          </div>
          {special && <span className="sub">Mobitel 4G-LTE keeps its own rule: the code and the place are read from the site name, one place per coordinate.</span>}
          <div className="grid2">
            {FIELDS.filter((f) => !["lat", "lng", "latlng", "operator"].includes(f.key)).map((f) => (
              <div className="field" key={f.key}><label htmlFor={`is-col-${f.key}`}>{f.label}</label>
                <select id={`is-col-${f.key}`} value={mapping.columns[f.key] ?? ""} onChange={(e) => setColumn(f.key, e.target.value)}>
                  <option value="">—</option>
                  {headers.map((h, i) => h ? <option key={`${h}-${i}`} value={h}>{h}</option> : null)}
                </select></div>
            ))}
          </div>
          <div className="field"><span className="lab">Coordinates</span>
            <div className="chips">
              <label className="check"><input type="radio" name="is-ll" checked={latlngMode === "two"} onChange={() => { setLatlngMode("two"); setColumn("latlng", ""); }} /> Two columns</label>
              <label className="check"><input type="radio" name="is-ll" checked={latlngMode === "one"} onChange={() => { setLatlngMode("one"); setMapping((m) => ({ ...m, columns: { ...m.columns, lat: undefined, lng: undefined } })); }} /> One "lat, lng" column</label>
            </div></div>
          <div className="grid2">
            {(latlngMode === "two" ? (["lat", "lng"] as Field[]) : (["latlng"] as Field[])).map((k) => (
              <div className="field" key={k}><label htmlFor={`is-col-${k}`}>{FIELDS.find((f) => f.key === k)?.label}</label>
                <select id={`is-col-${k}`} value={mapping.columns[k] ?? ""} onChange={(e) => setColumn(k, e.target.value)}>
                  <option value="">—</option>
                  {headers.map((h, i) => h ? <option key={`${h}-${i}`} value={h}>{h}</option> : null)}
                </select></div>
            ))}
          </div>
          <div className="grid2">
            <div className="field"><span className="lab">Operator</span>
              <div className="chips">
                <label className="check"><input type="radio" name="is-op" checked={opMode === "fixed"} onChange={() => { setOpMode("fixed"); setMapping((m) => ({ ...m, operator: m.operator ?? "other", columns: { ...m.columns, operator: undefined } })); }} /> One value</label>
                <label className="check"><input type="radio" name="is-op" checked={opMode === "column"} onChange={() => { setOpMode("column"); setMapping((m) => ({ ...m, operator: undefined })); }} /> From a column</label>
              </div></div>
            {opMode === "fixed" ? (
              <div className="field"><label htmlFor="is-op-value">Every row is</label>
                <select id="is-op-value" value={mapping.operator ?? "other"} onChange={(e) => { setPreview(null); setMapping({ ...mapping, operator: e.target.value as Operator }); }}>
                  <option value="dialog">Dialog</option><option value="mobitel">Mobitel</option><option value="other">Our own place (not an operator's)</option>
                </select></div>
            ) : (
              <div className="field"><label htmlFor="is-col-operator">Operator column</label>
                <select id="is-col-operator" value={mapping.columns.operator ?? ""} onChange={(e) => setColumn("operator", e.target.value)}>
                  <option value="">—</option>
                  {headers.map((h, i) => h ? <option key={`${h}-${i}`} value={h}>{h}</option> : null)}
                </select></div>
            )}
          </div>
          <div className="field"><label htmlFor="is-attach">Attach each id to a site within (m) — optional, like the Mobitel EP list</label>
            <input id="is-attach" type="number" min={1} max={1000} placeholder="off" value={mapping.attach_within_m ?? ""} onChange={(e) => { setPreview(null); setMapping({ ...mapping, attach_within_m: e.target.value ? Math.max(1, Math.min(1000, Number(e.target.value))) : undefined }); }} /></div>
          {problems.length > 0 && <Notice tone="bad">{problems.join(" ")}</Notice>}
          <div className="acts">
            <button type="button" className="btn dark" disabled={problems.length > 0} onClick={() => { setReport(null); setPreview(mapTable(table, mapping)); }}>Preview</button>
            <span className="sub">Will be recorded as: {keyNow.label}</span>
          </div>
          {!special && (
            <div className="acts" data-testid="save-mapping">
              <input aria-label="Name for this mapping" placeholder="Name for this mapping, e.g. Hutch sites" maxLength={80} value={saveName} onChange={(e) => setSaveName(e.target.value)} style={{ maxWidth: 280 }} />
              <button type="button" className="btn" disabled={busy || !saveName.trim() || problems.length > 0} onClick={() => void saveMapping()}>Save this mapping as a preset</button>
            </div>
          )}
        </div>
      )}

      {err && <Notice tone="bad">{err}</Notice>}
      {preview && (
        <div className="card card-b stack" data-testid="import-preview">
          <dl className="kv">
            <div><dt>Rows read</dt><dd className="num">{num(preview.read)}</dd></div>
            <div><dt>Places</dt><dd className="num">{num(preview.rows.length)}</dd></div>
            <div><dt>With a pin</dt><dd className="num">{num(preview.with_pin)}</dd></div>
            <div><dt>Without a pin</dt><dd className="num">{num(preview.no_pin)}</dd></div>
            <div><dt>With an id</dt><dd className="num">{num(preview.rows.filter((r) => r.site_id).length)}</dd></div>
            <div><dt>Problem rows (skipped)</dt><dd className="num">{num(preview.skipped.length)}</dd></div>
            <div><dt>Repaired</dt><dd className="num">{num(preview.repaired.length)}</dd></div>
          </dl>
          {shown.length > 0 && (
            <div className="tbl-wrap" data-testid="problem-rows">
              <table>
                <thead><tr><th>Row</th><th>What</th></tr></thead>
                <tbody>{shown.map((p, i) => <tr key={i}><td className="mono">{p.row}</td><td>{p.repaired ? <Pill tone="warn">repaired</Pill> : <Pill tone="bad">skipped</Pill>} {p.text}</td></tr>)}</tbody>
              </table>
              {preview.skipped.length + preview.repaired.length > shown.length && <div className="sub">The first {shown.length}; the CSV after the import lists them all.</div>}
            </div>
          )}
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
            {report.attached > 0 && <div><dt>Attached to a site</dt><dd className="num">{num(report.attached)}</dd></div>}
            {report.unchanged > 0 && <div><dt>Already there</dt><dd className="num">{num(report.unchanged)}</dd></div>}
            <div><dt>Added without a pin</dt><dd className="num">{num(report.no_pin)}</dd></div>
            <div><dt>Skipped</dt><dd className="num">{num(report.skipped.length + preview.skipped.length)}</dd></div>
          </dl>
          <div className="acts">
            <button type="button" className="btn" onClick={download}>Download the report (CSV)</button>
            <Link className="btn" to="/places">Open Places</Link>
          </div>
        </div>
      )}

      <div className="card card-b stack" data-testid="import-history">
        <h2>Imports</h2>
        {imports === null ? <div className="sub">Loading…</div> : imports.length === 0 ? <div className="sub">No import yet.</div> : (
          <div className="tbl-wrap">
            <table>
              <thead><tr><th>When</th><th>Who</th><th>File · preset</th><th>Added</th><th>Updated</th><th>Skipped</th><th></th></tr></thead>
              <tbody>
                {imports.map((i) => (
                  <tr key={i.id} data-testid="import-row">
                    <td className="mono">{i.at}</td>
                    <td>{i.by}</td>
                    <td>{i.file ?? "—"}<div className="sub">{i.preset}</div></td>
                    <td className="num">{num(i.added)}</td>
                    <td className="num">{num(i.updated + (i.attached ?? 0))}</td>
                    <td className="num">{num(i.skipped ?? 0)}</td>
                    <td>{i.undone
                      ? <span className="sub">Undone {i.undone.at}{i.undone.by ? ` by ${i.undone.by}` : ""}{i.undone.left_as_is ? ` · ${i.undone.left_as_is} left as they were` : ""}</span>
                      : <button type="button" className="btn small" disabled={busy} onClick={() => void undo(i)}>Undo this import</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
