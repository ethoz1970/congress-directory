"""
sync_cosponsors.py — Phase 4a Tier 2 sync.

Reads cosponsors_list off gov_mongo.bills (populated by
congress_gov_cosponsors.py) and UPSERTs each into the Oracle's
gov_postgres.bill_cosponsors table. After the sync, optionally
recomputes bills.bipartisan = true for every bill whose cosponsor
list spans both major parties.

Strictly one direction: Mongo (raw + URL targets) → Postgres (relational).

Mapping:
  cosponsor.bioguide_id → politicians.external_id → politicians.id
  bill.external_id      → bills.external_id      → bills.id

The bill_cosponsors table has UNIQUE(bill_id, politician_id), so the
upsert is naturally idempotent — re-running is safe. We bulk-INSERT
in chunked VALUES batches the same way the sponsor backfill does, then
ON CONFLICT DO UPDATE the joined_at if it's changed (a cosponsor can
re-sign on a re-introduction; rare but real).

Bipartisan flag:
  A bill is "bipartisan" when its cosponsor list (plus the primary
  sponsor) includes politicians from BOTH 'Democrat' and 'Republican'
  parties. Independents/Libertarians don't count for this flag.
  We compute it in pure SQL after the sync, so it stays in sync with
  whatever the politicians table currently says about each member's
  party.

Usage:
    python -m feeder.sync_cosponsors --dry --limit 5      # preview 5 bills
    python -m feeder.sync_cosponsors --limit 5            # sync 5 bills
    python -m feeder.sync_cosponsors                      # full sync
    python -m feeder.sync_cosponsors --bipartisan         # sync + flip flag
    python -m feeder.sync_cosponsors --bipartisan-only    # skip sync, just flip
"""
from __future__ import annotations

import argparse
import datetime as dt
import sys
import uuid

from .client import mongo_db, postgres_conn

SOURCE = "supabase_cosponsors"  # logical task source; physically reads Mongo
CHUNK = 1000


# -----------------------------------------------------------------------------
# SQL.
# -----------------------------------------------------------------------------
# Upsert one chunk of (bill_id, politician_id, joined_at) into bill_cosponsors.
# UNIQUE(bill_id, politician_id) keeps duplicates out.
_COSPONSORS_UPSERT_SQL = """
    INSERT INTO bill_cosponsors (bill_id, politician_id, joined_at)
    VALUES {placeholders}
    ON CONFLICT (bill_id, politician_id) DO UPDATE SET
        joined_at = COALESCE(EXCLUDED.joined_at, bill_cosponsors.joined_at)
"""

# Flip bills.bipartisan based on the cosponsor + sponsor mix.
# Counts as bipartisan when the bill has politicians from BOTH major parties
# among its sponsor and cosponsors. Re-runnable; only writes when the value
# would change.
_BIPARTISAN_UPDATE_SQL = """
    WITH party_mix AS (
        SELECT
            b.id AS bill_id,
            (EXISTS (
                SELECT 1
                  FROM bill_cosponsors bc
                  JOIN politicians p ON p.id = bc.politician_id
                 WHERE bc.bill_id = b.id
                   AND p.party = 'Democrat'
            ) OR COALESCE(p_sp.party = 'Democrat', false)) AS has_d,
            (EXISTS (
                SELECT 1
                  FROM bill_cosponsors bc
                  JOIN politicians p ON p.id = bc.politician_id
                 WHERE bc.bill_id = b.id
                   AND p.party = 'Republican'
            ) OR COALESCE(p_sp.party = 'Republican', false)) AS has_r
          FROM bills b
          LEFT JOIN politicians p_sp ON p_sp.id = b.sponsor_id
    )
    UPDATE bills b
       SET bipartisan = (pm.has_d AND pm.has_r)
      FROM party_mix pm
     WHERE pm.bill_id = b.id
       AND b.bipartisan IS DISTINCT FROM (pm.has_d AND pm.has_r)
"""


