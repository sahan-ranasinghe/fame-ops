// Edge Function read-odometer: reads the main odometer total from a photo the
// driver app has already uploaded to the private bucket, with Gemini.
//
//   POST /functions/v1/read-odometer
//   Authorization: Bearer <the driver's session token>   (signed-in drivers only)
//   { "path": "<employee id>/<yyyy-mm-dd>/<photo id>.jpg",
//     "vehicle_id": "...", "last_km": 195049, "gps_km": 12 }
//
//   200 { "reading_km": 195061, "raw_reading_km": 195061, "confidence": 0.93, "rejected": null }
//       reading_km is null when nothing usable was read or the number does not
//       fit: rejected = "below_last" (under the last reading), "far_above"
//       (more than last + gps + 500 km), "unreadable".
//   401 not signed in · 403 not an active driver, or someone else's photo
//   429 daily limit reached · 404 photo not uploaded · 502 the model failed
//
// Deployed with verify_jwt off (config.toml): the token is checked here, with
// Supabase Auth, and the photo path must be inside the caller's own folder.
// Secrets: GEMINI_API_KEY (required), GEMINI_MODEL (optional).
// Every call is written to odometer_reads (service role only), which is also
// what the daily limit counts.

import { createClient } from "@supabase/supabase-js";
import { encodeBase64 } from "@std/encoding/base64";

const BUCKET = "driver-photos";
const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const DAILY_LIMIT = 60;
const MAX_PHOTO_BYTES = 6 * 1024 * 1024;
const MODEL_TIMEOUT_MS = 25_000;
/** A reading may be this much above last reading + km driven since (by GPS) before it is rejected. */
const ABOVE_EXPECTED_SLACK_KM = 500;
const PATH_SHAPE = /^[0-9a-f-]{36}\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}\.jpg$/;
const COLOMBO_OFFSET_MS = 5.5 * 60 * 60 * 1000;

type Rejection = "below_last" | "far_above" | "unreadable";

interface Input {
  path: string;
  vehicle_id: string | null;
  last_km: number | null;
  gps_km: number | null;
}

interface ModelAnswer {
  reading_km: number | null;
  confidence: number;
  digits_seen?: string;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/** 00:00 today in Colombo, as UTC ISO. */
function startOfColomboToday(now: Date): string {
  const wall = new Date(now.getTime() + COLOMBO_OFFSET_MS);
  const midnight = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate()) - COLOMBO_OFFSET_MS;
  return new Date(midnight).toISOString();
}

function parseInput(raw: unknown): Input | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.path !== "string" || !PATH_SHAPE.test(r.path)) return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    path: r.path,
    vehicle_id: typeof r.vehicle_id === "string" && r.vehicle_id.length === 36 ? r.vehicle_id : null,
    last_km: num(r.last_km),
    gps_km: num(r.gps_km),
  };
}

function prompt(input: Input): string {
  const lines = [
    "This photo shows a vehicle dashboard. Read the MAIN ODOMETER: the total distance the vehicle has travelled,",
    "normally 5 to 7 digits, sometimes labelled ODO or km, often with no label.",
    "Ignore: the trip meter (TRIP, TRIP A, TRIP B: usually 1 to 4 digits, often with a decimal), the speed, the fuel gauge,",
    "the clock, the RPM, the temperature, the range or average consumption, and any number that is not a distance total.",
    "If the odometer shows a decimal, drop the fraction. If you cannot see the odometer clearly, return null.",
    "Answer as JSON: reading_km (integer kilometres or null), confidence (0 to 1), digits_seen (the digits exactly as they appear).",
  ];
  if (input.last_km !== null) {
    const expected = input.last_km + Math.max(0, Math.round(input.gps_km ?? 0));
    lines.push(
      `For reference only: the last recorded reading was ${input.last_km} km and the vehicle has driven about ${
        Math.max(0, Math.round(input.gps_km ?? 0))
      } km since,`,
      `so a reading near ${expected} km would be expected. Use this only to choose between candidates. Never invent or adjust digits to match it.`,
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
            reading_km: { type: "INTEGER", nullable: true },
            confidence: { type: "NUMBER" },
            digits_seen: { type: "STRING" },
          },
          required: ["reading_km", "confidence"],
        },
      },
    }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`model ${response.status}: ${body.slice(0, 300)}`);
  const parsed = JSON.parse(body) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const raw = parsed.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  try {
    const answer = JSON.parse(raw) as Partial<ModelAnswer>;
    const reading = typeof answer.reading_km === "number" && Number.isFinite(answer.reading_km) ? Math.round(answer.reading_km) : null;
    const confidence = typeof answer.confidence === "number" ? Math.min(1, Math.max(0, answer.confidence)) : 0;
    return { answer: { reading_km: reading, confidence, digits_seen: answer.digits_seen }, raw };
  } catch {
    return { answer: null, raw };
  }
}

