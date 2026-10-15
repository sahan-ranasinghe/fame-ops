// Places (/places, the vehicles permission; Phase 6, Part 4): the office's own
// places and the operators' sites, found by name, site id or other id, filtered
// by owner and by whether they have a pin; a row opens the place (/places/:id)
// with its pin beside the list on a desktop, full screen on a phone.
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useFleet } from "../app/FleetContext";
import { can, type FleetError } from "../transport/types";
import type { Place } from "../data/types";
import { errText } from "../transport/errors";
import { Chips, Empty, Loading, Notice, Pill } from "../ui/basics";
import { ListWithDetail } from "../ui/Page";
import { badgeTone } from "../ui/locationLogic";

export const PLACES_CHANGED = "fame:places-changed";
const LIMIT = 200;

type Who = "ours" | "dialog" | "mobitel";
const WHO: [Who, string][] = [["ours", "Our places"], ["dialog", "Dialog sites"], ["mobitel", "Mobitel sites"]];

export const placeBadge = (p: Place) => (p.kind === "office" ? "Office" : p.operator === "dialog" ? "Site · Dialog" : p.operator === "mobitel" ? "Site · Mobitel" : p.kind === "site" ? "Site" : "Saved");

export function Places() {
  const { me, transport } = useFleet();
  const navigate = useNavigate();
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const who = (params.get("who") as Who) || "ours";
  const nopin = params.get("nopin") === "1";
  const [text, setText] = useState(params.get("q") ?? "");
  const [rows, setRows] = useState<Place[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const again = () => setTick((n) => n + 1);
    window.addEventListener(PLACES_CHANGED, again);
    return () => window.removeEventListener(PLACES_CHANGED, again);
  }, []);
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      const args: Record<string, unknown> = { limit: LIMIT, operator: who === "ours" ? "other" : who };
      if (text.trim()) args.search = text.trim();
      if (nopin) args.pinned = false;
      transport.call<{ places: Place[] }>("list_places", args)
        .then((r) => { if (alive) { setRows(r.places); setErr(null); } })
        .catch((e) => { if (alive) setErr(errText(e as FleetError)[0]); });
    }, 300);
    return () => { alive = false; clearTimeout(timer); };
  }, [transport, who, nopin, text, tick]);

  const set = (patch: Record<string, string>) => setParams((p) => {
    const next = new URLSearchParams(p);
    for (const [k, v] of Object.entries(patch)) if (v) next.set(k, v); else next.delete(k);
    return next;
  }, { replace: true });
  const q = params.toString() ? `?${params.toString()}` : "";

  return (
    <section className="view">
      <div className="ph">
        <div><div className="eyebrow">Offices, saved places and the operators' sites</div><h1>Places</h1></div>
        <div className="ph-actions">
          {__BUILD__ === "web" && can(me, "vehicles") && <Link className="btn" to="/settings/import-sites">Import sites</Link>}
        </div>
      </div>
      <ListWithDetail>
        <div className="card card-b form" style={{ gap: 10 }}>
          <input aria-label="Find a place" placeholder="Name, site id or other id (MT0184, COL018)" value={text} onChange={(e) => { setText(e.target.value); set({ q: e.target.value }); }} />
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <Chips options={WHO} value={who} onChange={(w) => set({ who: w === "ours" ? "" : w })} />
            <label className="check"><input type="checkbox" checked={nopin} onChange={(e) => set({ nopin: e.target.checked ? "1" : "" })} /> Without a pin</label>
          </div>
        </div>
        {err && <Notice tone="bad">{err}</Notice>}
        {!rows && !err && <Loading>Loading the places…</Loading>}
        {rows && (
          <div className="card">
            {rows.length ? (
              <div className="tbl-wrap">
                <table data-testid="places-table">
                  <thead><tr><th>Place</th><th>Kind</th><th>Site id</th><th>District</th><th>Pin</th></tr></thead>
                  <tbody>
                    {rows.map((p) => (
                      <tr key={p.id ?? p.name} className={`click${p.id === id ? " selected" : ""}`} onClick={() => p.id && navigate(`/places/${p.id}${q}`)} aria-current={p.id === id ? "true" : undefined}>
                        <td data-label="Place"><b>{p.name}</b>{p.address && <div className="sub">{p.address}</div>}</td>
                        <td data-label="Kind"><Pill tone={badgeTone(placeBadge(p))}>{placeBadge(p)}</Pill></td>
                        <td data-label="Site id" className="mono">{p.site_id ?? "—"}</td>
                        <td data-label="District">{p.district ?? "—"}</td>
                        <td data-label="Pin">{p.pinned ? <Pill tone="ok">Pinned</Pill> : <Pill tone="bad">no pin</Pill>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <Empty>No place matches.</Empty>}
            {rows.length >= LIMIT && <div className="card-b sub">The first {LIMIT}: type part of a name or an id to narrow it down.</div>}
          </div>
        )}
      </ListWithDetail>
    </section>
  );
}
