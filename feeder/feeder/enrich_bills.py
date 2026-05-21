"""
enrich_bills.py — Tier 1 (Mongo) → Tier 2 (Postgres) bill enrichment.

Phase C.1. Reads bills from `gov_mongo.bills` that have detail data
(`detail_fetched_at` set by the B.2 feeder) and upserts them into
`gov_postgres.bills` with derived fields:

  * portal_tag[]      — keyword-tagged via feeder/topics.py
  * status            — derived from latest_action_text (rough heuristic; B.3
                        actions data will let us replace with a real classifier)
  * time_bucket       — introduced_at truncated to the hour (cross-set joins)
  * chamber           — normalized to 'house' / 'senate' / NULL
  * bill_number       — display form, e.g. 'HR 524'
  * cosponsor_count   — copied from the B.2 detail field
  * sponsor_id        — NULL for now (politicians table is empty until the
                        next feeder lands)
  * bipartisan        — false for now (needs B.3 cosponsor party data)

Idempotent via UPSERT on `external_id`. Re-running is safe — bills already
in Postgres get their derived fields recomputed (catches portal/status
classifier bumps without manual intervention).

Usage:
    python -m feeder.enrich_bills                # all bills with detail
    python -m feeder.enrich_bills --max 5        # smoke test
    python -m feeder.enrich_bills --refresh-all  # ignore enrich_at staleness
"""
from __future__ import annotations

import argparse
import datetime as dt
import sys
import uuid
from typing import Iterable

from .client import mongo_db, postgres_conn
from .topics import tag_bill, CLASSIFIER_VERSION

SOURCE = "enricher"


# -----------------------------------------------------------------------------
# Derivation helpers.
# -----------------------------------------------------------------------------
def _chamber_code(origin_chamber_code: str | None) -> str | None:
    if not origin_chamber_code:
        return None
    c = origin_chamber_code.strip().upper()
    if c == "H":
        return "house"
    if c == "S":
        return "senate"
    return None


def _bill_number_display(btype: str | None, number: str | None) -> str | None:
    if not (btype and number):
        return None
    return f"{btype.upper()} {number}"


# Simple state-derivation heuristic on the latest-action text. The
# action timeline (B.3) will let us replace this with a real classifier
# that walks the action sequence; for now this is good enough that the
# 9-state lifecycle covers >95% of bills accurately. Order matters —
# the FIRST matching prefix wins, and the patterns are ordered from
# end-of-lifecycle (rare) to beginning (common).
_STATUS_PATTERNS: list[tuple[str, str]] = [
    ("became public law",        "signed"),
    ("signed by president",      "signed"),
    ("signed by the president",  "signed"),
    ("presented to president",   "enrolled"),
    ("presented to the president","enrolled"),
    ("vetoed by president",      "vetoed"),
    ("vetoed by the president",  "vetoed"),
    ("veto overridden",          "signed"),         # post-override the bill IS law
    ("passed senate, signed",    "signed"),
    ("agreed to in senate. agreed to in house", "passed_both_chambers"),
    ("agreed to in house. agreed to in senate", "passed_both_chambers"),
    ("passed house. passed senate","passed_both_chambers"),
    ("passed senate. passed house","passed_both_chambers"),
    ("passed senate",            "passed_one_chamber"),
    ("passed house",             "passed_one_chamber"),
    ("agreed to in senate",      "passed_one_chamber"),
    ("agreed to in house",       "passed_one_chamber"),
    ("placed on senate legislative calendar", "floor_scheduled"),
    ("placed on union calendar", "floor_scheduled"),
    ("placed on the union calendar","floor_scheduled"),
    ("placed on calendar",       "floor_scheduled"),
    ("reported by",              "committee"),
    ("ordered to be reported",   "committee"),
    ("markup",                   "committee"),
    ("referred to",              "committee"),
    ("introduced",               "introduced"),
]


def _derive_status(latest_action_text: str | None) -> str:
    if not latest_action_text:
        return "introduced"
    text = latest_action_text.lower().strip()
    for needle, status in _STATUS_PATTERNS:
        if needle in text:
            return status
    return "introduced"


