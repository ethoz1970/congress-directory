#!/usr/bin/env python3
"""
enrich_committees.py — Tier 2: project committees_raw + committee_memberships_raw
                        from gov_mongo into gov_postgres.committees and
                        gov_postgres.committee_memberships.

Pairs with capture_committees.py.

Two enrichment passes in one script:
  Pass A — committees:
    For each committees_raw doc, upsert the top-level committee row, then
    upsert each nested subcommittee as its OWN row with parent_id set.
    Subcommittee external_id is parent_thomas_id + subcommittee_thomas_id
    (e.g. "HSAP" + "07" = "HSAP07"), matching the upstream membership keys.

  Pass B — committee_memberships:
    For each committee_memberships_raw doc, look up the committee UUID by
    external_id (same as the Mongo _id — "HSAG" for top-level, "HSAG01"
    for subcommittees, now both exist as rows). For each member, look up
    politician UUID by bioguide_id and upsert the membership.

Usage:
    python -m feeder.enrich_committees
    python -m feeder.enrich_committees --dry
"""
from __future__ import annotations

import argparse
import json as _json
import sys
import uuid
from datetime import datetime, timezone
from typing import Any

from .client import mongo_db, postgres_conn


SOURCE_NAME = "unitedstates-committees"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


UPSERT_COMMITTEE_SQL = """
INSERT INTO committees (
    external_id, name, type, url, rss_url, minority_url, jurisdiction,
    subcommittees, source, captured_at, parent_id
) VALUES (
    %(external_id)s, %(name)s, %(type)s, %(url)s, %(rss_url)s,
    %(minority_url)s, %(jurisdiction)s, %(subcommittees)s::jsonb,
    %(source)s, %(captured_at)s, %(parent_id)s
)
ON CONFLICT (external_id) DO UPDATE SET
    name          = EXCLUDED.name,
    type          = EXCLUDED.type,
    url           = EXCLUDED.url,
    rss_url       = EXCLUDED.rss_url,
    minority_url  = EXCLUDED.minority_url,
    jurisdiction  = EXCLUDED.jurisdiction,
    subcommittees = EXCLUDED.subcommittees,
    source        = EXCLUDED.source,
    captured_at   = EXCLUDED.captured_at,
    parent_id     = EXCLUDED.parent_id,
    enriched_at   = now()
RETURNING id
"""


