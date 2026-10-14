// Renders the Fame Fleet mark (the amber square with FF, as the app's header
// shows it) into the PWA icons with the Chromium the e2e already uses. No image
// library, nothing downloaded. Run from apps/office:
//   PW_CHROMIUM=/snap/bin/chromium node scripts/make-icons.mjs
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const AMBER = "#f2a900";
const INK = "#15181c";
const out = new URL("../public/icons/", import.meta.url);
mkdirSync(out, { recursive: true });

// name, size, kind: plain (rounded square), maskable (full bleed, FF inside the safe zone), badge (white FF on nothing)
const icons = [
  ["icon-192.png", 192, "plain"],
  ["icon-512.png", 512, "plain"],
  ["maskable-512.png", 512, "maskable"],
  ["apple-touch-icon.png", 180, "maskable"],
  ["badge-96.png", 96, "badge"],
];

function html(size, kind) {
  const radius = kind === "plain" ? Math.round(size * 0.22) : 0;
  const font = Math.round(size * (kind === "maskable" ? 0.36 : 0.44));
  const bg = kind === "badge" ? "transparent" : AMBER;
  const ink = kind === "badge" ? "#ffffff" : INK;
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@800&display=swap">
<style>
html,body{margin:0;background:transparent}
.m{width:${size}px;height:${size}px;border-radius:${radius}px;background:${bg};display:grid;place-items:center;
   font:800 ${font}px/1 Archivo,"IBM Plex Sans","DejaVu Sans",sans-serif;color:${ink};letter-spacing:-0.04em}
</style></head><body><div class="m">FF</div></body></html>`;
}

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const page = await browser.newPage();
for (const [name, size, kind] of icons) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(html(size, kind), { waitUntil: "networkidle" }).catch(() => page.setContent(html(size, kind)));
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: new URL(name, out).pathname, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  console.log(`${name} (${size}px, ${kind})`);
}
await browser.close();
