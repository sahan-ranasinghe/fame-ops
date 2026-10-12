// The Fame Fleet artifact: one HTML file, published to Claude. It uses the
// viewer's "Fame Fleet" connector; there is no key in the page.
import { useEffect, useMemo, useState } from "react";
import { createHashRouter, RouterProvider } from "react-router";
import { FleetStore } from "../data/store";
import { ClaudeTransport, connectClaude } from "../transport/claude";
import { ALL_TOOLS, type Me, type Transport } from "../transport/types";
import { DrawerProvider } from "../ui/Drawer";
import { ToastProvider } from "../ui/Toast";
import { FleetProvider } from "./FleetContext";
import { routes } from "./routes";

/** Outside Claude every call fails with not_granted, and the banner says to open the page in Claude. */
class NoTransport implements Transport {
  readonly kind = "claude" as const;
  me(): Promise<Me> {
    return Promise.resolve({ name: "", role: "admin", tools: ALL_TOOLS });
  }
  call<T>(): Promise<T> {
    return Promise.reject({ code: "not_granted", message: "Fame Fleet is not available on this page." });
  }
  watch(): () => void {
    return () => {};
  }
  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

export function ArtifactApp() {
  const [state, setState] = useState<{ transport: Transport; me: Me } | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const t = (await connectClaude()) ?? new NoTransport();
      const me = await t.me();
      if (alive) setState({ transport: t, me });
    })();
    return () => { alive = false; };
  }, []);

  const fleet = useMemo(() => {
    if (!state) return null;
    const claude = state.transport instanceof ClaudeTransport ? state.transport : null;
    return {
      store: new FleetStore(state.transport),
      transport: state.transport,
      me: state.me,
      noConnector: claude === null,
      managePermissions: claude ? () => claude.managePermissions() : undefined,
    };
  }, [state]);
  const router = useMemo(() => (fleet ? createHashRouter(routes) : null), [fleet]);

  if (!fleet || !router) return <div className="loading" style={{ padding: 40 }}>Opening Fame Fleet…</div>;
  return (
    <FleetProvider value={fleet}>
      <ToastProvider>
        <DrawerProvider>
          <RouterProvider router={router} />
        </DrawerProvider>
      </ToastProvider>
    </FleetProvider>
  );
}
