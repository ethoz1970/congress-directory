#!/usr/bin/env python3
"""
enrich_legislators.py — Tier 2: project gov_mongo.legislators_raw rows into
                         gov_postgres.politicians.

Pairs with capture_legislators.py. Reads the captured @unitedstates payload
out of Mongo and upserts into the politicians table, populating the
enrichment columns added by migration 0002.

Usage:
    python -m feeder.enrich_legislators                  # full pass
    python -m feeder.enrich_legislators --limit 10       # smoke test
    python -m feeder.enrich_legislators --dry            # diff, no writes
    python -m feeder.enrich_legislators --bioguide B001314  # single record

Field mapping (@unitedstates → politicians):
    payload.profile.id.bioguide               → external_id    (key)
    payload.profile.name.official_full        → name
    payload.profile.name.first                → first_name
    payload.profile.name.last                 → last_name
    payload.profile.bio.gender                → gender
    payload.profile.bio.birthday              → birthday (+ computed age)
    payload.profile.id.{ballotpedia, govtrack,
        wikipedia, opensecrets, facebook,
        twitter, youtube, ...}                → external_ids JSONB
    payload.profile.terms                     → terms JSONB
    most-recent term:
      .type ("rep"/"sen")                    → chamber, office
      .state                                  → state_code
      .district                               → region (string)
      .party                                  → party
      .start                                  → active_from
      .end                                    → active_to, term_ends
      .phone                                  → phone
      .address                                → address (physical office)
      .url                                    → website
      .contact_form                           → contact_form
    payload.social_media.social               → external_ids (merged)
    scope                                     → always 'federal'
"""
from __future__ import annotations

import argparse
import json as _json
import sys
import uuid
from datetime import date, datetime, timezone
from typing import Any

from .client import mongo_db, postgres_conn


SOURCE_NAME = "unitedstates-congress-legislators"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _compute_age(birthday: str | None) -> int | None:
    """birthday is 'YYYY-MM-DD' from @unitedstates."""
    if not birthday:
        return None
    try:
        bd = datetime.strptime(birthday, "%Y-%m-%d").date()
    except ValueError:
        return None
    today = date.today()
    return today.year - bd.year - ((today.month, today.day) < (bd.month, bd.day))


def _term_type_to_chamber_office(t: str | None) -> tuple[str | None, str | None]:
    """('rep' / 'sen') → (chamber, office)."""
    if t == "rep":
        return ("house", "representative")
    if t == "sen":
        return ("senate", "senator")
    return (None, None)


def _project(doc: dict) -> dict | None:
    """Map a Mongo legislators_raw doc into the politicians row shape.
    Returns None if the doc is missing required fields."""
    payload = doc.get("payload") or {}
    profile = payload.get("profile") or {}
    social  = payload.get("social_media") or {}

    ids   = profile.get("id") or {}
    name  = profile.get("name") or {}
    bio   = profile.get("bio") or {}
    terms = profile.get("terms") or []

    bioguide = ids.get("bioguide") or doc.get("_id")
    if not bioguide:
        return None
    if not terms:
        return None  # no terms → skip; can't determine chamber/state

    # Most-recent term drives the current-state columns.
    current = terms[-1]
    chamber, office = _term_type_to_chamber_office(current.get("type"))

    birthday = bio.get("birthday")

    # Compose external_ids JSONB from both the profile id block and the
    # social media handles (twitter, facebook, youtube_id, etc.).
    ext_ids: dict[str, Any] = {}
    for k, v in ids.items():
        if k != "bioguide" and v not in (None, "", []):
            ext_ids[k] = v
    social_section = social.get("social") if isinstance(social, dict) else None
    if isinstance(social_section, dict):
        for k, v in social_section.items():
            if v not in (None, "", []):
                ext_ids[f"social_{k}"] = v

    return {
        "external_id":            bioguide,
        "name":                   name.get("official_full") or f"{name.get('first', '')} {name.get('last', '')}".strip(),
        "first_name":             name.get("first"),
        "last_name":              name.get("last"),
        "gender":                 bio.get("gender"),
        "birthday":               birthday,
        "age":                    _compute_age(birthday),
        "party":                  current.get("party"),
        "scope":                  "federal",
        "state_code":             current.get("state"),
        "region":                 str(current.get("district")) if current.get("district") is not None else None,
        "chamber":                chamber,
        "office":                 office,
        "active_from":            current.get("start"),
        "active_to":              current.get("end"),
        "term_ends":              current.get("end"),
        "phone":                  current.get("phone"),
        "address":                current.get("address") or current.get("office"),
        "website":                current.get("url"),
        "contact_form":           current.get("contact_form"),
        "external_ids":           _json.dumps(ext_ids) if ext_ids else None,
        "terms":                  _json.dumps(terms),
    }


