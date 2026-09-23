// Module 3 demo, part 2: thresholds -- the pass/fail gate for the whole run.
//
//   k6 run tests/03-checks-thresholds/thresholds.js
//   echo $?          # 0 if every threshold held, 99 if any of them broke
//
// A check asks "was THIS response correct?" and answers per request. A
// threshold asks "was the RUN acceptable?" and answers once, at the end,
// from an aggregate metric. Only the threshold changes the exit code, which
// makes it the thing CI actually reads (Module 14).
//
// These thresholds are set to pass against a healthy local app. To watch one
// break, make the app slow in another terminal while this runs:
//
//   curl -X POST http://localhost:8000/admin/config \
//     -H 'Content-Type: application/json' -d '{"base_latency_ms": 800}'
//   curl -X POST http://localhost:8000/admin/config \
//     -H 'Content-Type: application/json' -d '{"base_latency_ms": 20}'   # undo

import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';

export const options = {
  vus: 5,
  duration: '15s',

  thresholds: {
    // ----------------------------------------------------------------- //
    // Built-in metrics. The string on the right is an expression k6
    // evaluates against the aggregated metric once the run ends.
    // ----------------------------------------------------------------- //

    // Trend metric -> aggregate by statistic. A metric can carry several
    // thresholds; ALL of them must hold.
    http_req_duration: ['p(95)<500', 'avg<300', 'max<2000'],

    // Rate metric -> a proportion between 0 and 1. http_req_failed is the
    // share of requests k6 considered failed (network error or 4xx/5xx).
    // "Under 1% of requests may fail."
    http_req_failed: ['rate<0.01'],

    // The built-in `checks` metric is the pass rate of every check() in the
    // run. This is how you make functional failures gate CI -- checks alone
    // never do.
    checks: ['rate>0.99'],

    // Counter metric -> a running total. "At least 100 requests must have
    // happened", which catches a test that silently did almost nothing.
    http_reqs: ['count>100'],

    // ----------------------------------------------------------------- //
    // Sub-metric thresholds: threshold a slice of a metric, selected by tag.
    // This is the payoff for tagging requests back in Module 2 -- the login
    // endpoint is deliberately slower than the rest of the app, so holding
    // it to the same p(95) as a product listing would be meaningless.
    // ----------------------------------------------------------------- //
    'http_req_duration{name:list_products}': ['p(95)<400'],
    'http_req_duration{name:login}': ['p(95)<900'],
    'http_req_failed{name:login}': ['rate==0'],

    // Checks can be sliced the same way, using the tags passed as check()'s
    // third argument. "Critical checks must pass 100% of the time, while the
    // overall check rate only has to clear 99%."
    'checks{check_type:critical}': ['rate==1'],

    // ----------------------------------------------------------------- //
    // abortOnFail: stop the run the moment this breaks, instead of burning
    // the remaining seconds proving it again. delayAbortEval gives the
    // metric time to collect enough samples first -- without it, one slow
    // request in the first 200ms can abort the whole test.
    //
    // Use it for the "the app is clearly broken, stop wasting time" case,
    // not as the default on every threshold: an aborted run reports partial
    // data for every other metric too.
    // ----------------------------------------------------------------- //
    iteration_duration: [
      { threshold: 'p(95)<10000', abortOnFail: true, delayAbortEval: '5s' },
    ],
  },
};

export default function () {
  const list = http.get(`${BASE_URL}/products?limit=10`, {
    tags: { name: 'list_products' },
  });
  check(list, {
    'list: status is 200': (r) => r.status === 200,
    'list: has items': (r) => r.json('items').length > 0,
  });

  sleep(1);

  const id = list.json('items.0.id');
  const detail = http.get(`${BASE_URL}/products/${id}`, {
    tags: { name: 'get_product' },
  });
  check(detail, {
    'detail: status is 200': (r) => r.status === 200,
    'detail: id matches the one we asked for': (r) => r.json('id') === id,
  });

  const login = http.post(
    `${BASE_URL}/login`,
    JSON.stringify({ username: `user${(__VU % 10) + 1}`, password: 'k6learning' }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'login' } },
  );

  // Tagged as critical: auth working is not a "99% of the time" proposition,
  // so it gets its own rate==1 threshold above.
  check(
    login,
    {
      'login: status is 200': (r) => r.status === 200,
      'login: returned a token': (r) => typeof r.json('token') === 'string',
    },
    { check_type: 'critical' },
  );

  sleep(1);
}
