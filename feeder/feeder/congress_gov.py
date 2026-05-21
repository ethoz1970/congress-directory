"""
congress_gov.py — Filter feeder for the Congress.gov API.

Phase B.1 scope (this file):
  * Walks /v3/bill/{congress} paginated (250/page, sort=updateDate+desc)
  * Writes each raw API response to gov_mongo.records  (archive)
  * Upserts each bill into gov_mongo.bills            (current state, keyed
    on external_id = "{congress}-{TYPE}-{number}")
  * Logs run start/end/counts to gov_mongo.ingestion_log
  * Touches gov_postgres.ingestion_sources.last_sync_at + record_count

Idempotent on rerun: same external_id → upsert (no dupes). On its own this
script gets us the bill metadata firehose — no plain_english, no sponsors,
no actions, no votes. Those come in B.2 / B.3 via the per-bill detail
endpoints.

Usage:
    python -m feeder.congress_gov                        # full pull of 119th
    python -m feeder.congress_gov --max-pages 1          # smoke test (250 bills)
    python -m feeder.congress_gov --congress 118         # back-catalog catch-up
    python -m feeder.congress_gov --from-date 2026-05-10T00:00:00Z   # delta
"""
from __future__ import annotations

import argparse
import datetime as dt
import sys
import time
import uuid
from urllib.parse import urlencode

from .client import CONGRESS_GOV_API_KEY, mongo_db, postgres_conn
from .http import fetch_json

API_BASE = "https://api.congress.gov/v3"
SOURCE = "congress_gov"
DEFAULT_CONGRESS = 119
PAGE_SIZE = 250                      # Congress.gov's max per page
SLEEP_BETWEEN_PAGES = 0.5            # well under 5000/hr limit


# -----------------------------------------------------------------------------
# URL helpers.
# -----------------------------------------------------------------------------
def list_bills_url(
    congress: int,
    offset: int,
    limit: int,
    from_date: str | None = None,
) -> str:
    params = {
        "api_key": CONGRESS_GOV_API_KEY,
        "format":  "json",
        "limit":   limit,
        "offset":  offset,
        "sort":    "updateDate+desc",
    }
    if from_date:
        params["fromDateTime"] = from_date
    return f"{API_BASE}/bill/{congress}?{urlencode(params)}"


_CHAMBER_SLUG = {
    "HR":      "house-bill",
    "S":       "senate-bill",
    "HJRES":   "house-joint-resolution",
    "SJRES":   "senate-joint-resolution",
    "HCONRES": "house-concurrent-resolution",
    "SCONRES": "senate-concurrent-resolution",
    "HRES":    "house-resolution",
    "SRES":    "senate-resolution",
}


