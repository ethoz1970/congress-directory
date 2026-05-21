"""
congress_gov_cosponsors.py — Phase B.3 sub-resource fetcher: cosponsors.

For every bill in gov_mongo.bills that the detail feeder said has
cosponsors_count > 0, fetch the full cosponsor list from Congress.gov
and store it back on the bill doc as `cosponsors_list`.

Why this exists:
  Phase B.2 (congress_gov_detail.py) only captured cosponsors_count +
  the URL to the sub-resource — it didn't follow the URL. The list
  itself lives at /v3/bill/{congress}/{type}/{number}/cosponsors.
  Phase 4a's Tier 2 sync (sync_cosponsors.py) reads the list back out
  and UPSERTs to gov_postgres.bill_cosponsors.

Storage shape on gov_mongo.bills (added by this feeder):
  {
    ...,
    "cosponsors_list": [
        {"bioguide_id": "A000370",
         "full_name":   "Rep. Adams, Alma S. [D-NC-12]",
         "party":       "D",
         "state":       "NC",
         "district":    "12",
         "sponsorship_date":     "2026-04-16",
         "is_original_cosponsor": false},
        ...
    ],
    "cosponsors_fetched_at":     ISODate(...),
    "cosponsors_count_at_fetch": 41,
    "cosponsors_fetch_run_id":   "uuid",
  }

Staleness model:
  * First run: every bill with cosponsors_count > 0 needs a fetch.
  * Later runs: refetch only when bills.cosponsors_count has drifted
    from cosponsors_count_at_fetch (cosponsorship activity since the
    last fetch).

Rate budget:
  Congress.gov: 5,000 req/hr. Pacing at 0.8 s/call = 4,500/hr — same
  as the detail feeder. With ~12-13K bills carrying cosponsors,
  initial backfill is ~2.5-3 hours. Use --max to chunk it.

Pagination:
  Congress.gov returns up to 250 cosponsors per page (default 25 if
  not specified). We request 250 explicitly and follow `pagination.next`
  until exhausted. Most bills have <250 cosponsors; the very few with
  more (rare landmark bills) cost an extra round-trip each.

Usage:
    python -m feeder.congress_gov_cosponsors --max 5            # smoke
    python -m feeder.congress_gov_cosponsors --max 1000         # one chunk
    python -m feeder.congress_gov_cosponsors                    # full stale set
    python -m feeder.congress_gov_cosponsors --refresh-all      # ignore staleness
"""
from __future__ import annotations

import argparse
import datetime as dt
import sys
import time
import uuid
from urllib.parse import urlencode, urlparse, urlunparse, parse_qsl

from .client import CONGRESS_GOV_API_KEY, mongo_db, postgres_conn
from .http import fetch_json

SOURCE = "congress_gov"
SLEEP_BETWEEN_CALLS = 0.8
PAGE_SIZE = 250


# -----------------------------------------------------------------------------
# URL helpers.
# -----------------------------------------------------------------------------
def _with_api_params(url: str, *, force_offset: int | None = None) -> str:
    """Ensure api_key + format are present on a Congress.gov URL.

    The detail feeder stored bare URLs like
        https://api.congress.gov/v3/bill/119/hr/1234/cosponsors
    Pagination URLs returned by the API already have offset/limit set;
    we MUST preserve them — overriding offset back to 0 would put us in
    an infinite loop re-fetching page 1. Use `force_offset=0` only on
    the very first call.
    """
    parts = urlparse(url)
    existing = dict(parse_qsl(parts.query))
    existing["api_key"] = CONGRESS_GOV_API_KEY
    existing.setdefault("format", "json")
    existing.setdefault("limit",  str(PAGE_SIZE))
    if force_offset is not None:
        existing["offset"] = str(force_offset)
    else:
        existing.setdefault("offset", "0")
    return urlunparse(parts._replace(query=urlencode(existing)))


# -----------------------------------------------------------------------------
# Parsing.
# -----------------------------------------------------------------------------
def _parse_cosponsor(raw: dict) -> dict | None:
    """Normalize one cosponsor record from the API.

    Returns None if the row lacks a bioguide id — we can't map it back
    to a politician without one.
    """
    if not isinstance(raw, dict):
        return None
    bg = raw.get("bioguideId")
    if not bg:
        return None
    return {
        "bioguide_id":            bg,
        "full_name":              raw.get("fullName"),
        "first_name":             raw.get("firstName"),
        "last_name":              raw.get("lastName"),
        "middle_name":            raw.get("middleName"),
        "party":                  raw.get("party"),
        "state":                  raw.get("state"),
        "district":               raw.get("district"),
        "sponsorship_date":       raw.get("sponsorshipDate"),
        "is_original_cosponsor":  bool(raw.get("isOriginalCosponsor")),
        "url":                    raw.get("url"),
    }


