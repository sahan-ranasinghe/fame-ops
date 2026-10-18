import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { FleetProvider } from "../app/FleetContext";
import { FleetStore } from "../data/store";
import type { Board } from "../data/types";
import { today } from "../lib/format";
import type { Me, Transport, WatchEvent } from "../transport/types";
import { Tasks } from "./Tasks";

const board: Board = {
  date: today(),
  counts: { assigned: 1, in_progress: 0, completed: 0, cancelled: 0, declined: 1 },
  assigned: [{ id: "t3", time: "11:00", title: "Documents to Kandy", driver: "Ruwan", status: "Accepted 10:50" }],
  in_progress: [],
  completed: [],
  declined: [{ id: "t1", time: "09:00", title: "Team drop · Kurunegala", driver: "Kamal Silva", status: "Declined (Vehicle problem)" }],
  needs_driver: [
    { task_id: "t1", start: "09:00", title: "Team drop · Kurunegala", driver: "Kamal Silva", kind: "declined", reason_text: "Vehicle problem", line: "Kamal declined · Vehicle problem", minutes_to_start: 42, when: "in 42 min" },
    { task_id: "t2", start: "Sat 17 Oct 08:00", title: "Site visit · Galle", driver: "Sunil", kind: "not_accepted", reason_text: "Not accepted in time", line: "Sunil hasn't accepted · needs a driver", minutes_to_start: 1400, when: "in 1400 min" },
  ],
};

class Boards implements Transport {
  readonly kind = "api" as const;
  me(): Promise<Me> {
    return Promise.resolve({ name: "Palitha", role: "office", permissions: ["view", "assign_tasks"], tools: ["task_board", "create_task", "update_task", "reassign_task"] });
  }
  call<T>(): Promise<T> {
    return Promise.resolve(board as T);
  }
  watch<T>(_t: string, _a: Record<string, unknown>, cb: (ev: WatchEvent<T>) => void): () => void {
    cb({ type: "data", data: board as T, at: Date.now() });
    return () => {};
  }
  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

async function mount(url: string) {
  const transport = new Boards();
  const me = await transport.me();
  render(
    <FleetProvider value={{ store: new FleetStore(transport), transport, me, noConnector: false }}>
      <MemoryRouter initialEntries={[url]}><Tasks /></MemoryRouter>
    </FleetProvider>,
  );
}

describe("Tasks and the tasks that need a driver", () => {
  it("?filter=needs_driver shows only them, every one to its change page, with the way back to the board", async () => {
    await mount("/tasks?filter=needs_driver");
    expect(screen.getByRole("heading", { name: "Tasks that need a driver" })).toBeTruthy();
    const rows = screen.getAllByTestId("needs-driver-row");
    expect(rows.map((r) => r.getAttribute("href"))).toEqual(["/tasks/t1/edit?driver=1", "/tasks/t2/edit?driver=1"]);
    expect(screen.getByRole("link", { name: "Back to the board" }).getAttribute("href")).toBe("/tasks");
    expect(screen.queryByText("Documents to Kandy")).toBeNull();
  });

  it("the board shows them above its columns, and the declined column still works", async () => {
    await mount("/tasks");
    expect(screen.getByRole("link", { name: "Needs a driver · 2" }).getAttribute("href")).toBe("/tasks?filter=needs_driver");
    expect(screen.getAllByTestId("needs-driver-row")).toHaveLength(2);
    expect(screen.getByText("Documents to Kandy")).toBeTruthy();
    expect(screen.getByText("Declined (Vehicle problem)")).toBeTruthy();
  });
});
