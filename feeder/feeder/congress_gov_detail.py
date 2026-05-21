"""
congress_gov_detail.py — Filter feeder for the per-bill detail endpoint.

Phase B.2. Sits on top of B.1: we walk `gov_mongo.bills` for entries that
need their detail data refreshed and hit
    /v3/bill/{congress}/{type}/{number}
for each. The detail endpoint gives us the full sponsors array (with
bioguide IDs, party, state, district), introduced_date, policy area, and
COUNTS + URLs for the deeper sub-resources (actions, cosponsors,
committees, subjects, summaries, text versions, titles). B.3 will walk
those sub-URLs; this script is the prerequisite that gives them targets.

Staleness model:
  * On first run, every bill needs detail (`detail_fetched_at` is null).
  * On subsequent runs, a bill needs detail again only when its
    `update_date_including_text` (from B.1's list-endpoint pull) is
    different from `detail_update_date_including_text` (the value we
    captured the last time we fetched detail).
  * This means B.1 + B.2 together form a clean change-feed: B.1 keeps
    everyone's list-level state current; B.2 only pays the per-bill cost
    when something actually changed.

Rate budget:
  Congress.gov: 5,000 requests/hour. Default pacing is 0.8s/call =
  ~4,500/hour, well under the limit. First-time backfill of the full
  119th Congress (~15,600 bills) takes ~3.5 hours; use --max to chunk
  it across sessions if you can't sit on it that long.

Usage:
    python -m feeder.congress_gov_detail --max 5            # smoke test
    python -m feeder.congress_gov_detail --max 1000         # one chunk
    python -m feeder.congress_gov_detail                    # full stale set
    python -m feeder.congress_gov_detail --refresh-all      # ignore staleness, refetch everything
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
SLEEP_BETWEEN_CALLS = 0.8        # 4500/hour, well under 5000/hour limit


# -----------------------------------------------------------------------------
# URL.
# -----------------------------------------------------------------------------
def detail_url(congress: int, btype: str, number: str | int) -> str:
    params = {"api_key": CONGRESS_GOV_API_KEY, "format": "json"}
    return f"{API_BASE}/bill/{congress}/{btype.lower()}/{number}?{urlencode(params)}"


# -----------------------------------------------------------------------------
# Parsing helpers — the detail endpoint nests sub-resource metadata
# inside small {"count": N, "url": "..."} objects. We flatten those to
# top-level scalar columns so the Tier 2 enricher (Phase C) doesn't have
# to dig.
# -----------------------------------------------------------------------------
def _sub_count(node, default=0) -> int:
    if isinstance(node, dict):
        try:
            return int(node.get("count", default) or default)
        except (TypeError, ValueError):
            return default
    return default


def _sub_url(node) -> str | None:
    if isinstance(node, dict):
        return node.get("url")
    return None


def _parse_sponsors(raw_sponsors) -> tuple[list, str | None]:
    """
    Normalize the API's sponsor objects to the shape we want to query
    against (snake_case, bioguide promoted to its own field). Returns
    (parsed_sponsors, primary_bioguide_id_or_None).
    """
    parsed = []
    primary = None
    for s in (raw_sponsors or []):
        if not isinstance(s, dict):
            continue
        bg = s.get("bioguideId")
        if not bg:
            continue
        rec = {
            "bioguide_id":   bg,
            "full_name":     s.get("fullName"),
            "first_name":    s.get("firstName"),
            "last_name":     s.get("lastName"),
            "middle_name":   s.get("middleName"),
            "party":         s.get("party"),
            "state":         s.get("state"),
            "district":      s.get("district"),
            "is_by_request": (s.get("isByRequest") or "").upper() == "Y",
            "url":           s.get("url"),
        }
        parsed.append(rec)
        if primary is None:
            primary = bg
    return parsed, primary


def _build_update_fields(bill_detail: dict, now: dt.datetime, run_id: str) -> dict:
    sponsors, primary = _parse_sponsors(bill_detail.get("sponsors"))

    actions       = bill_detail.get("actions")        or {}
    cosponsors    = bill_detail.get("cosponsors")     or {}
    committees    = bill_detail.get("committees")     or {}
    subjects      = bill_detail.get("subjects")       or {}
    summaries     = bill_detail.get("summaries")      or {}
    text_versions = bill_detail.get("textVersions")   or {}
    titles        = bill_detail.get("titles")         or {}
    policy_area   = bill_detail.get("policyArea")     or {}

    return {
        # Newly available scalars.
        "introduced_date":              bill_detail.get("introducedDate"),
        "policy_area":                  policy_area.get("name"),
        "constitutional_authority_text": bill_detail.get("constitutionalAuthorityStatementText"),

        # Sponsors — flattened.
        "sponsors":                     sponsors,
        "primary_sponsor_bioguide_id":  primary,

        # Sub-resource counts (cheap reads at Tier 2 query time).
        "actions_count":                _sub_count(actions),
        "cosponsors_count":             _sub_count(cosponsors),
        "committees_count":             _sub_count(committees),
        "subjects_count":               _sub_count(subjects),
        "summaries_count":              _sub_count(summaries),
        "text_versions_count":          _sub_count(text_versions),
        "titles_count":                 _sub_count(titles),

        # Sub-resource URLs (so B.3 doesn't have to construct them).
        "actions_url":                  _sub_url(actions),
        "cosponsors_url":               _sub_url(cosponsors),
        "committees_url":               _sub_url(committees),
        "subjects_url":                 _sub_url(subjects),
        "summaries_url":                _sub_url(summaries),
        "text_versions_url":            _sub_url(text_versions),
        "titles_url":                   _sub_url(titles),

        # Detail provenance.
        "detail_raw":                       bill_detail,
        "detail_fetched_at":                now,
        "detail_fetch_run_id":              run_id,
        "detail_update_date":               bill_detail.get("updateDate"),
        "detail_update_date_including_text": bill_detail.get("updateDateIncludingText"),
    }


# -----------------------------------------------------------------------------
# Bill selection — which docs need detail?
# -----------------------------------------------------------------------------
def _staleness_query() -> dict:
    """
    A bill needs detail when:
      * we've never fetched it (detail_fetched_at is null), OR
      * the list-endpoint pull has seen a newer update timestamp than
        the one we captured at last detail fetch.

    Comparing string ISO-8601 timestamps from the same source is safe:
    they share offset format ("Z") so lexicographic order matches
    chronological order.
    """
    return {
        "$or": [
            {"detail_fetched_at": None},
            {"$expr": {
                "$and": [
                    {"$ne": ["$update_date_including_text", None]},
                    {"$ne": ["$update_date_including_text",
                              "$detail_update_date_including_text"]},
                ]
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
    print(f"→ run {run_id[:8]}  task=bill_detail  mode={mode}  "
          f"max={max_bills or 'all'}")

    db = mongo_db()
    bills_col     = db["bills"]
    records_col   = db["records"]
    ingestion_log = db["ingestion_log"]

    query = {} if refresh_all else _staleness_query()
    cursor = bills_col.find(
        query,
        {
            "external_id": 1,
            "congress":    1,
            "type":        1,
            "number":      1,
            "title":       1,
            "update_date_including_text":          1,
            "detail_update_date_including_text":   1,
        },
    ).sort("update_date_including_text", -1)
    if max_bills:
        cursor = cursor.limit(int(max_bills))

    # Pre-count for the progress line. Mongo rejects limit=0, so only
    # forward `limit=` when the caller actually capped the run.
    count_kwargs: dict = {"limit": int(max_bills)} if max_bills else {}
    needs_count = bills_col.count_documents(query, **count_kwargs)
    print(f"→ {needs_count:,} bill(s) need detail")
    if needs_count == 0:
        return 0

    log_id = ingestion_log.insert_one({
        "run_id":     run_id,
        "source":     SOURCE,
        "task":       "bill_detail",
        "mode":       mode,
        "started_at": started_at,
        "needs":      needs_count,
        "status":     "running",
    }).inserted_id

    counts = {
        "considered":     0,
        "detail_fetched": 0,
        "updated":        0,
        "errors":         0,
        "skipped":        0,
    }
    status = "ok"

    try:
        for i, bill_doc in enumerate(cursor, start=1):
            counts["considered"] += 1
            congress = bill_doc.get("congress")
            btype    = (bill_doc.get("type") or "").upper()
            number   = bill_doc.get("number")
            eid      = bill_doc.get("external_id")
            if not (congress and btype and number is not None):
                counts["errors"] += 1
                print(f"  ! [{i:>5d}/{needs_count}] malformed bill doc: {eid}")
                continue

            url = detail_url(congress, btype, number)
            try:
                resp = fetch_json(url)
            except Exception as e:
                counts["errors"] += 1
                print(f"  ! [{i:>5d}/{needs_count}] {eid}: "
                      f"{type(e).__name__}: {e}")
                time.sleep(SLEEP_BETWEEN_CALLS)
                continue
            counts["detail_fetched"] += 1

            bill_detail = (resp or {}).get("bill") or {}
            if not bill_detail:
                counts["errors"] += 1
                print(f"  ! [{i:>5d}/{needs_count}] {eid}: empty 'bill' field")
                time.sleep(SLEEP_BETWEEN_CALLS)
                continue

            now = dt.datetime.now(dt.timezone.utc)
            fields = _build_update_fields(bill_detail, now, run_id)
            result = bills_col.update_one(
                {"external_id": eid},
                {"$set": fields},
            )
            if result.modified_count > 0:
                counts["updated"] += 1

            # Archive raw response.
            records_col.insert_one({
                "run_id":     run_id,
                "source":     SOURCE,
                "endpoint":   f"/bill/{congress}/{btype.lower()}/{number}",
                "external_id": eid,
                "fetched_at": now,
                "response":   resp,
            })

            # Heartbeat every 100 bills.
            if i % 100 == 0 or i == needs_count:
                print(f"  · [{i:>5d}/{needs_count}]  {eid}  "
                      f"updates={counts['updated']:>5d}  "
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

    # Touch Tier 2 breadcrumb. Non-fatal on failure.
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
    p = argparse.ArgumentParser(description="Pull per-bill detail from Congress.gov.")
    p.add_argument("--max", type=int, default=None,
                   help="cap the run at N bills (use --max 5 for a smoke test)")
    p.add_argument("--refresh-all", action="store_true",
                   help="ignore staleness — refetch detail for every bill")
    args = p.parse_args()
    return run(max_bills=args.max, refresh_all=args.refresh_all)


if __name__ == "__main__":
    sys.exit(main())
