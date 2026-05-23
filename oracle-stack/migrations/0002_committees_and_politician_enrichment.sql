-- =============================================================================
-- 0002_committees_and_politician_enrichment.sql — bring the 6 Firestore
--                                                  enrichment fields into
--                                                  gov_postgres, add new
--                                                  committees + memberships
--                                                  tables.
-- =============================================================================
-- Applied: paste this whole file into psql against the live gov_postgres.
--   docker exec -i gov_postgres psql -U blacksky -d whoisourgov \
--     < oracle-stack/migrations/0002_committees_and_politician_enrichment.sql
--
-- Why this exists:
--   WIOG's Firestore-based legislator enrichment (ideology, news mentions,
--   legislation counts, committees) is being retired. KnowGov (the new
--   public site that replaces whoisourgov.com), Judy (the chat agent),
--   and the prism-dashboard all read from gov_postgres. This migration
--   gives them every column the 6 refactored capture/enrich script pairs
--   need to populate.
--
--   KnowGov's profile page has placeholder-only sections waiting for
--   these columns:
--     IdeologyBar    → politicians.ideology_score / leadership_score
--     Committees     → new committees + committee_memberships tables
--     StatsRow       → politicians.sponsored_count / cosponsored_count /
--                       enacted_count (denormalized for read speed,
--                       matches bills.cosponsor_count pattern)
--     ProfileHero    → politicians.photo_url
--     News section   → politicians.news_sample_headlines (uses existing
--                       media_count_30d for the count)
--
-- What this migration does:
--   1. ALTERs `politicians` to add 17 enrichment columns (bio, external
--      ids, ideology, legislation counts, news, term history).
--   2. CREATEs `committees` and `committee_memberships` matching the
--      bill_cosponsors pattern (UUID PK, nullable FKs, composite UNIQUE).
--   3. Indexes for ideology-sorted queries, committee lookups, and the
--      committee_memberships junction columns.
--
-- All statements are IF NOT EXISTS / IF EXISTS guarded; safe to re-run.
-- Tier 1 capture lands in gov_mongo first (see capture_*.py scripts);
-- enrich scripts project Mongo → these Postgres columns.
-- =============================================================================

-- ── Politicians enrichment columns ───────────────────────────────────────
-- Layout: bio block, external refs, ideology, legislation counts, news.
-- Naming matches existing conventions (media_count_30d, traction_score,
-- active_from, term_ends → snake_case, INTEGER DEFAULT 0 for counts,
-- TIMESTAMPTZ for timestamps).

ALTER TABLE politicians
  -- Bio (capture_legislators / capture_governors → enrich_legislators /
  -- enrich_governors). first_name / last_name break out from `name`
  -- so KnowGov's MemberCard component can format "Last, First" without
  -- string-splitting.
  ADD COLUMN IF NOT EXISTS first_name              TEXT,
  ADD COLUMN IF NOT EXISTS last_name               TEXT,
  ADD COLUMN IF NOT EXISTS gender                  TEXT,
  ADD COLUMN IF NOT EXISTS birthday                DATE,
  ADD COLUMN IF NOT EXISTS photo_url               TEXT,
  ADD COLUMN IF NOT EXISTS bio                     TEXT,

  -- External cross-references. JSONB so we can add new sources (twitter
  -- handle, mastodon, threads) without further migrations.
  --   { "ballotpedia": "Aaron_Bean", "govtrack": "401222",
  --     "wikipedia": "Aaron_Bean", "opensecrets": "N00041731",
  --     "facebook": "...", "youtube": "...", "twitter": "..." }
  ADD COLUMN IF NOT EXISTS external_ids            JSONB,

  -- Term history. The existing active_from / active_to / term_ends hold
  -- current term; this column preserves the full sequence for profile
  -- pages that show "served since 2013, 7th term" type detail.
  ADD COLUMN IF NOT EXISTS terms                   JSONB,

  -- Ideology (capture_ideology → enrich_ideology). Source identifies
  -- the snapshot ("govtrack-118") so we can refresh selectively.
  ADD COLUMN IF NOT EXISTS ideology_score          NUMERIC,
  ADD COLUMN IF NOT EXISTS leadership_score        NUMERIC,
  ADD COLUMN IF NOT EXISTS ideology_source         TEXT,
  ADD COLUMN IF NOT EXISTS ideology_updated_at     TIMESTAMPTZ,

  -- Legislation counts (capture_legislation → enrich_legislation).
  -- Denormalized for fast reads (matches bills.cosponsor_count pattern).
  -- Could be derived from a join over bills + bill_cosponsors, but every
  -- KnowGov profile page would pay that JOIN cost; the enrich script
  -- refreshes these columns once per cycle.
  ADD COLUMN IF NOT EXISTS sponsored_count         INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cosponsored_count       INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS enacted_count           INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS legislation_updated_at  TIMESTAMPTZ,

  -- News (capture_news → enrich_news). media_count_30d already exists
  -- and is the rolling count; news_sample_headlines is the article
  -- shortlist KnowGov's profile shows.
  --   [{ "title": "...", "url": "...", "source": "...",
  --      "publishedAt": "2026-05-21T..." }, ...]
  ADD COLUMN IF NOT EXISTS news_sample_headlines   JSONB,
  ADD COLUMN IF NOT EXISTS news_updated_at         TIMESTAMPTZ;

