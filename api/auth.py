"""API key authentication for the Writing Dashboard API."""

import os
import secrets

from fastapi import HTTPException, Security
from fastapi.security import APIKeyHeader

API_KEY_HEADER = APIKeyHeader(name="X-API-Key", auto_error=False)
_keys: set[str] = set()


def init_keys():
    """Load API keys from the API_KEYS environment variable."""
    raw = os.environ.get("API_KEYS", "")
    _keys.update(k.strip() for k in raw.split(",") if k.strip())


def generate_key() -> str:
    """Generate a new API key and add it to the in-memory set."""
    key = f"wd_{secrets.token_hex(16)}"
    _keys.add(key)
    return key


async def require_api_key(api_key: str = Security(API_KEY_HEADER)) -> str:
    """FastAPI dependency that validates the X-API-Key header."""
    if not api_key:
        raise HTTPException(
            status_code=401,
            detail="Missing API key. Include X-API-Key header.",
        )
    if api_key not in _keys:
        raise HTTPException(status_code=403, detail="Invalid API key.")
    return api_key
