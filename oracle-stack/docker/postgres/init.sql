-- whoisourgov — Postgres initialization
-- Run automatically on first container boot.
-- Three-tier architecture: this is Tier 2 (structured/queryable).
-- Tier 1 (Mongo) is source of truth. Tier 3 (Qdrant) for semantic search.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================
-- POLITICIANS
-- Covers federal (Congress + Governors) and state legislators.
-- scope + state_code discriminate between them.
-- ============================================================
CREATE TABLE politicians (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  external_id     text UNIQUE NOT NULL,
  name            text NOT NULL,
  party           text,
  office          text,                    -- 'senator' / 'representative' / 'governor' / 'justice'
  scope           text NOT NULL,           -- 'federal' / 'state'
  state_code      text,                    -- NULL for federal-only roles, 'MD' etc for state
  region          text,                    -- district, county, or state name
  chamber         text,                    -- 'senate' / 'house' / NULL for governors/justices
  active_from     date,
  active_to       date,
  term_ends       date,
  age             integer,
  phone           text,
  address         text,
  website         text,
  contact_form    text,
  media_count_30d integer DEFAULT 0,       -- news articles last 30 days
  traction_score  numeric DEFAULT 0,       -- computed composite
  follow_count    integer DEFAULT 0,
  like_count      integer DEFAULT 0,
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX idx_politicians_scope ON politicians (scope, state_code);
CREATE INDEX idx_politicians_office ON politicians (office);
CREATE INDEX idx_politicians_party ON politicians (party);
CREATE INDEX idx_politicians_traction ON politicians (traction_score DESC);

-- ============================================================
-- BILLS
-- Full lifecycle tracking. Federal and state coexist here.
-- scope + state_code + session discriminate between them.
-- portal_tag maps to the 12 Scrollvate civic portals.
-- plain_english is Maurice-generated per bill.
-- ============================================================
CREATE TABLE bills (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  external_id         text UNIQUE NOT NULL,
  chamber             text,                    -- 'house' / 'senate'
  bill_number         text,                    -- 'HB 1234' / 'SB 567'
  title               text NOT NULL,
  plain_english       text,                    -- Maurice-generated plain language summary
  introduced_at       timestamptz NOT NULL,
  status              text,                    -- introduced / committee / floor / passed_one /
                                               -- passed_both / signed / vetoed / dead
  last_action         text,
  last_action_at      timestamptz,
  sponsor_id          uuid REFERENCES politicians(id),
  portal_tag          text[],                  -- maps to 12 Scrollvate portals (GIN indexed)
  scope               text NOT NULL,           -- 'federal' / 'state'
  state_code          text,                    -- NULL for federal, 'MD' for Maryland etc
  session             text,                    -- '119' for federal / '2026RS' for MD etc
  cosponsor_count     integer DEFAULT 0,
  bipartisan          boolean DEFAULT false,
  racial_equity_flag  boolean DEFAULT false,   -- MGA-specific, extensible to other states
  traction_score      numeric DEFAULT 0,       -- computed composite (see traction_history)
  like_count          integer DEFAULT 0,
  follow_count        integer DEFAULT 0,
  share_count         integer DEFAULT 0,
  time_bucket         timestamptz NOT NULL,    -- 1-hour aligned for cross-dataset joins
  created_at          timestamptz DEFAULT now()
);
CREATE INDEX idx_bills_scope ON bills (scope, state_code);
CREATE INDEX idx_bills_status ON bills (status);
CREATE INDEX idx_bills_traction ON bills (traction_score DESC);
CREATE INDEX idx_bills_portal ON bills USING GIN (portal_tag);
CREATE INDEX idx_bills_time_bucket ON bills (time_bucket);
CREATE INDEX idx_bills_session ON bills (session);
CREATE INDEX idx_bills_sponsor ON bills (sponsor_id);

-- ============================================================
-- BILL COSPONSORS
-- Junction table. Bills have many cosponsors.
-- Politicians cosponsor many bills.
-- ============================================================
CREATE TABLE bill_cosponsors (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  bill_id         uuid REFERENCES bills(id),
  politician_id   uuid REFERENCES politicians(id),
  joined_at       timestamptz,
  created_at      timestamptz DEFAULT now(),
  UNIQUE(bill_id, politician_id)
);
CREATE INDEX idx_cosponsors_bill ON bill_cosponsors (bill_id);
CREATE INDEX idx_cosponsors_politician ON bill_cosponsors (politician_id);

-- ============================================================
-- VOTES
-- Every recorded vote. politician_id + bill_id + timestamp.
-- time_bucket for cross-dataset alignment with Sentiment spine.
-- ============================================================
CREATE TABLE votes (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  politician_id   uuid REFERENCES politicians(id),
  bill_id         uuid REFERENCES bills(id),
  vote            text NOT NULL,               -- 'yea' / 'nay' / 'present' / 'absent'
  timestamp       timestamptz NOT NULL,
  time_bucket     timestamptz NOT NULL,
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX idx_votes_time_bucket ON votes (time_bucket);
CREATE INDEX idx_votes_politician ON votes (politician_id);
CREATE INDEX idx_votes_bill ON votes (bill_id);

-- ============================================================
-- EVENTS
-- News and civic event context. Timestamp-aligned for joining
-- with Sentiment vs. Power spine.json data.
-- ============================================================
CREATE TABLE events (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  source          text,
  headline        text NOT NULL,
  url             text,
  timestamp       timestamptz NOT NULL,
  time_bucket     timestamptz NOT NULL,
  categories      text[],
  impact          text,
  related_bill_id uuid REFERENCES bills(id),
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX idx_events_time_bucket ON events (time_bucket);
CREATE INDEX idx_events_bill ON events (related_bill_id);

-- ============================================================
-- SENTIMENT
-- Calculated sentiment per politician / bill / event.
-- subject_type discriminates. Correlates with Scrollvate feed.
-- ============================================================
CREATE TABLE sentiment (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  subject_type    text NOT NULL,               -- 'politician' / 'bill' / 'event'
  subject_id      uuid NOT NULL,
  score           numeric,                     -- -1.0 to 1.0
  source          text,
  timestamp       timestamptz NOT NULL,
  time_bucket     timestamptz NOT NULL,
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX idx_sentiment_subject ON sentiment (subject_type, subject_id);
CREATE INDEX idx_sentiment_time ON sentiment (time_bucket);

-- ============================================================
-- USER INTERACTIONS
-- The social layer. Likes, follows, shares across bills and
-- politicians. Feeds traction scoring and Scrollvate ranking.
-- ============================================================
CREATE TABLE user_interactions (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         text NOT NULL,
  subject_type    text NOT NULL,               -- 'bill' / 'politician' / 'vote' / 'event'
  subject_id      uuid NOT NULL,
  action          text NOT NULL,               -- 'like' / 'follow' / 'share' / 'unfollow'
  timestamp       timestamptz NOT NULL,
  time_bucket     timestamptz NOT NULL,
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX idx_interactions_user ON user_interactions (user_id);
CREATE INDEX idx_interactions_subject ON user_interactions (subject_type, subject_id);
CREATE INDEX idx_interactions_action ON user_interactions (action);
CREATE INDEX idx_interactions_time ON user_interactions (time_bucket);

-- ============================================================
-- TRACTION HISTORY
-- Snapshot traction over time per bill or politician.
-- Enables momentum visualization — the blockchain nav metaphor.
-- Current score lives on bills/politicians tables.
-- History lives here for trend lines and velocity calculation.
-- ============================================================
CREATE TABLE traction_history (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  subject_type    text NOT NULL,               -- 'bill' / 'politician'
  subject_id      uuid NOT NULL,
  traction_score  numeric,
  like_count      integer,
  follow_count    integer,
  share_count     integer,
  cosponsor_count integer,
  media_count     integer,
  timestamp       timestamptz NOT NULL,
  time_bucket     timestamptz NOT NULL,
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX idx_traction_subject ON traction_history (subject_type, subject_id);
CREATE INDEX idx_traction_time ON traction_history (time_bucket);
CREATE INDEX idx_traction_score ON traction_history (traction_score DESC);

-- ============================================================
-- INGESTION SOURCES
-- Tracks every Filter Feeder data source.
-- Extensible as new states are added.
-- ============================================================
CREATE TABLE ingestion_sources (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_name     text NOT NULL,               -- 'legiscan_federal' / 'mga_maryland' / 'congress_gov'
  scope           text NOT NULL,               -- 'federal' / 'state'
  state_code      text,                        -- NULL for federal
  last_sync_at    timestamptz,
  sync_status     text DEFAULT 'pending',
  record_count    integer DEFAULT 0,
  created_at      timestamptz DEFAULT now()
);

INSERT INTO ingestion_sources (source_name, scope, state_code, sync_status) VALUES
  ('legiscan_federal', 'federal', NULL, 'pending'),
  ('congress_gov',     'federal', NULL, 'pending'),
  ('mga_maryland',     'state',   'MD', 'pending');

-- ============================================================
-- SYSTEM STATE
-- Key/value store for stack-wide operational flags.
-- ============================================================
CREATE TABLE state (
  key             text PRIMARY KEY,
  value           text,
  updated_at      timestamptz DEFAULT now()
);

INSERT INTO state (key, value) VALUES
  ('sync_status',             'initializing'),
  ('last_record',             '0'),
  ('seeded_at',               now()::text),
  ('active_session_federal',  '119'),
  ('active_session_md',       '2026RS'),
  ('filter_feeder_mode',      'inactive'),
  ('traction_algo_version',   '1.0'),
  ('scrollvate_portals',      '12'),
  ('stack_version',           '1.0');
