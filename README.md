# k6-learning

A hands-on, progressive project for learning [k6](https://k6.io) performance testing, from a
single-request smoke test to a multi-scenario suite running in CI.

The curriculum lives in [PLAN.md](PLAN.md). Each module builds on the last.
**Module 0 (environment setup) is done** — everything below works right now.

## Quick start

```bash
# 1. start the target app
docker compose up -d target-app

# 2. confirm it's alive
curl http://localhost:8000/

# 3. run the smoke test
k6 run tests/01-smoke/smoke.js
```

That's it. Every test in this repo runs offline against your own machine — no external
services, no accounts, nothing to hammer by accident.

## Prerequisites

| Tool | Why | Install |
|------|-----|---------|
| **k6** | the thing you're learning | `winget install GrafanaLabs.k6` (macOS: `brew install k6`) |
| **Docker** | runs the target app | [Docker Desktop](https://docs.docker.com/get-docker/) |
| **Python 3.12+** | only if you want to run the target app without Docker | [python.org](https://www.python.org/downloads/) |

Verify k6 with `k6 version` — you should see `v2.x`. If the command isn't found right after
installing on Windows, open a new terminal so it picks up the updated PATH.

## Running the target app without Docker

Sometimes faster for iteration, since a code change reloads instantly:

```bash
cd target-app
python -m venv .venv
.venv/Scripts/activate        # Windows
# source .venv/bin/activate   # macOS/Linux
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Interactive API docs are at <http://localhost:8000/docs>.

## Repo layout

```
k6-learning/
├── PLAN.md               # the 15-module curriculum
├── target-app/           # the disposable API we load-test (FastAPI)
├── tests/
│   ├── 00-setup/         # Module 0 — verify the install
│   └── 01-smoke/         # Module 1 — your first script
├── docker/               # Grafana provisioning (used from Module 14)
└── docker-compose.yml    # target app, plus an opt-in Grafana/InfluxDB stack
```

Later modules add `libs/` (shared helpers), `data/` (parameterization fixtures), and
`.github/workflows/` (CI).

## The target app

A small e-commerce-shaped REST API: products, login with a JWT, a cart, and checkout. It is
built to be load-tested, which means it can be told to be slow, flaky, or overloaded on demand.

See [target-app/README.md](target-app/README.md) for the full endpoint list and every knob you
can turn.

## Useful commands

```bash
# run any test
k6 run tests/01-smoke/smoke.js

# override load from the CLI, no code change
k6 run --vus 10 --duration 30s tests/01-smoke/smoke.js

# point a test at a different environment
k6 run -e BASE_URL=http://localhost:8000 tests/01-smoke/smoke.js

# reset the target app to its seeded state between runs
curl -X POST http://localhost:8000/admin/reset

# tail the app's logs
docker compose logs -f target-app

# stop everything
docker compose down
```
