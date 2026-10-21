// Part 3b (H2): the one driver row's words and links.
import { describe, expect, it } from "vitest";
import { drivenByWord, factsLine, firstName, livePresence, nextLine, nowTone, toPhoneLinks, vehicleChipWords } from "./driverRowLogic";

describe("the driver row's words (H2)", () => {
  it("the status chip: on a task blue, on duty green, off duty grey, not available amber", () => {
    expect([nowTone("on_task"), nowTone("on_duty"), nowTone("off_duty"), nowTone("not_available"), nowTone(undefined)]).toEqual(["live", "ok", "muted", "warn", "muted"]);
  });

  it("last seen with the usual start, and the next task on its own line", () => {
    expect(factsLine({ last_seen: "Last seen 17:42 near Kadawatha", usual_start: "07:40" })).toBe("Last seen 17:42 near Kadawatha · usually starts 07:40");
    expect(factsLine({ usual_start: "07:40" })).toBe("usually starts 07:40");
    expect(factsLine({})).toBe("");
    expect(nextLine({ next_task: { title: "Team drop", when: "14:30" } })).toBe("Next: Team drop · 14:30");
    expect(nextLine({})).toBe("");
  });

  it("Call and WhatsApp from a person's links: the number shown, WhatsApp to their own WhatsApp number; none without a call link", () => {
    expect(toPhoneLinks({ phone: "+94771234567", phone_display: "077 123 4567", call: "tel:+94771234567", whatsapp: "https://wa.me/94779999999" }))
      .toEqual({ phone: "+94771234567", phone_display: "077 123 4567", call: "tel:+94771234567", whatsapp: "https://wa.me/94779999999" });
    // Only the call link: the number comes from it and is shown the Sri Lankan way; no WhatsApp.
    expect(toPhoneLinks({ call: "tel:+94771234567" })).toEqual({ phone: "+94771234567", phone_display: "077 123 4567", call: "tel:+94771234567", whatsapp: "" });
    expect(toPhoneLinks({ whatsapp: "https://wa.me/94771234567" })).toBeNull();
    expect(toPhoneLinks(undefined)).toBeNull();
    expect(firstName("Kamal Perera")).toBe("Kamal");
  });

  it("Live's extra lines: the late report and not available in amber, the next task and the usual start in grey", () => {
    expect(livePresence({
      late_report: { text: "Running late 15 min · said 08:52" },
      not_available: "Not available, back 13:00",
      next_task: { title: "Team drop", when: "14:30" },
      usual_start: "07:40",
    })).toEqual({ warn: "Running late 15 min · said 08:52 · Not available, back 13:00", facts: "Next: Team drop · 14:30 · usually starts 07:40" });
    expect(livePresence({})).toEqual({ warn: "", facts: "" });
  });
});

describe("the driver-first card's vehicle chip and small word (Round 3)", () => {
  it("the plate, \"regular\" beside a regular one, the answer's words, else on the day (setting on) or none yet", () => {
    expect(vehicleChipWords({ reg_no: "WP CAB-4521", source: "on_duty" })).toEqual({ plate: "WP CAB-4521" });
    expect(vehicleChipWords({ reg_no: "WP KL-1234", source: "regular" })).toEqual({ plate: "WP KL-1234", note: "regular" });
    expect(vehicleChipWords("WP CAB-4521", { note: "since 08:40" })).toEqual({ plate: "WP CAB-4521", note: "since 08:40" });
    expect(vehicleChipWords(undefined, { text: "Any van" })).toEqual({ text: "Any van" });
    expect(vehicleChipWords(null, { onTheDay: true })).toEqual({ text: "Vehicle: on the day" });
    expect(vehicleChipWords(null)).toEqual({ text: "No vehicle yet" });
    expect(vehicleChipWords("", { onTheDay: false })).toEqual({ text: "No vehicle yet" });
  });

  it("a trip with no app says who drives instead of a state", () => {
    expect([drivenByWord("self"), drivenByWord("other"), drivenByWord("driver"), drivenByWord(undefined)]).toEqual(["Drives themselves", "Someone else", null, null]);
  });
});
