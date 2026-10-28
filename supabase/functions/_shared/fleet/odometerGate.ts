// The Gemini odometer gate (Round 48, item 6a): like the Google calls, a read is recorded in the database BEFORE
// the model is asked (odometer_take: per Colombo day, per driver in driver mode, one counter for the server's job)
// and made only when that answer allows it. A cap reached, an answer of the wrong shape or any error reading or
// writing the counter refuses the read (fail closed): the phone then keeps its own path (retake, or type after three
// failed photos), and the job tries the log again at its next run.

export type OdometerMode = "driver" | "server";
export type OdometerRefuse = "day" | "counter";

export interface OdometerGate {
  allowed: boolean;
  reason?: OdometerRefuse;
  day?: number;
  day_cap?: number;
}

/** A driver's reads a day (the app's limit since Phase A). */
export const ODOMETER_DRIVER_DAILY_CAP = 60;
/** The scope of the server's one counter. */
export const ODOMETER_SERVER_SCOPE = "server";

/** The least a database client needs here (read-odometer's own supabase-js client, or a fake). */
export interface RpcClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export async function takeOdometerCall(db: RpcClient, mode: OdometerMode, scope: string, dayCap: number): Promise<OdometerGate> {
  try {
    const { data, error } = await db.rpc("odometer_take", { p_mode: mode, p_scope: scope, p_day_cap: dayCap });
    const gate = data as OdometerGate | null;
    if (error || !gate || typeof gate !== "object" || typeof gate.allowed !== "boolean") {
      if (error) console.error(`odometer_take ${mode}: ${error.message}`);
      return { allowed: false, reason: "counter" };
    }
    return gate;
  } catch (error) {
    console.error(`odometer_take ${mode}: ${error instanceof Error ? error.message : String(error)}`);
    return { allowed: false, reason: "counter" };
  }
}

export type GatedRead<T> = { ok: true; value: T; gate: OdometerGate } | { ok: false; gate: OdometerGate };

/** The read runs only after it was counted and allowed; a read that fails stays counted (the model may bill it). */
export async function gatedOdometerRead<T>(
  db: RpcClient,
  mode: OdometerMode,
  scope: string,
  dayCap: number,
  read: () => Promise<T>,
): Promise<GatedRead<T>> {
  const gate = await takeOdometerCall(db, mode, scope, dayCap);
  if (!gate.allowed) return { ok: false, gate };
  return { ok: true, value: await read(), gate };
}
