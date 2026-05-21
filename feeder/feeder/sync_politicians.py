"""
sync_politicians.py — Phase 1a of the "everything WIOG mirrors into Oracle"
program.

Reads federal legislators from the Sentiment-vs-Power Supabase mirror
(`people` table, ~587 rows kept fresh by the upstream `sync_wiog.py`
job) and upserts them into the Oracle's `gov_postgres.politicians`
table. Strictly one-direction; Supabase never gets written to.

Why mirror via Supabase instead of going to the WhoIsOurGov Cloud Run
API directly:
  * Supabase already has the canonical 587 rows in the schema we want
  * It's local-to-our-stack (single DB call) instead of N HTTP calls
  * `sync_wiog` already runs daily on the workstation; Oracle stays a
    one-hop downstream consumer

The Oracle's `politicians` table is intentionally leaner than the
Supabase `people` shape — most of the WIOG-only columns (scoring,
ideology, sub-counts) aren't surfaced here yet. They can be added in
a later phase by widening the upsert; the join key (`external_id` ↔
`bioguide_id`) stays stable.

After this script runs, the existing `bills.sponsor_id` column —
which has been NULL since the Phase C enricher ran before politicians
existed — can be backfilled with the `--backfill` flag. That's a
single UPDATE statement that joins on `primary_sponsor_bioguide_id`.

Usage:
    python -m feeder.sync_politicians                  # full sync
    python -m feeder.sync_politicians --limit 5        # smoke test
    python -m feeder.sync_politicians --backfill       # sync + backfill bills.sponsor_id
    python -m feeder.sync_politicians --backfill-only  # skip sync, just backfill
    python -m feeder.sync_politicians --dry            # preview, no writes
"""
from __future__ import annotations

import argparse
import datetime as dt
import sys
import uuid

from .client import mongo_db, postgres_conn, supabase_conn

SOURCE = "supabase_people"


# -----------------------------------------------------------------------------
# Normalization helpers — Supabase shapes vary, Oracle prefers a tighter form.
# -----------------------------------------------------------------------------

def _norm_chamber(c) -> str | None:
    """'House' / 'Senate' / 'house' / 's' / None → 'house' | 'senate' | None."""
    if not c:
        return None
    s = str(c).strip().lower()
    if s.startswith("h"):
        return "house"
    if s.startswith("s"):
        return "senate"
    return None


def _office_from_chamber(chamber: str | None, supabase_office: str | None) -> str | None:
    """Derive the Oracle `office` column. Supabase has a freeform `office`
    field ("U.S. Representative", "U.S. Senator", "Governor", etc.) that we
    can mine first; chamber is the fallback.
    """
    o = (supabase_office or "").lower()
    if "senator" in o:
        return "senator"
    if "representative" in o:
        return "representative"
    if "governor" in o:
        return "governor"
    if chamber == "house":
        return "representative"
    if chamber == "senate":
        return "senator"
    return None


def _age_from_birthday(birthday) -> int | None:
    """birthday → integer years today. Returns None if unparseable."""
    if not birthday:
        return None
    if isinstance(birthday, dt.date):
        bd = birthday
    elif isinstance(birthday, str):
        try:
            bd = dt.date.fromisoformat(birthday[:10])
        except ValueError:
            return None
    else:
        return None
    today = dt.date.today()
    yrs = today.year - bd.year - ((today.month, today.day) < (bd.month, bd.day))
    return yrs if 18 <= yrs <= 110 else None


# -----------------------------------------------------------------------------
# Per-row mapper. Returns the dict passed to the Oracle UPSERT.
# -----------------------------------------------------------------------------

