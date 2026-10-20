// Hotfix O2-H2, Part 1c: the last crash reports from the app (app_errors), for the people who look after the accounts
// (users). Newest first; the side (office | driver), the person who was signed in, the app version and update, the screen,
// the error and its first stack lines (scrubbed on the phone and again on the server).

import { z } from "zod";

import { unwrap } from "../db.ts";
import { pageInfo, pageWindow } from "../paging.ts";
import { colomboDateTime } from "../time.ts";
import { tool, zPaging } from "../tool.ts";

export const listAppErrors = tool({
  name: "list_app_errors",
  title: "App crash reports",
  description:
    "The crash reports the Fame Fleet app sent (the crash screen, or an error it survived): when, office or driver side, who " +
    "was signed in, the app version and update, the screen, the error and its first stack lines. Scrubbed of personal data on " +
    "the phone. Newest first; kept 90 days.",
  readOnly: true,
  input: z.object({
    side: z.enum(["office", "driver", "all"]).optional().describe("Default all"),
    ...zPaging,
  }),
  async run({ side = "all", limit = 50, cursor }, { db }) {
    const w = pageWindow(limit, cursor);
    let q = db.from("app_errors").select("id, received_at, happened_at, side, fatal, app_version, update_id, runtime, screen, message, stack, employees(name)", { count: "exact" });
    if (side !== "all") q = q.eq("side", side);
    const res = await q.order("received_at", { ascending: false }).order("id", { ascending: false }).range(w.offset, w.offset + (w.limit ?? 50) - 1);
    const rows = unwrap(res, "app errors");
    return {
      result: {
        count: rows.length,
        ...pageInfo(w, rows.length, res.count ?? rows.length),
        errors: rows.map((r) => ({
          id: r.id,
          at: colomboDateTime(r.received_at),
          happened: r.happened_at ? colomboDateTime(r.happened_at) : undefined,
          side: r.side,
          fatal: r.fatal,
          who: (r.employees as { name?: string } | null)?.name ?? undefined,
          app_version: r.app_version ?? undefined,
          update_id: r.update_id ?? undefined,
          runtime: r.runtime ?? undefined,
          screen: r.screen ?? undefined,
          message: r.message,
          stack: r.stack ?? undefined,
        })),
      },
      summary: `${rows.length} app errors (${side})`,
    };
  },
});
