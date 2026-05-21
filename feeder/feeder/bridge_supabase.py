"""
bridge_supabase.py — One-direction sync: gov_postgres.bills → Supabase bills.

Phase D.1. The Oracle is on LAN (10.1.10.4) and never opens ports publicly;
Railway / Scrollvate runs on the public internet and reads from Supabase.
This script is the bridge that makes Oracle-sourced data visible to the
public surface without exposing the Oracle itself.

Direction is strictly one-way:
  Oracle (source of truth)  →  Supabase (read mirror)

User-generated writes (follows, vibes) go the OTHER way and are handled
by a separate aggregate job (Phase F). The two never collide because
Oracle's `bills` table is bill metadata only and Supabase's social fields
(follow_count, like_count) are written by the browser, not by us.

Idempotent. Re-runs are cheap — every row UPSERTs on the natural key
(`external_id` ↔ `key`), and only fields the bridge owns get overwritten.
The legacy WIOG mirror columns (title, introduced_date, url, etc.)
*are* overwritten because the Oracle has fresher data than WIOG's
sponsored-legislation endpoint did.

Usage:
    python -m feeder.bridge_supabase                 # full sync
    python -m feeder.bridge_supabase --max 50        # smoke test
    python -m feeder.bridge_supabase --since "2026-05-11T00:00:00Z"
                                                     # only Oracle rows
                                                     # whose updated_at
                                                     # is newer than X
"""
from __future__ import annotations

import argparse
import datetime as dt
import sys
import uuid

from .client import postgres_conn, supabase_conn, mongo_db

SOURCE = "oracle_bridge"
BATCH_SIZE = 500


# -----------------------------------------------------------------------------
# Column projection — what the bridge reads from Oracle.
# -----------------------------------------------------------------------------
# The query picks every field Supabase wants. Note: we DON'T select the
# Oracle's `id` (uuid) — Supabase keys on `external_id` instead. The
# `created_at` from Oracle (when this row landed in Tier 2) doubles as
# our staleness signal: if Oracle has updated a row since we last
# bridged it, oracle_synced_at < bills.created_at on the next pass.
_SOURCE_SELECT = """
SELECT b.external_id,
       b.title,
       b.chamber,
       b.bill_number,
       b.status,
       b.last_action,
       b.last_action_at,
       b.introduced_at,
       b.portal_tag,
       b.scope,
       b.state_code,
       b.session,
       b.cosponsor_count,
       b.bipartisan,
       b.racial_equity_flag,
       -- Nia-written enrichments (Phase F on the Oracle side).
       b.plain_english,
       b.impact_summary,
       b.plain_english_model,
       b.plain_english_written_at,
       b.enrichment_version,
       b.created_at  AS source_created_at,
       -- Derived columns the legacy WIOG mirror expects on Supabase.
       (b.session)::int               AS congress,
       split_part(b.external_id,'-',2) AS bill_type_letter,
       split_part(b.external_id,'-',3) AS bill_number_part
  FROM bills b
 WHERE (%(since)s::timestamptz IS NULL OR b.created_at >= %(since)s::timestamptz)
 ORDER BY b.created_at DESC, b.external_id
"""

