// Module 1 demo: proving where k6 code actually runs.
//
// Reading that "init code runs once per VU" is one thing. This script makes it
// visible -- run it and watch which lines print, how often, and in what order.
//
//   k6 run tests/01-smoke/lifecycle.js

import http from 'k6/http';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';

export const options = {
  vus: 2,
  iterations: 6,
};

// ---------------------------------------------------------------------------
// INIT CODE -- everything at the top level of the module.
//
// This block runs once per VU, before that VU's first iteration. It does NOT
// run once per test -- and it runs MORE often than you would guess. With
// vus: 2 you get four [init] lines, not two. See the notes at the bottom.
// ---------------------------------------------------------------------------
console.log(`[init] module loaded, __VU=${__VU}`);

// Each VU gets its own private copy of this variable. VUs never share memory,
// so this counter tracks one VU's own work -- it is not a global total.
let iterationsRunByThisVU = 0;

// ---------------------------------------------------------------------------
// VU CODE -- the default function.
//
// Runs once per iteration, repeatedly, for as long as the test says. This is
// the only place you should make requests.
// ---------------------------------------------------------------------------
export default function () {
  iterationsRunByThisVU++;

  // __VU  = which virtual user am I?    (1-based)
  // __ITER = which iteration is this?   (0-based, per VU)
  console.log(
    `[default] __VU=${__VU} __ITER=${__ITER} ` +
      `(this VU has now run ${iterationsRunByThisVU} iteration(s))`,
  );

  http.get(`${BASE_URL}/`);
}

// Things worth noticing in the output:
//
// 1. [init] prints FOUR times for 2 VUs, with __VU values 0, 1, 2, 0:
//      __VU=0  before the test -- k6 loads the module once just to read options
//      __VU=1  VU 1 initialising
//      __VU=2  VU 2 initialising
//      __VU=0  once more after the test finishes
//    __VU=0 means "no VU yet". That is the tell: code running with __VU=0 is
//    not inside a virtual user, so it must not make requests.
//
// 2. The order of the VU inits is not deterministic -- across runs you will see
//    both 0,1,2,0 and 0,2,1,0. Never write init code that depends on it.
//
// 3. Each VU's counter climbs independently, ending at 3 and 3 rather than one
//    shared 6. VUs do not share memory.
//
// 4. Those 6 iterations come from a SHARED pool that VUs pull from as they
//    finish. Here every iteration costs the same, so it lands on a tidy 3/3 --
//    but that is not guaranteed. Give one VU slower work and it takes fewer.
//    Module 5 covers per-vu-iterations, the executor that does guarantee an
//    even split.
