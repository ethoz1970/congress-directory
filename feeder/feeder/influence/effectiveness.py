"""Legislative Effectiveness component.

CEL-style: a member's sponsored bills are scored by how far they advanced
(introduced < in committee < beyond committee < passed chamber < enacted)
and by significance (substantive bills count for far more than ceremonial
ones). A member's raw effectiveness is the sum of their bills' points;
raw values are then min-max normalized across the roster to a 0–100
sub-score.

Reference: Center for Effective Lawmaking (thelawmakers.org) — progressive
five-stage weighting + commemorative/substantive significance tiers. The
weights here are defaults, overridable from the scoring config so the
methodology stays tunable + versioned.

Inputs come from Prism's `bills` (sponsor_id, status, bill_number, title).
"""
from __future__ import annotations

import re

from .normalize import minmax_0_100

# Prism bill.status → CEL-ish stage. Unknown statuses fall back to the
# lowest credit so a new/renamed status never crashes scoring.
STATUS_STAGE = {
    "introduced": "introduced",
    "committee": "in_committee",
    "floor_scheduled": "beyond_committee",
    "passed_one_chamber": "passed_chamber",
    "passed_both": "passed_chamber",
    "enrolled": "enacted",
    "signed": "enacted",
    "vetoed": "passed_chamber",  # got through a chamber, then blocked
    "dead": "introduced",
}

# Progressive stage weights — each later stage worth meaningfully more.
# Getting a bill enacted dwarfs merely introducing one.
DEFAULT_STAGE_WEIGHTS = {
    "introduced": 1.0,
    "in_committee": 3.0,
    "beyond_committee": 7.0,
    "passed_chamber": 12.0,
    "enacted": 25.0,
}

# Commemorative resolutions (naming a Day/Week, congratulating a team,
# expressing support) pass easily but signal little lawmaking power — steep
# significance discount.
DEFAULT_COMMEMORATIVE_FACTOR = 0.15

_COMMEM_PATTERNS = re.compile(
    r"(expressing\s+(support|the\s+sense)"
    r"|recognizing"
    r"|congratulating"
    r"|commemorating"
    r"|honoring"
    r"|celebrating"
    r"|supporting\s+the\s+goals\s+and\s+ideals"
    r"|designating\s+the\s+(month|week|day)"
    r"|national\s+[\w\s'-]{0,50}?\b(day|week|month)s?\b)",
    re.IGNORECASE,
)


def is_commemorative(bill: dict) -> bool:
    """Heuristic: the title reads as ceremonial (resolutions recognizing,
    congratulating, designating a National X Week, etc.)."""
    return bool(_COMMEM_PATTERNS.search(bill.get("title") or ""))


def bill_points(bill: dict, stage_weights: dict, commemorative_factor: float) -> float:
    stage = STATUS_STAGE.get((bill.get("status") or "").lower(), "introduced")
    pts = stage_weights.get(stage, stage_weights["introduced"])
    if is_commemorative(bill):
        pts *= commemorative_factor
    return pts


def compute(
    bills_by_member: dict,
    *,
    stage_weights: dict | None = None,
    commemorative_factor: float = DEFAULT_COMMEMORATIVE_FACTOR,
) -> dict:
    """Score Legislative Effectiveness for every member.

    bills_by_member: {politician_id: [bill_dict, ...]} of sponsored bills.
    Returns {politician_id: {"score": 0-100, "raw": float, "evidence": {...}}}.
    A member with an empty bill list scores the roster floor (0).
    """
    weights = stage_weights or DEFAULT_STAGE_WEIGHTS
    raw: dict = {}
    evidence: dict = {}

    for pid, bills in bills_by_member.items():
        total = 0.0
        by_stage: dict = {}
        commem = 0
        for b in bills:
            total += bill_points(b, weights, commemorative_factor)
            stage = STATUS_STAGE.get((b.get("status") or "").lower(), "introduced")
            by_stage[stage] = by_stage.get(stage, 0) + 1
            if is_commemorative(b):
                commem += 1
        raw[pid] = total
        evidence[pid] = {
            "sponsored": len(bills),
            "by_stage": by_stage,
            "commemorative": commem,
            "raw": round(total, 2),
        }

    scores = minmax_0_100(raw)
    return {
        pid: {"score": scores[pid], "raw": raw[pid], "evidence": evidence[pid]}
        for pid in raw
    }