function rangeCheck(reading: number | null, input: Input): Rejection | null {
  if (reading === null) return null;
  if (reading < 100 || reading > 9_999_999) return "unreadable";
  if (input.last_km === null) return null;
  if (reading < input.last_km) return "below_last";
  if (reading > input.last_km + Math.max(0, input.gps_km ?? 0) + ABOVE_EXPECTED_SLACK_KM) return "far_above";
  return null;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" });

  const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json(401, { error: "not_signed_in" });

  const url = env("SUPABASE_URL");
  const asCaller = createClient(url, env("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: user, error: userError } = await asCaller.auth.getUser(token);
  if (userError || !user.user) return json(401, { error: "not_signed_in" });

  // Row Level Security returns the caller's own employee row and nothing else.
  const { data: me } = await asCaller.from("employees").select("id, active, role").maybeSingle();
  if (!me || !me.active || me.role !== "driver") return json(403, { error: "not_a_driver" });

  let input: Input | null = null;
  try {
    input = parseInput(await request.json());
  } catch {
    input = null;
  }
  if (!input) return json(400, { error: "bad_request" });
  if (!input.path.startsWith(`${me.id}/`)) return json(403, { error: "not_your_photo" });

  const admin = createClient(url, env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const now = new Date();

  const { count } = await admin.from("odometer_reads").select("id", { count: "exact", head: true })
    .eq("employee_id", me.id).gte("created_at", startOfColomboToday(now));
  if ((count ?? 0) >= DAILY_LIMIT) return json(429, { error: "daily_limit", limit: DAILY_LIMIT });

  const { data: file, error: fileError } = await admin.storage.from(BUCKET).download(input.path);
  if (fileError || !file) return json(404, { error: "photo_not_found" });
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength > MAX_PHOTO_BYTES) return json(413, { error: "photo_too_large" });

  const model = Deno.env.get("GEMINI_MODEL") || DEFAULT_MODEL;
  const started = Date.now();
  const row: Record<string, unknown> = {
    employee_id: me.id,
    vehicle_id: input.vehicle_id,
    photo_path: input.path,
    last_km: input.last_km,
    gps_km: input.gps_km,
    model,
  };

  try {
    const { answer, raw } = await askModel(env("GEMINI_API_KEY"), model, encodeBase64(bytes), prompt(input));
    const reading = answer?.reading_km ?? null;
    const rejected = answer ? rangeCheck(reading, input) : "unreadable";
    await admin.from("odometer_reads").insert({
      ...row,
      reading_km: reading,
      confidence: answer?.confidence ?? null,
      rejected,
      ok: true,
      ms: Date.now() - started,
      raw: raw.slice(0, 500),
    });
    return json(200, {
      reading_km: rejected ? null : reading,
      raw_reading_km: reading,
      confidence: answer?.confidence ?? null,
      rejected,
      digits_seen: answer?.digits_seen,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`read-odometer: ${message}`);
    await admin.from("odometer_reads").insert({ ...row, ok: false, ms: Date.now() - started, error: message.slice(0, 500) });
    return json(502, { error: "model_failed" });
  }
});
