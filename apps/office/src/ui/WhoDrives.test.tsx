// Round 3: the one "Who drives?" control: three chips (the picked one marked), someone else's name and phone under it,
// nothing at all while self-drive is off.
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { WhoDrives } from "./WhoDrives";
import { emptyWho, type WhoDrivesValue } from "./whoDrivesLogic";

function Form({ start = emptyWho(), selfWords, hidden, seen }: { start?: WhoDrivesValue; selfWords?: string; hidden?: boolean; seen?: (v: WhoDrivesValue) => void }) {
  const [v, setV] = useState(start);
  return <WhoDrives id="t" value={v} onChange={(x) => { setV(x); seen?.(x); }} selfWords={selfWords} hidden={hidden} picksVehicle />;
}

describe("Who drives? (Round 3)", () => {
  it("a driver by default; Someone else opens their name and phone; the picked chip is pressed", () => {
    const seen: WhoDrivesValue[] = [];
    render(<Form seen={(v) => seen.push(v)} />);
    expect(screen.getByRole("group", { name: "Who drives?" })).toBeTruthy();
    const chip = (name: string) => screen.getByRole("button", { name });
    expect(chip("A driver").getAttribute("aria-pressed")).toBe("true");
    expect(chip("I'll drive myself").getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByLabelText("Their name")).toBeNull();
    expect(screen.queryByTestId("who-hint")).toBeNull();

    fireEvent.click(chip("Someone else"));
    expect(chip("Someone else").getAttribute("aria-pressed")).toBe("true");
    fireEvent.change(screen.getByLabelText("Their name"), { target: { value: "Nimal" } });
    fireEvent.change(screen.getByLabelText("Their phone"), { target: { value: "077 123 4567" } });
    expect(seen[seen.length - 1]).toEqual({ by: "other", name: "Nimal", phone: "077 123 4567" });
    expect(screen.getByTestId("who-hint").textContent).toContain("Not in Fame Fleet");

    // Back to myself and again to someone else: the name and phone typed are kept.
    fireEvent.click(chip("I'll drive myself"));
    expect(screen.queryByLabelText("Their name")).toBeNull();
    expect(screen.getByTestId("who-hint").textContent).toBe("You drive it yourself: no app and nothing is sent. Pick the vehicle below.");
    fireEvent.click(chip("Someone else"));
    expect((screen.getByLabelText("Their name") as HTMLInputElement).value).toBe("Nimal");
  });

  it("on someone else's request the second choice names the asker; with self-drive off nothing is shown", () => {
    const { unmount } = render(<Form selfWords="Dilini drives" />);
    expect(screen.getByRole("button", { name: "Dilini drives" })).toBeTruthy();
    unmount();
    render(<Form hidden />);
    expect(screen.queryByTestId("who-drives")).toBeNull();
  });
});
