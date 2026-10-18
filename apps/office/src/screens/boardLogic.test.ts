// Part 3b (H5): the Drivers board's filters and counts, the search, the week's days and the week grid.
import { describe, expect, it } from "vitest";
import { boardAnswer, BOARD_DAYS, HALF, KAMAL, LEAVE, NUWAN, RUWAN, SUNIL } from "./__fixtures__/driversBoard";
import { boardAskLink, boardCounts, boardEmpty, dayHead, filterBoard, matchesFilter, mondayOf, weekGrid, weekLabel, weekStart, weekTaskText } from "./boardLogic";

const names = (rows: { name: string }[]) => rows.map((r) => r.name);

describe("the board's filters (the server's rules)", () => {
  const all = boardAnswer().drivers;

  it("free now = free and on duty; the others by the status now", () => {
    expect(names(filterBoard(all, "all"))).toEqual(["Kamal Perera", "Nuwan Silva", "Sunil Fernando", "Ruwan Jaya"]);
    expect(names(filterBoard(all, "free_now"))).toEqual(["Kamal Perera"]);
    expect(names(filterBoard(all, "on_task"))).toEqual(["Nuwan Silva"]);
    expect(names(filterBoard(all, "off_duty"))).toEqual(["Sunil Fernando"]);
    expect(names(filterBoard(all, "not_available"))).toEqual(["Ruwan Jaya"]);
    // On duty but busy is not free now.
    expect(matchesFilter({ ...KAMAL, free_now: false }, "free_now")).toBe(false);
  });

  it("counts every filter among the drivers the search finds (the server's counts with no search)", () => {
    expect(boardCounts(all)).toEqual(boardAnswer().counts);
    expect(boardCounts(all, "silva")).toEqual({ all: 1, free_now: 0, on_task: 1, off_duty: 0, not_available: 0 });
  });

  it("the search: name or username, letters and digits only, any case", () => {
    expect(names(filterBoard(all, "all", "KAMAL"))).toEqual(["Kamal Perera"]);
    expect(names(filterBoard(all, "all", "sunil.f"))).toEqual(["Sunil Fernando"]);
    expect(names(filterBoard(all, "all", "ruwan ja"))).toEqual(["Ruwan Jaya"]);
    expect(names(filterBoard(all, "off_duty", "kamal"))).toEqual([]);
  });

  it("an empty list in words", () => {
    expect(boardEmpty("free_now", "")).toBe("Nobody is free right now.");
    expect(boardEmpty("not_available", "")).toBe("Everyone is available right now.");
    expect(boardEmpty("all", "zz")).toBe('No driver matches "zz" (name or username).');
    expect(boardEmpty("on_task", "zz")).toBe('No driver matches "zz" (name or username) among "On a task".');
  });

  it("Ask drivers: the ticked ones, else all the free ones", () => {
    expect(boardAskLink(["kamal.p", "nuwan.s"])).toBe("/drivers/ask?drivers=kamal.p%2Cnuwan.s");
    expect(boardAskLink([])).toBe("/drivers/ask?all_free=1");
  });
});

describe("the week", () => {
  it("starts on Monday: any day moves to its Monday; none = this week's", () => {
    expect(mondayOf("2026-10-19")).toBe("2026-10-19");
    expect(mondayOf("2026-10-22")).toBe("2026-10-19");
    expect(mondayOf("2026-10-25")).toBe("2026-10-19"); // a Sunday belongs to the week before it
    expect(weekStart(null, "2026-10-21")).toBe("2026-10-19");
    expect(weekStart("2026-10-28", "2026-10-21")).toBe("2026-10-26");
    expect(weekStart("not a date", "2026-10-21")).toBe("2026-10-19");
  });

  it("the headings in words", () => {
    expect(dayHead("2026-10-20")).toEqual({ day: "Tue 20", month: "Oct" });
    expect(weekLabel("2026-10-19")).toBe("19 – 25 Oct 2026");
    expect(weekLabel("2026-10-26")).toBe("26 Oct – 1 Nov 2026");
    expect(weekTaskText({ id: "t", title: "Team drop", time: "09:00", end: "10:40", status: "assigned" })).toBe("09:00–10:40 Team drop");
  });

  it("the grid: the drivers shown × 7 days, each day's tasks by time and its entries, the past days marked", () => {
    const board = boardAnswer(true);
    const grid = weekGrid(board, [KAMAL, SUNIL, RUWAN], "2026-10-20")!;
    expect(grid.days).toEqual(BOARD_DAYS);
    expect(grid.rows.map((r) => r.key)).toEqual(["kamal.p", "sunil.f", "ruwan.j"]);
    const kamal = grid.rows[0];
    expect(kamal.cells).toHaveLength(7);
    expect(kamal.cells[0]).toMatchObject({ date: "2026-10-19", past: true, today: false, tasks: [], off: [] });
    expect(kamal.cells[1].today).toBe(true);
    expect(kamal.cells[1].past).toBe(false);
    expect(kamal.cells[1].tasks.map((t) => t.time)).toEqual(["09:00", "14:30"]);
    expect(kamal.cells[1].off).toEqual([HALF]);
    // Sunil is not in the week's answer: seven empty days.
    expect(grid.rows[1].cells.every((c) => c.tasks.length === 0 && c.off.length === 0)).toBe(true);
    // Ruwan's two days of leave are the same entry on both days.
    expect(grid.rows[2].cells.filter((c) => c.off.includes(LEAVE)).map((c) => c.date)).toEqual(["2026-10-21", "2026-10-22"]);
    // Nuwan is filtered out of the rows shown.
    expect(grid.rows.some((r) => r.name === NUWAN.name)).toBe(false);
    expect(RUWAN.status.kind).toBe("not_available");
  });

  it("no week in the answer: no grid", () => {
    expect(weekGrid(boardAnswer(false), [KAMAL], "2026-10-20")).toBeNull();
    expect(weekGrid(undefined, [KAMAL], "2026-10-20")).toBeNull();
  });
});
