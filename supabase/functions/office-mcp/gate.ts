// The connector's door (Round 48, item 6b): who is calling, and how often.
//   unauth   20 a minute per address on the 404 path (a wrong or missing key, any other path): checked BEFORE the key
//            is looked up in the database, charged after the 404, so an address guessing keys costs at most 20 lookups
//            a minute; the answer is 429 with the one sentence
//   keys     120 a minute per key (the shared key as one, each personal key by its hash)
//   paid     30 a minute per key on the tools that can make a Google, openrouteservice or Gemini call (PAID_TOOLS),
//            answered as a tool error with the same sentence (server.ts asks paidGate)
// Nothing about the key is ever logged: the request URL carries it.

import { type Actor, PERMISSIONS } from "../_shared/fleet/index.ts";
import {
  clientIp,
  GENERAL_PER_MINUTE,
  PAID_PER_MINUTE,
  PAID_TOOLS,
  RATE_LIMITED,
  rateLimitedResponse,
  TokenBuckets,
  UNAUTH_PER_IP_PER_MINUTE,
} from "../_shared/fleet/rateLimit.ts";
import { isAuthorized, keyFromPath, sha256Hex } from "./key.ts";

export interface Limits {
  keys: TokenBuckets;
  paid: TokenBuckets;
  unauth: TokenBuckets;
}

export function defaultLimits(clock?: () => number): Limits {
  return {
    keys: new TokenBuckets({ capacity: GENERAL_PER_MINUTE }, clock),
    paid: new TokenBuckets({ capacity: PAID_PER_MINUTE }, clock),
    unauth: new TokenBuckets({ capacity: UNAUTH_PER_IP_PER_MINUTE }, clock),
  };
}

export interface GateDeps {
  /** The person behind a personal key (a database lookup), or null. */
  personForKey: (key: string) => Promise<Actor | null>;
  /** The shared OFFICE_MCP_KEY (the admin key), or undefined when not set. */
  sharedKey: string | undefined;
  limits: Limits;
}

export type Gated = { ok: true; actor: Actor; limitKey: string } | { ok: false; response: Response };

function notFound(): Response {
  return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
}

/** The actor for this request, or the answer that refuses it (404 or 429). */
export async function gateRequest(request: Request, deps: GateDeps): Promise<Gated> {
  const from = clientIp(request.headers);
  // An address refused 20 times this minute gets no lookup at all.
  if (!deps.limits.unauth.has(from)) return { ok: false, response: rateLimitedResponse() };
  const pathname = new URL(request.url).pathname;
  const key = keyFromPath(pathname);
  // A wrong key, a missing key and any other path all get the same 404.
  let actor: Actor | null = key ? await deps.personForKey(key) : null;
  let limitKey = key ? `key:${(await sha256Hex(key)).slice(0, 32)}` : "";
  if (!actor && (await isAuthorized(pathname, deps.sharedKey))) {
    actor = { employeeId: null, name: "Office (shared key)", role: "admin", permissions: [...PERMISSIONS], channel: "claude" };
    limitKey = "shared";
  }
  if (!actor) {
    deps.limits.unauth.charge(from);
    return { ok: false, response: notFound() };
  }
  if (!deps.limits.keys.take(limitKey)) return { ok: false, response: rateLimitedResponse() };
  return { ok: true, actor, limitKey };
}

/** The tool may run now, or the words the connector answers instead (the tools that can cost: 30 a minute per key). */
export function paidGate(
  tool: string,
  limits: Pick<Limits, "paid"> | undefined,
  limitKey: string,
): { ok: true } | { ok: false; text: string } {
  if (!limits || !PAID_TOOLS.has(tool) || limits.paid.take(limitKey)) return { ok: true };
  return { ok: false, text: RATE_LIMITED.message };
}
