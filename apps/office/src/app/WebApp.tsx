// The office web app: everyone signs in with their own account; office-api
// checks the session and the role on every call.
import { useEffect, useMemo, useState } from "react";
import { createBrowserRouter, RouterProvider } from "react-router";
import { AuthProvider, useAuth } from "../auth/AuthProvider";
import { Blocked } from "../auth/Blocked";
import { SecondStep } from "../auth/SecondStep";
import { SetPassword } from "../auth/SetPassword";
import { SignIn } from "../auth/SignIn";
import { subscribeDriverLatest, subscribeDriverPoints, subscribeDriversPoints, subscribeInbox, subscribeIssues } from "../data/realtime";
import { FleetStore } from "../data/store";
import { uploadToTicket } from "../data/upload";
import { registerServiceWorker } from "../push";
import type { Me } from "../transport/types";
import { ToastProvider } from "../ui/Toast";
import { FleetProvider } from "./FleetContext";
import { routes } from "./routes";

function Gate() {
  const auth = useAuth();
  const signedIn = auth.state.step === "ready" ? auth.state.me : null;
  // Hotfix 2 (F): /me asked again after a change to the person's own details (their phone number). The store and the
  // router stay (no page reset): only `me` changes. A new sign-in starts from its own answer.
  const [fresh, setFresh] = useState<{ of: Me; me: Me } | null>(null);
  const me = signedIn && fresh?.of === signedIn ? fresh.me : signedIn;
  const base = useMemo(() => {
    if (!signedIn) return null;
    return {
      store: new FleetStore(auth.transport),
      transport: auth.transport,
      noConnector: false,
      signOut: () => void auth.signOut(),
      refreshMe: async () => {
        const next = await auth.transport.me();
        setFresh({ of: signedIn, me: next });
      },
      realtime: {
        driverLatest: subscribeDriverLatest,
        driverPoints: subscribeDriverPoints,
        driversPoints: subscribeDriversPoints,
        issues: subscribeIssues,
        inbox: subscribeInbox,
      },
      files: { upload: uploadToTicket },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, auth.transport]);
  const fleet = useMemo(() => (base && me ? { ...base, me } : null), [base, me]);
  const router = useMemo(() => (base ? createBrowserRouter(routes) : null), [base]);
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
            <RouterProvider router={router!} />
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
