// Drafts: every form saves what was typed, per person and form (and record for
// an edit), in the browser's localStorage, on every change. Leaving the page
// keeps it; coming back offers "Resume draft from HH:MM · Discard"; Save or
// Discard clears it. The key is the person's e-mail (web) or "artifact".
import { type Dispatch, type SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFleet } from "../app/FleetContext";

export const DRAFT_PREFIX = "fame-fleet:draft:";
/** Saved this long after the last change (and at once when the page is hidden). */
export const DRAFT_SAVE_MS = 300;

export interface Draft<T> {
  at: number;
  state: T;
}

export const draftKey = (user: string, form: string, record?: string | null) => `${DRAFT_PREFIX}${user}:${form}${record ? `:${record}` : ""}`;

function storage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function readDraft<T>(key: string): Draft<T> | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft<T>;
    return d && typeof d.at === "number" && "state" in d ? d : null;
  } catch {
    return null;
  }
}

export function writeDraft<T>(key: string, state: T, at = Date.now()): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(key, JSON.stringify({ at, state }));
  } catch {
    // Full or blocked storage: the form still works, the draft is just not kept.
  }
}

export function removeDraft(key: string): void {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(key);
  } catch {
    // Nothing to remove.
  }
}

export interface DraftControls<T = unknown> {
  /** A draft from an earlier visit that has not been resumed or discarded yet. */
  saved: { at: number } | null;
  resume: () => void;
  discard: () => void;
  /** After a successful save: the draft is gone and nothing more is saved until the next change. */
  clear: () => void;
  /** Sets the form to what was loaded (an edit page's record) without counting it as a change. */
  reset: (value: T) => void;
}

/**
 * The form's state with its draft: `[value, setValue, draft]`. A change after
 * the first render is saved 300 ms later (and at once when the page is hidden);
 * an earlier draft is offered through `draft.saved` until resumed or discarded,
 * or until the person starts typing afresh (then the new text replaces it).
 */
export function useFormDraft<T>(form: string, record: string | null, initial: T | (() => T), enabled = true): [T, Dispatch<SetStateAction<T>>, DraftControls<T>] {
  const { me } = useFleet();
  const key = draftKey(me.email ?? "artifact", form, record);
  const [value, setValue] = useState<T>(initial);
  const [saved, setSaved] = useState<Draft<T> | null>(() => (enabled ? readDraft<T>(key) : null));
  const changed = useRef(false);
  const cleared = useRef(false);
  const valueRef = useRef(value);
  valueRef.current = value;
  // The value the last run of the save effect saw: only a new value counts as a
  // change (React's StrictMode runs every effect twice on mount with the same value).
  const seen = useRef(value);

  useEffect(() => {
    if (Object.is(seen.current, value)) return;
    seen.current = value;
    if (!enabled || cleared.current) return;
    changed.current = true;
    setSaved(null);
    const timer = setTimeout(() => writeDraft(key, valueRef.current), DRAFT_SAVE_MS);
    return () => clearTimeout(timer);
  }, [value, key, enabled]);

  useEffect(() => {
    if (!enabled) return;
    const flush = () => {
      if (changed.current && !cleared.current) writeDraft(key, valueRef.current);
    };
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [key, enabled]);

  const resume = useCallback(() => {
    const d = readDraft<T>(key);
    if (d) {
      cleared.current = false;
      setValue(d.state);
    }
    setSaved(null);
  }, [key]);
  const discard = useCallback(() => {
    removeDraft(key);
    setSaved(null);
  }, [key]);
  const clear = useCallback(() => {
    cleared.current = true;
    changed.current = false;
    removeDraft(key);
    setSaved(null);
  }, [key]);
  const reset = useCallback((v: T) => {
    seen.current = v;
    setValue(v);
  }, []);

  const controls = useMemo<DraftControls<T>>(() => ({ saved: saved ? { at: saved.at } : null, resume, discard, clear, reset }), [saved, resume, discard, clear, reset]);
  return [value, setValue, controls];
}
