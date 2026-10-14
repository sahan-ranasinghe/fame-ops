import { afterEach, describe, expect, it } from "vitest";
import { DRAFT_PREFIX, draftKey, readDraft, removeDraft, writeDraft } from "./drafts";

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
