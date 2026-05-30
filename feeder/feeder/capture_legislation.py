#!/usr/bin/env python3
"""
capture_legislation.py — Tier 1: per-legislator Congress.gov API fetch
                          (sponsored + cosponsored) into gov_mongo.legislation_raw.

Replaces the Firestore-writing import_legislation.py. Same Congress.gov
endpoints, same 24h-cache logic, new Mongo destination. Pairs with
enrich_legislation.py.

Slowest of the capture scripts: ~2 API calls per legislator at 0.5s delay
between calls. Full run ≈ 540 legislators × 1s = 9 minutes. Smoke-test
with --limit 5 first.

Usage:
    python -m feeder.capture_legislation                # all politicians (federal Congress)
    python -m feeder.capture_legislation --limit 5      # smoke test
    python -m feeder.capture_legislation --dry          # estimate only
    python -m feeder.capture_legislation --force        # bypass 24h cache
    python -m feeder.capture_legislation --bioguide T000479  # one specific member

Source:
    https://api.congress.gov/v3/member/{bioguide_id}/sponsored-legislation
    https://api.congress.gov/v3/member/{bioguide_id}/cosponsored-legislation

Auth:
    CONGRESS_GOV_API_KEY env var (in feeder/.env).

Output (Mongo `whoisourgov.legislation_raw`, one doc per legislator):
    {
      "_id":              "<bioguide_id>",
      "source":           "congress-gov-member-legislation",
      "source_url_sponsored":   "<URL>",
      "source_url_cosponsored": "<URL>",
      "captured_at":      "<ISO>",
      "ingestion_run_id": "<uuid>",
      "payload": {
        "sponsored_total":     <int>,
        "cosponsored_total":   <int>,
        "enacted_in_sponsored": <int>,
        "recent_sponsored":    [<first 5 sponsored bills>],
        "recent_enacted":      [<first 5 enacted bills>]
      }
    }

Idempotent. Respects a 24h cache (skips legislators captured in the last
24h unless --force).
"""
from __future__ import annotations

import argparse
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import json
from datetime import datetime, timezone, timedelta

from .client import CONGRESS_GOV_API_KEY, mongo_db, postgres_conn
from .http import USER_AGENT


SOURCE_NAME = "congress-gov-member-legislation"
API_BASE = "https://api.congress.gov/v3"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


