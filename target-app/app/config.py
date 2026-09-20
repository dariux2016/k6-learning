"""Runtime-tunable behaviour of the target app.

Everything here is driven by environment variables so that later k6 modules can make
the app slow, flaky, or fragile on demand without editing code. The same values can
also be changed at runtime via POST /admin/config (handy for the CI regression demo
in Module 14).
"""

import os
from dataclasses import asdict, dataclass


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


def _float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return default


@dataclass
class Settings:
    # --- Baseline latency applied to normal endpoints -------------------------
    # A flat floor plus uniform jitter, so response times look like a real service
    # instead of a 1 ms in-memory dict lookup. Without this, every threshold
    # exercise in Module 3 would pass trivially.
    base_latency_ms: int = _int("BASE_LATENCY_MS", 20)
    base_latency_jitter_ms: int = _int("BASE_LATENCY_JITTER_MS", 30)

    # Auth is deliberately the slowest path, as it usually is in real systems.
    login_latency_ms: int = _int("LOGIN_LATENCY_MS", 120)

    # --- Capacity model ------------------------------------------------------
    # The app degrades as concurrency rises: past `capacity` in-flight requests
    # each extra one adds `degrade_ms_per_excess` of latency, and past
    # `max_inflight` the app sheds load with 503s. This is what gives the
    # stress / spike / breakpoint tests in Module 12 an actual breaking point.
    capacity: int = _int("CAPACITY", 50)
    degrade_ms_per_excess: float = _float("DEGRADE_MS_PER_EXCESS", 4.0)
    max_inflight: int = _int("MAX_INFLIGHT", 250)

    # --- The deliberately unreliable endpoint (GET /unstable) ----------------
    unstable_delay_ms: int = _int("UNSTABLE_DELAY_MS", 500)
    unstable_error_rate: float = _float("UNSTABLE_ERROR_RATE", 0.25)

    # --- Auth ----------------------------------------------------------------
    jwt_secret: str = os.environ.get("JWT_SECRET", "k6-learning-dev-secret")
    token_ttl_seconds: int = _int("TOKEN_TTL_SECONDS", 3600)

    def as_dict(self) -> dict:
        d = asdict(self)
        d.pop("jwt_secret")  # never echo the signing key back over HTTP
        return d


settings = Settings()
