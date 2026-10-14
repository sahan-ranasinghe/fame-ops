// The office web app: everyone signs in with their own account; office-api
// checks the session and the role on every call.
import { useEffect, useMemo } from "react";
import { createBrowserRouter, RouterProvider } from "react-router";
import { AuthProvider, useAuth } from "../auth/AuthProvider";
import { Blocked } from "../auth/Blocked";
import { SecondStep } from "../auth/SecondStep";
import { SetPassword } from "../auth/SetPassword";
import { SignIn } from "../auth/SignIn";
import { subscribeDriverLatest } from "../data/realtime";
import { FleetStore } from "../data/store";
import { registerServiceWorker } from "../push";
import { DrawerProvider } from "../ui/Drawer";
import { ToastProvider } from "../ui/Toast";
import { FleetProvider } from "./FleetContext";
import { routes } from "./routes";

function Gate() {
  const auth = useAuth();
  const fleet = useMemo(() => {
    if (auth.state.step !== "ready") return null;
    return {
      store: new FleetStore(auth.transport),
      transport: auth.transport,
      me: auth.state.me,
      noConnector: false,
      signOut: () => void auth.signOut(),
      realtime: { driverLatest: subscribeDriverLatest },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.state.step === "ready" ? auth.state.me : null, auth.transport]);
  const router = useMemo(() => (fleet ? createBrowserRouter(routes) : null), [fleet]);
  // Signed in: the service worker (push notifications; a tap on one opens its link here).
  useEffect(() => {
    if (!router) return;
    return registerServiceWorker((path) => void router.navigate(path));
  }, [router]);

  switch (auth.state.step) {
    case "loading":
      return <div className="loading" style={{ padding: 40 }}>Opening Fame Fleet…</div>;
    case "signed_out":
      return <SignIn />;
    case "set_password":
      return <SetPassword />;
    case "second_step":
      return <SecondStep />;
    case "blocked":
      return <Blocked />;
    case "ready":
      return (
        <FleetProvider value={fleet!}>
          <ToastProvider>
            <DrawerProvider>
              <RouterProvider router={router!} />
            </DrawerProvider>
          </ToastProvider>
        </FleetProvider>
      );
  }
}

export function WebApp() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
