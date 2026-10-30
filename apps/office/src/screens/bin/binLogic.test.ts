// Round 52 (docs/phase8-plan.md §40): the pure part of archive, delete and restore: type-to-confirm compared as the server
// compares it, the words when a record cannot be deleted, the toast, Recently deleted's lines, the archive step's confirm.
import { describe, expect, it } from "vitest";
import {
  ARCHIVE_IDLE, archiveConfirm, archiveTripLine, BIN_KIND_CHOICES, binArgs, deletedByLine, deletedToast, isNeedsConfirm, KIND_TEXT,
  notDeletableLines, personArchiveText, reasonOk, restoreLine, typedMatches, typePrompt, vehicleArchiveText,
} from "./binLogic";

describe("type-to-confirm", () => {
  it("a plate ignores spaces, dashes and case", () => {
    expect(typedMatches("vehicle", "wp cab4521", "WP CAB-4521")).toBe(true);
    expect(typedMatches("vehicle", "WPCAB-4521", "WP CAB-4521")).toBe(true);
    expect(typedMatches("vehicle", "WP CAB-452", "WP CAB-4521")).toBe(false);
    expect(typedMatches("vehicle", "", "WP CAB-4521")).toBe(false);
  });
  it("a name ignores case and extra spaces, never the letters", () => {
    expect(typedMatches("driver", "  kamal   perera ", "Kamal Perera")).toBe(true);
    expect(typedMatches("office_person", "KAMAL PERERA", "Kamal Perera")).toBe(true);
    expect(typedMatches("driver", "Kamal Pereira", "Kamal Perera")).toBe(false);
    expect(typedMatches("driver", "KamalPerera", "Kamal Perera")).toBe(false);
  });
  it("says what to type", () => {
    expect(typePrompt("vehicle", "WP CAB-4521")).toBe("Type the plate WP CAB-4521 to confirm");
    expect(typePrompt("driver", "Kamal Perera")).toBe("Type the name Kamal Perera to confirm");
  });
});

describe("when it cannot be deleted", () => {
  const base = { kind: "vehicle" as const, id: "v1", label: "WP CAB-4521" };
  it("history: archive instead", () => {
    expect(notDeletableLines({ ...base, deletable: false, history: { tasks: 3, fuel: 2 }, history_words: "3 tasks, 2 fills" }))
      .toEqual(["Has history (3 tasks, 2 fills): archive instead"]);
  });
  it("the account rule's sentence first, then the history", () => {
    expect(notDeletableLines({ ...base, kind: "office_person", deletable: false, problem: "You cannot delete your own account. Ask another admin." }))
      .toEqual(["You cannot delete your own account. Ask another admin."]);
    expect(notDeletableLines({ ...base, deletable: false, problem: "Only an admin can.", history_words: "1 task" }))
      .toEqual(["Only an admin can.", "Has history (1 task): archive instead"]);
  });
  it("a deletable one has no lines", () => {
    expect(notDeletableLines({ ...base, deletable: true, confirm_with: "WP CAB-4521" })).toEqual([]);
  });
});

describe("the words after and in the bin", () => {
  it("the toast names the last day in words", () => {
    expect(deletedToast("2026-11-29")).toMatch(/^Deleted · in Recently deleted until \w{3} 29 Nov( 2026)?$/);
    expect(deletedToast()).toBe("Deleted · in Recently deleted");
  });
  it("a reason is a few words", () => {
    expect(reasonOk("  ab ")).toBe(false);
    expect(reasonOk("Logged twice")).toBe(true);
  });
  it("who deleted it and until when it can come back", () => {
    expect(deletedByLine({ deleted_by: "Sahan", deleted_at: "2025-12-30 09:00" })).toBe("Deleted by Sahan · Tue 30 Dec 2025 09:00");
    expect(restoreLine({ until: "2025-12-30", days_left: 12 })).toBe("Restore until Tue 30 Dec 2025 (12 days)");
    expect(restoreLine({ until: "2025-12-30", days_left: 1 })).toBe("Restore until Tue 30 Dec 2025 (1 day)");
    expect(restoreLine({ until: "2025-12-30", days_left: 0 })).toBe("Restore until Tue 30 Dec 2025 (today)");
  });
  it("every kind has words, and the Filter offers them all after All kinds", () => {
    expect(BIN_KIND_CHOICES[0]).toEqual(["", "All kinds"]);
    expect(BIN_KIND_CHOICES).toHaveLength(13);
    for (const [k, label] of BIN_KIND_CHOICES.slice(1)) expect(label).toBe(KIND_TEXT[k as keyof typeof KIND_TEXT]);
    expect(Object.values(KIND_TEXT).every((w) => !/_/.test(w))).toBe(true);
  });
  it("list_bin's input: the kind and the search only when given", () => {
    expect(binArgs("", "  ")).toEqual({});
    expect(binArgs("vehicle", " cab ")).toEqual({ kind: "vehicle", search: "cab" });
  });
});

describe("the archive step", () => {
  const trips = [{ task_id: "t1", title: "Team drop · Kandy", when: "2025-12-30 09:00" }];
  it("knows a needs_confirm answer", () => {
    expect(isNeedsConfirm({ needs_confirm: true, trips })).toBe(true);
    expect(isNeedsConfirm({ driver: "Kamal", active: false })).toBe(false);
    expect(isNeedsConfirm(undefined)).toBe(false);
  });
  it("sends confirm only once the trips were shown", () => {
    expect(archiveConfirm(ARCHIVE_IDLE)).toEqual({});
    expect(archiveConfirm({ step: "armed" })).toEqual({});
    expect(archiveConfirm({ step: "trips", trips })).toEqual({ confirm: true });
  });
  it("a trip in words", () => {
    expect(archiveTripLine(trips[0])).toBe("Tue 30 Dec 2025 09:00 · Team drop · Kandy");
  });
  it("a person's confirm says the sign-in stops and what stays; the trips step says Archive anyway", () => {
    expect(personArchiveText("Kamal", ARCHIVE_IDLE).button).toBe("Archive");
    const armed = personArchiveText("Kamal", { step: "armed" });
    expect(armed.title).toBe("Archive Kamal?");
    expect(armed.text).toContain("They can no longer sign in");
    expect(armed.text).toContain("Their trips, fills and readings stay.");
    expect(personArchiveText("Kamal", { step: "trips", trips })).toMatchObject({ title: "Archive Kamal anyway?", button: "Archive anyway" });
  });
  it("a vehicle's words", () => {
    expect(vehicleArchiveText("WP CAB-4521", { step: "armed" }).button).toBe("Yes, archive");
    expect(vehicleArchiveText("WP CAB-4521", { step: "trips", trips }).text).toContain("booked for 1 trip from today on");
  });
});
