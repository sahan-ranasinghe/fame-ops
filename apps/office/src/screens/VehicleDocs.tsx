// A vehicle's documents (Phase 7, §28), on its page and on Register vehicle
// after the first save: one row per kind (revenue licence, insurance, emission
// test, CR, the rent or lease agreement of a rented vehicle, each Other, and a
// row to add another), each with the file's type, the expiry where one applies
// (an input: the vehicle's own date, which the chips and reminders follow),
// "Uploaded by Palitha 14 Oct 10:05", View (a link that works for at least an
// hour, in a new tab), Replace and Remove (a second step on the page itself).
// Removed documents (removed or replaced) are listed with Restore. Upload: a
// photo (made a 2000 px JPEG in the browser) or a PDF, up to 10 MB, through a
// signed upload (the web app only), then save_vehicle_document. Reading the
// files needs vehicle_documents (the vehicles permission); nothing is deleted.
import { useState } from "react";
import { useFleet } from "../app/FleetContext";
import type { DocKind, UploadTicket, VehicleDocument, VehicleDocuments } from "../data/types";
import { useQuery } from "../data/useQuery";
import { today } from "../lib/format";
import { asFleetError, errText } from "../transport/errors";
import { Notice, Pill } from "../ui/basics";
import { documentPhoto } from "./imageCanvas";
import {
  byWhenText, DOC_LABEL, DOC_WORDS, docActions, type DocActions, docFileKind, type DocRow, documentRows, EXPIRY_FIELD, expiryText,
  fileTypeText, MAX_DOC_BYTES, megabytes, saveDocInput,
} from "./mediaLogic";
import { FilePick } from "./PhotoUpload";
import { DateField } from "../ui/DayPicker";
import { SkeletonRows } from "../ui/ListKit";

/** The links last at least an hour: fetched again well before that while the page stays open. */
const DOCS_EVERY_MS = 20 * 60_000;
const ACCEPT = "image/*,application/pdf";

type Msg = { tone: "ok" | "bad"; text: string } | null;

