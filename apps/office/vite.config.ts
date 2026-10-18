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

export default defineConfig(({ mode }) => {
  const artifact = mode === "artifact";
  return {
    plugins: [react(), ...(artifact ? [viteSingleFile({ removeViteModuleLoader: true })] : [pwaTags()])],
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
      },
    },
    build: {
      outDir: artifact ? "dist-artifact" : "dist",
      target: "es2022",
      sourcemap: !artifact,
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
