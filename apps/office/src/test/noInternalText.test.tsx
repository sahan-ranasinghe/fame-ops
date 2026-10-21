// The site's guard (src/test/noInternalText.ts, run after every render test by src/test/setup.ts) catches what it should
// and lets a person's words through.
import { describe, expect, it } from "vitest";
import { internalText } from "./noInternalText";

describe("no internal text on a screen", () => {
  it("catches keys, enum names, ids, JSON and HTTP codes", () => {
    for (const [text, kind] of [
      ["Status: office.status.Sent", "a translation key"],
      ["Status in_progress", "an enum or code name"],
      ["Role fleet_admin", "an enum or code name"],
      ["Task 3f2a9c1e-1234-4abc-9def-000000000000", "an id"],
      ['Error {"error":"x"}', "JSON"],
      ["Failed: HTTP 500", "an HTTP code"],
      ["Driver undefined", "a programming word"],
    ] as const) expect(internalText(text)?.kind, text).toBe(kind);
  });
  it("lets people's words, e-mails, links, plates, times and numbers through", () => {
    for (const text of ["Sent · not opened yet", "Seen by driver 16:06", "palitha@fame.lk", "https://fame-fleet.pages.dev/tasks/x", "WP CAB-4521", "12.5 km · LKR 4,500.00", "Leave by 07:24"]) {
      expect(internalText(text), text).toBeNull();
    }
  });
});
