# WHOISOURGOV — Triple-Tier DB Seed for Cowork

**Project context:** A whoisourgov data stack — a parallel three-tier system to the Eternal Ledger / Bitcoin Clock that already lives on The Oracle. Same architectural pattern: a raw NoSQL archive, a structured SQL warehouse, and a vector store for semantic search. Different ports, different volumes, different containers — designed to run alongside the BST stack and the Bitcoin Clock stack without interfering.

**Scope of this stack:** Federal (119th Congress, 537 members) as the initial dataset. Maryland state legislature (188 members, 2026RS session) as the first state expansion. Architecture is designed to absorb additional states and eventually Supreme Court without schema changes.

---

## The Oracle (shared host)

- MacBook Air Intel 2020 at LAN `10.1.10.4`
- Docker Desktop always-on, 24/7
- Other tenants on this host (DO NOT TOUCH):
  - **BST stack** — `oracle_postgres`, `oracle_mongo`, `oracle_qdrant`
  - **Eternal Ledger / Bitcoin Clock** — `clock_postgres` (5433), `clock_mongo` (27018), `clock_qdrant` (6335/6336)
- Stack location for whoisourgov: `/Users/blind/whoisourgov/`

---

## Ports — offset from existing stacks

| Database | Container | Host port | Database name |
|---|---|---|---|
| Postgres 16 + pgvector | `gov_postgres` | 5434 | `whoisourgov` |
| MongoDB 7 | `gov_mongo` | 27019 | `whoisourgov` |
| Qdrant | `gov_qdrant` | 6337 / 6338 | — |

**Credentials:**
- User: `blacksky` (same convention as other stacks)
- Password: from `${POSTGRES_PASSWORD}` / `${MONGO_PASSWORD}` in `/Users/blind/whoisourgov/.env`

---

## Three-Tier Architecture

- **Tier 1 — MongoDB (`gov_mongo`)** — the raw archive. Source of truth. Every ingested record goes in untouched. Full bill texts, raw scrapes, ingestion logs. All other tiers are derivable from this.
- **Tier 2 — PostgreSQL (`gov_postgres`)** — structured metrics, joinable across datasets via SQL. Time-bucketed for cross-dataset alignment with Sentiment vs. Power spine. Traction scoring, vote records, social interactions.
- **Tier 3 — Qdrant (`gov_qdrant`)** — behavioral and semantic vectors. Pattern matching across bill texts, politician statements, voting behavior. Powers Scrollvate feed ranking and semantic search.

If any tier is ever wiped, it can be rebuilt from the Mongo raw lake. Only Mongo needs durable backup discipline.

---

## Filter Feeder Mode

The Oracle operates in Filter Feeder Mode for this stack:

- **Tier 1 opens wide** — raw ingestion from LegiScan federal API, Congress.gov bulk data, MGA Maryland scrape, and any future state source. Everything in, untouched.
- **Tier 2 is the baleen** — normalizes, tags, scores, links members to bills, computes traction, maps to Scrollvate portals.
- **Tier 3 surfaces meaning** — semantic vectors enable "find bills like this," "find members who vote like this," and feed ranking for Scrollvate.

**Active ingestion sources (seed state):**
- `legiscan_federal` — 119th Congress, all bills
- `congress_gov` — validation and supplemental data
- `mga_maryland` — Maryland General Assembly, 2026RS session

---

## File Structure on The Oracle

```
/Users/blind/whoisourgov/
├── docker-compose.yml
├── .env                              ← gitignored; contains POSTGRES_PASSWORD, MONGO_PASSWORD
└── docker/
    ├── postgres/init.sql             ← seeds all tables + state rows
    ├── mongo/init.js                 ← creates collections + indexes
    └── qdrant/config.yaml            ← Qdrant config (collections created via API)
```

---

## docker-compose.yml

