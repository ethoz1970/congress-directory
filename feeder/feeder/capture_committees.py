#!/usr/bin/env python3
"""
capture_committees.py — Tier 1: fetch @unitedstates committees + memberships
                         into gov_mongo.committees_raw and
                         gov_mongo.committee_memberships_raw.

Replaces the Firestore-writing import_committees.py. Same two source URLs,
new Mongo destination. Pairs with enrich_committees.py.

Usage:
    python -m feeder.capture_committees
    python -m feeder.capture_committees --dry

Sources:
    https://unitedstates.github.io/congress-legislators/committees-current.json
    https://unitedstates.github.io/congress-legislators/committee-membership-current.json

Output 1 (Mongo `whoisourgov.committees_raw`, one doc per top-level committee):
    {
      "_id":              "HSAG",
      "source":           "unitedstates-committees-current",
      "source_url":       "<URL>",
      "captured_at":      "<ISO>",
      "ingestion_run_id": "<uuid>",
      "payload":          { thomas_id, name, type, url, jurisdiction,
                            subcommittees: [{thomas_id, name, phone}, ...],
                            ... }
    }

Output 2 (Mongo `whoisourgov.committee_memberships_raw`, one doc per
  committee OR subcommittee — natural key matches the upstream JSON's keys):
    {
      "_id":              "HSAG"  (top-level)  or "HSAG01" (subcommittee),
      "source":           "unitedstates-committee-membership-current",
      "source_url":       "<URL>",
      "captured_at":      "<ISO>",
      "ingestion_run_id": "<uuid>",
      "payload": [
        {"name": "...", "party": "majority", "rank": 1, "title": "Chair",
         "bioguide": "T000479"},
        ...
      ]
    }

Idempotent: re-running upserts in place keyed on thomas_id.
"""
from __future__ import annotations

import argparse
import sys
import uuid
from datetime import datetime, timezone

from .client import mongo_db
from .http import fetch_json


SOURCE_COMMITTEES  = "unitedstates-committees-current"
SOURCE_MEMBERSHIPS = "unitedstates-committee-membership-current"
URL_COMMITTEES     = "https://unitedstates.github.io/congress-legislators/committees-current.json"
URL_MEMBERSHIPS    = "https://unitedstates.github.io/congress-legislators/committee-membership-current.json"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Capture committees + memberships into gov_mongo."
    )
    parser.add_argument("--dry", action="store_true",
                        help="Fetch + count; skip Mongo writes.")
    args = parser.parse_args()

    run_id = str(uuid.uuid4())
    started_at = _now_iso()
    captured_at = started_at
    print(f"[CAPTURE-COMM] run_id={run_id}  started_at={started_at}  dry={args.dry}")

    # ── Fetch committees ────────────────────────────────────────────────
    print(f"[CAPTURE-COMM] fetching {URL_COMMITTEES}")
    committees = fetch_json(URL_COMMITTEES)
    if not isinstance(committees, list):
        print(f"[CAPTURE-COMM] ERROR: expected list, got {type(committees).__name__}")
        return 1
    sub_count = sum(len(c.get("subcommittees") or []) for c in committees)
    print(f"[CAPTURE-COMM]   {len(committees)} committees, {sub_count} nested subcommittees")

    # ── Fetch memberships ───────────────────────────────────────────────
    print(f"[CAPTURE-COMM] fetching {URL_MEMBERSHIPS}")
    memberships = fetch_json(URL_MEMBERSHIPS)
    if not isinstance(memberships, dict):
        print(f"[CAPTURE-COMM] ERROR: expected dict, got {type(memberships).__name__}")
        return 1
    total_members = sum(len(v) for v in memberships.values() if isinstance(v, list))
    print(f"[CAPTURE-COMM]   {len(memberships)} committee/subcommittee keys, "
          f"{total_members} total member rows")

    # ── Upsert into Mongo ───────────────────────────────────────────────
    upserted_c = 0
    upserted_m = 0
    skipped = 0
    errors = 0

    db = None if args.dry else mongo_db()

    # Committees (top-level, with subcommittees nested in payload).
    for c in committees:
        thomas_id = c.get("thomas_id") or c.get("id")
        if not thomas_id:
            skipped += 1
            continue
        doc = {
            "_id":              thomas_id,
            "source":           SOURCE_COMMITTEES,
            "source_url":       URL_COMMITTEES,
            "captured_at":      captured_at,
            "ingestion_run_id": run_id,
            "payload":          c,
        }
        if args.dry:
            upserted_c += 1
            continue
        try:
            db.committees_raw.replace_one({"_id": thomas_id}, doc, upsert=True)
            upserted_c += 1
        except Exception as exc:
            errors += 1
            print(f"[CAPTURE-COMM]   ! committees_raw[{thomas_id}] -> "
                  f"{type(exc).__name__}: {exc}")

    # Memberships — one Mongo doc per committee/subcommittee key.
    for committee_key, members in memberships.items():
        if not isinstance(members, list):
            skipped += 1
            continue
        doc = {
            "_id":              committee_key,
            "source":           SOURCE_MEMBERSHIPS,
            "source_url":       URL_MEMBERSHIPS,
            "captured_at":      captured_at,
            "ingestion_run_id": run_id,
            "payload":          members,
        }
        if args.dry:
            upserted_m += 1
            continue
        try:
            db.committee_memberships_raw.replace_one(
                {"_id": committee_key}, doc, upsert=True,
            )
            upserted_m += 1
        except Exception as exc:
            errors += 1
            print(f"[CAPTURE-COMM]   ! committee_memberships_raw[{committee_key}] -> "
                  f"{type(exc).__name__}: {exc}")

    finished_at = _now_iso()
    print(f"[CAPTURE-COMM] done  committees_raw={upserted_c}  "
          f"committee_memberships_raw={upserted_m}  skipped={skipped}  errors={errors}")
    print(f"[CAPTURE-COMM] finished_at={finished_at}  run_id={run_id}")

    if not args.dry:
        try:
            db.ingestion_log.insert_one({
                "run_id":      run_id,
                "kind":        "capture_committees",
                "started_at":  started_at,
                "finished_at": finished_at,
                "stats": {
                    "committees_raw":             upserted_c,
                    "committee_memberships_raw":  upserted_m,
                    "skipped":                    skipped,
                    "errors":                     errors,
                },
            })
        except Exception as exc:
            print(f"[CAPTURE-COMM]   ! ingestion_log write failed: {exc}")

    return 0 if errors == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
