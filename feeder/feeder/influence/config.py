"""Influence scoring config — weights + version.

Weights are NOT hardcoded in the math; they live here so the methodology
is tunable and auditable. Bump VERSION whenever weights or component
methodology change — influence_scores rows are keyed on
(politician_id, version), so changes are traceable and versions diffable.
"""

VERSION = "v3.0"

# Composite weight per component. Components with no data yet (vote
# pivotality and full media salience until those are ingested) contribute
# None at score time and the remaining weights renormalize — so the
# composite is always expressed over what we can actually measure.
COMPONENT_WEIGHTS = {
    "legislative_effectiveness": 0.30,
    "network_centrality": 0.25,
    "committee_power": 0.25,
    "vote_pivotality": 0.10,
    "media_salience": 0.10,
}
