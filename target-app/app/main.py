"""k6-learning target app.

A small, disposable REST API to load-test against. It exists so that every module in
PLAN.md has a realistic target that runs offline, costs nothing, and can be told to
misbehave on demand.

Run it with:  uvicorn app.main:app --host 0.0.0.0 --port 8000
"""

import asyncio
import random
import time

from fastapi import Body, FastAPI, Header, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .auth import create_token, decode_token
from .config import settings
from .store import store

app = FastAPI(
    title="k6-learning target app",
    description="Disposable API used as a load-testing target while learning k6.",
    version="1.0.0",
)

STARTED_AT = time.time()

# Number of requests currently being served. Drives the capacity model below.
_inflight = 0
_inflight_lock = asyncio.Lock()
_peak_inflight = 0


# --------------------------------------------------------------------------- #
# Concurrency / capacity simulation
# --------------------------------------------------------------------------- #
@app.middleware("http")
async def track_concurrency(request: Request, call_next):
    """Count in-flight requests and shed load once the app is saturated.

    This is what turns a flat in-memory API into something with a breaking point:
    latency climbs past `capacity`, and past `max_inflight` the app returns 503.
    """
    global _inflight, _peak_inflight

    async with _inflight_lock:
        _inflight += 1
        current = _inflight
        _peak_inflight = max(_peak_inflight, current)

    try:
        if current > settings.max_inflight and not request.url.path.startswith("/admin"):
            return JSONResponse(
                status_code=503,
                content={"error": "overloaded", "inflight": current},
                headers={"Retry-After": "1"},
            )
        response = await call_next(request)
    finally:
        async with _inflight_lock:
            _inflight -= 1

    response.headers["X-Inflight"] = str(current)
    return response


async def simulate_work(base_ms: int | None = None) -> None:
    """Sleep for a realistic-looking amount of time.

    = flat floor + random jitter + a penalty proportional to how far over
    `capacity` the app currently is.
    """
    floor = settings.base_latency_ms if base_ms is None else base_ms
    jitter = random.uniform(0, settings.base_latency_jitter_ms)
    excess = max(0, _inflight - settings.capacity)
    penalty = excess * settings.degrade_ms_per_excess
    await asyncio.sleep((floor + jitter + penalty) / 1000.0)


