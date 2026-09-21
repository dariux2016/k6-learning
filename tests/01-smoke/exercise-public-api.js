// Module 1 exercise: write a smoke test for a public API of your choice.
//
// Runs as-is against a placeholder API so you can confirm the shape works, then
// swap in something you actually care about. Keep it at 1 VU / 1 iteration --
// a smoke test asks "does this work at all", not "how fast is it".
//
//   k6 run tests/01-smoke/exercise-public-api.js
//
// Be a good citizen: point this at your own service, or at an API that
// documents that it welcomes traffic. One request is fine; a load test against
// someone else's public API without permission is not.

import http from 'k6/http';

// TODO: swap this for the API you want to smoke-test.
const API_URL = __ENV.API_URL || 'https://jsonplaceholder.typicode.com/todos/1';

export const options = {
  vus: 1,
  iterations: 1,
};

export default function () {
  const res = http.get(API_URL);

  // For now, inspect by logging. Module 3 replaces this with check(), which
  // records pass/fail properly instead of making you read the output yourself.
  console.log(`status  : ${res.status}`);
  console.log(`duration: ${Math.round(res.timings.duration)}ms`);
  console.log(`body    : ${res.body.slice(0, 200)}`);

  // TODO: try each of these and watch what the summary does.
  //   1. Point API_URL at a 404 on the same host. Which metric moves?
  //   2. Run it with --vus 5 --duration 10s. Which new rows appear?
  //   3. Add a second http.get() here. What happens to http_reqs vs iterations?
}
