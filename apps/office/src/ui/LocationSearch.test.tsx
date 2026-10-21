import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { FleetProvider } from "../app/FleetContext";
import { FleetStore } from "../data/store";
import type { Me, Transport, WatchEvent } from "../transport/types";
import { LocationSearch } from "./LocationSearch";
import type { Picked } from "./locationLogic";

/** search_places answers our place and one Google result; google_place answers the pin. */
class Places implements Transport {
  readonly kind = "api" as const;
  calls: { tool: string; args: Record<string, unknown> }[] = [];
  me(): Promise<Me> {
    return Promise.resolve({ name: "Sahan", role: "admin", permissions: ["assign_tasks"], tools: ["search_places", "google_place", "save_place"], map: { package: "google", places: true } });
  }
  call<T>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ tool, args });
    if (tool === "search_places") {
      return Promise.resolve({
        text: args.text,
        results: [
          { layer: "place", badge: "Office", name: "Kandy office", id: "p-1", pinned: true, lat: 7.29, lng: 80.63 },
          { layer: "google", badge: "Google", name: "Kandy City Centre", detail: "Dalada Veediya, Kandy", pinned: false, google_place_id: "ChIJ-kcc", attribution: "Google Maps" },
        ],
      } as T);
    }
    if (tool === "google_place") {
      return Promise.resolve({ google_place_id: "ChIJ-kcc", lat: 7.2931, lng: 80.635, fetched_at: "2026-10-16 10:00", kept_until: "2026-11-15 10:00", attribution: "Google Maps" } as T);
    }
    return Promise.resolve({} as T);
  }
  watch<T>(_t: string, _a: Record<string, unknown>, _cb: (ev: WatchEvent<T>) => void): () => void {
    return () => {};
  }
  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

async function mount(google: boolean) {
  const transport = new Places();
  const me = await transport.me();
  const picked: Picked[] = [];
  function Box() {
    const [v, setV] = useState("");
    return <LocationSearch id="s" label="Stop" value={v} google={google} onText={setV} onPick={(p) => picked.push(p)} />;
  }
  render(
    <FleetProvider value={{ store: new FleetStore(transport), transport, me, noConnector: false }}>
      <MemoryRouter><Box /></MemoryRouter>
    </FleetProvider>,
  );
  return { transport, picked };
}

describe("LocationSearch with Google's places (Part 5)", () => {
  it("asks with google and one session token, credits Google Maps, and a pick asks google_place with the same token", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { transport, picked } = await mount(true);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Kandy" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    await waitFor(() => expect(screen.getByText("Kandy City Centre")).toBeTruthy());
    const search = transport.calls.find((c) => c.tool === "search_places")!;
    expect(search.args.google).toBe(true);
    expect(typeof search.args.session).toBe("string");
    expect(screen.getByTestId("google-credit").textContent).toBe("Google Maps");
    fireEvent.click(screen.getByText("Kandy City Centre"));
    await waitFor(() => expect(picked).toHaveLength(1));
    expect(transport.calls.find((c) => c.tool === "google_place")!.args).toEqual({ google_place_id: "ChIJ-kcc", session: search.args.session });
    expect(picked[0]).toEqual({ name: "Kandy City Centre", googlePlaceId: "ChIJ-kcc", lat: 7.2931, lng: 80.635, pinned: true, badge: "Google" });
    vi.useRealTimers();
  });

  it("a box without google (a request's From and To) never asks Google", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { transport } = await mount(false);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Kandy" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    await waitFor(() => expect(transport.calls.some((c) => c.tool === "search_places")).toBe(true));
    const search = transport.calls.find((c) => c.tool === "search_places")!;
    expect([search.args.google, search.args.session]).toEqual([undefined, undefined]);
    vi.useRealTimers();
  });
});

/** search_places {suggest}: 5 recent, 3 of ours (the office first), 2 towns, as the server answers an empty box. */
class Suggesting extends Places {
  call<T>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
    if (tool === "search_places" && args.suggest) {
      this.calls.push({ tool, args });
      const r = (name: string) => ({ layer: "recent", badge: "Used before", name, pinned: true, lat: 7, lng: 80 });
      const p = (name: string, badge = "Saved") => ({ layer: "place", badge, name, id: `p-${name}`, pinned: true, lat: 7, lng: 80 });
      const town = (name: string) => ({ layer: "town", badge: "Town", name, pinned: true, lat: 7, lng: 80 });
      return Promise.resolve({
        text: "", suggested: true,
        results: [r("Kandy depot"), r("Galle site"), r("Head office"), r("Jaffna store"), r("Matara"), p("Head office", "Office"), p("Store A"), p("Store B"), town("Kurunegala"), town("Kegalle")],
      } as T);
    }
    return super.call<T>(tool, args);
  }
}

describe("LocationSearch: the empty box's Where suggestions (Round 1 item 6)", () => {
  it("on focus: 5 rows at most, ours then 3 recent, icons not badges, no towns; More places opens the rest", async () => {
    const transport = new Suggesting();
    const me = await transport.me();
    const picked: Picked[] = [];
    render(
      <FleetProvider value={{ store: new FleetStore(transport), transport, me, noConnector: false }}>
        <MemoryRouter><LocationSearch id="s" label="Stop" value="" onText={() => {}} onPick={(p) => picked.push(p)} /></MemoryRouter>
      </FleetProvider>,
    );
    fireEvent.focus(screen.getByRole("combobox"));
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(5));
    expect(transport.calls.filter((c) => c.tool === "search_places")).toEqual([{ tool: "search_places", args: { suggest: true } }]);
    expect(screen.getAllByRole("option").map((o) => o.querySelector("b")!.textContent)).toEqual(["Head office", "Store A", "Kandy depot", "Galle site", "Jaffna store"]);
    expect(screen.getAllByTestId("where-icon-building")).toHaveLength(2);
    expect(screen.getAllByTestId("where-icon-clock")).toHaveLength(3);
    expect(screen.queryByText("Used before")).toBeNull();
    expect(screen.queryByText("Office")).toBeNull();
    expect(screen.queryByText("Kurunegala")).toBeNull();
    fireEvent.click(screen.getByTestId("where-more"));
    expect(screen.getAllByRole("option")).toHaveLength(7);
    expect(screen.queryByText("Kurunegala")).toBeNull();
    expect(screen.queryByTestId("where-more")).toBeNull();
    fireEvent.click(screen.getByText("Store A"));
    expect(picked[0]).toMatchObject({ name: "Store A", placeId: "p-Store A" });
  });

  it("typing: the search's own rows with their badges (the suggestions gone)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const transport = new Suggesting();
    const me = await transport.me();
    function Box() {
      const [v, setV] = useState("");
      return <LocationSearch id="s" label="Stop" value={v} onText={setV} onPick={() => {}} />;
    }
    render(
      <FleetProvider value={{ store: new FleetStore(transport), transport, me, noConnector: false }}>
        <MemoryRouter><Box /></MemoryRouter>
      </FleetProvider>,
    );
    fireEvent.focus(screen.getByRole("combobox"));
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(5));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Kandy" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    await waitFor(() => expect(screen.getByText("Kandy office")).toBeTruthy());
    expect(screen.queryByText("Head office")).toBeNull();
    expect(screen.getByText("Office")).toBeTruthy();
    expect(screen.queryByTestId("where-icon-building")).toBeNull();
    vi.useRealTimers();
  });
});
