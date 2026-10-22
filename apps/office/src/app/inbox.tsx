// The notification centre (Hotfix 2, A) and the office site's sounds (B).
// One feed per open page (InboxProvider, in the Shell): my_inbox watched every 60 s on the web (and at once on a
// Realtime change of the person's office_inbox rows) and every 30 s in the artifact, which has no Supabase code. An
// item that arrives after the page loaded (never one of the first load's) shows a banner (who, what, Open, Close) and
// plays its kind's sound (data/sounds.ts) at the person's volume, unless their sound is off. Browsers keep a page
// silent until its first click or key press: until then a slim "Click to turn on sounds" strip shows, and one click
// anywhere turns them on. Hotfix 3 (L4): the tray is the one notification icon (the issues bell is gone; the issues
// count is a badge on the Issues menu item): on a desktop it opens a panel that stays until closed (no outside click
// closes it), the items by day (Today, Yesterday, Earlier) with All / Unread and Mark all read; on a phone it opens
// /inbox. It shows what my_inbox answers by default: the last 30 days (older read items are archived; the
// notifications page shows them). Opening an item marks it read; "Mark all read" reads them all. A person without
// my_inbox (or the shared connector key, which has no person: the tool refuses) sees none of it.
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { useEntry } from "../data/hooks";
import { addBanners, freshItems, headline, KIND_TONE, markedRead, unreadBadge } from "../data/inboxLogic";
import { DEFAULT_SOUND, loudest, type MakeAudio, SoundPlayer, soundPrefs } from "../data/sounds";
import type { Inbox, InboxItem, NotificationSettings, SoundPrefs } from "../data/types";
import { today } from "../lib/format";
import { AUTHZ } from "../transport/errors";
import { canOpenTask, type FleetError } from "../transport/types";
import { Icon } from "../ui/icons";
import { useIsPhone } from "../ui/phone";
import { useToast } from "../ui/Toast";
import { InboxActions } from "./InboxActions";
import { actionsOf, itemLink, saidText } from "./inboxActionsLogic";
import { useFleet } from "./FleetContext";
import { filterInbox, groupByDay, type InboxFilter } from "./inboxGroups";
import { datesInWords } from "../lib/when";

export const INBOX_KEY = "inbox";
export const INBOX_ARGS = { limit: 50 };
/** The web refreshes every 60 s besides Realtime; the artifact polls every 30 s. */
export const INBOX_EVERY = { api: 60000, claude: 30000 } as const;
/** A dropped connection or a busy server: the watch keeps trying. Anything else on the first load = no inbox here. */
/** A call that took too long ("timeout", Stage 0) is passing too: a slow first load never switches the bell off. */
const PASSING = new Set(["network", "server_unavailable", "rate_limited", "upstream_error", "timeout"]);

export interface InboxApi {
  /** The feed runs: the person has my_inbox and the tool answered. */
  active: boolean;
  inbox?: Inbox;
  err?: FleetError;
  reload: () => void;
  /** The banners on screen, newest first. */
  banners: InboxItem[];
  /** Closes a banner (the item stays unread). */
  dismiss: (id: number) => void;
  /** Marks items read (opening one does): the count drops at once, the server's answer settles it. */
  read: (ids: number[]) => void;
  readAll: () => Promise<void>;
  sound: SoundPrefs;
  /** The person's sound settings changed (Settings → Notifications saved them). */
  setSound: (p: SoundPrefs) => void;
  /** The browser lets this page play sounds (a click or key press happened). */
  unlocked: boolean;
  /** Call inside a click: asks the browser to let the page play. */
  unlock: () => Promise<boolean>;
  player: SoundPlayer;
}

const Ctx = createContext<InboxApi | null>(null);
/** The feed, or null outside the Shell (a page test). */
export const useInbox = () => useContext(Ctx);

const GESTURES = ["pointerdown", "pointerup", "touchend", "keydown", "click"] as const;

