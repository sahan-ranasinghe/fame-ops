// Round 48 (item 1): the approver's page for a change proposed by someone without approve: the task, who proposes what,
// each change line, Approve (decide_request approve with the version) or Decline with a reason; the task page says the
// change waits; Give it a driver without approve ends with "waiting", the task unchanged.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FleetProvider } from "../app/FleetContext";
import { FleetStore } from "../data/store";
import type { RequestCard } from "../data/types";
import type { Me, Transport, WatchEvent } from "../transport/types";
import { ToastProvider } from "../ui/Toast";
import { ChangeDecide } from "./ChangeDecide";
import { changeLine, changeOutcome, pendingChangeTarget, requestView } from "./approvalLogic";

type Args = Record<string, unknown>;

class Fake implements Transport {
  readonly kind = "api" as const;
  calls: { tool: string; args: Args }[] = [];
  fail: string | null = null;
  me(): Promise<Me> {
    return Promise.resolve(admin);
  }
  call<T>(tool: string, args: Args = {}): Promise<T> {
    this.calls.push({ tool, args });
    if (tool === "decide_request") {
      if (this.fail) return Promise.reject({ code: "refused", message: this.fail });
      return Promise.resolve({ request: { ...change, status: args.decision === "approve" ? "approved" : "declined" }, decision: args.decision, task_id: "t1" } as T);
    }
    if (tool === "reviewing") return Promise.resolve({ reviewing: [] } as T);
    return Promise.reject({ code: "not_found", message: `No answer for ${tool}` });
  }
  watch<T>(tool: string, args: Args, cb: (ev: WatchEvent<T>) => void): () => void {
    void this.call<T>(tool, args).then((data) => cb({ type: "data", data, at: Date.now() })).catch(() => undefined);
    return () => {};
  }
  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

const admin: Me = { name: "Palitha", role: "fleet_admin", permissions: ["view", "request", "approve", "assign_tasks"], tools: ["decide_request", "list_requests", "task_detail", "reviewing"] };

const change: RequestCard = {
  id: "r9", kind: "change", title: "Team drop · Galle", requested_by: "Sashen", when: "Thu 29 Oct 09:00", route: "Head office → Galle",
  status: "waiting", version: 2, asked: "10 min ago",
  proposed: { driver: "Kamal Silva", username: "kamal", vehicle: "WP CAB-4521" },
  change: {
    task_id: "t1", task_title: "Team drop · Galle", tool: "reassign_task", task_was: "declined",
    summary: "driver Kamal Silva instead of Nuwan Perera",
    changes: { driver: { from: "Nuwan Perera", to: "Kamal Silva" } },
  },
} as RequestCard;

function Where() {
  const loc = useLocation();
  return <output data-testid="where">{loc.pathname}</output>;
}

const settle = async (ms = 0) => {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
};

async function mount(q: RequestCard = change) {
  const t = new Fake();
  const setQ = vi.fn();
  render(
    <FleetProvider value={{ store: new FleetStore(t), transport: t, me: admin, noConnector: false }}>
      <ToastProvider>
        <MemoryRouter initialEntries={["/requests/r9/decide"]}>
          <Routes>
            <Route path="/requests/:id/decide" element={<ChangeDecide id="r9" q={q} setQ={setQ} />} />
            <Route path="*" element={null} />
          </Routes>
          <Where />
        </MemoryRouter>
      </ToastProvider>
    </FleetProvider>,
  );
  await settle();
  return t;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-28T09:00:00+05:30"));
});
afterEach(() => vi.useRealTimers());

describe("Approve a change (Round 48, item 1)", () => {
  it("shows the task, who proposes what, each change line, and approves with the version", async () => {
    const t = await mount();
    expect(screen.getByTestId("change-task").textContent).toBe("Team drop · Galle");
    expect(screen.getByTestId("proposal-line").textContent).toBe("driver Kamal Silva instead of Nuwan Perera · proposed by Sashen");
    expect(screen.getByText(/The task is as it was until you decide. It needs a driver/)).toBeTruthy();
    expect(screen.getByTestId("change-lines").textContent).toContain("Kamal Silva");
    expect(screen.getByText("Open the task → (to change it another way)").getAttribute("href")).toBe("/tasks/t1");
    fireEvent.click(screen.getByTestId("approve"));
    await settle();
    const decide = t.calls.find((c) => c.tool === "decide_request");
    expect(decide?.args).toEqual({ request_id: "r9", decision: "approve", version: 2 });
    expect(screen.getByText("Approved and applied.")).toBeTruthy();
    expect(screen.getByText("Open task →").getAttribute("href")).toBe("/tasks/t1");
    // Decided: the buttons are gone.
    expect(screen.queryByTestId("approve")).toBeNull();
  });

  it("declines only with a reason, then goes back to the queue", async () => {
    const t = await mount();
    fireEvent.click(screen.getByTestId("decline-start"));
    fireEvent.click(screen.getByTestId("decline-confirm"));
    await settle();
    expect(t.calls.some((c) => c.tool === "decide_request")).toBe(false);
    expect(screen.getByText(/Write the reason first/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Decline with a reason"), { target: { value: " Keep Nuwan on it " } });
    fireEvent.click(screen.getByTestId("decline-confirm"));
    await settle();
    expect(t.calls.find((c) => c.tool === "decide_request")?.args).toEqual({ request_id: "r9", decision: "decline", version: 2, reason: "Keep Nuwan on it" });
    expect(screen.getByTestId("where").textContent).toBe("/requests");
  });

  it("a refusal shows the server's words (another approver, the task moved on)", async () => {
    const t = await mount();
    t.fail = "The task is cancelled now; decline this change.";
    fireEvent.click(screen.getByTestId("approve"));
    await settle();
    expect(screen.getByText(/The task is cancelled now/)).toBeTruthy();
    expect(screen.getByTestId("approve")).toBeTruthy();
  });
});

describe("The words and the places (Round 48, item 1)", () => {
  it("changeLine and the pending change's target", () => {
    expect(changeLine(change)).toBe("driver Kamal Silva instead of Nuwan Perera · proposed by Sashen");
    expect(changeLine({ requested_by: "Sashen" })).toBe("a change · proposed by Sashen");
    expect(pendingChangeTarget("r9", admin)).toBe("/requests/r9/decide");
    expect(pendingChangeTarget("r9", { tools: ["list_requests"] })).toBe("/requests/r9");
  });

  it("changeOutcome: waiting for the fleet admin, or done", () => {
    expect(changeOutcome({ waiting_for_approval: true, request_id: "r9", next: "Waiting for the fleet admin's OK · you'll be notified." }, "Task changed")).toEqual({
      waiting: true,
      toast: "Waiting for the fleet admin's OK · the task is unchanged",
      head: "Waiting for the fleet admin's OK · you'll be notified.",
      link: { to: "/requests/r9", label: "Open the request" },
    });
    expect(changeOutcome({ task_id: "t1" } as never, "Task changed")).toEqual({ waiting: false, toast: "Task changed" });
  });

  it("requestView: the proposer and an approver see the change's lines; a proposer may withdraw it while it waits", () => {
    const proposer: Me = { name: "Sashen", role: "office", permissions: ["view", "assign_tasks"], tools: ["cancel_request"] };
    expect(requestView(change, proposer)).toEqual({ proposal: true, conflicts: false, withdraw: true });
    expect(requestView(change, admin)).toEqual({ proposal: true, conflicts: false, withdraw: false });
  });
});
