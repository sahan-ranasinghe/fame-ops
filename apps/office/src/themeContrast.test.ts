// The theme's colours, light and dark (Round 2b, 21 October 2026): every text colour on the surface it is drawn on reaches
// WCAG AA in both themes, the two dark blocks (the system's dark and data-theme="dark") are the same, and no colour is
// written outside the token blocks. The e2e's axe check (e2e/contrast.spec.ts) measures the screens; this covers what axe
// cannot measure: SVG text (axe reads an element's CSS colour, not its fill: the clock's numbers, the drawn map's labels).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "styles.css"), "utf8");

function tokens(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--([a-z0-9-]+):\s*([^;}]+)/g)) out[m[1]] = m[2].trim();
  return out;
}
const lightBlock = css.match(/^:root \{([\s\S]*?)\n\}/m)![1];
const systemDark = css.match(/@media \(prefers-color-scheme: dark\) \{ :root:not\(\[data-theme="light"\]\) \{([\s\S]*?)\} \}/)![1];
const forcedDark = css.match(/:root\[data-theme="dark"\] \{([\s\S]*?)\}/)![1];
const light = tokens(lightBlock);
const dark = { ...light, ...tokens(forcedDark) };

const rgb = (hex: string) => {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
};
const lum = (hex: string) => {
  const [r, g, b] = rgb(hex).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

/** [text, surface] pairs the screens draw, each needing 4.5 : 1 (normal text). */
const PAIRS: [string, string][] = [
  ...["ink", "muted"].flatMap((fg) => ["bg", "surface", "surface-2"].map((bg) => [fg, bg] as [string, string])),
  ["live", "live-bg"], ["live", "surface"], ["live", "bg"], ["warn", "warn-bg"], ["warn", "surface"], ["bad", "bad-bg"], ["bad", "surface"],
  ["ok", "ok-bg"], ["ok", "surface"], ["ok", "surface-2"], ["accent-ink", "accent"], ["rail-ink", "rail"], ["rail-muted", "rail"],
  // Filled marks with the surface colour on them: a picked day, the clock's picked number, a dark button, a stop's number, a tab's count.
  ["surface", "live"], ["surface", "ink"], ["surface", "bad"],
  // The toast (an inverse surface) and its action.
  ["inverse-ink", "inverse-bg"], ["inverse-accent", "inverse-bg"],
  // Pins on the map (each theme its own: the map follows the theme, C §33.12).
  ["map-pin-ink", "map-pin"], ["map-pin-ink", "map-pin-late"], ["map-pin-ink", "map-gap"],
];

describe("the theme's colours", () => {
  for (const [name, t] of [["light", light], ["dark", dark]] as const) {
    it(`every text colour reaches 4.5 : 1 on its surface (${name})`, () => {
      const low = PAIRS.map(([fg, bg]) => ({ fg, bg, r: ratio(t[fg], t[bg]) })).filter((p) => !(p.r >= 4.5));
      expect(low.map((p) => `${p.fg} on ${p.bg}: ${p.r.toFixed(2)}`)).toEqual([]);
    });
  }

  // C (Round 4–7, §33.12): the map follows the page's theme (Round 3 A3's "every map stays light" is replaced): the map block
  // sets no colour of its own, and each theme has its own pins (the pairs above check them on both).
  it("every map follows the theme: the map block sets no colour token and no colour scheme of its own", () => {
    const mapBlock = css.match(/^\.mapbox, \.pinmap \{([^}]*)\}/m);
    expect(mapBlock).not.toBeNull();
    expect(tokens(mapBlock![1])).toEqual({});
    expect(mapBlock![1]).not.toMatch(/color-scheme/);
    expect(css).not.toMatch(/\.mapbox[^{]*\{[^}]*color-scheme: light/);
  });

  it("the dark theme has its own map pins (light pins with dark numbers on the dark map)", () => {
    for (const k of ["map-pin", "map-pin-ink", "map-pin-late", "map-gap"]) {
      expect(tokens(forcedDark)[k], k).toBeTruthy();
      expect(tokens(forcedDark)[k], k).not.toBe(light[k]);
    }
  });

  it("the system's dark theme and data-theme=\"dark\" are the same colours", () => {
    expect(tokens(systemDark)).toEqual(tokens(forcedDark));
  });

  it("no colour is written outside the token blocks (shadows aside)", () => {
    const rules = css.slice(css.lastIndexOf(forcedDark) + forcedDark.length);
    const hex = rules.split("\n").map((l, i) => [i, l] as const).filter(([, l]) => /#[0-9a-fA-F]{3,8}\b/.test(l.replace(/#toast\b/g, "")));
    expect(hex.map(([, l]) => l.slice(0, 120))).toEqual([]);
    // Every token a rule uses is defined.
    const used = new Set([...rules.matchAll(/var\(--([a-z0-9-]+)/g)].map((m) => m[1]));
    const missing = [...used].filter((v) => !(v in light) && !/^font-/.test(v) && !(v in tokens(rules)));
    expect(missing).toEqual([]);
  });
});