```yaml
version: "3.9"

# ============================================================
# WHOISOURGOV — Data Stack
# Separate from BST and Eternal Ledger. Same Oracle hardware.
# Ports offset to avoid existing-stack conflicts.
# Filter Feeder Mode: all ingestion flows through Tier 1 (Mongo)
# before enrichment to Tier 2 (Postgres) and Tier 3 (Qdrant).
# ============================================================

services:

  gov_postgres:
    image: pgvector/pgvector:pg16
    container_name: gov_postgres
    restart: always
    environment:
      POSTGRES_DB: whoisourgov
      POSTGRES_USER: blacksky
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    ports:
      - "5434:5432"
    volumes:
      - gov_postgres_data:/var/lib/postgresql/data
      - ./docker/postgres/init.sql:/docker-entrypoint-initdb.d/init.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U blacksky -d whoisourgov"]
      interval: 10s
      timeout: 5s
      retries: 5
    mem_limit: 1g
    networks:
      - gov_net

  gov_mongo:
    image: mongo:7
    container_name: gov_mongo
    restart: always
    environment:
      MONGO_INITDB_ROOT_USERNAME: blacksky
      MONGO_INITDB_ROOT_PASSWORD: ${MONGO_PASSWORD}
      MONGO_INITDB_DATABASE: whoisourgov
    ports:
      - "27019:27017"
    volumes:
      - gov_mongo_data:/data/db
      - ./docker/mongo/init.js:/docker-entrypoint-initdb.d/init.js
    healthcheck:
      test: ["CMD", "mongosh", "--eval", "db.adminCommand('ping')"]
      interval: 10s
      timeout: 5s
      retries: 5
    mem_limit: 1g
    networks:
      - gov_net

  gov_qdrant:
    image: qdrant/qdrant:latest
    container_name: gov_qdrant
    restart: always
    ports:
      - "6337:6333"
      - "6338:6334"
    volumes:
      - gov_qdrant_data:/qdrant/storage
      - ./docker/qdrant/config.yaml:/qdrant/config/production.yaml
    mem_limit: 512m
    networks:
      - gov_net

volumes:
  gov_postgres_data:
    driver: local
  gov_mongo_data:
    driver: local
  gov_qdrant_data:
    driver: local

networks:
  gov_net:
    driver: bridge
```

---

## docker/postgres/init.sql

```sql
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
```

---

## docker/mongo/init.js

```js
// whoisourgov — Mongo initialization
// Tier 1: raw archive. Source of truth.
// Everything ingested lands here first, untouched.
// Tier 2 (Postgres) and Tier 3 (Qdrant) are derived from this.

db = db.getSiblingDB('whoisourgov');

// Core collections
db.createCollection('records');             // raw ingestion — every source, every record
db.createCollection('politicians');         // full politician profiles, no flattening
db.createCollection('votes');               // full vote records
db.createCollection('bills');               // full bill metadata
db.createCollection('bill_texts');          // full bill text — too heavy for Postgres
db.createCollection('news_context');        // timestamped news / press releases / statements
db.createCollection('behavioral_data');     // vector-companion docs (richer metadata for Qdrant)

// Filter Feeder operational collections
db.createCollection('traction_snapshots'); // raw traction data before scoring pipeline
db.createCollection('ingestion_log');      // every filter feeder run logged raw

// Indexes — core
db.politicians.createIndex({ external_id: 1 }, { unique: true });
db.politicians.createIndex({ scope: 1, state_code: 1 });
db.politicians.createIndex({ office: 1 });

db.bills.createIndex({ external_id: 1 }, { unique: true });
db.bills.createIndex({ scope: 1, state_code: 1 });
db.bills.createIndex({ session: 1, status: 1 });
db.bills.createIndex({ sponsor_id: 1 });
db.bills.createIndex({ portal_tag: 1 });

db.bill_texts.createIndex({ bill_id: 1 }, { unique: true });

db.votes.createIndex({ politician_id: 1, timestamp: -1 });
db.votes.createIndex({ bill_id: 1 });

db.news_context.createIndex({ timestamp: -1 });
db.news_context.createIndex({ related_bill_id: 1 });

db.records.createIndex({ source: 1, timestamp: -1 });

// Filter Feeder indexes
db.traction_snapshots.createIndex({ subject_id: 1, timestamp: -1 });
db.ingestion_log.createIndex({ source: 1, timestamp: -1 });
db.ingestion_log.createIndex({ status: 1 });
```

---

## docker/qdrant/config.yaml

