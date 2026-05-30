"""Committee Power component.

A member's institutional power from committee seats: leadership role
(chair > ranking > vice-chair > rank-and-file) × committee prestige (a
gavel on Appropriations or Ways & Means dwarfs a minor panel) × a discount
for subcommittee (vs full-committee) seats. Summed across all seats, then
normalized 0–100.

Inputs: `committee_memberships` (title, rank, is_subcommittee) joined to
`committees` (external_id = thomas_id). The prestige map is a tunable
default — overridable from the scoring config.
"""
from __future__ import annotations

from .normalize import minmax_0_100

# Leadership role → multiplier. NULL/unknown title = rank-and-file member.
DEFAULT_ROLE_MULTIPLIER = {
    "chair": 1.0,
    "ranking": 0.8,
    "vice_chair": 0.55,
    "member": 0.30,
}
DEFAULT_MEMBER_MULTIPLIER = 0.30
DEFAULT_SUBCOMMITTEE_FACTOR = 0.4  # subcommittee seats count for less
DEFAULT_PRESTIGE = 0.55  # fallback for committees not in the map below

# Committee prestige by thomas_id (external_id). Top-tier "power
# committees" ≈ 1.0; the rest fall back to DEFAULT_PRESTIGE. Tunable — a
# defensible starting point, not gospel.
DEFAULT_COMMITTEE_PRESTIGE = {
    # House
    "HSAP": 1.00,  # Appropriations
    "HSWM": 1.00,  # Ways and Means
    "HSRU": 0.95,  # Rules
    "HSIF": 0.90,  # Energy and Commerce
    "HSAS": 0.85,  # Armed Services
    "HSBA": 0.80,  # Financial Services
    "HSJU": 0.80,  # Judiciary
    "HLIG": 0.80,  # Intelligence (Permanent Select)
    "HSBU": 0.75,  # Budget
    "HSFA": 0.75,  # Foreign Affairs
    # Senate
    "SSAP": 1.00,  # Appropriations
    "SSFI": 1.00,  # Finance
    "SSAS": 0.90,  # Armed Services
    "SSFR": 0.85,  # Foreign Relations
    "SSJU": 0.85,  # Judiciary
    "SLIN": 0.80,  # Intelligence (Select)
    "SSBK": 0.80,  # Banking
    "SSBU": 0.75,  # Budget
    "SSCM": 0.70,  # Commerce
    "SSHR": 0.70,  # HELP
}


def _role_multiplier(title, role_mult: dict, member_mult: float) -> float:
    if not title:
        return member_mult
    return role_mult.get(title.lower(), member_mult)


def compute(
    memberships_by_member: dict,
    *,
    committee_prestige: dict | None = None,
    role_multiplier: dict | None = None,
    member_multiplier: float = DEFAULT_MEMBER_MULTIPLIER,
    subcommittee_factor: float = DEFAULT_SUBCOMMITTEE_FACTOR,
    default_prestige: float = DEFAULT_PRESTIGE,
) -> dict:
    """memberships_by_member: {politician_id: [seat, ...]} where each seat
    is {title, rank, is_subcommittee, committee_external_id}.
    Returns {politician_id: {score 0-100, raw, evidence}}.
    """
    prestige = committee_prestige or DEFAULT_COMMITTEE_PRESTIGE
    roles = role_multiplier or DEFAULT_ROLE_MULTIPLIER

    raw: dict = {}
    evidence: dict = {}
    for pid, seats in memberships_by_member.items():
        total = 0.0
        chairs = 0
        top = None  # (committee_external_id, points)
        for s in seats:
            rm = _role_multiplier(s.get("title"), roles, member_multiplier)
            cp = prestige.get(s.get("committee_external_id"), default_prestige)
            sf = subcommittee_factor if s.get("is_subcommittee") else 1.0
            pts = rm * cp * sf
            total += pts
            if (s.get("title") or "").lower() == "chair":
                chairs += 1
            if top is None or pts > top[1]:
                top = (s.get("committee_external_id"), pts)
        raw[pid] = total
        evidence[pid] = {
            "seats": len(seats),
            "chairs": chairs,
            "top_committee": top[0] if top else None,
            "raw": round(total, 3),
        }

    scores = minmax_0_100(raw)
    return {
        pid: {"score": scores[pid], "raw": raw[pid], "evidence": evidence[pid]}
        for pid in raw
    }
