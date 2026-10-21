// Round 1 (21 October 2026, the boss's rule): no internal text is ever shown to a person: no keys (office.status.Sent),
// enum or code names (in_progress, fleet_admin, not_on_duty), ids, JSON or HTTP codes. The app's twin is
// apps/driver/tests/noInternalText.test.tsx. Every render test of the site runs this check on what is on the screen
// when the test ends (src/test/setup.ts), so a leak fails the test that shows it.

/** Text that is a person's words even if it looks technical: e-mails, links, plates and numbers are stripped first. */
function visibleWords(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, " ") // e-mails
    .replace(/https?:\/\/\S+|\/[\w/?=&.:-]+/g, " ") // links and paths
    .replace(/\b\w+\.(?:jpg|jpeg|png|pdf|mp4|xlsx|csv)\b/gi, " "); // file names
}

const SHAPES: [RegExp, string][] = [
  [/\b[a-z]+_[a-z_]+\b/, "an enum or code name"],
  [/\b[a-z][a-z]+[A-Z]?\w*\.[a-z][A-Za-z]+\.[A-Za-z_]\w*\b/, "a translation key"],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i, "an id"],
  [/\{"\w+":/, "JSON"],
  [/\bHTTP [45]\d\d\b/, "an HTTP code"],
  [/\b(?:undefined|NaN|\[object Object\])\b/, "a programming word"],
];

/** The first internal-looking piece of a text, with what it looks like; null when the text is clean. */
export function internalText(text: string): { match: string; kind: string } | null {
  const words = visibleWords(text);
  for (const [re, kind] of SHAPES) {
    const m = words.match(re);
    if (m) return { match: m[0], kind };
  }
  return null;
}
