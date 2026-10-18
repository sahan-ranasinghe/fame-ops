// The notification centre's rules (Hotfix 2, A and B): only items that arrive after the page loaded are new (never
// the first load's), the banners, an item's link, and the count after marking read on the page.
import { describe, expect, it } from "vitest";
import { addBanners, freshItems, headline, itemTime, linkOf, MAX_BANNERS, markedRead, unreadBadge } from "./inboxLogic";
import type { Inbox, InboxItem } from "./types";

const item = (id: number, extra: Partial<InboxItem> = {}): InboxItem => ({
  id, event: "request.decided", title: `Item ${id}`, at: "2026-10-18 10:42", ago: "5 min ago", read: false, kind: "alert", ...extra,
});

describe("new items", () => {
  it("the first answer is never new: it only sets the mark", () => {
    expect(freshItems(null, [item(7), item(5, { read: true })])).toEqual({ fresh: [], seen: 7 });
    expect(freshItems(null, [])).toEqual({ fresh: [], seen: 0 });
  });
  it("later answers: an id above the mark and still unread", () => {
    const r = freshItems(7, [item(10), item(9, { read: true }), item(8), item(7), item(5)]);
    expect(r.fresh.map((i) => i.id)).toEqual([10, 8]);
    expect(r.seen).toBe(10);
    // Nothing new: the mark stays.
    expect(freshItems(10, [item(10), item(8)])).toEqual({ fresh: [], seen: 10 });
    // After an empty first load, the first item is new.
    expect(freshItems(0, [item(1)]).fresh.map((i) => i.id)).toEqual([1]);
  });
  it("an item from a minute before the page opened is never new (the artifact's cached copy came first)", () => {
    const opened = Date.parse("2026-10-18T10:42:30+05:30");
    const r = freshItems(5, [item(8, { at: "2026-10-18 10:43" }), item(7, { at: "2026-10-18 10:42" }), item(6, { at: "2026-10-18 10:41" })], opened);
    expect(r.fresh.map((i) => i.id)).toEqual([8, 7]);
    expect(r.seen).toBe(8);
    // A time that is not one does not hide the item.
    expect(freshItems(5, [item(6, { at: "" })], opened).fresh).toHaveLength(1);
    expect(itemTime("2026-10-18 10:42")).toBe(Date.parse("2026-10-18T05:12:00Z"));
  });
});

describe("banners", () => {
  it("the newest first, each once, at most three", () => {
    const shown = [item(3), item(2)];
    expect(addBanners(shown, [item(4), item(5)]).map((i) => i.id)).toEqual([5, 4, 3]);
    expect(addBanners([item(2)], [item(2)]).map((i) => i.id)).toEqual([2]);
    expect(addBanners([], [1, 2, 3, 4, 5].map((n) => item(n)))).toHaveLength(MAX_BANNERS);
  });
});

describe("an item's link", () => {
  it("a path in the app, this site's address, another site, or none", () => {
    expect(linkOf("/requests/r1", "https://fame-fleet.pages.dev")).toEqual({ to: "/requests/r1" });
    expect(linkOf("/tasks?task=t1", "https://fame-fleet.pages.dev")).toEqual({ to: "/tasks?task=t1" });
    expect(linkOf("https://fame-fleet.pages.dev/issues/9", "https://fame-fleet.pages.dev")).toEqual({ to: "/issues/9" });
    expect(linkOf("https://maps.google.com/?q=1", "https://fame-fleet.pages.dev")).toEqual({ href: "https://maps.google.com/?q=1" });
    expect(linkOf("requests/r2", "")).toEqual({ to: "/requests/r2" });
    expect(linkOf("", "x")).toBeNull();
    expect(linkOf(undefined, "x")).toBeNull();
  });
});

describe("marking read on the page", () => {
  const inbox: Inbox = { unread: 3, items: [item(3), item(2), item(1, { read: true }), item(0)] };
  it("the items read and the count down at once", () => {
    const r = markedRead(inbox, [3, 1]);
    expect(r.unread).toBe(2);
    expect(r.items.map((i) => i.read)).toEqual([true, false, true, false]);
  });
  it("all read: none unread", () => {
    const r = markedRead(inbox, "all");
    expect(r.unread).toBe(0);
    expect(r.items.every((i) => i.read)).toBe(true);
  });
  it("nothing unread among them: the same inbox (nothing re-renders)", () => {
    expect(markedRead(inbox, [1])).toBe(inbox);
    expect(markedRead(inbox, [42])).toBe(inbox);
  });
});

describe("words", () => {
  it("who · what, and the badge", () => {
    expect(headline({ who: "Palitha", title: "Approved your request" })).toBe("Palitha · Approved your request");
    expect(headline({ title: "Kamal is on the way" })).toBe("Kamal is on the way");
    expect(unreadBadge(7)).toBe("7");
    expect(unreadBadge(140)).toBe("99+");
  });
});
