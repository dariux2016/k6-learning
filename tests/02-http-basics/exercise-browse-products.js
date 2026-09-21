// Module 2 exercise: script a "browse products" flow.
//
// The brief: list products -> fetch one product's detail -> sleep, like a
// real shopper pausing to read a description before clicking away.
//
//   k6 run tests/02-http-basics/exercise-browse-products.js
//
// Runs as-is -- it's already a valid, if incomplete, browse flow. Work
// through the TODOs below to practice this module's concepts.

import http from 'k6/http';
import { sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';

export const options = {
  vus: 1,
  iterations: 1,
};

export default function () {
  const listRes = http.get(`${BASE_URL}/products?limit=10`);
  const products = listRes.json('items');
  console.log(`listed ${products.length} products, status=${listRes.status}`);

  // TODO 1: tag this request -- add a third argument to the http.get() call
  // above: { tags: { name: 'list_products' } }. You'll be able to filter on
  // that name once metrics are grouped, starting Module 8.

  const pick = products[Math.floor(Math.random() * products.length)];
  const detailRes = http.get(`${BASE_URL}/products/${pick.id}`);
  console.log(`detail: "${detailRes.json('name')}" - $${detailRes.json('price_cents') / 100}`);

  // TODO 2: tag this request too, with a different name than TODO 1's.

  // TODO 3: add a sleep() here for "reading the product page" before the
  // iteration ends. 2-4 seconds is a believable read time -- try
  // sleep(Math.random() * 2 + 2) for some variation between iterations.

  // Stretch goal, combining this module with Module 1:
  // TODO 4: log in as user1 / k6learning (POST /login, JSON body,
  // Content-Type header), then GET /me with the token as a Bearer
  // Authorization header, and log the role it returns.
}
