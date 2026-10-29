// Edge Function read-odometer: looks at an odometer photo in the private
// bucket and says what it shows, with Gemini.
//
// Driver mode (the app, while taking the photo):
//   POST /functions/v1/read-odometer
//   Authorization: Bearer <the driver's session token>
//   { "path": "<employee id>/<yyyy-mm-dd>/<photo id>.jpg", "vehicle_id": "...", "last_km": 195049, "gps_km": 12 }
//   200 { "status": "ok", "reading_km": 195061, "raw_reading_km": 195061, "confidence": 0.97, "digits_seen": "195061", "last_km": 195049 }
//       status: ok | no_odometer | trip_meter_only | blurry | covered_or_dark | not_dashboard | unsure | out_of_range
//       reading_km is set only for ok. out_of_range = under the last reading, or more than
//       last + gps + 500 km; raw_reading_km then still says what was read.
//   401 not signed in · 403 not an active driver, or someone else's photo
//   429 daily limit reached · 503 the counter could not be read (no call made) · 404 photo not uploaded · 502 the model failed
//
// Server mode (pg_cron job check-odometer-photos, for readings typed with no connection):
//   POST with header x-server-key: <SERVER_KEY>  { "log_id": "<odometer log id>" }
//   Reads the log's own photo (reusing an earlier read of the same photo if there is one),
//   writes the result on the log through set_odometer_ai(), and answers { status, reading_km, log_id }.
//
// Deployed with verify_jwt off (config.toml): the driver's token is checked
// here with Supabase Auth, and the photo path must be inside the caller's own
// folder. Secrets: GEMINI_API_KEY (required), SERVER_KEY (required for server
// mode), GEMINI_MODEL (optional). Every model call is written to
// odometer_reads (service role only). Round 48 (item 6a): the daily limits are the counter odometer_calls, taken
// BEFORE the model is asked (odometer_take, like google_take: per driver in driver mode, 60 a day; one counter for
// server mode under the setting odometer_server_daily_cap, 500 by default); a cap reached answers 429 and any error
// reading the counter or the setting answers 503 counter_unavailable without asking the model (fail closed).

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { encodeBase64 } from "@std/encoding/base64";
import { gatedOdometerRead, ODOMETER_DRIVER_DAILY_CAP, ODOMETER_SERVER_SCOPE } from "../_shared/fleet/odometerGate.ts";

const BUCKET = "driver-photos";
const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const DAILY_LIMIT = ODOMETER_DRIVER_DAILY_CAP;
/** The server's own checks a day when the setting is missing. */
const SERVER_DAILY_CAP_DEFAULT = 500;
const MAX_PHOTO_BYTES = 6 * 1024 * 1024;
const MODEL_TIMEOUT_MS = 25_000;
/** Below this confidence an "ok" answer is treated as unsure. */
const MIN_CONFIDENCE = 0.6;
/** A reading may be this much above last reading + km driven since (by GPS) before it is out of range. */
const ABOVE_EXPECTED_SLACK_KM = 500;
const PATH_SHAPE = /^[0-9a-f-]{36}\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}\.jpg$/;

const MODEL_STATUSES = ["ok", "no_odometer", "trip_meter_only", "blurry", "covered_or_dark", "not_dashboard", "unsure"] as const;
type ModelStatus = (typeof MODEL_STATUSES)[number];
type Status = ModelStatus | "out_of_range";

interface Expectation {
  last_km: number | null;
  gps_km: number | null;
}

interface ModelAnswer {
  status: ModelStatus;
  reading_km: number | null;
  confidence: number;
  digits_seen: string;
  note: string;
}

interface Verdict {
  status: Status;
  /** The number to offer (ok only). */
  reading: number | null;
  /** What was read before the range check, if anything. */
  raw: number | null;
  confidence: number | null;
  digits: string;
  note: string;
  rawText: string;
}

