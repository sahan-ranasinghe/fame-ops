// fleet-jobs: the background work the database asks for (docs/dispatch-plan.md, 4.3).
//
//   POST { "job": "sync", "task_id"?, "report_id"?, "request_id"?, "vehicle_id"? }
//   POST { "job": "prune_fuel_videos" }   (pg_cron fuel-videos-prune, monthly: the files older
//                                          than 12 months go, the rows are marked pruned)
//   POST { "job": "retention" }           (pg_cron retention, nightly 02:45 Colombo, Round 4–7 item 9: what is past its
//                                          period removed in batches, one activity-log row, a couple of days summarised;
//                                          Round 52: the bin's items past their 30 days, with their files and sign-ins)
//   POST { "job": "summaries" }           (pg_cron day-summaries, every 15 minutes: a few driver-days kept as summaries
//                                          before their points may go; yesterday first, then the oldest)
//   POST { "job": "google_content" }      (pg_cron google-content, nightly: the Google pins of stops
//                                          still to be driven fetched again at 23 days, then every
//                                          Google detail over 30 days old removed)
//
// with the header x-server-key = SERVER_KEY (the same key push-task checks). Called
// by pg_cron every 5 minutes (fleet_sync()) and by the triggers on vehicle_reports,
// tasks and vehicle_requests with a scope. A sync recomputes the ETAs of the running
// tasks (through the 2-minute cache) and brings the issues table in line with the
// data: opens, updates, auto-resolves. Answers the counts.

import { adminClient } from "../_shared/fleet/db.ts";
import { syncIssues, type SyncScope } from "../_shared/fleet/issues.ts";
import { pruneFuelVideos } from "../_shared/fleet/videos.ts";
import { googleContentJob } from "../_shared/fleet/googlePlaces.ts";
import { runRetention, summariseSome } from "../_shared/fleet/retention.ts";
import { purgeBin } from "../_shared/fleet/tools/bin.ts";
import { routineToolNames } from "../_shared/fleet/tools/activity.ts";
// The tool list registers itself with the activity log (its reads are the log's routine entries).
import "../_shared/fleet/index.ts";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const isUuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

Deno.serve(async (request) => {
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
  const key = request.headers.get("x-server-key") ?? "";
  const expected = Deno.env.get("SERVER_KEY") ?? "";
  if (expected.length < 16 || !constantTimeEqual(key, expected)) return json(401, { error: "bad_server_key" });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json(400, { error: "bad_request" });
  }
  if (body.job === "prune_fuel_videos") {
    const started = Date.now();
    try {
      const result = await pruneFuelVideos(adminClient(), new Date());
      return json(200, { job: "prune_fuel_videos", ...result, ms: Date.now() - started });
    } catch (error) {
      console.error("fleet-jobs prune_fuel_videos failed", error);
      return json(500, { error: "prune_failed", message: error instanceof Error ? error.message : String(error) });
    }
  }
  if (body.job === "google_content") {
    const started = Date.now();
    try {
      const result = await googleContentJob(adminClient(), new Date());
      return json(200, { job: "google_content", ...result, ms: Date.now() - started });
    } catch (error) {
      console.error("fleet-jobs google_content failed", error);
      return json(500, { error: "google_content_failed", message: error instanceof Error ? error.message : String(error) });
    }
  }
  if (body.job === "retention") {
    const started = Date.now();
    try {
      const db = adminClient();
      const result = await runRetention(db, new Date(), { dry: false, routine: routineToolNames(), by: "System" });
      // Round 52 (§40): Recently deleted, after its 30 days: the files and a person's sign-in first, then the item.
      const bin = await purgeBin(db, new Date());
      return json(200, { job: "retention", ...result, bin, ms: Date.now() - started });
    } catch (error) {
      console.error("fleet-jobs retention failed", error);
      return json(500, { error: "retention_failed", message: error instanceof Error ? error.message : String(error) });
    }
  }
  if (body.job === "summaries") {
    const started = Date.now();
    try {
      const summarised = await summariseSome(adminClient(), new Date());
      return json(200, { job: "summaries", summarised, ms: Date.now() - started });
    } catch (error) {
      console.error("fleet-jobs summaries failed", error);
      return json(500, { error: "summaries_failed", message: error instanceof Error ? error.message : String(error) });
    }
  }
  if (body.job !== "sync") return json(400, { error: "unknown_job" });
  const scope: SyncScope = {};
  for (const k of ["task_id", "report_id", "request_id", "vehicle_id"] as const) {
    if (body[k] === undefined || body[k] === null) continue;
    if (!isUuid(body[k])) return json(400, { error: "bad_request", field: k });
    scope[k] = body[k];
  }

  const started = Date.now();
  try {
    const result = await syncIssues(adminClient(), new Date(), scope);
    return json(200, { job: "sync", scope, ...result, ms: Date.now() - started });
  } catch (error) {
    console.error("fleet-jobs sync failed", error);
    return json(500, { error: "sync_failed", message: error instanceof Error ? error.message : String(error) });
  }
});
