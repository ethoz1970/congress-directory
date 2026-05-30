#!/usr/bin/env python3
"""
enrich_news.py — Tier 2: project gov_mongo.news_mentions_raw into
                  politicians.{media_count_30d, news_sample_headlines,
                  news_updated_at}.

Pairs with capture_news.py. Same simple shape as enrich_legislation:
match by external_id = bioguide_id, no JSONB lookup needed.

Note: writes the count to `media_count_30d` (the existing column) rather
than inventing a new news_mentions column. The 30-day window matches
the capture_news --days default.

Usage:
    python -m feeder.enrich_news
    python -m feeder.enrich_news --dry
    python -m feeder.enrich_news --bioguide T000479
"""
from __future__ import annotations

import argparse
import json as _json
import sys
import uuid
from datetime import datetime, timezone

from .client import mongo_db, postgres_conn


SOURCE_NAME = "gnews-search"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


UPDATE_SQL = """
UPDATE politicians
   SET media_count_30d        = %(count)s,
       news_sample_headlines  = %(headlines)s::jsonb,
       news_updated_at        = %(updated_at)s
 WHERE external_id = %(bioguide)s
"""


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Enrich politicians news fields from gov_mongo.news_mentions_raw."
    )
    parser.add_argument("--bioguide", default=None,
                        help="Enrich a single bioguide_id only.")
    parser.add_argument("--dry", action="store_true",
                        help="Read + count; skip Postgres writes.")
    args = parser.parse_args()

    run_id = str(uuid.uuid4())
    started_at = _now_iso()
    print(f"[ENRICH-NEWS] run_id={run_id}  started_at={started_at}  dry={args.dry}")

    db = mongo_db()
    query = {"_id": args.bioguide} if args.bioguide else {}
    docs = list(db.news_mentions_raw.find(query))
    print(f"[ENRICH-NEWS] read {len(docs)} doc(s) from gov_mongo.news_mentions_raw")

    if not docs:
        print("[ENRICH-NEWS] no docs — run capture_news first.")
        return 0

    if args.dry:
        for doc in docs[:5]:
            p = doc.get("payload") or {}
            print(f"[ENRICH-NEWS]   {doc['_id']}: totalArticles={p.get('totalArticles')}  "
                  f"sample_headlines={len(p.get('articles') or [])}")
        if len(docs) > 5:
            print(f"[ENRICH-NEWS]   ... and {len(docs) - 5} more")
        return 0

    updated_at = _now_iso()
    matched = 0
    not_matched = 0
    errors = 0

    with postgres_conn() as conn, conn.cursor() as cur:
        for doc in docs:
            bioguide = doc["_id"]
            payload = doc.get("payload") or {}
            count = payload.get("totalArticles") or 0
            # Store the top 5 article objects, trimmed to display essentials.
            articles = (payload.get("articles") or [])[:5]
            headlines_json = _json.dumps(articles) if articles else None

            try:
                cur.execute(UPDATE_SQL, {
                    "count":      count,
                    "headlines":  headlines_json,
                    "updated_at": updated_at,
                    "bioguide":   bioguide,
                })
                if cur.rowcount > 0:
                    matched += cur.rowcount
                else:
                    not_matched += 1
            except Exception as exc:
                errors += 1
                print(f"[ENRICH-NEWS]   ! {bioguide} -> {type(exc).__name__}: {exc}")
                conn.rollback()
        conn.commit()

    finished_at = _now_iso()
    print(f"[ENRICH-NEWS] done  matched={matched}  not_matched={not_matched}  errors={errors}")
    print(f"[ENRICH-NEWS] finished_at={finished_at}  run_id={run_id}")

    try:
        db.ingestion_log.insert_one({
            "run_id":      run_id,
            "kind":        "enrich_news",
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
        print(f"[ENRICH-NEWS]   ! ingestion_log write failed: {exc}")

    return 0 if errors == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