def _map_row(row: dict) -> dict | None:
    """Map a Supabase people row → Oracle politicians upsert payload.

    Returns None when the row can't be inserted (missing bioguide_id or
    missing both name and first/last fallback).
    """
    bg = row.get("bioguide_id")
    if not bg:
        return None

    full = row.get("full_name")
    if not full:
        fn = (row.get("first_name") or "").strip()
        ln = (row.get("last_name")  or "").strip()
        full = (fn + " " + ln).strip() or None
    if not full:
        return None

    chamber = _norm_chamber(row.get("chamber"))
    return {
        "external_id":    bg,
        "name":           full,
        "party":          (row.get("party") or None),
        "office":         _office_from_chamber(chamber, row.get("office")),
        "scope":          "federal",                    # Supabase people is federal-only today
        "state_code":     (row.get("state")    or None),
        "region":         (row.get("district") or None),
        "chamber":        chamber,
        "active_from":    row.get("term_start"),
        "active_to":      None,                          # not tracked upstream
        "term_ends":      row.get("term_end"),
        "age":            _age_from_birthday(row.get("birthday")),
        "phone":          (row.get("phone")        or None),
        "address":        None,                          # not in Supabase shape
        "website":        (row.get("website")      or None),
        "contact_form":   (row.get("contact_form") or None),
        "media_count_30d": int(row.get("news_mentions") or 0),
    }


# -----------------------------------------------------------------------------
# SQL.
# -----------------------------------------------------------------------------

# Supabase side — pull the fields we map. Order isn't significant; the dict
# returned by RealDictCursor / our manual unpack is what we read in _map_row.
_SUPABASE_SELECT = """
    SELECT bioguide_id, full_name, first_name, last_name,
           party, chamber, state, district, office,
           term_start, term_end, birthday,
           phone, website, contact_form,
           news_mentions
      FROM people
     WHERE bioguide_id IS NOT NULL
"""

# Oracle side — upsert by external_id. ON CONFLICT updates every column
# the mapper produces, so the next sync overwrites any drift. The `id`
# uuid is generated on first insert and never changes — that's the FK
# target bills.sponsor_id will point at.
_ORACLE_UPSERT = """
    INSERT INTO politicians (
        external_id, name, party, office, scope,
        state_code, region, chamber,
        active_from, active_to, term_ends,
        age, phone, address, website, contact_form,
        media_count_30d
    ) VALUES (
        %(external_id)s, %(name)s, %(party)s, %(office)s, %(scope)s,
        %(state_code)s, %(region)s, %(chamber)s,
        %(active_from)s, %(active_to)s, %(term_ends)s,
        %(age)s, %(phone)s, %(address)s, %(website)s, %(contact_form)s,
        %(media_count_30d)s
    )
    ON CONFLICT (external_id) DO UPDATE SET
        name             = EXCLUDED.name,
        party            = EXCLUDED.party,
        office           = EXCLUDED.office,
        scope            = EXCLUDED.scope,
        state_code       = EXCLUDED.state_code,
        region           = EXCLUDED.region,
        chamber          = EXCLUDED.chamber,
        active_from      = EXCLUDED.active_from,
        active_to        = EXCLUDED.active_to,
        term_ends        = EXCLUDED.term_ends,
        age              = EXCLUDED.age,
        phone            = EXCLUDED.phone,
        address          = EXCLUDED.address,
        website          = EXCLUDED.website,
        contact_form     = EXCLUDED.contact_form,
        media_count_30d  = EXCLUDED.media_count_30d
"""

# NOTE: gov_postgres.bills does NOT carry `primary_sponsor_bioguide_id`
# as a column today — the Phase B.2 detail feeder writes it to
# gov_mongo.bills, and the Phase C.1 Mongo→Postgres enricher never
# pulled it across. The bridge to Supabase reaches into Mongo on the
# fly; we do the same here. If the enricher ever materializes the
# bioguide column on Postgres, the sponsor backfill can collapse to a
# pure SQL JOIN.
#
# Bulk UPDATE — joins a VALUES list against bills on external_id so we
# don't do 15K individual round-trips. Driven by Python because the
# mapping (bioguide → politicians.id) is computed from a Mongo read.
_SPONSOR_BACKFILL_BULK = """
    UPDATE bills
       SET sponsor_id = data.pid::uuid
      FROM (VALUES %s) AS data(eid, pid)
     WHERE bills.external_id = data.eid
       AND (bills.sponsor_id IS DISTINCT FROM data.pid::uuid)
"""


