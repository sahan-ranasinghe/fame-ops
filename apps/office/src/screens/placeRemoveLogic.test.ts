// Remove a place (Phase 7, §15), the pure part: the second step's states (the first click arms it with place_detail's
// in_use, confirm only for reasons shown: in_use's or a later needs_confirm), the words and tasks above the second
// button, the notice after removing, which buttons show, and the Removed places view's chips and list_places input.
import { describe, expect, it } from "vitest";
import {
  listArgs, placeActions, REMOVE_IDLE, reasonsText, removedLine, removedNotice, removeInput, removeStep, type RemoveState, removeTasks, removeWords, taskLine,
  whoOf, whoOptions,
} from "./placeRemoveLogic";

const TASKS = [
  { task_id: "t1", title: "Team drop · Kurunegala site", when: "Sat 18 Oct 09:00" },
  { task_id: "t2", title: "Documents to Dialog", when: "Mon 20 Oct 14:30" },
];
const NEEDS = { needs_confirm: true, place: "Head office", reasons: ["Head office is the base place", "2 tasks today or later start or stop there"], tasks: TASKS };

const ARMED: RemoveState = { step: "armed", reasons: [], tasks: [] };

describe("the second step", () => {
  it("arms on the first click with nothing in use: the input stays plain, so the server asks if something came up since", () => {
    const armed = removeStep(REMOVE_IDLE, { type: "start" });
    expect(armed).toEqual(ARMED);
    expect(removeInput("p1", REMOVE_IDLE)).toEqual({ id: "p1" });
    expect(removeInput("p1", armed)).toEqual({ id: "p1" });
    expect(removeTasks(armed)).toEqual([]);
    // A second "start" while armed changes nothing.
    expect(removeStep(armed, { type: "start" })).toBe(armed);
  });

  it("arms with place_detail's in_use: the reasons and tasks above the second button, which confirms (two clicks)", () => {
    const armed = removeStep(REMOVE_IDLE, { type: "start", inUse: { reasons: NEEDS.reasons, tasks: TASKS } });
    expect(armed).toEqual({ step: "armed", reasons: NEEDS.reasons, tasks: TASKS });
    expect(removeInput("p1", armed)).toEqual({ id: "p1", confirm: true });
    expect(removeTasks(armed)).toEqual(TASKS);
    // The base place alone: no tasks, still confirmed.
    const base = removeStep(REMOVE_IDLE, { type: "start", inUse: { reasons: ["Head office is the base place"] } });
    expect(base).toEqual({ step: "armed", reasons: ["Head office is the base place"], tasks: [] });
    expect(removeInput("p1", base)).toEqual({ id: "p1", confirm: true });
  });

  it("a needs_confirm answer (reasons that came up since) keeps its reasons and tasks, and the next call confirms", () => {
    const asked = removeStep(ARMED, { type: "answer", answer: NEEDS });
    expect(asked).toEqual({ step: "needs_confirm", reasons: NEEDS.reasons, tasks: TASKS });
    expect(removeInput("p1", asked)).toEqual({ id: "p1", confirm: true });
    expect(removeTasks(asked)).toEqual(TASKS);
  });

  it("a needs_confirm with only the base place has no tasks", () => {
    expect(removeStep(ARMED, { type: "answer", answer: { needs_confirm: true, reasons: ["Head office is the base place"] } }))
      .toEqual({ step: "needs_confirm", reasons: ["Head office is the base place"], tasks: [] });
  });

  it("the removed answer ends it, with the base place cleared or not", () => {
    expect(removeStep(ARMED, { type: "answer", answer: { removed: "Kandy store" } }))
      .toEqual({ step: "removed", name: "Kandy store", baseCleared: false });
    const asked = removeStep(ARMED, { type: "answer", answer: NEEDS });
    expect(removeStep(asked, { type: "answer", answer: { removed: "Head office", base_place_cleared: true, tasks: TASKS } }))
      .toEqual({ step: "removed", name: "Head office", baseCleared: true });
  });

  it("Keep it goes back to the first step from either question, never from removed", () => {
    expect(removeStep(ARMED, { type: "cancel" })).toEqual(REMOVE_IDLE);
    expect(removeStep({ step: "needs_confirm", reasons: ["x"], tasks: [] }, { type: "cancel" })).toEqual(REMOVE_IDLE);
    const done: RemoveState = { step: "removed", name: "A", baseCleared: false };
    expect(removeStep(done, { type: "cancel" })).toBe(done);
    expect(removeStep(done, { type: "start" })).toBe(done);
  });
});

