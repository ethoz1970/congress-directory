#!/usr/bin/env python3
"""
compute_influence.py — Tier 2: compute the multi-component congressional
influence score and write it to gov_postgres.influence_scores.

Reads (gov_postgres):
  politicians            — the federal congressional roster
  bills (sponsor_id)     — Legislative Effectiveness (stage-weighted)
  bill_cosponsors        — Network Centrality (cosponsorship graph)
  committee_memberships  — Committee Power (role × prestige), joined to
                           committees (external_id = thomas_id)

Writes (gov_postgres):
  influence_scores       — one row per (politician, version): composite +
                           each sub-score + the weights + evidence JSONB.

Vote Pivotality and full Media Salience stay NULL until their data is
ingested; the composite renormalizes over the components present, so it
never treats a missing component as a zero.

Usage:
    python -m feeder.compute_influence
    python -m feeder.compute_influence --dry
    python -m feeder.compute_influence --version v3.1
"""
from __future__ import annotations

import argparse
import sys
import uuid
from datetime import datetime, timezone

from psycopg.rows import dict_row
from psycopg.types.json import Json

from .client import postgres_conn
from .influence import centrality as centrality_mod
from .influence import committee as committee_mod
from .influence import effectiveness as effectiveness_mod
from .influence.composite import composite as composite_score
from .influence.config import COMPONENT_WEIGHTS, VERSION


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


ROSTER_SQL = """
SELECT id, external_id, name
  FROM politicians
 WHERE scope = 'federal'
   AND office IN ('senator', 'representative')
"""

BILLS_SQL = """
SELECT sponsor_id, status, bill_number, title
  FROM bills
 WHERE sponsor_id IS NOT NULL AND scope = 'federal'
"""

COSPONSORS_SQL = """
SELECT bill_id, politician_id FROM bill_cosponsors
 WHERE politician_id IS NOT NULL
"""

# The sponsor also participates in their bill's cosponsorship clique.
BILL_SPONSORS_SQL = """
SELECT id AS bill_id, sponsor_id AS politician_id
  FROM bills
 WHERE sponsor_id IS NOT NULL AND scope = 'federal'
"""

COMMITTEES_SQL = """
SELECT cm.politician_id, cm.title, cm.rank, cm.is_subcommittee,
       c.external_id AS committee_external_id
  FROM committee_memberships cm
  JOIN committees c ON c.id = cm.committee_id
 WHERE cm.politician_id IS NOT NULL
"""

UPSERT_SQL = """
INSERT INTO influence_scores
    (politician_id, external_id, version, composite,
     legislative_effectiveness, network_centrality, committee_power,
     vote_pivotality, media_salience, weights, evidence, computed_at)
VALUES
    (%(pid)s, %(external_id)s, %(version)s, %(composite)s,
     %(eff)s, %(cent)s, %(comm)s,
     NULL, NULL, %(weights)s, %(evidence)s, now())
ON CONFLICT (politician_id, version) DO UPDATE SET
     external_id               = EXCLUDED.external_id,
     composite                 = EXCLUDED.composite,
     legislative_effectiveness = EXCLUDED.legislative_effectiveness,
     network_centrality        = EXCLUDED.network_centrality,
     committee_power           = EXCLUDED.committee_power,
     weights                   = EXCLUDED.weights,
     evidence                  = EXCLUDED.evidence,
     computed_at               = now()
"""


def _load(conn):
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(ROSTER_SQL)
        roster = cur.fetchall()
        cur.execute(BILLS_SQL)
        bills = cur.fetchall()
        cur.execute(COSPONSORS_SQL)
        cosp = cur.fetchall()
        cur.execute(BILL_SPONSORS_SQL)
        bsp = cur.fetchall()
        cur.execute(COMMITTEES_SQL)
        comm = cur.fetchall()
    return roster, bills, cosp, bsp, comm


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Compute multi-component influence scores into influence_scores."
    )
    parser.add_argument("--version", default=VERSION,
                        help="Score version tag (default from influence config).")
    parser.add_argument("--dry", action="store_true",
                        help="Compute + print top scores; skip the Postgres write.")
    args = parser.parse_args()

    run_id = str(uuid.uuid4())
    print(f"[INFLUENCE] run_id={run_id} version={args.version} dry={args.dry} "
          f"started={_now_iso()}")

    with postgres_conn() as conn:
        roster, bills, cosp, bsp, comm = _load(conn)
        print(f"[INFLUENCE] loaded roster={len(roster)} bills={len(bills)} "
              f"cosponsor_links={len(cosp)} committee_seats={len(comm)}")

        # ── Assemble component inputs, keyed by politician uuid (as str) ──
        bills_by_member: dict = {}
        for b in bills:
            bills_by_member.setdefault(str(b["sponsor_id"]), []).append(b)

        bill_members: dict = {}
        for row in bsp + cosp:
            bill_members.setdefault(str(row["bill_id"]), []).append(str(row["politician_id"]))

        memberships_by_member: dict = {}
        for s in comm:
            memberships_by_member.setdefault(str(s["politician_id"]), []).append(s)

        # ── Run each component independently ──
        eff = effectiveness_mod.compute(bills_by_member)
        cent = centrality_mod.compute(bill_members, betweenness_k=200)
        comp = committee_mod.compute(memberships_by_member)
        print(f"[INFLUENCE] scored effectiveness={len(eff)} centrality={len(cent)} "
              f"committee={len(comp)}")

        # ── Composite per roster member, build upsert rows ──
        rows = []
        for m in roster:
            pid = str(m["id"])
            e, c, k = eff.get(pid), cent.get(pid), comp.get(pid)
            subs = {
                "legislative_effectiveness": e["score"] if e else 0.0,
                "network_centrality": c["score"] if c else 0.0,
                "committee_power": k["score"] if k else 0.0,
                "vote_pivotality": None,   # votes table empty — see README
                "media_salience": None,    # corpus not wired in this pass
            }
            evidence = {
                "legislative_effectiveness": e["evidence"] if e else None,
                "network_centrality": c["evidence"] if c else None,
                "committee_power": k["evidence"] if k else None,
            }
            rows.append({
                "pid": m["id"],
                "external_id": m["external_id"],
                "version": args.version,
                "composite": composite_score(subs),
                "eff": subs["legislative_effectiveness"],
                "cent": subs["network_centrality"],
                "comm": subs["committee_power"],
                "weights": Json(COMPONENT_WEIGHTS),
                "evidence": Json(evidence),
            })

        names = {str(m["id"]): m["name"] for m in roster}
        top = sorted(rows, key=lambda r: r["composite"], reverse=True)[:8]
        print("[INFLUENCE] top: " + " | ".join(
            f"{names[str(r['pid'])]} {r['composite']}" for r in top))

        if args.dry:
            print(f"[INFLUENCE] dry run — {len(rows)} rows computed, nothing written")
            return 0

        with conn.cursor() as cur:
            cur.executemany(UPSERT_SQL, rows)
        conn.commit()
        print(f"[INFLUENCE] wrote {len(rows)} rows to influence_scores "
              f"(version={args.version})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
