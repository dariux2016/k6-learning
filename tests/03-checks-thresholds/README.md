# Module 3 — Checks and thresholds

**Goal:** move from "did it run" to "did it pass."

Module 2's script logged everything and asserted nothing. It would have printed a `500` just as
cheerfully as a `200` and finished green. This module adds the two mechanisms that turn a k6
script into a test:

- **`check()`** — per-response functional assertions. Records pass/fail. **Changes nothing else.**
- **`thresholds`** — pass/fail criteria on aggregate metrics. **Sets the process exit code.**

Those two sentences are the whole module. Everything below is detail.

**Files here**

| File | Purpose |
|------|---------|
| [checks.js](checks.js) | `check()` in every form, including ones that fail on purpose. |
| [thresholds.js](thresholds.js) | A realistic threshold set that passes, with sub-metrics and `abortOnFail`. |
| [exercise-failing-thresholds.js](exercise-failing-thresholds.js) | Starter for the exercise: fails by design, exit code 99. |

---

## 1. `check()`

```js
import { check } from 'k6';

const res = http.get(`${BASE_URL}/products?limit=5`, { tags: { name: 'list_products' } });

check(res, {
  'list: status is 200': (r) => r.status === 200,
  'list: body has an items array': (r) => Array.isArray(r.json('items')),
  'list: returned exactly 5 products': (r) => r.json('items').length === 5,
  'list: responded in under 500ms': (r) => r.timings.duration < 500,
});
```

The first argument is the value under test — usually a response, but it can be anything. The
second is an object of `'label': (value) => boolean`. Each entry is recorded separately and
shows up in the summary under its label, so write labels you'd want to read in a CI log at
3am: `'login: returned a token'` beats `'check 4'`.

`check()` **returns a single boolean** — `true` only if every assertion in that call passed:

```js
const allPassed = check(res, { /* ... */ });
if (!allPassed) {
  return; // skip the rest of this iteration
}
```

That `if` is the only way a check influences control flow. It won't happen by itself.

### Checks do not fail the test

This is the point people miss, so [checks.js](checks.js) makes it impossible to miss: it
contains two assertions that fail deliberately, plus a request that returns a genuine `500`.
Real output:

```
    checks_total.......: 14     5.854586/s
    checks_succeeded...: 85.71% 12 out of 14
    checks_failed......: 14.28% 2 out of 14

    ✓ list: status is 200
    ✗ DELIBERATE FAIL: store has 1000 products
      ↳  0% — ✓ 0 / ✗ 1
    ✗ DELIBERATE FAIL: unstable returned 200
      ↳  0% — ✓ 0 / ✗ 1
    ...
    http_req_failed................: 20.00% 1 out of 5
```

Exit code: **0**. Two failed checks, a failed request, a 20% error rate — and as far as your
shell, your CI runner, and every downstream step is concerned, that run **passed**. A k6
script with checks but no thresholds is a script that can never fail.

### Tagging checks

The optional third argument is a tags object, same idea as tagging a request:

```js
check(login, {
  'login: status is 200': (r) => r.status === 200,
  'login: returned a token': (r) => typeof r.json('token') === 'string',
}, { check_type: 'critical' });
```

That tag lets you threshold this subset separately — "critical checks must be 100%, everything
else can clear 99%." See §2.

### The trap: a callback that throws kills the iteration

A check is not a try/catch. If the callback throws, the iteration dies at that line and
everything after it never runs — including your other checks, which then quietly go missing
from the summary rather than showing up as failures.

`res.json()` throws on any body that isn't valid JSON, and a `204 No Content` has no body at
all:

```js
// UNSAFE -- throws on a 204, killing the iteration
check(res, { 'name is gone': (r) => r.json('name') === undefined });

// SAFE -- assert the status, and only parse when there's something to parse
check(res, {
  'delete: status is 204': (r) => r.status === 204,
  'delete: body is empty': (r) => !r.body,
});
```

Rule of thumb: check `r.status` before anything that parses `r.body`. If a summary shows fewer
checks than you wrote, a throwing callback is the first thing to suspect.

---

## 2. Thresholds

Thresholds live in `options` and are evaluated against **aggregated** metrics when the run
ends:

```js
export const options = {
  vus: 5,
  duration: '15s',
  thresholds: {
    http_req_duration: ['p(95)<500', 'avg<300', 'max<2000'],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
    http_reqs: ['count>100'],
  },
};
```

The key is a metric name, the value is a list of expressions. **Every** expression must hold —
one broken entry fails the metric, and one broken metric fails the run.

Which aggregations are available depends on the metric's type:

