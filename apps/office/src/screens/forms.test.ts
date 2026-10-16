import { describe, expect, it } from "vitest";
import { driverWhatsApp, emptyAssign, planInput, validateAssign } from "./assignLogic";
import { bookInput, decisionInput, emptyRequest, suggestInput, timelineSteps, validateNewRequest, diffLines, editFields, redecideInput, updateRequestInput } from "./requestLogic";

function filledAssign() {
  const f = { ...emptyAssign("2026-10-12"), title: "Team drop · Matara", leaveBy: "06:30", driver: "kasun.s", vehicle: "WP CAB-4521" };
  f.stops[0].place = "Head office";
  f.stops[1].place = "Matara site";
  return f;
}

describe("Assign a task", () => {
  it("names what is missing", () => {
    expect(validateAssign(emptyAssign("2026-10-12"), [])).toEqual({ error: "Add the task, a driver, a vehicle." });
    const noStops = { ...emptyAssign("2026-10-12"), title: "T", driver: "d", vehicle: "v" };
    expect(validateAssign(noStops, [])).toEqual({ error: "Add at least one stop." });
    const noTime = filledAssign();
    noTime.leaveBy = "";
    expect(validateAssign(noTime, [])).toEqual({ error: "Add a leave-by time, or an arrive-by time on a stop so it can be planned." });
    noTime.stops[1].arriveBy = "10:00";
    expect("input" in validateAssign(noTime, [])).toBe(true);
  });
  it("builds exactly the create_task arguments", () => {
    const v = validateAssign({ ...filledAssign(), pax: "3", end: "13:30", cname: "Ruwan", cphone: "0771234567", notes: "Tools", returnToBase: true, avoidExpressway: true, buffer: "20", start: "Depot" }, [], "Sahan Ranasinghe");
    expect(v).toEqual({
      input: {
        title: "Team drop · Matara", date: "2026-10-12", leave_by: "06:30", driver: "kasun.s", vehicle: "WP CAB-4521",
        stops: [{ type: "pickup", place: "Head office" }, { type: "drop", place: "Matara site" }],
        start: { place: "Depot" }, return_to_base: true, avoid_expressway: true, buffer_min: 20,
        end_time: "13:30", passengers: 3, contact_name: "Ruwan", contact_phone: "0771234567", notes: "Tools", created_by: "Sahan Ranasinghe",
      },
    });
  });
  it("the plan preview needs a date, valid stops and a leave time or a deadline", () => {
    expect(planInput(emptyAssign("2026-10-12"))).toBeNull();
    const f = filledAssign();
    expect(planInput(f)).toEqual({ date: "2026-10-12", stops: [{ type: "pickup", place: "Head office" }, { type: "drop", place: "Matara site" }], leave_by: "06:30", driver: "kasun.s", vehicle: "WP CAB-4521" });
    f.leaveBy = "";
    expect(planInput(f)).toBeNull();
  });
  it("needs the project split to total 100", () => {
    expect(validateAssign(filledAssign(), [{ project: "13021", percent: 60 }, { project: "TRKAN1", percent: 30 }])).toEqual({ error: "Project percentages add up to 90%. They must total 100%." });
    const v = validateAssign(filledAssign(), [{ project: "13021", percent: "60" }, { project: " TRKAN1 ", percent: 40 }, { project: "", percent: 5 }]);
    expect("input" in v && v.input.projects).toEqual([{ project: "13021", percent: 60 }, { project: "TRKAN1", percent: 40 }]);
  });
  it("writes the driver's WhatsApp message", () => {
    const v = validateAssign({ ...filledAssign(), cname: "Ruwan" }, []);
    const url = driverWhatsApp("input" in v ? v.input : {}, "0771234567", "Leave by Mon 12 Oct 06:30");
    expect(url.startsWith("https://wa.me/94771234567?text=")).toBe(true);
    expect(decodeURIComponent(url.split("text=")[1])).toBe("New task: Team drop · Matara\nLeave by Mon 12 Oct 06:30\nPickup: Head office\nDrop-off: Matara site\nContact: Ruwan\nOpen Fame Driver for the details.");
  });
});

