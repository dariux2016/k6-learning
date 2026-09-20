# target-app

The disposable API the whole curriculum load-tests against. FastAPI, in-memory state, no
database, no external calls. Restarting it (or `POST /admin/reset`) returns it to a known
seeded state.

It is deliberately *not* a well-behaved service. It has artificial latency, a configurable
failure rate, and a capacity ceiling it falls over — because a target that always answers in
1 ms makes every threshold trivially pass and every stress test flat.

## Endpoints

| Method | Path | Auth | Notes |
|--------|------|:----:|-------|
| `GET` | `/` | — | Health check. No artificial latency, so it stays fast. |
| `GET` | `/health` | — | Alias of `/`. |
| `GET` | `/products` | — | Paginated. `?limit=`, `?offset=`, `?category=` |
| `GET` | `/products/{id}` | — | `404` if missing. IDs 1–20 are seeded. |
| `PUT` | `/products/{id}` | — | Partial update. |
| `DELETE` | `/products/{id}` | — | `204` on success. |
| `POST` | `/login` | — | `{"username","password"}` → `{"token", ...}` |
| `GET` | `/me` | ✅ | Echoes the token's claims. |
| `POST` | `/cart` | ✅ | `201`, creates an empty cart. |
| `GET` | `/cart/{id}` | ✅ | `403` if it isn't yours (admins may read any). |
| `POST` | `/cart/{id}/items` | ✅ | `{"product_id","quantity"}` |
| `POST` | `/checkout` | ✅ | `{"cart_id"}` → `201` with the order. `422` if the cart is empty. |
| `GET` | `/unstable` | — | Slow and/or failing on purpose. See below. |
| `POST` | `/admin/reset` | — | Reseed products/users, drop carts and orders. |
| `GET` | `/admin/config` | — | Current tunables plus live/peak in-flight counts. |
| `POST` | `/admin/config` | — | Patch tunables at runtime. |

Interactive docs: <http://localhost:8000/docs>

## Auth

Seeded users are `user1` … `user10`, all with password `k6learning`. `user1` has the `admin`
role; the rest are `customer`.

```bash
TOKEN=$(curl -s -X POST http://localhost:8000/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"user1","password":"k6learning"}' | jq -r .token)

curl http://localhost:8000/me -H "Authorization: Bearer $TOKEN"
```

Tokens are real HS256 JWTs signed with a hardcoded dev secret — real enough to practise header
handling and expiry in Module 10, and not remotely production-grade. Don't reuse
[`app/auth.py`](app/auth.py) anywhere that matters.

## Making it misbehave

Three independent mechanisms, all tunable:

**1. Baseline latency** — a flat floor plus uniform jitter on every endpoint except `/`.
Default `20ms + rand(0..30ms)`, so an idle p95 on `/products` measures around 60 ms.

**2. The capacity model** — the app tracks in-flight requests. Past `CAPACITY`, each extra
concurrent request adds `DEGRADE_MS_PER_EXCESS` to *everyone's* latency; past `MAX_INFLIGHT`
it sheds load with `503` + `Retry-After`. This is what gives the stress, spike, and breakpoint
tests in Module 12 an actual knee in the curve. Measured on `/products` at defaults:
~60 ms p95 at 1 VU, ~355 ms p95 at 90 VUs.

**3. `GET /unstable`** — sleeps then rolls a die. Per-request query overrides mean you can
break a test without restarting anything:

```bash
curl "http://localhost:8000/unstable?delay_ms=2000&error_rate=0"    # slow, always succeeds
curl "http://localhost:8000/unstable?delay_ms=0&error_rate=1"       # instant, always 500s
```

## Configuration

Set as environment variables (see [`docker-compose.yml`](../docker-compose.yml)), or patched at
runtime with `POST /admin/config`:

| Variable | Default | Effect |
|----------|---------|--------|
| `BASE_LATENCY_MS` | `20` | Latency floor on normal endpoints. |
| `BASE_LATENCY_JITTER_MS` | `30` | Uniform jitter added to the floor. |
| `LOGIN_LATENCY_MS` | `120` | `/login` is slower, as auth usually is. |
| `CAPACITY` | `50` | In-flight requests before degradation starts. |
| `DEGRADE_MS_PER_EXCESS` | `4.0` | Latency added per request over capacity. |
| `MAX_INFLIGHT` | `250` | In-flight requests before the app returns `503`. |
| `UNSTABLE_DELAY_MS` | `500` | Default delay for `/unstable`. |
| `UNSTABLE_ERROR_RATE` | `0.25` | Default failure probability for `/unstable`. |
| `TOKEN_TTL_SECONDS` | `3600` | JWT lifetime. |
| `JWT_SECRET` | `k6-learning-dev-secret` | Signing key. Never echoed back over HTTP. |

Runtime patching is how Module 14 demonstrates a performance regression failing CI:

```bash
curl -X POST http://localhost:8000/admin/config \
  -H 'Content-Type: application/json' \
  -d '{"base_latency_ms": 800}'
```

## Code map

| File | Contents |
|------|----------|
| [`app/main.py`](app/main.py) | Routes, the concurrency middleware, the latency simulation. |
| [`app/config.py`](app/config.py) | Every tunable and its default. |
| [`app/store.py`](app/store.py) | Seed data and in-memory state. |
| [`app/auth.py`](app/auth.py) | Toy HS256 JWT encode/decode. |
