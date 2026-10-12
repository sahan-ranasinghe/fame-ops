// Turning on 2-step sign-in: Supabase makes a TOTP secret, the person scans
// the QR code (or types the key) in an authenticator app and proves it with
// one code. Used by Settings and, when the office makes 2-step compulsory
// for a role, by the second-step page.
import { type FormEvent, useState } from "react";
import { Notice } from "../ui/basics";
import { supabase } from "./supabase";

/** The QR code from Supabase: raw SVG or a data URL; either way an <img> can show it. */
export function qrSrc(qr?: string): string | undefined {
  if (!qr) return undefined;
  if (qr.startsWith("data:")) return qr;
  return "data:image/svg+xml;utf8," + encodeURIComponent(qr);
}

export interface Enrolment {
  id: string;
  secret: string;
  qr: string;
}

/** Starts an enrolment (on a click, never in an effect: one factor, no race). Leftover unverified factors are removed first. */
export async function startTotpEnrol(): Promise<{ enrol: Enrolment } | { error: string }> {
  if (!supabase) return { error: "Not configured." };
  const { data } = await supabase.auth.mfa.listFactors();
  for (const f of (data?.all ?? []).filter((f) => f.factor_type === "totp" && f.status !== "verified")) {
    await supabase.auth.mfa.unenroll({ factorId: f.id });
  }
  const { data: e, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Fame Fleet" });
  if (error || !e) return { error: error?.message ?? "Could not start 2-step sign-in." };
  return { enrol: { id: e.id, secret: e.totp.secret, qr: e.totp.qr_code } };
}

export function TotpEnrol({ enrol, onDone, onCancel, confirmLabel = "Turn on 2-step sign-in" }: {
  enrol: Enrolment;
  onDone: () => void;
  onCancel?: () => void;
  confirmLabel?: string;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    if (!supabase) return;
    const clean = code.replace(/\s/g, "");
    if (!/^\d{6}$/.test(clean)) {
      setError("Type the 6-digit code from the app.");
      return;
    }
    setBusy(true);
    const { error: err } = await supabase.auth.mfa.challengeAndVerify({ factorId: enrol.id, code: clean });
    setBusy(false);
    if (err) {
      setError(/invalid|expired/i.test(err.message) ? "That code is not right. Try the next one." : err.message);
      return;
    }
    onDone();
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <p style={{ margin: 0 }}>
        Install Google Authenticator (or any authenticator app), scan this code, then type the 6 digits it shows. From then on every sign-in asks for the code.
      </p>
      <div className="qr">
        <img src={qrSrc(enrol.qr)} alt="QR code for the authenticator app" />
        <span className="hint">Can’t scan? Add the key by hand:</span>
        <span className="secret" data-testid="totp-secret">{enrol.secret}</span>
      </div>
      <div className="field">
        <label htmlFor="te-code">6-digit code</label>
        <input id="te-code" className="code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
      </div>
      {error && <Notice tone="bad">{error}</Notice>}
      <div className="acts">
        <button className="btn primary" type="submit" disabled={busy}>{busy ? "Checking…" : confirmLabel}</button>
        {onCancel && <button type="button" className="btn" onClick={onCancel}>Not now</button>}
      </div>
    </form>
  );
}