def _api_get(url: str, params: dict, timeout: float = 30.0) -> dict | None:
    """Single GET with the api_key query-param. Returns None on non-200."""
    qs = urllib.parse.urlencode(params)
    req = urllib.request.Request(
        f"{url}?{qs}",
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        if exc.code == 429:
            print(f"[CAPTURE-LEG]   429 rate-limited — sleeping 60s")
            time.sleep(60)
            try:
                with urllib.request.urlopen(req, timeout=timeout) as resp:
                    return json.loads(resp.read().decode("utf-8"))
            except Exception:
                return None
        print(f"[CAPTURE-LEG]   HTTP {exc.code} on {url}")
        return None
    except Exception as exc:
        print(f"[CAPTURE-LEG]   {type(exc).__name__} on {url}: {exc}")
        return None


def _fetch_legislator(bioguide: str, delay: float) -> dict:
    """Fetch sponsored (paginated) + cosponsored (count only) for one member."""
    sponsored_url   = f"{API_BASE}/member/{bioguide}/sponsored-legislation"
    cosponsored_url = f"{API_BASE}/member/{bioguide}/cosponsored-legislation"
    auth = {"api_key": CONGRESS_GOV_API_KEY, "format": "json"}

    sponsored_total = 0
    cosponsored_total = 0
    enacted_count = 0
    recent_sponsored: list[dict] = []
    recent_enacted: list[dict] = []

    # ── Sponsored: paginate fully (we need to count enacted) ─────────────
    page1 = _api_get(sponsored_url, {**auth, "limit": 250})
    if page1:
        sponsored_total = (page1.get("pagination") or {}).get("count", 0)
        bills = page1.get("sponsoredLegislation") or []
        recent_sponsored = bills[:5]
        for bill in bills:
            action = (bill.get("latestAction") or {}).get("text", "") or ""
            if "Became Public Law" in action or "became public law" in action.lower():
                enacted_count += 1
                if len(recent_enacted) < 5:
                    recent_enacted.append(bill)

        # Paginate the rest if needed.
        offset = 250
        while offset < sponsored_total:
            time.sleep(delay)
            page = _api_get(sponsored_url, {**auth, "limit": 250, "offset": offset})
            if not page:
                break
            for bill in (page.get("sponsoredLegislation") or []):
                action = (bill.get("latestAction") or {}).get("text", "") or ""
                if "Became Public Law" in action or "became public law" in action.lower():
                    enacted_count += 1
                    if len(recent_enacted) < 5:
                        recent_enacted.append(bill)
            offset += 250

    time.sleep(delay)

    # ── Cosponsored: count-only (limit=1 returns pagination.count) ──────
    cop = _api_get(cosponsored_url, {**auth, "limit": 1})
    if cop:
        cosponsored_total = (cop.get("pagination") or {}).get("count", 0)

    return {
        "sponsored_url":          sponsored_url,
        "cosponsored_url":        cosponsored_url,
        "sponsored_total":        sponsored_total,
        "cosponsored_total":      cosponsored_total,
        "enacted_in_sponsored":   enacted_count,
        "recent_sponsored":       recent_sponsored,
        "recent_enacted":         recent_enacted,
    }


def _bioguides_to_process(args) -> list[str]:
    """Return the list of bioguides to fetch this run."""
    if args.bioguide:
        return [args.bioguide]
    with postgres_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT external_id FROM politicians
            WHERE scope = 'federal'
              AND (office = 'representative' OR office = 'senator')
              AND external_id IS NOT NULL
            ORDER BY external_id
        """)
        rows = [r[0] for r in cur.fetchall()]
    if args.limit:
        rows = rows[: args.limit]
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Capture per-legislator sponsored+cosponsored legislation into gov_mongo."
    )
    parser.add_argument("--limit", type=int, default=None,
                        help="Only process N legislators (smoke test).")
    parser.add_argument("--bioguide", default=None,
                        help="Fetch a single bioguide_id only.")
    parser.add_argument("--force", action="store_true",
                        help="Bypass the 24h cache and re-fetch.")
    parser.add_argument("--delay", type=float, default=0.5,
                        help="Seconds between API calls (default: 0.5).")
    parser.add_argument("--dry", action="store_true",
                        help="Estimate which legislators would be fetched; no API calls.")
    args = parser.parse_args()

    if not CONGRESS_GOV_API_KEY:
        print("[CAPTURE-LEG] ABORT: CONGRESS_GOV_API_KEY not set in .env")
        return 1

    run_id = str(uuid.uuid4())
    started_at = _now()
    print(f"[CAPTURE-LEG] run_id={run_id}  started_at={_iso(started_at)}  "
          f"limit={args.limit}  force={args.force}  dry={args.dry}")

    db = mongo_db()
    bioguides = _bioguides_to_process(args)
    print(f"[CAPTURE-LEG] candidates: {len(bioguides)}")

    if args.dry:
        # Show first 10 and how many would be skipped vs fetched per cache.
        cache_cutoff = _now() - timedelta(hours=24)
        cached_skipped = 0
        if not args.force:
            cached_ids = set(
                d["_id"] for d in db.legislation_raw.find(
                    {"captured_at": {"$gte": _iso(cache_cutoff)}},
                    {"_id": 1},
                )
            )
            cached_skipped = len(set(bioguides) & cached_ids)
        print(f"[CAPTURE-LEG] [dry] would skip cached={cached_skipped}, "
              f"fetch={len(bioguides) - cached_skipped}")
        return 0

    upserted = 0
    cached_skipped = 0
    errors = 0
    cache_cutoff_iso = _iso(_now() - timedelta(hours=24))

    for i, bioguide in enumerate(bioguides, start=1):
        # Cache check
        if not args.force:
            existing = db.legislation_raw.find_one(
                {"_id": bioguide, "captured_at": {"$gte": cache_cutoff_iso}},
                {"_id": 1},
            )
            if existing:
                cached_skipped += 1
                if i % 25 == 0:
                    print(f"[CAPTURE-LEG]   [{i}/{len(bioguides)}] {bioguide}  cached")
                continue

        try:
            result = _fetch_legislator(bioguide, args.delay)
        except Exception as exc:
            errors += 1
            print(f"[CAPTURE-LEG]   ! {bioguide} -> {type(exc).__name__}: {exc}")
            continue

        doc = {
            "_id":                     bioguide,
            "source":                  SOURCE_NAME,
            "source_url_sponsored":    result["sponsored_url"],
            "source_url_cosponsored":  result["cosponsored_url"],
            "captured_at":             _iso(_now()),
            "ingestion_run_id":        run_id,
            "payload": {
                "sponsored_total":      result["sponsored_total"],
                "cosponsored_total":    result["cosponsored_total"],
                "enacted_in_sponsored": result["enacted_in_sponsored"],
                "recent_sponsored":     result["recent_sponsored"],
                "recent_enacted":       result["recent_enacted"],
            },
        }

        try:
            db.legislation_raw.replace_one({"_id": bioguide}, doc, upsert=True)
            upserted += 1
        except Exception as exc:
            errors += 1
            print(f"[CAPTURE-LEG]   ! upsert {bioguide} -> "
                  f"{type(exc).__name__}: {exc}")

        if i <= 5 or i % 25 == 0:
            print(f"[CAPTURE-LEG]   [{i}/{len(bioguides)}] {bioguide}  "
                  f"sp={result['sponsored_total']:>4d}  "
                  f"co={result['cosponsored_total']:>4d}  "
                  f"enacted={result['enacted_in_sponsored']:>3d}")

    finished_at = _now()
    print(f"[CAPTURE-LEG] done  upserted={upserted}  "
          f"cached_skipped={cached_skipped}  errors={errors}")
    print(f"[CAPTURE-LEG] finished_at={_iso(finished_at)}  run_id={run_id}")

    try:
        db.ingestion_log.insert_one({
            "run_id":      run_id,
            "kind":        "capture_legislation",
            "source":      SOURCE_NAME,
            "started_at":  _iso(started_at),
            "finished_at": _iso(finished_at),
            "stats": {
                "candidates":     len(bioguides),
                "upserted":       upserted,
                "cached_skipped": cached_skipped,
                "errors":         errors,
            },
        })
    except Exception as exc:
        print(f"[CAPTURE-LEG]   ! ingestion_log write failed: {exc}")

    return 0 if errors == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
