"""A deliberately minimal HS256 JWT implementation.

Real enough that Module 10 can practise token reuse and Authorization headers,
small enough to read in one sitting and with zero third-party dependencies.
Do not copy this into anything that matters.
"""

import base64
import hashlib
import hmac
import json
import time

from .config import settings


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _b64url_decode(text: str) -> bytes:
    padding = "=" * (-len(text) % 4)
    return base64.urlsafe_b64decode(text + padding)


def _sign(signing_input: bytes) -> str:
    digest = hmac.new(settings.jwt_secret.encode(), signing_input, hashlib.sha256).digest()
    return _b64url_encode(digest)


def create_token(username: str, role: str) -> tuple[str, int]:
    """Return (token, expires_in_seconds)."""
    now = int(time.time())
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "sub": username,
        "role": role,
        "iat": now,
        "exp": now + settings.token_ttl_seconds,
    }
    segments = [
        _b64url_encode(json.dumps(header, separators=(",", ":")).encode()),
        _b64url_encode(json.dumps(payload, separators=(",", ":")).encode()),
    ]
    signing_input = ".".join(segments).encode()
    segments.append(_sign(signing_input))
    return ".".join(segments), settings.token_ttl_seconds


def decode_token(token: str) -> dict | None:
    """Return the payload, or None if the token is malformed, forged, or expired."""
    try:
        header_b64, payload_b64, signature = token.split(".")
    except ValueError:
        return None

    expected = _sign(f"{header_b64}.{payload_b64}".encode())
    if not hmac.compare_digest(expected, signature):
        return None

    try:
        payload = json.loads(_b64url_decode(payload_b64))
    except (ValueError, json.JSONDecodeError):
        return None

    if payload.get("exp", 0) < int(time.time()):
        return None
    return payload
