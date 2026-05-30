# Congressional Influence Score

A transparent, multi-component measure of a member of Congress's influence.
**We never collapse it into one opaque number** — every component is its
own explainable sub-score (0–100) with the raw inputs that produced it
stored alongside, and the composite is a *configurable, versioned*
weighted sum of the components we can actually measure today.

This README doubles as the public "how we calculate influence" explainer.

## Where it lives

- Components: `feeder/feeder/influence/` (one module per component).
- Pipeline: `feeder/feeder/compute_influence.py` — reads `gov_postgres`,
  runs the components, writes `influence_scores`.
- Table: `oracle-stack/migrations/0004_influence_scores.sql` — one row per
  `(politician, version)` with `composite`, every sub-score, the `weights`
  used, and an `evidence` JSONB of the raw inputs.
- Run it: the **`compute_influence`** job in the prism-dashboard, or
  `python -m feeder.compute_influence [--dry] [--version vX.Y]`.

## Components

Each module outputs `{politician_id: {score: 0–100, raw, evidence}}`. Raw
per-member signals are normalized across the roster (`normalize.py`,
min-max by default) so a sub-score is always "where this member sits
relative to the rest of Congress."

### 1. Legislative Effectiveness (`effectiveness.py`)
How far a member's **sponsored bills** actually advance, after the
Center for Effective Lawmaking approach. Each bill earns points by stage —
introduced (1) < in committee (3) < beyond committee (7) < passed a
chamber (12) < enacted (25) — times a **significance** factor that steeply
discounts commemorative resolutions (naming a National X Week,
congratulating a team) to 0.15. Summed per member, then normalized.
Inputs: `bills.status`, `bill_number`, `title`, `sponsor_id`.

### 2. Network Centrality (`centrality.py`)
A member's position in the **cosponsorship graph** (networkx). Nodes =
members; an edge links members who appear together on a bill, weighted by
how many bills they share. We blend weighted **eigenvector centrality**
(sitting at the center of the cosponsorship web — the standard measure in
the cosponsorship-network literature) and **betweenness** (bridging
otherwise-separate clusters). Inputs: `bill_cosponsors` (+ each bill's
sponsor).

### 3. Committee Power (`committee.py`)
Institutional power from **committee seats**: leadership role
(chair 1.0 > ranking 0.8 > vice-chair 0.55 > member 0.30) × committee
prestige (a gavel on Appropriations or Ways & Means ≫ a minor panel;
tunable map by thomas_id) × a 0.4 discount for subcommittee seats. Summed
per member, then normalized. Inputs: `committee_memberships`
(`title`, `rank`, `is_subcommittee`) joined to `committees.external_id`.

### 4. Vote Pivotality — *not yet computable*
Planned: a Banzhaf/Shapley-Shubik power index over close votes, flagging
cross-party swing votes. **Blocked: the `votes` table is empty** (no
roll-call ingestion yet). Until then this component is `NULL` and drops
out of the composite.

### 5. Media Salience — *partial / deferred*
`media_count_30d` gives mention volume, but share-of-voice-over-time,
sentiment, co-mention networks, and topic-modeled issue ownership need the
raw gNews corpus + the Qdrant vector collection, which aren't wired into
this pass. Currently `NULL`.

## Composite (`composite.py` + `config.py`)

`composite = Σ(weightᵢ · scoreᵢ) / Σ(weightᵢ)` over the components that are
**present** for a member. Default weights (`config.py`, tunable):

| Component | Weight |
|---|---|
| Legislative Effectiveness | 0.30 |
| Network Centrality | 0.25 |
| Committee Power | 0.25 |
| Vote Pivotality | 0.10 *(null today)* |
| Media Salience | 0.10 *(null today)* |

Missing components don't count as zero — the remaining weights
**renormalize**, so today's composite is honestly expressed over the three
components we can measure (effectiveness, centrality, committee). When
votes/media land, they slot in with no math changes.

`VERSION` (e.g. `v3.0`) tags every row; bump it when weights or methodology
change so scores stay traceable and versions are diffable.

## Reading the scores (KnowGov)

`influence_scores` is a separate table. Two ways to expose it through the
Prism tunnel for KnowGov:
- **Dedicated endpoint** (preferred): `GET /politicians/{external_id}/influence`
  and a `GET /influence?version=&limit=&sort=composite` leaderboard,
  returning `composite`, each sub-score, and `evidence`. Needs the tunnel
  API repo.
- **Interim, no new API code**: the existing `/db/tables/influence_scores/rows`
  endpoint already exists — it just needs the `oracle_dashboard_reader`
  role granted `SELECT` (see `0005_dashboard_reader_grant.sql`).

## Tests

`feeder/feeder/influence/tests/` — fixture-based unit tests per component
(+ composite renormalization). Run with `pytest` or directly; they need no
database (pure functions over fixtures).

## Honesty constraints

- We don't invent fields. Components blocked by missing data report as
  gaps (`NULL`), never a fabricated workaround.
- No paid data sources in this pass — everything is derived from data
  Prism already holds.