def _parse_iso_date(s: str | None) -> dt.datetime | None:
    """Parse a 'YYYY-MM-DD' or full ISO string to a tz-aware datetime (UTC)."""
    if not s:
        return None
    try:
        # Date-only: e.g. '2025-01-16'
        if len(s) == 10:
            return dt.datetime.strptime(s, "%Y-%m-%d").replace(tzinfo=dt.timezone.utc)
        # Full ISO: e.g. '2025-01-23T15:25:34Z' or '...+00:00'
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        return dt.datetime.fromisoformat(s).astimezone(dt.timezone.utc)
    except (ValueError, TypeError):
        return None


def _hour_bucket(t: dt.datetime | None) -> dt.datetime | None:
    if t is None:
        return None
    return t.replace(minute=0, second=0, microsecond=0)


# -----------------------------------------------------------------------------
# Per-bill row builder.
# -----------------------------------------------------------------------------
def _row_from_mongo(b: dict) -> dict | None:
    """Build the gov_postgres.bills row dict, or None if the bill is unfit."""
    eid       = b.get("external_id")
    congress  = b.get("congress")
    btype     = b.get("type")
    number    = b.get("number")
    title     = b.get("title")
    intro     = _parse_iso_date(b.get("introduced_date"))
    if not (eid and congress and btype and number and title and intro):
        # gov_postgres.bills.introduced_at is NOT NULL — skip rather than crash.
        return None

    last_action_text = b.get("latest_action_text")
    last_action_at   = _parse_iso_date(b.get("latest_action_date"))

    # Portal tags combine policy_area direct mapping (authoritative) with
    # keyword matching on the title (catches secondary themes). Empty
    # portal_tag is honest output for bills whose policy_area doesn't map
    # to the SVP-12 taxonomy and whose title doesn't keyword-match.
    portal_tags = tag_bill(title, policy_area=b.get("policy_area"))

    return {
        "external_id":        eid,
        "chamber":            _chamber_code(b.get("origin_chamber_code")),
        "bill_number":        _bill_number_display(btype, number),
        "title":              title,
        "introduced_at":      intro,
        "status":             _derive_status(last_action_text),
        "last_action":        last_action_text,
        "last_action_at":     last_action_at,
        "sponsor_id":         None,             # politicians table empty for now
        "portal_tag":         portal_tags,      # list → text[] in psycopg
        "scope":              "federal",
        "state_code":         None,
        "session":            str(congress),
        "cosponsor_count":    int(b.get("cosponsors_count") or 0),
        "bipartisan":         False,            # needs B.3 cosponsor party data
        "racial_equity_flag": False,
        "time_bucket":        _hour_bucket(intro),
    }


# -----------------------------------------------------------------------------
# Driver.
# -----------------------------------------------------------------------------
_UPSERT_SQL = """
INSERT INTO bills (
    external_id, chamber, bill_number, title, introduced_at,
    status, last_action, last_action_at, sponsor_id,
    portal_tag, scope, state_code, session,
    cosponsor_count, bipartisan, racial_equity_flag,
    time_bucket
) VALUES (
    %(external_id)s, %(chamber)s, %(bill_number)s, %(title)s, %(introduced_at)s,
    %(status)s, %(last_action)s, %(last_action_at)s, %(sponsor_id)s,
    %(portal_tag)s, %(scope)s, %(state_code)s, %(session)s,
    %(cosponsor_count)s, %(bipartisan)s, %(racial_equity_flag)s,
    %(time_bucket)s
)
ON CONFLICT (external_id) DO UPDATE SET
    chamber          = EXCLUDED.chamber,
    bill_number      = EXCLUDED.bill_number,
    title            = EXCLUDED.title,
    introduced_at    = EXCLUDED.introduced_at,
    status           = EXCLUDED.status,
    last_action      = EXCLUDED.last_action,
    last_action_at   = EXCLUDED.last_action_at,
    portal_tag       = EXCLUDED.portal_tag,
    scope            = EXCLUDED.scope,
    state_code       = EXCLUDED.state_code,
    session          = EXCLUDED.session,
    cosponsor_count  = EXCLUDED.cosponsor_count,
    bipartisan       = EXCLUDED.bipartisan,
    time_bucket      = EXCLUDED.time_bucket
"""


