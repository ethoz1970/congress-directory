#!/usr/bin/env python3
"""
capture_ideology.py — Tier 1: fetch GovTrack sponsorship analysis CSVs into
                       gov_mongo.ideology_raw.

Replaces the Firestore-writing import_ideology.py. Same GovTrack URLs, new
Mongo destination. Pairs with enrich_ideology.py.

Usage:
    python -m feeder.capture_ideology                  # current congress (118)
    python -m feeder.capture_ideology --congress 117
    python -m feeder.capture_ideology --chamber h      # house only
    python -m feeder.capture_ideology --dry

Source:
    https://www.govtrack.us/data/analysis/by-congress/{N}/sponsorshipanalysis_{h|s}.txt

    CSV columns: ID, ideology, leadership, name, party, description

Output (Mongo `whoisourgov.ideology_raw`, one doc per congress×chamber):
    {
      "_id":              "118-h",
      "source":           "govtrack-sponsorshipanalysis",
      "source_url":       "<URL>",
      "captured_at":      "<ISO>",
      "ingestion_run_id": "<uuid>",
      "payload": {
        "congress": 118,
        "chamber":  "h",
        "rows": [
          {"id": 412505, "ideology": 0.789, "leadership": 0.612,
           "name": "Rep. ...", "party": "...", "description": "..."},
          ...
        ]
      }
    }

Idempotent: re-running upserts the same doc keyed on '{congress}-{chamber}'.
"""
from __future__ import annotations

import argparse
import csv
import io
import sys
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone

from .client import mongo_db
from .http import USER_AGENT


SOURCE_NAME = "govtrack-sponsorshipanalysis"
URL_BASE = "https://www.govtrack.us/data/analysis/by-congress"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _fetch_csv(url: str) -> list[dict]:
    """Fetch a CSV file and return a list of dict rows."""
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as resp:
        text = resp.read().decode("utf-8")
    reader = csv.DictReader(io.StringIO(text))
    rows: list[dict] = []
    for raw in reader:
        # Coerce numeric columns; tolerate missing/blank.
        rows.append({
            "id":          int(raw["ID"])               if raw.get("ID") else None,
            "ideology":    float(raw["ideology"])       if raw.get("ideology") else None,
            "leadership":  float(raw["leadership"])     if raw.get("leadership") else None,
            "name":        raw.get("name"),
            "party":       raw.get("party"),
            "description": raw.get("description"),
        })
    return rows


def _fetch_chamber(congress: int, chamber: str) -> tuple[str, list[dict]]:
    url = f"{URL_BASE}/{congress}/sponsorshipanalysis_{chamber}.txt"
    print(f"[CAPTURE-IDEO] fetching {url}")
    rows = _fetch_csv(url)
    print(f"[CAPTURE-IDEO]   {len(rows)} rows")
    return url, rows


def main() -> int:
    parser = argparse.ArgumentParser(description="Capture GovTrack ideology CSVs into gov_mongo.")
    parser.add_argument("--congress", type=int, default=118,
                        help="Congress number (default: 118).")
    parser.add_argument("--chamber", choices=["h", "s", "both"], default="both",
                        help="Chamber: h (house) | s (senate) | both (default).")
    parser.add_argument("--dry", action="store_true",
                        help="Fetch + count; skip Mongo writes.")
    args = parser.parse_args()

    run_id = str(uuid.uuid4())
    started_at = _now_iso()
    captured_at = started_at
    print(f"[CAPTURE-IDEO] run_id={run_id}  started_at={started_at}  "
          f"congress={args.congress}  chamber={args.chamber}  dry={args.dry}")

    chambers = ["h", "s"] if args.chamber == "both" else [args.chamber]
    db = None if args.dry else mongo_db()

    upserted = 0
    errors = 0
    for chamber in chambers:
        try:
            url, rows = _fetch_chamber(args.congress, chamber)
        except urllib.error.HTTPError as exc:
            errors += 1
            print(f"[CAPTURE-IDEO]   ! {chamber} -> HTTP {exc.code}")
            continue
        except Exception as exc:
            errors += 1
            print(f"[CAPTURE-IDEO]   ! {chamber} -> {type(exc).__name__}: {exc}")
            continue

        doc_id = f"{args.congress}-{chamber}"
        doc = {
            "_id":              doc_id,
            "source":           SOURCE_NAME,
            "source_url":       url,
            "captured_at":      captured_at,
            "ingestion_run_id": run_id,
            "payload": {
                "congress": args.congress,
                "chamber":  chamber,
                "rows":     rows,
            },
        }

        if args.dry:
            upserted += 1
            continue

        try:
            db.ideology_raw.replace_one({"_id": doc_id}, doc, upsert=True)
            upserted += 1
        except Exception as exc:
            errors += 1
            print(f"[CAPTURE-IDEO]   ! ideology_raw[{doc_id}] -> "
                  f"{type(exc).__name__}: {exc}")

    finished_at = _now_iso()
    print(f"[CAPTURE-IDEO] done  upserted={upserted}  errors={errors}")
    print(f"[CAPTURE-IDEO] finished_at={finished_at}  run_id={run_id}")

    if not args.dry:
        try:
            db.ingestion_log.insert_one({
                "run_id":      run_id,
                "kind":        "capture_ideology",
                "source":      SOURCE_NAME,
                "started_at":  started_at,
                "finished_at": finished_at,
                "stats": {"upserted": upserted, "errors": errors,
                          "congress": args.congress, "chamber": args.chamber},
            })
        except Exception as exc:
            print(f"[CAPTURE-IDEO]   ! ingestion_log write failed: {exc}")

    return 0 if errors == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
