// Sign-in for the web app (docs/office-web-plan.md, section 5):
//   password → office-api /me → ready
//                              ↳ mfa_required → the second step (enrol a TOTP app, or type the code)
//   a set-password link (from create_office_user) lands here with a recovery session → choose a password
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ApiTransport } from "../transport/api";
import type { FleetError, Me } from "../transport/types";
import { accessToken, apiBase, configured, supabase } from "./supabase";

export type AuthState =
  | { step: "loading" }
  | { step: "signed_out"; notice?: string }
  | { step: "set_password" }
  | { step: "second_step"; mode: "verify" | "enrol"; factorId: string; secret?: string; qr?: string; uri?: string }
  | { step: "blocked"; reason: "not_an_office_user" | "switched_off" | "not_configured" }
  | { step: "ready"; me: Me };

interface AuthApi {
  state: AuthState;
  transport: ApiTransport;
  signIn(email: string, password: string): Promise<string | null>;
  setPassword(password: string): Promise<string | null>;
  verifyCode(code: string): Promise<string | null>;
  signOut(): Promise<void>;
}

const Ctx = createContext<AuthApi | null>(null);

export function useAuth(): AuthApi {
  const a = useContext(Ctx);
  if (!a) throw new Error("AuthProvider is missing");
  return a;
}

const message = (e: unknown) => (e as { message?: string })?.message || String(e);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ step: "loading" });
  const transport = useMemo(() => new ApiTransport(apiBase, accessToken), []);
  // A recovery link is being handled: ignore sign-in events until the password is set.
  const recovering = useRef(/[#&]type=recovery(&|$)/.test(location.hash));

  /** Asks office-api who this is; decides the next step. */
  const check = useCallback(async () => {
    if (recovering.current) return;
    try {
      const me = await transport.me();
      setState({ step: "ready", me });
    } catch (e) {
      const err = e as FleetError;
      if (err.code === "mfa_required") await secondStep();
      else if (err.code === "not_an_office_user" || err.code === "switched_off") setState({ step: "blocked", reason: err.code });
      else if (err.code === "not_signed_in") setState({ step: "signed_out" });
      else setState({ step: "signed_out", notice: err.message });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transport]);

  async function secondStep() {
    if (!supabase) return;
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) {
      setState({ step: "signed_out", notice: error.message });
      return;
    }
    const verified = data.totp.find((f) => f.status === "verified");
    if (verified) {
      setState({ step: "second_step", mode: "verify", factorId: verified.id });
      return;
    }
    // A half-done enrolment from before: remove it, then start again.
    for (const f of data.all.filter((f) => f.factor_type === "totp" && f.status !== "verified")) {
      await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
    const enrol = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Fame Fleet" });
    if (enrol.error || !enrol.data) {
      setState({ step: "signed_out", notice: enrol.error?.message ?? "Could not start the second step." });
      return;
    }
    setState({ step: "second_step", mode: "enrol", factorId: enrol.data.id, secret: enrol.data.totp.secret, qr: enrol.data.totp.qr_code, uri: enrol.data.totp.uri });
  }

  useEffect(() => {
    if (!supabase || !configured) {
      setState({ step: "blocked", reason: "not_configured" });
      return;
    }
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        recovering.current = true;
        setState({ step: "set_password" });
      } else if (event === "SIGNED_OUT") {
        setState({ step: "signed_out" });
      }
    });
    void supabase.auth.getSession().then(({ data }) => {
      if (recovering.current) {
        setState({ step: "set_password" });
      } else if (data.session) {
        void check();
      } else {
        setState({ step: "signed_out" });
      }
    });
    return () => sub.subscription.unsubscribe();
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
      history.replaceState(null, "", location.pathname);
      setState({ step: "loading" });
      await check();
      return null;
    },
    async verifyCode(code) {
      if (!supabase || state.step !== "second_step") return "Not ready.";
      try {
        const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: state.factorId, code: code.replace(/\s/g, "") });
        if (error) return /invalid|expired/i.test(error.message) ? "That code is not right. Try the next one." : error.message;
      } catch (e) {
        return message(e);
      }
      setState({ step: "loading" });
      await check();
      return null;
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
