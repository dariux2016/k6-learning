// Module 3 demo, part 1: check() -- functional assertions on a response.
//
//   k6 run tests/03-checks-thresholds/checks.js
//
// Module 2 logged what came back. This asserts it. The important thing to
// watch: this script contains checks that fail ON PURPOSE, and the run still
// exits 0. Checks record pass/fail, they do not gate the test. Thresholds
// (thresholds.js) are what gate the test.
//
// Check the exit code yourself after running:
//   bash:       echo $?
//   PowerShell: $LASTEXITCODE

import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';

export const options = {
  vus: 1,
  iterations: 1,
};

export default function () {
  // ------------------------------------------------------------------- //
  // 1. The basic shape: check(value, { 'name': (v) => boolean, ... })
  //
  // Each key is a label that shows up in the summary; each value is a
  // function returning something truthy or falsy. One check() call can hold
  // as many assertions as you like -- they're recorded individually.
  // ------------------------------------------------------------------- //
  const list = http.get(`${BASE_URL}/products?limit=5`, {
    tags: { name: 'list_products' },
  });

  const allPassed = check(list, {
    'list: status is 200': (r) => r.status === 200,
    'list: body has an items array': (r) => Array.isArray(r.json('items')),
    'list: returned exactly 5 products': (r) => r.json('items').length === 5,
    'list: responded in under 500ms': (r) => r.timings.duration < 500,
  });

  // check() returns a single boolean: true only if EVERY assertion in the
  // call passed. Use it when the next step is pointless without this one.
  console.log(`check() returned ${allPassed}`);

  // ------------------------------------------------------------------- //
  // 2. A check that fails on purpose.
  //
  // It records a failure, prints a red line in the summary, and then... the
  // script keeps going. That is the whole lesson of this file.
  // ------------------------------------------------------------------- //
  check(list, {
    'DELIBERATE FAIL: store has 1000 products': (r) => r.json('total') === 1000,
  });

  console.log('still running after a failed check -- checks never abort anything');

  sleep(1);

  // ------------------------------------------------------------------- //
  // 3. Checks that matter: assert on a response you EXPECT to be bad.
  //
  // /unstable?error_rate=1 always returns 500. A test with no checks would
  // report this as a successful-looking iteration: the request completed,
  // http_req_duration got a sample, nothing complained. The check is the
  // only thing that notices the 500.
  // ------------------------------------------------------------------- //
  const broken = http.get(`${BASE_URL}/unstable?delay_ms=0&error_rate=1`, {
    tags: { name: 'unstable' },
  });

  check(broken, {
    'DELIBERATE FAIL: unstable returned 200': (r) => r.status === 200,
    'unstable did return SOMETHING': (r) => r.status !== 0,
  });

  // ------------------------------------------------------------------- //
  // 4. Tagging checks.
  //
  // The third argument to check() is a tags object, exactly like the one on
  // a request. Tagged checks can be thresholded separately -- see the
  // 'checks{check_type:critical}' threshold in thresholds.js.
  // ------------------------------------------------------------------- //
  const login = http.post(
    `${BASE_URL}/login`,
    JSON.stringify({ username: 'user1', password: 'k6learning' }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'login' } },
  );

  check(
    login,
    {
      'login: status is 200': (r) => r.status === 200,
      'login: returned a token': (r) => typeof r.json('token') === 'string',
    },
    { check_type: 'critical' },
  );

  // ------------------------------------------------------------------- //
  // 5. The trap: a check callback that THROWS kills the iteration.
  //
  // A check is not a try/catch. If the callback throws -- and res.json()
  // throws on any body that isn't valid JSON -- the iteration dies right
  // there, and everything after it in this function never runs.
  //
  // DELETE returns 204 No Content, so res.body is null and res.json()
  // throws. The unsafe version is commented out; uncomment it to watch the
  // iteration end early and the summary report fewer checks than expected.
  // ------------------------------------------------------------------- //
  const deleted = http.del(`${BASE_URL}/products/20`, null, {
    tags: { name: 'delete_product' },
  });

  // UNSAFE -- would throw on a 204's empty body:
  // check(deleted, { 'deleted: name is gone': (r) => r.json('name') === undefined });

  // SAFE -- check the status first, and only parse when there's a body.
  check(deleted, {
    'delete: status is 204': (r) => r.status === 204,
    'delete: body is empty': (r) => !r.body,
  });

  // ------------------------------------------------------------------- //
  // 6. Acting on a failed check.
  //
  // check() gates nothing by itself. If the rest of the iteration is
  // meaningless without this response, you branch on the boolean yourself.
  // ------------------------------------------------------------------- //
  const token = login.json('token');
  const gotToken = check(token, { 'have a usable token': (t) => !!t });

  if (!gotToken) {
    console.warn('no token -- skipping the authenticated part of the iteration');
    return; // ends this iteration only; the test itself continues
  }

  const me = http.get(`${BASE_URL}/me`, {
    headers: { Authorization: `Bearer ${token}` },
    tags: { name: 'me' },
  });

  check(me, {
    'me: status is 200': (r) => r.status === 200,
    'me: username echoes back': (r) => r.json('username') === 'user1',
  });

  sleep(1);
}
