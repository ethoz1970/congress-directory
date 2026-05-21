"""
http.py — stdlib-only HTTP with retry, backoff, and rate-limit awareness.

Mirror of the Sentiment-vs-Power conventions: no `requests` dep, no `aiohttp`,
just urllib with sensible defaults. Designed to fail loudly on real problems
but absorb transient ones (429, 5xx, brief network blips).
"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.request

USER_AGENT = "whoisourgov-feeder/0.1 (+https://whoisourgov.com)"


def fetch_json(
    url: str,
    *,
    timeout: float = 30.0,
    retries: int = 3,
    backoff: float = 2.0,
) -> dict:
    """
    GET `url` and parse the response as JSON. Retries on 429, 5xx, and
    common network errors; raises the final exception if all retries fail.
    """
    last_exc: BaseException | None = None
    for attempt in range(retries):
        req = urllib.request.Request(url, headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/json",
        })
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            # 429 — rate limit; back off and try again (Congress.gov is
            # 5000/hr so we should never see this in practice).
            if e.code == 429 and attempt < retries - 1:
                wait = backoff ** (attempt + 1)
                print(f"  ! 429 rate-limited — sleeping {wait:.1f}s")
                time.sleep(wait)
                continue
            # 5xx — transient server side; retry.
            if 500 <= e.code < 600 and attempt < retries - 1:
                wait = backoff ** (attempt + 1)
                print(f"  ! HTTP {e.code} — retrying after {wait:.1f}s")
                time.sleep(wait)
                continue
            # 4xx other than 429 — caller mistake, surface immediately.
            raise
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            last_exc = e
            if attempt < retries - 1:
                wait = backoff ** (attempt + 1)
                print(f"  ! {type(e).__name__}: retrying after {wait:.1f}s")
                time.sleep(wait)
                continue
            raise
    # Should be unreachable — every path either returns or raises — but
    # belt-and-suspenders.
    if last_exc:
        raise last_exc
    raise RuntimeError("fetch_json exhausted retries without exception")
