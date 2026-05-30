#!/usr/bin/env python3
"""
enrich_governors.py — Tier 2: project gov_mongo.governors_raw rows into
                       gov_postgres.politicians (chamber=NULL, office='governor').

Pairs with capture_governors.py. Governors share the politicians table with
federal Congress members — they're distinguished by `office='governor'`,
`chamber IS NULL`, and the synthetic `GOV-{STATE}` external_id.

Usage:
    python -m feeder.enrich_governors
    python -m feeder.enrich_governors --limit 5 --dry
    python -m feeder.enrich_governors --state AK

Field mapping (governors-current.json → politicians):
    payload.id.govtrack ("GOV-AL")             → external_id
    payload.name.official_full                  → name
    payload.name.first / last                   → first_name, last_name
    payload.bio.gender                          → gender
    payload.bio.birthday                        → birthday (+ computed age)
    payload.photo_url                           → photo_url
    payload.id_external                         → external_ids JSONB
    payload.terms                               → terms JSONB
    most-recent term:
      .state                                    → state_code
      .party                                    → party
      .start / .end                             → active_from / active_to / term_ends
      .phone / .address / .office               → phone / address
      .url                                      → website
      .contact_form                             → contact_form
    fixed:
      chamber  = NULL  (governors aren't in a legislative chamber)
      office   = 'governor'
      scope    = 'federal'  (state-level office, but federal in KnowGov's
                              scope enum which uses federal/state for the
                              geographic level — governors are top of state)
"""
from __future__ import annotations

import argparse
import json as _json
import sys
import uuid
from datetime import date, datetime, timezone
from typing import Any

from .client import mongo_db, postgres_conn


SOURCE_NAME = "wiog-governors-current"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _compute_age(birthday: str | None) -> int | None:
    if not birthday:
        return None
    try:
        bd = datetime.strptime(birthday, "%Y-%m-%d").date()
    except ValueError:
        return None
    today = date.today()
    return today.year - bd.year - ((today.month, today.day) < (bd.month, bd.day))


def _project(doc: dict) -> dict | None:
    payload = doc.get("payload") or {}
    ids     = payload.get("id") or {}
    name    = payload.get("name") or {}
    bio     = payload.get("bio") or {}
    terms   = payload.get("terms") or []
    id_ext  = payload.get("id_external") or {}

    gov_id = ids.get("govtrack") or doc.get("_id")
    if not gov_id:
        return None
    if not terms:
        return None

    current = terms[-1]
    birthday = bio.get("birthday")

    # Build external_ids JSONB. Governors don't have the rich cross-ref
    # set legislators do, but they have wikipedia / ballotpedia / twitter /
    # facebook in id_external. Mirror legislator behavior: prefix social
    # handles with social_ so they sit next to social_twitter / etc.
    ext_ids: dict[str, Any] = {}
    for k, v in id_ext.items():
        if v in (None, "", []):
            continue
        if k in ("twitter", "facebook", "youtube", "instagram"):
            ext_ids[f"social_{k}"] = v
        else:
            ext_ids[k] = v

    return {
        "external_id":   gov_id,
        "name":          name.get("official_full") or f"{name.get('first', '')} {name.get('last', '')}".strip(),
        "first_name":    name.get("first"),
        "last_name":     name.get("last"),
        "gender":        bio.get("gender"),
        "birthday":      birthday,
        "age":           _compute_age(birthday),
        "party":         current.get("party"),
        "scope":         "state",   # governors are top of state
        "state_code":    current.get("state"),
        "region":        None,       # governors have no district
        "chamber":       None,       # not in a legislative chamber
        "office":        "governor",
        "active_from":   current.get("start"),
        "active_to":     current.get("end"),
        "term_ends":     current.get("end"),
        "phone":         current.get("phone"),
        "address":       current.get("office") or current.get("address"),
        "website":       current.get("url"),
        "contact_form": current.get("contact_form"),
        "photo_url":     payload.get("photo_url"),
        "external_ids":  _json.dumps(ext_ids) if ext_ids else None,
        "terms":         _json.dumps(terms),
    }


