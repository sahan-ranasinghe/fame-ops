// The board a column at a time (Hotfix 3, L3): task_board asked with 25 cards a column, each column's count from its
// totals, and "Load more" under a column asking that column's next cards (column, limit, cursor), merged under it.
import { cursorAt } from "@fleet/paging";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { FleetProvider } from "../app/FleetContext";
import { FleetStore } from "../data/store";
import type { Board, BoardCard } from "../data/types";
import { today } from "../lib/format";
import type { Me, Transport, WatchEvent } from "../transport/types";
import { Tasks } from "./Tasks";

const cardN = (n: number): BoardCard => ({ id: `t${n}`, time: "09:00", title: `Drop ${n}`, driver: "Ruwan", status: "Accepted 08:50" });
const ALL = Array.from({ length: 30 }, (_, i) => cardN(i + 1));

class Boards implements Transport {
  readonly kind = "api" as const;
  calls: Record<string, unknown>[] = [];
  me(): Promise<Me> {
    return Promise.resolve(person);
  }
  answer(args: Record<string, unknown>): Board {
    const base = { date: String(args.date), counts: { assigned: 30, in_progress: 0, completed: 1, cancelled: 0 }, totals: { assigned: 30, in_progress: 0, completed: 1 } };
    if (args.column === "assigned") {
      const from = args.cursor === cursorAt(25) ? 25 : 0;
      return { ...base, assigned: ALL.slice(from, from + Number(args.limit)), in_progress: [], completed: [] };
    }
    return { ...base, next: { assigned: cursorAt(25) }, assigned: ALL.slice(0, 25), in_progress: [], completed: [cardN(99)] };
  }
  call<T>(_tool: string, args: Record<string, unknown> = {}): Promise<T> {
    this.calls.push(args);
    return Promise.resolve(structuredClone(this.answer(args)) as T);
  }
  watch<T>(tool: string, args: Record<string, unknown>, cb: (ev: WatchEvent<T>) => void): () => void {
    void this.call<T>(tool, args).then((data) => cb({ type: "data", data, at: Date.now() }));
    return () => {};
  }
  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

const person: Me = { name: "Palitha", role: "office", permissions: ["view", "assign_tasks"], tools: ["task_board", "create_task"] };

describe("the board a column at a time", () => {
  it("25 cards a column, the column's count from its totals, Load more asks the column's next cards", async () => {
    const t = new Boards();
    render(
      <FleetProvider value={{ store: new FleetStore(t), transport: t, me: person, noConnector: false }}>
        <MemoryRouter initialEntries={["/tasks"]}><Tasks /></MemoryRouter>
      </FleetProvider>,
    );
    await act(async () => { await Promise.resolve(); });
    expect(t.calls[0]).toEqual({ date: today(), limit: 25 });
    const col = screen.getByTestId("board-col-assigned");
    expect(within(col).getByTestId("col-count").textContent).toBe("30");
    expect(col.querySelectorAll(".tcard")).toHaveLength(25);
    expect(within(col).getByTestId("load-more").textContent).toContain("Showing 25 of 30");
    // A column with all its cards has no Load more.
    expect(within(screen.getByTestId("board-col-completed")).queryByTestId("load-more")).toBeNull();
    fireEvent.click(within(col).getByRole("button", { name: "Load more" }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(t.calls.at(-1)).toEqual({ date: today(), column: "assigned", limit: 25, cursor: cursorAt(25) });
    const after = screen.getByTestId("board-col-assigned");
    expect(after.querySelectorAll(".tcard")).toHaveLength(30);
    expect(within(after).getByText("Drop 30")).toBeTruthy();
    expect(within(after).queryByTestId("load-more")).toBeNull();
  });
});
