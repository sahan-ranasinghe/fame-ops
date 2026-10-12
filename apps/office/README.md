# Fame Fleet office app

One source, two builds (docs/office-web-plan.md, section 4):

| command | output | who uses it |
|---|---|---|
| `npm run build:web` | `dist/` (code-split) | the office web app on Cloudflare Pages: every person signs in with their own account, every call goes through `office-api` |
| `npm run build:artifact` | `dist-artifact/index.html` (one file) + `capabilities.json` | the Fame Fleet artifact in Claude: it uses the viewer's "Fame Fleet" connector, no key in the page; publish with the declaration in `capabilities.json` (connector name from `src/connector.json`, the tools the source calls) |

Both talk to the same tools through one `Transport` interface (`src/transport`):
`ApiTransport` (fetch `office-api` with the Supabase session) and `ClaudeTransport`
(`window.claude` → the connector). Same tool names, same arguments, same JSON.

## Run it locally

```bash
source ~/.nvm/nvm.sh && nvm use          # Node from .nvmrc
cd apps/office && npm install
cp .env.example .env.local               # fill in VITE_SUPABASE_ANON_KEY (the publishable key)
npm run dev                              # http://localhost:5173
npm run dev:live                         # the same against the REAL project (.env.live.local)
```

Against the local stack instead (`npx supabase start` + `npx supabase functions serve`),
`scripts/test-office-local.sh <env file>` writes `.env.local` for you and runs every check.

## Checks

```bash
npm run typecheck
npm test                 # Vitest: transport, form rules, Overview
npm run build:web && npm run build:artifact
npm run test:e2e         # Playwright, local stack only: scripts/test-office-local.sh does the set-up
```

## Layout

- `src/app` — the shell (rail, tab bar, banner), the routes, `ArtifactApp` and `WebApp`
- `src/auth` — sign-in, the set-password page (from a `create_office_user` link), the optional 2-step (TOTP: `TotpEnrol`, the code page)
- `src/transport` — the two transports and the error mapping
- `src/data` — the store (one entry per watched tool), result types, hooks
- `src/screens` — Overview, Live locations (list, map, detail, today's route), Tasks (board, assign, task drawer), Requests (list, decide, new), Vehicles, Drivers, Mileage, Maintenance, Projects, Accounts (admin), Settings (2-step on/off, web only), More
- `src/map` — `DrawnMap` (the artifact's SVG), `MapLibreMap` (web only, lazy), `MapView` picks one; `src/data/live.ts` + `realtime.ts` keep the markers live
- `src/styles.css` — the artifact's CSS, unchanged, plus the sign-in pages
