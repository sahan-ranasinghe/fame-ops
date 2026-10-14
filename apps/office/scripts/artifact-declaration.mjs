// The capability declaration the Fame Fleet artifact is published with:
// the connector name from src/connector.json (the same constant the page
// calls with) and every connector tool the page's source calls. Written to
// dist-artifact/capabilities.json and printed, after `vite build --mode artifact`.
//
//   node scripts/artifact-declaration.mjs            # prints the JSON
//   node scripts/artifact-declaration.mjs --check    # exits 1 if the file on disk differs
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const connector = JSON.parse(readFileSync(join(root, "src/connector.json"), "utf8"));

// Every tool the connector offers: the ALL_TOOLS list in src/transport/types.ts, in the connector's order.
const typesSrc = readFileSync(join(root, "src/transport/types.ts"), "utf8");
const block = typesSrc.match(/export const ALL_TOOLS = \[([\s\S]*?)\];/);
if (!block) throw new Error("ALL_TOOLS not found in src/transport/types.ts");
const allTools = [...block[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);

// The tools the page's source names, as string literals, outside tests and the master list.
function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}
// Exactly what the artifact build calls. The Settings → Notifications route is bundled in the
// artifact too and loads the person's settings (my_notification_settings) before it says the rest
// is on the web app, so that tool is declared; the three actions behind the page's buttons (a
// toggle, the browser's push subscription on or off, a device removed) are reached only on the
// web, live in notificationsActions.ts and are left out, with the browser-side push.ts.
const WEB_ONLY = new Set(["src/screens/settings/notificationsActions.ts", "src/push.ts"]);
const used = new Set();
for (const file of files(join(root, "src"))) {
  const rel = relative(root, file);
  if (!/\.(ts|tsx)$/.test(rel) || /\.test\.(ts|tsx)$/.test(rel) || rel === "src/transport/types.ts" || WEB_ONLY.has(rel)) continue;
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(/"([a-z_]+)"/g)) if (allTools.includes(m[1])) used.add(m[1]);
}
const tools = allTools.filter((t) => used.has(t)); // in the connector's own order

const declaration = {
  mcp: { servers: [{ server: connector.server, tools }] },
  user: { scopes: ["profile"] },
};
const text = JSON.stringify(declaration, null, 2) + "\n";
const out = join(root, "dist-artifact/capabilities.json");

if (process.argv.includes("--check")) {
  const current = existsSync(out) ? readFileSync(out, "utf8") : "";
  if (current !== text) {
    console.error("dist-artifact/capabilities.json is out of date: run npm run build:artifact");
    process.exit(1);
  }
} else {
  mkdirSync(join(root, "dist-artifact"), { recursive: true });
  writeFileSync(out, text);
}
console.log(text);
