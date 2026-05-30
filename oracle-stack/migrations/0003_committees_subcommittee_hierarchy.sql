-- =============================================================================
-- 0003_committees_subcommittee_hierarchy.sql — make subcommittees first-class
--                                              rows in `committees`.
-- =============================================================================
-- Applied: paste into psql against gov_postgres.
--   docker exec -i gov_postgres psql -U blacksky -d whoisourgov \
--     < oracle-stack/migrations/0003_committees_subcommittee_hierarchy.sql
--
-- Why this exists:
--   The @unitedstates committee-membership-current.json source records
--   subcommittee memberships using subcommittee thomas_ids like "HSAP07"
--   ("subcommittee 07 of HSAP"). For our committee_memberships.committee_id
--   UUID FK to resolve, each subcommittee needs its own row in committees,
--   not just an entry in the parent's subcommittees JSONB.
--
--   0002 created committees with subcommittees as JSONB. This adds a
--   parent_id self-FK so subcommittees can live as first-class rows
--   pointing to their parent. The subcommittees JSONB column stays as
--   a fast-read denormalization on parent rows.
--
-- What this migration does:
--   1. Adds committees.parent_id (UUID, nullable, FK to committees.id).
--   2. Adds an index on parent_id for "show me the subcommittees of X"
--      queries.
--   3. Updates the existing subcommittees JSONB to no longer be the only
--      source of truth — the enrich script will populate both.
--
-- All statements are IF NOT EXISTS / IF EXISTS guarded; safe to re-run.
-- =============================================================================

-- ── Add parent_id self-FK ────────────────────────────────────────────────

ALTER TABLE committees
  ADD COLUMN IF NOT EXISTS parent_id UUID;

-- Add the FK separately so the IF NOT EXISTS applies cleanly (Postgres
-- doesn't have IF NOT EXISTS for CONSTRAINTs in ALTER TABLE, so we guard
-- with a DO block).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'committees_parent_id_fkey'
  ) THEN
    ALTER TABLE committees
      ADD CONSTRAINT committees_parent_id_fkey
      FOREIGN KEY (parent_id) REFERENCES committees(id);
  END IF;
END$$;

-- ── Index for hierarchy lookups ──────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_committees_parent_id
  ON committees (parent_id) WHERE parent_id IS NOT NULL;

-- ── Done. ────────────────────────────────────────────────────────────────
-- Verify:
--   docker exec -i gov_postgres psql -U blacksky -d whoisourgov -c "\d committees"
--
-- Next steps:
--   capture_committees.py / enrich_committees.py — populate both top-level
--   committees AND subcommittees (as separate rows linked via parent_id).
-- =============================================================================
