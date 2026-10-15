// Database access for the connector. It talks to Supabase as service_role and
// only through the query builder: no raw SQL, and the role has no delete.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.ts";

export type Db = SupabaseClient<Database>;
type Tables = Database["public"]["Tables"];
export type Row<T extends keyof Tables> = Tables[T]["Row"];
export type Insert<T extends keyof Tables> = Tables[T]["Insert"];
export type Update<T extends keyof Tables> = Tables[T]["Update"];

/** A problem the office can understand and fix. The message is shown as it is. */
export class ToolError extends Error {}

export function adminClient(): Db {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set");
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

interface DbError {
  message: string;
  code?: string;
  details?: string | null;
}

interface DbResult {
  data: unknown;
  error: DbError | null;
}

// Postgres error classes caused by the values that were sent (bad input,
// broken constraint, raised by our own triggers), not by a fault in this code.
const CAUSED_BY_INPUT = /^(22|23|P0)/;

function fail(error: DbError, what: string): never {
  if (error.code && CAUSED_BY_INPUT.test(error.code)) {
    const text = error.code === "23505" && error.details ? error.details : error.message;
    throw new ToolError(`${what}: ${text}`);
  }
  throw new Error(`${what}: ${error.message}`);
}

/** The data of a successful query (rows, or the one row of `.single()`); throws on a database error. */
export function unwrap<R extends DbResult>(res: R, what: string): NonNullable<R["data"]> {
  if (res.error) fail(res.error, what);
  return res.data as NonNullable<R["data"]>;
}

/** Like unwrap, for `.maybeSingle()`: null when nothing was found. */
export function unwrapMaybe<R extends DbResult>(res: R, what: string): R["data"] {
  if (res.error) fail(res.error, what);
  return res.data;
}

/**
 * Reads every row of a query. The API returns at most 1,000 rows per request,
 * so this pages through. The query must have a stable order.
 */
export async function fetchAll<R extends { data: unknown[] | null; error: DbError | null }>(
  page: (from: number, to: number) => PromiseLike<R>,
  what: string,
  maxRows = 20000,
): Promise<NonNullable<R["data"]>> {
  const size = 1000;
  const rows: unknown[] = [];
  for (let from = 0; from < maxRows; from += size) {
    const batch = unwrap(await page(from, from + size - 1), what);
    rows.push(...batch);
    if (batch.length < size) break;
  }
  return rows as NonNullable<R["data"]>;
}
