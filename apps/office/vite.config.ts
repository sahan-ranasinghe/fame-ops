/// <reference types="vitest/config" />
// Two builds from one source (docs/office-web-plan.md, section 4):
//   vite build                  → dist/           the web app for Cloudflare Pages (code-split)
//   vite build --mode artifact  → dist-artifact/  one self-contained HTML file, the Fame Fleet artifact
import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

export default defineConfig(({ mode }) => {
  const artifact = mode === "artifact";
  return {
    plugins: [react(), ...(artifact ? [viteSingleFile({ removeViteModuleLoader: true })] : [])],
    define: {
      __BUILD__: JSON.stringify(artifact ? "artifact" : "web"),
      __VERSION__: JSON.stringify(pkg.version),
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
    },
  };
});
