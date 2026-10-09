// The connector URL is /office-mcp/<KEY>/mcp. The key is the only thing that
// protects the connector, so the check is strict and gives nothing away:
// any other path, a missing key and a wrong key all look the same (404).

const MIN_KEY_LENGTH = 32;
const encoder = new TextEncoder();

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
}

/** The hash stored for a personal key (office_keys.key_hash). */
export async function sha256Hex(text: string): Promise<string> {
  return [...(await sha256(text))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Constant-time comparison. Both sides are hashed first, so the loop always
 * runs over 32 bytes: its timing shows neither where the keys differ nor how
 * long the real key is.
 */
export async function sameKey(given: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256(given), sha256(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** The <KEY> part of /office-mcp/<KEY>/mcp, or null for any other path. */
export function keyFromPath(pathname: string): string | null {
  const parts = pathname.split("/").filter((part) => part !== "");
  const at = parts.indexOf("office-mcp");
  if (at === -1 || parts.length !== at + 3 || parts[at + 2] !== "mcp") return null;
  try {
    return decodeURIComponent(parts[at + 1]);
  } catch {
    return null;
  }
}

/** True only when OFFICE_MCP_KEY is set, long enough, and the path carries it. */
export async function isAuthorized(pathname: string, expected: string | undefined): Promise<boolean> {
  const given = keyFromPath(pathname);
  // Compare even when something is missing, so every refusal takes the same time.
  const matches = await sameKey(given ?? "", expected ?? "");
  return matches && given !== null && expected !== undefined && expected.length >= MIN_KEY_LENGTH;
}