describe("Vehicle requests", () => {
  it("needs the day and the time", () => {
    expect(validateNewRequest(emptyRequest("2026-10-12"))).toEqual({ error: "Add the day and the time." });
  });
  it("builds the create_request arguments, in the asker's own name, with who it is for when that is someone else", () => {
    const v = validateNewRequest({ ...emptyRequest("2026-10-12"), time: "08:00", project: "HR", need: "van", pax: "6", tools: true, to: "Matara" });
    expect(v).toEqual({ input: { date: "2026-10-12", time: "08:00", project: "HR", need_type: "van", route_to: "Matara", pax: 6, tools: true } });
    expect(validateNewRequest({ ...emptyRequest("2026-10-12"), time: "08:00", behalf: " A visitor " })).toEqual({ input: { date: "2026-10-12", time: "08:00", on_behalf_of: "A visitor" } });
  });
  it("decides with a driver (and a vehicle when one is picked), or a reason", () => {
    expect(decisionInput({ id: "r1", decision: "approve" })).toEqual({ error: "Pick a driver: the vehicle fills itself." });
    expect(decisionInput({ id: "r1", decision: "decline", reason: " " })).toEqual({ error: "Write the reason first. The person who asked will see it." });
    expect(decisionInput({ id: "r1", decision: "approve", vehicle: "WP CAB-4521", driver: "kasun.s", decidedBy: "Sahan" })).toEqual({
      input: { request_id: "r1", decision: "approve", decided_by: "Sahan", vehicle: "WP CAB-4521", driver: "kasun.s" },
    });
    expect(decisionInput({ id: "r1", decision: "decline", reason: "No van" })).toEqual({ input: { request_id: "r1", decision: "decline", reason: "No van" } });
  });
});

describe("Vehicle requests (Part 6: custodians and one-step booking)", () => {
  const f = { ...emptyRequest("2026-10-17"), time: "09:00", back: "12:00", need: "car", pax: "2", to: "Rajagiriya" };
  it("sends driver_required only when the driver box is unticked", () => {
    expect(validateNewRequest(f)).toEqual({ input: { date: "2026-10-17", time: "09:00", back_by: "12:00", need_type: "car", route_to: "Rajagiriya", pax: 2 } });
    expect(validateNewRequest({ ...f, driver: false })).toMatchObject({ input: { driver_required: false } });
  });
  it("looks for free vehicles once the day and time are known", () => {
    expect(suggestInput(emptyRequest("2026-10-17"))).toBeNull();
    expect(suggestInput(f)).toEqual({ date: "2026-10-17", time: "09:00", back_by: "12:00", need_type: "car", pax: 2 });
  });
  it("books in one step: a driver, or the custodian when no driver is needed", () => {
    expect(bookInput(f, { vehicle: "", driver: "", hasCustodian: false })).toEqual({ error: "Pick a driver." });
    expect(bookInput(f, { vehicle: "WP CAR-1182", driver: "", hasCustodian: false })).toEqual({ error: "Pick a driver." });
    expect(bookInput(f, { vehicle: "WP CAR-1182", driver: "", hasCustodian: true })).toEqual({ error: 'Pick a driver, or untick "A driver is needed" so the custodian drives.' });
    expect(bookInput({ ...f, driver: false }, { vehicle: "WP CAR-1182", driver: "", hasCustodian: true })).toEqual({
      input: { date: "2026-10-17", time: "09:00", back_by: "12:00", need_type: "car", route_to: "Rajagiriya", pax: 2, driver_required: false, vehicle: "WP CAR-1182" },
    });
    expect(bookInput(f, { vehicle: "WP PH-2087", driver: "kasun.s", hasCustodian: false })).toMatchObject({ input: { vehicle: "WP PH-2087", driver: "kasun.s" } });    // From is the start and passengers get in there: From's time there goes to the start stop (Phase 7, §11).
    const atStart = { ...f, from: "Head office", fromDwell: "15" };
    const start = { fields: { start: "", startPax: true }, base: { id: "p-base", name: "Head office" }, fromIsStart: true };
    expect(bookInput(atStart, { vehicle: "WP PH-2087", driver: "kasun.s", hasCustodian: false }, start)).toMatchObject({
      input: { start: { place_id: "p-base", passengers: true, dwell_min: 15 }, stops: [{ type: "drop", place: "Rajagiriya" }] },
    });
  });
  it("approves without a driver only when the custodian drives", () => {
    expect(decisionInput({ id: "r1", decision: "approve", vehicle: "WP CAR-1182" })).toEqual({ error: "Pick a driver: the vehicle fills itself." });
    expect(decisionInput({ id: "r1", decision: "approve", vehicle: "WP CAR-1182", custodianDrives: true })).toEqual({ input: { request_id: "r1", decision: "approve", vehicle: "WP CAR-1182" } });
    expect(decisionInput({ id: "r1", decision: "approve", custodianDrives: true })).toEqual({ error: "Pick the vehicle." });
  });
});

