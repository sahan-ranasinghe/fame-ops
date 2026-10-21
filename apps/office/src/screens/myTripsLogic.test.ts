// My trips' rules (Hotfix 2, A): the status filter in the URL (All by default), the tool's arguments, the live state's
// pill, who decided it, and the phone links.
import { describe, expect, it } from "vitest";
import type { CreatedTaskCard, RequestCard } from "../data/types";
import {
  createdLive,
  createdTaskLink,
  decisionLines,
  driverPhone,
  emptyText,
  isCreatedTask,
  isRequestTrip,
  liveOf,
  liveTone,
  officePhoneOf,
  personPhone,
  readShow,
  readStatus,
  totalsLine,
  TRIP_SHOW_OPTIONS,
  TRIP_STATUS_OPTIONS,
  tripsArgs,
  vehicleOf,
  writeStatus,
} from "./myTripsLogic";

const card = (extra: Partial<RequestCard> = {}): RequestCard => ({ id: "r1", requested_by: "Dilini", when: "Sun 18 Oct 09:00", status: "waiting", ...extra });

describe("the status filter", () => {
  it("in the plan's order, All last; anything unknown is All; All leaves no trace in the URL", () => {
    expect(TRIP_STATUS_OPTIONS.map(([, l]) => l)).toEqual(["Waiting", "Approved", "Under way", "Completed", "Declined", "Cancelled", "Expired", "All"]);
    expect(readStatus(new URLSearchParams("status=under_way"))).toBe("under_way");
    expect(readStatus(new URLSearchParams("status=lost"))).toBe("all");
    expect(readStatus(new URLSearchParams(""))).toBe("all");
    expect(writeStatus(new URLSearchParams("range=week"), "declined").toString()).toBe("range=week&status=declined");
    expect(writeStatus(new URLSearchParams("range=week&status=declined"), "all").toString()).toBe("range=week");
  });
  it("my_trips' arguments: the days, and the status unless All", () => {
    expect(tripsArgs("2026-10-01", "2026-10-31", "all")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(tripsArgs("2026-10-01", "2026-10-31", "completed")).toEqual({ from: "2026-10-01", to: "2026-10-31", status: "completed" });
  });
});

describe("the live state", () => {
  it("the server's words with a colour per state", () => {
    const live = { state: "on_the_way" as const, text: "On the way · 09:30" };
    expect(liveOf(card({ status: "approved", live }))).toBe(live);
    expect(liveTone("waiting")).toBe("warn");
    expect(liveTone("approved")).toBe("ok");
    expect(liveTone("accepted")).toBe("ok");
    expect(liveTone("on_the_way")).toBe("live");
    expect(liveTone("arrived")).toBe("live");
    expect(liveTone("completed")).toBe("muted");
    expect(liveTone("declined")).toBe("bad");
    expect(liveTone("cancelled")).toBe("muted");
  });
  it("an answer without `live`: from the status and its reason", () => {
    expect(liveOf(card())).toEqual({ state: "waiting", text: "Waiting" });
    expect(liveOf(card({ status: "changed" })).state).toBe("waiting");
    expect(liveOf(card({ status: "approved" }))).toEqual({ state: "approved", text: "Approved" });
    expect(liveOf(card({ status: "declined", decline_reason: "no vehicle that day" }))).toEqual({ state: "declined", text: "Declined · no vehicle that day" });
    expect(liveOf(card({ status: "cancelled" }))).toEqual({ state: "cancelled", text: "Cancelled" });
  });
});

describe("who decided", () => {
  it("Approved by …, Declined by … · reason, Cancelled by … · reason", () => {
    expect(decisionLines(card({ approved_by: { name: "Palitha", at: "10:42" } }))).toEqual(["Approved by Palitha · 10:42"]);
    expect(decisionLines(card({ declined_by: { name: "Palitha", at: "10:42", reason: "no vehicle that day" } }))).toEqual(["Declined by Palitha · 10:42 · no vehicle that day"]);
    expect(decisionLines(card({ approved_by: { name: "Palitha", at: "Sat 17 Oct 10:42" }, cancelled_by: { name: "Sahan", at: "11:05", reason: "not needed" } })))
      .toEqual(["Approved by Palitha · Sat 17 Oct 10:42", "Cancelled by Sahan · 11:05 · not needed"]);
    expect(decisionLines(card())).toEqual([]);
  });
});

describe("phones", () => {
  it("the driver's links from the card (the server's tel: and wa.me when given)", () => {
    const a = { driver: "Kamal", vehicle: "WP CAB-4521", phone: "+94771234567", call: "tel:+94771234567", whatsapp: "https://wa.me/94771234567" };
    expect(driverPhone(a)).toEqual({ phone: "+94771234567", phone_display: "077 123 4567", call: "tel:+94771234567", whatsapp: "https://wa.me/94771234567" });
    expect(driverPhone({ driver: "Kamal", vehicle: "", phone: "0771234567" })?.call).toBe("tel:+94771234567");
    expect(driverPhone({ driver: "Kamal", vehicle: "" })).toBeNull();
    expect(driverPhone(undefined)).toBeNull();
  });
  it("the approver's links, none without a number; the office's from the first trip that has it", () => {
    expect(personPhone({ name: "Palitha", at: "10:42", phone: "+94770000001", phone_display: "077 000 0001", call: "tel:+94770000001", whatsapp: "https://wa.me/94770000001" })?.phone_display).toBe("077 000 0001");
    expect(personPhone({ name: "Palitha", at: "10:42" })).toBeNull();
    const office = { phone: "+94112345678", phone_display: "011 234 5678", call: "tel:+94112345678", whatsapp: "https://wa.me/94112345678" };
    expect(officePhoneOf([card(), card({ id: "r2", office_phone: office })])).toBe(office);
    expect(officePhoneOf([card()])).toBeNull();
  });
});

describe("words", () => {
  it("the vehicle, the totals and the empty list", () => {
    expect(vehicleOf({ driver: "Kamal", vehicle: "WP CAB-4521" })).toEqual({ plate: "WP CAB-4521" });
    expect(vehicleOf({ driver: "Kamal", vehicle: "", vehicle_text: "Any van" })).toEqual({ text: "Any van" });
    expect(vehicleOf({ driver: "Kamal", vehicle: "" })).toEqual({ text: "Vehicle: on the day" });
    expect(totalsLine(1, "2026-10-01", "2026-10-31")).toBe("1 trip · Thu 1 Oct – Sat 31 Oct 2026");
    expect(totalsLine(3, "2026-10-18", "2026-10-18")).toBe("3 trips · Sun 18 Oct 2026");
    expect(emptyText("all", true)).toBe("No trips in these dates. Ask for a vehicle with New request.");
    expect(emptyText("under_way", true)).toBe("No under way trips in these dates.");
  });
});

describe("Hotfix 3: what is shown, the search, the tasks I created", () => {
  it("?show= into include (always said by the page), the search; anything unknown is All", () => {
    expect(TRIP_SHOW_OPTIONS.map(([, l]) => l)).toEqual(["All", "Requests", "Tasks I created"]);
    expect(readShow(new URLSearchParams("show=tasks"))).toBe("tasks");
    expect(readShow(new URLSearchParams("show=mine"))).toBe("all");
    expect(tripsArgs("2026-10-01", "2026-10-31", "all", "all")).toEqual({ from: "2026-10-01", to: "2026-10-31", include: "all" });
    expect(tripsArgs("2026-10-01", "2026-10-31", "completed", "tasks", "Kandy")).toEqual({ from: "2026-10-01", to: "2026-10-31", status: "completed", include: "tasks", search: "Kandy" });
  });
  it("a created task: told apart from a request, its link, its live state from its status when the server gives none", () => {
    const task: CreatedTaskCard = { source: "task", id: "t7", task_id: "t7", title: "Drop", when: "09:00", status: "missed", live: undefined as unknown as CreatedTaskCard["live"], created: "2026-10-18 10:42" };
    expect(isCreatedTask(task)).toBe(true);
    expect(isRequestTrip(task)).toBe(false);
    expect(isCreatedTask(card())).toBe(false);
    expect(createdTaskLink(task)).toBe("/tasks/t7");
    expect(createdLive(task)).toEqual({ state: "cancelled", text: "Missed · never started" });
    expect(createdLive({ ...task, status: "in_progress" }).state).toBe("on_the_way");
    expect(createdLive({ ...task, live: { state: "arrived", text: "Arrived · 10:05" } }).text).toBe("Arrived · 10:05");
  });
  it("the empty list for what is shown and the words searched for", () => {
    expect(emptyText("all", true, "tasks")).toBe("You created no task in these dates.");
    expect(emptyText("completed", true, "tasks")).toBe("No completed tasks you created in these dates.");
    expect(emptyText("all", true, "requests")).toBe("No requests in these dates. Ask for a vehicle with New request.");
    expect(emptyText("declined", false, "requests")).toBe("No declined requests in these dates.");
    expect(emptyText("all", true, "all", "Galle")).toBe('No trip matches "Galle" in these dates.');
    expect(emptyText("waiting", true, "tasks", "Galle")).toBe('No waiting task you created matches "Galle" in these dates.');
  });
});