type Admin = SupabaseClient;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function prompt(expect: Expectation): string {
  const lines = [
    "You check odometer photos for a vehicle fleet. Decide what the photo shows and read ONLY the total odometer (ODO):",
    "the total distance the vehicle has travelled, normally 5 to 7 digits, sometimes labelled ODO or km, often unlabelled.",
    "Never read the speed, the RPM, trip A or trip B (a short number, often with a decimal, next to TRIP), the range or distance to empty,",
    "the fuel gauge, the clock, the temperature, or any other number.",
    "status must be one of: ok = the total odometer is clearly readable; trip_meter_only = only a trip meter is visible, not the total;",
    "no_odometer = a dashboard, but no odometer digits are visible (for example only the speedometer); covered_or_dark = the display is off,",
    "too dark, reflected or hidden; blurry = too blurred to read every digit with certainty; not_dashboard = not a vehicle dashboard at all;",
    "unsure = anything else where the number cannot be read with confidence.",
    "Answer as JSON: status; reading_km (integer kilometres, only when status is ok, otherwise null; drop any decimal part);",
    "confidence (0 to 1 that reading_km is exactly right); digits_seen (the digits exactly as they appear on the total odometer, or empty);",
    "note (one short sentence saying what you see).",
  ];
  if (expect.last_km !== null) {
    const since = Math.max(0, Math.round(expect.gps_km ?? 0));
    lines.push(
      `For reference only: the last recorded reading was ${expect.last_km} km and the vehicle has driven about ${since} km since,`,
      `so a total near ${
        expect.last_km + since
      } km would be expected. Use this only to choose between candidates. Never invent or adjust digits to match it.`,
    );
  }
  return lines.join(" ");
}

async function askModel(
  key: string,
  model: string,
  imageBase64: string,
  text: string,
): Promise<{ answer: ModelAnswer | null; raw: string }> {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": key, "content-type": "application/json" },
    signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ inlineData: { mimeType: "image/jpeg", data: imageBase64 } }, { text }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            status: { type: "STRING", enum: [...MODEL_STATUSES] },
            reading_km: { type: "INTEGER", nullable: true },
            confidence: { type: "NUMBER" },
            digits_seen: { type: "STRING" },
            note: { type: "STRING" },
          },
          required: ["status", "confidence"],
        },
      },
    }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`model ${response.status}: ${body.slice(0, 300)}`);
  const parsed = JSON.parse(body) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const raw = parsed.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  try {
    const a = JSON.parse(raw) as Partial<ModelAnswer>;
    const status = (MODEL_STATUSES as readonly string[]).includes(a.status ?? "") ? (a.status as ModelStatus) : "unsure";
    const reading = num(a.reading_km) === null ? null : Math.round(a.reading_km as number);
    const confidence = Math.min(1, Math.max(0, num(a.confidence) ?? 0));
    return {
      answer: { status, reading_km: reading, confidence, digits_seen: String(a.digits_seen ?? ""), note: String(a.note ?? "") },
      raw,
    };
  } catch {
    return { answer: null, raw };
  }
}

/** Turns the model's answer into the status the app and the office see. */
function verdict(answer: ModelAnswer | null, rawText: string, expect: Expectation): Verdict {
  if (!answer) return { status: "unsure", reading: null, raw: null, confidence: null, digits: "", note: "no answer", rawText };
  const raw = answer.reading_km;
  let status: Status = answer.status;
  if (status === "ok") {
    if (raw === null || raw < 100 || raw > 9_999_999 || answer.confidence < MIN_CONFIDENCE) status = "unsure";
    else if (expect.last_km !== null) {
      if (raw < expect.last_km) status = "out_of_range";
      else if (raw > expect.last_km + Math.max(0, expect.gps_km ?? 0) + ABOVE_EXPECTED_SLACK_KM) status = "out_of_range";
    }
  }
  return {
    status,
    reading: status === "ok" ? raw : null,
    raw,
    confidence: answer.confidence,
    digits: answer.digits_seen,
    note: answer.note,
    rawText,
  };
}

