# CI: the office suite on GitHub (21 October 2026)

The full office suite runs on GitHub's machines, not on the laptop: `.github/workflows/office-suite.yml`. The laptop runs
only the fast checks while working and single failed tests; a checkpoint passes when this run passes.

## What runs

- **fast** (about 5 min): install, both typechecks, the hooks lint, the site's unit tests (4 workers), every driver
  script suite (`test:*` in `apps/driver`) but `test:data`, which needs the stack and runs in e2e.
- **e2e** (after fast): the Supabase CLI from the lockfile (2.120.0, as on the laptop) starts the local stack with the
  laptop's image versions (no newer images), without the dashboard, image resizing, logs and the pooler; a db reset; the
  functions served with throwaway keys made in the run; Playwright's Chromium; then `scripts/test-office-local.sh`, the same
  suite as on the laptop (one worker, one retry, zero hard failures) on the freshly reset database; then `test:data`; then `apps/office/scripts/deploy-pages.sh` without
  `--deploy` (both production builds, no source maps, the key and secret scan; nothing is uploaded).
- **Not run on CI:** pgTAP, Deno and the connector suite (`scripts/test-mcp-local.sh`). They run on the laptop, and the deploy
  gate (CLAUDE.md) still needs them.
- Always kept (7 days, also on failure): the artifact `office-suite-<run id>` with the Playwright report and traces, the
  functions log, the suite's output and `ci-summary.txt` (the durations, the load at the end, the CPU cut-offs, the minutes).

No repository secrets: every key is a throwaway made inside the run, the stack's keys are the CLI's local ones, and the
Google keys stay empty (the free map and the fallbacks). Every action is pinned to a commit SHA. The workflow can only read
the repo (`contents: read`).

## Starting a run

It runs by itself, in full, on every push to `main`, unless the push changes only `docs/**` or `*.md` files in any folder
(2 November 2026; one other file in the push and it runs in full). Any branch, by hand; the scope is always chosen (31 October 2026):

| Scope | Runs | When |
|---|---|---|
| `full` | fast + the whole e2e job | a checkpoint, and when Sahan asks |
| `specs` | fast + only the spec files or titles named | a fix that touches only tests |
| `fast` | the fast job only | a change to docs only |

`specs` starts the same stack on a fresh database and leaves out what the fast job already did (the typecheck, the unit
tests), the builds, `test:data` and the key scan, and the mobile website's build unless a named spec needs it (mobile,
contrast, mockups, or a title alone). A green `specs` run is not a checkpoint: it says "The named tests passed (not the whole
suite)." A spec that relies on data left by an earlier spec fails alone: fix the spec.

```
gh workflow run office-suite.yml --ref <branch> -f scope=full
gh workflow run office-suite.yml --ref <branch> -f scope=specs -f specs="e2e/bin.spec.ts e2e/mobile.spec.ts"
gh workflow run office-suite.yml --ref <branch> -f scope=specs -f grep="a requester on a phone"
gh workflow run office-suite.yml --ref <branch> -f scope=fast
gh run list --workflow office-suite.yml --limit 3      # the run's id
gh run watch <run id> --exit-status                     # follow it; exit code 1 when it fails
```

or GitHub → the repo → Actions → office-suite → Run workflow → pick the branch and the scope. A newer run on the same branch cancels the
older one. If the laptop's connection drops, the run goes on: `gh run view <run id>` later.

## Reading the result

- `gh run view <run id>`: each job and step, pass or fail; `gh run view <run id> --log-failed` for the failing step's log.
- The e2e job's summary ends with the minutes; `ci-summary.txt` in the artifact lists the failed (✘) and flaky tests.
- `gh run download <run id>` fetches the artifact; `npx playwright show-report <folder>/playwright-report` opens the report.
- The gate is the laptop's: zero hard failures; a test that passes on its retry is flaky and is listed with the functions
  log's CPU cut-offs.

## The minutes budget

A private repo gets 2,000 free minutes a month on GitHub's Linux machines, reset on the 1st at 00:00 UTC (05:30 Colombo); each
job is billed rounded up to the minute. A full run is about 36 minutes (fast 5, e2e about 31). Runs start only by hand and on
pushes to `main`, never on every branch push. These minutes are on Sahan's personal GitHub account (docs/handover.md).

When they run out, GitHub refuses within seconds and no step runs; the annotation says "recent account payments have failed or
your spending limit needs to be increased" (30 October 2026: 74 runs, about 2,027 minutes).

- The target is one full run per checkpoint. Before running CI again after a failure, run the failed spec locally if it is
  quick: with the stack and the functions up, `E2E_SPECS="e2e/x.spec.ts" scripts/test-office-local.sh <env file>`.
- `python3 scripts/ci-minutes.py` adds up this month's minutes from the run durations and warns at 1,500; its line goes in every
  checkpoint report. GitHub → Settings → Billing has the exact figure.

## The repo stays private

The suite's logs and artifacts are readable by anyone who can read the repo. The repo must stay private
(`gh repo view sahan-ranasinghe/fame-ops --json visibility` answers PRIVATE).
