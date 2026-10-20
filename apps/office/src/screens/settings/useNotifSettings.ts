// Hotfix O2-H2, Part 2: the person's notification settings for Settings → Notifications and its group pages (GitHub's
// and Gmail's settings pages; the app's Notifications screens follow the same shared rules, notificationGroups.ts). A box
// flips at once and is saved in the background (set_my_notification_settings, only the events that change); a failed
// save turns it back and says so in the toast. No Save button.
//
// Pause all: every shown event off, and what each one was kept with the person's preferences (my_prefs
// notifications_paused), so Resume in any browser or on the phone puts them back; also in this browser (localStorage, per
// person), the copy read while the server does not keep it (an older office-api refuses the key).
import { useCallback, useEffect, useRef, useState } from "react";
import { useFleet } from "../../app/FleetContext";
import type { NotificationSettings } from "../../data/types";
import { callWithRetry } from "../../transport/retryRule";
import { asFleetError, errText } from "../../transport/errors";
import { useToast } from "../../ui/Toast";
import {
  applyChanges,
  groupsFor,
  NOTIF_TEXT,
  notifState,
  pauseChanges,
  type PauseRecord,
  resumeChanges,
  undoChanges,
} from "./notificationGroups";
import { setEvents } from "./notificationsActions";

const TOOL_ARGS = {};

/** Where this browser keeps the pause record (per person: two people may share a browser). */
export const pauseStorageKey = (who: { email?: string; name: string }) => `fleet.notifPause.${(who.email ?? who.name).toLowerCase()}`;

function readPause(key: string): PauseRecord | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as PauseRecord) : null;
  } catch {
    return null;
  }
}
function writePause(key: string, rec: PauseRecord | null) {
  try {
    if (rec) localStorage.setItem(key, JSON.stringify(rec));
    else localStorage.removeItem(key);
  } catch {
    /* no storage: Resume turns everything on */
  }
}

export function useNotifSettings() {
  const { transport, me } = useFleet();
  const toast = useToast();
  const [data, setData] = useState<NotificationSettings | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const latest = useRef<NotificationSettings | null>(null);
  latest.current = data;
  const perms = me.permissions;

  const load = useCallback(async () => {
    try {
      setData(await callWithRetry<NotificationSettings>(transport, "my_notification_settings", TOOL_ARGS));
      setErr(null);
    } catch (e) {
      setErr(errText(asFleetError(e))[0]);
    }
  }, [transport]);
  useEffect(() => {
    void load();
  }, [load]);

  /** Flips the events at once, saves them, puts them back when the save fails. True when saved. */
  const save = useCallback(async function save(changes: Record<string, boolean>): Promise<boolean> {
    if (Object.keys(changes).length === 0) return true;
    const back = undoChanges(latest.current?.events ?? [], changes);
    setData((d) => d && { ...d, events: applyChanges(d.events, changes) });
    try {
      await setEvents(transport, changes);
      return true;
    } catch (e) {
      setData((d) => d && { ...d, events: applyChanges(d.events, back) });
      // The switch turns back; Try again sends the same change (Instagram), never by itself.
      toast(`${NOTIF_TEXT.notSaved} ${errText(asFleetError(e))[0]}`, { label: "Try again", onClick: () => void save(changes) });
      return false;
    }
  }, [transport, toast]);

  const key = pauseStorageKey(me);
  const mayPrefs = me.tools.includes("my_prefs");
  const maySetPrefs = me.tools.includes("set_my_prefs");
  // The server's record: undefined until known or when it keeps none of its own (then this browser's copy is read).
  const kept = useRef<PauseRecord | null | undefined>(undefined);
  useEffect(() => {
    if (!mayPrefs) return;
    let alive = true;
    callWithRetry<{ prefs?: Record<string, unknown> }>(transport, "my_prefs", {}).then((r) => {
      if (alive && r.prefs && "notifications_paused" in r.prefs) kept.current = r.prefs.notifications_paused as PauseRecord | null;
    }, () => undefined);
    return () => {
      alive = false;
    };
  }, [transport, mayPrefs]);
  const keepRecord = useCallback((record: PauseRecord | null) => {
    writePause(key, record);
    if (!maySetPrefs) return;
    transport.call("set_my_prefs", { prefs: { notifications_paused: record } }).then(() => {
      kept.current = record;
    }, () => undefined);
  }, [key, maySetPrefs, transport]);
  // One Pause or Resume at a time: a second click while the first saves is ignored (the records stay in order).
  const switching = useRef(false);
  const pause = useCallback(async () => {
    if (switching.current) return;
    switching.current = true;
    try {
      const { record, changes } = pauseChanges(latest.current?.events ?? [], perms, new Date().toISOString());
      if (await save(changes)) keepRecord(record);
    } finally {
      switching.current = false;
    }
  }, [perms, save, keepRecord]);
  const resume = useCallback(async () => {
    if (switching.current) return;
    switching.current = true;
    try {
      const record = kept.current !== undefined ? kept.current : readPause(key);
      if (await save(resumeChanges(record, latest.current?.events ?? [], perms))) keepRecord(null);
    } finally {
      switching.current = false;
    }
  }, [key, perms, save, keepRecord]);

  const events = data?.events ?? [];
  const state = notifState(events, perms);
  return {
    data,
    setData,
    err,
    reload: load,
    groups: groupsFor(events, perms),
    state,
    paused: state === "paused",
    setEvent: (event: string, on: boolean) => save({ [event]: on }),
    pause,
    resume,
  };
}