async function readPhoto(admin: Admin, path: string, expect: Expectation): Promise<Verdict> {
  const { data: file, error } = await admin.storage.from(BUCKET).download(path);
  if (error || !file) throw new PhotoError(404, "photo_not_found");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength > MAX_PHOTO_BYTES) throw new PhotoError(413, "photo_too_large");
  const { answer, raw } = await askModel(env("GEMINI_API_KEY"), model(), encodeBase64(bytes), prompt(expect));
  return verdict(answer, raw, expect);
}

class PhotoError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}

function model(): string {
  return Deno.env.get("GEMINI_MODEL") || DEFAULT_MODEL;
}

function adminClient(): Admin {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function record(
  admin: Admin,
  row: Record<string, unknown>,
  outcome: { verdict?: Verdict; error?: string; ms: number },
): Promise<void> {
  const v = outcome.verdict;
  const { error } = await admin.from("odometer_reads").insert({
    ...row,
    model: model(),
    ok: !outcome.error,
    error: outcome.error?.slice(0, 500) ?? null,
    ms: outcome.ms,
    status: v?.status ?? "unsure",
    reading_km: v?.raw ?? null,
    confidence: v?.confidence ?? null,
    raw: v ? `${v.rawText.slice(0, 400)}${v.note ? ` | ${v.note.slice(0, 100)}` : ""}` : null,
  });
  if (error) console.error(`read-odometer: could not record the read: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Driver mode
// ---------------------------------------------------------------------------

async function driverMode(request: Request, token: string): Promise<Response> {
  const url = env("SUPABASE_URL");
  const asCaller = createClient(url, env("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: user, error: userError } = await asCaller.auth.getUser(token);
  if (userError || !user.user) return json(401, { error: "not_signed_in" });

  // Row Level Security returns the caller's own employee row and nothing else.
  const { data: me } = await asCaller.from("employees").select("id, active, role").maybeSingle();
  if (!me || !me.active) return json(403, { error: "not_a_driver" });
  // Round 50: an office person driving their own trip with the app reads their odometer photo too (drives_with_app).
  if (me.role !== "driver") {
    const { data: drives } = await asCaller.rpc("drives_with_app", { p_employee: me.id });
    if (drives !== true) return json(403, { error: "not_a_driver" });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json(400, { error: "bad_request" });
  }
  const path = typeof body.path === "string" && PATH_SHAPE.test(body.path) ? body.path : null;
  if (!path) return json(400, { error: "bad_request" });
  if (!path.startsWith(`${me.id}/`)) return json(403, { error: "not_your_photo" });
  const expect: Expectation = { last_km: num(body.last_km), gps_km: num(body.gps_km) };
  const vehicleId = typeof body.vehicle_id === "string" && body.vehicle_id.length === 36 ? body.vehicle_id : null;

  const admin = adminClient();
  const row = {
    employee_id: me.id,
    vehicle_id: vehicleId,
    photo_path: path,
    last_km: expect.last_km,
    gps_km: expect.gps_km,
    mode: "driver",
  };
  const started = Date.now();
  try {
    // Counted before the model is asked; refused at the cap or when the counter cannot be read (fail closed).
    const gated = await gatedOdometerRead(admin, "driver", me.id, DAILY_LIMIT, () => readPhoto(admin, path, expect));
    if (!gated.ok) {
      if (gated.gate.reason === "day") return json(429, { error: "daily_limit", limit: DAILY_LIMIT });
      return json(503, { error: "counter_unavailable" });
    }
    const v = gated.value;
    await record(admin, row, { verdict: v, ms: Date.now() - started });
    return json(200, {
      status: v.status,
      reading_km: v.reading,
      raw_reading_km: v.raw,
      confidence: v.confidence,
      digits_seen: v.digits,
      last_km: expect.last_km,
    });
  } catch (error) {
    if (error instanceof PhotoError) return json(error.status, { error: error.code });
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`read-odometer: ${message}`);
    await record(admin, row, { error: message, ms: Date.now() - started });
    return json(502, { error: "model_failed" });
  }
}

// ---------------------------------------------------------------------------
// Server mode: check the photo of a log typed with no connection
// ---------------------------------------------------------------------------

/** The setting odometer_server_daily_cap (the default when unset); null when it could not be read (then no call). */
async function serverDailyCap(admin: Admin): Promise<number | null> {
  const { data, error } = await admin.from("fleet_settings").select("value").eq("key", "odometer_server_daily_cap").maybeSingle();
  if (error) {
    console.error(`read-odometer (server): the cap could not be read: ${error.message}`);
    return null;
  }
  const v = (data as { value?: unknown } | null)?.value;
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : SERVER_DAILY_CAP_DEFAULT;
}

async function serverMode(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json(400, { error: "bad_request" });
  }
  const logId = typeof body.log_id === "string" && body.log_id.length === 36 ? body.log_id : null;
  if (!logId) return json(400, { error: "bad_request" });

  const admin = adminClient();
  const { data: log } = await admin.from("odometer_logs")
    .select("id, employee_id, vehicle_id, reading_km, logged_at, photo_id, photos:photo_id (storage_path)")
    .eq("id", logId).maybeSingle();
  const photo = (log?.photos ?? null) as { storage_path: string } | { storage_path: string }[] | null;
  const path = Array.isArray(photo) ? photo[0]?.storage_path : photo?.storage_path;
  if (!log || !path) return json(404, { error: "log_or_photo_not_found" });

  // The vehicle's reading before this log is the only expectation the server has.
  const { data: previous } = await admin.from("odometer_logs").select("reading_km")
    .eq("vehicle_id", log.vehicle_id).lt("logged_at", log.logged_at).neq("id", log.id)
    .order("logged_at", { ascending: false }).limit(1).maybeSingle();
  const expect: Expectation = { last_km: previous?.reading_km ?? null, gps_km: null };

  // A photo read while the driver was taking it is reused rather than read again.
  const { data: earlier } = await admin.from("odometer_reads").select("status, reading_km, confidence")
    .eq("photo_path", path).eq("ok", true).order("created_at", { ascending: false }).limit(1).maybeSingle();

  let status: Status;
  let value: number | null;
  if (earlier) {
    status = earlier.status as Status;
    value = earlier.reading_km;
  } else {
    // The job's own cap (the setting odometer_server_daily_cap): a setting that cannot be read refuses too.
    const cap = await serverDailyCap(admin);
    if (cap === null) return json(503, { error: "counter_unavailable" });
    const started = Date.now();
    const row = {
      employee_id: log.employee_id,
      vehicle_id: log.vehicle_id,
      photo_path: path,
      last_km: expect.last_km,
      gps_km: null,
      mode: "server",
      log_id: log.id,
    };
    try {
      const gated = await gatedOdometerRead(admin, "server", ODOMETER_SERVER_SCOPE, cap, () => readPhoto(admin, path, expect));
      if (!gated.ok) {
        if (gated.gate.reason === "day") return json(429, { error: "daily_limit", limit: cap });
        return json(503, { error: "counter_unavailable" });
      }
      const v = gated.value;
      await record(admin, row, { verdict: v, ms: Date.now() - started });
      status = v.status;
      value = v.raw;
    } catch (error) {
      if (error instanceof PhotoError) return json(error.status, { error: error.code });
      const message = error instanceof Error ? error.message : "unknown error";
      console.error(`read-odometer (server): ${message}`);
      await record(admin, row, { error: message, ms: Date.now() - started });
      return json(502, { error: "model_failed" });
    }
  }

  const { error } = await admin.rpc("set_odometer_ai", { p_log_id: log.id, p_ai_value: value, p_ai_status: status });
  if (error) {
    console.error(`read-odometer (server): set_odometer_ai: ${error.message}`);
    return json(500, { error: "could_not_save" });
  }
  return json(200, { status, reading_km: status === "ok" ? value : null, log_id: log.id });
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" });

  const serverKey = request.headers.get("x-server-key");
  if (serverKey !== null) {
    const expected = Deno.env.get("SERVER_KEY") ?? "";
    if (expected.length < 16 || !constantTimeEqual(serverKey, expected)) return json(401, { error: "bad_server_key" });
    return await serverMode(request);
  }

  const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json(401, { error: "not_signed_in" });
  return await driverMode(request, token);
});