# Map from Oracle row to the Supabase upsert. Note `key` uses the same
# `external_id` shape ('119-HR-1234') the existing Supabase mirror already
# uses, so this is a true upsert across both data sources.
_UPSERT_SQL = """
INSERT INTO bills (
    key, congress, type, number, title,
    introduced_date, latest_action_date, latest_action_text,
    -- Oracle-sourced columns added by migration 0004:
    chamber, bill_number, status, portal_tag,
    scope, state_code, session,
    cosponsor_count, bipartisan, racial_equity_flag,
    policy_area, primary_sponsor_bioguide_id,
    -- Nia-written enrichment columns added by migration 0005:
    plain_english, impact_summary,
    plain_english_model, plain_english_written_at, enrichment_version,
    -- Provenance.
    source_origin, oracle_synced_at,
    first_seen_at, last_seen_at
) VALUES (
    %(key)s, %(congress)s, %(type)s, %(number)s, %(title)s,
    %(introduced_date)s, %(latest_action_date)s, %(latest_action_text)s,
    %(chamber)s, %(bill_number)s, %(status)s, %(portal_tag)s,
    %(scope)s, %(state_code)s, %(session)s,
    %(cosponsor_count)s, %(bipartisan)s, %(racial_equity_flag)s,
    %(policy_area)s, %(primary_sponsor_bioguide_id)s,
    %(plain_english)s, %(impact_summary)s,
    %(plain_english_model)s, %(plain_english_written_at)s, %(enrichment_version)s,
    %(source_origin)s, %(oracle_synced_at)s,
    COALESCE(%(now)s, now()), %(now)s
)
ON CONFLICT (key) DO UPDATE SET
    title                       = COALESCE(EXCLUDED.title, bills.title),
    introduced_date             = COALESCE(EXCLUDED.introduced_date, bills.introduced_date),
    latest_action_date          = COALESCE(EXCLUDED.latest_action_date, bills.latest_action_date),
    latest_action_text          = COALESCE(EXCLUDED.latest_action_text, bills.latest_action_text),
    chamber                     = EXCLUDED.chamber,
    bill_number                 = EXCLUDED.bill_number,
    status                      = EXCLUDED.status,
    portal_tag                  = EXCLUDED.portal_tag,
    scope                       = EXCLUDED.scope,
    state_code                  = EXCLUDED.state_code,
    session                     = EXCLUDED.session,
    cosponsor_count             = EXCLUDED.cosponsor_count,
    bipartisan                  = EXCLUDED.bipartisan,
    racial_equity_flag          = EXCLUDED.racial_equity_flag,
    policy_area                 = EXCLUDED.policy_area,
    primary_sponsor_bioguide_id = EXCLUDED.primary_sponsor_bioguide_id,
    -- Enrichment fields: only overwrite when Oracle has a value, never
    -- clobber existing Supabase data with NULL (defensive — Oracle is
    -- SOT for these, but partial mid-batch failures shouldn't blank
    -- summaries on the public side).
    plain_english              = COALESCE(EXCLUDED.plain_english, bills.plain_english),
    impact_summary             = COALESCE(EXCLUDED.impact_summary, bills.impact_summary),
    plain_english_model        = COALESCE(EXCLUDED.plain_english_model, bills.plain_english_model),
    plain_english_written_at   = COALESCE(EXCLUDED.plain_english_written_at, bills.plain_english_written_at),
    enrichment_version         = COALESCE(EXCLUDED.enrichment_version, bills.enrichment_version),
    source_origin               = EXCLUDED.source_origin,
    oracle_synced_at            = EXCLUDED.oracle_synced_at,
    last_seen_at                = EXCLUDED.last_seen_at
"""


# -----------------------------------------------------------------------------
# Per-row builder. Oracle gives us most fields directly; we layer on
# Mongo-sourced `policy_area` and `primary_sponsor_bioguide_id` because
# those weren't pulled into Tier 2 by the enricher yet.
# -----------------------------------------------------------------------------
def _mongo_lookups(db, external_ids: list[str]) -> dict[str, dict]:
    if not external_ids:
        return {}
    cursor = db["bills"].find(
        {"external_id": {"$in": external_ids}},
        {"external_id": 1, "policy_area": 1, "primary_sponsor_bioguide_id": 1},
    )
    return {b["external_id"]: b for b in cursor}


def _row_for_upsert(oracle_row: tuple, mongo_lookup: dict, now: dt.datetime) -> dict:
    (
        external_id, title, chamber, bill_number, status,
        last_action, last_action_at, introduced_at,
        portal_tag, scope, state_code, session,
        cosponsor_count, bipartisan, racial_equity_flag,
        # Nia-written enrichment fields (may be NULL on bills she
        # hasn't reached yet).
        plain_english, impact_summary,
        plain_english_model, plain_english_written_at, enrichment_version,
        source_created_at, congress, bill_type_letter, bill_number_part,
    ) = oracle_row
    m = mongo_lookup.get(external_id) or {}
    return {
        "key":                         external_id,
        "congress":                    congress,
        "type":                        bill_type_letter,
        "number":                      bill_number_part,
        "title":                       title,
        "introduced_date":             introduced_at.date() if introduced_at else None,
        "latest_action_date":          last_action_at.date() if last_action_at else None,
        "latest_action_text":          last_action,
        "chamber":                     chamber,
        "bill_number":                 bill_number,
        "status":                      status,
        "portal_tag":                  portal_tag or [],
        "scope":                       scope,
        "state_code":                  state_code,
        "session":                     session,
        "cosponsor_count":             cosponsor_count,
        "bipartisan":                  bipartisan,
        "racial_equity_flag":          racial_equity_flag,
        "policy_area":                 m.get("policy_area"),
        "primary_sponsor_bioguide_id": m.get("primary_sponsor_bioguide_id"),
        # Nia-written enrichment fields. May be NULL on bills she hasn't
        # processed yet; the UPSERT uses COALESCE so a NULL won't blank
        # an existing summary.
        "plain_english":               plain_english,
        "impact_summary":              impact_summary,
        "plain_english_model":         plain_english_model,
        "plain_english_written_at":    plain_english_written_at,
        "enrichment_version":          enrichment_version,
        "source_origin":               "oracle",
        "oracle_synced_at":            now,
        "now":                         now,
    }