MAX_PAGES_PER_BILL = 20    # 20 * 250 = 5000 cosponsors. No real bill comes
                           # remotely close; this is bug insurance.


def _fetch_all_cosponsors(base_url: str) -> list[dict]:
    """Fetch every page from a cosponsors sub-resource URL. Returns a
    flat list of parsed cosponsor dicts. Follows `pagination.next`.

    Belt-and-suspenders against infinite loops: hard page cap, and we
    track the offset we last fetched so we can detect non-advancing
    pagination explicitly (rather than relying on URL-string equality).
    """
    all_rows: list[dict] = []
    next_url: str | None = _with_api_params(base_url, force_offset=0)
    seen_offsets: set[int] = set()

    for page in range(MAX_PAGES_PER_BILL):
        # Track which offset we're about to fetch — if we see the same
        # offset twice, the server is misbehaving (or we are).
        offset_now = _parse_offset(next_url)
        if offset_now in seen_offsets:
            print(f"  ! pagination loop detected — offset {offset_now} "
                  f"already fetched on this bill; bailing.")
            break
        seen_offsets.add(offset_now)

        resp = fetch_json(next_url) or {}
        for raw in (resp.get("cosponsors") or []):
            parsed = _parse_cosponsor(raw)
            if parsed:
                all_rows.append(parsed)

        nxt = ((resp.get("pagination") or {}).get("next")) or None
        if not nxt:
            break
        # Preserve the server's offset/limit on the next page — only
        # re-attach the api_key. Overriding offset would loop.
        next_url = _with_api_params(nxt)
        time.sleep(SLEEP_BETWEEN_CALLS)
    else:
        print(f"  ! hit MAX_PAGES_PER_BILL={MAX_PAGES_PER_BILL} on this bill")
    return all_rows


def _parse_offset(url: str) -> int:
    """Extract the `offset` query param from a URL, defaulting to 0."""
    parts = urlparse(url)
    q = dict(parse_qsl(parts.query))
    try:
        return int(q.get("offset", "0"))
    except (TypeError, ValueError):
        return 0


# -----------------------------------------------------------------------------
# Bill selection — which docs need a fetch?
# -----------------------------------------------------------------------------
def _staleness_query() -> dict:
    """A bill needs a cosponsors fetch when:
      * cosponsors_count > 0  (no point fetching empty lists), AND
      * we've never fetched (cosponsors_fetched_at is null), OR
      * cosponsors_count has changed since the last fetch.
    """
    return {
        "cosponsors_count": {"$gt": 0},
        "cosponsors_url":   {"$exists": True, "$ne": None},
        "$or": [
            {"cosponsors_fetched_at": None},
            {"$expr": {
                "$ne": ["$cosponsors_count", "$cosponsors_count_at_fetch"],
            }},
        ],
    }


