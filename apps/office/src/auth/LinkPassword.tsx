// Round 49 (29 October 2026): the set-password link's page (Google Workspace's and Slack's invite pattern). The link is
// <site>/set-password#k=<token> (passwordLinks.ts on the server): opening it any number of times only asks its state
// (office-api POST /public/password-link); Save password is the one call that uses it (POST /public/password-link/set),
// then the page signs the person in with the new password and opens the app. A link that can no longer be used
// (used, replaced by a newer one, 7 days old, the password set another way, the account off), or none at all, gets one
// friendly sentence in the chosen language, never a blank page or a technical error. Shown before the sign-in gate,
// like /privacy (WebApp), so a person already signed in on this browser still sees it.
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Notice } from "../ui/basics";
import { SecretField } from "../ui/SecretField";
import { AuthPage } from "./AuthPage";
import { type LinkLang, linkToken, linkWord, type LinkWord, startLang } from "./linkWords";
import { apiBase, supabase } from "./supabase";

const LANG_KEY = "fame.linkLang";
const MIN = 12;
const MAX_BYTES = 72;

type Checked = { state: "valid"; name: string; email: string } | { state: string };

/** office-api's two public answers; tests pass fakes. `status` 0 = no answer (no connection). */
export interface LinkApi {
  check(token: string): Promise<{ status: number; body: Checked | null }>;
  save(token: string, password: string): Promise<{ status: number; body: { email?: string; state?: string; error?: string; message?: string } | null }>;
}

