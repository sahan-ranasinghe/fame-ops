// Places (/places, the vehicles permission; Phase 6, Part 4): the office's own
// places and the operators' sites, found by name, site id or other id, filtered
// by owner and by whether they have a pin; a row opens the place (/places/:id)
// with its pin beside the list on a desktop, full screen on a phone. Phase 7
// (§15): Removed places (restore_place) lists the places the office removed,
// with Restore on each row.
// Hotfix 3 (L3): thousands of sites are never on screen. The server searches and pages (25 at a time: page numbers on a
// desktop, Load more and cards on a phone), the header counts every match, the search waits for typing to pause, and the
// chips, the search (?q=) and Without a pin are in the URL.
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useFleet } from "../app/FleetContext";
import { can, type FleetError } from "../transport/types";
import type { Paged } from "../data/types";
import { today } from "../lib/format";
import { errText } from "../transport/errors";
import { Notice, Pill } from "../ui/basics";
import { FilterBar } from "../ui/FilterBar";
import { pairsDef } from "../ui/filterLogic";
import { EmptyLine, ListHeader, SkeletonRows, usePagedList } from "../ui/ListKit";
import { ListWithDetail } from "../ui/Page";
import { badgeTone } from "../ui/locationLogic";
import { useToast } from "../ui/Toast";
import { ListFooter, ListStale, ListWaiting, SearchBox, useSearchBox } from "./listLocal";
import { listArgs, removedLine, type RemovedPlace, type Who, whoOf, whoOptions } from "./placeRemoveLogic";

export const PLACES_CHANGED = "fame:places-changed";

/** The list's query key. */
export const PLACES_QUERY = "places";

/** list_places' answer, a page at a time (no named type for it in data/types.ts). */
export interface PlacesPage extends Paged {
  count: number;
  places: RemovedPlace[];
}

export const placeBadge = (p: RemovedPlace) => (p.kind === "office" ? "Office" : p.operator === "dialog" ? "Site · Dialog" : p.operator === "mobitel" ? "Site · Mobitel" : p.kind === "site" ? "Site" : "Saved");

const NOUN: Record<Who, string> = { ours: "place of ours", dialog: "Dialog site", mobitel: "Mobitel site", removed: "removed place" };

/** What an empty list means, in words. */
export function placesEmpty(who: Who, search: string, nopin: boolean): string {
  const pin = nopin ? " without a pin" : "";
  if (search) return `No ${NOUN[who]}${pin} matches "${search}" (name, address, site id or other id).`;
  if (who === "removed") return nopin ? "No removed place is without a pin." : "No place has been removed.";
  if (nopin) return who === "ours" ? "Every one of our places has a pin." : `Every ${NOUN[who]} has a pin.`;
  return who === "ours" ? "No places of our own yet." : `No ${NOUN[who]}s yet: Import sites brings them in.`;
}

