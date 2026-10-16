import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { cursorEl, gapMarkEl, setCursor, setGapOpen, setPlanPin } from "./domMarks";
import { cardPlacement, gapCardLines, needsCentre, useGapOpen } from "./gapLogic";

describe("a gap's card (§21)", () => {
  it("the kind in bold, the rest under it", () => {
    expect(gapCardLines("App not running · 14:02–14:44 · 42 min · about 21.3 km by road")).toEqual(["App not running", "14:02–14:44 · 42 min · about 21.3 km by road"]);
    expect(gapCardLines("Offline here · uploaded 14:20")).toEqual(["Offline here", "uploaded 14:20"]);
    expect(gapCardLines("Stopped")).toEqual(["Stopped", ""]);
  });

  it("opens to the side that stays inside the map (left in the right part, clear of the controls)", () => {
    expect(cardPlacement(100, 200, 800, 500)).toEqual({ side: "right", v: "mid" });
    expect(cardPlacement(600, 200, 800, 500)).toEqual({ side: "left", v: "mid" });
    expect(cardPlacement(100, 10, 800, 500).v).toBe("down");
    expect(cardPlacement(100, 490, 800, 500).v).toBe("up");
  });

  it("an opened marker is centred only near the edge or outside the view", () => {
    expect(needsCentre(400, 250, 800, 500)).toBe(false);
    expect(needsCentre(20, 250, 800, 500)).toBe(true);
    expect(needsCentre(790, 250, 800, 500)).toBe(true);
    expect(needsCentre(400, 10, 800, 500)).toBe(true);
    expect(needsCentre(400, 495, 800, 500)).toBe(true);
    expect(needsCentre(-50, 250, 800, 500)).toBe(true);
  });
});

describe("the open card", () => {
  it("follows openGap (a Gaps list row) and tells the page about every open and close made on the map", () => {
    const onGap = vi.fn();
    const { result, rerender } = renderHook(({ id }) => useGapOpen(id, onGap), { initialProps: { id: null as string | null } });
    expect(result.current[0]).toBeNull();
    rerender({ id: "g1" });
    expect(result.current[0]).toBe("g1");
    expect(onGap).not.toHaveBeenCalled();
    act(() => result.current[1](null));
    expect(result.current[0]).toBeNull();
    expect(onGap).toHaveBeenLastCalledWith(null);
    act(() => result.current[1]("g2"));
    expect(result.current[0]).toBe("g2");
    expect(onGap).toHaveBeenLastCalledWith("g2");
  });
});

describe("the HTML maps' elements", () => {
  it("a gap marker carries its words only in the card and its name; a tap toggles, Escape closes", () => {
    const toggle = vi.fn(), close = vi.fn();
    const el = gapMarkEl({ id: "g", kind: "no_gps", lat: 7, lng: 80, text: "Stopped · no GPS signal · 10:05–10:31" }, { toggle, close, container: () => null });
    expect(el.getAttribute("aria-label")).toBe("Stopped · no GPS signal · 10:05–10:31");
    expect(el.querySelector(".gap-card b")?.textContent).toBe("Stopped");
    expect(el.querySelector("svg")).not.toBeNull();
    el.click();
    expect(toggle).toHaveBeenCalledWith("g");
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(close).toHaveBeenCalled();
    setGapOpen(el, true);
    expect(el.classList.contains("open")).toBe(true);
    expect(el.getAttribute("aria-expanded")).toBe("true");
  });

  it("the playback marker is hollow while estimated and turned to the heading (§22)", () => {
    const el = cursorEl();
    setCursor(el, { lat: 7, lng: 80, label: "14:32:05", estimated: true, heading: 90 });
    expect(el.className).toBe("mk-cursor est heading");
    expect((el.querySelector(".mk-cursor-arrow") as HTMLElement).style.transform).toContain("rotate(90deg)");
    expect(el.textContent).toBe("14:32:05");
    setCursor(el, { lat: 7, lng: 80, label: "14:32:06" });
    expect(el.className).toBe("mk-cursor");
  });

  it("a plan pin: red when late, highlighted when selected", () => {
    const el = document.createElement("button");
    el.innerHTML = "<span></span><span></span>";
    setPlanPin(el, { id: "p", n: 2, lat: 7, lng: 80, label: "2 · Kurunegala site · 09:00–10:30", late: true }, true);
    expect(el.className).toBe("plan-pin late sel");
    expect(el.getAttribute("aria-pressed")).toBe("true");
    expect(el.textContent).toBe("2Kurunegala site · 09:00–10:30");
  });
});
