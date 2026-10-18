// Hotfix 4 (b): back means back. The back arrow (and BackButton) go one step back in the history, to wherever the person
// came from; a page's own address is only where a page opened straight (a push, a link) goes, replacing itself.
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import { BackButton, hasAppPageBefore, PageTop } from "./Page";

function Where() {
  const loc = useLocation();
  return <output data-testid="where">{loc.pathname}</output>;
}

function app(entries: string[]) {
  render(
    <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
      <Routes>
        <Route path="/tasks/:id/edit" element={<><PageTop title="Give it a driver" backTo="/" /><BackButton fallback="/">Cancel</BackButton></>} />
        <Route path="*" element={null} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

describe("back means back", () => {
  it("from the Tasks board: the arrow goes back to the board, not to the page's own address", () => {
    app(["/tasks", "/tasks/t1/edit"]);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByTestId("where").textContent).toBe("/tasks");
  });

  it("from the Overview: Cancel goes back to the Overview", () => {
    app(["/somewhere", "/", "/tasks/t1/edit"]);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByTestId("where").textContent).toBe("/");
  });

  it("opened straight (a push): the page's own address, never forward to the task", () => {
    app(["/tasks/t1/edit"]);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByTestId("where").textContent).toBe("/");
  });

  it("the browser's history index decides when it is there; a memory router's key otherwise", () => {
    expect(hasAppPageBefore({ idx: 0, key: "abc" }, "abc")).toBe(false);
    expect(hasAppPageBefore({ idx: 2 }, "abc")).toBe(true);
    expect(hasAppPageBefore(null, "default")).toBe(false);
    expect(hasAppPageBefore(null, "x1y2")).toBe(true);
  });
});
