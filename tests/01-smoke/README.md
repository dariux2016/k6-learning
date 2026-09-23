# Module 1 — Your first script: anatomy of a k6 test

**Goal:** understand what a k6 script *is* — where your code runs, how often, and what the
numbers at the end mean.

Module 0 got `k6 run` to exit 0. This module is about understanding what it printed.

**Files here**

| File | Purpose |
|------|---------|
| [smoke.js](smoke.js) | The test itself. Nine lines that matter. |
| [lifecycle.js](lifecycle.js) | A demo that *shows* init-vs-iteration instead of asserting it. |
| [exercise-public-api.js](exercise-public-api.js) | Starter for the exercise. |

---

## 1. The script, line by line

```js
import http from 'k6/http';                              // 1

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';  // 2

export const options = {                                 // 3
  vus: 1,
  iterations: 1,
};

export default function () {                             // 4
  const res = http.get(`${BASE_URL}/`);                  // 5
  console.log(`status=${res.status} body=${res.body}`);
}
```

**1 — `import http from 'k6/http'`.** k6 runs JavaScript, but it is not Node. There is no
`require`, no `fs`, no `axios`, no npm packages by default. You get ES modules and k6's own
built-ins (`k6/http`, `k6/metrics`, `k6/ws`, …). This trips people up constantly: k6 is a Go
program with a JS runtime embedded in it, not a JS runtime with an HTTP library bolted on.

**2 — `__ENV`.** k6's view of environment variables, populated from `-e KEY=value` and the real
environment. Double-underscore names are k6 globals, not something you define.

**3 — `export const options`.** Configuration as data, not code. k6 reads this *before* the
test starts to plan the run. `vus: 1, iterations: 1` is the smallest possible test: one
virtual user, doing one pass.

**4 — `export default function`.** The body of the test. k6 calls this over and over — one
call is one **iteration**. Everything outside it is setup that happens before the clock starts.

**5 — `http.get()` is blocking.** It reads like synchronous code, no `await`. Each VU is an
independent worker running its own sequential script; k6 handles the concurrency underneath.

### VUs and iterations

- A **VU** (virtual user) is one concurrent worker running your default function in a loop.
- An **iteration** is one execution of that function.

10 VUs × 100 iterations means 1000 total passes, not 100. Load is VUs; volume is iterations.

---

## 2. The lifecycle: where code actually runs

A k6 script has distinct stages, and putting code in the wrong one is the most common beginner
mistake.

```
k6 run script.js
│
├─ load module  (__VU=0) ─── k6 reads `options` to plan the run
│
├─ setup()  ──────────────── once, before the test          → Module 7
│
├─ VU 1: init code (__VU=1)
│        └─ default() → default() → default() → …           one call per iteration
├─ VU 2: init code (__VU=2)
│        └─ default() → default() → default() → …
│
├─ teardown() ────────────── once, after the test           → Module 7
│
└─ load module  (__VU=0) ─── end-of-test summary handling
```

**Init code** is everything at the top level of the module: imports, constants, file loading.
It runs **once per VU**, before that VU's first iteration, and it is the only place you can
import or read files. It is *not* inside a virtual user, so it must not make requests.

**VU code** is the default function. It runs per iteration and is where requests belong.

### See it for yourself

```bash
k6 run tests/01-smoke/lifecycle.js
```

[lifecycle.js](lifecycle.js) runs 2 VUs over 6 iterations and logs from both stages. Real
output, trimmed to the log lines:

```
[init] module loaded, __VU=0
[init] module loaded, __VU=1
[init] module loaded, __VU=2
[default] __VU=1 __ITER=0 (this VU has now run 1 iteration(s))
[default] __VU=2 __ITER=0 (this VU has now run 1 iteration(s))
[default] __VU=2 __ITER=1 (this VU has now run 2 iteration(s))
[default] __VU=1 __ITER=1 (this VU has now run 2 iteration(s))
[default] __VU=1 __ITER=2 (this VU has now run 3 iteration(s))
[default] __VU=2 __ITER=2 (this VU has now run 3 iteration(s))
[init] module loaded, __VU=0
```

