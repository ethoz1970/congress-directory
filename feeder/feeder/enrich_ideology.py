#!/usr/bin/env python3
"""
enrich_ideology.py — Tier 2: project gov_mongo.ideology_raw rows into
                      gov_postgres.politicians.{ideology_score,
                      leadership_score, ideology_source, ideology_updated_at}.

Pairs with capture_ideology.py. Matches politicians by govtrack id stored
in the politicians.external_ids JSONB column.

Usage:
    python -m feeder.enrich_ideology
    python -m feeder.enrich_ideology --congress 118
    python -m feeder.enrich_ideology --dry

Lookup strategy:
    The CSV's `id` column is the GovTrack ID (integer). Politicians have
    external_ids->'govtrack' set by enrich_legislators (from the
    @unitedstates id.govtrack field, also an integer). We match by
    casting both sides to text:
        WHERE external_ids->>'govtrack' = $govtrack_id::text

    Politicians whose external_ids is NULL or lacks 'govtrack' (because
    enrich_legislators hasn't run on them yet) are silently skipped.
"""
from __future__ import annotations

import argparse
import sys
import uuid
from datetime import datetime, timezone

from .client import mongo_db, postgres_conn


SOURCE_NAME = "govtrack-sponsorshipanalysis"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


UPSERT_SQL = """
UPDATE politicians
   SET ideology_score      = %(ideology)s,
       leadership_score    = %(leadership)s,
       ideology_source     = %(source)s,
       ideology_updated_at = %(updated_at)s
 WHERE external_ids->>'govtrack' = %(govtrack_id)s
"""


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Enrich politicians ideology + leadership scores from gov_mongo.ideology_raw."
    )
    parser.add_argument("--congress", type=int, default=None,
                        help="Only enrich a specific congress (default: all in Mongo).")
    parser.add_argument("--dry", action="store_true",
                        help="Read + count; skip Postgres writes.")
    args = parser.parse_args()

    run_id = str(uuid.uuid4())
    started_at = _now_iso()
    print(f"[ENRICH-IDEO] run_id={run_id}  started_at={started_at}  dry={args.dry}")

    db = mongo_db()
    query: dict = {}
    if args.congress is not None:
        # _id is "{congress}-{chamber}"; prefix-match on congress.
        query["_id"] = {"$regex": f"^{args.congress}-"}
    docs = list(db.ideology_raw.find(query))
    print(f"[ENRICH-IDEO] read {len(docs)} doc(s) from gov_mongo.ideology_raw")

    if not docs:
        print("[ENRICH-IDEO] nothing to enrich — run capture_ideology first.")
        return 0

    matched = 0
    skipped = 0
    errors = 0

    if args.dry:
        for doc in docs:
            rows = (doc.get("payload") or {}).get("rows") or []
            print(f"[ENRICH-IDEO] [dry] {doc['_id']}: {len(rows)} GovTrack rows")
            # Estimate matches without writing.
        return 0

    updated_at = _now_iso()
    with postgres_conn() as conn, conn.cursor() as cur:
        for doc in docs:
            doc_id = doc["_id"]
            payload = doc.get("payload") or {}
            congress = payload.get("congress")
            chamber = payload.get("chamber")
            rows = payload.get("rows") or []
            source_tag = f"{SOURCE_NAME}-{congress}{chamber}"

            doc_matched = 0
            doc_skipped = 0

            for row in rows:
                govtrack_id = row.get("id")
                ideology    = row.get("ideology")
                leadership  = row.get("leadership")
                if govtrack_id is None:
                    doc_skipped += 1
                    continue
                try:
                    cur.execute(UPSERT_SQL, {
                        "ideology":    ideology,
                        "leadership":  leadership,
                        "source":      source_tag,
                        "updated_at":  updated_at,
                        "govtrack_id": str(govtrack_id),
                    })
                    if cur.rowcount > 0:
                        doc_matched += cur.rowcount
                    else:
                        doc_skipped += 1
                except Exception as exc:
                    errors += 1
                    print(f"[ENRICH-IDEO]   ! govtrack_id={govtrack_id} -> "
                          f"{type(exc).__name__}: {exc}")
                    conn.rollback()

            print(f"[ENRICH-IDEO] {doc_id}: matched={doc_matched}  "
                  f"skipped_no_match={doc_skipped}  rows={len(rows)}")
            matched += doc_matched
            skipped += doc_skipped
        conn.commit()

    finished_at = _now_iso()
    print(f"[ENRICH-IDEO] done  matched={matched}  skipped_no_match={skipped}  errors={errors}")
    print(f"[ENRICH-IDEO] finished_at={finished_at}  run_id={run_id}")

    try:
        db.ingestion_log.insert_one({
            "run_id":      run_id,
            "kind":        "enrich_ideology",
            "source":      SOURCE_NAME,
            "started_at":  started_at,
            "finished_at": finished_at,
            "stats": {
                "docs_read":  len(docs),
                "matched":    matched,
                "skipped":    skipped,
                "errors":     errors,
            },
        })
    except Exception as exc:
        print(f"[ENRICH-IDEO]   ! ingestion_log write failed: {exc}")

    return 0 if errors == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