UPSERT_SQL = """
INSERT INTO politicians (
    external_id, name, first_name, last_name, gender, birthday, age,
    party, scope, state_code, region, chamber, office,
    active_from, active_to, term_ends,
    phone, address, website, contact_form,
    external_ids, terms
) VALUES (
    %(external_id)s, %(name)s, %(first_name)s, %(last_name)s, %(gender)s, %(birthday)s, %(age)s,
    %(party)s, %(scope)s, %(state_code)s, %(region)s, %(chamber)s, %(office)s,
    %(active_from)s, %(active_to)s, %(term_ends)s,
    %(phone)s, %(address)s, %(website)s, %(contact_form)s,
    %(external_ids)s::jsonb, %(terms)s::jsonb
)
ON CONFLICT (external_id) DO UPDATE SET
    name          = EXCLUDED.name,
    first_name    = EXCLUDED.first_name,
    last_name     = EXCLUDED.last_name,
    gender        = EXCLUDED.gender,
    birthday      = EXCLUDED.birthday,
    age           = EXCLUDED.age,
    party         = EXCLUDED.party,
    scope         = EXCLUDED.scope,
    state_code    = EXCLUDED.state_code,
    region        = EXCLUDED.region,
    chamber       = EXCLUDED.chamber,
    office        = EXCLUDED.office,
    active_from   = EXCLUDED.active_from,
    active_to     = EXCLUDED.active_to,
    term_ends     = EXCLUDED.term_ends,
    phone         = EXCLUDED.phone,
    address       = EXCLUDED.address,
    website       = EXCLUDED.website,
    contact_form  = EXCLUDED.contact_form,
    external_ids  = EXCLUDED.external_ids,
    terms         = EXCLUDED.terms
"""


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Enrich politicians from gov_mongo.legislators_raw."
    )
    parser.add_argument("--limit", type=int, default=None,
                        help="Only process the first N Mongo docs (smoke test).")
    parser.add_argument("--dry", action="store_true",
                        help="Project + count; skip Postgres writes.")
    parser.add_argument("--bioguide", default=None,
                        help="Process a single record by bioguide_id.")
    args = parser.parse_args()

    run_id = str(uuid.uuid4())
    started_at = _now_iso()
    print(f"[ENRICH-LEGIS] run_id={run_id}  started_at={started_at}  dry={args.dry}")

    db = mongo_db()
    cursor = db.legislators_raw.find(
        {"_id": args.bioguide} if args.bioguide else {}
    )
    if args.limit:
        cursor = cursor.limit(args.limit)
    docs = list(cursor)
    print(f"[ENRICH-LEGIS] read {len(docs)} doc(s) from gov_mongo.legislators_raw")

    if not docs:
        print("[ENRICH-LEGIS] no docs to process — exit.")
        return 0

    projected = []
    skipped_no_terms = 0
    for doc in docs:
        row = _project(doc)
        if row is None:
            skipped_no_terms += 1
            continue
        projected.append(row)

    print(f"[ENRICH-LEGIS] projected {len(projected)} row(s), "
          f"skipped_no_terms={skipped_no_terms}")

    if args.dry:
        # Show a sample row so the operator can eyeball it.
        if projected:
            sample = projected[0]
            print(f"[ENRICH-LEGIS]   sample: {sample['external_id']}  "
                  f"{sample['name']!r}  {sample['party']}-{sample['state_code']}"
                  f"  {sample['chamber']}")
        return 0

    # ── Upsert into Postgres ─────────────────────────────────────────────
    upserted = 0
    errors = 0
    with postgres_conn() as conn, conn.cursor() as cur:
        for row in projected:
            try:
                cur.execute(UPSERT_SQL, row)
                upserted += 1
            except Exception as exc:
                errors += 1
                print(f"[ENRICH-LEGIS]   ! {row['external_id']} -> "
                      f"{type(exc).__name__}: {exc}")
                conn.rollback()
        conn.commit()

    finished_at = _now_iso()
    print(f"[ENRICH-LEGIS] done  upserted={upserted}  errors={errors}")
    print(f"[ENRICH-LEGIS] finished_at={finished_at}  run_id={run_id}")

    # ── Log run to gov_mongo.ingestion_log ───────────────────────────────
    try:
        db.ingestion_log.insert_one({
            "run_id":      run_id,
            "kind":        "enrich_legislators",
            "source":      SOURCE_NAME,
            "started_at":  started_at,
            "finished_at": finished_at,
            "stats": {
                "read":             len(docs),
                "projected":        len(projected),
                "upserted":         upserted,
                "skipped_no_terms": skipped_no_terms,
                "errors":           errors,
            },
        })
    except Exception as exc:
        print(f"[ENRICH-LEGIS]   ! ingestion_log write failed: {exc}")

    return 0 if errors == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