Four things to take from that:

**`[init]` printed four times for two VUs**, with `__VU` values `0, 1, 2, 0`. The two zeros are
k6 loading the module before the test (to read `options`) and again after it (for summary
handling). `__VU=0` means *"not inside a virtual user"* — that's your signal that requests
made there don't belong to anyone.

**The VU init order is not deterministic.** Across runs you'll see both `0,1,2,0` and
`0,2,1,0`. Never write init code that depends on the order.

**Each VU's counter climbs independently**, ending at 3 and 3 rather than a shared 6. VUs do
not share memory. A module-level `let` is per-VU state, not a global.

**The 6 iterations came from a shared pool.** It landed on a tidy 3/3 here because every
iteration costs the same, but that's not guaranteed — a slower VU simply takes fewer. Module 5
covers `per-vu-iterations`, the executor that does guarantee an even split.

> **Why this matters.** Init code runs once per VU; the default function runs thousands of
> times. Expensive work — parsing a CSV, building a fixture — belongs in init, or it becomes
> part of what you're measuring. Module 6 leans on this hard with `SharedArray`.

---

## 3. Running it, and overriding from the CLI

```bash
k6 run tests/01-smoke/smoke.js
```

Anything in `options` can be overridden by a flag, which means one script can serve as a smoke
test *and* a load test without editing it:

```bash
k6 run --vus 5 --duration 10s tests/01-smoke/smoke.js
k6 run --vus 10 --iterations 200 tests/01-smoke/smoke.js
k6 run -e BASE_URL=http://localhost:8000 tests/01-smoke/smoke.js
```

| Flag | Short | Effect |
|------|-------|--------|
| `--vus` | `-u` | Number of virtual users. |
| `--duration` | `-d` | Run for a wall-clock time. |
| `--iterations` | `-i` | Total iterations **shared among all VUs**. |
| `--quiet` | `-q` | Hide the live progress bar. |
| `--summary-mode full` | | Show the sub-timings (see below). |
| `-e KEY=value` | | Set a `__ENV` variable. |

**Precedence:** CLI flag beats `options` in the script, which beats k6's default. Note that
`--duration` and `--iterations` are different execution models — the first runs until the clock
says stop, the second until the work runs out.

---

## 4. Reading the summary

Real output from `k6 run tests/01-smoke/smoke.js`:

```
  █ TOTAL RESULTS

    HTTP
    http_req_duration..............: avg=3.37ms  min=3.37ms  med=3.37ms  max=3.37ms  p(90)=3.37ms  p(95)=3.37ms
      { expected_response:true }...: avg=3.37ms  min=3.37ms  med=3.37ms  max=3.37ms  p(90)=3.37ms  p(95)=3.37ms
    http_req_failed................: 0.00% 0 out of 1
    http_reqs......................: 1     19.898478/s

    EXECUTION
    iteration_duration.............: avg=50.25ms min=50.25ms med=50.25ms max=50.25ms p(90)=50.25ms p(95)=50.25ms
    iterations.....................: 1     19.898478/s

    NETWORK
    data_received..................: 232 B 4.6 kB/s
    data_sent......................: 70 B  1.4 kB/s
```

| Row | What it means |
|-----|---------------|
| `http_req_duration` | Time from request sent to response fully received. **The headline number.** Every stat is identical here because there's only one sample. |
| `{ expected_response:true }` | The same metric, filtered to non-error responses. Diverges from the row above once you start getting 4xx/5xx — a fast failure won't flatter your average. |
| `http_req_failed` | Share of requests k6 considers failed. By default that means status < 200 or ≥ 400 — *not* slow, and not your business logic. |
| `http_reqs` | Total requests, plus throughput per second. |
| `iteration_duration` | One full pass of the default function, including `sleep()`. |
| `iterations` | Completed passes, plus rate. |
| `data_received` / `data_sent` | Bytes over the wire. Worth watching for accidentally huge payloads. |

**`iteration_duration` (50ms) is much larger than `http_req_duration` (3.37ms).** That gap is
real and expected: the iteration includes VU startup, the `console.log`, and script overhead.
When the two diverge a lot under load, your script is the bottleneck, not the server.