describe("Driver first, the vehicle fills itself (Phase 7, §3)", () => {
  const f = { ...emptyRequest("2026-10-17"), time: "09:00", from: "Head office", to: "Kurunegala site" };
  it("approves with the driver alone when they bring a vehicle (or it is not known yet); the server takes the same one", () => {
    expect(decisionInput({ id: "r1", decision: "approve", driver: "kamal.p", defaultVehicle: "WP CAB-4521" })).toEqual({ input: { request_id: "r1", decision: "approve", driver: "kamal.p" } });
    expect(decisionInput({ id: "r1", decision: "approve", driver: "kamal.p" })).toEqual({ input: { request_id: "r1", decision: "approve", driver: "kamal.p" } });
    expect(decisionInput({ id: "r1", decision: "approve", driver: "kamal.p", defaultVehicle: null })).toEqual({ error: "Pick a vehicle: this driver holds none today and has no regular one." });
    expect(decisionInput({ id: "r1", decision: "approve", driver: "kamal.p", vehicle: "WP KL-1234", defaultVehicle: "WP CAB-4521" })).toMatchObject({ input: { vehicle: "WP KL-1234", driver: "kamal.p" } });
  });
  it("books with the driver alone, the same way", () => {
    expect(bookInput(f, { vehicle: "", driver: "kamal.p", hasCustodian: false, defaultVehicle: "WP CAB-4521" })).toEqual({
      input: { date: "2026-10-17", time: "09:00", route_from: "Head office", route_to: "Kurunegala site", driver: "kamal.p" },
    });
    expect(bookInput(f, { vehicle: "", driver: "kamal.p", hasCustodian: false, defaultVehicle: null })).toEqual({ error: "Pick a vehicle: this driver holds none today and has no regular one." });
  });
  it("assigns a task with the driver alone when they bring a vehicle; the call names none", () => {
    const a = { ...emptyAssign("2026-10-17"), title: "Team drop", leaveBy: "08:00", driver: "kamal.p" };
    a.stops[0].place = "Head office";
    a.stops[1].place = "Kurunegala site";
    const v = validateAssign(a, [], undefined, { defaultVehicle: "WP CAB-4521" });
    expect("input" in v && "vehicle" in v.input).toBe(false);
    expect("input" in v && v.input.driver).toBe("kamal.p");
    expect(validateAssign(a, [], undefined, { defaultVehicle: null })).toEqual({ error: "Add a vehicle." });
    expect("input" in validateAssign(a, [], undefined, { defaultVehicle: undefined })).toBe(true);
  });
});

