import { afterEach, describe, expect, it } from "vitest";
import { DRAFT_KEEP_DAYS, DRAFT_PREFIX, draftFresh, draftKey, keepDaysOf, pruneDrafts, readDraft, removeDraft, writeDraft } from "./drafts";
import type { SettingsResult } from "./types";

describe("drafts in the browser's storage", () => {
  afterEach(() => localStorage.clear());
  it("keys a draft by person, form and record", () => {
    expect(draftKey("sahan@fame.test", "request-new")).toBe(`${DRAFT_PREFIX}sahan@fame.test:request-new`);
    expect(draftKey("sahan@fame.test", "vehicle-edit", "WP CAB-4521")).toBe(`${DRAFT_PREFIX}sahan@fame.test:vehicle-edit:WP CAB-4521`);
    expect(draftKey("artifact", "task-new")).toBe(`${DRAFT_PREFIX}artifact:task-new`);
  });
  it("writes, reads back with the time, and removes", () => {
    const key = draftKey("a@b", "f");
    expect(readDraft(key)).toBeNull();
    writeDraft(key, { note: "hello" }, 1700000000000);
    expect(readDraft<{ note: string }>(key)).toEqual({ at: 1700000000000, state: { note: "hello" } });
    removeDraft(key);
    expect(readDraft(key)).toBeNull();
  });
  it("ignores a broken entry", () => {
    localStorage.setItem(draftKey("a@b", "f"), "{not json");
    expect(readDraft(draftKey("a@b", "f"))).toBeNull();
    localStorage.setItem(draftKey("a@b", "g"), JSON.stringify({ nope: true }));
    expect(readDraft(draftKey("a@b", "g"))).toBeNull();
  });
});

describe("the keep period (Round 4–7, item 9)", () => {
  afterEach(() => localStorage.clear());
  const DAY = 86_400_000;
  it("fresh within the period; the period from get_settings, 30 when absent, null when not known", () => {
    const now = Date.now();
    expect(draftFresh(now - 30 * DAY, 30, now)).toBe(true);
    expect(draftFresh(now - 30 * DAY - 1, 30, now)).toBe(false);
    expect(keepDaysOf(undefined)).toBeNull();
    expect(keepDaysOf({ settings: {} } as unknown as SettingsResult)).toBe(DRAFT_KEEP_DAYS);
    expect(keepDaysOf({ settings: { retention: { drafts_days: 7 } } } as unknown as SettingsResult)).toBe(7);
  });
  it("prune removes every expired draft and a broken one, keeps the fresh ones and other keys", () => {
    const now = Date.now();
    writeDraft(draftKey("a@b", "f"), { x: 1 }, now - 40 * DAY);
    writeDraft(draftKey("c@d", "g"), { x: 2 }, now - DAY);
    localStorage.setItem(draftKey("a@b", "h"), "{not json");
    localStorage.setItem("fleet.view", "phone");
    expect(pruneDrafts(30, now)).toBe(2);
    expect(readDraft(draftKey("a@b", "f"))).toBeNull();
    expect(readDraft(draftKey("c@d", "g"))).not.toBeNull();
    expect(localStorage.getItem("fleet.view")).toBe("phone");
  });
});
