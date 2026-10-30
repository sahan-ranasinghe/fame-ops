// Settings → Rental companies (/settings/rental-companies, the vehicles permission; Round 52, docs/phase8-plan.md §40):
// the companies the vehicles are rented from, with how many vehicles each has (list_rental_companies), Show archived,
// Archive / Restore (set_rental_company_archived), Delete permanently for one with no vehicle ever (users: can_delete →
// one confirm), and + Add: the vehicle form's own add flow (AddRentalCompany, add_rental_company), shared by both.
import { type ReactNode, useState } from "react";
import { useFleet } from "../../app/FleetContext";
import { useQuery } from "../../data/useQuery";
import { errText } from "../../transport/errors";
import type { FleetError } from "../../transport/types";
import { Notice, Pill } from "../../ui/basics";
import { FilterBar } from "../../ui/FilterBar";
import { pairsDef } from "../../ui/filterLogic";
import { EmptyLine, ListHeader, SkeletonRows, useUrlFilter } from "../../ui/ListKit";
import { PageTop } from "../../ui/Page";
import { useToast } from "../../ui/Toast";
import { DeleteRecordCard } from "../bin/BinParts";
import { deletedToast } from "../bin/binLogic";
import { ListFooter, ListStale, ListWaiting, useLocalPages } from "../listLocal";

export interface RentalCompany {
  id: string;
  name: string;
  phone?: string;
  vehicles: number;
  /** "2026-10-30 by Sahan" when archived. */
  archived?: string;
}
export interface RentalCompanies {
  companies: RentalCompany[];
}

export const RENTAL_QUERY = "rentalCompanies";

/** The vehicle form's add flow (a link, then the name and phone inline, Add company), here and on the vehicle form. */
export function AddRentalCompany({ onAdded, hint, startOpen = false }: { onAdded: (name: string) => void; hint?: ReactNode; startOpen?: boolean }) {
  const { transport } = useFleet();
  const [company, setCompany] = useState<{ open: boolean; name: string; phone: string; msg: string | null }>({ open: startOpen, name: "", phone: "", msg: null });
  async function saveCompany() {
    if (!company.name.trim()) {
      setCompany({ ...company, msg: "Add the name." });
      return;
    }
    try {
      const input: Record<string, unknown> = { name: company.name.trim() };
      if (company.phone.trim()) input.phone = company.phone.trim();
      await transport.call("add_rental_company", input);
      onAdded(company.name.trim());
      setCompany({ open: startOpen, name: "", phone: "", msg: `Added ${company.name.trim()}.` });
    } catch (e) {
      setCompany({ ...company, msg: errText(e as FleetError)[0] });
    }
  }
  return (
    <div>
      {!startOpen && (
        <p className="hint" style={{ margin: "-8px 0 0" }}>
          A new rental company must be added first: <button type="button" className="linkish" onClick={() => setCompany({ ...company, open: true, msg: null })}>add a rental company</button>.
          {hint}
        </p>
      )}
      {company.open && (
        <div style={{ marginTop: startOpen ? 0 : 8 }}>
          <div className="grid2" style={{ alignItems: "end" }}>
            <div className="field"><label htmlFor="rc-name">Rental company</label><input id="rc-name" maxLength={120} value={company.name} onChange={(e) => setCompany({ ...company, name: e.target.value })} /></div>
            <div className="field"><label htmlFor="rc-phone">Phone</label><input id="rc-phone" maxLength={30} inputMode="tel" value={company.phone} onChange={(e) => setCompany({ ...company, phone: e.target.value })} /></div>
          </div>
          <div style={{ marginTop: 8 }}><button type="button" className="btn small dark" onClick={() => void saveCompany()}>Add company</button></div>
        </div>
      )}
      {company.msg && <p className="status live small" style={{ margin: "6px 0 0" }}>{company.msg}</p>}
    </div>
  );
}

/** What an empty list means, in words. */
export const rentalEmpty = (archived: boolean) => (archived ? "No rental company is archived." : "No rental companies yet. Add the first one with + Add.");

