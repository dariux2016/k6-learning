"""In-memory data store. No database on purpose: the whole app is disposable and
a restart (or POST /admin/reset) puts it back in a known state.
"""

import itertools
import threading

CATEGORIES = ["audio", "wearables", "peripherals", "displays", "storage"]

# Deterministic seed data, so a test that asserts on product 7 asserts the same
# thing on every machine and every run.
_PRODUCT_NAMES = [
    "Nimbus Headphones", "Echo Earbuds", "Cadence Speaker", "Pulse Soundbar",
    "Orbit Smartwatch", "Stride Fitness Band", "Vertex Ring", "Halo Sleep Tracker",
    "Glide Keyboard", "Apex Mouse", "Tempo Trackpad", "Cobalt Webcam",
    "Vista 27 Monitor", "Vista 34 Ultrawide", "Lumen Portable Display",
    "Vault 1TB SSD", "Vault 4TB SSD", "Relay USB-C Hub", "Beacon Dock",
    "Anchor Stand",
]

USER_PASSWORD = "k6learning"  # same password for every seeded user, by design


class Store:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.reset()

    def reset(self) -> None:
        with self._lock:
            self.products = {
                i: {
                    "id": i,
                    "name": name,
                    "category": CATEGORIES[(i - 1) % len(CATEGORIES)],
                    "price_cents": 1999 + (i * 1000),
                    "stock": 100,
                }
                for i, name in enumerate(_PRODUCT_NAMES, start=1)
            }
            self.users = {
                f"user{i}": {
                    "username": f"user{i}",
                    "email": f"user{i}@example.com",
                    "password": USER_PASSWORD,
                    "role": "admin" if i == 1 else "customer",
                }
                for i in range(1, 11)
            }
            self.carts = {}
            self.orders = {}
            self._cart_ids = itertools.count(1)
            self._order_ids = itertools.count(1)

    # --- carts ---------------------------------------------------------------
    def create_cart(self, owner: str) -> dict:
        with self._lock:
            cart_id = next(self._cart_ids)
            cart = {"id": cart_id, "owner": owner, "items": [], "total_cents": 0,
                    "status": "open"}
            self.carts[cart_id] = cart
            return cart

    def add_item(self, cart: dict, product: dict, quantity: int) -> dict:
        with self._lock:
            for item in cart["items"]:
                if item["product_id"] == product["id"]:
                    item["quantity"] += quantity
                    break
            else:
                cart["items"].append({
                    "product_id": product["id"],
                    "name": product["name"],
                    "unit_price_cents": product["price_cents"],
                    "quantity": quantity,
                })
            cart["total_cents"] = sum(
                i["unit_price_cents"] * i["quantity"] for i in cart["items"]
            )
            return cart

    def create_order(self, cart: dict) -> dict:
        with self._lock:
            order_id = next(self._order_ids)
            order = {
                "id": order_id,
                "cart_id": cart["id"],
                "owner": cart["owner"],
                "items": list(cart["items"]),
                "total_cents": cart["total_cents"],
                "status": "confirmed",
            }
            self.orders[order_id] = order
            cart["status"] = "checked_out"
            return order

    def stats(self) -> dict:
        return {
            "products": len(self.products),
            "users": len(self.users),
            "carts": len(self.carts),
            "orders": len(self.orders),
        }


store = Store()
