#!/usr/bin/env python3
"""
Diff WIOG legislators (Firestore export → local_data/legislators.json) against
Prism politicians (via the Oracle API tunnel).

Goal: confirm overlap before migrating committees + memberships + youtube_cache
into Prism. If the legislator sets already agree, we don't need to touch them.

Usage:
    cd ~/sites/PolySciFi/who-is-our-gov
    source backend/venv/bin/activate           # or wherever httpx is installed
    export ORACLE_API_KEY=$(grep ^ORACLE_API_KEY= ~/sites/nia/.env | cut -d= -f2)
    python scripts/diff_legislators_vs_prism.py

Output:
    Summary counts on both sides, set-based ID diff, sample field comparison
    on one shared record so you can eyeball whether the data matches semantically.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

try:
    import httpx
except ImportError:
    print("[ABORT] httpx not installed. Run: pip install httpx")
    sys.exit(1)


ORACLE_API_URL = os.getenv("ORACLE_API_URL", "https://oracle-api.blacksky-chat.us")
ORACLE_API_KEY = os.getenv("ORACLE_API_KEY", "")
LEGISLATORS_JSON = Path(__file__).resolve().parent.parent / "backend" / "local_data" / "legislators.json"


def load_wiog() -> list[dict]:
    if not LEGISLATORS_JSON.exists():
        print(f"[ABORT] {LEGISLATORS_JSON} not found")
        sys.exit(1)
    with open(LEGISLATORS_JSON) as f:
        return json.load(f)


def fetch_prism_federal() -> list[dict]:
    if not ORACLE_API_KEY:
        print("[ABORT] ORACLE_API_KEY not set. Pull it from ~/sites/nia/.env:")
        print("        export ORACLE_API_KEY=$(grep ^ORACLE_API_KEY= ~/sites/nia/.env | cut -d= -f2)")
        sys.exit(1)
    headers = {"X-Oracle-Key": ORACLE_API_KEY}
    rows: list[dict] = []
    offset = 0
    while True:
        r = httpx.get(
            f"{ORACLE_API_URL}/politicians",
            params={"scope": "federal", "limit": 200, "offset": offset},
            headers=headers,
            timeout=30.0,
        )
        r.raise_for_status()
        data = r.json()
        items = data if isinstance(data, list) else data.get("items", [])
        if not items:
            break
        rows.extend(items)
        total = data.get("total") if isinstance(data, dict) else None
        offset += len(items)
        if total is not None and offset >= total:
            break
    return rows


def main():
    # ── WIOG side ─────────────────────────────────────────────────
    wiog = load_wiog()
    print(f"=== WIOG legislators.json: {len(wiog)} records ===")
    by_chamber: dict[str, int] = {}
    for r in wiog:
        c = r.get("chamber") or "(none)"
        by_chamber[c] = by_chamber.get(c, 0) + 1
    for c, n in sorted(by_chamber.items()):
        print(f"  {c:10}  {n}")
    print()

    # ── Prism side ────────────────────────────────────────────────
    print("=== Prism /politicians?scope=federal via tunnel ===")
    try:
        prism_all = fetch_prism_federal()
    except Exception as e:
        print(f"  ERROR: {type(e).__name__}: {e}")
        sys.exit(1)
    print(f"  Total federal: {len(prism_all)}")
    p_by_chamber: dict[str, int] = {}
    for p in prism_all:
        c = p.get("chamber") or "(none)"
        p_by_chamber[c] = p_by_chamber.get(c, 0) + 1
    for c, n in sorted(p_by_chamber.items()):
        print(f"  {c:10}  {n}")
    print()

    # ── ID diff ───────────────────────────────────────────────────
    wiog_ids = {(r.get("bioguide_id") or r.get("id")) for r in wiog if r.get("bioguide_id") or r.get("id")}
    prism_ids = {p.get("external_id") for p in prism_all if p.get("external_id")}

    print("=== ID diff ===")
    print(f"  WIOG IDs:   {len(wiog_ids)}")
    print(f"  Prism IDs:  {len(prism_ids)}")
    print(f"  Overlap:    {len(wiog_ids & prism_ids)}")
    print(f"  WIOG-only:  {len(wiog_ids - prism_ids)}")
    print(f"  Prism-only: {len(prism_ids - wiog_ids)}")
    print()

    only_wiog = sorted(wiog_ids - prism_ids)
    only_prism = sorted(prism_ids - wiog_ids)
    if only_wiog:
        print(f"  Sample WIOG-only IDs ({min(len(only_wiog), 10)}/{len(only_wiog)}):")
        for x in only_wiog[:10]:
            rec = next((r for r in wiog if (r.get("bioguide_id") or r.get("id")) == x), None)
            if rec:
                print(f"    {x:14}  chamber={rec.get('chamber'):10}  name={rec.get('full_name')!r}")
            else:
                print(f"    {x}")
    if only_prism:
        print(f"  Sample Prism-only IDs ({min(len(only_prism), 10)}/{len(only_prism)}):")
        for x in only_prism[:10]:
            rec = next((r for r in prism_all if r.get("external_id") == x), None)
            if rec:
                print(f"    {x:14}  chamber={(rec.get('chamber') or '')[:10]:10}  name={rec.get('name')!r}")
            else:
                print(f"    {x}")
    print()

    # ── Field comparison on one shared record ─────────────────────
    common = wiog_ids & prism_ids
    if common:
        sample_id = sorted(common)[len(common) // 2]
        wiog_rec = next(r for r in wiog if (r.get("bioguide_id") or r.get("id")) == sample_id)
        prism_rec = next(p for p in prism_all if p.get("external_id") == sample_id)
        print(f"=== Field comparison: shared record {sample_id} ===")
        print(f"  WIOG  name={wiog_rec.get('full_name')!r:30}  party={wiog_rec.get('party'):12}  state={wiog_rec.get('state')!r:6}  chamber={wiog_rec.get('chamber')}")
        print(f"  Prism name={prism_rec.get('name')!r:30}  party={prism_rec.get('party'):12}  state={prism_rec.get('state_code')!r:6}  chamber={prism_rec.get('chamber')}")
        print()

    # ── Verdict ───────────────────────────────────────────────────
    if not (wiog_ids - prism_ids) and not (prism_ids - wiog_ids):
        print("VERDICT: ✅ ID sets fully agree. Politicians migration is a no-op.")
    elif len(wiog_ids & prism_ids) / max(len(wiog_ids), len(prism_ids)) > 0.95:
        print("VERDICT: 🟡 Mostly agree. Small drift — investigate the gaps before migrating.")
    else:
        print("VERDICT: 🔴 Significant divergence. The sets are tracking different snapshots.")


if __name__ == "__main__":
    main()
