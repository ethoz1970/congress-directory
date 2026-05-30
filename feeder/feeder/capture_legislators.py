#!/usr/bin/env python3
"""
capture_legislators.py — Tier 1: fetch @unitedstates/congress-legislators
                          JSON into gov_mongo.legislators_raw.

Replaces the Firestore-writing import_legislators.py. Same source, same
data, new destination. Pairs with enrich_legislators.py which projects
Mongo → Postgres politicians.

Usage:
    python -m feeder.capture_legislators                  # full run
    python -m feeder.capture_legislators --limit 10       # smoke test
    python -m feeder.capture_legislators --dry            # no writes

Source:
    https://github.com/unitedstates/congress-legislators
    legislators-current.json   — bioguide/name/bio/terms (one per member)
    legislators-social-media.json — twitter/facebook/youtube (per bioguide)

Output (Mongo `whoisourgov.legislators_raw`, one doc per legislator):
    {
      "_id":              "<bioguide_id>",
      "source":           "unitedstates-congress-legislators",
      "source_url":       "<github raw URL>",
      "captured_at":      "<ISO timestamp>",
      "ingestion_run_id": "<uuid>",
      "payload": {
        "profile":      { <legislators-current.json record> },
        "social_media": { <legislators-social-media.json record>, or null }
      }
    }

Idempotent: re-running with the same source upserts in place.
"""
from __future__ import annotations

import argparse
import json
import sys
import uuid
from datetime import datetime, timezone

from .client import mongo_db
from .http import fetch_json


SOURCE_NAME = "unitedstates-congress-legislators"
# GitHub Pages hosts the current JSON dumps. Cleaner than raw.githubusercontent
# because we don't have to know the default branch name (main vs master).
# Same URLs the legacy backend/import_legislators.py uses.
URL_LEGISLATORS = "https://unitedstates.github.io/congress-legislators/legislators-current.json"
URL_SOCIAL      = "https://unitedstates.github.io/congress-legislators/legislators-social-media.json"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def main() -> int:
    parser = argparse.ArgumentParser(description="Capture federal legislators into gov_mongo.")
    parser.add_argument("--limit", type=int, default=None,
                        help="Only capture the first N legislators (smoke test).")
    parser.add_argument("--dry", action="store_true",
                        help="Fetch + report counts; skip Mongo writes.")
    args = parser.parse_args()

    run_id = str(uuid.uuid4())
    started_at = _now_iso()
    print(f"[CAPTURE-LEGIS] run_id={run_id}  started_at={started_at}  dry={args.dry}")

    # ── Fetch both source files ─────────────────────────────────────────
    print(f"[CAPTURE-LEGIS] fetching {URL_LEGISLATORS}")
    legislators = fetch_json(URL_LEGISLATORS)
    if not isinstance(legislators, list):
        print(f"[CAPTURE-LEGIS] ERROR: expected list, got {type(legislators).__name__}")
        return 1
    print(f"[CAPTURE-LEGIS]   {len(legislators)} legislator records")

    print(f"[CAPTURE-LEGIS] fetching {URL_SOCIAL}")
    social = fetch_json(URL_SOCIAL)
    if not isinstance(social, list):
        print(f"[CAPTURE-LEGIS] ERROR: expected list, got {type(social).__name__}")
        return 1
    print(f"[CAPTURE-LEGIS]   {len(social)} social-media records")

    # Build bioguide → social lookup for fast join.
    social_by_bg: dict[str, dict] = {}
    for s in social:
        bg = (s.get("id") or {}).get("bioguide")
        if bg:
            social_by_bg[bg] = s

    if args.limit:
        legislators = legislators[: args.limit]
        print(f"[CAPTURE-LEGIS]   --limit applied: capturing {len(legislators)}")

    # ── Upsert into Mongo ───────────────────────────────────────────────
    captured_at = _now_iso()
    upserted = 0
    skipped_no_bg = 0
    errors = 0

    db = None if args.dry else mongo_db()
    coll = None if args.dry else db.legislators_raw

    for rec in legislators:
        bioguide = (rec.get("id") or {}).get("bioguide")
        if not bioguide:
            skipped_no_bg += 1
            continue

        doc = {
            "_id":              bioguide,
            "source":           SOURCE_NAME,
            "source_url":       URL_LEGISLATORS,
            "captured_at":      captured_at,
            "ingestion_run_id": run_id,
            "payload": {
                "profile":      rec,
                "social_media": social_by_bg.get(bioguide),
            },
        }

        if args.dry:
            upserted += 1
            continue

        try:
            coll.replace_one({"_id": bioguide}, doc, upsert=True)
            upserted += 1
        except Exception as exc:
            errors += 1
            print(f"[CAPTURE-LEGIS]   ! {bioguide} -> {type(exc).__name__}: {exc}")

    finished_at = _now_iso()
    print(f"[CAPTURE-LEGIS] done  upserted={upserted}  skipped_no_bg={skipped_no_bg}"
          f"  errors={errors}")
    print(f"[CAPTURE-LEGIS] finished_at={finished_at}  run_id={run_id}")

    # ── Log the run to ingestion_log (if not dry) ───────────────────────
    if not args.dry:
        try:
            db.ingestion_log.insert_one({
                "run_id":           run_id,
                "kind":             "capture_legislators",
                "source":           SOURCE_NAME,
                "started_at":       started_at,
                "finished_at":      finished_at,
                "stats": {
                    "upserted":      upserted,
                    "skipped_no_bg": skipped_no_bg,
                    "errors":        errors,
                },
            })
        except Exception as exc:
            print(f"[CAPTURE-LEGIS]   ! ingestion_log write failed: {exc}")

    return 0 if errors == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
