// Settings → Recently deleted (/settings/recently-deleted, users; Round 52, docs/phase8-plan.md §40): Gmail's and Google
// Drive's bin. What was deleted in the last 30 days, newest first (list_bin): what it was, who deleted it and when, the
// reason of a wrong entry, and until when it can come back. Restore asks nothing (the toast "Restored <label>"); a refusal
// (a name or plate taken meanwhile, what it belonged to gone) shows the server's sentence on the row. The list's one Filter
// (the kind) and its search are in the URL (?kind=, ?q=).
import { useState } from "react";
import { useFleet } from "../../app/FleetContext";
import { errText } from "../../transport/errors";
import type { FleetError } from "../../transport/types";
import { Notice, Pill } from "../../ui/basics";
import { FilterBar } from "../../ui/FilterBar";
import { pairsDef } from "../../ui/filterLogic";
import { EmptyLine, ListHeader, SkeletonRows, usePagedList, useUrlFilter } from "../../ui/ListKit";
import { PageTop } from "../../ui/Page";
import { useToast } from "../../ui/Toast";
import { ListFooter, ListStale, ListWaiting, SearchBox, useSearchBox } from "../listLocal";
import { BIN_KIND_CHOICES, binArgs, type BinItem, type BinList, deletedByLine, KIND_TEXT, restoreLine, type RestoredAnswer } from "./binLogic";

export const BIN_QUERY = "recentlyDeleted";
const KINDS = BIN_KIND_CHOICES.map(([k]) => k);

/** What an empty list means, in words. */
export function binEmpty(kind: string, search: string): string {
  if (search) return `Nothing deleted matches "${search}".`;
  if (kind) return `No ${(KIND_TEXT[kind as keyof typeof KIND_TEXT] ?? "").toLowerCase()} was deleted in the last 30 days.`;
  return "Nothing was deleted in the last 30 days. Deleted things wait here 30 days, then go for good.";
}

export default function RecentlyDeleted() {
  const { transport, store, noConnector } = useFleet();
  const toast = useToast();
  const [kind, setKind] = useUrlFilter<string>("kind", "", KINDS);
  const box = useSearchBox();
  const list = usePagedList<BinItem, BinList>(BIN_QUERY, "list_bin", binArgs(kind, box.search), (d) => d.items, { enabled: !noConnector });
  const q = list.query;
  const d = q.data;
  const [busy, setBusy] = useState<string | null>(null);
  const [rowErr, setRowErr] = useState<{ id: string; text: string } | null>(null);
  const [notes, setNotes] = useState<string[]>([]);

  async function restore(i: BinItem) {
    setBusy(i.id);
    setRowErr(null);
    setNotes([]);
    try {
      const a = await transport.call<RestoredAnswer>("restore_bin_item", { id: i.id });
      toast(`Restored ${a.restored ?? i.label}`);
      if (a.notes?.length) setNotes(a.notes);
      q.refetch();
      void store.invalidate();
    } catch (e) {
      setRowErr({ id: i.id, text: errText(e as FleetError)[0] });
    }
    setBusy(null);
  }

  return (
    <section className="view" data-testid="recently-deleted">
      <PageTop title="Recently deleted" sub="Settings · kept 30 days, then gone for good" backTo="/settings" />
      <FilterBar
        search={<SearchBox label="Find something deleted" placeholder="Name, plate, reason or who deleted it" value={box.text} onChange={box.setText} onBlur={box.flush} />}
        filters={[pairsDef("kind", "Kind", BIN_KIND_CHOICES, "")]}
        values={{ kind }}
        onChange={(v) => setKind((v.kind as string) ?? "")}
      />
      {notes.map((n) => <Notice key={n} tone="info">{n}</Notice>)}
      {!noConnector && <ListWaiting q={q} loading="Loading what was deleted…" />}
      {d && (
        <div className="card" style={q.stale ? { opacity: 0.6 } : undefined} aria-busy={q.updating || q.stale || undefined} data-testid="bin-list">
          <ListHeader title={kind ? KIND_TEXT[kind as keyof typeof KIND_TEXT] ?? "Deleted" : "Deleted"} count={list.total} updating={q.updating || q.stale} />
          <ListStale q={q} />
          {list.items.length ? (
            <div className="rows">
              {list.items.map((i) => (
                <div className="row" key={i.id} data-testid="bin-row" style={{ alignItems: "flex-start" }}>
                  <div className="grow" style={{ display: "grid", gap: 2 }}>
                    <div className="name">{i.label} <Pill>{KIND_TEXT[i.kind] ?? "Deleted"}</Pill></div>
                    {i.detail && <div className="sub">{i.detail}</div>}
                    <div className="sub">{deletedByLine(i)}</div>
                    {i.reason && <div className="sub" data-testid="bin-reason">Reason: {i.reason}</div>}
                    <div className="sub">{restoreLine(i)}</div>
                    {rowErr?.id === i.id && <Notice tone="bad">{rowErr.text}</Notice>}
                  </div>
                  <button type="button" className="btn small dark" disabled={busy !== null} onClick={() => void restore(i)}>{busy === i.id ? "Restoring…" : "Restore"}</button>
                </div>
              ))}
            </div>
          ) : q.stale ? <SkeletonRows rows={3} /> : <EmptyLine>{binEmpty(kind, box.search)}</EmptyLine>}
          <ListFooter list={list} />
        </div>
      )}
    </section>
  );
}
