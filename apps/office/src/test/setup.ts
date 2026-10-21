import { cleanup, configure } from "@testing-library/react";
import { afterEach, expect } from "vitest";
import { internalText } from "./noInternalText";

// Round 1 (21 October 2026): nothing internal on any screen a test renders (keys, enum names, ids, JSON, HTTP codes).
// Inputs' values are what the person typed; only the text shown counts. FLEET_TEXT_GUARD=report lists instead of failing.
afterEach(() => {
  if (typeof document !== "undefined" && document.body) {
    const leak = internalText(document.body.innerText ?? document.body.textContent ?? "");
    if (leak) {
      const where = expect.getState().currentTestName ?? "";
      if (process.env.FLEET_TEXT_GUARD === "report") console.warn(`[internal text] ${where}: ${leak.kind} "${leak.match}"`);
      else {
        cleanup();
        throw new Error(`Internal text on the screen (${leak.kind}): "${leak.match}"`);
      }
    }
  }
  cleanup();
});

// waitFor and findBy wait up to 5 s (1 s by default): under the full suite's load (about 100 files at once) a screen's
// answer can take longer than a second, and two tests failed that way while passing alone (19 October). A condition
// that never holds still fails; the test's own limit stays 15 s (vite.config.ts).
configure({ asyncUtilTimeout: 5_000 });

// The suite at a chosen time of day (21 October 2026: a test failed only at 08:56–09:00): FLEET_TEST_CLOCK=<ISO time>
// moves the clock there for every test (it keeps running from there). Unset, the real clock.
const clockAt = process.env.FLEET_TEST_CLOCK;
if (clockAt) {
  const RealDate = Date;
  const offset = new RealDate(clockAt).getTime() - RealDate.now();
  class ShiftedDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(RealDate.now() + offset);
      else super(...(args as [number]));
    }
    static now() { return RealDate.now() + offset; }
  }
  globalThis.Date = ShiftedDate as DateConstructor;
}