UPSERT_MEMBERSHIP_SQL = """
INSERT INTO committee_memberships (
    politician_id, committee_id, party, rank, title,
    is_subcommittee, parent_committee_id, source, captured_at
) VALUES (
    %(politician_id)s, %(committee_id)s, %(party)s, %(rank)s, %(title)s,
    %(is_subcommittee)s, %(parent_committee_id)s, %(source)s, %(captured_at)s
)
ON CONFLICT (politician_id, committee_id) DO UPDATE SET
    party                = EXCLUDED.party,
    rank                 = EXCLUDED.rank,
    title                = EXCLUDED.title,
    is_subcommittee      = EXCLUDED.is_subcommittee,
    parent_committee_id  = EXCLUDED.parent_committee_id,
    source               = EXCLUDED.source,
    captured_at          = EXCLUDED.captured_at,
    enriched_at          = now()
"""


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Enrich committees + memberships from gov_mongo."
    )
    parser.add_argument("--dry", action="store_true",
                        help="Project + count; skip Postgres writes.")
    args = parser.parse_args()

    run_id = str(uuid.uuid4())
    started_at = _now_iso()
    print(f"[ENRICH-COMM] run_id={run_id}  started_at={started_at}  dry={args.dry}")

    db = mongo_db()

    # Pull all committees_raw + memberships_raw upfront — small dataset (~50
    # committees, ~200 membership keys, ~3000 member rows total).
    committees_docs = list(db.committees_raw.find({}))
    memberships_docs = list(db.committee_memberships_raw.find({}))
    print(f"[ENRICH-COMM] read  committees_raw={len(committees_docs)}  "
          f"committee_memberships_raw={len(memberships_docs)}")

    if not committees_docs and not memberships_docs:
        print("[ENRICH-COMM] nothing to enrich — exit.")
        return 0

    # ── Pass A: committees + materialized subcommittees ────────────────
    # Each top-level committee gets its own row; each nested subcommittee
    # also gets its own row, with parent_id pointing to the parent.
    upserted_top = 0
    upserted_sub = 0
    errors = 0

    if args.dry:
        for doc in committees_docs:
            payload = doc.get("payload") or {}
            thomas_id = doc["_id"]
            subs = payload.get("subcommittees") or []
            upserted_top += 1
            upserted_sub += len(subs)
        print(f"[ENRICH-COMM] [dry] would upsert  top-level={upserted_top}  "
              f"subcommittees={upserted_sub}")
    else:
        with postgres_conn() as conn, conn.cursor() as cur:
            for doc in committees_docs:
                payload = doc.get("payload") or {}
                thomas_id = doc["_id"]
                captured_at = doc.get("captured_at")
                top_type = payload.get("type")
                subs = payload.get("subcommittees") or []

                # Top-level row
                try:
                    cur.execute(UPSERT_COMMITTEE_SQL, {
                        "external_id":  thomas_id,
                        "name":         payload.get("name"),
                        "type":         top_type,
                        "url":          payload.get("url"),
                        "rss_url":      payload.get("rss_url"),
                        "minority_url": payload.get("minority_url") or payload.get("minority_rss_url"),
                        "jurisdiction": payload.get("jurisdiction"),
                        "subcommittees": _json.dumps(subs) if subs else None,
                        "source":       SOURCE_NAME,
                        "captured_at":  captured_at,
                        "parent_id":    None,
                    })
                    top_uuid = cur.fetchone()[0]
                    upserted_top += 1
                except Exception as exc:
                    errors += 1
                    print(f"[ENRICH-COMM]   ! committees[{thomas_id}] -> "
                          f"{type(exc).__name__}: {exc}")
                    conn.rollback()
                    continue

                # Subcommittee rows — external_id = parent + relative
                for sub in subs:
                    sub_relative = sub.get("thomas_id")
                    if not sub_relative:
                        continue
                    sub_external_id = f"{thomas_id}{sub_relative}"
                    try:
                        cur.execute(UPSERT_COMMITTEE_SQL, {
                            "external_id":  sub_external_id,
                            "name":         sub.get("name"),
                            "type":         top_type,           # inherits from parent
                            "url":          sub.get("url"),
                            "rss_url":      None,
                            "minority_url": None,
                            "jurisdiction": None,
                            "subcommittees": None,
                            "source":       SOURCE_NAME,
                            "captured_at":  captured_at,
                            "parent_id":    top_uuid,
                        })
                        upserted_sub += 1
                    except Exception as exc:
                        errors += 1
                        print(f"[ENRICH-COMM]   ! committees[{sub_external_id}] -> "
                              f"{type(exc).__name__}: {exc}")
                        conn.rollback()
            conn.commit()

        print(f"[ENRICH-COMM] committees upserted  top={upserted_top}  subs={upserted_sub}")

    # ── Pass B: committee_memberships ───────────────────────────────────
    # Build lookups upfront: committee external_id → UUID, politician
    # bioguide_id → UUID. Then iterate memberships.
    membership_upserted = 0
    membership_skipped_no_pol = 0
    membership_skipped_no_comm = 0

    if not args.dry:
        with postgres_conn() as conn, conn.cursor() as cur:
            cur.execute("SELECT external_id, id, parent_id FROM committees")
            committees_by_ext = {row[0]: (row[1], row[2]) for row in cur.fetchall()}

            cur.execute("SELECT external_id, id FROM politicians WHERE external_id IS NOT NULL")
            politicians_by_bg = {row[0]: row[1] for row in cur.fetchall()}

            for doc in memberships_docs:
                committee_ext = doc["_id"]
                members = doc.get("payload") or []
                captured_at = doc.get("captured_at")

                committee_lookup = committees_by_ext.get(committee_ext)
                if committee_lookup is None:
                    membership_skipped_no_comm += len(members)
                    continue
                committee_uuid, parent_uuid = committee_lookup
                is_sub = parent_uuid is not None

                for m in members:
                    bioguide = m.get("bioguide")
                    if not bioguide:
                        membership_skipped_no_pol += 1
                        continue
                    pol_uuid = politicians_by_bg.get(bioguide)
                    if pol_uuid is None:
                        membership_skipped_no_pol += 1
                        continue
                    try:
                        cur.execute(UPSERT_MEMBERSHIP_SQL, {
                            "politician_id":       pol_uuid,
                            "committee_id":        committee_uuid,
                            "party":               m.get("party"),
                            "rank":                m.get("rank"),
                            "title":               m.get("title"),
                            "is_subcommittee":     is_sub,
                            "parent_committee_id": parent_uuid,
                            "source":              SOURCE_NAME,
                            "captured_at":         captured_at,
                        })
                        membership_upserted += 1
                    except Exception as exc:
                        errors += 1
                        print(f"[ENRICH-COMM]   ! membership({bioguide},{committee_ext}) -> "
                              f"{type(exc).__name__}: {exc}")
                        conn.rollback()
            conn.commit()
    else:
        # Dry: estimate counts without writing.
        for doc in memberships_docs:
            members = doc.get("payload") or []
            membership_upserted += len([m for m in members if m.get("bioguide")])
            membership_skipped_no_pol += len([m for m in members if not m.get("bioguide")])
        print(f"[ENRICH-COMM] [dry] would upsert memberships={membership_upserted}  "
              f"skipped_no_bg={membership_skipped_no_pol}")

    finished_at = _now_iso()
    print(f"[ENRICH-COMM] committee_memberships upserted={membership_upserted}  "
          f"skipped_no_politician={membership_skipped_no_pol}  "
          f"skipped_no_committee={membership_skipped_no_comm}  errors={errors}")
    print(f"[ENRICH-COMM] finished_at={finished_at}  run_id={run_id}")

    if not args.dry:
        try:
            db.ingestion_log.insert_one({
                "run_id":      run_id,
                "kind":        "enrich_committees",
                "source":      SOURCE_NAME,
                "started_at":  started_at,
                "finished_at": finished_at,
                "stats": {
                    "committees_upserted_top":     upserted_top,
                    "committees_upserted_sub":     upserted_sub,
                    "memberships_upserted":        membership_upserted,
                    "memberships_skipped_no_pol":  membership_skipped_no_pol,
                    "memberships_skipped_no_comm": membership_skipped_no_comm,
                    "errors":                      errors,
                },
            })
        except Exception as exc:
            print(f"[ENRICH-COMM]   ! ingestion_log write failed: {exc}")

    return 0 if errors == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
