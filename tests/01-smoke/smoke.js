// The repo's first real test: does the target app answer at all?
//
// Deliberately the smallest thing that can work -- one VU, one iteration, one
// request, no checks or thresholds yet. Module 1 takes this exact file apart line
// by line; Module 3 is where it grows assertions.
//
//   k6 run tests/01-smoke/smoke.js
//   k6 run -e BASE_URL=http://localhost:8000 tests/01-smoke/smoke.js

import http from 'k6/http';

// __ENV reads an environment variable passed with `-e KEY=value`. Module 6 covers
// it properly; here it just keeps the URL out of the script for CI.
const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';

export const options = {
  vus: 1,
  iterations: 1,
};

export default function () {
  const res = http.get(`${BASE_URL}/`);

  console.log(`status=${res.status} body=${res.body}`);
}
