import { type FormEvent, useState } from "react";
import { Notice } from "../ui/basics";
import { AuthPage } from "./AuthPage";
import { useAuth } from "./AuthProvider";

export function SignIn() {
  const auth = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notice = auth.state.step === "signed_out" ? auth.state.notice : undefined;

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    if (!email.trim() || !password) {
      setError("Type your e-mail and password.");
      return;
    }
    setBusy(true);
    setError(await auth.signIn(email, password));
    setBusy(false);
  }

  return (
    <AuthPage eyebrow="Fame Global Solutions" title="Sign in">
      <form className="card card-b form" onSubmit={submit} noValidate>
        {notice && <Notice tone="bad">{notice}</Notice>}
        <div className="field">
          <label htmlFor="si-email">E-mail</label>
          <input id="si-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label htmlFor="si-password">Password</label>
          <input id="si-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <Notice tone="bad">{error}</Notice>}
        <button className="btn primary wide" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        <p className="hint" style={{ margin: 0 }}>Forgot your password? Ask the fleet admin for a new set-password link.</p>
      </form>
    </AuthPage>
  );
}
