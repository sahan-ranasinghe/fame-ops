// The one slide-in panel every form dialog uses (full width on phones), and
// the closing rules no form can get wrong:
//   - a click outside the panel does nothing;
//   - Close (the X), Cancel and Esc ask "Discard changes?" first when a form in
//     the panel has unsaved input (useDraft / useDirty report that);
//   - close() is for code that has just saved: it closes at once;
//   - while any form (in the panel or on the page) is dirty, leaving the page
//     warns (beforeunload).
import { createContext, type Dispatch, type ReactNode, type SetStateAction, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./icons";

type Scope = "panel" | "page";

interface DrawerApi {
  open: (node: ReactNode) => void;
  /** Closes at once, no question: for code that has just saved. */
  close: () => void;
  /** What Close, Cancel and Esc do: asks first when a form in the panel is dirty. */
  requestClose: () => void;
  isOpen: boolean;
  /** Forms report unsaved input here (through useDirty / useDraft). */
  setDirty: (key: string, dirty: boolean, scope: Scope) => void;
}

const Ctx = createContext<DrawerApi>({ open: () => {}, close: () => {}, requestClose: () => {}, isOpen: false, setDirty: () => {} });
/** True inside the panel: a form there blocks Close until the question is answered. */
const InPanel = createContext(false);
export const useDrawer = () => useContext(Ctx);

export const DISCARD_TITLE = "Discard changes?";
export const DISCARD_TEXT = "What you typed in this panel will be lost.";

let serial = 0;

export function DrawerProvider({ children }: { children: ReactNode }) {
  const [node, setNode] = useState<ReactNode>(null);
  const [asking, setAsking] = useState(false);
  const [dirtyCount, setDirtyCount] = useState(0);
  const dirty = useRef(new Map<string, Scope>());
  const panel = useRef<HTMLDivElement>(null);

  const setDirty = useCallback((key: string, value: boolean, scope: Scope) => {
    if (value) dirty.current.set(key, scope);
    else dirty.current.delete(key);
    setDirtyCount(dirty.current.size);
  }, []);
  const panelDirty = () => [...dirty.current.values()].some((s) => s === "panel");

  const open = useCallback((n: ReactNode) => {
    setAsking(false);
    setNode(n);
  }, []);
  const close = useCallback(() => {
    setAsking(false);
    setNode(null);
  }, []);
  const requestClose = useCallback(() => {
    if (panelDirty()) setAsking(true);
    else close();
  }, [close]);
  const api = useMemo(() => ({ open, close, requestClose, isOpen: node !== null, setDirty }), [open, close, requestClose, node, setDirty]);

  useEffect(() => {
    if (node === null) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") requestClose();
    };
    document.addEventListener("keydown", onKey);
    const f = panel.current?.querySelector<HTMLElement>("[data-focus], button");
    f?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [node, requestClose]);

  // Leaving the page with unsaved input anywhere: the browser asks.
  useEffect(() => {
    if (dirtyCount === 0) return;
    const warn = (ev: BeforeUnloadEvent) => {
      ev.preventDefault();
      ev.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirtyCount]);

  return (
    <Ctx.Provider value={api}>
      {children}
      {node !== null && (
        <div className="drawer" data-testid="drawer">
          <div className="drawer-panel" role="dialog" aria-modal="true" ref={panel}>
            {asking && (
              <div className="discard" role="alertdialog" aria-labelledby="discard-title" data-testid="discard">
                <b id="discard-title">{DISCARD_TITLE}</b>
                <p className="muted" style={{ margin: 0 }}>{DISCARD_TEXT}</p>
                <div className="acts">
                  <button type="button" className="btn" onClick={() => setAsking(false)} data-focus>Keep editing</button>
                  <button type="button" className="btn danger" onClick={close}>Discard</button>
                </div>
              </div>
            )}
            <InPanel.Provider value={true}>{node}</InPanel.Provider>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

/** Tells the drawer whether this form has unsaved input (in the panel: Close asks; anywhere: leaving the page warns). */
export function useDirty(isDirty: boolean): void {
  const { setDirty } = useDrawer();
  const inPanel = useContext(InPanel);
  const [key] = useState(() => `form-${++serial}`);
  useEffect(() => {
    setDirty(key, isDirty, inPanel ? "panel" : "page");
    return () => setDirty(key, false, inPanel ? "panel" : "page");
  }, [key, isDirty, inPanel, setDirty]);
}

/**
 * A form's fields as one state, dirty whenever they differ from where they
 * started. markClean() after a save that keeps the panel open; markClean(next)
 * to start again from new values.
 */
export function useDraft<T>(initial: T): [T, Dispatch<SetStateAction<T>>, (next?: T) => void] {
  const [value, setValue] = useState<T>(initial);
  const [base, setBase] = useState<T>(initial);
  const valueRef = useRef(value);
  valueRef.current = value;
  useDirty(JSON.stringify(value) !== JSON.stringify(base));
  const markClean = useCallback((next?: T) => {
    setBase(next ?? valueRef.current);
    if (next !== undefined) setValue(next);
  }, []);
  return [value, setValue, markClean];
}

export function DrawerTop({ title, sub }: { title: string; sub?: ReactNode }) {
  const { requestClose } = useDrawer();
  return (
    <div className="drawer-top">
      <div>
        {sub && <div className="eyebrow">{sub}</div>}
        <h2>{title}</h2>
      </div>
      <button type="button" className="btn icon-btn" onClick={requestClose} aria-label="Close" data-focus>
        <Icon name="close" />
      </button>
    </div>
  );
}