| Metric type | Example | Expressions you can use |
|-------------|---------|--------------------------|
| **Trend** (timings) | `http_req_duration`, `iteration_duration` | `avg`, `min`, `max`, `med`, `p(90)`, `p(95)`, `p(99)`, any `p(n)` |
| **Rate** (proportion 0–1) | `http_req_failed`, `checks` | `rate` |
| **Counter** (running total) | `http_reqs`, `data_sent` | `count`, `rate` (per second) |
| **Gauge** (last value) | `vus` | `value` |

Note `checks` in that table: **that** is the bridge. Checks record a pass rate; a threshold on
the `checks` metric turns that rate into an exit code. Without it, §1's failing checks stay
cosmetic.

**Percentiles, not averages.** `avg<300` is satisfied by a run where most requests take 50ms
and a tail of them take 4 seconds. `p(95)<500` is the promise a user actually experiences —
"19 out of 20 requests come back within half a second." Threshold on `p(95)` or `p(99)`; use
`avg` only as a supporting signal.

### Sub-metric thresholds

Tag a request, and you can threshold that slice of the metric on its own:

```js
'http_req_duration{name:list_products}': ['p(95)<400'],
'http_req_duration{name:login}': ['p(95)<900'],
'http_req_failed{name:login}': ['rate==0'],
'checks{check_type:critical}': ['rate==1'],
```

This is the payoff for the tagging habit from Module 2. A login that hashes a password is
legitimately slower than a cached product listing; holding both to one global number means the
bar is either too loose for the listing or too tight for the login. And when they're averaged
together, one endpoint degrading can hide inside the aggregate — §4 shows exactly that
happening.

`{name:login}` filters on the `name` tag set by `{ tags: { name: 'login' } }`. Any tag works,
including ones you invent, like `check_type`.

### `abortOnFail`

The object form of a threshold carries options:

```js
iteration_duration: [
  { threshold: 'p(95)<10000', abortOnFail: true, delayAbortEval: '5s' },
],
```

`abortOnFail` stops the run the moment the threshold is crossed rather than finishing the full
duration. `delayAbortEval` holds off evaluation until enough samples exist — without it, one
slow request in the first 200ms can abort a 30-minute test.

Reach for it when continuing is pointless (the app is down, the error rate is 90%), not as a
default: an aborted run returns partial data for *every* metric, so you lose the picture of
what else was happening.

### Exit codes

| Exit code | Meaning |
|-----------|---------|
| `0` | Every threshold held. Checks may still have failed. |
| `99` | At least one threshold was crossed. |
| `104`, `107`, … | Script or init error — the test never really ran. |

Read it with `echo $?` in bash or `$LASTEXITCODE` in PowerShell. A broken run also prints:

```
level=error msg="thresholds on metrics 'checks, http_req_duration, http_req_failed' have been crossed"
```

`99` is the entire k6/CI contract. Module 14's pipeline doesn't parse k6's output — it runs
`k6 run`, and the non-zero exit fails the job.

---

## 3. Checks vs thresholds, side by side

|  | `check()` | `thresholds` |
|--|-----------|--------------|
| Scope | One response, one moment | The whole run, aggregated |
| Answers | "Was this response correct?" | "Was this run acceptable?" |
| Lives in | The default function | `options` |
| On failure | Records a failure, run continues | Marks the run failed, exit 99 |
| Affects exit code | **No** | **Yes** |
| Good for | Correctness: status, body shape, business rules | Performance SLOs and error budgets |

They compose rather than compete: checks generate the `checks` metric, and a threshold on
`checks` is what gives them teeth. A test with checks but no thresholds can't fail; a test with
thresholds but no checks can only see latency and status codes, never whether the response was
*right*.

---

## 4. Watching a threshold break

[thresholds.js](thresholds.js) passes against a healthy app:

```
  █ THRESHOLDS

    checks
    ✓ 'rate>0.99' rate=100.00%
      {check_type:critical}
      ✓ 'rate==1' rate=100.00%

    http_req_duration
    ✓ 'p(95)<500' p(95)=150.34ms
    ✓ 'avg<300' avg=73.13ms
    ✓ 'max<2000' max=153.13ms
      {name:list_products}
      ✓ 'p(95)<400' p(95)=52.53ms
      {name:login}
      ✓ 'p(95)<900' p(95)=152.6ms

    http_req_failed
    ✓ 'rate<0.01' rate=0.00%
      {name:login}
      ✓ 'rate==0' rate=0.00%

    http_reqs
    ✓ 'count>100' count=105
```

Exit code 0. Now introduce a regression — the target app can be made slow at runtime, no
restart needed:

```bash
curl -X POST http://localhost:8000/admin/config \
  -H 'Content-Type: application/json' -d '{"base_latency_ms": 800}'

k6 run tests/03-checks-thresholds/thresholds.js
```

