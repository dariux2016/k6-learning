// Module 3 exercise: set thresholds that fail on purpose, watch the non-zero
// exit code, then fix them to realistic values.
//
//   k6 run tests/03-checks-thresholds/exercise-failing-thresholds.js
//   echo $?            # bash        -> expect 99
//   $LASTEXITCODE      # PowerShell  -> expect 99
//
// As written, this FAILS, and that is the point. It hits /unstable, which is
// built to be slow and flaky (500ms and a 25% error rate by default), and
// then holds it to thresholds no endpoint like that could ever meet.
//
// Work through the TODOs to turn it green.

import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';

// Both tunables come from the CLI so you can change how the endpoint behaves
// without touching the script:
//   k6 run -e DELAY_MS=50 -e ERROR_RATE=0 tests/03-checks-thresholds/exercise-failing-thresholds.js
const DELAY_MS = __ENV.DELAY_MS || '500';
const ERROR_RATE = __ENV.ERROR_RATE || '0.25';

export const options = {
  vus: 3,
  duration: '10s',

  thresholds: {
    // Impossible #1: /unstable sleeps 500ms before it even starts replying,
    // so p(95) cannot come in under 100ms.
    http_req_duration: ['p(95)<100'],

    // Impossible #2: the endpoint fails ~25% of the time by default.
    http_req_failed: ['rate<0.01'],

    // Impossible #3: the status check below fails whenever the request does.
    checks: ['rate>0.99'],

    // TODO 1: run it as-is. Read the summary -- broken thresholds are marked
    // with a red cross and print the actual value that broke them. Then read
    // the exit code: 99, not 0. That number is the whole reason thresholds
    // exist, and Module 14 is where CI starts acting on it.
    //
    // TODO 2: relax the three thresholds above until the run passes against
    // /unstable's real behaviour. The delay is 500ms, the error rate is 0.25,
    // and a check only passes when the request does. Aim for numbers that
    // would still catch a genuine regression -- 'p(95)<10000' passes but
    // asserts nothing.
    //
    // TODO 3: tag the health request below with { tags: { name: 'fast_path' } }
    // and add a sub-metric threshold for it:
    //   'http_req_duration{name:fast_path}': ['p(95)<300'],
    // The health endpoint does no artificial work, so it holds a much tighter
    // bar than /unstable -- that is the case for per-endpoint SLOs instead of
    // one global number covering endpoints with nothing in common.
    //
    // TODO 4: add the object form of a threshold, which is what carries
    // abortOnFail:
    //   'http_req_failed{name:unstable}': [
    //     { threshold: 'rate<0.5', abortOnFail: true, delayAbortEval: '3s' },
    //   ],
    // then run with -e ERROR_RATE=0.9 and watch the run stop after ~4s instead
    // of spending the full 10s re-proving the same failure.
    //
    // Note the {name:unstable} scope: half the requests in this script go to
    // the healthy / endpoint, so an UNSCOPED http_req_failed can never get
    // much above 50% no matter how broken /unstable is -- at ERROR_RATE=0.9 it
    // lands around 47% and 'rate<0.5' never trips. Averaging a broken endpoint
    // together with a healthy one hides the breakage. That is the argument for
    // per-endpoint thresholds in one line.
  },
};

export default function () {
  const res = http.get(
    `${BASE_URL}/unstable?delay_ms=${DELAY_MS}&error_rate=${ERROR_RATE}`,
    { tags: { name: 'unstable' } },
  );

  check(res, {
    'unstable: status is 200': (r) => r.status === 200,
  });

  // TODO 3 applies to this request.
  const health = http.get(`${BASE_URL}/`);
  check(health, {
    'health: status is 200': (r) => r.status === 200,
  });

  sleep(1);
}