def _ordinal_suffix(n: int) -> str:
    # 11/12/13 are special (eleventh/twelfth/thirteenth, all 'th')
    if 10 <= (n % 100) <= 20:
        return "th"
    return {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")


def human_url(congress: int, btype: str, number: str | int) -> str:
    """Build the canonical congress.gov human URL for a bill."""
    slug = _CHAMBER_SLUG.get(btype.upper(), btype.lower())
    return (
        f"https://www.congress.gov/bill/"
        f"{congress}{_ordinal_suffix(congress)}-congress/{slug}/{number}"
    )


def to_external_id(congress: int, btype: str, number: str | int) -> str:
    """Stable natural key shared with the existing Supabase mirror."""
    return f"{congress}-{btype.upper()}-{number}"


# -----------------------------------------------------------------------------
# Driver.
# -----------------------------------------------------------------------------
def run(
    congress: int = DEFAULT_CONGRESS,
    max_pages: int | None = None,
    from_date: str | None = None,
) -> int:
    if not CONGRESS_GOV_API_KEY:
        print("!! CONGRESS_GOV_API_KEY not set in .env — abort", file=sys.stderr)
        return 1

    run_id = str(uuid.uuid4())
    started_at = dt.datetime.now(dt.timezone.utc)
    print(f"→ run {run_id[:8]}  congress={congress}  "
          f"from_date={from_date or 'all'}")

    db = mongo_db()
    bills_col   = db["bills"]
    records_col = db["records"]
    ingestion_log = db["ingestion_log"]

    log_doc = {
        "run_id":     run_id,
        "source":     SOURCE,
        "task":       "list_bills",
        "congress":   congress,
        "from_date":  from_date,
        "started_at": started_at,
        "status":     "running",
    }
    log_id = ingestion_log.insert_one(log_doc).inserted_id

    counts = {
        "pages":          0,
        "bills_inserted": 0,
        "bills_updated":  0,
        "bills_seen":     0,
        "errors":         0,
    }
    offset = 0
    total_in_set: int | None = None
    status = "ok"

    try:
        while True:
            url = list_bills_url(congress, offset, PAGE_SIZE, from_date)
            page = fetch_json(url)

            pagination = page.get("pagination") or {}
            page_bills = page.get("bills") or []
            total_in_set = pagination.get("count", total_in_set)

            counts["pages"] += 1
            counts["bills_seen"] += len(page_bills)
            print(f"  · page {counts['pages']:>2d}  offset={offset:>5d}  "
                  f"bills={len(page_bills):>4d}  total={total_in_set}")

            # 1. Raw archive — one row per API response.
            records_col.insert_one({
                "run_id":      run_id,
                "source":      SOURCE,
                "endpoint":    f"/bill/{congress}",
                "offset":      offset,
                "limit":       PAGE_SIZE,
                "from_date":   from_date,
                "fetched_at":  dt.datetime.now(dt.timezone.utc),
                "bill_count":  len(page_bills),
                "response":    page,
            })

            # 2. Upsert each bill into the structured collection.
            now = dt.datetime.now(dt.timezone.utc)
            for b in page_bills:
                try:
                    bt = (b.get("type") or "").upper().strip()
                    bn = b.get("number")
                    if not bt or bn is None:
                        # Malformed entry — record the error and keep going.
                        counts["errors"] += 1
                        print(f"  ! malformed bill payload: {b}")
                        continue
                    eid = to_external_id(congress, bt, bn)
                    latest = b.get("latestAction") or {}
                    fields = {
                        "external_id":              eid,
                        "congress":                 congress,
                        "type":                     bt,
                        "number":                   str(bn),
                        "title":                    b.get("title"),
                        "origin_chamber":           b.get("originChamber"),
                        "origin_chamber_code":      b.get("originChamberCode"),
                        "latest_action_date":       latest.get("actionDate"),
                        "latest_action_text":       latest.get("text"),
                        "update_date":              b.get("updateDate"),
                        "update_date_including_text": b.get("updateDateIncludingText"),
                        "api_url":                  b.get("url"),
                        "human_url":                human_url(congress, bt, bn),
                        "source":                   SOURCE,
                        "raw":                      b,
                        "last_seen_at":             now,
                        "last_ingest_run_id":       run_id,
                    }
                    result = bills_col.update_one(
                        {"external_id": eid},
                        {
                            "$set":         fields,
                            "$setOnInsert": {"first_seen_at": now},
                        },
                        upsert=True,
                    )
                    if result.upserted_id is not None:
                        counts["bills_inserted"] += 1
                    elif result.modified_count > 0:
                        counts["bills_updated"] += 1
                except Exception as e:
                    counts["errors"] += 1
                    print(f"  ! bill error ({b.get('type')} {b.get('number')}): "
                          f"{type(e).__name__}: {e}")

            # 3. Pagination — Congress.gov uses 'next' cursor on pagination.
            if not pagination.get("next") or not page_bills:
                break
            offset += PAGE_SIZE
            if max_pages and counts["pages"] >= max_pages:
                print(f"  · stopping at --max-pages={max_pages}")
                break
            time.sleep(SLEEP_BETWEEN_PAGES)

    except Exception as e:
        status = "errored"
        counts["errors"] += 1
        print(f"!! run failed: {type(e).__name__}: {e}", file=sys.stderr)

    ended_at = dt.datetime.now(dt.timezone.utc)
    ingestion_log.update_one({"_id": log_id}, {"$set": {
        "ended_at": ended_at,
        "status":   status,
        "counts":   counts,
    }})

    # 4. Mark the matching row in Tier 2 ingestion_sources — gives Postgres
    # observers a single place to see "the feeder is alive" without reading
    # Mongo. Failure here is non-fatal: the Mongo ingest already succeeded.
    try:
        with postgres_conn() as conn, conn.cursor() as cur:
            cur.execute(
                "UPDATE ingestion_sources "
                "   SET last_sync_at = %s, "
                "       sync_status  = %s, "
                "       record_count = COALESCE(record_count, 0) + %s "
                " WHERE source_name = %s",
                (
                    ended_at,
                    status,
                    counts["bills_inserted"] + counts["bills_updated"],
                    SOURCE,
                ),
            )
            conn.commit()
    except Exception as e:
        print(f"  ! ingestion_sources update failed (non-fatal): "
              f"{type(e).__name__}: {e}")

    print(f"\n→ done. status={status} {counts}")
    return 0 if status == "ok" else 1


def main() -> int:
    p = argparse.ArgumentParser(description="Pull bill metadata from Congress.gov.")
    p.add_argument("--congress",  type=int, default=DEFAULT_CONGRESS,
                   help=f"Congress number to pull (default {DEFAULT_CONGRESS})")
    p.add_argument("--max-pages", type=int, default=None,
                   help="cap the run at N pages — use 1 for a smoke test")
    p.add_argument("--from-date", type=str, default=None,
                   help="ISO timestamp (e.g. 2026-05-10T00:00:00Z); "
                        "only pull bills updated since this")
    args = p.parse_args()
    return run(
        congress=args.congress,
        max_pages=args.max_pages,
        from_date=args.from_date,
    )


if __name__ == "__main__":
    sys.exit(main())