export function VehicleDocumentsSection({ reg, rented, dates = {} }: {
  reg: string;
  /** A rental company is set: the rent or lease agreement is one of its papers. */
  rented: boolean;
  /** The vehicle's own dates (the chips), the expiry inputs' start when no document carries one yet. */
  dates?: Partial<Record<DocKind, string>>;
}) {
  const { me, files } = useFleet();
  const allowed = me.tools.includes("vehicle_documents");
  const q = useQuery<VehicleDocuments>("vehicleDocs", "vehicle_documents", { vehicle: reg, removed: true }, { every: DOCS_EVERY_MS, enabled: allowed });
  if (!allowed) return null;
  const acts = docActions(me.tools, !!files);
  const rows = documentRows(q.data, { rented });
  const removed = q.data?.removed ?? [];
  const year = today().slice(0, 4);
  return (
    <div className="card card-b form" data-testid="vehicle-documents">
      <div className="docs-h">
        <h2>Documents</h2>
        {q.data?.missing_text && <span className="doc" data-testid="docs-missing">Missing: {q.data.missing_text}</span>}
      </div>
      {acts.upload && <p className="hint" style={{ margin: 0 }}>A photo or a PDF, up to 10 MB. Set the expiry date before you upload or replace the file: it is the vehicle's date too.</p>}
      {q.loading && <SkeletonRows rows={3} label="Loading the documents…" />}
      {q.err && !q.data && <Notice tone="bad">{errText(q.err)[0]}</Notice>}
      {q.data && (
        <div className="doc-rows">
          {rows.filter((r) => r.doc || r.kind !== "other" || acts.upload).map((r) => (
            <DocRowView key={r.key} row={r} reg={reg} acts={acts} year={year} date={r.doc?.expiry ?? dates[r.kind] ?? ""} />
          ))}
        </div>
      )}
      {removed.length > 0 && (
        <div className="form" data-testid="removed-documents">
          <div className="section-t">Removed documents</div>
          <div className="doc-rows">
            {removed.map((d) => <RemovedRow key={d.id} d={d} acts={acts} year={year} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function DocRowView({ row, reg, acts, year, date: startDate }: { row: DocRow; reg: string; acts: DocActions; year: string; date: string }) {
  const { transport, store, files } = useFleet();
  const doc = row.doc;
  const adding = row.key === "other:new";
  // The typed date, until it is saved (null = the document's or the vehicle's date, followed as answers come).
  const [typed, setTyped] = useState<string | null>(null);
  const date = typed ?? startDate;
  const [name, setName] = useState("");
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState<"" | "upload" | "date" | "remove">("");
  const [msg, setMsg] = useState<Msg>(null);
  const field = EXPIRY_FIELD[row.kind];
  const dateChanged = !!field && !!date && date !== startDate;

  async function upload(file: File) {
    if (!files) return;
    const check = docFileKind(file);
    if ("error" in check) {
      setMsg({ tone: "bad", text: check.error });
      return;
    }
    if (adding && !name.trim()) {
      setMsg({ tone: "bad", text: "Name the document first (e.g. Fitness certificate)." });
      return;
    }
    setBusy("upload");
    setMsg(null);
    try {
      const body: Blob = check.kind === "pdf" ? file : await documentPhoto(file);
      const type = check.kind === "pdf" ? "application/pdf" : "image/jpeg";
      if (body.size > MAX_DOC_BYTES) throw { code: "too_big", message: `This file is ${megabytes(body.size)}: a document can be up to 10 MB.` };
      const { upload: ticket } = await transport.call<{ upload: UploadTicket }>("vehicle_document_upload_url", { vehicle: reg, kind: row.kind, content_type: type, bytes: body.size });
      await files.upload(ticket, body, type);
      await transport.call("save_vehicle_document", saveDocInput({ vehicle: reg, kind: row.kind, path: ticket.path, contentType: type, bytes: body.size, expiry: date, name }));
      setMsg({ tone: "ok", text: doc ? "Replaced. The old file is under Removed documents." : "Saved." });
      setTyped(null);
      setName("");
      void store.invalidate();
    } catch (e) {
      setMsg({ tone: "bad", text: errText(asFleetError(e))[0] });
    }
    setBusy("");
  }

  async function saveDate() {
    if (!field) return;
    setBusy("date");
    setMsg(null);
    try {
      await transport.call("update_vehicle", { reg_no: reg, [field]: date });
      setMsg({ tone: "ok", text: "Date saved." });
      setTyped(null);
      void store.invalidate();
    } catch (e) {
      setMsg({ tone: "bad", text: errText(asFleetError(e))[0] });
    }
    setBusy("");
  }

  async function remove() {
    if (!doc) return;
    setBusy("remove");
    setMsg(null);
    try {
      await transport.call("remove_vehicle_document", { id: doc.id });
      setArmed(false);
      void store.invalidate();
    } catch (e) {
      setMsg({ tone: "bad", text: errText(asFleetError(e))[0] });
    }
    setBusy("");
  }

  const kindWords = row.kind === "other" ? `“${row.label}”` : `the ${DOC_WORDS[row.kind]}`;
  return (
    <div className="doc-row" data-testid={`doc-${row.key}`}>
      <div className="doc-row-h">
        <b>{row.label}</b>
        {doc ? <span className="doc">{fileTypeText(doc.content_type)}{doc.bytes ? ` · ${megabytes(doc.bytes)}` : ""}</span>
          : !adding && <span className={`doc${row.missing ? " nofile" : ""}`}>No document</span>}
      </div>
      {doc && <div className="sub">{byWhenText("Uploaded", doc.uploaded, year)}</div>}
      {adding && acts.upload && (
        <div className="field"><label htmlFor="doc-name-new">What it is</label><input id="doc-name-new" maxLength={80} placeholder="e.g. Fitness certificate" value={name} onChange={(e) => setName(e.target.value)} /></div>
      )}
      {row.expires && (acts.upload || acts.saveDate
        ? (
          <div className="doc-date">
            <label htmlFor={`doc-exp-${row.key}`}>Expires</label>
            <DateField id={`doc-exp-${row.key}`} label="Expires" value={date} onChange={setTyped} />
            {dateChanged && acts.saveDate && <button type="button" className="btn small dark" disabled={!!busy} onClick={() => void saveDate()}>{busy === "date" ? "Saving…" : "Save date"}</button>}
          </div>
        )
        : date ? <div className="sub">{expiryText(date)}</div> : null)}
      <div className="acts">
        {doc?.url && <a className="btn small" href={doc.url} target="_blank" rel="noopener">View</a>}
        {acts.upload && (!doc || row.kind !== "other") && (
          <FilePick className="btn small" label={doc ? "Replace" : adding ? "Upload a document" : "Upload"} busy={busy === "upload"} accept={ACCEPT} onFile={(f) => void upload(f)} />
        )}
        {doc && acts.remove && !armed && <button type="button" className="btn small" disabled={!!busy} onClick={() => { setArmed(true); setMsg(null); }}>Remove</button>}
      </div>
      {doc && armed && (
        <div className="confirm" data-testid="doc-remove-confirm">
          <div>
            <b>Remove {kindWords}?</b>
            <p className="muted small" style={{ margin: "4px 0 0" }}>It moves to Removed documents and can be restored. The vehicle's date stays as it is.</p>
          </div>
          <div className="acts">
            <button type="button" className="btn danger" disabled={!!busy} onClick={() => void remove()}>{busy === "remove" ? "Removing…" : "Remove"}</button>
            <button type="button" className="btn" disabled={!!busy} onClick={() => setArmed(false)}>Keep it</button>
          </div>
        </div>
      )}
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
    </div>
  );
}

function RemovedRow({ d, acts, year }: { d: VehicleDocument; acts: DocActions; year: string }) {
  const { transport, store } = useFleet();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function restore() {
    setBusy(true);
    setMsg(null);
    try {
      await transport.call("restore_vehicle_document", { id: d.id });
      void store.invalidate();
    } catch (e) {
      setMsg(errText(asFleetError(e))[0]);
    }
    setBusy(false);
  }

  return (
    <div className="doc-row removed" data-testid="removed-doc">
      <div className="doc-row-h">
        <b>{d.kind === "other" ? d.kind_name : DOC_LABEL[d.kind] ?? d.kind_name}</b>
        <Pill>{d.removed_reason === "replaced" ? "Replaced" : "Removed"}</Pill>
        <span className="doc">{fileTypeText(d.content_type)}</span>
      </div>
      <div className="sub">
        {byWhenText("Uploaded", d.uploaded, year)} · {byWhenText(d.removed_reason === "replaced" ? "replaced" : "removed", d.removed, year)}
        {d.expiry ? ` · expiry ${d.expiry}` : ""}
      </div>
      <div className="acts">
        {d.url && <a className="btn small" href={d.url} target="_blank" rel="noopener">View</a>}
        {acts.restore && <button type="button" className="btn small" disabled={busy} onClick={() => void restore()}>{busy ? "Restoring…" : "Restore"}</button>}
      </div>
      {msg && <Notice tone="bad">{msg}</Notice>}
    </div>
  );
}
