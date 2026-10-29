import { assertEquals } from "@std/assert";
import {
  expoMessagesFor,
  OFFICE_ISSUES,
  OFFICE_ISSUES_2,
  OFFICE_REQUESTS,
  OFFICE_REQUESTS_2,
  officeChannelFor,
  readTickets,
} from "./expo.ts";

const phone13 = { id: "t1", token: "ExponentPushToken[a]", channels: ["task-ring", "task-updates", "task-reminders", "office-asks"] };
const phone12 = { id: "t2", token: "ExponentPushToken[b]", channels: ["tasks-new", "tasks-changed", "general", "new-tasks"] };

Deno.test("urgent and alarm ring on task-ring (1.3.0), the rest a tone on task-updates; a 1.2.0 phone keeps its channels", () => {
  assertEquals(officeChannelFor("urgent", phone13.channels), "task-ring");
  assertEquals(officeChannelFor("alarm", phone13.channels), "task-ring");
  assertEquals(officeChannelFor("alert", phone13.channels), "task-updates");
  assertEquals(officeChannelFor("soft", phone13.channels), "task-updates");
  assertEquals(officeChannelFor("info", phone13.channels), "task-updates");
  assertEquals(officeChannelFor("urgent", phone12.channels), "tasks-new");
  assertEquals(officeChannelFor("alert", []), "general");
});

Deno.test("a request to approve: one message per phone, the site's title and body, the link the app opens, loud", () => {
  const m = expoMessagesFor("request.created", { title: "Site visit · Kurunegala", body: "Nimali asks", url: "/requests/r1/decide" }, [
    phone13,
    phone12,
  ]);
  assertEquals(m.length, 2);
  assertEquals(m[0].to, "ExponentPushToken[a]");
  assertEquals(m[0].title, "Site visit · Kurunegala");
  assertEquals(m[0].body, "Nimali asks");
  assertEquals(m[0].data, { kind: "office", event: "request.created", url: "/requests/r1/decide", inbox: "urgent" });
  assertEquals(m[0].channelId, "task-ring");
  assertEquals(m[1].channelId, "tasks-new");
  assertEquals(m[0].priority, "high");
});

Deno.test("a driver on the way (soft): the tone channel; no link when the payload has none; an unknown event is info", () => {
  const m = expoMessagesFor("request.on_the_way", { title: "Sunil is on the way", body: "" }, [phone13]);
  assertEquals(m[0].channelId, "task-updates");
  assertEquals(m[0].data, { kind: "office", event: "request.on_the_way", inbox: "soft" });
  assertEquals(expoMessagesFor("something.new", {}, [phone13])[0].title, "Fame Fleet");
  assertEquals(expoMessagesFor("something.new", {}, [phone13])[0].data.inbox, "info");
});

Deno.test("the tickets: sent counts the ok ones, a gone device is listed to delete, other errors kept", () => {
  const r = readTickets([{ status: "ok" }, { status: "error", details: { error: "DeviceNotRegistered" } }, {
    status: "error",
    message: "boom",
  }], [
    { id: "a", token: "x" },
    { id: "b", token: "y" },
    { id: "c", token: "z" },
  ]);
  assertEquals(r, { sent: 1, errors: ["DeviceNotRegistered", "boom"], gone: ["b"] });
});

Deno.test("an office phone with its own channels: issues on Issues, every other event on Requests and approvals; never a channel it lacks", () => {
  const office = ["task-ring", "task-updates", "office-asks", "task-reminders", OFFICE_REQUESTS, OFFICE_ISSUES];
  assertEquals(officeChannelFor("urgent", office, "request.created"), OFFICE_REQUESTS);
  assertEquals(officeChannelFor("urgent", office, "task.declined"), OFFICE_REQUESTS);
  assertEquals(officeChannelFor("soft", office, "request.on_the_way"), OFFICE_REQUESTS);
  assertEquals(officeChannelFor("alarm", office, "issue.opened"), OFFICE_ISSUES);
  assertEquals(officeChannelFor("alert", office, "issue.assigned"), OFFICE_ISSUES);
  // A phone with only one of them: the other events keep the channels before.
  assertEquals(officeChannelFor("alarm", ["task-ring", OFFICE_REQUESTS], "issue.opened"), "task-ring");
  assertEquals(officeChannelFor("urgent", ["task-ring", OFFICE_ISSUES], "request.created"), "task-ring");
  // Per phone: the office phone's own channel; a phone without it as before (a critical issue loud).
  const msgs = expoMessagesFor("issue.opened", { title: "Critical", body: "x" }, [{ id: "1", token: "t1", channels: office }, {
    id: "2",
    token: "t2",
    channels: ["task-ring"],
  }]);
  assertEquals(msgs.map((m) => m.channelId), [OFFICE_ISSUES, "task-ring"]);
});

Deno.test("release 1.4.0: a phone with the office's own sounds gets them first; a 1.3.0 office phone keeps its pair", () => {
  const both = ["task-ring", "task-updates", OFFICE_REQUESTS_2, OFFICE_ISSUES_2];
  assertEquals(officeChannelFor("urgent", both, "request.created"), OFFICE_REQUESTS_2);
  assertEquals(officeChannelFor("alarm", both, "issue.opened"), OFFICE_ISSUES_2);
  // Between the new pair being made and the old one deleted the phone has all four: the new pair wins.
  const four = [...both, OFFICE_REQUESTS, OFFICE_ISSUES];
  assertEquals([officeChannelFor("urgent", four, "request.created"), officeChannelFor("alarm", four, "issue.opened")], [
    OFFICE_REQUESTS_2,
    OFFICE_ISSUES_2,
  ]);
  const old = ["task-ring", "task-updates", OFFICE_REQUESTS, OFFICE_ISSUES];
  assertEquals([officeChannelFor("urgent", old, "request.created"), officeChannelFor("alarm", old, "issue.opened")], [
    OFFICE_REQUESTS,
    OFFICE_ISSUES,
  ]);
});
