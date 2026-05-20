"""
oracle_client.py — Thin async client for the Oracle FastAPI behind the
Cloudflare Tunnel at oracle-api.blacksky-chat.us.

WIOG calls this server-side from main.py to pull Nia-written
plain_english + impact_summary and the rest of the bill enrichment
the WIOG-native database does not compute.

Read-only. WIOG never writes to Oracle.

If ORACLE_API_URL / ORACLE_API_KEY are not set, or the request fails,
every method returns None and the caller is expected to degrade
gracefully (return 503 or omit the field — never crash).
"""
from __future__ import annotations

import os
from typing import Any, Optional

import httpx
from cachetools import TTLCache

ORACLE_API_URL = os.environ.get("ORACLE_API_URL", "").rstrip("/")
ORACLE_API_KEY = os.environ.get("ORACLE_API_KEY", "")

# 10-minute TTL, 512 keys. Oracle data updates on Nia's schedule, not
# real-time, so 10 minutes is well inside the "barely-stale" window.
_cache: TTLCache = TTLCache(maxsize=512, ttl=600)

_TIMEOUT = httpx.Timeout(connect=2.0, read=5.0, write=5.0, pool=5.0)


def configured() -> bool:
    """True iff both URL and key are set. Calling code can short-circuit
    with a clean 503 instead of attempting a network call that will fail."""
    return bool(ORACLE_API_URL and ORACLE_API_KEY)


async def _get_json(path: str, params: Optional[dict] = None) -> Optional[dict]:
    """GET against the Oracle. Returns parsed JSON dict on 2xx, None on
    anything else (network error, non-2xx, JSON decode error)."""
    if not configured():
        return None
    url = f"{ORACLE_API_URL}{path}"
    headers = {"X-Oracle-Key": ORACLE_API_KEY, "accept": "application/json"}
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            r = await client.get(url, params=params, headers=headers)
            if r.status_code != 200:
                return None
            return r.json()
    except (httpx.HTTPError, ValueError):
        return None


def _list_bills_key(params: dict) -> tuple:
    """Hashable cache key for list_bills params. None values are dropped
    so calls with explicit Nones hash the same as calls that omit them."""
    return tuple(sorted((k, v) for k, v in params.items() if v is not None))


async def list_bills(
    *,
    limit: int = 50,
    offset: int = 0,
    sort: str = "recent",
    chamber: Optional[str] = None,
    status: Optional[str] = None,
    party: Optional[str] = None,
    bipartisan: Optional[bool] = None,
    portal: Optional[str] = None,
) -> Optional[dict]:
    """GET /bills with the WIOG-supported filter surface.

    Returns the Oracle's {items, total, limit, offset} payload verbatim,
    or None if Oracle is down / not configured.

    The `portal` arg is the WIOG-facing name for what the Oracle calls
    `topic` (per the connector seed). Both names refer to the same
    short ID in bills.portal_tag[] (e.g. 'money', 'health').

    Cached for 10 minutes per unique param set. Only successful
    responses are cached — failures are retried on the next call.
    """
    params: dict[str, Any] = {
        "limit": limit,
        "offset": offset,
        "sort": sort,
        "chamber": chamber,
        "status": status,
        "party": party,
        "bipartisan": (
            None if bipartisan is None
            else ("true" if bipartisan else "false")
        ),
        # Oracle's documented filter name for portal_tag is `topic`.
        "topic": portal,
    }
    key = ("list_bills", _list_bills_key(params))
    cached = _cache.get(key)
    if cached is not None:
        return cached

    # Drop None values before sending so the URL stays clean and the
    # Oracle's default behavior kicks in for omitted filters.
    send_params = {k: v for k, v in params.items() if v is not None}
    data = await _get_json("/bills", params=send_params)
    if data is not None:
        _cache[key] = data
    return data


async def get_bill(external_id: str) -> Optional[dict]:
    """GET /bills/{external_id}. Returns the inner Bill dict (unwrapped
    from the Oracle's {bill: ...} envelope), or None.

    Cached for 10 minutes per external_id.
    """
    key = ("get_bill", external_id)
    cached = _cache.get(key)
    if cached is not None:
        return cached

    payload = await _get_json(f"/bills/{external_id}")
    if payload is None:
        return None
    bill = payload.get("bill")
    if bill is None:
        return None
    _cache[key] = bill
    return bill


async def get_bills_by_sponsor(
    bioguide_id: str, limit: int = 10
) -> Optional[list]:
    """GET /politicians/{bioguide_id}/bills?limit=N.

    Returns the items array unwrapped — the calling code already has
    sponsor data from Firestore, so we discard the Oracle's sponsor
    envelope. Bills are returned newest first by the Oracle.

    None on any error (Oracle down, sponsor not found, etc.).
    Empty list means the sponsor exists but has no bills in the Oracle.

    Cached for 10 minutes per (bioguide_id, limit) pair.
    """
    key = ("get_bills_by_sponsor", bioguide_id, limit)
    cached = _cache.get(key)
    if cached is not None:
        return cached

    payload = await _get_json(
        f"/politicians/{bioguide_id}/bills",
        params={"limit": limit},
    )
    if payload is None:
        return None
    items = payload.get("items")
    if items is None:
        return None
    _cache[key] = items
    return items
