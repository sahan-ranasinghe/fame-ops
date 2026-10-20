/// <reference types="vitest/config" />
// Two builds from one source (docs/office-web-plan.md, section 4):
//   vite build                  → dist/           the web app for Cloudflare Pages (code-split)
//   vite build --mode artifact  → dist-artifact/  one self-contained HTML file, the Fame Fleet artifact
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

/** The web build is an installable app: the manifest, the theme colour and the icons (public/). The artifact gets none of it. */
const pwaTags = (): Plugin => ({
  name: "fame-pwa-tags",
  transformIndexHtml: {
    order: "pre",
    handler: (html) => ({
      html,
      tags: [
        { tag: "link", attrs: { rel: "manifest", href: "/manifest.webmanifest" }, injectTo: "head" },
        { tag: "meta", attrs: { name: "theme-color", content: "#15181c" }, injectTo: "head" },
        { tag: "link", attrs: { rel: "icon", type: "image/png", href: "/icons/icon-192.png" }, injectTo: "head" },
        { tag: "link", attrs: { rel: "apple-touch-icon", href: "/icons/apple-touch-icon.png" }, injectTo: "head" },
      ],
    }),
  },
});

/**
 * The fonts (Sahan, 19 October 2026). The web build serves its own (public/fonts, scripts/fetch-fonts.mjs): no page waits
 * on fonts.googleapis.com and no browser contacts Google for fonts. The artifact runs on claude.ai, which cannot reach the
 * site's files and allows Google Fonts' stylesheets: it keeps the link it always had.
 */
const fontTags = (artifact: boolean): Plugin => ({
  name: "fame-font-tags",
  transformIndexHtml: {
    order: "pre",
    handler: (html) => ({
      html,
      tags: artifact
        ? [
          { tag: "link", attrs: { rel: "preconnect", href: "https://fonts.googleapis.com" }, injectTo: "head" },
          { tag: "link", attrs: { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: true }, injectTo: "head" },
          { tag: "link", attrs: { rel: "stylesheet", href: GOOGLE_FONTS }, injectTo: "head" },
        ]
        : [
          // The body font's Latin file first (one file holds every weight): text appears in it, not in a stand-in.
          { tag: "link", attrs: { rel: "preload", href: "/fonts/ibm-plex-sans-400-latin.woff2", as: "font", type: "font/woff2", crossorigin: true }, injectTo: "head" },
          { tag: "link", attrs: { rel: "stylesheet", href: "/fonts/fonts.css" }, injectTo: "head" },
        ],
    }),
  },
});
const GOOGLE_FONTS =
  "https://fonts.googleapis.com/css2?family=Archivo:wght@700;800&family=IBM+Plex+Mono:wght@500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap";

export default defineConfig(({ mode }) => {
  const artifact = mode === "artifact";
  return {
    plugins: [react(), fontTags(artifact), ...(artifact ? [viteSingleFile({ removeViteModuleLoader: true })] : [pwaTags()])],
    define: {
      __BUILD__: JSON.stringify(artifact ? "artifact" : "web"),
      __VERSION__: JSON.stringify(pkg.version),
    },
    resolve: {
      alias: {
        // The one status rule, shared with the connector (no copy): supabase/functions/_shared/fleet/status.ts
        "@fleet/status": fileURLToPath(new URL("../../supabase/functions/_shared/fleet/status.ts", import.meta.url)),
        // The route builder and the GPS drift filter it uses, the same files the connector runs.
        "@fleet/route": fileURLToPath(new URL("../../supabase/functions/_shared/fleet/route.ts", import.meta.url)),
        "@fleet/track": fileURLToPath(new URL("../../supabase/functions/_shared/fleet/track.ts", import.meta.url)),
        // The permission table (tool → permission, presets): the menu can never disagree with the server.
        "@fleet/permissions": fileURLToPath(new URL("../../supabase/functions/_shared/fleet/permissions.ts", import.meta.url)),
        "@fleet/polyline": fileURLToPath(new URL("../../supabase/functions/_shared/fleet/polyline.ts", import.meta.url)),
        // "Kamal's vehicle today", or the full name when two drivers share a first name: as the connector says it.
        "@fleet/names": fileURLToPath(new URL("../../supabase/functions/_shared/fleet/names.ts", import.meta.url)),
        // The site-list presets (Part 4): the import page reads the spreadsheet in the browser with the same rules Deno tests.
        "@fleet/sites": fileURLToPath(new URL("../../supabase/functions/_shared/fleet/sites.ts", import.meta.url)),
        // Hotfix 2 (D): one way to say how long and when ("in 45 min", "tomorrow 09:00"), the words the connector uses.
        "@fleet/durations": fileURLToPath(new URL("../../supabase/functions/_shared/fleet/durations.ts", import.meta.url)),
        // Hotfix 3 (L3): the list tools' cursors (page numbers make one with cursorAt).
        "@fleet/paging": fileURLToPath(new URL("../../supabase/functions/_shared/fleet/paging.ts", import.meta.url)),
      },
    },
    build: {
      outDir: artifact ? "dist-artifact" : "dist",
      target: "es2022",
      // No source maps in either build (20 October 2026): a published map carries the libraries' source, and the site needs
      // none (the artifact never had them). If the site gets crash reporting, maps go up privately, never with the build.
      sourcemap: false,
      emptyOutDir: true,
    },
    server: { port: 5173, strictPort: true },
    preview: { port: 4173, strictPort: true },
    test: {
      environment: "jsdom",
      include: ["src/**/*.test.{ts,tsx}"],
      setupFiles: ["src/test/setup.ts"],
      // The page tests import whole screens: under the full suite's load the first one in a file can pass 5 s.
      testTimeout: 15_000,
    },
  };
});
