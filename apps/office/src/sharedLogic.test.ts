// Part B (Sahan, 22 October 2026): the trip rules are one source. Office mode keeps a copy of each site file the request
// and task forms follow (scripts/shared-logic.mjs PAIRS: the who-drives rules, the phone check, the stops, the trip, the
// vehicle choice, the request and the assign rules); this fails when a copy is not the site's file, so a change made on
// one side only never ships. Fix: edit the site's file, then `node scripts/shared-logic.mjs --write`.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("the trip rules shared with Office mode", () => {
  it("every Office-mode copy is the site's file (scripts/shared-logic.mjs --check)", () => {
    // vitest runs from apps/office (here and on CI); the browser-like environment has no file URL for this module.
    const script = resolve(process.cwd(), "../../scripts/shared-logic.mjs");
    const run = spawnSync(process.execPath, [script, "--check"], { encoding: "utf8" });
    expect(run.stdout + run.stderr).toContain("PASS");
    expect(run.status).toBe(0);
  });
});
