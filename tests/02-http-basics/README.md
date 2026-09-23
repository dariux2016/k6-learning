# Module 2 — HTTP basics

**Goal:** cover the full HTTP toolkit — verbs, headers, payloads, and everything on the
response object — against a real stateful API instead of one health-check endpoint.

Module 1 ended on a question: 5 VUs with no `sleep()` produced 913 requests/second. Nothing in
that script paused for anything, so it hammered the server as fast as it could reply. This
module fixes that, and adds the other three HTTP verbs and request bodies along the way.

**Files here**

| File | Purpose |
|------|---------|
| [http-basics.js](http-basics.js) | Every verb, header, and response field, in one annotated flow. |
| [exercise-browse-products.js](exercise-browse-products.js) | Starter for the exercise. |

---

## 1. The four verbs

k6 gives you one function per HTTP method: `http.get()`, `http.post()`, `http.put()`,
`http.del()` (not `delete` — that's a reserved word in JS). Each takes the same shape:

```js
http.get(url, params);
http.post(url, body, params);
http.put(url, body, params);
http.del(url, body, params);
```

`GET` and `DELETE` have no meaningful body, so their second argument is either omitted or
`null`. `POST` and `PUT` take the body as their **second** argument — not inside `params` —
which is the single most common place people get the signature wrong.

```js
// GET -- query params go straight in the URL string, k6 has no separate option for them
const list = http.get(`${BASE_URL}/products?limit=5`, { tags: { name: 'list_products' } });

// POST -- body is argument #2, headers/tags are argument #3
const loginRes = http.post(
  `${BASE_URL}/login`,
  JSON.stringify({ username: 'user1', password: 'k6learning' }),
  { headers: { 'Content-Type': 'application/json' }, tags: { name: 'login' } },
);

// PUT -- same shape as POST, different verb
http.put(`${BASE_URL}/products/${id}`, JSON.stringify({ stock: 999 }), { headers: {...} });

// DELETE -- no body, so it's null
http.del(`${BASE_URL}/products/${id}`, null, { tags: { name: 'delete_product' } });
```

---

## 2. `JSON.stringify` and the Content-Type header

k6 does not know your body is JSON just because it looks like an object. You stringify it
yourself, and you set `Content-Type` yourself — k6 sends raw bytes and stays out of the way.
Forget the header and the server sees a string it can't parse:

```
POST /login with JSON.stringify(...) but NO Content-Type header:
status=422 body={"detail":[{"type":"model_attributes_type","loc":["body"],
  "msg":"Input should be a valid dictionary or object to extract fields from", ...}]}
```

FastAPI (this app's framework) still received *something* — the raw string — it just has no
idea it should parse it as JSON without the header telling it so. A 422, not a 401 or a
connection error: the request worked, the *body* didn't. That distinction matters once
Module 3 turns status codes into pass/fail checks.

---

## 3. Headers and the params object

The third argument to every verb (second for GET/DELETE) is the **params object** — the same
shape every time, regardless of verb:

```js
{
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  tags: { name: 'add_cart_item' },
}
```

Once you have a token, build that object once and spread it into each authenticated call
instead of repeating the header:

```js
const authParams = { headers: { Authorization: `Bearer ${token}` } };

http.get(`${BASE_URL}/me`, { ...authParams, tags: { name: 'me' } });
http.post(`${BASE_URL}/cart`, null, { ...authParams, tags: { name: 'create_cart' } });
```

**Tags** (`{ tags: { name: '...' } }`) don't change the request at all — they attach a label to
its metrics. Without one, k6 tags every request with its literal URL, which means
`GET /products/1` and `GET /products/2` show up as different metrics even though they're the
same logical request. A `name` tag collapses them back into one series. You won't see the
payoff until Modules 3 and 8, where thresholds and custom summaries filter and group by tag —
for now, get in the habit of tagging every request as you write it, because retrofitting tags
onto a 500-line test file later is much less fun.

---

## 4. The response object

Every call returns a `Response`. [http-basics.js](http-basics.js) logs one in full — real
output from a local run:

```
res.status                    : 200
res.headers['Content-Type']   : application/json
res.body (raw string)         : {"username":"user1","role":"admin","expires_at":1789990255}
res.json()                    : {"username":"user1","role":"admin","expires_at":1789990255}
res.json('role') (gjson path) : admin
res.timings.duration          : 40ms
```

| Field | What it is |
|-------|------------|
| `res.status` | The HTTP status code, as a number. |
| `res.body` | The raw response body as a string, always. |
| `res.json()` | Parses `res.body` as JSON. Throws if the body isn't valid JSON — don't call it on a `204 No Content`. |
| `res.json('path.to.field')` | Parses *and* extracts in one step, using [gjson](https://github.com/tidwall/gjson) path syntax. `res.json('items.0.id')` reads the `id` of the first element of an `items` array without you writing `res.json().items[0].id` and risking a crash on an empty array. |
| `res.headers` | An object of response headers, keyed by name. |
| `res.timings.duration` | Total request time in milliseconds — the same number that feeds `http_req_duration` in the summary. |

`res.json()` parses the body fresh every time you call it, so calling it three times to read
three fields does three parses. For a couple of fields it doesn't matter; in a hot loop, parse
once and destructure, or use the gjson-path form to grab only what you need.

**A 204 has no body.** `DELETE /products/1` in the demo script returns `204 No Content`:

```
DELETE /products/1   -> 204, body="null"
```

`res.body` on a truly empty response is `null`, not `""` — check for that before calling
`.json()` on a response you're not sure has a body.

---

## 5. `sleep()` — think time

Module 1 ended with 5 VUs producing 913 requests/second and no explanation for why that's
unrealistic. Here's the explanation: nothing told the VU to pause, so as soon as one response
came back it fired the next request immediately. A real user reads a product page, decides,
*then* clicks — that pause is think time, and `sleep()` is how you put it back in:

```js
import { sleep } from 'k6';

sleep(1);                       // pause 1 second
sleep(Math.random() * 2 + 2);   // pause 2-4 seconds, with variation between iterations
```

`sleep()` counts toward `iteration_duration` but **not** toward `http_req_duration` — it isn't
network time, so it shouldn't look like network time in your metrics. [http-basics.js](http-basics.js)
sleeps three times (after listing products, after adding to cart, at the end), which is why its
one iteration takes ~3.4s wall-clock despite ~8 requests that individually average ~51ms:

```
http_req_duration..............: avg=51.31ms ... max=145.01ms
iteration_duration.............: avg=3.41s   ... (dominated by the three sleep(1) calls)
http_reqs......................: 8      2.342178/s
```

Without any `sleep()`, N virtual users converge on roughly `N / avg_request_time` requests per
second — a number driven entirely by how fast the server replies, not by how real users behave.
With `sleep()` in the loop, load becomes a function of *your* script, which is the whole point:
you're modeling user behavior, not writing a raw throughput benchmark.

---

## 6. Running it

```bash
k6 run tests/02-http-basics/http-basics.js
```

This script **deletes a product on every run** (the last step, to demonstrate `DELETE`), which
shifts which product ID is "first" on the next run. Reset between runs to keep it predictable:

```bash
curl -X POST http://localhost:8000/admin/reset
k6 run tests/02-http-basics/http-basics.js
```

That's a small, deliberate preview of a real problem: tests that mutate shared state need a
known starting point, or run N depends on what run N-1 left behind. Module 7's `setup()` /
`teardown()` is where this stops being a manual `curl` step.

---

## 7. Exercise

> Script a "browse products" flow: list products → fetch one product detail → sleep.

[exercise-browse-products.js](exercise-browse-products.js) already does the list → detail
part. Real output from a run:

```
listed 10 products, status=200
detail: "Echo Earbuds" - $39.99
```

Work through its TODOs:

1. Tag the list request with `{ tags: { name: 'list_products' } }`.
2. Tag the detail request with a different name.
3. Add a `sleep()` for "reading the product page" before the iteration ends.
4. Stretch goal: log in and fetch `/me`, combining this module with Module 1's lifecycle.

---

## Checkpoint

You should be able to answer these without scrolling up:

- [ ] Where does a POST's body go — in `params`, or as its own argument?
- [ ] What happens if you `JSON.stringify()` a body but forget `Content-Type`?
- [ ] What's the difference between `res.json()` and `res.json('field.path')`?
- [ ] Why is `res.body` `null` rather than `""` after a `204 No Content`?
- [ ] Does `sleep()` count toward `http_req_duration`, `iteration_duration`, both, or neither?
- [ ] Why did removing `sleep()` in Module 1 produce 913 requests/second from only 5 VUs?

---

**Next:** [Module 3 — Checks and thresholds](../03-checks-thresholds/) · [Module 1](../01-smoke/) · [PLAN.md](../../PLAN.md)