# -----------------------------------------------------------------------------
# Sync.
# -----------------------------------------------------------------------------
def _sync(limit: int | None, dry: bool) -> dict:
    """Pull cosponsors_list off Mongo, resolve UUIDs, bulk-upsert to Postgres."""
    db = mongo_db()
    bills_col = db["bills"]

    query = {"cosponsors_list": {"$exists": True, "$ne": []}}
    cursor = bills_col.find(
        query,
        {"external_id": 1, "cosponsors_list": 1},
    ).sort("cosponsors_count", -1)
    if limit:
        cursor = cursor.limit(int(limit))

    docs = list(cursor)
    print(f"  · {len(docs):,} bills with cosponsor lists in Mongo")

    counts = {
        "bills_considered": 0,
        "bills_with_rows":  0,
        "rows_upserted":    0,
        "rows_skipped_no_bg":   0,   # cosponsor bioguide not in politicians
        "rows_skipped_no_bill": 0,   # bill external_id not in postgres
        "errors":           0,
    }

    if dry:
        # Sample the first few bills so the operator can eyeball the shape.
        for doc in docs[:5]:
            eid = doc.get("external_id")
            rows = doc.get("cosponsors_list") or []
            print(f"  · DRY {eid}  cosponsors={len(rows)}  "
                  f"sample={[r.get('bioguide_id') for r in rows[:3]]}")
        return counts

    with postgres_conn() as oc, oc.cursor() as cur:
        # Build bioguide → politicians.id and external_id → bills.id maps.
        # Reading both up front means we avoid 600+15K extra queries.
        cur.execute("SELECT external_id, id::text FROM politicians")
        bg_to_pid = {r[0]: r[1] for r in cur.fetchall()}
        print(f"  · {len(bg_to_pid):,} politicians indexed by bioguide")

        cur.execute("SELECT external_id, id::text FROM bills")
        eid_to_bid = {r[0]: r[1] for r in cur.fetchall()}
        print(f"  · {len(eid_to_bid):,} bills indexed by external_id")

        # Walk every bill, resolve cosponsor bioguides → uuids,
        # accumulate (bill_id, politician_id, joined_at) rows in a dict
        # keyed by (bill_id, pid).
        #
        # Why a dict and not a list:
        #   Postgres rejects an INSERT … ON CONFLICT statement that tries
        #   to affect the same conflict target twice within one command
        #   ("CardinalityViolation: ON CONFLICT DO UPDATE command cannot
        #   affect row a second time"). Congress.gov occasionally returns
        #   the same cosponsor record twice on a single bill (member
        #   withdrew + re-cosponsored, or duplicate API records). We
        #   collapse those into a single row per (bill, member) before
        #   sending the INSERT. Last write wins.
        batch: dict[tuple[str, str], tuple[str, str, str | None]] = {}
        dedup_dropped = 0
        for doc in docs:
            counts["bills_considered"] += 1
            eid  = doc.get("external_id")
            rows = doc.get("cosponsors_list") or []
            bill_id = eid_to_bid.get(eid)
            if not bill_id:
                counts["rows_skipped_no_bill"] += len(rows)
                continue
            if rows:
                counts["bills_with_rows"] += 1
            for r in rows:
                bg = r.get("bioguide_id")
                pid = bg_to_pid.get(bg)
                if not pid:
                    counts["rows_skipped_no_bg"] += 1
                    continue
                key = (bill_id, pid)
                if key in batch:
                    dedup_dropped += 1
                batch[key] = (bill_id, pid, r.get("sponsorship_date"))

                if len(batch) >= CHUNK:
                    counts["rows_upserted"] += _flush_batch(
                        cur, list(batch.values()))
                    batch.clear()

        if batch:
            counts["rows_upserted"] += _flush_batch(
                cur, list(batch.values()))
            batch.clear()

        oc.commit()
        if dedup_dropped:
            print(f"  · {dedup_dropped:,} duplicate (bill,member) pairs "
                  f"collapsed before INSERT")

    return counts


def _flush_batch(cur, batch: list[tuple[str, str, str | None]]) -> int:
    """UPSERT one chunk. Returns the count actually written (cur.rowcount)."""
    placeholders = ",".join(["(%s::uuid, %s::uuid, %s::timestamptz)"] * len(batch))
    flat = [v for triple in batch for v in triple]
    sql = _COSPONSORS_UPSERT_SQL.format(placeholders=placeholders)
    cur.execute(sql, flat)
    return cur.rowcount


