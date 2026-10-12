import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./icons";

interface DrawerApi {
  open: (node: ReactNode) => void;
  close: () => void;
  isOpen: boolean;
}

const Ctx = createContext<DrawerApi>({ open: () => {}, close: () => {}, isOpen: false });
export const useDrawer = () => useContext(Ctx);

/** One slide-in panel on the right (full width on phones). Escape, the backdrop and the X close it. */
export function DrawerProvider({ children }: { children: ReactNode }) {
  const [node, setNode] = useState<ReactNode>(null);
  const panel = useRef<HTMLDivElement>(null);
  const open = useCallback((n: ReactNode) => setNode(n), []);
  const close = useCallback(() => setNode(null), []);
  const api = useMemo(() => ({ open, close, isOpen: node !== null }), [open, close, node]);

  useEffect(() => {
    if (node === null) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    const f = panel.current?.querySelector<HTMLElement>("[data-focus], button");
    f?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [node, close]);

  return (
    <Ctx.Provider value={api}>
      {children}
      {node !== null && (
        <div className="drawer" onClick={(ev) => { if (ev.target === ev.currentTarget) close(); }}>
          <div className="drawer-panel" role="dialog" aria-modal="true" ref={panel}>
            {node}
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

export function DrawerTop({ title, sub }: { title: string; sub?: ReactNode }) {
  const { close } = useDrawer();
  return (
    <div className="drawer-top">
      <div>
        {sub && <div className="eyebrow">{sub}</div>}
        <h2>{title}</h2>
      </div>
      <button type="button" className="btn icon-btn" onClick={close} aria-label="Close" data-focus>
        <Icon name="close" />
      </button>
    </div>
  );
}
