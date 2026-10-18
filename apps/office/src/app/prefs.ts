// A person's page preferences (Hotfix 3, L1 and L5): which Overview sections and which menu sections are collapsed.
// On the web they are kept per person on the server (my_prefs; set_my_prefs merges what it is given), so they follow
// the person to their phone. The artifact (the shared connector key has no person) and an office-api without the tools
// keep them in this browser. Either way the page reads one copy held here and mirrored in localStorage (wrapped in
// try/catch: private windows and blocked storage still work for the session), so the menu and the Overview agree at
// once and a reload shows the last state before the server answers; the server's answer then settles it.
import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { OfficePrefs } from "../data/types";
import type { Me, Transport } from "../transport/types";
import { useFleet } from "./FleetContext";

export type PrefList = "overview_collapsed" | "menu_collapsed";
const LISTS: PrefList[] = ["overview_collapsed", "menu_collapsed"];

/** The prefs live on the server: the web app (a signed-in person) with the tool. */
export function prefsOnServer(me: Pick<Me, "tools">, kind: Transport["kind"], noConnector = false): boolean {
  return !noConnector && kind === "api" && me.tools.includes("my_prefs");
}

/** The list with `item` collapsed (added) or opened (taken out); a new array, each key once. Pure. */
export function toggled(list: readonly string[] | undefined, item: string, collapsed: boolean): string[] {
  const rest = (list ?? []).filter((k) => k !== item);
  return collapsed ? [...rest, item] : rest;
}

const STORAGE = "fame-fleet.prefs";
/** One copy per person in a browser (the artifact has no person: one for the page). */
export const storageKey = (me: Pick<Me, "email">): string => (me.email ? `${STORAGE}:${me.email.toLowerCase()}` : STORAGE);

const memory = new Map<string, OfficePrefs>();
const listeners = new Set<() => void>();
/** The lists changed on this page since its server copy was asked for: the answer does not undo them. */
const dirty = new Map<string, Set<PrefList>>();
/** The server copy was asked for, per transport and person. */
const synced = new WeakMap<object, Set<string>>();
const EMPTY: OfficePrefs = {};

function clean(p: unknown): OfficePrefs {
  const out: OfficePrefs = {};
  if (!p || typeof p !== "object") return out;
  for (const l of LISTS) {
    const v = (p as Record<string, unknown>)[l];
    if (Array.isArray(v)) out[l] = v.filter((x): x is string => typeof x === "string");
  }
  return out;
}

function snapshot(key: string): OfficePrefs {
  let p = memory.get(key);
  if (!p) {
    try {
      const raw = localStorage.getItem(key);
      p = raw ? clean(JSON.parse(raw)) : EMPTY;
    } catch {
      p = EMPTY;
    }
    memory.set(key, p);
  }
  return p;
}

function put(key: string, p: OfficePrefs) {
  memory.set(key, p);
  try {
    localStorage.setItem(key, JSON.stringify(p));
  } catch {
    /* kept for this page only */
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Tests: forget what this page holds (localStorage stays as the test left it). */
export function resetPrefsMemory() {
  memory.clear();
  dirty.clear();
}

export interface Prefs {
  prefs: OfficePrefs;
  /** Whether a section is collapsed. */
  isCollapsed: (list: PrefList, item: string) => boolean;
  /** Collapses or opens a section: at once on the page, then on the server (or in this browser). */
  setCollapsed: (list: PrefList, item: string, collapsed: boolean) => void;
}

export function usePrefs(): Prefs {
  const { me, transport, noConnector } = useFleet();
  const key = storageKey(me);
  const server = prefsOnServer(me, transport.kind, noConnector);
  const prefs = useSyncExternalStore(subscribe, () => snapshot(key), () => snapshot(key));

  // The server's copy, once per page and person.
  useEffect(() => {
    if (!server) return;
    let done = synced.get(transport);
    if (!done) synced.set(transport, (done = new Set()));
    if (done.has(key)) return;
    done.add(key);
    dirty.set(key, new Set());
    transport.call<{ prefs?: OfficePrefs }>("my_prefs", {}).then(
      (r) => {
        const fromServer = clean(r?.prefs);
        const changed = dirty.get(key) ?? new Set<PrefList>();
        const next: OfficePrefs = { ...snapshot(key) };
        for (const l of LISTS) if (!changed.has(l)) next[l] = fromServer[l] ?? [];
        put(key, next);
      },
      () => done!.delete(key), // asked again next time a section mounts
    );
  }, [server, transport, key]);

  const isCollapsed = useCallback((list: PrefList, item: string) => (prefs[list] ?? []).includes(item), [prefs]);
  const setCollapsed = useCallback((list: PrefList, item: string, collapsed: boolean) => {
    const cur = snapshot(key);
    const next = toggled(cur[list], item, collapsed);
    dirty.get(key)?.add(list);
    put(key, { ...cur, [list]: next });
    if (server && me.tools.includes("set_my_prefs")) {
      transport.call("set_my_prefs", { prefs: { [list]: next } }).catch(() => { /* this browser keeps it */ });
    }
  }, [key, server, me.tools, transport]);

  return { prefs, isCollapsed, setCollapsed };
}
