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
- Always kept (7 days, also on failure): the artifact `office-suite-<run id>` with the Playwright report and traces, the
  functions log, the suite's output and `ci-summary.txt` (the durations, the load at the end, the CPU cut-offs, the minutes).

No repository secrets: every key is a throwaway made inside the run, the stack's keys are the CLI's local ones, and the
Google keys stay empty (the free map and the fallbacks). Every action is pinned to a commit SHA. The workflow can only read
the repo (`contents: read`).

## Starting a run

It runs by itself on every push to `main`. Any branch, by hand:

```
gh workflow run office-suite.yml --ref <branch>
gh run list --workflow office-suite.yml --limit 3      # the run's id
gh run watch <run id> --exit-status                     # follow it; exit code 1 when it fails
```

or GitHub → the repo → Actions → office-suite → Run workflow → pick the branch. A newer run on the same branch cancels the
older one. If the laptop's connection drops, the run goes on: `gh run view <run id>` later.

## Reading the result

- `gh run view <run id>`: each job and step, pass or fail; `gh run view <run id> --log-failed` for the failing step's log.
- The e2e job's summary ends with the minutes; `ci-summary.txt` in the artifact lists the failed (✘) and flaky tests.
- `gh run download <run id>` fetches the artifact; `npx playwright show-report <folder>/playwright-report` opens the report.
- The gate is the laptop's: zero hard failures; a test that passes on its retry is flaky and is listed with the functions
  log's CPU cut-offs.

## The minutes budget

A private repo gets 2,000 free minutes a month on GitHub's Linux machines; each job is billed rounded up to the minute. A
run is about 5 minutes (fast) plus the e2e job (its first runs measure it; the summary prints both). Runs start only by
hand and on pushes to `main`, never on every branch push. Check the month's use on GitHub → Settings → Billing.

## The repo stays private

The suite's logs and artifacts are readable by anyone who can read the repo. The repo must stay private
(`gh repo view sahan-ranasinghe/fame-ops --json visibility` answers PRIVATE).