async function post(path: string, body: unknown) {
  try {
    const res = await fetch(`${apiBase}/public/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  } catch {
    return { status: 0, body: null };
  }
}

export const linkApi: LinkApi = {
  check: (token) => post("password-link", { token }),
  save: (token, password) => post("password-link/set", { token, password }),
};

/** Signs in with the new password; false when it did not work (the page then offers Sign in). */
async function signInWith(email: string, password: string): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return !error;
}

function savedLang(): string | null {
  try {
    return localStorage.getItem(LANG_KEY);
  } catch {
    return null;
  }
}

type Phase =
  | { at: "checking" }
  | { at: "form"; name: string; email: string }
  | { at: "dead" }
  | { at: "unreachable"; word: LinkWord }
  | { at: "saved"; signedIn: boolean };

export function LinkPassword({
  hash = typeof location !== "undefined" ? location.hash : "",
  api = linkApi,
  signIn = signInWith,
  openApp = () => location.replace("/"),
}: {
  hash?: string;
  api?: LinkApi;
  signIn?: (email: string, password: string) => Promise<boolean>;
  openApp?: () => void;
} = {}) {
  const [token] = useState(() => linkToken(hash));
  const [lang, setLang] = useState<LinkLang>(() => startLang(savedLang(), typeof navigator !== "undefined" ? navigator.language : undefined));
  const w = (key: LinkWord, values?: Record<string, string>) => linkWord(lang, key, values);
  const [phase, setPhase] = useState<Phase>(token ? { at: "checking" } : { at: "dead" });
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ word: LinkWord } | { text: string } | null>(null);

  const check = useCallback(async () => {
    if (!token) return;
    setPhase({ at: "checking" });
    const { status, body } = await api.check(token);
    if (status === 200 && body?.state === "valid" && "email" in body) setPhase({ at: "form", name: body.name, email: body.email });
    else if (status === 200) setPhase({ at: "dead" });
    else setPhase({ at: "unreachable", word: status === 429 ? "rateLimited" : "noAnswer" });
  }, [api, token]);

  useEffect(() => {
    void check();
  }, [check]);

  // Another link pasted into this tab: the browser changes only the hash and does not load the page again, so the page
  // would keep the first link's token. Load it again, as a fresh tab would (AuthProvider does the same for old links).
  useEffect(() => {
    const onHash = () => location.reload();
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  function choose(next: LinkLang) {
    setLang(next);
    try {
      localStorage.setItem(LANG_KEY, next);
    } catch {
      // A private window: the choice lasts this page only.
    }
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    if (!token || phase.at !== "form") return;
    if (p1.length < MIN) return setError({ word: "tooShort" });
    if (new TextEncoder().encode(p1).length > MAX_BYTES) return setError({ word: "tooLong" });
    if (p1 !== p2) return setError({ word: "differ" });
    setError(null);
    setBusy(true);
    const { status, body } = await api.save(token, p1);
    if (status === 200) {
      setPhase({ at: "saved", signedIn: true });
      if (await signIn(body?.email ?? phase.email, p1)) openApp();
      else setPhase({ at: "saved", signedIn: false });
    } else if (status === 409) setPhase({ at: "dead" });
    else if (status === 400) setError({ word: body?.error === "too_long" ? "tooLong" : "tooShort" });
    else if (status === 422) setError({ text: body?.message ?? linkWord(lang, "noAnswer") });
    else setError({ word: status === 429 ? "rateLimited" : "noAnswer" });
    setBusy(false);
  }

  const languages = (
    <div className="segmented" role="tablist" aria-label={w("language")} style={{ justifySelf: "start" }}>
      {(["en", "si"] as const).map((l) => (
        <button key={l} type="button" role="tab" aria-selected={lang === l} lang={l} onClick={() => choose(l)}>
          {l === "en" ? "English" : "සිංහල"}
        </button>
      ))}
    </div>
  );
  const eye = { show: w("show"), hide: w("hide") };

  if (phase.at === "dead") {
    return (
      <AuthPage eyebrow={w("eyebrow")} title={w("deadTitle")}>
        {languages}
        <div className="card card-b" data-testid="link-dead" lang={lang}>
          <p style={{ margin: 0 }}>{w("dead")}</p>
          <p className="muted small" style={{ margin: 0 }}>{w("haveOne")}</p>
          <div><a className="btn" href="/">{w("signIn")}</a></div>
        </div>
      </AuthPage>
    );
  }

  return (
    <AuthPage eyebrow={w("eyebrow")} title={w("title")}>
      {languages}
      {phase.at === "checking" && <p className="muted" role="status">{w("checking")}</p>}
      {phase.at === "unreachable" && (
        <div className="card card-b">
          <Notice tone="bad">{w(phase.word)}</Notice>
          <div><button type="button" className="btn" onClick={() => void check()}>{w("tryAgain")}</button></div>
        </div>
      )}
      {phase.at === "saved" && (
        <div className="card card-b" role="status">
          <p style={{ margin: 0 }}>{w(phase.signedIn ? "savedSigningIn" : "savedSignIn")}</p>
          {!phase.signedIn && <div><a className="btn primary" href="/">{w("signIn")}</a></div>}
        </div>
      )}
      {phase.at === "form" && (
        <form className="card card-b form" onSubmit={submit} noValidate lang={lang}>
          <p className="muted small" style={{ margin: 0 }} data-testid="link-for">{w("forWho", { name: phase.name, email: phase.email })}</p>
          {/* The e-mail for the browser's password manager, so the saved password is filed under the right account. */}
          <input type="email" autoComplete="username" value={phase.email} readOnly hidden />
          <div className="field">
            <label htmlFor="sp-1">{w("newPassword")}</label>
            <SecretField id="sp-1" autoComplete="new-password" value={p1} onChange={(e) => setP1(e.target.value)} autoFocus words={eye} />
            <span className="hint">{w("hint")}</span>
          </div>
          <div className="field">
            <label htmlFor="sp-2">{w("again")}</label>
            <SecretField id="sp-2" autoComplete="new-password" value={p2} onChange={(e) => setP2(e.target.value)} words={eye} />
          </div>
          {error && <Notice tone="bad">{"word" in error ? w(error.word) : error.text}</Notice>}
          <button className="btn primary wide" type="submit" disabled={busy}>{busy ? w("saving") : w("save")}</button>
        </form>
      )}
    </AuthPage>
  );
}
