"""Composite influence score — a weighted sum of the available component
sub-scores.

Transparency + honesty: missing components (None) drop out and the
remaining weights renormalize, so the composite is always expressed over
what we can actually measure today (3 of 5 components in the first pass —
vote pivotality and full media salience join once their data is ingested),
never silently treating a missing component as a zero.
"""
from __future__ import annotations

from .config import COMPONENT_WEIGHTS


def composite(subscores: dict, weights: dict | None = None) -> float:
    """subscores: {component: 0-100 or None}. Returns the 0-100 composite,
    renormalized over the components that are present."""
    w = weights or COMPONENT_WEIGHTS
    present = {c: s for c, s in subscores.items() if s is not None}
    if not present:
        return 0.0
    wsum = sum(w.get(c, 0.0) for c in present)
    if wsum <= 0:
        # No configured weight for the present components — fall back to a
        # plain average so we still return a sensible number.
        return round(sum(present.values()) / len(present), 1)
    return round(
        sum(w.get(c, 0.0) * s for c, s in present.items()) / wsum, 1
    )
