// Module 2 demo: the full HTTP toolkit -- verbs, headers, payloads, and the
// response object. Run it once and read top to bottom; the console.log lines
// are commentary on what each response actually looked like.
//
//   k6 run tests/02-http-basics/http-basics.js
//
// No check() yet -- Module 3 turns these console.log lines into real
// pass/fail assertions. For now this is vocabulary: which function for which
// verb, what a params object looks like, what's on `res`.
//
// This script deletes a product on every run. Reset the app between runs so
// product IDs stay predictable:
//
//   curl -X POST http://localhost:8000/admin/reset

import http from 'k6/http';
import { sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';

export const options = {
  vus: 1,
  iterations: 1,
};

export default function () {
  // ------------------------------------------------------------------- //
  // GET -- no body. Query params go straight in the URL string; k6 has no
  // separate "query" option for http.get like some libraries do.
  // ------------------------------------------------------------------- //
  const list = http.get(`${BASE_URL}/products?limit=5`, {
    tags: { name: 'list_products' },
  });
  console.log(`GET /products         -> ${list.status}, ${list.json('total')} total in store`);

  sleep(1); // think time: a real shopper reads the list before clicking one

  const firstId = list.json('items.0.id');
  const detail = http.get(`${BASE_URL}/products/${firstId}`, {
    tags: { name: 'get_product' },
  });
  console.log(`GET /products/${firstId}      -> ${detail.status} "${detail.json('name')}"`);

  // ------------------------------------------------------------------- //
  // POST -- body is the second argument, headers/tags live in the third
  // "params" object. k6 does NOT set Content-Type for you -- forget the
  // header and the body arrives as a string FastAPI can't parse.
  // ------------------------------------------------------------------- //
  const loginRes = http.post(
    `${BASE_URL}/login`,
    JSON.stringify({ username: 'user1', password: 'k6learning' }),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { name: 'login' },
    },
  );
  const token = loginRes.json('token');
  console.log(`POST /login            -> ${loginRes.status}, token=${token.slice(0, 12)}...`);

  // ------------------------------------------------------------------- //
  // Authorization header -- everything from here on needs it. Build the
  // params object once and reuse it, the same way a real script would.
  // ------------------------------------------------------------------- //
  const authParams = { headers: { Authorization: `Bearer ${token}` } };

  const me = http.get(`${BASE_URL}/me`, { ...authParams, tags: { name: 'me' } });
  console.log(`GET /me                -> ${me.status} role=${me.json('role')}`);

  const cart = http.post(`${BASE_URL}/cart`, null, {
    ...authParams,
    tags: { name: 'create_cart' },
  });
  const cartId = cart.json('id');
  console.log(`POST /cart              -> ${cart.status}, cart id=${cartId}`);

  const addItem = http.post(
    `${BASE_URL}/cart/${cartId}/items`,
    JSON.stringify({ product_id: firstId, quantity: 2 }),
    {
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      tags: { name: 'add_cart_item' },
    },
  );
  console.log(`POST /cart/${cartId}/items -> ${addItem.status}`);

  sleep(1);

  // ------------------------------------------------------------------- //
  // PUT -- a partial update, JSON body again. No auth required on this app,
  // but the Content-Type rule still applies.
  // ------------------------------------------------------------------- //
  const putRes = http.put(`${BASE_URL}/products/${firstId}`, JSON.stringify({ stock: 999 }), {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'update_product' },
  });
  console.log(`PUT /products/${firstId}      -> ${putRes.status}, stock=${putRes.json('stock')}`);

  // ------------------------------------------------------------------- //
  // DELETE -- no body. This endpoint returns 204 No Content, so res.body
  // is empty; there is nothing to call .json() on.
  // ------------------------------------------------------------------- //
  const deleteRes = http.del(`${BASE_URL}/products/${firstId}`, null, {
    tags: { name: 'delete_product' },
  });
  console.log(`DELETE /products/${firstId}   -> ${deleteRes.status}, body="${deleteRes.body}"`);

  // ------------------------------------------------------------------- //
  // The response object, all in one place. Everything below reuses `me`,
  // captured earlier, since it's still a normal 200 with a JSON body.
  // ------------------------------------------------------------------- //
  console.log('--- anatomy of a response (from GET /me above) ---');
  console.log(`res.status                    : ${me.status}`);
  console.log(`res.headers['Content-Type']   : ${me.headers['Content-Type']}`);
  console.log(`res.body (raw string)         : ${me.body}`);
  console.log(`res.json()                    : ${JSON.stringify(me.json())}`);
  console.log(`res.json('role') (gjson path) : ${me.json('role')}`);
  console.log(`res.timings.duration          : ${Math.round(me.timings.duration)}ms`);

  sleep(1);
}
