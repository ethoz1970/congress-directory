#!/usr/bin/env python3
"""
capture_news.py — Tier 1: per-legislator GNews mention search into
                   gov_mongo.news_mentions_raw.

Replaces the Firestore-writing import_news_mentions.py. Same GNews API,
same 30-day rolling window, new Mongo destination. Pairs with enrich_news.py.

GNews free tier is 100 requests/day. The existing strategy is to run daily
for ~100 members at a time, cycling through all 540 over ~6 days,
prioritizing members whose news_updated_at is NULL or oldest.

Usage:
    python -m feeder.capture_news                       # default: 100 oldest-updated
    python -m feeder.capture_news --limit 5             # smoke test
    python -m feeder.capture_news --days 14             # 14-day window
    python -m feeder.capture_news --chamber house       # filter by chamber
    python -m feeder.capture_news --dry

Source:
    https://gnews.io/api/v4/search?q=%22Name%22&country=us&lang=en&from=...

Auth:
    GNEWS_API_KEY env var (in feeder/.env).

Output (Mongo `whoisourgov.news_mentions_raw`, one doc per legislator):
    {
      "_id":              "<bioguide_id>",
      "source":           "gnews-search",
      "source_url":       "<URL>",
      "captured_at":      "<ISO>",
      "ingestion_run_id": "<uuid>",
      "payload": {
        "totalArticles":  <int>,
        "query":          "<name>",
        "days_searched":  <int>,
        "articles": [
          {"title": "...", "source": "...", "url": "...", "publishedAt": "..."},
          ...
        ]
      }
    }
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone

from .client import mongo_db, postgres_conn
from .http import USER_AGENT


SOURCE_NAME = "gnews-search"
GNEWS_BASE = "https://gnews.io/api/v4/search"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


def _clean_name(name: str) -> str:
    """Strip embedded quoted nicknames so 'Earl L. "Buddy" Carter' searches
    as 'Earl L. Carter'."""
    cleaned = re.sub(r'\s*"[^"]*"\s*', ' ', name).strip()
    return re.sub(r"\s+", " ", cleaned)


def _gnews_search(name: str, api_key: str, days: int, timeout: float = 15.0) -> tuple[str, dict | None]:
    """Single GNews search. Returns (url_used, response_json_or_None)."""
    from_iso = (_now() - timedelta(days=days)).strftime("%Y-%m-%dT00:00:00Z")
    params = {
        "q":       f'"{_clean_name(name)}"',
        "lang":    "en",
        "country": "us",
        "from":    from_iso,
        "max":     10,
        "apikey":  api_key,
    }
    url = f"{GNEWS_BASE}?{urllib.parse.urlencode(params)}"
    # For logging, don't echo the api key.
    display_url = f"{GNEWS_BASE}?{urllib.parse.urlencode({k: v for k, v in params.items() if k != 'apikey'})}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return display_url, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        print(f"[CAPTURE-NEWS]   HTTP {exc.code} on {display_url}")
        return display_url, None
    except Exception as exc:
        print(f"[CAPTURE-NEWS]   {type(exc).__name__} on {display_url}: {exc}")
        return display_url, None


def _candidates(args, db) -> list[tuple[str, str]]:
    """Return list of (bioguide_id, name) to fetch, prioritized by
    oldest/null news_updated_at first."""
    chamber_filter = ""
    if args.chamber == "house":
        chamber_filter = "AND chamber = 'house'"
    elif args.chamber == "senate":
        chamber_filter = "AND chamber = 'senate'"

    with postgres_conn() as conn, conn.cursor() as cur:
        cur.execute(f"""
            SELECT external_id, name
              FROM politicians
             WHERE scope = 'federal'
               AND external_id IS NOT NULL
               AND name IS NOT NULL
               {chamber_filter}
             ORDER BY news_updated_at NULLS FIRST,
                      external_id ASC
        """)
        rows = cur.fetchall()
    if args.bioguide:
        rows = [r for r in rows if r[0] == args.bioguide]
    if args.limit:
        rows = rows[: args.limit]
    return [(r[0], r[1]) for r in rows]


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Capture GNews news-mention counts into gov_mongo."
    )
    parser.add_argument("--limit", type=int, default=100,
                        help="Max legislators per run (GNews free tier: 100/day).")
    parser.add_argument("--days", type=int, default=30,
                        help="Lookback window in days (default: 30).")
    parser.add_argument("--chamber", choices=["house", "senate", "both"], default="both",
                        help="Filter legislators by chamber (default: both).")
    parser.add_argument("--bioguide", default=None,
                        help="Fetch a single bioguide_id only.")
    parser.add_argument("--delay", type=float, default=1.0,
                        help="Seconds between GNews calls (default: 1.0).")
    parser.add_argument("--dry", action="store_true",
                        help="Estimate which legislators would be searched; no API calls.")
    args = parser.parse_args()

    api_key = os.environ.get("GNEWS_API_KEY", "")
    if not api_key:
        print("[CAPTURE-NEWS] ABORT: GNEWS_API_KEY not set in .env")
        return 1

    run_id = str(uuid.uuid4())
    started_at = _now()
    print(f"[CAPTURE-NEWS] run_id={run_id}  started_at={_iso(started_at)}  "
          f"limit={args.limit}  days={args.days}  chamber={args.chamber}  dry={args.dry}")

    db = mongo_db()
    targets = _candidates(args, db)
    print(f"[CAPTURE-NEWS] candidates: {len(targets)}")

    if args.dry:
        for bg, name in targets[:5]:
            print(f"[CAPTURE-NEWS]   would search: {bg}  {_clean_name(name)!r}")
        if len(targets) > 5:
            print(f"[CAPTURE-NEWS]   ... and {len(targets) - 5} more")
        return 0

    upserted = 0
    errors = 0
    for i, (bg, name) in enumerate(targets, start=1):
        display_url, data = _gnews_search(name, api_key, args.days)
        if data is None:
            errors += 1
            continue

        articles = []
        for a in (data.get("articles") or [])[:10]:
            articles.append({
                "title":       a.get("title", ""),
                "source":      (a.get("source") or {}).get("name", ""),
                "url":         a.get("url", ""),
                "publishedAt": a.get("publishedAt", ""),
            })

        doc = {
            "_id":              bg,
            "source":           SOURCE_NAME,
            "source_url":       display_url,
            "captured_at":      _iso(_now()),
            "ingestion_run_id": run_id,
            "payload": {
                "totalArticles": data.get("totalArticles", 0),
                "query":         name,
                "days_searched": args.days,
                "articles":      articles,
            },
        }

        try:
            db.news_mentions_raw.replace_one({"_id": bg}, doc, upsert=True)
            upserted += 1
        except Exception as exc:
            errors += 1
            print(f"[CAPTURE-NEWS]   ! upsert {bg} -> {type(exc).__name__}: {exc}")

        if i <= 5 or i % 25 == 0:
            print(f"[CAPTURE-NEWS]   [{i}/{len(targets)}] {bg}  "
                  f"{_clean_name(name)!r:30s}  totalArticles={doc['payload']['totalArticles']}")

        time.sleep(args.delay)

    finished_at = _now()
    print(f"[CAPTURE-NEWS] done  upserted={upserted}  errors={errors}")
    print(f"[CAPTURE-NEWS] finished_at={_iso(finished_at)}  run_id={run_id}")

    try:
        db.ingestion_log.insert_one({
            "run_id":      run_id,
            "kind":        "capture_news",
            "source":      SOURCE_NAME,
            "started_at":  _iso(started_at),
            "finished_at": _iso(finished_at),
            "stats": {
                "candidates": len(targets),
                "upserted":   upserted,
                "errors":     errors,
                "days":       args.days,
            },
        })
    except Exception as exc:
        print(f"[CAPTURE-NEWS]   ! ingestion_log write failed: {exc}")

    return 0 if errors == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