export function Places() {
  const { me, transport, store, noConnector } = useFleet();
  const toast = useToast();
  const navigate = useNavigate();
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const who = whoOf(params.get("who"), me.tools);
  const removedView = who === "removed";
  const nopin = params.get("nopin") === "1";
  const box = useSearchBox();
  const [err, setErr] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const list = usePagedList<RemovedPlace, PlacesPage>(PLACES_QUERY, "list_places", listArgs(who, box.search, nopin), (d) => d.places,
    { enabled: !noConnector });
  const q = list.query;
  const d = q.data;

  // A place changed on its page (edit, pin, remove): the rows again.
  const refetch = q.refetch;
  useEffect(() => {
    window.addEventListener(PLACES_CHANGED, refetch);
    return () => window.removeEventListener(PLACES_CHANGED, refetch);
  }, [refetch]);

  const set = (patch: Record<string, string>) => setParams((p) => {
    const next = new URLSearchParams(p);
    for (const [k, v] of Object.entries(patch)) if (v) next.set(k, v); else next.delete(k);
    return next;
  }, { replace: true });
  const search = params.toString() ? `?${params.toString()}` : "";
  const year = today().slice(0, 4);
  const title = whoOptions(me.tools).find(([k]) => k === who)?.[1] ?? "Places";

  async function restore(p: RemovedPlace) {
    if (!p.id) return;
    setRestoring(p.id);
    try {
      await transport.call("restore_place", { id: p.id });
      toast(`${p.name} restored`);
      setErr(null);
      window.dispatchEvent(new Event(PLACES_CHANGED));
      void store.invalidate();
    } catch (e) {
      setErr(errText(e as FleetError)[0]);
    }
    setRestoring(null);
  }

  return (
    <section className="view">
      <div className="ph">
        <div><div className="eyebrow">Offices, saved places and the operators' sites</div><h1>Places</h1></div>
        <div className="ph-actions">
          {__BUILD__ === "web" && can(me, "vehicles") && <Link className="btn" to="/settings/import-sites">Import sites</Link>}
        </div>
      </div>
      <ListWithDetail>
        <FilterBar
          search={<SearchBox label="Find a place" placeholder="Name, site id or other id (MT0184, COL018)" value={box.text} onChange={box.setText} onBlur={box.flush} />}
          filters={[
            pairsDef("who", "Places", whoOptions(me.tools), "ours"),
            pairsDef("nopin", "Pin", [["", "With or without a pin"], ["1", "Without a pin"]], ""),
          ]}
          values={{ who, nopin: nopin ? "1" : "" }}
          onChange={(v) => set({ who: v.who === "ours" ? "" : (v.who as string) ?? "", nopin: v.nopin === "1" ? "1" : "" })}
        />
        {err && <Notice tone="bad">{err}</Notice>}
        {!noConnector && <ListWaiting q={q} loading="Loading the places…" />}
        {d && (
          <div className="card" style={q.stale ? { opacity: 0.6 } : undefined} aria-busy={q.updating || q.stale || undefined} data-testid="places-list">
            <ListHeader title={`${title}${nopin ? " without a pin" : ""}`} count={list.total} updating={q.updating || q.stale} />
            <ListStale q={q} />
            {list.items.length ? (
              <div className="tbl-wrap">
                <table data-testid="places-table">
                  <thead>
                    {removedView
                      ? <tr><th>Place</th><th>Kind</th><th>Site id</th><th>Removed</th><th></th></tr>
                      : <tr><th>Place</th><th>Kind</th><th>Site id</th><th>District</th><th>Pin</th></tr>}
                  </thead>
                  <tbody>
                    {list.items.map((p) => (
                      <tr key={p.id ?? p.name} className={`click${p.id === id ? " selected" : ""}`} onClick={() => p.id && navigate(`/places/${p.id}${search}`)} aria-current={p.id === id ? "true" : undefined} data-testid="place-row">
                        <td data-label="Place"><b>{p.name}</b>{p.address && <div className="sub">{p.address}</div>}</td>
                        <td data-label="Kind"><Pill tone={badgeTone(placeBadge(p))}>{placeBadge(p)}</Pill></td>
                        <td data-label="Site id" className="mono">{p.site_id ?? "—"}</td>
                        {removedView ? (
                          <>
                            <td data-label="Removed">{removedLine(p.removed, year)}</td>
                            <td className="r">
                              <button type="button" className="btn small" disabled={restoring !== null} onClick={(e) => { e.stopPropagation(); void restore(p); }}>
                                {restoring === p.id ? "Restoring…" : "Restore"}
                              </button>
                            </td>
                          </>
                        ) : (
                          <>
                            <td data-label="District">{p.district ?? "—"}</td>
                            <td data-label="Pin">{p.pinned ? <Pill tone="ok">Pinned</Pill> : <Pill tone="bad">no pin</Pill>}</td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : q.stale ? <SkeletonRows rows={3} /> : <EmptyLine>{placesEmpty(who, box.search, nopin)}</EmptyLine>}
            <ListFooter list={list} />
          </div>
        )}
      </ListWithDetail>
    </section>
  );
}