# -----------------------------------------------------------------------------
# Driver.
# -----------------------------------------------------------------------------

def _sync(limit: int | None, dry: bool) -> dict:
    """Run the Supabase → Oracle pass."""
    print(f"→ reading from Supabase people (limit={limit or 'all'})")

    sql = _SUPABASE_SELECT
    if limit:
        sql += f" LIMIT {int(limit)}"

    with supabase_conn() as sc, sc.cursor() as cur:
        cur.execute(sql)
        cols = [d[0] for d in cur.description]
        rows = [dict(zip(cols, r)) for r in cur.fetchall()]
    print(f"  · {len(rows):,} legislators fetched")

    counts = {"considered": 0, "upserted": 0, "skipped": 0, "errors": 0}
    if dry:
        # Sample the first few mapped rows so the operator can eyeball
        # the shape before committing to real writes.
        for r in rows[:5]:
            mapped = _map_row(r)
            print(f"  · DRY {r.get('bioguide_id')} → {mapped}")
        return counts

    with postgres_conn() as oc:
        for r in rows:
            counts["considered"] += 1
            try:
                mapped = _map_row(r)
                if mapped is None:
                    counts["skipped"] += 1
                    continue
                with oc.cursor() as wcur:
                    wcur.execute(_ORACLE_UPSERT, mapped)
                counts["upserted"] += 1
            except Exception as e:
                counts["errors"] += 1
                print(f"  ! {r.get('bioguide_id')}: {type(e).__name__}: {e}")
        oc.commit()
    return counts


def _backfill_sponsors(dry: bool) -> int:
    """Wire bills.sponsor_id → politicians.id via the Mongo-stamped
    bioguide id. Returns the number of bills actually touched.

    Three steps:
      1. Read every (external_id, primary_sponsor_bioguide_id) pair from
         gov_mongo.bills. ~15K docs, cheap.
      2. Read every (bioguide, politicians.id) pair from
         gov_postgres.politicians. ~600 rows.
      3. Build a list of (external_id, politicians.id) pairs for every
         bill whose bioguide matches a known politician, then bulk
         UPDATE in chunked round-trips via UPDATE … FROM (VALUES …).
         psycopg v3 has no execute_values helper; we generate the
         placeholder string inline.
    """
    print("→ backfilling bills.sponsor_id (Mongo bioguide → politicians.id)")
    db = mongo_db()

    # Step 1 — pull bioguide pairs from Mongo.
    cursor = db["bills"].find(
        {"primary_sponsor_bioguide_id": {"$exists": True, "$ne": None}},
        {"external_id": 1, "primary_sponsor_bioguide_id": 1},
    )
    pairs = [
        (d["external_id"], d["primary_sponsor_bioguide_id"])
        for d in cursor
        if d.get("external_id") and d.get("primary_sponsor_bioguide_id")
    ]
    print(f"  · {len(pairs):,} bills carry a bioguide in Mongo")

    if dry:
        print("  · DRY: would join against politicians and bulk-update")
        return 0

    with postgres_conn() as oc, oc.cursor() as cur:
        # Step 2 — build bioguide → politicians.id map.
        cur.execute("SELECT external_id, id::text FROM politicians")
        bg_to_pid = {r[0]: r[1] for r in cur.fetchall()}
        print(f"  · {len(bg_to_pid):,} politicians indexed by bioguide")

        # Step 3 — narrow to matchable pairs.
        updates: list[tuple[str, str]] = []
        unmatched = 0
        for eid, bg in pairs:
            pid = bg_to_pid.get(bg)
            if pid:
                updates.append((eid, pid))
            else:
                unmatched += 1
        if unmatched:
            print(f"  · {unmatched:,} bills have a bioguide not in politicians "
                  f"(governor IDs, retired members, etc — skipped)")

        if not updates:
            print("  · nothing to update.")
            return 0
        print(f"  · {len(updates):,} bills are candidates for sponsor_id update")

        # Chunked UPDATE … FROM (VALUES …). 1000 rows per round-trip keeps
        # the parameter count comfortably under Postgres's 65,535 limit
        # (1000 × 2 = 2,000 placeholders) without paying per-row round-trips.
        CHUNK = 1000
        rowcount = 0
        for i in range(0, len(updates), CHUNK):
            batch = updates[i:i + CHUNK]
            placeholders = ",".join(["(%s, %s)"] * len(batch))
            flat = [v for pair in batch for v in pair]
            sql = f"""
                UPDATE bills
                   SET sponsor_id = data.pid::uuid
                  FROM (VALUES {placeholders}) AS data(eid, pid)
                 WHERE bills.external_id = data.eid
                   AND (bills.sponsor_id IS DISTINCT FROM data.pid::uuid)
            """
            cur.execute(sql, flat)
            rowcount += cur.rowcount
        oc.commit()

    print(f"  · {rowcount:,} bills updated with sponsor_id")
    return rowcount


