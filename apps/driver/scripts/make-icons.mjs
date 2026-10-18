// Renders the Fame Fleet mark (the amber square with FF in ink, as the sign-in screen of design/office shows it and as the
// office site's icons are made: apps/office/scripts/make-icons.mjs) into the app's icon, adaptive icon, splash and
// notification icon, and the store's icon and feature graphic (Part 6, 1.3.0). The font is the app's own Archivo
// ExtraBold from node_modules; the browser is the e2e's Chromium (Playwright from apps/office). Nothing is downloaded.
// Run from the repo root:
//   PW_CHROMIUM=/snap/bin/chromium node apps/driver/scripts/make-icons.mjs
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const AMBER = '#f2a900';
const INK = '#15181c';
const app = new URL('../', import.meta.url);
const { chromium } = createRequire(new URL('../../office/package.json', import.meta.url))('@playwright/test');
const font = readFileSync(new URL('node_modules/@expo-google-fonts/archivo/800ExtraBold/Archivo_800ExtraBold.ttf', app)).toString('base64');

// file, width, height, what:
//   full      the mark to the edges (the launcher and the stores cut their own shape)
//   adaptive  FF alone inside Android's safe zone (the background colour is app.json's adaptiveIcon.backgroundColor)
//   mono      FF alone, white, the same size (Android 13's themed icons and the notification icon use only its shape)
//   rounded   the mark as the sign-in screen shows it, on nothing (the splash puts it on ink)
//   feature   the Play Store's feature graphic: the mark and the name on ink
const images = [
  ['assets/icon.png', 1024, 1024, 'full'],
  ['assets/android-icon-foreground.png', 1024, 1024, 'adaptive'],
  ['assets/android-icon-monochrome.png', 1024, 1024, 'mono'],
  ['assets/splash-icon.png', 1024, 1024, 'rounded'],
  ['assets/notification-icon.png', 96, 96, 'mono'],
  ['store/play-icon-512.png', 512, 512, 'full'],
  ['store/feature-graphic.png', 1024, 500, 'feature'],
];

function html(w, h, what) {
  const face = `@font-face{font-family:Mark;src:url(data:font/ttf;base64,${font}) format('truetype');font-weight:800}`;
  const ff = (size, color) => `<div style="font:800 ${size}px/1 Mark;color:${color};letter-spacing:-0.04em">FF</div>`;
  const box = (bg, radius, inner) =>
    `<div style="width:${w}px;height:${h}px;border-radius:${radius}px;background:${bg};display:grid;place-items:center">${inner}</div>`;
  let body;
  if (what === 'full') body = box(AMBER, 0, ff(Math.round(w * 0.42), INK));
  else if (what === 'adaptive') body = box('transparent', 0, ff(Math.round(w * 0.34), INK));
  else if (what === 'mono') body = box('transparent', 0, ff(Math.round(w * (w < 200 ? 0.5 : 0.34)), '#ffffff'));
  else if (what === 'rounded') body = box(AMBER, Math.round(w * 0.22), ff(Math.round(w * 0.42), INK));
  else {
    const mark = 260;
    body = `<div style="width:${w}px;height:${h}px;background:${INK};display:flex;align-items:center;gap:56px;padding-left:110px;box-sizing:border-box">
      <div style="width:${mark}px;height:${mark}px;border-radius:${Math.round(mark * 0.22)}px;background:${AMBER};display:grid;place-items:center;flex:none">${ff(Math.round(mark * 0.42), INK)}</div>
      <div><div style="font:800 96px/1 Mark;color:#ffffff;letter-spacing:-0.02em">Fame Fleet</div>
      <div style="font:800 34px/1.3 Mark;color:${AMBER};margin-top:22px">Fame Global Solutions</div></div></div>`;
  }
  return `<!doctype html><html><head><meta charset="utf-8"><style>${face}html,body{margin:0;background:transparent}</style></head><body>${body}</body></html>`;
}

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const page = await browser.newPage();
for (const [file, w, h, what] of images) {
  const out = new URL(file, app);
  mkdirSync(new URL('.', out), { recursive: true });
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(html(w, h, what));
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: out.pathname, omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } });
  console.log(`${file} (${w}×${h}, ${what})`);
}
await browser.close();
