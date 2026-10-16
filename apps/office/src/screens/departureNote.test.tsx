// The departure check's line for a late return (Phase 7, §20): Use 07:40 and, second, Move back by to 18:20.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PlanTimeline } from "../data/types";
import { checkDeparture, departurePlan } from "./departureLogic";
import { DepartureNote } from "./dispatchParts";

const tl: PlanTimeline = {
  items: [
    { kind: "leave", at: "08:00", source: "manual" },
    { kind: "leg", from_n: "start", to_n: 1, km: 94, minutes: 96, source: "google" },
    { kind: "stop", n: 1, label: "Stop 1 · Visit · Kurunegala site", place: "Kurunegala site", planned_arrive: "09:36", planned_leave: "16:00", dwell_min: 384 },
    { kind: "leg", from_n: 1, to_n: "base", km: 94, minutes: 140, source: "google" },
  ],
  totals: { drive_min: 236, km: 188, ends: "18:20" },
};

describe("the late return beside the fields", () => {
  it("says it in §20's words with Use and Move back by, in that order", () => {
    const check = checkDeparture("08:00", departurePlan(tl, 0, "18:00"));
    const done: string[] = [];
    render(<DepartureNote check={check} onUse={(t) => done.push(`use ${t}`)} onMove={() => done.push("move stop")} onMoveBack={(t) => done.push(`back ${t}`)} />);
    expect(screen.getByTestId("departure-check").textContent).toContain("Leaving 08:00 you are back at 18:20, 20 min after 18:00. Leave by 07:40.");
    const buttons = screen.getAllByRole("button").map((b) => b.textContent);
    expect(buttons).toEqual(["Use 07:40", "Move back by to 18:20"]);
    fireEvent.click(screen.getByRole("button", { name: "Use 07:40" }));
    fireEvent.click(screen.getByRole("button", { name: "Move back by to 18:20" }));
    expect(done).toEqual(["use 07:40", "back 18:20"]);
  });

  it("names the form's own field, and shows the words alone where the times are the requester's", () => {
    const check = checkDeparture("08:00", departurePlan(tl, 0, "18:00"));
    const { unmount } = render(<DepartureNote check={check} onUse={() => undefined} onMoveBack={() => undefined} backLabel="free by" />);
    expect(screen.getByRole("button", { name: "Move free by to 18:20" })).toBeTruthy();
    unmount();
    render(<DepartureNote check={check} testId="departure-check-back" />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByTestId("departure-check-back").textContent).toContain("you are back at 18:20");
  });
});
