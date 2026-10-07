# TesterArmy e2e pilot

This directory is Velocity's semantic, agent-driven browser test layer. The deterministic Playwright regression suite remains in `../e2e/` and continues to run through `test:e2e`.

## Prerequisites

- Node 24.8+ or Node 22.22.3+.
- PostgreSQL on the normal local test port (`54320`).
- A current production web build: `pnpm --filter @velocity/web build`.

The runner reuses `e2e/support/server.mjs`, so every run gets the real API, built SPA, production CSP, and a disposable Playwright-style database. It defaults to `E2E_SLOT=9` (`http://localhost:3290`, `velocity_e2e_web_9`); set `E2E_SLOT=1..9` to choose another isolated slot.

## Deterministic smoke test

No model or Velocity credential is needed:

```sh
pnpm --filter @velocity/web exec e2e run agent-e2e/smoke.e2e.ts
```

## Semantic issue journey

Sign in to the configured ChatGPT subscription once:

```sh
pnpm --filter @velocity/web exec e2e login openai
```

Then provide a disposable local Velocity owner password through TesterArmy's supported credential variable and run the journey:

```sh
E2E_USER_VELOCITY_OWNER_PASSWORD='<local-test-password>' \
  pnpm --filter @velocity/web exec e2e run agent-e2e/issue-lifecycle.e2e.ts
```

`E2E_USER_VELOCITY_OWNER_USERNAME` can override the non-secret default username. `AGENT_E2E_MODEL` can select another model exposed by the saved ChatGPT login. TesterArmy does not load `.env`; export variables in the invoking shell.

The setup test creates the owner and saves a per-run encrypted `velocity-owner` session. Session files and generated reports stay under `.e2e/` and are ignored. The replay cache is also local-only for this pilot; do not edit recordings by hand.

## Fresh-install onboarding journey

The onboarding test runs alone through `onboarding.e2e.config.ts`, without the normal owner-session setup. Its server harness recreates the dedicated local database `velocity_e2e_web_onboarding` on each run and uses slot 8 (`http://localhost:3280`). The owner password is randomly generated for that runner process and passed through TesterArmy's credential API; it is never stored in the test or reused as a login. Its recordings live in `.e2e/onboarding-cache/`, separate from the normal semantic suite's cache.

Run the live-agent journey with `--no-cache`, then run normally twice to record and replay the verified actions:

```sh
pnpm --filter @velocity/web exec e2e run --config onboarding.e2e.config.ts --no-cache --debug
pnpm --filter @velocity/web exec e2e run --config onboarding.e2e.config.ts --debug
pnpm --filter @velocity/web exec e2e run --config onboarding.e2e.config.ts --debug
```

The test starts at first-owner setup and asks the agent to set up the installation, create its first Engineering issue, and open it. Each goal is followed by exact UI and route checks. Reports include model and cache totals; use `--debug` on the live run to inspect calls per goal and hesitation/backtracking.

For diagnostics, add `--reporter list,markdown`, `--debug`, or `--no-cache`. See `.e2e/report.json`, `.e2e/summary.md`, and `.e2e/failures/` after a run.