### Where did `vus` go?

That run shows no `vus` row. Run it duration-based and two new rows appear:

```bash
k6 run --vus 5 --duration 10s tests/01-smoke/smoke.js
```

```
    http_req_duration..............: avg=5.2ms  min=1.04ms med=4.72ms max=63.69ms p(90)=7.32ms p(95)=8.7ms
    http_req_failed................: 0.00%  0 out of 9132
    http_reqs......................: 9132   912.949359/s
    iterations.....................: 9132   912.949359/s
    vus............................: 5      min=5         max=5
    vus_max........................: 5      min=5         max=5
```

`vus` is sampled over time, so it only means something when the test runs long enough to
sample. It matters from Module 4 onward, where VU count changes during the run.

**9132 iterations in 10 seconds, at 913 req/s from 5 users.** No real user browses at 182
requests per second. Nothing here tells the VU to pause, so it loops as fast as the server
answers — this is exactly why `sleep()` exists, and Module 2 adds it.

### The sub-timings

`http_req_duration` is a sum of parts, and `--summary-mode full` breaks it out:

```bash
k6 run --vus 5 --duration 5s --summary-mode full tests/01-smoke/smoke.js
```

```
    http_req_blocked...............: avg=25.34µs  ...  max=18.79ms
    http_req_connecting............: avg=1.62µs   ...  max=1.96ms
    http_req_duration..............: avg=5.19ms   ...  max=33.92ms
    http_req_receiving.............: avg=526.12µs ...  max=17.41ms
    http_req_sending...............: avg=17.08µs  ...  max=2.51ms
    http_req_tls_handshaking.......: avg=0s       ...  max=0s
    http_req_waiting...............: avg=4.64ms   ...  max=32.75ms
```

```
http_req_duration = sending + waiting + receiving
        5.19ms    ≈  0.017  +  4.64   +  0.526          ✓
```

`http_req_blocked` and `http_req_connecting` sit *outside* `duration` — they're time spent
waiting for a connection, not waiting for the server.

- **`waiting`** is time-to-first-byte: the server thinking. Usually what you actually care about.
- **`receiving`** climbing means large responses or a slow link.
- **`blocked`** climbing means connection-pool pressure, not a slow server.
- **`tls_handshaking`** is `0s` here because the target app is plain HTTP.

### Averages lie

Look at that run: `avg=5.19ms` but `max=33.92ms`. The average hides the worst experience, and
it's the worst experience that generates complaints. This is why every threshold you'll write
from Module 3 on uses **p(95)** or p(99), not `avg`.

---

## 5. Exercise

> Write a smoke test for a public API of your choice with 1 VU / 1 iteration.

[exercise-public-api.js](exercise-public-api.js) is a starter that runs as-is against a
placeholder API:

```bash
k6 run tests/01-smoke/exercise-public-api.js
k6 run -e API_URL=https://your-api.example.com/health tests/01-smoke/exercise-public-api.js
```

Then work through the TODOs in the file:

1. Point it at a URL that 404s. Which metric moves — and which one *doesn't*?
2. Run it with `--vus 5 --duration 10s`. Which rows appear that weren't there before?
3. Add a second `http.get()`. What happens to `http_reqs` versus `iterations`?

> **Be a good citizen.** One request against someone else's public API is fine. Pointing
> `--vus 50` at it is not. Use your own service, or the target app from Module 0.

---

## Checkpoint

You should be able to answer these without scrolling up:

- [ ] Where do you put code that should run once per VU rather than every iteration?
- [ ] What does `__VU=0` in a log line tell you?
- [ ] Why is `iteration_duration` bigger than `http_req_duration`?
- [ ] Which is the server's thinking time: `http_req_waiting` or `http_req_blocked`?
- [ ] Why would you report p(95) instead of avg?
- [ ] Why did 5 VUs produce 913 requests per second, and what's missing from the script?

That last one is Module 2's opening move.

---

**Next:** [Module 2 — HTTP basics](../02-http-basics/) · [Module 0](../00-setup/) · [PLAN.md](../../PLAN.md)
