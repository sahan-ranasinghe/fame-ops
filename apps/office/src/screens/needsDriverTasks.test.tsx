import { render, screen, within } from "@testing-library/react";
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
  assigned: [{ id: "t3", time: "11:00", title: "Documents to Kandy", driver: "Ruwan", status: "Accepted 10:50", accepted: "10:50" }],
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
    expect(screen.getByRole("link", { name: "The whole board" }).getAttribute("href")).toBe("/tasks");
    expect(screen.queryByText("Documents to Kandy")).toBeNull();
  });

  it("the board shows them above its columns only: a task the red block lists is never also a column (the design pass, pilot f)", async () => {
    await mount("/tasks");
    expect(screen.getByRole("link", { name: "Needs a driver · 2" }).getAttribute("href")).toBe("/tasks?filter=needs_driver");
    expect(screen.getAllByTestId("needs-driver-row")).toHaveLength(2);
    expect(screen.getByText("Documents to Kandy")).toBeTruthy();
    // t1 is declined and in the block: no Needs a driver column, its card nowhere else on the board.
    expect(screen.queryByTestId("board-col-declined")).toBeNull();
    expect(screen.queryByText("Declined (Vehicle problem)")).toBeNull();
    expect(screen.getAllByText("Team drop · Kurunegala")).toHaveLength(1);
    // The columns in the one vocabulary, an empty one with the shared empty line.
    expect([...document.querySelectorAll(".col-h > span:first-child")].map((e) => e.textContent)).toEqual(["Sent", "On the way", "Done"]);
    expect(within(screen.getByTestId("board-col-in_progress")).getByTestId("empty-line").textContent).toBe("No tasks on the way");
  });

  it("a past day's declined task (the red block lists today and later only) keeps its Needs a driver column", async () => {
    const all = board.needs_driver;
    board.needs_driver = all?.filter((n) => n.task_id !== "t1");
    try {
      await mount("/tasks");
      const col = screen.getByTestId("board-col-declined");
      expect(within(col).getByText("Team drop · Kurunegala")).toBeTruthy();
      expect(within(col).getByTestId("col-count").textContent).toBe("1");
      expect(within(col).getByTestId("task-state").textContent).toBe("Needs a driver");
    } finally {
      board.needs_driver = all;
    }
  });

  it("each card's state as a chip, the server's sentence under it", async () => {
    await mount("/tasks");
    const card = screen.getByText("Documents to Kandy").closest(".tcard") as HTMLElement;
    expect(within(card).getByTestId("task-state").textContent).toBe("Accepted");
    expect(within(card).getByTestId("task-state").querySelector(".pill.live")).toBeTruthy();
    expect(within(card).getByTestId("card-status").textContent).toBe("Accepted 10:50");
  });
});
