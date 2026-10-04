# API performance workloads

These k6 scripts exercise the GraphQL API against a dedicated, disposable performance database. They do not create or delete database rows during the measurement: the list workload reads seeded issues, and the mutation workload updates one seeded issue per virtual user.

## Isolated local target

Run from the repository root. This example uses a separate PostgreSQL container on port `54321`, a separate database, and an API server on port `3001`; do not point it at a development or production database.

```sh
docker run -d --name velocity-perf-pg \
  -e POSTGRES_USER=velocity -e POSTGRES_PASSWORD=velocity \
  -e POSTGRES_DB=postgres -p 54321:5432 postgres:16-alpine
```

Create an empty benchmark database, then seed exactly 10,000 issues:

```sh
docker exec velocity-perf-pg psql -U velocity -d postgres \
  -c 'create database velocity_perf'
export DATABASE_URL=postgres://velocity:velocity@localhost:54321/velocity_perf
export APP_URL=http://localhost:3001
export APP_SECRET="$(openssl rand -hex 32)"
export UPLOAD_DIR=./data/perf-uploads EXPORT_DIR=./data/perf-exports
pnpm --filter @velocity/server seed -- --issues 10000
```

In one terminal, run the API server against that database:

```sh
PORT=3001 pnpm --filter @velocity/server dev
```

The seed command creates the demo owner (`demo` / `correct-horse-battery-staple`) only when the database is empty. For the simplest run, set `LOGIN` and `PASSWORD`; each script logs in once during k6 setup and reuses that session. Alternatively, supply a read key for the list test or a write key for the mutation test using `API_KEY`, or provide distinct keys using `API_KEYS` (comma-separated). Keys are assigned by VU in order and wrap if there are fewer keys than VUs. To get realistic independent API-key buckets, provision at least 25 distinct keys before the run.

Install k6 separately if needed, then run:

```sh
BASE_URL=http://127.0.0.1:3001 LOGIN=demo PASSWORD=correct-horse-battery-staple \
  k6 run scripts/perf/issues-list.js

BASE_URL=http://127.0.0.1:3001 LOGIN=demo PASSWORD=correct-horse-battery-staple \
  k6 run scripts/perf/mutation-storm.js
```

For API-key runs, replace `LOGIN` and `PASSWORD` with `API_KEYS='vel_key_for_vu_1,...'`.

Both workloads default to 25 VUs for 3 minutes. Override duration and concurrency with `DURATION` and `VUS`, for example `DURATION=5m VUS=25`. The issue-list workload enforces p95 below 150 ms along with response correctness and error-rate thresholds. The mutation workload checks successful GraphQL responses and verifies the returned issue ID, title, and priority; it also fails its threshold when GraphQL errors occur.

## Rate-limit behavior

The server defaults to 1,000 requests per minute and a burst of 50 per second per API key; authenticated sessions share a bucket per user. The limiter is in-process. The `LOGIN`/`PASSWORD` mode uses one session for all VUs, so it is a shared-user stress test. A single `API_KEY` is similarly shared. The scripts do not suppress or retry `429` responses; failures remain visible in k6 checks and thresholds.

For an API-capacity run that measures the server rather than the shared credential bucket, start the isolated perf server with elevated limits, then record those settings with the result:

```sh
RATE_LIMIT_PER_MINUTE=100000 RATE_LIMIT_BURST_PER_SECOND=10000 PORT=3001 \
  pnpm --filter @velocity/server dev
```

This intentionally removes the normal rate-limit constraint for the benchmark. For a rate-limit benchmark, use the defaults and interpret shared-session `429`s accordingly. The issue-list script validates at setup that the database has at least 10,000 total issues and 50 ENG issues; each measured request must return a full page of 50 matching issues. Its query exercises common status filtering and priority ordering.

The demo seed is intended for a fresh database. Running it again adds issues; create a new `velocity_perf` database for each clean run rather than reusing or truncating another database.
