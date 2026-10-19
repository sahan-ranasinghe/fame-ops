// Sign-in for the web app (docs/office-web-plan.md, section 5):
//   e-mail + password → (the person turned 2-step on? → their code) → office-api /me → ready
//   a set-password link (from create_office_user) lands here with a recovery session → choose a password → ready
// 2-step sign-in is optional: a person turns it on in Settings. If the office
// makes it compulsory for a role (secret REQUIRE_MFA_ROLES), office-api answers
// mfa_required and the person is asked to set it up before anything loads.
// Only a 401 or 403 is "signed out" (Sahan, 19 October 2026): a /me that is dropped (no connection, a 5xx) is asked again
// once (ApiTransport.me) and then shows "Fame Fleet did not answer" with Try again, the person still signed in.
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ApiTransport } from "../transport/api";
import type { FleetError, Me } from "../transport/types";
import { dropped } from "../transport/retryRule";
import { sessionKind } from "./session";
import { accessToken, apiBase, configured, recoveryLink, supabase } from "./supabase";

export type AuthState =
  | { step: "loading" }
  | { step: "signed_out"; notice?: string }
  | { step: "set_password" }
  | { step: "second_step"; mode: "verify"; factorId: string }
  | { step: "second_step"; mode: "enrol" }
  | { step: "blocked"; reason: "not_an_office_user" | "switched_off" | "not_configured" }
  /** Signed in, but Fame Fleet did not answer (or refused for another reason): Try again; the session is kept. */
  | { step: "unreachable"; message: string }
  | { step: "ready"; me: Me };

interface AuthApi {
  state: AuthState;
  transport: ApiTransport;
  signIn(email: string, password: string): Promise<string | null>;
  setPassword(password: string): Promise<string | null>;
  verifyCode(code: string): Promise<string | null>;
  /** After the person set up 2-step on the second-step page, or Try again after Fame Fleet did not answer: ask office-api again. */
  recheck(): Promise<void>;
  signOut(): Promise<void>;
}

const Ctx = createContext<AuthApi | null>(null);

/** What the page says when Fame Fleet did not answer /me (or the token's refresh did not get through). */
export const UNREACHABLE = "Fame Fleet did not answer.";

export function useAuth(): AuthApi {
  const a = useContext(Ctx);
  if (!a) throw new Error("AuthProvider is missing");
  return a;
}

/** The person's verified authenticator, if they turned 2-step on. */
export async function verifiedTotpFactor(): Promise<{ id: string } | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.mfa.listFactors();
  return data?.totp.find((f) => f.status === "verified") ?? null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ step: "loading" });
  const transport = useMemo(() => new ApiTransport(apiBase, accessToken), []);
  // A recovery link is being handled: ignore sign-in events until the password is set.
  const recovering = useRef(recoveryLink);

  /** Who is this? The person's own 2-step first, then office-api decides the rest. */
  const check = useCallback(async () => {
    if (recovering.current || !supabase) return;
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
      const factor = await verifiedTotpFactor();
      if (factor) {
        setState({ step: "second_step", mode: "verify", factorId: factor.id });
        return;
      }
    }
    try {
      const me = await transport.me();
      setState({ step: "ready", me });
    } catch (e) {
      const err = e as FleetError;
      if (err.code === "mfa_required") {
        const factor = await verifiedTotpFactor();
        setState(factor ? { step: "second_step", mode: "verify", factorId: factor.id } : { step: "second_step", mode: "enrol" });
      } else if (err.code === "not_an_office_user" || err.code === "switched_off") setState({ step: "blocked", reason: err.code });
      else if (err.code === "not_signed_in") setState({ step: "signed_out" });
      else if (err.code === "forbidden") setState({ step: "signed_out", notice: err.message });
      else setState({ step: "unreachable", message: dropped(err) ? UNREACHABLE : err.message });
    }
  }, [transport]);

  useEffect(() => {
    if (!supabase || !configured) {
      setState({ step: "blocked", reason: "not_configured" });
      return;
    }
    // A set-password link pasted into a tab that already shows the app (after a sign-out the
    // URL is "/"): the browser changes only the hash and does not load the page again, so the
    // link would never be read. Load it again, as a fresh tab would.
    const onHash = () => {
      if (/[#&]type=recovery(&|$)/.test(location.hash)) location.reload();
    };
    window.addEventListener("hashchange", onHash);
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        recovering.current = true;
        setState({ step: "set_password" });
      } else if (event === "SIGNED_OUT") {
        setState({ step: "signed_out" });
      }
    });
    void supabase.auth.getSession().then((answer) => {
      const kind = sessionKind(answer);
      if (recovering.current) {
        setState({ step: "set_password" });
      } else if (kind === "ok") {
        void check();
      } else if (kind === "offline") {
        // The session is stored but its token could not be refreshed (no connection): still signed in.
        setState({ step: "unreachable", message: UNREACHABLE });
      } else {
        setState({ step: "signed_out" });
      }
    });
    return () => {
      window.removeEventListener("hashchange", onHash);
      sub.subscription.unsubscribe();
    };
  }, [check]);

  const api: AuthApi = useMemo(() => ({
    state,
    transport,
    async signIn(email, password) {
      if (!supabase) return "Not configured.";
      // The sign-in page stays on screen (with its own busy state) so a wrong password shows there.
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      if (error) return /invalid/i.test(error.message) ? "Wrong e-mail or password." : error.message;
      await check();
      return null;
    },
    async setPassword(password) {
      if (!supabase) return "Not configured.";
      const { error } = await supabase.auth.updateUser({ password });
      if (error) return error.message;
      recovering.current = false;
      history.replaceState(null, "", "/");
      setState({ step: "loading" });
      await check();
      return null;
    },
    async verifyCode(code) {
      if (!supabase || state.step !== "second_step" || state.mode !== "verify") return "Not ready.";
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: state.factorId, code: code.replace(/\s/g, "") });
      if (error) return /invalid|expired/i.test(error.message) ? "That code is not right. Try the next one." : error.message;
      setState({ step: "loading" });
      await check();
      return null;
    },
    async recheck() {
      setState({ step: "loading" });
      await check();
    },
    async signOut() {
      if (!supabase) return;
      await supabase.auth.signOut();
      history.replaceState(null, "", "/"); // the next sign-in starts on Overview
      setState({ step: "signed_out" });
    },
  }), [state, transport, check]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
