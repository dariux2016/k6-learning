// Module 0 exercise: prove the k6 binary works before touching anything local.
//
// This is the only script in the repo that talks to the internet. It hits
// test.k6.io, Grafana's public demo site, which exists specifically to be
// load-tested. One VU, one iteration -- polite, and enough to confirm the install.
//
//   k6 run tests/00-setup/verify-install.js

import http from 'k6/http';

export const options = {
  vus: 1,
  iterations: 1,
};

export default function () {
  const res = http.get('https://test.k6.io/');

  console.log(`status=${res.status} duration=${Math.round(res.timings.duration)}ms`);
}
