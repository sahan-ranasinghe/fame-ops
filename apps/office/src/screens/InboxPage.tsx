// Notifications (/inbox, Hotfix 2, A): the notification centre as a page: the bell opens it on a phone, "All
// notifications" on a desktop. Everything the person was told about, newest first (who, what, when), each opening
// its page and marking it read; Mark all read. The list is the Shell's feed (app/inbox.tsx), so the page and the
// bell never disagree.
import { useState } from "react";
import { Link } from "react-router";
import { INBOX_EMPTY, InboxList, useInbox } from "../app/inbox";
import { errText } from "../transport/errors";
import { Loading, Notice } from "../ui/basics";

export function InboxPage() {
  const api = useInbox();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const head = (unread = 0) => (
    <div className="ph">
      <div><div className="eyebrow">{unread ? `${unread} unread` : "Everything you were told about"}</div><h1>Notifications</h1></div>
      {unread > 0 && api && (
        <div className="ph-actions">
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setMsg(null);
              api.readAll().catch(() => setMsg("Could not mark them read. Try again.")).finally(() => setBusy(false));
            }}
          >
            Mark all read
          </button>
        </div>
      )}
    </div>
  );

  if (!api?.active) {
    return (
      <section className="view" data-testid="inbox-page">
        {head()}
        <Notice tone="info">The notification centre is for a signed-in person: open the Fame Fleet web app, or connect Claude with your own key.</Notice>
      </section>
    );
  }
  const d = api.inbox;
  return (
    <section className="view" data-testid="inbox-page">
      {head(d?.unread ?? 0)}
      <div className="stack" style={{ maxWidth: 720 }}>
        {msg && <Notice tone="bad">{msg}</Notice>}
        {!d
          ? api.err
            ? <Notice tone="bad" action={<button type="button" className="btn small" onClick={api.reload}>Try again</button>}>{errText(api.err)[0]}</Notice>
            : <Loading>Loading notifications…</Loading>
          : (
            <div className="card">
              {d.items.length ? <InboxList items={d.items} onOpen={(i) => api.read([i.id])} /> : <div className="inbox-empty">{INBOX_EMPTY}</div>}
            </div>
          )}
        <p className="muted small" style={{ margin: 0 }}>
          Sounds, the volume and which events reach you: <Link to="/settings/notifications">Settings → Notifications</Link>.
        </p>
      </div>
    </section>
  );
}