# -----------------------------------------------------------------------------
# Bipartisan flag.
# -----------------------------------------------------------------------------
def _flip_bipartisan(dry: bool) -> int:
    print("→ recomputing bills.bipartisan from sponsor + cosponsor party mix")
    if dry:
        print("  · DRY: would run bipartisan UPDATE")
        return 0
    with postgres_conn() as oc, oc.cursor() as cur:
        cur.execute(_BIPARTISAN_UPDATE_SQL)
        rowcount = cur.rowcount
        oc.commit()
    print(f"  · {rowcount:,} bills had their bipartisan flag flipped")
    return rowcount


# -----------------------------------------------------------------------------
# Driver.
# -----------------------------------------------------------------------------
def run(limit: int | None = None, dry: bool = False,
        bipartisan: bool = False, bipartisan_only: bool = False) -> int:
    run_id = str(uuid.uuid4())
    started = dt.datetime.now(dt.timezone.utc)
    print(f"→ run {run_id[:8]}  task=sync_cosponsors  "
          f"dry={dry}  bipartisan={bipartisan or bipartisan_only}  "
          f"bipartisan_only={bipartisan_only}")

    counts = {
        "bills_considered": 0,
        "bills_with_rows":  0,
        "rows_upserted":    0,
        "rows_skipped_no_bg":   0,
        "rows_skipped_no_bill": 0,
        "errors":           0,
    }
    bipartisan_flipped = 0
    status = "ok"

    # Log run start to Mongo for ops visibility.
    log_id = None
    try:
        db = mongo_db()
        log_id = db["ingestion_log"].insert_one({
            "run_id":     run_id,
            "source":     SOURCE,
            "task":       "sync_cosponsors",
            "started_at": started,
            "status":     "running",
            "args":       {"limit": limit, "dry": dry,
                           "bipartisan":      bipartisan,
                           "bipartisan_only": bipartisan_only},
        }).inserted_id
    except Exception as e:
        print(f"  ! ingestion_log start failed (non-fatal): "
              f"{type(e).__name__}: {e}")

    try:
        if not bipartisan_only:
            counts = _sync(limit=limit, dry=dry)
        if bipartisan or bipartisan_only:
            bipartisan_flipped = _flip_bipartisan(dry=dry)
    except KeyboardInterrupt:
        status = "interrupted"
        print("\n  ! interrupted by user")
    except Exception as e:
        status = "errored"
        print(f"!! run failed: {type(e).__name__}: {e}", file=sys.stderr)

    ended = dt.datetime.now(dt.timezone.utc)
    if log_id is not None:
        try:
            db["ingestion_log"].update_one({"_id": log_id}, {"$set": {
                "ended_at":            ended,
                "status":              status,
                "counts":              counts,
                "bipartisan_flipped":  bipartisan_flipped,
            }})
        except Exception as e:
            print(f"  ! ingestion_log end failed (non-fatal): "
                  f"{type(e).__name__}: {e}")

    print(f"\n→ done. status={status} counts={counts}"
          + (f" bipartisan_flipped={bipartisan_flipped}"
             if bipartisan or bipartisan_only else ""))
    return 0 if status == "ok" else 1


def main() -> int:
    p = argparse.ArgumentParser(
        description="Sync Mongo cosponsors → Oracle bill_cosponsors.")
    p.add_argument("--limit", type=int, default=None,
                   help="cap at N bills (smoke testing)")
    p.add_argument("--dry", action="store_true",
                   help="print plan only; no Oracle writes")
    p.add_argument("--bipartisan", action="store_true",
                   help="after sync, run bills.bipartisan recomputation")
    p.add_argument("--bipartisan-only", action="store_true",
                   help="skip sync; just recompute bipartisan flag")
    args = p.parse_args()
    return run(limit=args.limit, dry=args.dry,
               bipartisan=args.bipartisan,
               bipartisan_only=args.bipartisan_only)


if __name__ == "__main__":
    sys.exit(main())
