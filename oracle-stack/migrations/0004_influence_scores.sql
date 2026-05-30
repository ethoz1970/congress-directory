-- 0004_influence_scores.sql
-- Multi-component congressional influence scoring.
--
-- Transparency is the product: we keep each component as its own column
-- and stash the raw inputs that produced it in `evidence` (JSONB). The
-- composite is a weighted sum of the available sub-scores; the exact
-- weights used for a row live in `weights` (JSONB) so any score is fully
-- reproducible and auditable.
--
-- Versioned: one row per (politician, version). Bumping the scoring
-- algorithm or weights writes a new version rather than overwriting, so
-- changes are traceable and we can diff versions.
--
-- Components (each normalized 0–100; NULL = not yet computable):
--   legislative_effectiveness  — bills sponsored, weighted by stage + significance (CEL-style)
--   network_centrality         — cosponsorship-graph PageRank / betweenness
--   committee_power            — committee roles × committee prestige
--   vote_pivotality            — power index over close votes (NULL until votes ingested)
--   media_salience             — news mention volume / share of voice / sentiment
--
-- Pattern follows the existing migrations: uuid PK, TEXT/UUID FKs to
-- politicians(id), IF NOT EXISTS, explicit indexes.

CREATE TABLE IF NOT EXISTS influence_scores (
    id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    politician_id               UUID NOT NULL REFERENCES politicians(id),
    -- Denormalized bioguide id (politicians.external_id) so read-only
    -- consumers (KnowGov via /db/tables) can map a score → member without
    -- a join. Mirrors the bills/cosponsors denormalization pattern.
    external_id                 TEXT,
    version                     TEXT NOT NULL,          -- e.g. 'v3.0'

    composite                   NUMERIC NOT NULL,       -- 0..100 weighted composite

    -- Component sub-scores (0..100). NULL when a component can't be
    -- computed yet (e.g. vote_pivotality before roll-call ingestion).
    legislative_effectiveness   NUMERIC,
    network_centrality          NUMERIC,
    committee_power             NUMERIC,
    vote_pivotality             NUMERIC,
    media_salience              NUMERIC,

    weights                     JSONB,                  -- weights used (provenance)
    evidence                    JSONB,                  -- raw inputs per component (transparency)

    computed_at                 TIMESTAMPTZ DEFAULT now(),
    created_at                  TIMESTAMPTZ DEFAULT now(),

    CONSTRAINT influence_scores_politician_version_key
        UNIQUE (politician_id, version)
);

CREATE INDEX IF NOT EXISTS idx_influence_politician ON influence_scores (politician_id);
CREATE INDEX IF NOT EXISTS idx_influence_external   ON influence_scores (external_id);
CREATE INDEX IF NOT EXISTS idx_influence_version    ON influence_scores (version);
-- Leaderboard reads: highest composite first, within a version.
CREATE INDEX IF NOT EXISTS idx_influence_composite  ON influence_scores (version, composite DESC);

-- ── Verify after applying ──────────────────────────────────────────────
--   docker exec -i gov_postgres psql -U blacksky -d whoisourgov -c "\d influence_scores"
--   docker exec -i gov_postgres psql -U blacksky -d whoisourgov \
--     -c "SELECT version, COUNT(*) FROM influence_scores GROUP BY version;"