-- ── Politicians indexes ──────────────────────────────────────────────────
-- Index pattern matches existing idx_politicians_traction (DESC sort,
-- nulls last so unranked members fall to the bottom of the list).

CREATE INDEX IF NOT EXISTS idx_politicians_ideology
  ON politicians (ideology_score DESC NULLS LAST);

-- ── committees ───────────────────────────────────────────────────────────
-- One row per top-level committee. Subcommittees live as a JSONB array
-- on the parent row (matches the @unitedstates source shape — no need
-- to explode them into their own rows for v1).
-- Pattern follows bills / bill_cosponsors: UUID PK via uuid_generate_v4(),
-- TEXT external_id (thomas_id) with UNIQUE constraint.

CREATE TABLE IF NOT EXISTS committees (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    external_id     TEXT NOT NULL,                  -- thomas_id, e.g. 'HSAG'
    name            TEXT NOT NULL,
    type            TEXT NOT NULL,                  -- 'house' | 'senate' | 'joint'
    url             TEXT,
    rss_url         TEXT,
    minority_url    TEXT,
    jurisdiction    TEXT,
    subcommittees   JSONB,                          -- [{thomas_id, name, phone}, ...]
    source          TEXT,                           -- 'unitedstates-committees-current'
    captured_at     TIMESTAMPTZ,                    -- when source was fetched
    enriched_at     TIMESTAMPTZ DEFAULT now(),
    created_at      TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT committees_external_id_key UNIQUE (external_id)
);

CREATE INDEX IF NOT EXISTS idx_committees_type ON committees (type);

-- ── committee_memberships ────────────────────────────────────────────────
-- Junction table. Pattern mirrors bill_cosponsors EXACTLY:
--   - Surrogate UUID PK
--   - Nullable UUID FK columns to politicians + committees
--   - Composite UNIQUE on (politician_id, committee_id)
--   - Separate indexes on each FK
--   - No ON DELETE CASCADE — plain FKs
-- Plus subcommittee metadata: is_subcommittee + parent_committee_id.

CREATE TABLE IF NOT EXISTS committee_memberships (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    politician_id       UUID,                       -- nullable, matches bill_cosponsors
    committee_id        UUID,
    party               TEXT,                       -- 'majority' | 'minority'
    rank                INTEGER,
    title               TEXT,                       -- 'chair' | 'ranking' | 'vice_chair' | NULL
    is_subcommittee     BOOLEAN DEFAULT FALSE,
    parent_committee_id UUID,                       -- FK to committees(id) when is_subcommittee
    source              TEXT,
    captured_at         TIMESTAMPTZ,
    enriched_at         TIMESTAMPTZ DEFAULT now(),
    created_at          TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT committee_memberships_politician_committee_key
        UNIQUE (politician_id, committee_id),
    CONSTRAINT committee_memberships_politician_id_fkey
        FOREIGN KEY (politician_id)        REFERENCES politicians(id),
    CONSTRAINT committee_memberships_committee_id_fkey
        FOREIGN KEY (committee_id)         REFERENCES committees(id),
    CONSTRAINT committee_memberships_parent_committee_id_fkey
        FOREIGN KEY (parent_committee_id)  REFERENCES committees(id)
);

CREATE INDEX IF NOT EXISTS idx_memberships_committee  ON committee_memberships (committee_id);
CREATE INDEX IF NOT EXISTS idx_memberships_politician ON committee_memberships (politician_id);
CREATE INDEX IF NOT EXISTS idx_memberships_party      ON committee_memberships (party);

-- ── Done. ────────────────────────────────────────────────────────────────
-- Verify after applying:
--   docker exec -i gov_postgres psql -U blacksky -d whoisourgov -c "\d politicians"
--   docker exec -i gov_postgres psql -U blacksky -d whoisourgov -c "\d committees"
--   docker exec -i gov_postgres psql -U blacksky -d whoisourgov -c "\d committee_memberships"
--   docker exec -i gov_postgres psql -U blacksky -d whoisourgov -c "SELECT COUNT(*) FROM politicians;"
--     (expect 587 — no data loss)
--
-- Next steps (in order — see tasks #28-33):
--   1. Add Prism API endpoints for the new tables (/politicians/{id}/committees,
--      /committees, /committees/{id}) — task #21.
--   2. Build capture_*.py + enrich_*.py pairs for each source — tasks #28-33.
--   3. Wire prism-dashboard buttons to subprocess them — task #26.
--   4. Retire deprecated scripts (sync_politicians, bridge_supabase,
--      import_senators) — task #34.
--   5. Update KnowGov's lib/prism.ts to add the new fields to its
--      Politician TypeScript interface.
-- =============================================================================
