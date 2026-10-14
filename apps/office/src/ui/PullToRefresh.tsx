// Pull to refresh on a phone: drag down from the top of the page by 70 px and
// everything the page watches is fetched again.
import { type ReactNode, useRef, useState } from "react";
import { useFleet } from "../app/FleetContext";
import { useIsPhone } from "./phone";

export const PULL_PX = 70;

export function PullToRefresh({ children }: { children: ReactNode }) {
  const { store } = useFleet();
  const phone = useIsPhone();
  const startY = useRef<number | null>(null);
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  if (!phone) return <>{children}</>;

  const onStart = (ev: React.TouchEvent) => {
    startY.current = window.scrollY <= 0 ? ev.touches[0].clientY : null;
  };
  const onMove = (ev: React.TouchEvent) => {
    if (startY.current === null || busy) return;
    const dy = ev.touches[0].clientY - startY.current;
    setPull(dy > 0 ? Math.min(dy, PULL_PX * 1.5) : 0);
  };
  const onEnd = () => {
    if (startY.current !== null && pull >= PULL_PX && !busy) {
      setBusy(true);
      void store.invalidate().finally(() => setTimeout(() => setBusy(false), 600));
    }
    startY.current = null;
    setPull(0);
  };
  return (
    <div onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd} onTouchCancel={onEnd}>
      {(pull > 20 || busy) && (
        <div className={`pull ${busy ? "busy" : ""}`} aria-live="polite" data-testid="pull">{busy ? "Refreshing…" : pull >= PULL_PX ? "Release to refresh" : "Pull to refresh"}</div>
      )}
      {children}
    </div>
  );
}