# -----------------------------------------------------------------------------
# Driver.
# -----------------------------------------------------------------------------
def run(max_bills: int | None = None, since: str | None = None) -> int:
    run_id = str(uuid.uuid4())
    started_at = dt.datetime.now(dt.timezone.utc)
    print(f"→ run {run_id[:8]}  task=oracle→supabase bridge  "
          f"since={since or 'all'}  max={max_bills or 'all'}")

    db = mongo_db()
    ingestion_log = db["ingestion_log"]

    # Read from Oracle.
    rows: list[tuple] = []
    with postgres_conn() as conn, conn.cursor() as cur:
        cur.execute(_SOURCE_SELECT, {"since": since})
        rows = cur.fetchall()
        if max_bills:
            rows = rows[: int(max_bills)]
    total = len(rows)
    print(f"→ {total:,} bill(s) from Oracle to bridge")

    log_id = ingestion_log.insert_one({
        "run_id":     run_id,
        "source":     SOURCE,
        "task":       "bridge_bills",
        "since":      since,
        "started_at": started_at,
        "needs":      total,
        "status":     "running",
    }).inserted_id

    if total == 0:
        ingestion_log.update_one({"_id": log_id}, {"$set": {
            "ended_at": dt.datetime.now(dt.timezone.utc),
            "status":   "ok",
            "counts":   {"considered": 0, "upserted": 0, "errors": 0},
        }})
        print("→ nothing to do.")
        return 0

    counts = {"considered": 0, "upserted": 0, "errors": 0}
    status = "ok"
    now = dt.datetime.now(dt.timezone.utc)
    first_error: tuple[str, str] | None = None      # (external_id, "ExcName: msg")

    try:
        with supabase_conn(direct=True) as sb:
            for batch_start in range(0, total, BATCH_SIZE):
                batch = rows[batch_start : batch_start + BATCH_SIZE]
                batch_ids = [r[0] for r in batch]
                lookups = _mongo_lookups(db, batch_ids)
                with sb.cursor() as cur:
                    for r in batch:
                        counts["considered"] += 1
                        # Wrap each row in its own SAVEPOINT. Without this,
                        # the first failing row aborts the transaction and
                        # every subsequent execute in the batch returns
                        # `InFailedSqlTransaction` — 494 ghost errors per
                        # one real error. Savepoints scope failures to the
                        # offending row.
                        try:
                            cur.execute("SAVEPOINT row_sp")
                            cur.execute(_UPSERT_SQL,
                                        _row_for_upsert(r, lookups, now))
                            cur.execute("RELEASE SAVEPOINT row_sp")
                            counts["upserted"] += 1
                        except Exception as e:
                            counts["errors"] += 1
                            err_str = f"{type(e).__name__}: {e}"
                            if first_error is None:
                                first_error = (r[0], err_str)
                            print(f"  ! {r[0]}: {err_str}")
                            # Recover the transaction so the next row can
                            # execute. ROLLBACK TO SAVEPOINT can itself
                            # fail in pathological cases — guard it so we
                            # don't crash the whole run.
                            try:
                                cur.execute("ROLLBACK TO SAVEPOINT row_sp")
                            except Exception:
                                # Last-ditch — recover via a fresh batch.
                                sb.rollback()
                                break
                sb.commit()
                print(f"  · [{counts['considered']:>5d}/{total}]  "
                      f"upserted={counts['upserted']:>5d}  "
                      f"errors={counts['errors']}")

    except KeyboardInterrupt:
        status = "interrupted"
        print("\n  ! interrupted — partial progress saved.")
    except Exception as e:
        status = "errored"
        counts["errors"] += 1
        print(f"!! run failed: {type(e).__name__}: {e}", file=sys.stderr)

    # Surface the first real error prominently — easy to miss in the
    # scroll. If every row worked, this is silent.
    if first_error is not None:
        eid, msg = first_error
        print(f"\n→ first error was on {eid}:\n    {msg}")

    ended_at = dt.datetime.now(dt.timezone.utc)
    ingestion_log.update_one({"_id": log_id}, {"$set": {
        "ended_at": ended_at,
        "status":   status,
        "counts":   counts,
    }})

    # Touch state on Oracle to surface that the bridge ran.
    try:
        with postgres_conn() as conn, conn.cursor() as cur:
            cur.execute(
                "INSERT INTO state (key, value, updated_at) VALUES (%s, %s, now()) "
                "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "
                "updated_at = now()",
                ("last_supabase_bridge_at", ended_at.isoformat()),
            )
            conn.commit()
    except Exception as e:
        print(f"  ! state update failed (non-fatal): {type(e).__name__}: {e}")

    print(f"\n→ done. status={status} {counts}")
    return 0 if status == "ok" else 1


def main() -> int:
    p = argparse.ArgumentParser(description="Sync Oracle bills → Supabase.")
    p.add_argument("--max", type=int, default=None,
                   help="cap at N rows (smoke testing)")
    p.add_argument("--since", type=str, default=None,
                   help="ISO timestamp; only bridge Oracle rows whose "
                        "created_at >= this")
    args = p.parse_args()
    return run(max_bills=args.max, since=args.since)


if __name__ == "__main__":
    sys.exit(main())