def _iter_mongo_bills(db, refresh_all: bool, max_bills: int | None):
    query = {} if refresh_all else {"detail_fetched_at": {"$ne": None}}
    cursor = db["bills"].find(
        query,
        {
            "external_id":          1,
            "congress":             1,
            "type":                 1,
            "number":               1,
            "title":                1,
            "introduced_date":      1,
            "latest_action_text":   1,
            "latest_action_date":   1,
            "origin_chamber_code":  1,
            "cosponsors_count":     1,
            "policy_area":          1,   # needed by tag_bill()
        },
    ).sort("update_date_including_text", -1)
    if max_bills:
        cursor = cursor.limit(int(max_bills))
    return cursor


def run(max_bills: int | None = None, refresh_all: bool = False) -> int:
    run_id = str(uuid.uuid4())
    started_at = dt.datetime.now(dt.timezone.utc)
    mode = "all" if refresh_all else "with-detail-only"
    print(f"→ run {run_id[:8]}  task=enrich_bills  mode={mode}  "
          f"max={max_bills or 'all'}")

    db = mongo_db()
    ingestion_log = db["ingestion_log"]

    # Pre-count for the progress line. Mongo rejects limit=0, so only
    # forward `limit=` when the caller actually gave us a cap.
    query = {} if refresh_all else {"detail_fetched_at": {"$ne": None}}
    count_kwargs: dict = {"limit": int(max_bills)} if max_bills else {}
    total = db["bills"].count_documents(query, **count_kwargs)
    print(f"→ {total:,} bill(s) to enrich")
    if total == 0:
        return 0

    log_id = ingestion_log.insert_one({
        "run_id":               run_id,
        "source":               SOURCE,
        "task":                 "enrich_bills",
        "mode":                 mode,
        "started_at":           started_at,
        "needs":                total,
        "classifier_version":   CLASSIFIER_VERSION,
        "status":               "running",
    }).inserted_id

    counts = {
        "considered":  0,
        "upserted":    0,
        "skipped":     0,       # missing required fields (e.g. no introduced_date)
        "errors":      0,
    }
    status = "ok"

    try:
        with postgres_conn() as conn:
            for i, b in enumerate(_iter_mongo_bills(db, refresh_all, max_bills),
                                  start=1):
                counts["considered"] += 1
                try:
                    row = _row_from_mongo(b)
                    if row is None:
                        counts["skipped"] += 1
                        continue
                    with conn.cursor() as cur:
                        cur.execute(_UPSERT_SQL, row)
                    counts["upserted"] += 1
                except Exception as e:
                    counts["errors"] += 1
                    print(f"  ! [{i:>5d}/{total}] {b.get('external_id')}: "
                          f"{type(e).__name__}: {e}")

                # Commit + heartbeat every 500.
                if i % 500 == 0 or i == total:
                    conn.commit()
                    print(f"  · [{i:>5d}/{total}]  "
                          f"upserted={counts['upserted']:>5d}  "
                          f"skipped={counts['skipped']}  "
                          f"errors={counts['errors']}")
            conn.commit()

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

    # Mark a "synthesized" row in ingestion_sources so observers can see
    # the enricher's last run. We don't have a dedicated row for the
    # enricher in the seed; reuse the 'congress_gov' row's record_count
    # to reflect the count that's actually queryable in Tier 2.
    try:
        with postgres_conn() as conn, conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM bills")
            total_bills = cur.fetchone()[0]
            cur.execute(
                "UPDATE ingestion_sources "
                "   SET last_sync_at = %s, sync_status = %s, record_count = %s "
                " WHERE source_name = %s",
                (ended_at, status, total_bills, "congress_gov"),
            )
            # Reflect operational state.
            cur.execute(
                "UPDATE state SET value = %s, updated_at = now() "
                " WHERE key = %s",
                ("active", "filter_feeder_mode"),
            )
            conn.commit()
    except Exception as e:
        print(f"  ! ingestion_sources / state update failed (non-fatal): "
              f"{type(e).__name__}: {e}")

    print(f"\n→ done. status={status} {counts}")
    return 0 if status == "ok" else 1


def main() -> int:
    p = argparse.ArgumentParser(description="Enrich Mongo bills into Postgres.")
    p.add_argument("--max", type=int, default=None,
                   help="cap the run at N bills (use --max 5 for a smoke test)")
    p.add_argument("--refresh-all", action="store_true",
                   help="ignore detail_fetched_at gate; consider every Mongo bill")
    args = p.parse_args()
    return run(max_bills=args.max, refresh_all=args.refresh_all)


if __name__ == "__main__":
    sys.exit(main())
