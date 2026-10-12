import { Notice } from "../ui/basics";
import { AuthPage } from "./AuthPage";
import { useAuth } from "./AuthProvider";

export function Blocked() {
  const auth = useAuth();
  if (auth.state.step !== "blocked") return null;
  const reason = auth.state.reason;
  const text = reason === "not_configured"
    ? "This copy of Fame Fleet has no Supabase URL and key. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY."
    : reason === "switched_off"
    ? "Your account is switched off. Ask the fleet admin."
    : "This account has no office role in Fame Fleet. Ask the fleet admin to create your office account.";
  return (
    <AuthPage eyebrow="Fame Fleet" title="No access">
      <div className="card card-b" style={{ display: "grid", gap: 14 }}>
        <Notice tone="bad">{text}</Notice>
        {reason !== "not_configured" && <button type="button" className="btn" onClick={() => void auth.signOut()}>Sign out</button>}
      </div>
    </AuthPage>
  );
}
