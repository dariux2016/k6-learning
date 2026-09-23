# k6 Learning Plan

A hands-on, progressive project for learning [k6](https://k6.io) performance testing —
from a single-request smoke test to a full multi-scenario load test suite wired into CI/CD.

Each module below is a numbered step. Work through them in order: every module adds one new
k6 concept on top of a small, runnable example, plus exercises to practice it yourself before
moving on. By the end you'll be able to design k6 tests and scenarios from scratch and run them
automatically in a pipeline.

## How this repo will be organized

```
k6-learning/
├── PLAN.md                      # this file
├── README.md                    # quick start / how to run things
├── target-app/                  # tiny local HTTP API we load-test against
│   └── ...                      # (Node/Express or Python/FastAPI, see Module 0)
├── tests/
│   ├── 01-smoke/
│   ├── 02-http-basics/
│   ├── 03-checks-thresholds/
│   ├── 04-stages-load-profiles/
│   ├── 05-scenarios/
│   ├── 06-data-parameterization/
│   ├── 07-modularization/
│   ├── 08-custom-metrics/
│   ├── 09-browser-testing/
│   ├── 10-auth-session/
│   ├── 11-websockets-grpc/
│   ├── 12-soak-stress-spike/
│   └── 13-capstone/
├── data/                         # CSV/JSON test data for parameterization
├── libs/                         # shared JS helper modules imported across tests
├── docker-compose.yml            # target app + k6 + InfluxDB/Grafana for local runs
├── .github/workflows/k6.yml      # CI pipeline running k6 tests on push/PR
└── docs/
    └── notes/                    # your own running notes per module (optional)
```

We build a disposable local "target app" (a couple of REST endpoints with an in-memory store,
login, and artificial latency) so every test is runnable offline with no external dependencies
and no risk of hammering a real service.

---

## Module 0 — Environment setup ✅

> **Done.** k6 v2.2.0 installed, `target-app/` built, `docker-compose.yml` and the first
> smoke test in place. Walkthrough: [tests/00-setup/README.md](tests/00-setup/README.md).

**Goal:** get k6 installed and a target app running so every later module has something to test against.

- Install k6 (brew / apt / Docker / binary) and verify with `k6 version`.
- Scaffold `target-app/`: a minimal Node+Express (or Python+FastAPI) API with:
  - `GET /` health check
  - `GET /products`, `GET /products/:id`
  - `POST /login` returning a fake JWT
  - `POST /cart`, `GET /cart/:id` (stateful-ish, to motivate correlation later)
  - one endpoint with configurable artificial delay/error rate (env vars) so later modules
    can produce failures and slow responses on demand
- `docker-compose.yml` to run the target app (and later Grafana/InfluxDB) with one command.
- Write `README.md` "Quick start": `docker compose up`, `k6 run tests/01-smoke/smoke.js`.

**Exercise:** run k6 against `https://test.k6.io` (k6's public test site) with zero setup to
confirm the binary works before touching the local app.

---

## Module 1 — Your first script: anatomy of a k6 test ✅

> **Done.** Walkthrough: [tests/01-smoke/README.md](tests/01-smoke/README.md).

**Goal:** understand `default function`, VUs, and iterations.

- `tests/01-smoke/smoke.js`: single `http.get()` call, 1 VU, 1 iteration.
- Explain the k6 test lifecycle: `init` code (runs once per VU) vs `default function` (runs per iteration).
- Run with `k6 run smoke.js`, then override via CLI flags: `--vus 5 --duration 10s`.
- Read the end-of-test summary output line by line (http_req_duration, http_reqs, vus, iterations).

**Concepts:** init vs VU code, `default function`, CLI overrides, summary output.

**Exercise:** write a smoke test for a public API of your choice with 1 VU / 1 iteration.

---

## Module 2 — HTTP basics ✅

> **Done.** Walkthrough: [tests/02-http-basics/README.md](tests/02-http-basics/README.md).

**Goal:** cover the full HTTP toolkit: verbs, headers, payloads, responses.

- GET, POST (JSON body), PUT, DELETE against `target-app`.
- Setting headers (`Content-Type`, `Authorization`).
- Reading response: `res.status`, `res.body`, `res.json()`, `res.headers`, `res.timings`.
- `sleep()` to simulate think time between requests.
- Tags on requests (`{ tags: { name: 'get_products' } }`) for grouping metrics later.

**Concepts:** `http.get/post/put/del`, request params object, response object, `sleep`.

**Exercise:** script a "browse products" flow: list products → fetch one product detail → sleep.

---

## Module 3 — Checks and thresholds ✅

> **Done.** Walkthrough: [tests/03-checks-thresholds/README.md](tests/03-checks-thresholds/README.md).

**Goal:** move from "did it run" to "did it pass."

- `check()` for functional assertions (status 200, body contains field, response time < X)
  — checks never fail the test run by themselves, they just record pass/fail.
- `thresholds` in `options` to turn metrics into pass/fail criteria for the whole test
  (e.g. `http_req_duration: ['p(95)<500']`, `checks: ['rate>0.99']`).
- Difference between checks (per-request) and thresholds (aggregate, gate CI exit code).
- Non-zero exit code behavior — this is the hook CI/CD will use later.

**Concepts:** `check`, `options.thresholds`, abort-on-fail thresholds, exit codes.

**Exercise:** add thresholds that fail on purpose (too strict), observe the non-zero exit code,
then fix them to realistic values.

---

## Module 4 — Load profiles with stages

**Goal:** shape traffic over time instead of a flat constant VU count.

- `options.stages`: ramp-up, plateau, ramp-down.
- Visualize what a stage graph looks like (ASCII diagram in the module README).
- Difference between iteration-based and duration-based execution.
- Introduce `executor` conceptually as a preview of Module 5.

**Concepts:** `stages`, ramping VUs, `gracefulRampDown`, `gracefulStop`.

**Exercise:** design stages for a "typical Tuesday" pattern (low → peak lunch traffic → low)
and one for a flash-sale spike.

---

## Module 5 — Scenarios and executors

**Goal:** the core k6 abstraction for real-world test design — multiple named scenarios,
each with its own executor, running independently or concurrently.

- `options.scenarios` replacing top-level `stages`/`vus`.
- Walk through each executor with a runnable example:
  - `shared-iterations`
  - `per-vu-iterations`
  - `constant-vus`
  - `ramping-vus`
  - `constant-arrival-rate`
  - `ramping-arrival-rate`
- Arrival-rate executors vs VU-based executors: why arrival-rate models real user request
  rates more accurately (VUs get "stuck" waiting on slow responses).
- Running multiple scenarios in the same test (e.g. steady background traffic + a spike scenario)
  with `startTime` offsets and `exec` pointing at different functions in the same file.
- Tagging scenarios so metrics can be filtered per scenario.

**Concepts:** `scenarios`, all executor types, `exec`, `startTime`, `gracefulStop`.

**Exercise:** build a test with two concurrent scenarios: constant background load
(`constant-arrival-rate`) plus a ramping spike (`ramping-arrival-rate`) that kicks in halfway through.

---

## Module 6 — Parameterization and test data

**Goal:** stop hardcoding one user/product; drive tests from real data.

- `SharedArray` to load CSV/JSON test data once and share across VUs without memory blow-up.
- Random vs sequential data selection per VU/iteration (`__VU`, `__ITER`).
- Generating dynamic data with `k6/data` or simple JS (unique emails, random amounts).
- Environment variables and `k6 run -e KEY=value` / `__ENV` for environment-specific config
  (base URL, credentials) — sets up the multi-environment CI story later.

**Concepts:** `SharedArray`, `__VU`, `__ITER`, `__ENV`, `-e` flag.

**Exercise:** load `data/users.csv` and run a login test where each VU picks a different user.

---

## Module 7 — Modularization and code reuse

**Goal:** stop copy-pasting scripts; build a shared library like real test suites do.

- Split helpers into `libs/`: `auth.js` (login + token caching), `api.js` (wrapped request
  functions with default headers/tags), `config.js` (per-environment base URLs).
- `setup()` and `teardown()` lifecycle functions — data prep before the run, cleanup after.
- Passing `setup()` data into the default function.
- Per-VU `init` context vs shared `setup()` data — what runs once vs what runs per VU.
- Combine multiple test files into one entry point using `exec` across files.

**Concepts:** ES module imports in k6, `setup`/`teardown`, code organization patterns.

**Exercise:** refactor Modules 2–6's scripts to use the new `libs/` helpers instead of inline code.

---

## Module 8 — Custom metrics and advanced checks

**Goal:** measure business-relevant things k6 doesn't track out of the box.

- `Counter`, `Gauge`, `Rate`, `Trend` from `k6/metrics`.
- Example: a custom `Trend` for "time to add item to cart" as a business KPI distinct from
  raw HTTP timing; a `Rate` for "checkout success rate."
- Tagging custom metrics and filtering them in output/thresholds.
- `handleSummary()` to produce custom end-of-test reports (JSON, HTML, or a Slack-style summary).

**Concepts:** `k6/metrics` types, `handleSummary`, structured JSON output (`--out json=...`).

**Exercise:** add a custom `Trend` metric tracking end-to-end checkout duration across multiple
requests, with its own threshold.

---

## Module 9 — Browser-level testing (k6 browser module)

**Goal:** understand when to go beyond protocol-level HTTP testing to real browser interaction.

- `k6/browser` basics: launching a page, clicking, filling forms, waiting for selectors.
- When to use browser testing (frontend rendering performance, Core Web Vitals) vs when
  protocol-level HTTP testing is enough (the vast majority of load testing).
- Combining a small number of browser-based VUs with many protocol-level VUs in one scenario mix.

**Concepts:** `k6/browser`, page/locator API, browser-level thresholds (e.g. `browser_web_vital_lcp`).

**Exercise:** script a browser-based login + add-to-cart flow against `target-app`'s UI (or
against `test.k6.io`) and compare its resource cost/runtime to the protocol-level equivalent.

---

## Module 10 — Auth, sessions, and correlation

**Goal:** handle realistic stateful flows, not just independent stateless requests.

- Login once per VU in `init`/`setup`, reuse the token across iterations.
- Correlation: extracting an ID or CSRF token from one response and feeding it into the next
  request (cart ID, order ID).
- Cookie jar behavior (`http.cookieJar()`) and when k6 auto-handles cookies vs when you must not.
- Simulating multiple user roles (admin vs regular user) via scenario tags or exec targets.

**Concepts:** session/token reuse, correlation, `http.CookieJar`, per-VU state.

**Exercise:** script a full flow: login → browse → add to cart → checkout → logout, correlating
IDs between each step.

---

## Module 11 — Protocols beyond HTTP: WebSockets and gRPC

**Goal:** k6 isn't just REST — cover real-time and RPC protocols briefly.

- `k6/ws` (or `k6/experimental/websockets`): connect, send/receive messages, handle events.
- `k6/net/grpc`: load a `.proto`, make unary calls, checks on gRPC responses.
- When these matter (chat apps, live dashboards, internal microservice load testing).

**Concepts:** `k6/ws`, `k6/net/grpc`, event-driven scripting inside k6.

**Exercise:** add a WebSocket echo endpoint to `target-app` and write a k6 test that connects,
sends N messages, and asserts responses.

---

## Module 12 — Test types: smoke, load, stress, soak, spike, breakpoint

**Goal:** connect executors/stages/scenarios (Modules 3–5) to the standard performance-testing
vocabulary, and know which test type to reach for and when.

- **Smoke test** — tiny load, verifies the script itself and baseline health (already Module 1).
- **Load test** — expected normal/peak traffic, validates SLAs.
- **Stress test** — push beyond expected peak to find the breaking point.
- **Soak test** — moderate load sustained for hours, finds memory leaks/degradation over time.
- **Spike test** — sudden extreme burst, checks recovery behavior.
- **Breakpoint test** — gradually increasing load until the system fails, to find capacity limits.
- One example config for each in `tests/12-soak-stress-spike/`, reusing `libs/` from Module 7.
- Choosing pass/fail thresholds appropriately per test type (soak cares about trend over time,
  not just p95).

**Concepts:** test-type taxonomy, mapping business questions → test type → k6 config.

**Exercise:** given a hypothetical "Black Friday" requirement, pick and justify which test
type(s) you'd run and write the config.

---

## Module 13 — Capstone project

**Goal:** put everything together into one realistic, production-shaped test suite.

- Multi-scenario test against `target-app` combining: background constant load, a login/checkout
  user journey with correlation, parameterized data, custom business metrics, and thresholds
  that gate CI.
- `handleSummary()` producing an HTML report artifact.
- Config split by environment (local/staging) via `__ENV` + a `config.js` per Module 6/7.
- Written as if handing this off to a team: README section explaining how to run it and what
  the thresholds mean.

**Exercise:** extend the capstone to test an API you actually use at work or in a side project.

---

## Module 14 — CI/CD integration

**Goal:** run k6 automatically and make pipelines fail on performance regressions.

- `.github/workflows/k6.yml`: GitHub Actions workflow that
  1. spins up `target-app` via docker-compose (or a real staging URL),
  2. runs `k6 run` with thresholds,
  3. fails the job on non-zero k6 exit code,
  4. uploads the JSON/HTML summary as a build artifact.
- Using the official `grafana/k6-action` GitHub Action as an alternative to raw `k6 run`.
- Running only smoke tests on every PR, and full load/stress tests on a schedule or manual trigger
  (`workflow_dispatch`) — cost/time tradeoffs of running heavy tests on every commit.
- Environment-specific runs: `-e BASE_URL=$STAGING_URL` driven by pipeline variables/secrets.
- Trend visibility: pushing results to Grafana Cloud k6 or a local Grafana+InfluxDB stack
  (`docker-compose.yml` already includes this) for run-over-run comparison, not just pass/fail.
- Brief note on other CI systems (GitLab CI, Jenkins) using the same `k6 run` + exit code pattern.

**Concepts:** `k6-action`, exit-code gating, scheduled vs PR-triggered runs, result storage/trending.

**Exercise:** open a PR that intentionally regresses `target-app` response time and watch the
smoke-test threshold fail the CI check; then fix it and watch it pass.

---

## Suggested pace

| Week | Modules |
|------|---------|
| 1 | 0–3 (setup, HTTP, checks/thresholds) |
| 2 | 4–6 (stages, scenarios/executors, data) |
| 3 | 7–8 (modularization, custom metrics) |
| 4 | 9–11 (browser, auth/correlation, ws/grpc) |
| 5 | 12–13 (test types, capstone) |
| 6 | 14 (CI/CD) + polish/own project |

Modules 5 (scenarios/executors) and 14 (CI/CD) are the two highest-leverage sections for the
stated goal — write your own tests and wire them into pipelines — so if time is short, prioritize
Modules 0–5 then jump to 14, and backfill 6–13 as needed.

## Next step

Once this plan is approved, Module 0 will be implemented first: the `target-app`,
`docker-compose.yml`, and the first smoke test, so every subsequent module has a real,
runnable target from the start.
