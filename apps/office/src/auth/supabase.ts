// The browser holds only the Supabase URL and the publishable (anon) key.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL ?? "";
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

export const configured = Boolean(url && anonKey);

/**
 * A set-password link lands with `type=recovery` in the hash. Read it here, before the
 * client is created: the client's own URL handling consumes the hash a moment later, and
 * a render that came after that would take the recovery session for an ordinary sign-in.
 */
export const recoveryLink = typeof location !== "undefined" && /[#&]type=recovery(&|$)/.test(location.hash);

export const supabase: SupabaseClient | null = configured
  ? createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit" },
  })
  : null;

export const apiBase = (import.meta.env.VITE_OFFICE_API_URL || `${url.replace(/\/$/, "")}/functions/v1/office-api`).replace(/\/$/, "");

export async function accessToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
