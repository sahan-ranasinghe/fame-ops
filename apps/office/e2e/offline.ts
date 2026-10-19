// The e2e never uses the internet (Sahan, 19 October 2026): the test browser resolves no host but this laptop (OFFLINE in
// playwright.config.ts). The free map's style (OpenFreeMap) is faked here, so the free map (MapLibre) runs as it does on the
// site, on the land colour with no tiles: its gap markers and plan pins are the ones the tests look at. Every context a test
// uses gets it: the default one and those a test opens itself with browser.newContext().
import { test as base, type BrowserContext } from "@playwright/test";

export { expect } from "@playwright/test";

/** The free map's style without the internet: the land colour, no sources, no tiles (the map draws only lines and pins). */
export const FAKE_STYLE = { version: 8, sources: {}, layers: [{ id: "land", type: "background", paint: { "background-color": "#e9e7e0" } }] };

/** OpenFreeMap answered from here: the style faked, anything else (tiles, sprites, fonts) empty. */
export async function fakeOutside(context: BrowserContext): Promise<void> {
  await context.route("https://tiles.openfreemap.org/**", (route) =>
    /\/styles\//.test(route.request().url()) ? route.fulfill({ json: FAKE_STYLE }) : route.fulfill({ status: 404, body: "" }));
}

export const test = base.extend({
  context: async ({ context }, use) => {
    await fakeOutside(context);
    await use(context);
  },
  browser: [async ({ browser }, use) => {
    // A context a test opens itself gets the same answers.
    const open = browser.newContext.bind(browser);
    browser.newContext = async (...args: Parameters<typeof open>) => {
      const context = await open(...args);
      await fakeOutside(context);
      return context;
    };
    await use(browser);
  }, { scope: "worker" }],
});
