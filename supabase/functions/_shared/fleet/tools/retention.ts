// Round 4–7, item 9 (Sahan, 22 October 2026): Settings → Data retention's two buttons. retention_preview counts what the
// next run would remove (nothing is removed); run_retention removes it now (the same run as the nightly job, written once in
// the activity log). The periods are the setting `retention` (update_settings), with its minimums.

import { z } from "zod";
import { ToolError } from "../db.ts";
import { NEVER, RULES, runRetention } from "../retention.ts";
import { loadSettings, RETENTION_MINIMUMS } from "../settings.ts";
import { tool } from "../tool.ts";
import { routineToolNames } from "./activity.ts";

export const retentionPreview = tool({
  name: "retention_preview",
  title: "Data retention: what would go",
  description: "What the nightly retention job (02:45 Colombo) would remove now, by kind, with each period in days and the " +
    "first day kept: nothing is removed. Also the periods, their minimums and what is never removed automatically.",
  readOnly: true,
  input: z.object({}),
  async run(_args, { db, now }) {
    const [run, settings] = await Promise.all([
      runRetention(db, now, { dry: true, routine: routineToolNames(), by: "preview" }),
      loadSettings(db),
    ]);
    return {
      result: {
        periods: settings.retention,
        minimums: RETENTION_MINIMUMS,
        rules: run.counts,
        would_remove: run.counts.reduce((s, c) => s + c.count, 0),
        never: NEVER,
        nightly: "02:45 Colombo",
        kinds: RULES.length,
      },
      summary: `retention preview: ${run.counts.reduce((s, c) => s + c.count, 0)} rows`,
    };
  },
});

export const runRetentionNow = tool({
  name: "run_retention",
  title: "Data retention: remove now",
  description: "Runs the retention job now (as at night): what is past its period removed in batches (a driver's location " +
    "points only once their day is kept as a summary; the summaries are made every 15 minutes); one activity-log row says " +
    "what went. confirm must be true (show retention_preview first).",
  readOnly: false,
  input: z.object({ confirm: z.literal(true).describe("true, after retention_preview") }),
  async run({ confirm }, { db, now, actor }) {
    if (confirm !== true) throw new ToolError("Show retention_preview first, then confirm.");
    const run = await runRetention(db, now, { dry: false, routine: routineToolNames(), by: actor.name, byEmployee: actor.employeeId });
    return { result: { line: run.line, counts: run.counts, summarised: run.summarised }, summary: run.line };
  },
});
