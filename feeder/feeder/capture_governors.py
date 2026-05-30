#!/usr/bin/env python3
"""
capture_governors.py — Tier 1: load backend/governors-current.json into
                        gov_mongo.governors_raw.

Replaces the Firestore-writing import_governors.py. Same source file, same
data, new destination. Pairs with enrich_governors.py.

Usage:
    python -m feeder.capture_governors
    python -m feeder.capture_governors --limit 5 --dry
    python -m feeder.capture_governors --source-path /custom/path.json

Source:
    backend/governors-current.json — 50 sitting governors, manually curated.
    Each record has: id.govtrack (e.g. "GOV-AL"), name, bio.birthday,
    bio.gender, terms[], id_external (wikipedia/ballotpedia/twitter/facebook),
    photo_url.

Output (Mongo `whoisourgov.governors_raw`, one doc per governor):
    {
      "_id":              "GOV-AL",
      "source":           "wiog-governors-current",
      "source_url":       "file://<path>",
      "captured_at":      "<ISO timestamp>",
      "ingestion_run_id": "<uuid>",
      "payload":          { <full governor record> }
    }

Idempotent: re-running upserts in place keyed on the synthetic GOV-STATE id.
"""
from __future__ import annotations

import argparse
import json
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

from .client import mongo_db


SOURCE_NAME = "wiog-governors-current"

# Default location relative to the feeder/ root (i.e. ../backend/...).
DEFAULT_PATH = Path(__file__).resolve().parent.parent.parent / "backend" / "governors-current.json"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def main() -> int:
    parser = argparse.ArgumentParser(description="Capture state governors into gov_mongo.")
    parser.add_argument("--source-path", type=Path, default=DEFAULT_PATH,
                        help=f"Path to governors-current.json (default: {DEFAULT_PATH}).")
    parser.add_argument("--limit", type=int, default=None,
                        help="Only capture the first N governors (smoke test).")
    parser.add_argument("--dry", action="store_true",
                        help="Read + report counts; skip Mongo writes.")
    args = parser.parse_args()

    run_id = str(uuid.uuid4())
    started_at = _now_iso()
    print(f"[CAPTURE-GOV] run_id={run_id}  started_at={started_at}  dry={args.dry}")

    # ── Read the source file ────────────────────────────────────────────
    if not args.source_path.exists():
        print(f"[CAPTURE-GOV] ERROR: source file not found: {args.source_path}")
        return 1
    print(f"[CAPTURE-GOV] reading {args.source_path}")
    with open(args.source_path) as f:
        governors = json.load(f)
    if not isinstance(governors, list):
        print(f"[CAPTURE-GOV] ERROR: expected list, got {type(governors).__name__}")
        return 1
    print(f"[CAPTURE-GOV]   {len(governors)} governor records")

    if args.limit:
        governors = governors[: args.limit]
        print(f"[CAPTURE-GOV]   --limit applied: capturing {len(governors)}")

    # ── Upsert into Mongo ───────────────────────────────────────────────
    captured_at = _now_iso()
    source_url = f"file://{args.source_path.resolve()}"
    upserted = 0
    skipped_no_id = 0
    errors = 0

    db = None if args.dry else mongo_db()
    coll = None if args.dry else db.governors_raw

    for rec in governors:
        gov_id = (rec.get("id") or {}).get("govtrack")
        if not gov_id:
            skipped_no_id += 1
            continue

        doc = {
            "_id":              gov_id,
            "source":           SOURCE_NAME,
            "source_url":       source_url,
            "captured_at":      captured_at,
            "ingestion_run_id": run_id,
            "payload":          rec,
        }

        if args.dry:
            upserted += 1
            continue

        try:
            coll.replace_one({"_id": gov_id}, doc, upsert=True)
            upserted += 1
        except Exception as exc:
            errors += 1
            print(f"[CAPTURE-GOV]   ! {gov_id} -> {type(exc).__name__}: {exc}")

    finished_at = _now_iso()
    print(f"[CAPTURE-GOV] done  upserted={upserted}  skipped_no_id={skipped_no_id}"
          f"  errors={errors}")
    print(f"[CAPTURE-GOV] finished_at={finished_at}  run_id={run_id}")

    if not args.dry:
        try:
            db.ingestion_log.insert_one({
                "run_id":      run_id,
                "kind":        "capture_governors",
                "source":      SOURCE_NAME,
                "started_at":  started_at,
                "finished_at": finished_at,
                "stats": {
                    "upserted":      upserted,
                    "skipped_no_id": skipped_no_id,
                    "errors":        errors,
                },
            })
        except Exception as exc:
            print(f"[CAPTURE-GOV]   ! ingestion_log write failed: {exc}")

    return 0 if errors == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
