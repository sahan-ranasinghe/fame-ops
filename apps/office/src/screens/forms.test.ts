import { describe, expect, it } from "vitest";
import { driverWhatsApp, emptyAssign, validateAssign } from "./assignLogic";
import { decisionInput, emptyRequest, validateNewRequest } from "./requestLogic";

describe("Assign a task", () => {
  const filled = { ...emptyAssign("2026-10-12"), title: "Team drop · Matara", start: "06:30", pickup: "Head office", dropoff: "Matara site", driver: "kasun.s", vehicle: "WP CAB-4521" };

  it("names what is missing", () => {
    expect(validateAssign(emptyAssign("2026-10-12"), [])).toEqual({ error: "Add the task, the start time, the pickup, the drop-off, a driver, a vehicle." });
  });
  it("builds exactly the create_task arguments", () => {
    const v = validateAssign({ ...filled, pax: "3", end: "13:30", cname: "Ruwan", cphone: "0771234567", notes: "Tools" }, [], "Sahan Ranasinghe");
    expect(v).toEqual({
      input: {
        title: "Team drop · Matara", date: "2026-10-12", start_time: "06:30", driver: "kasun.s", vehicle: "WP CAB-4521", pickup: "Head office", dropoff: "Matara site",
        end_time: "13:30", passengers: 3, contact_name: "Ruwan", contact_phone: "0771234567", notes: "Tools", created_by: "Sahan Ranasinghe",
      },
    });
  });
  it("needs the project split to total 100", () => {
    expect(validateAssign(filled, [{ project: "13021", percent: 60 }, { project: "TRKAN1", percent: 30 }])).toEqual({ error: "Project percentages add up to 90%. They must total 100%." });
    const v = validateAssign(filled, [{ project: "13021", percent: "60" }, { project: " TRKAN1 ", percent: 40 }, { project: "", percent: 5 }]);
    expect("input" in v && v.input.projects).toEqual([{ project: "13021", percent: 60 }, { project: "TRKAN1", percent: 40 }]);
  });
  it("writes the driver's WhatsApp message", () => {
    const v = validateAssign({ ...filled, cname: "Ruwan" }, []);
    const url = driverWhatsApp("input" in v ? v.input : {}, "0771234567");
    expect(url.startsWith("https://wa.me/94771234567?text=")).toBe(true);
    expect(decodeURIComponent(url.split("text=")[1])).toBe("New task: Team drop · Matara\n2026-10-12 06:30\nPickup: Head office\nDrop-off: Matara site\nContact: Ruwan\nOpen Fame Driver for the details.");
  });
});

describe("Vehicle requests", () => {
  it("needs who, the day and the time", () => {
    expect(validateNewRequest(emptyRequest("2026-10-12"))).toEqual({ error: "Add who needs it, the day and the time." });
  });
  it("builds the create_request arguments, in the staff member's own name", () => {
    const v = validateNewRequest({ ...emptyRequest("2026-10-12"), time: "08:00", project: "HR", need: "van", pax: "6", tools: true, to: "Matara" }, "Test Staff");
    expect(v).toEqual({ input: { requested_by: "Test Staff", date: "2026-10-12", time: "08:00", project: "HR", need_type: "van", route_to: "Matara", pax: 6, tools: true } });
  });
  it("decides with a vehicle and driver, or a reason", () => {
    expect(decisionInput({ id: "r1", decision: "approve" })).toEqual({ error: "Pick a vehicle and a driver." });
    expect(decisionInput({ id: "r1", decision: "decline", reason: " " })).toEqual({ error: "Write the reason first. The person who asked will see it." });
    expect(decisionInput({ id: "r1", decision: "approve", vehicle: "WP CAB-4521", driver: "kasun.s", decidedBy: "Sahan" })).toEqual({
      input: { request_id: "r1", decision: "approve", decided_by: "Sahan", vehicle: "WP CAB-4521", driver: "kasun.s" },
    });
    expect(decisionInput({ id: "r1", decision: "decline", reason: "No van" })).toEqual({ input: { request_id: "r1", decision: "decline", reason: "No van" } });
  });
});
