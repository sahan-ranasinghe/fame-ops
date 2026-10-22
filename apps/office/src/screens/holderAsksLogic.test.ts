// Round 4–7 (7): the Asks page's rules (screens/holderAsksLogic.ts).
import { describe, expect, it } from "vitest";
import { answerChip, askMeta, asksEmpty, asksFor, askTabs, askTitle, canAnswer, type HolderAsk, taskAskCount, withAnswers } from "./holderAsksLogic";

const ask = (over: Partial<HolderAsk> = {}): HolderAsk => ({
  id: "a1", task_id: "t1", trip: "Team drop", resource: "vehicle", what: "WP CAB-4521", wanted: "Fri 24 Oct 09:00–12:00", asked_by: "Nimal", holder: "Anoja", asked_at: "Thu 23 Oct 10:00", ...over,
});

describe("the Asks page", () => {
  it("the tabs: All only with approve", () => {
    expect(askTabs(false).map(([k]) => k)).toEqual(["to_me", "by_me"]);
    expect(askTabs(true)).toEqual([["to_me", "To me"], ["by_me", "By me"], ["all", "All"]]);
  });
  it("a row's title and grey line per tab", () => {
    expect(askTitle(ask())).toBe("WP CAB-4521 · Team drop");
    expect(askTitle(ask({ what: undefined, resource: "driver", trip: undefined }))).toBe("A driver");
    expect(askMeta(ask({ note: "site visit" }), "to_me")).toBe("Fri 24 Oct 09:00–12:00 · asked by Nimal · “site visit”");
    expect(askMeta(ask(), "by_me")).toBe("Fri 24 Oct 09:00–12:00 · asked Anoja");
    expect(askMeta(ask({ holder: undefined }), "by_me")).toBe("Fri 24 Oct 09:00–12:00 · asked the fleet admin");
    expect(askMeta(ask({ answer: "yes", answered_by: "Palitha" }), "all")).toBe("Fri 24 Oct 09:00–12:00 · Nimal asked Anoja · answered by Palitha");
    expect(askMeta(ask({ answer: "yes", answered_by: "Anoja" }), "all")).toBe("Fri 24 Oct 09:00–12:00 · Nimal asked Anoja");
  });
  it("the chip and who answers", () => {
    expect(answerChip(ask({ answer: "yes" }))).toEqual({ text: "Yes", tone: "ok" });
    expect(answerChip(ask({ answer: "no" }))).toEqual({ text: "No", tone: "bad" });
    expect(answerChip(ask())).toEqual({ text: "Waiting", tone: "warn" });
    expect(canAnswer(ask(), "to_me")).toBe(true);
    expect(canAnswer(ask({ answer: "no" }), "to_me")).toBe(false);
    expect(canAnswer(ask(), "by_me")).toBe(false);
    expect(canAnswer(ask(), "all")).toBe(false);
  });
  it("one trip's asks, answers given here, the empty line, the task page's count", () => {
    const list = [ask(), ask({ id: "a2", task_id: "t2" })];
    expect(asksFor(list, "t2").map((a) => a.id)).toEqual(["a2"]);
    expect(asksFor(list, null)).toHaveLength(2);
    expect(withAnswers(list, new Map([["a2", "yes" as const]])).map((a) => a.answer)).toEqual([undefined, "yes"]);
    expect(asksEmpty("to_me", false)).toBe("No asks to you in the last 14 days.");
    expect(asksEmpty("by_me", false)).toBe("You have not asked for anything in the last 14 days.");
    expect(asksEmpty("all", false)).toBe("No asks in the last 14 days.");
    expect(asksEmpty("to_me", true)).toBe("No asks about this trip in the last 14 days.");
    const toMe = { which: "to_me" as const, count: 1, asks: [ask()] };
    const byMe = { which: "by_me" as const, count: 2, asks: [ask(), ask({ id: "a3" }), ask({ id: "a4", task_id: "t9" })] };
    expect(taskAskCount([toMe, byMe, undefined], "t1")).toBe(2);
    expect(taskAskCount([undefined], "t1")).toBe(0);
  });
});