```yaml
storage:
  storage_path: /qdrant/storage
service:
  host: 0.0.0.0
  http_port: 6333
  grpc_port: 6334
log_level: INFO
```

**Qdrant collections — created by the API layer when first needed:**

- `bill_vectors` — semantic embeddings of bill plain_english summaries (Maurice-generated). Powers "find bills like this" and Scrollvate feed ranking.
- `politician_vectors` — embeddings of politician statements, voting patterns, and behavioral data.
- `vote_pattern_vectors` — time-bucketed voting behavior. Powers "find members who vote like this."

Vector dimensions to be defined when embedding model is selected. Time-bucketed alignment with Postgres `events` and `sentiment` tables.

---

## .env (gitignored, on The Oracle)

```
POSTGRES_PASSWORD=<same convention as BST / Eternal Ledger or new>
MONGO_PASSWORD=<same>
NODE_ID=whoisourgov
STACK=whoisourgov
LEGISCAN_API_KEY=<register free at legiscan.com>
```

---

## Setup Commands on The Oracle

```bash
mkdir -p /Users/blind/whoisourgov/docker/{postgres,mongo,qdrant}
cd /Users/blind/whoisourgov
# Drop docker-compose.yml, .env, and the three init files in place
docker compose up -d
docker compose ps        # all three should show Up (healthy)
```

**Verify:**

```bash
# Mongo — check collections exist
docker exec gov_mongo mongosh \
  -u blacksky -p $MONGO_PASSWORD --authenticationDatabase admin \
  --eval "db.getSiblingDB('whoisourgov').getCollectionNames()"

# Postgres — check tables exist
docker exec gov_postgres psql -U blacksky -d whoisourgov -c "\dt"

# Qdrant — check service is live
curl -s http://localhost:6337/collections

# Ingestion sources — confirm seed rows
docker exec gov_postgres psql -U blacksky -d whoisourgov \
  -c "SELECT source_name, scope, state_code, sync_status FROM ingestion_sources;"
```

---

## Connection Info (Brain / API layer)

```
GOV_POSTGRES=postgresql://blacksky:<password>@10.1.10.4:5434/whoisourgov
GOV_MONGO=mongodb://blacksky:<password>@10.1.10.4:27019/whoisourgov?authSource=admin
GOV_QDRANT=http://10.1.10.4:6337
```

---

## What's Reused vs. What's Project-Specific

**Reused exactly from existing Oracle stacks:**
- docker-compose shape and cohabitation discipline
- Three-tier architecture and rationale
- Init-on-first-boot pattern
- Credential and volume naming convention
- Offset ports (5434, 27019, 6337/6338)
- Dedicated network (`gov_net`)

**New in this stack:**
- `scope` + `state_code` discriminator on politicians and bills — enables federal/state coexistence without schema changes as new states are added
- `portal_tag` on bills — maps to 12 Scrollvate civic portals, GIN indexed
- `plain_english` on bills — Maurice-generated summary field, populated by Tier 2 enrichment pipeline
- `traction_score` on bills and politicians — computed composite, snapshotted to `traction_history` for velocity/momentum visualization
- `bill_cosponsors` junction table — many-to-many, feeds bipartisan flag and cosponsor velocity
- `user_interactions` table — the social layer (like / follow / share) feeding traction scoring and Scrollvate feed ranking
- `traction_history` table — time-series snapshots enabling blockchain-nav momentum visualization
- `ingestion_sources` table — tracks every Filter Feeder source, extensible per state added
- `bill_texts` Mongo collection — full text too heavy for Postgres, lives in Tier 1
- `traction_snapshots` + `ingestion_log` Mongo collections — Filter Feeder operational data

---

## Expansion Path (no schema changes required)

| Phase | Action |
|---|---|
| Phase 1 | Federal — 119th Congress, LegiScan federal feed |
| Phase 2 | Maryland — MGA 2026RS session, 188 members |
| Phase 3 | Next state — add row to `ingestion_sources`, set `state_code` |
| Phase 4 | Supreme Court — `office = 'justice'`, `scope = 'federal'`, cases as bills analog |
| Phase 5 | All 50 states — same pattern, Filter Feeder opens wider |

---

*Blacksky LLC — Since 2000.*
*Ubuntu: I am because we are.*
