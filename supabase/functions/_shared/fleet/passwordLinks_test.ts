// Round 49: the set-password link's server side (passwordLinks.ts) with a fake database: the token is never stored or
// logged, a save claims the link before Auth is asked and gives it back when Auth refuses, and the audit row names the
// person and never carries the password.
import { assert, assertEquals, assertMatch, assertNotEquals } from "@std/assert";
import type { Db } from "./db.ts";
import {
  checkPasswordLink,
  issuePasswordLink,
  LINK_VALID_FOR,
  linkBase,
  linkTokenHash,
  newLinkToken,
  passwordProblem,
  setPasswordUrl,
  tokenShapeOk,
  usePasswordLink,
} from "./passwordLinks.ts";

type Call = { fn: string; args: Record<string, unknown> };

function fakeDb(opts: { state?: string; authError?: string } = {}) {
  const calls: Call[] = [];
  const audits: Record<string, unknown>[] = [];
  const passwords: string[] = [];
  const db = {
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (fn === "password_link_issue") return Promise.resolve({ data: { id: "l1", expires_at: "2026-11-05T04:30:00Z" }, error: null });
      if (fn === "password_link_check") {
        const state = opts.state ?? "valid";
        return Promise.resolve({
          data: state === "valid"
            ? { state, link_id: "l1", employee_id: "e1", auth_user_id: "u1", name: "Shashen Herath", email: "s@x.test" }
            : { state },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
    auth: {
      admin: {
        updateUserById: (_id: string, attrs: { password: string }) => {
          passwords.push(attrs.password);
          return Promise.resolve({ data: {}, error: opts.authError ? { message: opts.authError } : null });
        },
      },
    },
    from: (_table: string) => ({
      insert: (row: Record<string, unknown>) => {
        audits.push(row);
        return Promise.resolve({ error: null });
      },
    }),
  } as unknown as Db;
  return { db, calls, audits, passwords };
}

Deno.test("a link carries a 43-character token after the '#'; only its SHA-256 goes to the database", async () => {
  const { db, calls } = fakeDb();
  const issued = await issuePasswordLink(db, { employeeId: "e1", kind: "new_account", by: "Sahan" }, "https://fame-fleet.pages.dev");
  assertMatch(issued.link, /^https:\/\/fame-fleet\.pages\.dev\/set-password#k=[A-Za-z0-9_-]{43}$/);
  assertEquals(issued.valid_for, LINK_VALID_FOR);
  assertEquals(LINK_VALID_FOR, "7 days");
  const token = issued.link.split("#k=")[1];
  assertEquals(calls[0].fn, "password_link_issue");
  assertEquals(calls[0].args.p_token_hash, await linkTokenHash(token));
  assertEquals(calls[0].args.p_days, 7);
  assert(!JSON.stringify(calls).includes(token), "the token itself never reaches the database");
});

Deno.test("tokens are random and shaped; the base is the site's first origin, else the local dev server", () => {
  const a = newLinkToken(), b = newLinkToken();
  assertNotEquals(a, b);
  assert(tokenShapeOk(a) && tokenShapeOk(b));
  assert(!tokenShapeOk("short") && !tokenShapeOk(undefined) && !tokenShapeOk(`${a}x`));
  assertEquals(linkBase("https://fame-fleet.pages.dev/, http://localhost:5173"), "https://fame-fleet.pages.dev");
  assertEquals(linkBase(""), "http://localhost:5173");
  assertEquals(setPasswordUrl("https://s.test", "abc"), "https://s.test/set-password#k=abc");
});

Deno.test("opening: a malformed token is unknown without asking the database; a valid one names the person, never the ids", async () => {
  const { db, calls } = fakeDb();
  assertEquals(await checkPasswordLink(db, "nope"), { state: "unknown" });
  assertEquals(calls.length, 0);
  assertEquals(await checkPasswordLink(db, newLinkToken()), { state: "valid", name: "Shashen Herath", email: "s@x.test" });
  assertEquals(calls[0].args.p_claim, false, "opening never claims");
});

Deno.test("the save: the rule first, then the claim, then Auth; audited without the password", async () => {
  const short = fakeDb();
  assertEquals((await usePasswordLink(short.db, newLinkToken(), "abc12")).ok, false);
  assertEquals(short.calls.length, 0, "a short password never touches the link");
  assertEquals(passwordProblem("x".repeat(73))?.error, "too_long");
  assertEquals(passwordProblem("A sentence of twelve"), null);

  const { db, calls, audits, passwords } = fakeDb();
  const answer = await usePasswordLink(db, newLinkToken(), "A long sentence here");
  assertEquals(answer, { ok: true, email: "s@x.test" });
  assertEquals(calls.map((c) => [c.fn, c.args.p_claim]), [["password_link_check", true]]);
  assertEquals(passwords, ["A long sentence here"]);
  assertEquals(audits.length, 1);
  assertEquals(audits[0].tool, "set_password_by_link");
  assertEquals(audits[0].actor_name, "Shashen Herath");
  assert(!JSON.stringify(audits).includes("A long sentence here"), "the password is never in the audit row");
});

Deno.test("the office password rule (Sahan, 29 October 2026): 6 characters at least, any characters, up to Auth's 72 bytes", () => {
  assertEquals(passwordProblem("abc12")?.error, "too_short");
  assertEquals(passwordProblem("abc123"), null, "6 is enough");
  assertEquals(passwordProblem("a b c!"), null, "spaces and symbols count, no forced kinds");
  assertEquals(passwordProblem("aaaaaa"), null, "letters only is allowed");
  assertEquals(passwordProblem("x".repeat(64)), null, "no maximum below 64");
  assertEquals(passwordProblem("x".repeat(72)), null);
  assertEquals(passwordProblem("මුරපදය"), null, "Sinhala counts letters, not UTF-16 units (6 code points)");
  assertEquals(passwordProblem("අආඇ")?.error, "too_short");
  assertEquals(passwordProblem("අ".repeat(25))?.error, "too_long", "25 Sinhala letters are 75 bytes");
});

Deno.test("a used, replaced or expired link: the state, Auth never asked; Auth's refusal gives the link back", async () => {
  for (const state of ["used", "replaced", "expired", "password_set", "switched_off"] as const) {
    const { db, passwords } = fakeDb({ state });
    assertEquals(await usePasswordLink(db, newLinkToken(), "A long sentence here"), { ok: false, state });
    assertEquals(passwords.length, 0);
  }
  const { db, calls, audits } = fakeDb({ authError: "Password is known to be weak" });
  assertEquals(await usePasswordLink(db, newLinkToken(), "password12345"), {
    ok: false,
    error: "refused",
    message: "Password is known to be weak",
  });
  assertEquals(calls.map((c) => c.fn), ["password_link_check", "password_link_release"]);
  assertEquals(calls[1].args.p_link, "l1");
  assertEquals(audits.length, 0);
});