# -----------------------------------------------------------------------------
# Driver.
# -----------------------------------------------------------------------------
def run(max_bills: int | None = None, refresh_all: bool = False) -> int:
    if not CONGRESS_GOV_API_KEY:
        print("!! CONGRESS_GOV_API_KEY not set in .env — abort", file=sys.stderr)
        return 1

    run_id = str(uuid.uuid4())
    started_at = dt.datetime.now(dt.timezone.utc)
    mode = "refresh-all" if refresh_all else "stale-only"
    print(f"→ run {run_id[:8]}  task=bill_cosponsors  mode={mode}  "
          f"max={max_bills or 'all'}")

    db = mongo_db()
    bills_col     = db["bills"]
    records_col   = db["records"]
    ingestion_log = db["ingestion_log"]

    query = ({"cosponsors_count": {"$gt": 0},
              "cosponsors_url":   {"$exists": True, "$ne": None}}
             if refresh_all else _staleness_query())

    cursor = bills_col.find(
        query,
        {
            "external_id":              1,
            "congress":                 1,
            "type":                     1,
            "number":                   1,
            "cosponsors_url":           1,
            "cosponsors_count":         1,
            "cosponsors_count_at_fetch": 1,
        },
    ).sort("cosponsors_count", -1)   # tackle biggest first; failures are
                                     # most visible there
    if max_bills:
        cursor = cursor.limit(int(max_bills))

    count_kwargs: dict = {"limit": int(max_bills)} if max_bills else {}
    needs_count = bills_col.count_documents(query, **count_kwargs)
    print(f"→ {needs_count:,} bill(s) need a cosponsor fetch")
    if needs_count == 0:
        return 0

    log_id = ingestion_log.insert_one({
        "run_id":     run_id,
        "source":     SOURCE,
        "task":       "bill_cosponsors",
        "mode":       mode,
        "started_at": started_at,
        "needs":      needs_count,
        "status":     "running",
    }).inserted_id

    counts = {
        "considered":     0,
        "list_fetched":   0,
        "rows_total":     0,
        "updated":        0,
        "errors":         0,
        "skipped":        0,
    }
    status = "ok"

    try:
        for i, bill_doc in enumerate(cursor, start=1):
            counts["considered"] += 1
            eid           = bill_doc.get("external_id")
            cosponsors_url = bill_doc.get("cosponsors_url")
            count_seen     = bill_doc.get("cosponsors_count") or 0

            if not cosponsors_url:
                counts["skipped"] += 1
                continue

            try:
                rows = _fetch_all_cosponsors(cosponsors_url)
            except Exception as e:
                counts["errors"] += 1
                print(f"  ! [{i:>5d}/{needs_count}] {eid}: "
                      f"{type(e).__name__}: {e}")
                time.sleep(SLEEP_BETWEEN_CALLS)
                continue
            counts["list_fetched"] += 1
            counts["rows_total"]   += len(rows)

            now = dt.datetime.now(dt.timezone.utc)
            result = bills_col.update_one(
                {"external_id": eid},
                {"$set": {
                    "cosponsors_list":            rows,
                    "cosponsors_fetched_at":      now,
                    "cosponsors_count_at_fetch":  count_seen,
                    "cosponsors_fetch_run_id":    run_id,
                }},
            )
            if result.modified_count > 0:
                counts["updated"] += 1

            # Archive raw response (single-pager summary is enough; we
            # don't store every page since they roll up into rows already).
            records_col.insert_one({
                "run_id":     run_id,
                "source":     SOURCE,
                "endpoint":   "cosponsors_sub_resource",
                "external_id": eid,
                "fetched_at": now,
                "summary":    {"count": len(rows),
                               "url":   cosponsors_url},
            })

            # Per-bill heartbeat (lets the operator see smoke runs progress
            # in real time and gives nohup'd full runs a useful tail).
            if i == 1 or i % 25 == 0 or i == needs_count:
                print(f"  · [{i:>5d}/{needs_count}]  {eid}  "
                      f"fetched={counts['list_fetched']:>5d}  "
                      f"rows={counts['rows_total']:>7d}  "
                      f"errors={counts['errors']}")
            time.sleep(SLEEP_BETWEEN_CALLS)

    except KeyboardInterrupt:
        status = "interrupted"
        print("\n  ! interrupted by user — saving partial progress")
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

    # Touch Tier 2 breadcrumb.
    try:
        with postgres_conn() as conn, conn.cursor() as cur:
            cur.execute(
                "UPDATE ingestion_sources "
                "   SET last_sync_at = %s, sync_status = %s "
                " WHERE source_name = %s",
                (ended_at, status, SOURCE),
            )
            conn.commit()
    except Exception as e:
        print(f"  ! ingestion_sources update failed (non-fatal): "
              f"{type(e).__name__}: {e}")

    print(f"\n→ done. status={status} {counts}")
    return 0 if status == "ok" else 1


def main() -> int:
    p = argparse.ArgumentParser(
        description="Pull per-bill cosponsors lists from Congress.gov.")
    p.add_argument("--max", type=int, default=None,
                   help="cap the run at N bills (--max 5 for a smoke test)")
    p.add_argument("--refresh-all", action="store_true",
                   help="ignore staleness — refetch cosponsors for every bill")
    args = p.parse_args()
    return run(max_bills=args.max, refresh_all=args.refresh_all)


if __name__ == "__main__":
    sys.exit(main())