export function InboxProvider({ children, makeAudio }: { children: ReactNode; makeAudio?: MakeAudio }) {
  const { me, store, transport, noConnector, realtime } = useFleet();
  const want = !noConnector && me.tools.includes("my_inbox");
  const [refused, setRefused] = useState(false);
  const active = want && !refused;
  const entry = useEntry<Inbox>(INBOX_KEY);
  const [player] = useState(() => new SoundPlayer(makeAudio));
  // An item from before the page opened is never news (the artifact may first show a copy fetched earlier).
  const [openedAt] = useState(() => Date.now());
  const [sound, setSound] = useState<SoundPrefs>(DEFAULT_SOUND);
  const soundRef = useRef(sound);
  soundRef.current = sound;
  const [unlocked, setUnlocked] = useState(false);
  const [banners, setBanners] = useState<InboxItem[]>([]);
  // The highest item id seen since the page opened (null = nothing loaded yet: the first answer only sets it).
  const seen = useRef<number | null>(null);

  useEffect(() => {
    if (!active) return;
    store.watch(INBOX_KEY, "my_inbox", INBOX_ARGS, transport.kind === "api" ? INBOX_EVERY.api : INBOX_EVERY.claude);
    return () => store.unwatch(INBOX_KEY);
  }, [store, transport, active]);

  // The tool said no on the first load (no such tool yet, the shared key has no person): no bell, no polling. A page
  // that cannot reach Fame Fleet yet (Claude's approval, a sign-in) keeps trying: the Shell's banner says what to do.
  useEffect(() => {
    const e = entry.err;
    if (want && e && entry.data === undefined && !PASSING.has(e.code) && !AUTHZ.has(e.code)) setRefused(true);
  }, [want, entry.err, entry.data]);

  // Web: a new row (or one read in another tab) reloads at once, at most twice a second.
  useEffect(() => {
    if (!active || !realtime?.inbox) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const stop = realtime.inbox(() => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void store.load(INBOX_KEY, "my_inbox", INBOX_ARGS);
      }, 500);
    });
    return () => {
      if (timer) clearTimeout(timer);
      stop();
    };
  }, [store, realtime, active]);

  // New items since the last answer: a banner each, and the loudest kind's sound once.
  useEffect(() => {
    const d = entry.data;
    if (!d) return;
    const { fresh, seen: top } = freshItems(seen.current, d.items, openedAt);
    seen.current = top;
    if (!fresh.length) return;
    setBanners((b) => addBanners(b, fresh));
    const kind = loudest(fresh);
    if (kind && player.play(kind, soundRef.current) === "locked") setUnlocked(false);
  }, [entry.data, player, openedAt]);

  // The person's sound settings (on, 70 % when the server says nothing).
  useEffect(() => {
    if (!active || !me.tools.includes("my_notification_settings")) return;
    let alive = true;
    transport.call<NotificationSettings>("my_notification_settings", {}).then(
      (s) => { if (alive && s?.sound) setSound(soundPrefs(s.sound)); },
      () => { /* the default stands */ },
    );
    return () => { alive = false; };
  }, [transport, active, me.tools]);

  const unlock = useCallback(() => player.unlock().then((ok) => {
    if (ok) setUnlocked(true);
    return ok;
  }), [player]);

  // Until the browser lets the page play: the first click or key press anywhere asks it. A click already made on
  // this page (signing in) counts without another.
  useEffect(() => {
    if (!active || unlocked) return;
    const ua = (navigator as Navigator & { userActivation?: { hasBeenActive?: boolean } }).userActivation;
    if (ua?.hasBeenActive) void unlock();
    const on = () => void unlock();
    for (const g of GESTURES) document.addEventListener(g, on, true);
    return () => {
      for (const g of GESTURES) document.removeEventListener(g, on, true);
    };
  }, [active, unlocked, unlock]);

  const reload = useCallback(() => void store.load(INBOX_KEY, "my_inbox", INBOX_ARGS), [store]);

  const read = useCallback((ids: number[]) => {
    setBanners((b) => b.filter((x) => !ids.includes(x.id)));
    const d = store.get<Inbox>(INBOX_KEY).data;
    if (!d || !d.items.some((i) => ids.includes(i.id) && !i.read)) return;
    store.patch<Inbox>(INBOX_KEY, (x) => markedRead(x, ids));
    transport.call<{ marked?: number; unread?: number }>("mark_inbox_read", { ids }).then(
      (r) => {
        if (typeof r?.unread === "number") store.patch<Inbox>(INBOX_KEY, (x) => (x.unread === r.unread ? x : { ...x, unread: r.unread! }));
      },
      () => reload(),
    );
  }, [store, transport, reload]);

  const readAll = useCallback(async () => {
    setBanners([]);
    store.patch<Inbox>(INBOX_KEY, (x) => markedRead(x, "all"));
    try {
      const r = await transport.call<{ marked?: number; unread?: number }>("mark_inbox_read", { all: true });
      if (typeof r?.unread === "number") store.patch<Inbox>(INBOX_KEY, (x) => (x.unread === r.unread ? x : { ...x, unread: r.unread! }));
    } catch (e) {
      reload();
      throw e;
    }
  }, [store, transport, reload]);

  const dismiss = useCallback((id: number) => setBanners((b) => b.filter((x) => x.id !== id)), []);

  const api = useMemo<InboxApi>(() => ({
    active,
    inbox: entry.data,
    err: entry.err,
    reload,
    banners,
    dismiss,
    read,
    readAll,
    sound,
    setSound: (p) => setSound(soundPrefs(p)),
    unlocked,
    unlock,
    player,
  }), [active, entry.data, entry.err, reload, banners, dismiss, read, readAll, sound, unlocked, unlock, player]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

/**
 * One item: who and what, the body, when (the server's words), linked to its page; opening it marks it read. Round 4–7 (7):
 * an item with buttons (an Ask for it's Yes / No) is the same row with the buttons under it (never inside the link); an
 * answer marks it read. An ask's link goes to the Asks page for someone who cannot open tasks.
 */
function InboxRow({ item, onOpen }: { item: InboxItem; onOpen: (i: InboxItem) => void }) {
  const { me } = useFleet();
  const link = itemLink(item, canOpenTask(me));
  const cls = `inbox-item${item.read ? "" : " unread"}`;
  const body = (
    <>
      <i className={`dot ${item.read ? "muted" : KIND_TONE[item.kind] || "live"}`} aria-hidden="true" />
      <span className="grow">
        <b>{headline(item)}</b>
        {item.body && <small>{datesInWords(item.body)}</small>}
        <small className="when" title={item.at}>{item.ago}{item.read ? "" : " · unread"}</small>
      </span>
    </>
  );
  const row = link && "to" in link
    ? <Link className={cls} to={link.to} onClick={() => onOpen(item)} data-testid="inbox-item">{body}</Link>
    : link
    ? <a className={cls} href={link.href} target="_blank" rel="noreferrer" onClick={() => onOpen(item)} data-testid="inbox-item">{body}</a>
    : <button type="button" className={cls} onClick={() => onOpen(item)} data-testid="inbox-item">{body}</button>;
  if (!actionsOf(item).length) return row;
  return (
    <div className={`inbox-entry${item.read ? "" : " unread"}`} data-testid="inbox-entry">
      {row}
      <InboxActions item={item} onDone={() => onOpen(item)} />
    </div>
  );
}

export function InboxList({ items, onOpen }: { items: InboxItem[]; onOpen: (i: InboxItem) => void }) {
  return <div className="inbox-list">{items.map((i) => <InboxRow key={i.id} item={i} onOpen={onOpen} />)}</div>;
}

/** The empty list's sentence. */
export const INBOX_EMPTY = "Nothing yet. When a request is decided, a task needs you or a trip moves, it shows here.";

/** The empty list's sentence with the Unread filter on. */
export const INBOX_NONE_UNREAD = "Nothing unread.";

/** Hotfix 3 (L4): items under Today, Yesterday and Earlier (the tray; the notifications page may use it too). */
export function InboxGroups({ items, onOpen, day = today() }: { items: InboxItem[]; onOpen: (i: InboxItem) => void; day?: string }) {
  return (
    <>
      {groupByDay(items, day).map((g) => (
        <div className="inbox-group" key={g.label} data-testid="inbox-group">
          <div className="inbox-day">{g.label}</div>
          <InboxList items={g.items} onOpen={onOpen} />
        </div>
      ))}
    </>
  );
}

/** The tray shows at most this many items; the rest are on the notifications page. */
export const TRAY_ITEMS = 15;

/** The desktop panel beside the rail: All / Unread, the newest items by day, Mark all read, All notifications, Close. */
function InboxPanel({ api, onClose }: { api: InboxApi; onClose: () => void }) {
  const all = api.inbox?.items ?? [];
  const unread = api.inbox?.unread ?? 0;
  const total = api.inbox?.total ?? all.length;
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [msg, setMsg] = useState<string | null>(null);
  const items = filterInbox(all, filter).slice(0, TRAY_ITEMS);
  const chip = (f: InboxFilter, label: string) => (
    <button type="button" className="chip small" aria-pressed={filter === f} onClick={() => setFilter(f)}>{label}</button>
  );
  return (
    <div className="inbox-panel" role="region" aria-label="Notifications" data-testid="inbox-panel">
      <div className="inbox-head">
        <b className="grow">Notifications</b>
        {unread > 0 && (
          <button type="button" className="btn small" onClick={() => { setMsg(null); api.readAll().catch(() => setMsg("Could not mark them read. Try again.")); }}>
            Mark all read
          </button>
        )}
        <button type="button" className="btn small icon-btn" aria-label="Close notifications" onClick={onClose}><Icon name="close" /></button>
      </div>
      <div className="inbox-filter" role="group" aria-label="Show">
        {chip("all", "All")}
        {chip("unread", unread ? `Unread (${unreadBadge(unread)})` : "Unread")}
      </div>
      {msg && <div className="inbox-msg">{msg}</div>}
      {items.length
        ? <InboxGroups items={items} onOpen={(i) => api.read([i.id])} />
        : <div className="inbox-empty">{filter === "unread" && all.length ? INBOX_NONE_UNREAD : INBOX_EMPTY}</div>}
      <Link className="bell-all" to="/inbox">All notifications{total > items.length ? ` (${total})` : ""}</Link>
    </div>
  );
}

/** The one notification icon (Hotfix 3, L4): a panel on a desktop, the /inbox page on a phone. */
export function InboxBell() {
  const api = useInbox();
  const phone = useIsPhone();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setOpen(false), [pathname]);
  if (!api?.active) return null;
  const n = api.inbox?.unread ?? 0;
  const label = n ? `Notifications: ${n} unread` : "Notifications";
  const inner = (
    <>
      <Icon name="inbox" />
      {n > 0 && <span className="badge" data-testid="inbox-count">{unreadBadge(n)}</span>}
    </>
  );
  if (phone) return <div className="inbox-bell"><Link className="bell-btn" to="/inbox" aria-label={label} title="Notifications">{inner}</Link></div>;
  return (
    <div className="inbox-bell">
      <button type="button" className="bell-btn" aria-label={label} title="Notifications" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{inner}</button>
      {open && <InboxPanel api={api} onClose={() => setOpen(false)} />}
    </div>
  );
}

