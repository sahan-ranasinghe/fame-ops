import { describe, expect, it } from "vitest";
import type { RequestCard } from "../data/types";
import {
  askedTimes, decideLabel, decidesTrip, emptyTripDecision, proposalLine, requestView, shownTimes, timeChanges, tripDecideInput, tripPick, waitingTarget, withdrawInput,
} from "./approvalLogic";

const proposal: RequestCard = {
  id: "r9", kind: "task", title: "Team drop · Kandy", requested_by: "Nimal Fernando", when: "Sun 18 Oct 08:00", status: "waiting",
  proposed: { driver: "Kamal Perera", username: "kamal.p", vehicle: "WP CAB-4521", vehicle_why: "Kamal's vehicle today", conflicts: [{ kind: "driver", text: "Kamal is on Team drop 07:00–09:00" }] },
  fields: { date: "2026-10-18", time: "08:00", back_by: "17:00" },
  trip: { leave_by: "08:00", stops: [{ seq: 1, type: "pickup", place: "Head office" }, { seq: 2, type: "drop", place: "Kandy site" }] },
};
const request: RequestCard = { id: "r1", kind: "request", requested_by: "Dilini", when: "Sat 17 Oct 09:00", status: "waiting", fields: { date: "2026-10-17", time: "09:00" } };
const approver = { name: "Palitha", permissions: ["view", "approve", "assign_tasks"] as const, tools: ["decide_request", "cancel_request", "list_requests"] };
const dispatcher = { name: "Nimal Fernando", permissions: ["view", "assign_tasks"] as const, tools: ["cancel_request", "list_requests", "task_board"] };
const requester = { name: "Dilini", permissions: ["view", "request"] as const, tools: ["cancel_request", "list_requests", "create_request"] };
const me = (m: { name: string; permissions: readonly string[]; tools: string[] }) => ({ ...m, permissions: [...m.permissions] as never });

describe("which decide page (Phase 7, §33, §34)", () => {
  it("a waiting proposal or a waiting request with its stops gets the trip page; an old request or a decided one does not", () => {
    expect(decidesTrip(proposal)).toBe(true);
    expect(decidesTrip({ ...request, trip: proposal.trip })).toBe(true);
    expect(decidesTrip(request)).toBe(false);
    expect(decidesTrip({ ...request, trip: { stops: [] } })).toBe(false);
    expect(decidesTrip({ ...proposal, status: "approved" })).toBe(false);
  });
});

describe("a proposal in words and who sees what (§35 19)", () => {
  it("reads as the task for its driver and vehicle, proposed by its proposer", () => {
    expect(proposalLine(proposal)).toBe("Task for Kamal Perera · WP CAB-4521 · proposed by Nimal Fernando");
    expect(proposalLine({ requested_by: "Nimal" })).toBe("Task for a driver · proposed by Nimal");
  });
  it("approvers see everything; the proposer their own proposal and its conflicts; a requester no driver, vehicle or conflict", () => {
    expect(requestView(proposal, me(approver))).toEqual({ proposal: true, conflicts: true, withdraw: false });
    expect(requestView(proposal, me(dispatcher))).toEqual({ proposal: true, conflicts: true, withdraw: true });
    expect(requestView(request, me(requester))).toEqual({ proposal: false, conflicts: false, withdraw: true });
    // Decided: nothing to withdraw (the fleet admin cancels it).
    expect(requestView({ ...request, status: "approved" }, me(requester)).withdraw).toBe(false);
    // Without cancel_request (an older server): no Withdraw.
    expect(requestView(request, { ...me(requester), tools: [] }).withdraw).toBe(false);
  });
  it("a board card opens the decide page, one's own proposal, or nothing", () => {
    const card = { request_id: "r9", proposed_by: "Nimal Fernando" };
    expect(waitingTarget(card, me(approver))).toBe("/requests/r9/decide");
    expect(waitingTarget(card, me(dispatcher))).toBe("/requests/r9");
    expect(waitingTarget(card, { ...me(dispatcher), name: "Sashen" })).toBeNull();
  });
});

describe("the times the approver may move", () => {
  const was = askedTimes(proposal);
  it("starts as asked: the day, the planned leave-by, the back-by", () => {
    expect(was).toEqual({ date: "2026-10-18", leaveBy: "08:00", back: "17:00" });
    expect(askedTimes(request)).toEqual({ date: "2026-10-17", leaveBy: "09:00", back: "" });
    expect(shownTimes(emptyTripDecision(), was)).toEqual(was);
    expect(shownTimes({ date: "", leaveBy: "08:30", back: "" }, was)).toEqual({ ...was, leaveBy: "08:30" });
  });
  it("sends only what differs from the request's (the same value is no change)", () => {
    expect(timeChanges({ date: "", leaveBy: "", back: "" }, was)).toEqual({});
    expect(timeChanges({ date: "2026-10-18", leaveBy: "08:00", back: "17:00" }, was)).toEqual({});
    expect(timeChanges({ date: "2026-10-19", leaveBy: "08:30", back: "18:00" }, was)).toEqual({ date: "2026-10-19", leave_by: "08:30", back_by: "18:00" });
  });
});

