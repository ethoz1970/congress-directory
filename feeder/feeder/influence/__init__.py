"""Multi-component congressional influence scoring.

Each component is an independent, testable module that turns Prism data
into a normalized 0–100 sub-score plus the raw inputs that produced it
(transparency is the product — see oracle-stack migration 0004). The
composite is a configurable weighted sum of the available sub-scores.

Components:
    effectiveness  — Legislative Effectiveness (CEL-style stage weighting)
    centrality     — Network Centrality (cosponsorship graph)
    committee      — Committee Power (roles × prestige)
    (vote pivotality + media salience land once their data is ingested)
"""
