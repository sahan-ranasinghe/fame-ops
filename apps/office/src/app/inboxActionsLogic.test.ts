// Round 4–7 (7): the notification centre's buttons, pure (app/inboxActionsLogic.ts).
import { afterEach, describe, expect, it } from "vitest";
import { actionsOf, answeredLabel, forgetAnswered, itemLink, keepAnswered, saidText } from "./inboxActionsLogic";

const TASK = "/tasks/1b2c3d4e-0000-4000-8000-00000000abcd";

afterEach(() => forgetAnswered());

describe("an item's buttons", () => {
  it("only well-formed actions; the answer kept per item; its words", () => {
    expect(actionsOf({})).toEqual([]);
    expect(actionsOf({ actions: [{ label: "Yes", tool: "answer_holder_ask", args: { ask_id: "a", answer: "yes" } }, { label: "", tool: "x", args: {} }] }))
      .toEqual([{ label: "Yes", tool: "answer_holder_ask", args: { ask_id: "a", answer: "yes" } }]);
    expect(answeredLabel(7)).toBeUndefined();
    keepAnswered(7, "No");
    expect(answeredLabel(7)).toBe("No");
    expect(saidText("Yes")).toBe("You said Yes");
  });
  it("an ask's link: the task for someone who may open tasks, else the Asks page; other items as before", () => {
    expect(itemLink({ event: "holder.asked", url: TASK }, true)).toEqual({ to: TASK });
    expect(itemLink({ event: "holder.asked", url: TASK }, false)).toEqual({ to: "/tasks/asks" });
    expect(itemLink({ event: "holder.answered", url: TASK }, false)).toEqual({ to: "/tasks/asks" });
    expect(itemLink({ event: "request.decided", url: TASK }, false)).toEqual({ to: TASK });
    expect(itemLink({ event: "holder.asked", url: "/tasks/history" }, false)).toEqual({ to: "/tasks/history" });
    expect(itemLink({ event: "holder.asked", url: undefined }, false)).toBeNull();
  });
});
