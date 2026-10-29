// Round 49 (29 October 2026): set-password links that survive being opened (Google Workspace's and Slack's invite
// pattern). Before, the link was Supabase's own recovery link: one GET used it, so WhatsApp's preview (fetched when the
// admin wrote the message) spent it and the person landed on the sign-in page with no word of why.
//
//   create_office_user / reset_office_password  →  issuePasswordLink: a random token, only its SHA-256 stored
//     (password_links), 7 days; the link is <site>/set-password#k=<token>: the token sits after the '#', so loading the
//     page sends it to no server and a preview fetch reads only the page
//   the page opens                               →  checkPasswordLink (office-api POST /public/password-link): the state;
//     any number of times, nothing used
//   Save password                                →  usePasswordLink (POST /public/password-link/set): the link claimed in
//     one locked step, the password set through Auth's admin API, given back if Auth refuses it, the save audited
//
// A link dies when used, when a newer one is made for the person, when the password was set another way since it was
// made, after 7 days, or when the account is switched off (the database decides: password_link_check). The page shows one
// friendly sentence for all of them; the state names stay in the answer for tests and support.

import type { Db } from "./db.ts";

export const LINK_DAYS = 7;
export const LINK_VALID_FOR = `${LINK_DAYS} days`;
/** Office passwords: 12+ characters (the site's MIN_PASSWORD). Auth's own minimum stays 6 for drivers' PINs. */
export const MIN_PASSWORD = 12;
/** bcrypt reads 72 bytes; Auth refuses more. */
export const MAX_PASSWORD_BYTES = 72;

export type LinkState = "valid" | "used" | "replaced" | "expired" | "switched_off" | "password_set" | "unknown";
export type LinkKind = "new_account" | "reset";

/** The public answer for an opened link: the state, and for a valid one whose account it is. */
export type LinkCheck = { state: Exclude<LinkState, "valid"> } | { state: "valid"; name: string; email: string };

export type LinkUse =
  | { ok: true; email: string }
  | { ok: false; state: Exclude<LinkState, "valid"> }
  | { ok: false; error: "too_short" | "too_long" | "refused"; message: string };

/** 32 random bytes, base64url (43 characters). */
export function newLinkToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A token as the links carry it: anything else is answered "unknown" without asking the database. */
export function tokenShapeOk(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
}

export async function linkTokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The web app's address for the links: the first origin of OFFICE_WEB_URL, else the local dev server (config.toml's site_url). */
export function linkBase(env: string | undefined = Deno.env.get("OFFICE_WEB_URL")): string {
  return ((env ?? "").split(",")[0].trim() || "http://localhost:5173").replace(/\/$/, "");
}

export function setPasswordUrl(base: string, token: string): string {
  return `${base}/set-password#k=${token}`;
}

/** The password rule the page shows, checked again here. */
export function passwordProblem(password: unknown): { error: "too_short" | "too_long"; message: string } | null {
  if (typeof password !== "string" || password.length < MIN_PASSWORD) {
    return { error: "too_short", message: `Use at least ${MIN_PASSWORD} characters.` };
  }
  if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES) {
    return { error: "too_long", message: `Use at most ${MAX_PASSWORD_BYTES} characters.` };
  }
  return null;
}

/** A new link for an office person; their older open links stop working. */
export async function issuePasswordLink(
  db: Db,
  person: { employeeId: string; kind: LinkKind; by: string },
  base = linkBase(),
): Promise<{ link: string; valid_for: string; expires_at: string }> {
  const token = newLinkToken();
  const { data, error } = await db.rpc("password_link_issue", {
    p_employee: person.employeeId,
    p_token_hash: await linkTokenHash(token),
    p_kind: person.kind,
    p_by: person.by,
    p_days: LINK_DAYS,
  });
  if (error) throw new Error(`set-password link: ${error.message}`);
  return { link: setPasswordUrl(base, token), valid_for: LINK_VALID_FOR, expires_at: String((data as { expires_at: string }).expires_at) };
}

type Checked = { state: LinkState; link_id?: string; employee_id?: string; auth_user_id?: string; name?: string; email?: string };

async function check(db: Db, token: string, claim: boolean): Promise<Checked> {
  if (!tokenShapeOk(token)) return { state: "unknown" };
  const { data, error } = await db.rpc("password_link_check", { p_token_hash: await linkTokenHash(token), p_claim: claim });
  if (error) throw new Error(`set-password link check: ${error.message}`);
  return data as Checked;
}

/** The page opened the link: its state; never uses it. */
export async function checkPasswordLink(db: Db, token: unknown): Promise<LinkCheck> {
  const c = await check(db, typeof token === "string" ? token : "", false);
  if (c.state !== "valid") return { state: c.state };
  return { state: "valid", name: c.name ?? "", email: c.email ?? "" };
}

/** The person saved a password: the only thing that uses a link. */
export async function usePasswordLink(db: Db, token: unknown, password: unknown): Promise<LinkUse> {
  const problem = passwordProblem(password);
  if (problem) return { ok: false, ...problem };
  const c = await check(db, typeof token === "string" ? token : "", true);
  if (c.state !== "valid") return { ok: false, state: c.state };
  const { error } = await db.auth.admin.updateUserById(c.auth_user_id!, { password: password as string });
  if (error) {
    // Auth said no (its own password rules): the link is given back, the page shows Auth's sentence.
    const { error: back } = await db.rpc("password_link_release", { p_link: c.link_id! });
    if (back) console.error(`set-password link ${c.link_id}: could not give it back: ${back.message}`);
    return { ok: false, error: "refused", message: error.message };
  }
  // The person's own act, in the activity log (never the password; the link by its id only).
  const { error: audit } = await db.from("office_audit").insert({
    tool: "set_password_by_link",
    args_summary: JSON.stringify({ name: c.name, email: c.email, link: c.link_id }),
    result_summary: "password set",
    actor_employee_id: c.employee_id ?? null,
    actor_name: c.name ?? "",
    channel: "web",
  });
  if (audit) console.error(`set-password link ${c.link_id}: audit row: ${audit.message}`);
  return { ok: true, email: c.email ?? "" };
}
