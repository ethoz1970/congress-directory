-- 0005_dashboard_reader_grant.sql
-- Repair the tunnel API's read-only DB-browser role.
--
-- The `/db/tables/{name}/rows` endpoint connects as `oracle_dashboard_reader`
-- and is currently failing auth ("password authentication failed for user
-- oracle_dashboard_reader"). This (re)creates that role as a read-only
-- login and grants SELECT — which lets KnowGov read `influence_scores`
-- (and any table) through the EXISTING endpoint, with no new API route.
--
-- IMPORTANT: the password here MUST match the reader DSN the tunnel API
-- uses (in the API service's env). Set both to the same secret — do not
-- ship the placeholder.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oracle_dashboard_reader') THEN
    CREATE ROLE oracle_dashboard_reader LOGIN PASSWORD 'CHANGE_ME_MATCH_API_ENV';
  ELSE
    ALTER ROLE oracle_dashboard_reader LOGIN PASSWORD 'CHANGE_ME_MATCH_API_ENV';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE whoisourgov TO oracle_dashboard_reader;
GRANT USAGE  ON SCHEMA public          TO oracle_dashboard_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO oracle_dashboard_reader;

-- Auto-grant SELECT on future tables (so new migrations stay readable).
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO oracle_dashboard_reader;

-- Verify:
--   docker exec -i gov_postgres psql -U blacksky -d whoisourgov \
--     -c "SET ROLE oracle_dashboard_reader; SELECT count(*) FROM influence_scores;"