export default function RentalCompaniesPage() {
  const { me, transport, store, noConnector } = useFleet();
  const toast = useToast();
  const [show, setShow] = useUrlFilter<"0" | "1">("archived", "0", ["0", "1"]);
  const archived = show === "1";
  const q = useQuery<RentalCompanies>(RENTAL_QUERY, "list_rental_companies", noConnector ? null : (archived ? { archived: true } : {}), { keep: true });
  const rows = q.data?.companies ?? [];
  const list = useLocalPages(rows, show);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [rowErr, setRowErr] = useState<{ id: string; text: string } | null>(null);
  const canChange = me.tools.includes("set_rental_company_archived");
  const canAdd = me.tools.includes("add_rental_company");

  async function setArchived(c: RentalCompany, on: boolean) {
    setBusy(c.id);
    setRowErr(null);
    try {
      await transport.call("set_rental_company_archived", { company: c.id, archived: on });
      toast(on ? `${c.name} archived` : `${c.name} restored`);
      q.refetch();
      void store.invalidate();
    } catch (e) {
      setRowErr({ id: c.id, text: errText(e as FleetError)[0] });
    }
    setBusy(null);
  }

  return (
    <section className="view" data-testid="rental-companies">
      <PageTop title="Rental companies" sub="Settings · who the vehicles are rented from" backTo="/settings"
        actions={canAdd && !adding ? <button type="button" className="btn small primary" onClick={() => setAdding(true)} data-testid="rental-add">+ Add</button> : undefined} />
      {adding && (
        <div className="card card-b form" data-testid="rental-add-form">
          <AddRentalCompany startOpen onAdded={() => { q.refetch(); void store.invalidate(); }} />
          <div><button type="button" className="btn small" onClick={() => setAdding(false)}>Done</button></div>
        </div>
      )}
      <FilterBar
        filters={[pairsDef("archived", "Rental companies", [["0", "In use"], ["1", "Show archived"]], "0")]}
        values={{ archived: show }}
        onChange={(v) => setShow(v.archived === "1" ? "1" : "0")}
      />
      {!noConnector && <ListWaiting q={q} loading="Loading the rental companies…" />}
      {q.data && (
        <div className="card" aria-busy={q.updating || undefined} data-testid="rental-list">
          <ListHeader title={archived ? "Archived rental companies" : "Rental companies"} count={rows.length} updating={q.updating} />
          <ListStale q={q} />
          {list.items.length ? (
            <div className="rows">
              {list.items.map((c) => (
                <div className="row" key={c.id} data-testid="rental-row" style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
                  <div className="grow">
                    <div className="name">{c.name} {c.archived && <Pill tone="bad">Archived</Pill>}</div>
                    <div className="sub">{[c.phone, `${c.vehicles} vehicle${c.vehicles === 1 ? "" : "s"}`, c.archived ? `Archived ${c.archived}` : ""].filter(Boolean).join(" · ")}</div>
                    {rowErr?.id === c.id && <Notice tone="bad">{rowErr.text}</Notice>}
                  </div>
                  <div className="acts" style={{ margin: 0 }}>
                    {canChange && (
                      <button type="button" className="btn small" disabled={busy !== null} onClick={() => void setArchived(c, !c.archived)}>
                        {busy === c.id ? (c.archived ? "Restoring…" : "Archiving…") : c.archived ? "Restore" : "Archive"}
                      </button>
                    )}
                    <DeleteRecordCard compact kind="rental_company" refValue={c.id} fallback="/settings/rental-companies"
                      onDeleted={(a) => { toast(deletedToast(a.until)); q.refetch(); }} />
                  </div>
                </div>
              ))}
            </div>
          ) : q.stale ? <SkeletonRows rows={3} /> : <EmptyLine>{rentalEmpty(archived)}</EmptyLine>}
          <ListFooter list={list} />
        </div>
      )}
    </section>
  );
}