def run(limit: int | None = None, dry: bool = False,
        backfill: bool = False, backfill_only: bool = False) -> int:
    run_id = str(uuid.uuid4())
    started = dt.datetime.now(dt.timezone.utc)
    print(f"→ run {run_id[:8]}  task=sync_politicians  "
          f"dry={dry}  backfill={backfill or backfill_only}  "
          f"backfill_only={backfill_only}")

    counts = {"considered": 0, "upserted": 0, "skipped": 0, "errors": 0}
    backfilled = 0
    status = "ok"

    # Log run start to Mongo for ops visibility (matches the pattern in
    # congress_gov.py, enrich_bills.py, bridge_supabase.py).
    log_id = None
    try:
        db = mongo_db()
        log_id = db["ingestion_log"].insert_one({
            "run_id":     run_id,
            "source":     SOURCE,
            "task":       "sync_politicians",
            "started_at": started,
            "status":     "running",
            "args":       {"limit": limit, "dry": dry,
                            "backfill": backfill, "backfill_only": backfill_only},
        }).inserted_id
    except Exception as e:
        print(f"  ! ingestion_log start failed (non-fatal): {type(e).__name__}: {e}")

    try:
        if not backfill_only:
            counts = _sync(limit=limit, dry=dry)

        if backfill or backfill_only:
            backfilled = _backfill_sponsors(dry=dry)
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
                "ended_at":    ended,
                "status":      status,
                "counts":      counts,
                "backfilled":  backfilled,
            }})
        except Exception as e:
            print(f"  ! ingestion_log end failed (non-fatal): {type(e).__name__}: {e}")

    print(f"\n→ done. status={status} counts={counts}"
          + (f" backfilled={backfilled}" if backfill or backfill_only else ""))
    return 0 if status == "ok" else 1


def main() -> int:
    p = argparse.ArgumentParser(description="Sync Supabase people → Oracle politicians.")
    p.add_argument("--limit", type=int, default=None,
                   help="cap at N rows (smoke testing)")
    p.add_argument("--dry", action="store_true",
                   help="print plan only; no Oracle writes")
    p.add_argument("--backfill", action="store_true",
                   help="after sync, run UPDATE bills SET sponsor_id = ...")
    p.add_argument("--backfill-only", action="store_true",
                   help="skip the sync; just run the sponsor_id backfill")
    args = p.parse_args()
    return run(limit=args.limit, dry=args.dry,
               backfill=args.backfill, backfill_only=args.backfill_only)


if __name__ == "__main__":
    sys.exit(main())