/** A banner per new item: who and what, Open (marks it read), Close. They stay until closed or opened. */
export function InboxBanners() {
  const api = useInbox();
  const { me } = useFleet();
  const toast = useToast();
  if (!api?.banners.length) return null;
  return (
    <section className="inbox-banners" aria-label="New notifications" aria-live="polite">
      {api.banners.map((b) => {
        const link = itemLink(b, canOpenTask(me));
        return (
          <div key={b.id} className={`inbox-banner ${b.kind}`} data-testid="inbox-banner">
            <i className={`dot ${KIND_TONE[b.kind] || "live"}`} aria-hidden="true" />
            <div className="grow">
              <b>{headline(b)}</b>
              {b.body && <div className="sub">{datesInWords(b.body)}</div>}
            </div>
            <div className="acts">
              {/* Round 4–7 (7): an ask's Yes / No right on the banner; answered, it is read (the banner goes) and a toast says so. */}
              <InboxActions item={b} onDone={(label) => { toast(saidText(label)); api.read([b.id]); }} />
              {link && "to" in link && <Link className="btn small dark" to={link.to} onClick={() => api.read([b.id])}>Open</Link>}
              {link && "href" in link && <a className="btn small dark" href={link.href} target="_blank" rel="noreferrer" onClick={() => api.read([b.id])}>Open</a>}
              <button type="button" className="btn small icon-btn" aria-label="Close" onClick={() => api.dismiss(b.id)}><Icon name="close" /></button>
            </div>
          </div>
        );
      })}
    </section>
  );
}

/** Until the page's first click: the browser keeps it silent. One click anywhere (this strip too) turns sounds on. */
export function SoundStrip() {
  const api = useInbox();
  if (!api?.active || !api.inbox || api.unlocked || !api.sound.on || api.sound.volume <= 0) return null;
  return (
    <button type="button" className="sound-strip" data-testid="sound-strip" onClick={() => void api.unlock()}>
      <Icon name="inbox" />
      <span>Click to turn on sounds</span>
      <small>The browser keeps this page quiet until you click.</small>
    </button>
  );
}
