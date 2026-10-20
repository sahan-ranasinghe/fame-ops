// One toast (docs/ui-patterns.md §10): one line at the bottom, 4 s, never over the primary button (the CSS lifts it over
// the phone's tab bar). A reversible action says what happened with Undo for 6 s (Gmail's "Conversation archived ·
// Undo"). Errors are never toasts: they stay on the screen with Try again.
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";

export const TOAST_MS = 4000;
export const UNDO_MS = 6000;

export interface ToastOptions {
  /** Undo for UNDO_MS: called once when pressed (the toast closes). */
  undo?: () => void;
}

type ToastFn = (msg: string, opts?: ToastOptions) => void;

const Ctx = createContext<ToastFn>(() => {});
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState<{ msg: string; undo?: () => void } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toast = useCallback<ToastFn>((m, opts) => {
    setShown({ msg: m, undo: opts?.undo });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setShown(null), opts?.undo ? UNDO_MS : TOAST_MS);
  }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const undo = shown?.undo;
  return (
    <Ctx.Provider value={toast}>
      {children}
      <div id="toast" role="status" hidden={shown === null} className={undo ? "with-undo" : undefined}>
        {undo ? <><span>{shown?.msg}</span><button type="button" className="toast-undo" onClick={() => { setShown(null); undo(); }}>Undo</button></> : shown?.msg}
      </div>
    </Ctx.Provider>
  );
}