describe("decide_request on the trip page", () => {
  const was = askedTimes(proposal);
  const base = { id: "r9", was, proposed: { username: "kamal.p", vehicle: "WP CAB-4521" }, decidedBy: "Palitha" };
  const f = emptyTripDecision();

  it("as proposed: nothing but the decision; the button says Send as proposed", () => {
    const pick = tripPick({ ...base, f, driver: "kamal.p", driverVehicle: "WP CAB-4521" });
    expect(pick.asProposed).toBe(true);
    expect(decideLabel({ proposal: true, asProposed: pick.asProposed })).toBe("Send as proposed");
    expect(tripDecideInput({ ...base, f, driver: "kamal.p", decision: "approve" })).toEqual({
      input: { request_id: "r9", decision: "approve", decided_by: "Palitha" }, asProposed: true,
    });
    // The proposed vehicle picked by hand is still as proposed.
    expect(tripDecideInput({ ...base, f: { ...f, vehicle: "WP CAB-4521" }, driver: "kamal.p", decision: "approve" })).toMatchObject({ asProposed: true, input: { request_id: "r9" } });
  });

  it("a changed time: only that time, and Approve and send", () => {
    const v = tripDecideInput({ ...base, f: { ...f, leaveBy: "08:30" }, driver: "kamal.p", decision: "approve" });
    expect(v).toEqual({ input: { request_id: "r9", decision: "approve", decided_by: "Palitha", leave_by: "08:30" }, asProposed: false });
    expect(decideLabel({ proposal: true, asProposed: false })).toBe("Approve and send");
  });

  it("another driver brings their own vehicle (none named); a vehicle picked by hand is named", () => {
    expect(tripDecideInput({ ...base, f: { ...f, driver: "nuwan.s" }, driver: "nuwan.s", driverVehicle: "WP KL-1234", decision: "approve" })).toEqual({
      input: { request_id: "r9", decision: "approve", decided_by: "Palitha", driver: "nuwan.s" }, asProposed: false,
    });
    // Another driver with the proposed vehicle kept: the vehicle is named (it is not theirs).
    expect(tripDecideInput({ ...base, f: { ...f, driver: "nuwan.s", vehicle: "WP CAB-4521" }, driver: "nuwan.s", driverVehicle: "WP KL-1234", decision: "approve" })).toMatchObject({
      input: { driver: "nuwan.s", vehicle: "WP CAB-4521" },
    });
    // The proposed driver with another vehicle: only the vehicle.
    expect(tripDecideInput({ ...base, f: { ...f, vehicle: "WP PH-2087" }, driver: "kamal.p", decision: "approve" })).toEqual({
      input: { request_id: "r9", decision: "approve", decided_by: "Palitha", vehicle: "WP PH-2087" }, asProposed: false,
    });
    // A driver known to bring none, and no vehicle picked.
    expect(tripDecideInput({ ...base, f: { ...f, driver: "sunil.s" }, driver: "sunil.s", driverVehicle: null, decision: "approve" })).toEqual({
      error: "Pick a vehicle: this driver holds none today and has no regular one.",
    });
  });

  it("a request planned with its stops names its driver; no driver only when the custodian drives", () => {
    const r = { id: "r1", was: askedTimes(request) };
    expect(tripDecideInput({ ...r, f, driver: "kamal.p", driverVehicle: "WP CAB-4521", decision: "approve" })).toEqual({
      input: { request_id: "r1", decision: "approve", driver: "kamal.p" }, asProposed: false,
    });
    expect(decideLabel({ proposal: false, asProposed: false })).toBe("Approve and send");
    expect(tripDecideInput({ ...r, f, driver: "", decision: "approve" })).toEqual({ error: "Pick a driver: the vehicle fills itself." });
    expect(tripDecideInput({ ...r, f, driver: "", noDriverNeeded: true, decision: "approve" })).toEqual({ error: "Pick a driver, or the vehicle whose custodian drives." });
    expect(tripDecideInput({ ...r, f: { ...f, vehicle: "WP CAR-1182" }, driver: "", noDriverNeeded: true, decision: "approve" })).toEqual({
      input: { request_id: "r1", decision: "approve", vehicle: "WP CAR-1182" }, asProposed: false,
    });
    expect(decideLabel({ proposal: false, asProposed: false, custodianDrives: true })).toBe("Approve");
  });

  it("declines only with a reason", () => {
    expect(tripDecideInput({ ...base, f, driver: "kamal.p", decision: "decline" })).toEqual({ error: "Write the reason first. The person who asked will see it." });
    expect(tripDecideInput({ ...base, f: { ...f, reason: " No van free " }, driver: "kamal.p", decision: "decline" })).toEqual({
      input: { request_id: "r9", decision: "decline", decided_by: "Palitha", reason: "No van free" }, asProposed: false,
    });
  });
});

describe("Withdraw (§35 17)", () => {
  it("needs a reason", () => {
    expect(withdrawInput("r1", "  ")).toEqual({ error: "Write why you withdraw it. It stays on the request." });
    expect(withdrawInput("r1", " Trip is off ")).toEqual({ input: { request_id: "r1", reason: "Trip is off" } });
  });
});
