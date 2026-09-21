# COMMANDS.md

A running log of every command used while working through [PLAN.md](PLAN.md), module by
module. Verified on Windows 11 with PowerShell; the `docker`, `k6`, and `curl` commands are
identical on macOS and Linux.

---

## Module 0 — Environment setup

### Install and verify k6

```powershell
winget install --id GrafanaLabs.k6 --source winget --accept-package-agreements --accept-source-agreements
```

```bash
k6 version          # k6.exe v2.2.0 (commit/00a9a1b7f5, go1.26.5, windows/amd64)
```

winget writes to the **machine** PATH, which shells already open don't reload. Either open a
new terminal or call the binary directly:

```powershell
& 'C:\Program Files\k6\k6.exe' version
```

Other platforms: `brew install k6` (macOS), or see the
[k6 install docs](https://grafana.com/docs/k6/latest/set-up/install-k6/).

### Run the target app with Docker

```bash
docker compose up -d --build target-app   # build + start
docker compose ps                         # confirm STATUS is "(healthy)"
docker compose logs -f target-app         # tail logs
docker compose down                       # stop and remove
```

The Grafana + InfluxDB stack is behind a profile and stays down unless asked for:

```bash
docker compose --profile observability up -d
```

On Windows, Docker Desktop must be running before any of these work:

```powershell
Start-Process 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
```

```bash
until docker info >/dev/null 2>&1; do sleep 3; done   # wait for the engine
```

### Run the target app without Docker

```bash
cd target-app
python -m venv .venv
.venv/Scripts/activate                  # Windows
# source .venv/bin/activate             # macOS/Linux
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### Run the tests

```bash
k6 run tests/00-setup/verify-install.js   # Module 0 exercise, hits test.k6.io
k6 run tests/01-smoke/smoke.js            # the local smoke test
```

Useful variations (no code change needed):

```bash
k6 run --vus 10 --duration 30s tests/01-smoke/smoke.js   # override load from the CLI
k6 run -e BASE_URL=http://localhost:8000 tests/01-smoke/smoke.js
```

### Exercise the target app by hand

```bash
curl http://localhost:8000/
curl "http://localhost:8000/products?limit=2"
curl http://localhost:8000/products/3

TOKEN=$(curl -s -X POST http://localhost:8000/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"user1","password":"k6learning"}' | jq -r .token)

curl http://localhost:8000/me -H "Authorization: Bearer $TOKEN"
curl -X POST http://localhost:8000/cart -H "Authorization: Bearer $TOKEN"
```

PowerShell has no `curl`; it aliases to `Invoke-WebRequest`, which takes different arguments:

```powershell
Invoke-RestMethod http://localhost:8000/
$login = Invoke-RestMethod -Method POST -Uri http://localhost:8000/login `
  -Body '{"username":"user1","password":"k6learning"}' -ContentType 'application/json'
$auth = @{ Authorization = "Bearer $($login.token)" }
Invoke-RestMethod http://localhost:8000/me -Headers $auth
```

### Control the target app's behaviour

```bash
# back to seeded state (20 products, 10 users, no carts or orders)
curl -X POST http://localhost:8000/admin/reset

# current tunables plus live and peak in-flight counts
curl http://localhost:8000/admin/config

# make it slow without restarting — this is the Module 14 regression demo
curl -X POST http://localhost:8000/admin/config \
  -H 'Content-Type: application/json' \
  -d '{"base_latency_ms": 800}'

# the deliberately unreliable endpoint
curl "http://localhost:8000/unstable?delay_ms=2000&error_rate=0"   # slow, always 200
curl "http://localhost:8000/unstable?delay_ms=0&error_rate=1"      # instant, always 500
```

### Measurements taken during setup

Used to confirm the capacity model actually produces a degradation curve:

| Load on `GET /products` | p95 `http_req_duration` |
|-------------------------|-------------------------|
| 1 VU, 5s | ~61 ms |
| 90 VUs, 10s | ~355 ms |

Peak in-flight reached 90 with zero failed requests — below the `MAX_INFLIGHT=250` ceiling
where the app starts returning `503`.

---

## Module 1 — Anatomy of a k6 test

### Run the scripts

```bash
k6 run tests/01-smoke/smoke.js              # the test itself
k6 run tests/01-smoke/lifecycle.js          # init-vs-iteration demo
k6 run tests/01-smoke/exercise-public-api.js
```

### CLI overrides

Anything in `options` can be overridden by a flag, so one script serves as both a smoke test
and a load test. Precedence: CLI flag > `options` in the script > k6 default.

```bash
k6 run --vus 5 --duration 10s tests/01-smoke/smoke.js     # duration-based
k6 run --vus 10 --iterations 200 tests/01-smoke/smoke.js  # iteration-based
k6 run -e BASE_URL=http://localhost:8000 tests/01-smoke/smoke.js
k6 run -e API_URL=https://your-api.example.com/health tests/01-smoke/exercise-public-api.js
```

| Flag | Short | Effect |
|------|-------|--------|
| `--vus` | `-u` | Number of virtual users. |
| `--duration` | `-d` | Run for a wall-clock time. |
| `--iterations` | `-i` | Total iterations shared among all VUs. |
| `--quiet` | `-q` | Hide the live progress bar. |
| `-e KEY=value` | | Set a `__ENV` variable. |

### Summary output

```bash
k6 run --summary-mode full tests/01-smoke/smoke.js    # adds the sub-timings
k6 run --summary-mode compact tests/01-smoke/smoke.js # the default
k6 run --summary-export summary.json tests/01-smoke/smoke.js
k6 run --summary-trend-stats "min,avg,med,p(95),p(99),max" tests/01-smoke/smoke.js
```

`--summary-mode full` is what breaks `http_req_duration` into its parts:

```
http_req_duration = http_req_sending + http_req_waiting + http_req_receiving
```

`http_req_blocked` and `http_req_connecting` sit outside that sum — they are connection
acquisition, not server time.

### Shell note

`console.log()` in a k6 script is written to **stderr**, not stdout. Filtering for it needs
stderr merged in:

```bash
k6 run tests/01-smoke/lifecycle.js 2>&1 | grep '\[init\]'
```

In PowerShell, avoid `2>&1` on a native binary — it wraps each stderr line in an ErrorRecord
and reports a spurious `NativeCommandError`. Use the Bash shell for that filtering, or drop
the redirect and read the full output.

### Observations recorded while writing the module

Measured against the Module 0 target app, all reproducible:

| Command | Result |
|---------|--------|
| `k6 run tests/01-smoke/lifecycle.js` (2 VUs, 6 iters) | 4 `[init]` lines, `__VU` = `0,1,2,0`; VU init order varies run to run; iterations split 3/3 |
| `k6 run --vus 5 --duration 10s tests/01-smoke/smoke.js` | 9132 iterations, ~913 req/s, p95 8.7ms — no `sleep()`, so VUs loop flat out |
| `k6 run --vus 5 --duration 5s --summary-mode full` | avg 5.19ms = sending 0.017 + waiting 4.64 + receiving 0.526 |

---

## Module 2 — HTTP basics

### Run the scripts

```bash
k6 run tests/02-http-basics/http-basics.js
k6 run tests/02-http-basics/exercise-browse-products.js
```

`http-basics.js` deletes a product every run (its `DELETE` demo), which shifts which product ID
is "first" on the next run. Reset between runs to keep IDs predictable:

```bash
curl -X POST http://localhost:8000/admin/reset
k6 run tests/02-http-basics/http-basics.js
```

### Observations recorded while writing the module

Measured against the Module 0 target app (freshly reset), all reproducible:

```
GET /products         -> 200, 20 total in store
GET /products/1      -> 200 "Nimbus Headphones"
POST /login            -> 200, token=eyJhbGciOiJI...
GET /me                -> 200 role=admin
POST /cart              -> 201, cart id=1
POST /cart/1/items -> 200
PUT /products/1      -> 200, stock=999
DELETE /products/1   -> 204, body="null"
```

```
http_req_duration..............: avg=51.31ms min=28.87ms med=40.53ms max=145.01ms
http_req_failed................: 0.00%  0 out of 8
http_reqs......................: 8      2.342178/s
iteration_duration.............: avg=3.41s   (three sleep(1) calls dominate)
```

### The missing-Content-Type mistake, demonstrated

`JSON.stringify()`-ing a body without setting `Content-Type: application/json` sends valid JSON
bytes that the server has no instruction to parse as JSON — FastAPI returns `422`, not a
connection error or a `401`:

```js
const res = http.post(
  'http://localhost:8000/login',
  JSON.stringify({ username: 'user1', password: 'k6learning' }),
);
// status=422 body={"detail":[{"type":"model_attributes_type","loc":["body"],
//   "msg":"Input should be a valid dictionary or object to extract fields from", ...}]}
```

### Verifying the target app without Docker (this session)

Docker's daemon wasn't reachable in this sandbox, so the target app was run directly for
verification, and k6 was built from source since no package manager mirror for the official
binary was reachable either:

```bash
python3 -m venv /tmp/venv-target-app
/tmp/venv-target-app/bin/pip install -r target-app/requirements.txt
/tmp/venv-target-app/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000   # from target-app/

go install go.k6.io/k6@latest   # go.k6.io mirrors dl.k6.io's release process
$(go env GOPATH)/bin/k6 run tests/02-http-basics/http-basics.js
```

Normal setups just use `docker compose up -d target-app` and an installed `k6` binary per
Module 0 — this detour was specific to this sandboxed environment.
