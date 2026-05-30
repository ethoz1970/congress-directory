#!/usr/bin/env python3
"""
enrich_legislation.py — Tier 2: project gov_mongo.legislation_raw into
                         politicians.{sponsored_count, cosponsored_count,
                         enacted_count, legislation_updated_at}.

Pairs with capture_legislation.py. Simplest enrich in the set — natural
key match (politicians.external_id IS the bioguide_id), no JSONB lookups
needed.

Usage:
    python -m feeder.enrich_legislation
    python -m feeder.enrich_legislation --dry
    python -m feeder.enrich_legislation --bioguide T000479
"""
from __future__ import annotations

import argparse
import sys
import uuid
from datetime import datetime, timezone

from .client import mongo_db, postgres_conn


SOURCE_NAME = "congress-gov-member-legislation"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


UPDATE_SQL = """
UPDATE politicians
   SET sponsored_count        = %(sponsored)s,
       cosponsored_count      = %(cosponsored)s,
       enacted_count          = %(enacted)s,
       legislation_updated_at = %(updated_at)s
 WHERE external_id = %(bioguide)s
"""


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Enrich politicians legislation counts from gov_mongo.legislation_raw."
    )
    parser.add_argument("--bioguide", default=None,
                        help="Enrich a single bioguide_id only.")
    parser.add_argument("--dry", action="store_true",
                        help="Read + count; skip Postgres writes.")
    args = parser.parse_args()

    run_id = str(uuid.uuid4())
    started_at = _now_iso()
    print(f"[ENRICH-LEG] run_id={run_id}  started_at={started_at}  dry={args.dry}")

    db = mongo_db()
    query = {"_id": args.bioguide} if args.bioguide else {}
    docs = list(db.legislation_raw.find(query))
    print(f"[ENRICH-LEG] read {len(docs)} doc(s) from gov_mongo.legislation_raw")

    if not docs:
        print("[ENRICH-LEG] no docs — run capture_legislation first.")
        return 0

    if args.dry:
        for doc in docs[:5]:
            p = doc.get("payload") or {}
            print(f"[ENRICH-LEG]   {doc['_id']}: "
                  f"sp={p.get('sponsored_total')}  "
                  f"co={p.get('cosponsored_total')}  "
                  f"enacted={p.get('enacted_in_sponsored')}")
        if len(docs) > 5:
            print(f"[ENRICH-LEG]   ... and {len(docs) - 5} more")
        return 0

    updated_at = _now_iso()
    matched = 0
    not_matched = 0
    errors = 0

    with postgres_conn() as conn, conn.cursor() as cur:
        for doc in docs:
            bioguide = doc["_id"]
            payload = doc.get("payload") or {}
            try:
                cur.execute(UPDATE_SQL, {
                    "sponsored":   payload.get("sponsored_total", 0),
                    "cosponsored": payload.get("cosponsored_total", 0),
                    "enacted":     payload.get("enacted_in_sponsored", 0),
                    "updated_at":  updated_at,
                    "bioguide":    bioguide,
                })
                if cur.rowcount > 0:
                    matched += cur.rowcount
                else:
                    not_matched += 1
            except Exception as exc:
                errors += 1
                print(f"[ENRICH-LEG]   ! {bioguide} -> {type(exc).__name__}: {exc}")
                conn.rollback()
        conn.commit()

    finished_at = _now_iso()
    print(f"[ENRICH-LEG] done  matched={matched}  not_matched={not_matched}  errors={errors}")
    print(f"[ENRICH-LEG] finished_at={finished_at}  run_id={run_id}")

    try:
        db.ingestion_log.insert_one({
            "run_id":      run_id,
            "kind":        "enrich_legislation",
            "source":      SOURCE_NAME,
            "started_at":  started_at,
            "finished_at": finished_at,
            "stats": {
                "docs_read":   len(docs),
                "matched":     matched,
                "not_matched": not_matched,
                "errors":      errors,
            },
        })
    except Exception as exc:
        print(f"[ENRICH-LEG]   ! ingestion_log write failed: {exc}")

    return 0 if errors == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
