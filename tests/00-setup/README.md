# Module 0 — Environment setup

**Goal:** get k6 installed and a target app running, so every later module has something real
to test against.

Nothing here is about writing tests yet. It's about making sure that when Module 1 says
"run this", it runs.

---

## 1. Install k6

| Platform | Command |
|----------|---------|
| Windows | `winget install GrafanaLabs.k6` |
| macOS | `brew install k6` |
| Debian/Ubuntu | see [k6 install docs](https://grafana.com/docs/k6/latest/set-up/install-k6/) |
| Anywhere | `docker run --rm -i grafana/k6 run - <script.js` |

Verify:

```bash
k6 version
# k6.exe v2.2.0 (commit/00a9a1b7f5, go1.26.5, windows/amd64)
```

> **Windows:** if `k6` isn't found right after installing, open a **new** terminal. winget adds
> it to the machine PATH, which existing shells don't pick up.

## 2. Exercise — prove the binary works before touching anything local

This is the point of the exercise: separate "is k6 installed correctly" from "is my app
reachable". Debugging both at once is miserable.

```bash
k6 run tests/00-setup/verify-install.js
```

[`verify-install.js`](verify-install.js) makes exactly one request to
[test.k6.io](https://test.k6.io), Grafana's public demo site, which exists to be load-tested.
It's the only script in this repo that touches the internet.

You should see `status=200` in the log line, then a results summary.

## 3. Start the target app

```bash
docker compose up -d target-app
curl http://localhost:8000/
```

```json
{"status":"ok","service":"k6-learning target app","version":"1.0.0","uptime_seconds":2.1}
```

Prefer no Docker? See [the README](../../README.md#running-the-target-app-without-docker).

## 4. Run the first local test

```bash
k6 run tests/01-smoke/smoke.js
```

Don't worry about reading the summary yet — Module 1 walks through it line by line. For now,
`http_req_failed: 0.00%` and `1 complete iteration` means you're set up.

---

## What you now have

```
target-app/          FastAPI service: products, JWT login, cart, checkout
docker-compose.yml   `docker compose up -d target-app` (+ an opt-in Grafana/InfluxDB profile)
tests/00-setup/      this module
tests/01-smoke/      the first test, for Module 1
```

The target app is built to be *bad* in useful ways — see
[target-app/README.md](../../target-app/README.md). The short version:

- **Artificial latency** on every endpoint except `/`, so response-time thresholds in Module 3
  are about something.
- **A capacity ceiling.** Past 50 concurrent requests latency climbs; past 250 it returns
  `503`. Module 12's stress and breakpoint tests need a system that can actually break.
- **`GET /unstable`**, slow and failing on demand via query string:
  `/unstable?delay_ms=2000&error_rate=1`.
- **`POST /admin/reset`** to return to a known state between runs, and **`POST /admin/config`**
  to retune any of it without a restart.

## Checkpoint

Before moving on, all four should work:

- [ ] `k6 version` prints v2.x
- [ ] `k6 run tests/00-setup/verify-install.js` passes
- [ ] `curl http://localhost:8000/` returns `{"status":"ok",...}`
- [ ] `k6 run tests/01-smoke/smoke.js` reports 1 complete iteration, 0 failed requests

## Troubleshooting

| Symptom | Cause |
|---------|-------|
| `k6: command not found` after install | Open a new terminal (PATH isn't refreshed in existing ones). |
| `dial tcp ... connection refused` | The target app isn't up. `docker compose ps`, then `docker compose logs target-app`. |
| Port 8000 already in use | Change the host port in `docker-compose.yml` and pass `-e BASE_URL=http://localhost:<port>`. |
| Running k6 in Docker can't reach the app | Use `http://host.docker.internal:8000`, not `localhost` — inside the container, `localhost` is the container. |

---

**Next:** [Module 1 — Your first script](../01-smoke/) · full curriculum in [PLAN.md](../../PLAN.md)