```
    checks
    ✓ 'rate>0.99' rate=100.00%
      {check_type:critical}
      ✓ 'rate==1' rate=100.00%

    http_req_duration
    ✗ 'p(95)<500' p(95)=830.05ms
    ✗ 'avg<300' avg=592.56ms
    ✓ 'max<2000' max=833.62ms
      {name:list_products}
      ✗ 'p(95)<400' p(95)=831.39ms
      {name:login}
      ✓ 'p(95)<900' p(95)=149.05ms

    http_req_failed
    ✓ 'rate<0.01' rate=0.00%

    http_reqs
    ✗ 'count>100' count=60
```

Exit code **99**. Three things in that output are worth more than the rest of this README:

1. **Every check still passed, 100%.** The app got 40× slower and not one functional assertion
   noticed, because every response was still a correct `200` with the right body. Checks
   measure correctness; only thresholds measure speed. A suite of checks alone would have
   called this deployment healthy.
2. **`{name:login}` held at 149ms while `{name:list_products}` broke.** The regression was in
   one place, and the per-endpoint thresholds say *which* place. The global `p(95)` only says
   "something is slow." (This app's login path has its own latency setting, which is why it was
   untouched — a stand-in for the real case where one service degrades and others don't.)
3. **`http_reqs count>100` broke too, at 60.** Nobody set out to test throughput here. But each
   VU spends its iteration waiting on a slow server, so fewer iterations fit into 15 seconds. A
   count threshold is a cheap canary: if a run did far less work than usual, something is wrong
   even if you don't yet know what.

Undo the regression:

```bash
curl -X POST http://localhost:8000/admin/config \
  -H 'Content-Type: application/json' -d '{"base_latency_ms": 20}'
```

---

## 5. Running it

```bash
k6 run tests/03-checks-thresholds/checks.js       # exit 0, despite failed checks
k6 run tests/03-checks-thresholds/thresholds.js   # exit 0, all thresholds hold (~15s)
k6 run tests/03-checks-thresholds/exercise-failing-thresholds.js   # exit 99, by design
```

Always read the exit code — it's the part of the output this module is about:

```bash
echo $?            # bash
```

```powershell
$LASTEXITCODE      # PowerShell
```

---

## 6. Exercise

> Add thresholds that fail on purpose (too strict), observe the non-zero exit code, then fix
> them to realistic values.

[exercise-failing-thresholds.js](exercise-failing-thresholds.js) is pre-broken. It hits
`/unstable`, which sleeps 500ms and fails 25% of the time by default, and holds it to
thresholds nothing like that could meet. Real output:

```
    checks
    ✗ 'rate>0.99' rate=88.09%

    http_req_duration
    ✗ 'p(95)<100' p(95)=507.99ms

    http_req_failed
    ✗ 'rate<0.01' rate=11.90%

level=error msg="thresholds on metrics 'checks, http_req_duration, http_req_failed' have been crossed"
```

Exit code 99. Work the TODOs in the file:

1. Run it, read the ✗ lines, confirm the exit code is 99.
2. Relax the three thresholds until it passes — without relaxing them into meaninglessness.
   (`p(95)<700`, `rate<0.20`, `rate>0.80` passes here, at 507ms / 14.28% / 85.71%.)
3. Tag the health request and give it its own, much tighter sub-metric threshold.
4. Add `abortOnFail` to the failure-rate threshold and run with `-e ERROR_RATE=0.9` — the run
   should stop after ~4s instead of 10s.

TODO 4 has a deliberate catch worth hitting yourself. An *unscoped*
`http_req_failed: ['rate<0.5']` never trips, even at `ERROR_RATE=0.9`, because half the
requests in the script go to the healthy `/` endpoint and drag the overall rate down to ~47%.
Scope it to `'http_req_failed{name:unstable}'` and it fires immediately at 100%. Averaging a
broken endpoint together with a healthy one hides the breakage — which is §2's argument for
sub-metrics, delivered as a bug instead of a paragraph.

---

## Checkpoint

You should be able to answer these without scrolling up:

- [ ] A run has 40% failing checks and no thresholds. What's the exit code?
- [ ] Which metric connects `check()` results to the exit code?
- [ ] What does `check()` return, and when is it worth using that return value?
- [ ] Why does `check(res, { 'x': (r) => r.json('id') === 1 })` risk killing the iteration?
- [ ] What does `'http_req_duration{name:login}': ['p(95)<900']` threshold, and where does
      `name:login` come from?
- [ ] Why threshold `p(95)` rather than `avg`?
- [ ] What is `delayAbortEval` protecting you from?
- [ ] The app got 40× slower and every check still passed. Why?

---

**Next:** Module 4 — Load profiles with stages · [Module 2](../02-http-basics/) · [PLAN.md](../../PLAN.md)