describe("the words", () => {
  it("each step has its title, text and button; Keep it from the second step on; none once removed", () => {
    expect(removeWords("Kandy store", REMOVE_IDLE)).toMatchObject({ title: "Remove this place", button: "Remove", keep: false });
    expect(removeWords("Kandy store", ARMED)).toEqual({
      title: "Remove Kandy store?",
      text: "It moves to Removed places and can be restored from there.",
      button: "Yes, remove",
      keep: true,
    });
    expect(removeWords("Head office", { step: "armed", reasons: NEEDS.reasons, tasks: TASKS })).toEqual({
      title: "Remove Head office?",
      text: "Head office is the base place; 2 tasks today or later start or stop there. Those tasks keep their stops as they are. " +
        "It moves to Removed places and can be restored from there.",
      button: "Yes, remove",
      keep: true,
    });
    expect(removeWords("Kandy store", { step: "removed", name: "Kandy store", baseCleared: false })).toBeNull();
  });

  it("needs_confirm shows the server's reasons as one sentence above Remove anyway", () => {
    const s = removeStep(ARMED, { type: "answer", answer: NEEDS });
    expect(removeWords("Head office", s)).toEqual({
      title: "Remove Head office anyway?",
      text: "Head office is the base place; 2 tasks today or later start or stop there. Those tasks keep their stops as they are.",
      button: "Remove anyway",
      keep: true,
    });
    expect(removeWords("Head office", { step: "needs_confirm", reasons: ["Head office is the base place"], tasks: [] })?.text)
      .toBe("Head office is the base place.");
  });

  it("the reasons: capitalised, no doubled stops, empty ones dropped", () => {
    expect(reasonsText(["1 task today or later starts or stops there."])).toBe("1 task today or later starts or stops there.");
    expect(reasonsText(["head office is the base place;", " ", "2 tasks today or later start or stop there"]))
      .toBe("Head office is the base place; 2 tasks today or later start or stop there.");
    expect(reasonsText([])).toBe("");
  });

  it("a task as one line", () => {
    expect(TASKS.map(taskLine)).toEqual(["Sat 18 Oct 09:00 · Team drop · Kurunegala site", "Mon 20 Oct 14:30 · Documents to Dialog"]);
  });

  it("the notice after removing: the base place cleared, with the Settings link only for who can set it", () => {
    expect(removedNotice(false, ["update_settings"])).toEqual({ text: "Removed. It is listed under Removed places." });
    expect(removedNotice(true, ["update_settings"]).base).toEqual({ text: "The base place is no longer set: pick another in Settings → Fleet.", link: true });
    expect(removedNotice(true, ["remove_place"]).base).toMatchObject({ link: false });
  });

  it("Removed by whom and when, the year only when it is not this one", () => {
    expect(removedLine("2026-10-17 10:05 by Sahan", "2026")).toBe("Removed by Sahan 17 Oct 10:05");
    expect(removedLine("2025-12-30 09:00", "2026")).toBe("Removed 30 Dec 2025 09:00");
    expect(removedLine("just now", "2026")).toBe("Removed just now");
  });
});

describe("which buttons show", () => {
  const ALL = ["update_place", "remove_place", "restore_place"];
  it("a place: Save and Remove with their tools; a removed place: Restore only", () => {
    expect(placeActions(ALL, false)).toEqual({ edit: true, remove: true, restore: false });
    expect(placeActions(ALL, true)).toEqual({ edit: false, remove: false, restore: true });
    expect(placeActions(["update_place"], false)).toEqual({ edit: true, remove: false, restore: false });
    expect(placeActions(["place_detail"], true)).toEqual({ edit: false, remove: false, restore: false });
    // Switched off by an undone import: no Remove (removing it would not change what anyone sees).
    expect(placeActions(ALL, false, true)).toEqual({ edit: true, remove: false, restore: false });
  });

  it("the Removed places chip only with restore_place; a typed who without it is Our places", () => {
    expect(whoOptions(["list_places"]).map(([k]) => k)).toEqual(["ours", "dialog", "mobitel"]);
    expect(whoOptions(["restore_place"]).at(-1)).toEqual(["removed", "Removed places"]);
    expect(whoOf("removed", ["restore_place"])).toBe("removed");
    expect(whoOf("removed", ["list_places"])).toBe("ours");
    expect(whoOf("dialog", [])).toBe("dialog");
    expect(whoOf(null, [])).toBe("ours");
    expect(whoOf("nonsense", ["restore_place"])).toBe("ours");
  });
});

describe("list_places' input", () => {
  it("removed asks only the removed ones, with the search and Without a pin; the other chips by owner", () => {
    expect(listArgs("removed", "  kandy ", true, 200)).toEqual({ limit: 200, removed: true, search: "kandy", pinned: false });
    expect(listArgs("ours", "", false, 200)).toEqual({ limit: 200, operator: "other" });
    expect(listArgs("mobitel", "MT0184", false, 200)).toEqual({ limit: 200, operator: "mobitel", search: "MT0184" });
  });
});
