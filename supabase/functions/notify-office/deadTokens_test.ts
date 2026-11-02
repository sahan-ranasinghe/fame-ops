// Round 53 (a): the dead phone tokens are removed through the database function, and a refusal is read, logged and handed
// back (until 31 October the functions deleted with service_role, which deletes nothing, and never read the error).
import { assertEquals } from "@std/assert";
import { removeDeadTokens, type RpcClient } from "../_shared/deadTokens.ts";

function fake(answer: { data: unknown; error: { message: string } | null } | Error) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const db: RpcClient = {
    rpc(fn, args) {
      calls.push({ fn, args });
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
  };
  return { db, calls };
}

Deno.test("dead tokens go through remove_dead_device_tokens with their ids", async () => {
  const { db, calls } = fake({ data: 2, error: null });
  assertEquals(await removeDeadTokens(db, ["a", "b"], "push-task"), { removed: 2 });
  assertEquals(calls, [{ fn: "remove_dead_device_tokens", args: { p_ids: ["a", "b"] } }]);
});

Deno.test("no dead token: the database is not asked", async () => {
  const { db, calls } = fake({ data: 0, error: null });
  assertEquals(await removeDeadTokens(db, [], "notify-office"), { removed: 0 });
  assertEquals(calls.length, 0);
});

Deno.test("a refusal is read and handed back for the push's own record, never thrown", async () => {
  const { db } = fake({ data: null, error: { message: "permission denied for table device_tokens" } });
  assertEquals(await removeDeadTokens(db, ["a"], "push-task"), {
    removed: 0,
    error: "remove_tokens: permission denied for table device_tokens",
  });
  const lost = fake(new Error("connection reset"));
  assertEquals(await removeDeadTokens(lost.db, ["a"], "notify-office"), { removed: 0, error: "remove_tokens: connection reset" });
});

Deno.test("neither function deletes a token with service_role again (it deletes nothing): both go through removeDeadTokens", () => {
  for (const file of ["../push-task/index.ts", "./index.ts"]) {
    const source = Deno.readTextFileSync(new URL(file, import.meta.url));
    assertEquals(/device_tokens["']\)\s*\.delete\(/.test(source), false, `${file} deletes device_tokens directly`);
    assertEquals(source.includes("removeDeadTokens("), true, `${file} uses removeDeadTokens`);
  }
});
