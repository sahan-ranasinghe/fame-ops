// Round 4–7 (7): the holder line's words and ask_for_it's input (ui/holderLogic.ts).
import { describe, expect, it } from "vitest";
import type { Holder } from "../data/types";
import { askArgs, askSentence, askWhat, busyWords, byLine, canAskFor, conflictWhat, holderPhone, holderTitle, isMe, wantedOfArgs, windowText } from "./holderLogic";

const holder = (over: Partial<Holder> = {}): Holder => ({
  task_id: "t1", employee_id: "e1", name: "Anoja Perera", label: "Staff", by: "asked", window: "08:00–11:00", from: "08:00", to: "11:00",
  phone: "+94771234567", phone_display: "077 123 4567", call: "tel:+94771234567", whatsapp: "https://wa.me/94771234567", ...over,
});

describe("the holder line", () => {
  it("the window, the title and how they hold it", () => {
    expect(windowText(holder())).toBe("08:00–11:00");
    expect(windowText(holder({ to: undefined }))).toBe("from 08:00");
    expect(holderTitle(holder())).toBe("Anoja Perera · Staff");
    expect(holderTitle(holder({ label: undefined }))).toBe("Anoja Perera");
    expect(holderTitle(holder(), "anoja perera ")).toBe("You");
    expect(byLine(holder())).toBe("Asked for it · 08:00–11:00");
    expect(byLine(holder({ by: "assigned", to: undefined }))).toBe("Assigned it · from 08:00");
  });
  it("a busy row's strip: the first name's, or Yours", () => {
    expect(busyWords(holder())).toBe("Anoja's · 08:00–11:00");
    expect(busyWords(holder(), "Anoja Perera")).toBe("Yours · 08:00–11:00");
  });
  it("Call and WhatsApp only with a number", () => {
    expect(holderPhone(holder())).toEqual({ phone: "+94771234567", phone_display: "077 123 4567", call: "tel:+94771234567", whatsapp: "https://wa.me/94771234567" });
    expect(holderPhone(holder({ call: undefined }))).toBeNull();
    expect(holderPhone(holder({ phone: undefined }))).toBeNull();
    expect(holderPhone(holder({ whatsapp: undefined }))?.whatsapp).toBe("");
  });
  it("Ask for it: the tool, someone else, never the garage", () => {
    expect(canAskFor(["ask_for_it"], holder(), "Palitha")).toBe(true);
    expect(canAskFor([], holder(), "Palitha")).toBe(false);
    expect(canAskFor(["ask_for_it"], holder(), "Anoja Perera")).toBe(false);
    expect(canAskFor(["ask_for_it"], holder(), "Palitha", "garage")).toBe(false);
    expect(isMe(holder(), undefined)).toBe(false);
  });
});

describe("ask_for_it", () => {
  it("what is asked for, from the card's sentence", () => {
    expect(conflictWhat({ text: "WP CAB-4521 is on task Team drop 08:00–11:00 for Anoja (driver Kamal)" })).toBe("WP CAB-4521");
    expect(conflictWhat({ text: "Kamal is on task Team drop 08:00–11:00" })).toBe("Kamal");
    expect(conflictWhat({ text: "WP CAB-4521 is in the garage" })).toBeUndefined();
    expect(askWhat("vehicle")).toBe("the vehicle");
    expect(askWhat("driver", " ")).toBe("the driver");
    expect(askSentence(holder(), "vehicle", "WP CAB-4521")).toBe("Anoja has WP CAB-4521 08:00–11:00. They get Yes / No in one tap; nothing changes until the fleet admin reassigns.");
  });
  it("the input: the note trimmed, the window only when real", () => {
    expect(askArgs("t1", "vehicle")).toEqual({ task_id: "t1", resource: "vehicle" });
    expect(askArgs("t1", "driver", "  site visit  ", { date: "2026-10-24", from: "09:00", until: "12:00" }))
      .toEqual({ task_id: "t1", resource: "driver", note: "site visit", date: "2026-10-24", from: "09:00", until: "12:00" });
    expect(askArgs("t1", "vehicle", "", { date: "2026-10-24", from: "09:00", until: "08:00" })).toEqual({ task_id: "t1", resource: "vehicle", date: "2026-10-24", from: "09:00" });
    expect(askArgs("t1", "vehicle", undefined, { date: "24 Oct", from: "09:00" })).toEqual({ task_id: "t1", resource: "vehicle" });
    expect(askArgs("t1", "vehicle", undefined, { date: "2026-10-24", from: "9am" })).toEqual({ task_id: "t1", resource: "vehicle" });
    expect((askArgs("t1", "vehicle", "x".repeat(400)).note as string).length).toBe(300);
  });
  it("the wanted window from Who's available's arguments", () => {
    expect(wantedOfArgs({ at: "2026-10-24 09:00", until: "12:00" })).toEqual({ date: "2026-10-24", from: "09:00", until: "12:00" });
    expect(wantedOfArgs({ at: "2026-10-24 09:00" })).toEqual({ date: "2026-10-24", from: "09:00" });
    expect(wantedOfArgs(null)).toBeNull();
    expect(wantedOfArgs({})).toBeNull();
  });
});
