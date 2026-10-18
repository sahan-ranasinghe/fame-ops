import { describe, expect, it } from "vitest";
import type { InboxItem } from "../data/types";
import { filterInbox, groupByDay } from "./inboxGroups";

const item = (id: number, at: string, read = false): InboxItem => ({ id, event: "request.decided", title: `Item ${id}`, at, ago: "", read, kind: "alert" });

describe("the tray's days (Hotfix 3, L4)", () => {
  it("Today, Yesterday, Earlier by the Colombo date, the server's order kept, empty days left out", () => {
    const items = [item(5, "2026-10-18 10:42"), item(4, "2026-10-18 08:00"), item(3, "2026-10-17 21:10"), item(2, "2026-10-12 09:00"), item(1, "2026-09-30 09:00")];
    expect(groupByDay(items, "2026-10-18").map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([
      ["Today", [5, 4]],
      ["Yesterday", [3]],
      ["Earlier", [2, 1]],
    ]);
    expect(groupByDay([item(2, "2026-10-12 09:00")], "2026-10-18").map((g) => g.label)).toEqual(["Earlier"]);
    // The first of a month: yesterday is the last of the one before.
    expect(groupByDay([item(1, "2026-09-30 23:59")], "2026-10-01").map((g) => g.label)).toEqual(["Yesterday"]);
    expect(groupByDay([], "2026-10-18")).toEqual([]);
  });
  it("Unread keeps only the unread ones", () => {
    const items = [item(3, "2026-10-18 10:42"), item(2, "2026-10-18 10:00", true), item(1, "2026-10-17 10:00")];
    expect(filterInbox(items, "unread").map((i) => i.id)).toEqual([3, 1]);
    expect(filterInbox(items, "all")).toBe(items);
  });
});
