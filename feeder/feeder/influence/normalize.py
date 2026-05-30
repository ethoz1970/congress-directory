"""Shared normalization helpers — turn raw per-member signals into a
0–100 sub-score across the roster.

min-max ("X% of the way from the least to the most") is the default
because it's the easiest to explain, which matters when the score is the
product. `percentile` is offered for signals with heavy outliers (one
member with 10× everyone else) where min-max would crush the middle.
"""
from __future__ import annotations


def minmax_0_100(values: dict) -> dict:
    """Map raw values → 0–100 by min-max across the roster. If every value
    is equal (or the input is empty) there's no signal to differentiate,
    so everyone scores 0."""
    if not values:
        return {}
    lo = min(values.values())
    hi = max(values.values())
    span = hi - lo
    if span <= 0:
        return {k: 0.0 for k in values}
    return {k: round((v - lo) / span * 100.0, 1) for k, v in values.items()}


def percentile_0_100(values: dict) -> dict:
    """Map raw values → 0–100 by percentile rank (ties share the lower
    rank). Robust to outliers. Empty input → empty."""
    if not values:
        return {}
    n = len(values)
    ordered = sorted(values.items(), key=lambda kv: kv[1])
    out: dict = {}
    i = 0
    while i < n:
        j = i
        while j + 1 < n and ordered[j + 1][1] == ordered[i][1]:
            j += 1
        # All items i..j tie; assign the percentile of the highest tied rank.
        pct = round((j + 1) / n * 100.0, 1)
        for k in range(i, j + 1):
            out[ordered[k][0]] = pct
        i = j + 1
    return out