describe("The time at From and To, Start from on the one-step booking (Phase 7, §11, §17)", () => {
  const f = { ...emptyRequest("2026-10-17"), time: "09:00", from: "Head office", to: "Kurunegala site", fromDwell: "15", toDwell: "1:30" };
  it("sends the times at From and To when chosen", () => {
    expect(validateNewRequest(f)).toMatchObject({ input: { from_dwell_min: 15, to_dwell_min: 90 } });
    expect(validateNewRequest({ ...f, toDwell: "13:00" })).toEqual({ error: "The time at a stop must be minutes or h:mm, up to 12 h." });
    const was = editFields({ fields: { date: "2026-10-17", time: "09:00", route_from: "Head office", route_to: "Kurunegala site", from_dwell_min: 15 } });
    expect([was.fromDwell, was.toDwell]).toEqual(["15", ""]);
    expect(updateRequestInput("r1", 4, { ...was, fromDwell: "", toDwell: "30" }, was)).toEqual({ input: { request_id: "r1", version: 4, from_dwell_min: null, to_dwell_min: 30 } });
  });
  it("Passengers get in at the start: the start becomes Stop 1, the From pickup goes when it is the same place", () => {
    const base = { id: "p-base", name: "Head office" };
    const pick = { vehicle: "", driver: "kamal.p", hasCustodian: false, defaultVehicle: "WP CAB-4521" };
    const ticked = { start: "", startPax: true };
    expect(bookInput(f, pick, { fields: ticked, base, fromIsStart: true })).toMatchObject({
      input: { start: { place_id: "p-base", place: "Head office", passengers: true }, stops: [{ type: "drop", place: "Kurunegala site", dwell_min: 90 }] },
    });
    expect(bookInput(f, pick, { fields: ticked, base, fromIsStart: false })).toMatchObject({
      input: { stops: [{ type: "pickup", place: "Head office", dwell_min: 15 }, { type: "drop", place: "Kurunegala site", dwell_min: 90 }] },
    });
    const plain = bookInput(f, pick, { fields: { start: "", startPax: false }, base });
    expect("input" in plain && "stops" in plain.input).toBe(false);
    expect("input" in plain && "start" in plain.input).toBe(false);
  });
  it("the decide page's times go onto the request only when they differ from it", async () => {
    const { dwellChanges } = await import("./requestLogic");
    expect(dwellChanges({ fromDwell: "15", toDwell: "" }, { from_dwell_min: 15 })).toBeNull();
    expect(dwellChanges({ fromDwell: "30", toDwell: "" }, { from_dwell_min: 15 })).toEqual({ from_dwell_min: 30 });
    expect(dwellChanges({ fromDwell: "", toDwell: "2:00" }, { from_dwell_min: 15 })).toEqual({ from_dwell_min: null, to_dwell_min: 120 });
    expect(dwellChanges({ fromDwell: "x", toDwell: "" }, undefined)).toBe("bad");
  });
  it("tells the requester's timeline in steps", () => {
    expect(timelineSteps({ status: "waiting", timeline: { sent: "14 Oct 09:00" } }).map((s) => `${s.label}:${s.done}`)).toEqual(["Sent:true", "Seen by the office:false", "Decision:false"]);
    expect(timelineSteps({ status: "approved", timeline: { sent: "14 Oct 09:00", seen: "14 Oct 09:10 by Sahan", decided: "14 Oct 09:20", decided_by: "Sahan" } }).map((s) => s.at)).toEqual(["14 Oct 09:00", "14 Oct 09:10 by Sahan", "14 Oct 09:20 by Sahan"]);
    expect(timelineSteps({ status: "cancelled", timeline: { sent: "a", seen: "b", decided: "c", cancelled: "d by Sahan" } }).map((s) => s.label)).toEqual(["Sent", "Seen by the office", "Approved", "Cancelled"]);
    expect(timelineSteps({ status: "cancelled", timeline: { sent: "a", cancelled: "d" } }).map((s) => s.label)).toEqual(["Sent", "Seen by the office", "Cancelled"]);
  });
});

describe("Vehicle form (Part 6: the custodian)", () => {
  it("sends the custodian by name or e-mail, and clears with none", async () => {
    const { emptyVehicle, vehicleInput } = await import("./vehicleLogic");
    expect(vehicleInput({ ...emptyVehicle(), custodian: "pool@fame.test", custodianNote: "Keeps it at Rajagiriya" }, "WP CAR-1182")).toEqual({
      input: { reg_no: "WP CAR-1182", custodian: "pool@fame.test", custodian_note: "Keeps it at Rajagiriya" }, tool: "update_vehicle",
    });
    expect(vehicleInput({ ...emptyVehicle(), custodian: "none" }, "WP CAR-1182")).toEqual({ input: { reg_no: "WP CAR-1182", custodian: null }, tool: "update_vehicle" });
  });
});

