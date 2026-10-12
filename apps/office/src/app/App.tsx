import { lazy, Suspense } from "react";
import { ArtifactApp } from "./ArtifactApp";

// The web app (sign-in, Supabase Auth, office-api) exists only in the web
// build: in the artifact build this is a constant null and the import is dropped.
const WebApp = __BUILD__ === "web" ? lazy(() => import("./WebApp").then((m) => ({ default: m.WebApp }))) : null;

export function App() {
  if (__BUILD__ === "artifact" || !WebApp) return <ArtifactApp />;
  return (
    <Suspense fallback={<div className="loading" style={{ padding: 40 }}>Opening Fame Fleet…</div>}>
      <WebApp />
    </Suspense>
  );
}
