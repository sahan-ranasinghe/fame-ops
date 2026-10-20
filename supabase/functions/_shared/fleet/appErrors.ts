// Hotfix O2-H2, Part 1c: the app's crash reports (table app_errors, migration 20261020100000). office-api and driver-api
// POST /errors take the body the app's lib/crashLogic.ts reportBody builds (already scrubbed on the phone: no e-mail,
// phone, token, key or id) and write one row with the signed-in person; the tool list_app_errors (users) reads them.
// The phone's text is cut to the column sizes here too, and scrubbed once more (a phone on an older update might not).

import { z } from "zod";

import { type Db, unwrap } from "./db.ts";

export const APP_ERROR_INPUT = z.object({
  app_version: z.string().max(40).optional(),
  update_id: z.string().max(80).nullable().optional(),
  runtime: z.string().max(40).nullable().optional(),
  screen: z.string().max(200).optional(),
  message: z.string().min(1).max(600),
  stack: z.string().max(4000).optional(),
  side: z.enum(["office", "driver", "none"]).optional(),
  fatal: z.boolean().optional(),
  at: z.string().max(40).optional(),
});
export type AppErrorInput = z.infer<typeof APP_ERROR_INPUT>;

const SCRUB: [RegExp, string][] = [
  [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(\.[A-Za-z0-9_-]+)?/g, "<token>"],
  [/\bsb_(publishable|secret)_[A-Za-z0-9_-]+/g, "<key>"],
  [/\bAIza[0-9A-Za-z_-]{20,}/g, "<key>"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<email>"],
  [/(\+?94[\s-]?|\b0)7\d[\s-]?\d{3}[\s-]?\d{4}\b/g, "<phone>"],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<id>"],
  [/\b\d{9,}\b/g, "<number>"],
  [/([?&](token|key|apikey|access_token)=)[^&\s]+/gi, "$1<redacted>"],
];
/** The server's own pass over the phone's text (the same rules as the app's crashLogic.scrub). */
export function scrubText(s: string | null | undefined): string {
  let out = String(s ?? "");
  for (const [re, to] of SCRUB) out = out.replace(re, to);
  return out;
}

/** The row to write: cut to the columns, scrubbed, the side from the API that took it. */
export function appErrorRow(input: AppErrorInput, side: "office" | "driver", employeeId: string | null) {
  const at = input.at && !Number.isNaN(Date.parse(input.at)) ? new Date(input.at).toISOString() : null;
  return {
    side,
    employee_id: employeeId,
    fatal: input.fatal ?? true,
    happened_at: at,
    app_version: input.app_version?.slice(0, 40) ?? null,
    update_id: input.update_id?.slice(0, 80) ?? null,
    runtime: input.runtime?.slice(0, 40) ?? null,
    screen: scrubText(input.screen).slice(0, 200) || null,
    message: scrubText(input.message).slice(0, 300),
    stack: scrubText(input.stack).slice(0, 2000) || null,
  };
}

export async function saveAppError(db: Db, input: AppErrorInput, side: "office" | "driver", employeeId: string | null): Promise<void> {
  unwrap(await db.from("app_errors").insert(appErrorRow(input, side, employeeId)), "app error");
}