describe("Vehicle requests (Phase 6: edits, re-approval, the timeline from events)", () => {
  const was = { ...emptyRequest("2026-10-17"), time: "09:00", back: "12:00", need: "van", pax: "4", from: "Head office", to: "Galle", note: "" };
  it("reads the edit form from the card's fields", () => {
    expect(editFields({ fields: { date: "2026-10-17", time: "09:00", back_by: "12:00", route_from: "Head office", route_to: "Galle", need_type: "van", pax: 4, tools: false, driver_required: true, on_behalf_of: "A visitor" } }))
      .toEqual({ ...was, behalf: "A visitor" });
    expect(editFields({ note: "old note" }).note).toBe("old note");
  });
  it("sends update_request only the fields that changed, with the version", () => {
    expect(updateRequestInput("r1", 2, was, was)).toEqual({ error: "Nothing changed." });
    expect(updateRequestInput("r1", 2, { ...was, time: "09:30", to: "Matara", back: "", pax: "", tools: true, driver: false, behalf: "Someone" }, was)).toEqual({
      input: { request_id: "r1", version: 2, time: "09:30", back_by: null, route_to: "Matara", pax: null, tools: true, driver_required: false, on_behalf_of: "Someone" },
    });
    expect(updateRequestInput("r1", 2, { ...was, date: "" }, was)).toEqual({ error: "Add the day and the time." });
  });
  it("decides a changed booking again: keep, change with a pick, decline with a reason", () => {
    expect(redecideInput({ id: "r1", version: 3, decision: "keep" })).toEqual({ input: { request_id: "r1", version: 3, decision: "keep" } });
    expect(redecideInput({ id: "r1", version: 3, decision: "decline", reason: " " })).toEqual({ error: "Write the reason first. The person who asked will see it." });
    expect(redecideInput({ id: "r1", version: 3, decision: "decline", reason: "No van" })).toEqual({ input: { request_id: "r1", version: 3, decision: "decline", reason: "No van" } });
    expect(redecideInput({ id: "r1", version: 3, decision: "change", was: { date: "2026-10-17", time: "09:00", back: "12:00" }, date: "2026-10-17", time: "09:00", back: "12:00" }))
      .toEqual({ error: "Pick what to change: the vehicle, the driver, the day, the time or the back-by time." });
    expect(redecideInput({ id: "r1", version: 3, decision: "change", driver: "kasun.s", time: "11:00", was: { time: "09:00", back: "12:00" }, back: "" }))
      .toEqual({ input: { request_id: "r1", version: 3, decision: "change", driver: "kasun.s", time: "11:00", back_by: null } });
  });
  it("tells the timeline from the events, with the diff of an edit, and what is still to come", () => {
    const events = [
      { at: "14 Oct 09:00", action: "created", actor: "Asker" },
      { at: "14 Oct 09:10", action: "seen", actor: "Sahan" },
      { at: "14 Oct 09:20", action: "approved", actor: "Sahan", note: "WP CAB-4521 · Kasun" },
      { at: "14 Oct 10:00", action: "changed", actor: "Asker", changes: { time: { from: "Thu 15 Oct 09:00", to: "Thu 15 Oct 09:30" } } },
    ];
    const steps = timelineSteps({ status: "changed", events });
    expect(steps.map((s) => `${s.label}:${s.done}`)).toEqual(["Sent:true", "Seen by the office:true", "Approved:true", "Changed · needs re-approval:true", "Decision on the change:false"]);
    expect(steps[1].at).toBe("14 Oct 09:10 by Sahan");
    expect(steps[3].lines).toEqual(["time Thu 15 Oct 09:00 → Thu 15 Oct 09:30"]);
    const kept = timelineSteps({ status: "approved", events: [...events, { at: "14 Oct 10:30", action: "redecided", actor: "Sahan", note: "kept as asked: time …" }] });
    expect(kept.map((s) => s.label).slice(-1)).toEqual(["Kept as asked"]);
    expect(timelineSteps({ status: "waiting", events: [events[0]] }).map((s) => s.label)).toEqual(["Sent", "Seen by the office", "Decision"]);
    expect(diffLines({ to: { from: "Galle", to: "Matara" }, "back by": { from: "12:00", to: null } })).toEqual(["to Galle → Matara", "back by 12:00 → —"]);
  });
});
