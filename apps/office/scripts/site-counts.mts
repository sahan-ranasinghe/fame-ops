// The Part 4 presets on the real spreadsheets (data/sites, kept out of git): the counts for the checkpoint.
//   ../driver/node_modules/.bin/tsx scripts/site-counts.mts            the presets' counts
//   ../driver/node_modules/.bin/tsx scripts/site-counts.mts --local    and the import into the LOCAL stack (never the real project)
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import { PRESETS, type Preset, presetRows } from "../../../supabase/functions/_shared/fleet/sites.ts";

const files: Record<Preset, string> = { dialog: "dialog.xlsx", mobitel_4g: "mobitel.xlsx", mobitel_ep: "mobitel.xlsx" };
const local = process.argv.includes("--local");
let db: ReturnType<typeof createClient> | null = null;
if (local) {
  const status = execFileSync("npx", ["supabase", "status", "-o", "env"], { cwd: new URL("../../..", import.meta.url).pathname, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const setting = (name: string) => status.match(new RegExp(`^${name}="?([^"\\n]*)"?$`, "m"))?.[1] ?? "";
  if (!setting("API_URL").includes("127.0.0.1")) throw new Error("not the local stack");
  db = createClient(setting("API_URL"), setting("SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
}
for (const preset of Object.keys(files) as Preset[]) {
  const wb = XLSX.read(readFileSync(new URL(`../../../data/sites/${files[preset]}`, import.meta.url)));
  const cells = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[PRESETS[preset].sheet], { defval: null });
  const r = presetRows(preset, cells);
  console.log(`${preset}: read ${r.read}, places ${r.rows.length} (with pin ${r.with_pin}, no pin ${r.no_pin}, with an id ${r.rows.filter((x) => x.site_id).length}), skipped ${r.skipped.length}, repaired ${r.repaired.length}`);
  if (!db) continue;
  const t0 = Date.now();
  const total = { added: 0, updated: 0, attached: 0, no_pin: 0, skipped: 0 };
  const reasons = new Map<string, number>();
  for (let i = 0; i < r.rows.length; i += 500) {
    const { data, error } = await db.rpc("import_place_rows", { p_rows: r.rows.slice(i, i + 500), p_preset: preset });
    if (error) throw new Error(`${preset} batch ${i / 500 + 1}: ${error.message}`);
    const a = data as { added: number; updated: number; attached: number; no_pin: number; skipped: { reason: string }[] };
    total.added += a.added; total.updated += a.updated; total.attached += a.attached; total.no_pin += a.no_pin; total.skipped += a.skipped.length;
    for (const s of a.skipped) { const k = s.reason.replace(/^\S+ is/, "<id> is").replace(/of \S+$/, "of <site>"); reasons.set(k, (reasons.get(k) ?? 0) + 1); }
  }
  console.log(`   imported locally in ${((Date.now() - t0) / 1000).toFixed(1)} s: ${JSON.stringify(total)} ${reasons.size ? JSON.stringify(Object.fromEntries(reasons)) : ""}`);
}
if (db) {
  const { count } = await db.from("places").select("id", { count: "exact", head: true });
  console.log(`places in the local database: ${count}`);
}