UPSERT_SQL = """
INSERT INTO politicians (
    external_id, name, first_name, last_name, gender, birthday, age,
    party, scope, state_code, region, chamber, office,
    active_from, active_to, term_ends,
    phone, address, website, contact_form, photo_url,
    external_ids, terms
) VALUES (
    %(external_id)s, %(name)s, %(first_name)s, %(last_name)s, %(gender)s, %(birthday)s, %(age)s,
    %(party)s, %(scope)s, %(state_code)s, %(region)s, %(chamber)s, %(office)s,
    %(active_from)s, %(active_to)s, %(term_ends)s,
    %(phone)s, %(address)s, %(website)s, %(contact_form)s, %(photo_url)s,
    %(external_ids)s::jsonb, %(terms)s::jsonb
)
ON CONFLICT (external_id) DO UPDATE SET
    name         = EXCLUDED.name,
    first_name   = EXCLUDED.first_name,
    last_name    = EXCLUDED.last_name,
    gender       = EXCLUDED.gender,
    birthday     = EXCLUDED.birthday,
    age          = EXCLUDED.age,
    party        = EXCLUDED.party,
    scope        = EXCLUDED.scope,
    state_code   = EXCLUDED.state_code,
    region       = EXCLUDED.region,
    chamber      = EXCLUDED.chamber,
    office       = EXCLUDED.office,
    active_from  = EXCLUDED.active_from,
    active_to    = EXCLUDED.active_to,
    term_ends    = EXCLUDED.term_ends,
    phone        = EXCLUDED.phone,
    address      = EXCLUDED.address,
    website      = EXCLUDED.website,
    contact_form = EXCLUDED.contact_form,
    photo_url    = EXCLUDED.photo_url,
    external_ids = EXCLUDED.external_ids,
    terms        = EXCLUDED.terms
"""


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Enrich governor rows in politicians from gov_mongo.governors_raw."
    )
    parser.add_argument("--limit", type=int, default=None,
                        help="Only process the first N Mongo docs (smoke test).")
    parser.add_argument("--dry", action="store_true",
                        help="Project + count; skip Postgres writes.")
    parser.add_argument("--state", default=None,
                        help="Process only the governor for this state code, e.g. 'AK'.")
    args = parser.parse_args()

    run_id = str(uuid.uuid4())
    started_at = _now_iso()
    print(f"[ENRICH-GOV] run_id={run_id}  started_at={started_at}  dry={args.dry}")

    db = mongo_db()
    query: dict[str, Any] = {}
    if args.state:
        query["_id"] = f"GOV-{args.state.upper()}"

    cursor = db.governors_raw.find(query)
    if args.limit:
        cursor = cursor.limit(args.limit)
    docs = list(cursor)
    print(f"[ENRICH-GOV] read {len(docs)} doc(s) from gov_mongo.governors_raw")

    if not docs:
        print("[ENRICH-GOV] no docs to process — exit.")
        return 0

    projected = []
    skipped_no_terms = 0
    for doc in docs:
        row = _project(doc)
        if row is None:
            skipped_no_terms += 1
            continue
        projected.append(row)

    print(f"[ENRICH-GOV] projected {len(projected)} row(s), skipped_no_terms={skipped_no_terms}")

    if args.dry:
        if projected:
            sample = projected[0]
            print(f"[ENRICH-GOV]   sample: {sample['external_id']}  "
                  f"{sample['name']!r}  {sample['party']}-{sample['state_code']}"
                  f"  {sample['office']}")
        return 0

    upserted = 0
    errors = 0
    with postgres_conn() as conn, conn.cursor() as cur:
        for row in projected:
            try:
                cur.execute(UPSERT_SQL, row)
                upserted += 1
            except Exception as exc:
                errors += 1
                print(f"[ENRICH-GOV]   ! {row['external_id']} -> "
                      f"{type(exc).__name__}: {exc}")
                conn.rollback()
        conn.commit()

    finished_at = _now_iso()
    print(f"[ENRICH-GOV] done  upserted={upserted}  errors={errors}")
    print(f"[ENRICH-GOV] finished_at={finished_at}  run_id={run_id}")

    try:
        db.ingestion_log.insert_one({
            "run_id":      run_id,
            "kind":        "enrich_governors",
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
        print(f"[ENRICH-GOV]   ! ingestion_log write failed: {exc}")

    return 0 if errors == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
