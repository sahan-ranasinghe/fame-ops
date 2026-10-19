// Hotfix 4: a list's URL filter (the search's ?q=) written after its page was left must not land on the next page's address
// (a search settling as a link is followed: "?q=" goes with wherever the router is now).
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { useUrlFilter, watchRouterPath } from "./ListKit";

let write: (v: string) => void = () => {};
function Page() {
  const [, set] = useUrlFilter<string>("q", "");
  write = set;
  const loc = useLocation();
  return <output data-testid="where">{loc.pathname + loc.search}</output>;
}

afterEach(() => watchRouterPath(null));

describe("a URL filter writes only on its own page", () => {
  it("on its page: written", () => {
    render(<MemoryRouter initialEntries={["/settings/users"]}><Page /></MemoryRouter>);
    watchRouterPath(() => "/settings/users");
    act(() => write("kamal"));
    expect(screen.getByTestId("where").textContent).toBe("/settings/users?q=kamal");
  });

  it("the router already on the next page: dropped", () => {
    render(<MemoryRouter initialEntries={["/settings/users"]}><Page /></MemoryRouter>);
    watchRouterPath(() => "/settings/users/new");
    act(() => write("kamal"));
    expect(screen.getByTestId("where").textContent).toBe("/settings/users");
  });
});
