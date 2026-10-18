// Notifications (/inbox, Hotfix 2, A): the notification centre as a page: the bell opens it on a phone, "All
// notifications" on a desktop. Everything the person was told about, newest first (who, what, when), each opening
// its page and marking it read; Mark all read.
// Hotfix 3 (L3, L4): the page's own list, a page at a time (my_inbox with limit and cursor: 25, "Load more" on a phone,
// page numbers on a desktop): the last 30 days by default, All or Unread, the History switch (the archived ones too:
// read items over 30 days old), a search box, every filter in the URL (?show=unread&history=1&q=), the count in the
// header and an empty line that says what the filters mean. Reading goes through the Shell's feed (app/inbox.tsx), so
// the bell's count follows.
import { useState } from "react";
import { Link } from "react-router";
import { InboxList, useInbox } from "../app/inbox";
import { useFleet } from "../app/FleetContext";
import type { Inbox, InboxItem } from "../data/types";
import { errText } from "../transport/errors";
import { Loading, Notice } from "../ui/basics";
import { EmptyLine, ListHeader, LoadMore, PAGE_SIZE, Pager, SearchBox, usePagedList, useUrlFilter, useUrlSearch } from "../ui/ListKit";
import { inboxArgs, inboxEmptyText, type InboxShow, INBOX_SHOW_KEYS, INBOX_SHOW_OPTIONS, readHere } from "./inboxPageLogic";

export function InboxPage() {
  const api = useInbox();
  const { transport } = useFleet();
  const [show, setShow] = useUrlFilter<InboxShow>("show", "all", INBOX_SHOW_KEYS);
  const [history, setHistory] = useUrlFilter<"" | "1">("history", "", ["", "1"]);
  const [search, setSearch] = useUrlSearch();
  const active = !!api?.active;
  const list = usePagedList<InboxItem, Inbox>("inboxPage", "my_inbox", inboxArgs(show, history === "1", search), (a) => a.items ?? [], {
    enabled: active,
    every: 60000,
  });
  // Read here before the server's next answer says so (opened, or Mark all read).
  const [read, setRead] = useState<{ ids: number[]; all: boolean }>({ ids: [], all: false });
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const q = list.query;
  const d = q.data;
  const unread = api?.inbox?.unread ?? d?.unread ?? 0;

  /** Opening an item marks it read: through the feed when the feed holds it (the bell's count drops at once), else here. */
  const open = (i: InboxItem) => {
    if (i.read || read.all || read.ids.includes(i.id)) return;
    setRead((r) => ({ ...r, ids: [...r.ids, i.id] }));
    if (api?.inbox?.items.some((x) => x.id === i.id)) api.read([i.id]);
    else transport.call("mark_inbox_read", { ids: [i.id] }).then(() => api?.reload(), () => q.refetch());
  };
  const readAll = () => {
    if (!api) return;
    setBusy(true);
    setMsg(null);
    setRead({ ids: [], all: true });
    api.readAll()
      .then(() => q.refetch())
      .catch(() => {
        setRead({ ids: [], all: false });
        setMsg("Could not mark them read. Try again.");
      })
      .finally(() => setBusy(false));
  };

  const head = (
    <div className="ph">
      <div><div className="eyebrow">{unread ? `${unread} unread` : "Everything you were told about"}</div><h1>Notifications</h1></div>
      {unread > 0 && active && (
        <div className="ph-actions">
          <button type="button" className="btn" disabled={busy} onClick={readAll}>Mark all read</button>
        </div>
      )}
    </div>
  );

  if (!active) {
    return (
      <section className="view" data-testid="inbox-page">
        {head}
        <Notice tone="info">The notification centre is for a signed-in person: open the Fame Fleet web app, or connect Claude with your own key.</Notice>
      </section>
    );
  }
  // Until the page's own answer comes, the unfiltered list starts from the feed the bell shows (no Loading flash).
  const seed = !d && show === "all" && history !== "1" && !search ? api?.inbox : undefined;
  const items = readHere(d ? list.items : seed ? seed.items.slice(0, PAGE_SIZE) : [], read);
  const count = d ? list.total : seed?.total ?? seed?.items.length;
  return (
    <section className="view" data-testid="inbox-page">
      {head}
      <div className="stack" style={{ maxWidth: 720 }}>
        <div className="card card-b" style={{ display: "grid", gap: 12 }}>
          <div className="chips" role="group" aria-label="Show">
            {INBOX_SHOW_OPTIONS.map(([k, label]) => (
              <button key={k} type="button" className="chip" aria-pressed={show === k} onClick={() => setShow(k)}>{label}</button>
            ))}
            <button type="button" className="chip" aria-pressed={history === "1"} onClick={() => setHistory(history === "1" ? "" : "1")} title="Also the read ones over 30 days old">History</button>
          </div>
          <div className="filters" style={{ marginBottom: 0 }}>
            <SearchBox value={search} onChange={setSearch} placeholder="Who or what" />
          </div>
          <div className="muted small">{history === "1" ? "The last 30 days and the history: read notifications over 30 days old." : "The last 30 days. Read ones older than that are in the history."}</div>
        </div>
        {msg && <Notice tone="bad">{msg}</Notice>}
        {!d && !seed
          ? q.err
            ? <Notice tone="bad" action={<button type="button" className="btn small" onClick={q.refetch}>Try again</button>}>{errText(q.err)[0]}</Notice>
            : <Loading>Loading notifications…</Loading>
          : (
            <div className="card" aria-busy={q.updating || undefined}>
              <ListHeader title={show === "unread" ? "Unread" : "Notifications"} count={count} updating={q.updating || q.stale} />
              <div style={q.stale ? { opacity: 0.6 } : undefined}>
                {items.length
                  ? <InboxList items={items} onOpen={open} />
                  : <EmptyLine>{q.stale ? "Loading…" : inboxEmptyText(show, history === "1", search)}</EmptyLine>}
              </div>
              <LoadMore list={list} />
              <Pager list={list} />
            </div>
          )}
        <p className="muted small" style={{ margin: 0 }}>
          Sounds, the volume and which events reach you: <Link to="/settings/notifications">Settings → Notifications</Link>.
        </p>
      </div>
    </section>
  );
}