# --------------------------------------------------------------------------- #
# Auth helpers
# --------------------------------------------------------------------------- #
def require_user(authorization: str | None) -> dict:
    """Validate an `Authorization: Bearer <jwt>` header, or raise 401."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    payload = decode_token(authorization.split(" ", 1)[1].strip())
    if payload is None:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return payload


# --------------------------------------------------------------------------- #
# Request models
# --------------------------------------------------------------------------- #
class LoginRequest(BaseModel):
    username: str
    password: str


class ProductUpdate(BaseModel):
    name: str | None = None
    category: str | None = None
    price_cents: int | None = Field(default=None, ge=0)
    stock: int | None = Field(default=None, ge=0)


class CartItemRequest(BaseModel):
    product_id: int
    quantity: int = Field(default=1, ge=1, le=100)


# --------------------------------------------------------------------------- #
# Health
# --------------------------------------------------------------------------- #
@app.get("/")
async def root():
    """Health check. Intentionally does no artificial work, so it stays fast."""
    return {
        "status": "ok",
        "service": "k6-learning target app",
        "version": app.version,
        "uptime_seconds": round(time.time() - STARTED_AT, 1),
    }


@app.get("/health")
async def health():
    return await root()


# --------------------------------------------------------------------------- #
# Products
# --------------------------------------------------------------------------- #
@app.get("/products")
async def list_products(limit: int = 20, offset: int = 0, category: str | None = None):
    await simulate_work()
    items = list(store.products.values())
    if category:
        items = [p for p in items if p["category"] == category]
    total = len(items)
    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": items[offset: offset + limit],
    }


@app.get("/products/{product_id}")
async def get_product(product_id: int):
    await simulate_work()
    product = store.products.get(product_id)
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")
    return product


@app.put("/products/{product_id}")
async def update_product(product_id: int, update: ProductUpdate):
    await simulate_work()
    product = store.products.get(product_id)
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")
    product.update({k: v for k, v in update.model_dump().items() if v is not None})
    return product


@app.delete("/products/{product_id}", status_code=204)
async def delete_product(product_id: int):
    await simulate_work()
    if store.products.pop(product_id, None) is None:
        raise HTTPException(status_code=404, detail="Product not found")
    return Response(status_code=204)


# --------------------------------------------------------------------------- #
# Auth
# --------------------------------------------------------------------------- #
@app.post("/login")
async def login(credentials: LoginRequest):
    """Seeded users are user1..user10, all with password 'k6learning'."""
    await simulate_work(base_ms=settings.login_latency_ms)
    user = store.users.get(credentials.username)
    if user is None or user["password"] != credentials.password:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token, expires_in = create_token(user["username"], user["role"])
    return {
        "token": token,
        "token_type": "Bearer",
        "expires_in": expires_in,
        "username": user["username"],
        "role": user["role"],
    }


@app.get("/me")
async def me(authorization: str | None = Header(default=None)):
    user = require_user(authorization)
    await simulate_work()
    return {"username": user["sub"], "role": user["role"], "expires_at": user["exp"]}


# --------------------------------------------------------------------------- #
# Cart + checkout  (all require a bearer token)
# --------------------------------------------------------------------------- #
@app.post("/cart", status_code=201)
async def create_cart(authorization: str | None = Header(default=None)):
    user = require_user(authorization)
    await simulate_work()
    return store.create_cart(user["sub"])


@app.get("/cart/{cart_id}")
async def get_cart(cart_id: int, authorization: str | None = Header(default=None)):
    user = require_user(authorization)
    await simulate_work()
    cart = store.carts.get(cart_id)
    if cart is None:
        raise HTTPException(status_code=404, detail="Cart not found")
    if cart["owner"] != user["sub"] and user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Not your cart")
    return cart


@app.post("/cart/{cart_id}/items")
async def add_cart_item(
    cart_id: int,
    item: CartItemRequest,
    authorization: str | None = Header(default=None),
):
    user = require_user(authorization)
    await simulate_work()
    cart = store.carts.get(cart_id)
    if cart is None:
        raise HTTPException(status_code=404, detail="Cart not found")
    if cart["owner"] != user["sub"]:
        raise HTTPException(status_code=403, detail="Not your cart")
    if cart["status"] != "open":
        raise HTTPException(status_code=409, detail="Cart already checked out")
    product = store.products.get(item.product_id)
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")
    return store.add_item(cart, product, item.quantity)


@app.post("/checkout", status_code=201)
async def checkout(
    cart_id: int = Body(..., embed=True),
    authorization: str | None = Header(default=None),
):
    user = require_user(authorization)
    await simulate_work()
    cart = store.carts.get(cart_id)
    if cart is None:
        raise HTTPException(status_code=404, detail="Cart not found")
    if cart["owner"] != user["sub"]:
        raise HTTPException(status_code=403, detail="Not your cart")
    if cart["status"] != "open":
        raise HTTPException(status_code=409, detail="Cart already checked out")
    if not cart["items"]:
        raise HTTPException(status_code=422, detail="Cart is empty")
    return store.create_order(cart)


# --------------------------------------------------------------------------- #
# The deliberately unreliable endpoint
# --------------------------------------------------------------------------- #
@app.get("/unstable")
async def unstable(delay_ms: int | None = None, error_rate: float | None = None):
    """Slow and/or failing on demand.

    Defaults come from UNSTABLE_DELAY_MS / UNSTABLE_ERROR_RATE, and either can be
    overridden per request via query string -- which is how Module 3 makes a
    threshold fail without restarting anything.
    """
    delay = settings.unstable_delay_ms if delay_ms is None else max(0, delay_ms)
    rate = (
        settings.unstable_error_rate
        if error_rate is None
        else min(max(error_rate, 0.0), 1.0)
    )

    await asyncio.sleep(delay / 1000.0)
    if random.random() < rate:
        raise HTTPException(status_code=500, detail="Simulated upstream failure")
    return {"ok": True, "delay_ms": delay, "error_rate": rate}


# --------------------------------------------------------------------------- #
# Admin: reset state and retune behaviour without a restart
# --------------------------------------------------------------------------- #
@app.post("/admin/reset")
async def admin_reset():
    """Put the store back to its seeded state. Useful from k6 setup()/teardown()."""
    global _peak_inflight
    store.reset()
    _peak_inflight = 0
    return {"reset": True, **store.stats()}


@app.get("/admin/config")
async def get_config():
    return {
        "config": settings.as_dict(),
        "inflight": _inflight,
        "peak_inflight": _peak_inflight,
        **store.stats(),
    }


@app.post("/admin/config")
async def set_config(changes: dict = Body(...)):
    """Patch tunables at runtime, e.g. {"base_latency_ms": 400}."""
    applied, ignored = {}, []
    for key, value in changes.items():
        if key == "jwt_secret" or not hasattr(settings, key):
            ignored.append(key)
            continue
        current = getattr(settings, key)
        try:
            setattr(settings, key, type(current)(value))
            applied[key] = getattr(settings, key)
        except (TypeError, ValueError):
            ignored.append(key)
    return {"applied": applied, "ignored": ignored, "config": settings.as_dict()}
