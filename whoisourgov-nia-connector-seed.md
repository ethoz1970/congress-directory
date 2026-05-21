# WHOISOURGOV — Nia Connector Contract

> Engineering contract for wiring Nia (RAG + LLM political analyst) into
> the WhoIsOurGov data lake. Companion to `whoisourgov-nia-seed.md`
> (which defines *what* Nia is); this doc covers *how* she reads.
>
> Audience: the LLM building / operating Nia's connector layer.
> Last updated: **2026-05-11**.

---

## TL;DR

| What | Where | State |
|---|---|---|
| **Raw bill firehose** | Mongo `gov_mongo` @ `10.1.10.4:27019` | ✅ Live — 15,631 federal bills (119th) |
| **Structured query layer** | Postgres `gov_postgres` @ `10.1.10.4:5434` | ⚠️ Tables exist, **rows = 0** until Phase C (ETA this week) |
| **Vector index** | Qdrant `gov_qdrant` @ `10.1.10.4:6337` | ⚠️ Collections empty (Phase G — ETA after C, no firm date) |
| **HTTP / REST** | none | ⚠️ Planned for Phase D bridge (Oracle → Supabase mirror) |

**Today's v0 path:** point at **Tier 1 Mongo `gov_mongo.bills`**. It's the only collection with real data right now. Switch to Tier 2 Postgres once Phase C lands (this doc will be updated and the `state` table in Postgres will flip `bills_enriched=true`).

**Auth:** Default is `blacksky` user (full-access). A read-only `nia_reader` role is **recommended before any production wire-up** — provisioning SQL is below in §1.

**Reachability:** Everything is LAN-only on the Oracle (Mac mini @ `10.1.10.4`). No public endpoint. If Nia lives off-LAN, use Tailscale (preferred) or an SSH tunnel.

---

## 1. Access shape

### Connection targets

| Service | Host | Port | DB / namespace | Container |
|---|---|---|---|---|
| Postgres + pgvector 16 | 10.1.10.4 | 5434 | `whoisourgov` | `gov_postgres` |
| MongoDB 7 | 10.1.10.4 | 27019 | `whoisourgov` | `gov_mongo` |
| Qdrant | 10.1.10.4 | 6337 (HTTP) / 6338 (gRPC) | — | `gov_qdrant` |

### Connection strings (for `.env`)

```
GOV_POSTGRES_DSN=postgresql://nia_reader:<password>@10.1.10.4:5434/whoisourgov
GOV_MONGO_URI=mongodb://nia_reader:<password>@10.1.10.4:27019/whoisourgov?authSource=admin&readPreference=secondaryPreferred
GOV_QDRANT_URL=http://10.1.10.4:6337
```

### Auth & roles

**Today:** Only the `blacksky` admin user exists. Don't ship Nia against admin credentials.

**Recommended provisioning** (run once on the Oracle, then put the password in Nia's `.env`):

```sql
-- Postgres: read-only role for Nia
CREATE ROLE nia_reader WITH LOGIN PASSWORD '<generate-strong-password>';
GRANT CONNECT ON DATABASE whoisourgov TO nia_reader;
GRANT USAGE   ON SCHEMA   public      TO nia_reader;
GRANT SELECT  ON ALL TABLES IN SCHEMA public TO nia_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO nia_reader;
-- Block writes explicitly (belt + suspenders)
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM nia_reader;
```

```javascript
// Mongo: read-only user (run in mongosh against the 'admin' db)
db.getSiblingDB('admin').createUser({
  user: 'nia_reader',
  pwd:  '<generate-strong-password>',
  roles: [
    { role: 'read', db: 'whoisourgov' }
  ]
});
```

Qdrant doesn't ship per-user auth by default. For v1, network-level isolation (Tailscale ACL or LAN-only) is the boundary. If we add API-key auth later it'll come via Qdrant's `service.api_key` config.

### Reachability

LAN-only by design. The Oracle never opens ports to the public internet. If Nia is running off-network:

| Option | Best for |
|---|---|
| **Tailscale** | Recommended. Nia and the Oracle join the same tailnet; the Oracle's `10.1.10.4` becomes a tailnet IP reachable from anywhere |
| **SSH tunnel** | Dev / debug — `ssh -L 5434:localhost:5434 blind@<oracle-public>` |
| **Cloudflare Tunnel** | If we ever want a Cloud Run-style HTTP layer in front of the Oracle |

---

## 2. Schema

There are three databases. I'll cover them in the order Nia is most likely to use them.

### 2a. Tier 1 — Mongo (`gov_mongo`) — the raw archive

All 9 collections from the seed exist. Today only three of them are populated. Document shapes are stable; new fields will be **added** as later feeder phases land, never renamed or removed.

#### `bills` — the live one

Composite shape, populated by two feeders:

- **List-endpoint fields** (Phase B.1 — already ingested for all 15,631 bills):

  ```javascript
  {
    _id: ObjectId(...),
    external_id: "119-HR-524",           // natural key — stable across reruns
    congress: 119,
    type: "HR",                          // HR | S | HRES | SRES | HJRES | SJRES | HCONRES | SCONRES
    number: "524",
    title: "NO GOTION Act",
    origin_chamber: "House",             // "House" | "Senate"
    origin_chamber_code: "H",            // "H" | "S"
    latest_action_date: "2025-01-16",    // ISO date string
    latest_action_text: "Referred to the House Committee on Ways and Means.",
    update_date: "2025-01-23",
    update_date_including_text: "2025-01-23T15:25:34Z",
    api_url: "https://api.congress.gov/v3/bill/119/hr/524?format=json",
    human_url: "https://www.congress.gov/bill/119th-congress/house-bill/524",
    source: "congress_gov",
    raw: { /* full list-endpoint API response */ },
    first_seen_at: ISODate("..."),
    last_seen_at: ISODate("..."),
    last_ingest_run_id: "uuid-of-the-B.1-run"
  }
  ```

- **Detail-endpoint fields** (Phase B.2 — added once `detail_fetched_at` is set):

  ```javascript
  {
    // ...everything above plus:
    introduced_date: "2025-01-16",       // ISO date string
    policy_area: "Taxation",             // one of ~30 Library-of-Congress policy areas
    constitutional_authority_text: "Article I, Section 8 ...",

    sponsors: [
      {
        bioguide_id: "M001194",
        full_name: "Rep. Moolenaar, John R. [R-MI-2]",
        first_name: "John",
        last_name: "Moolenaar",
        middle_name: "R.",
        party: "R",                       // "D" | "R" | "I" | "L" | …
        state: "MI",                      // USPS 2-letter
        district: 2,                      // int for House, null for Senate
        is_by_request: false,
        url: "https://api.congress.gov/v3/member/M001194?format=json"
      }
    ],
    primary_sponsor_bioguide_id: "M001194",   // convenience scalar

    actions_count: 3,
    cosponsors_count: 27,
    committees_count: 1,
    subjects_count: 1,
    summaries_count: 1,
    text_versions_count: 1,
    titles_count: 4,

    // URLs to the sub-resources (Phase B.3 will walk these)
    actions_url:        "https://api.congress.gov/v3/bill/119/hr/524/actions?...",
    cosponsors_url:     "https://api.congress.gov/v3/bill/119/hr/524/cosponsors?...",
    committees_url:     "https://api.congress.gov/v3/bill/119/hr/524/committees?...",
    subjects_url:       "https://api.congress.gov/v3/bill/119/hr/524/subjects?...",
    summaries_url:      "https://api.congress.gov/v3/bill/119/hr/524/summaries?...",
    text_versions_url:  "https://api.congress.gov/v3/bill/119/hr/524/text?...",
    titles_url:         "https://api.congress.gov/v3/bill/119/hr/524/titles?...",

    detail_raw: { /* full detail-endpoint API response */ },
    detail_fetched_at: ISODate("2026-05-11T..."),
    detail_fetch_run_id: "uuid-of-the-B.2-run",
    detail_update_date: "2025-01-23",
    detail_update_date_including_text: "2025-01-23T15:25:34Z"
  }
  ```

**Indexes** (per `docker/mongo/init.js`):

```
{ external_id: 1 } UNIQUE
{ scope: 1, state_code: 1 }   // both null for federal today
{ session: 1, status: 1 }
{ sponsor_id: 1 }
{ portal_tag: 1 }
```

#### `records` — the raw archive

Every API response we fetched, in chronological order. Mostly opaque to Nia but useful for citation back-references.

```javascript
{
  _id: ObjectId,
  run_id: "uuid",
  source: "congress_gov",
  endpoint: "/bill/119/hr/524",       // path part of the API URL
  external_id: "119-HR-524",          // present when the response is for one bill
  fetched_at: ISODate,
  response: { /* full untouched API JSON */ }
}
```

Index: `{ source: 1, timestamp: -1 }` (note: `timestamp` is the index spec name; the actual field is `fetched_at`).

#### `ingestion_log` — run audit

```javascript
{
  _id: ObjectId,
  run_id: "uuid",
  source: "congress_gov",
  task: "list_bills" | "bill_detail",
  started_at: ISODate,
  ended_at: ISODate,
  status: "ok" | "errored" | "interrupted" | "running",
  counts: {
    pages: 63,                          // list task
    bills_inserted: 15381,              // list task
    bills_updated: 290,                 // list task
    bills_seen: 15671,                  // list task
    detail_fetched: 1000,               // detail task
    updated: 1000,                      // detail task
    errors: 0
  }
}
```

This is Nia's freshness oracle — query `ingestion_log.findOne({task:"list_bills", status:"ok"}).sort({ended_at:-1})` to know "when did we last touch list-endpoint metadata."

#### Other collections (exist, empty as of 2026-05-11)

`politicians`, `votes`, `bill_texts`, `news_context`, `behavioral_data`, `traction_snapshots`. Shapes match the seed; not populated yet.

---

### 2b. Tier 2 — Postgres (`gov_postgres`) — the structured layer

**Status: 10 tables exist, 0 application rows.** Phase C will populate `bills`; later phases populate `politicians`, `bill_cosponsors`, `votes`. The full schema is committed in `oracle-stack/docker/postgres/init.sql` and was created on the Oracle on 2026-05-11.

Highlights of the table shapes (full schema in the init script):

#### `politicians`
```sql
id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
external_id     text UNIQUE NOT NULL,   -- bioguide_id for federal, scraped id for state
name            text NOT NULL,
party           text,
office          text,                    -- 'senator' | 'representative' | 'governor' | 'justice'
scope           text NOT NULL,           -- 'federal' | 'state'
state_code      text,                    -- NULL for non-state-specific roles
region          text,                    -- district, county, or state name
chamber         text,                    -- 'senate' | 'house' | NULL
active_from     date, active_to date, term_ends date,
age             integer,
phone, address, website, contact_form  text,
media_count_30d integer DEFAULT 0,
traction_score  numeric DEFAULT 0,
follow_count, like_count  integer DEFAULT 0,
created_at      timestamptz DEFAULT now()
```
Indexed on `(scope, state_code)`, `office`, `party`, `traction_score DESC`.

#### `bills`
```sql
id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
external_id         text UNIQUE NOT NULL,    -- '119-HR-524' format — same shape as Mongo
chamber             text,                    -- 'house' | 'senate'
bill_number         text,                    -- 'HR 524'
title               text NOT NULL,
plain_english       text,                    -- Maurice-generated (Phase G); NULL until then
introduced_at       timestamptz NOT NULL,
status              text,                    -- 'introduced'|'committee'|'floor_scheduled'|
                                             -- 'passed_one_chamber'|'passed_both_chambers'|
                                             -- 'enrolled'|'signed'|'vetoed'|'dead'
last_action         text,
last_action_at      timestamptz,
sponsor_id          uuid REFERENCES politicians(id),
portal_tag          text[],                  -- 12-portal taxonomy (GIN indexed)
scope               text NOT NULL,           -- 'federal' | 'state'
state_code          text,                    -- NULL for federal
session             text,                    -- '119' | '2026RS' (MD)
cosponsor_count     integer DEFAULT 0,
bipartisan          boolean DEFAULT false,
racial_equity_flag  boolean DEFAULT false,
traction_score      numeric DEFAULT 0,
like_count, follow_count, share_count  integer DEFAULT 0,
time_bucket         timestamptz NOT NULL,    -- 1-hour aligned for cross-set joins
created_at          timestamptz DEFAULT now()
```
Indexed on `(scope, state_code)`, `status`, `traction_score DESC`, `portal_tag` (GIN), `time_bucket`, `session`, `sponsor_id`.

#### `bill_cosponsors`
```sql
id              uuid PK
bill_id         uuid REFERENCES bills(id),
politician_id   uuid REFERENCES politicians(id),
joined_at       timestamptz,
UNIQUE(bill_id, politician_id)
```

#### `votes`
```sql
id              uuid PK
politician_id   uuid REFERENCES politicians(id),
bill_id         uuid REFERENCES bills(id),
vote            text NOT NULL,          -- 'yea' | 'nay' | 'present' | 'absent'
timestamp       timestamptz NOT NULL,
time_bucket     timestamptz NOT NULL
```

#### Operational tables
- `events` (news/civic context, FK → bills)
- `sentiment` (per subject_type + subject_id, score numeric -1..1)
- `user_interactions` (anon_id-keyed follows/likes/shares — written by browser via Supabase, replicated here later)
- `traction_history` (time-series snapshots; current scores on `bills` / `politicians`)
- `ingestion_sources` (3 seed rows: `legiscan_federal`, `congress_gov`, `mga_maryland` — each carries `last_sync_at`, `sync_status`, `record_count`)
- `state` (key-value flags: `sync_status`, `active_session_federal=119`, etc.)

### 2c. Tier 3 — Qdrant (`gov_qdrant`)

**Status: zero collections.** Planned schema per the seed:

| Collection | Purpose | Dims | When |
|---|---|---|---|
| `bill_vectors` | embeddings of `plain_english` summaries | TBD | Phase G — after Maurice writes plain_english |
| `politician_vectors` | embeddings of politician statements + voting patterns | TBD | After politicians table fills |
| `vote_pattern_vectors` | time-bucketed voting behavior | TBD | After votes table fills |

Embedding model is **not yet chosen.** §4 below outlines the options. One must be committed to before any chunks land — the retrieval call and the writer pipeline must use the identical model.

---

## 3. What's populated right now

As of **2026-05-11**, against the live Oracle:

| Tier | Collection / table | Row count | Notes |
|---|---|---|---|
| Mongo `bills` | 15,631 | All 119th-Congress federal bills (HR / S / HRES / SRES / HJRES / SJRES / HCONRES / SCONRES). Detail fields populated for ~1,000 bills (B.2 in progress). |
| Mongo `records` | 64+ | Raw API responses — one per list-endpoint page (63), plus the detail responses as B.2 runs. |
| Mongo `ingestion_log` | 4+ | Smoke runs + production runs from B.1 and B.2. |
| Mongo (other 6 collections) | 0 | Pending B.3 + politician feeder. |
| Postgres (all 10 tables) | 0 application rows | `ingestion_sources` has 3 seed rows; `state` has 9 seed flags. |
| Qdrant (collections) | 0 | Planned for Phase G. |

**Bill distribution by type** (from the live Mongo bills count, confirmed by a sample query 2026-05-11):

| Type | Count | Description |
|---|---|---|
| HR     | 8,691 | House bills |
| S      | 4,454 | Senate bills |
| HRES   | 1,269 | House simple resolutions |
| SRES   |   722 | Senate simple resolutions |
| SJRES  |   190 | Senate joint resolutions |
| HJRES  |   176 | House joint resolutions |
| HCONRES|    96 | House concurrent resolutions |
| SCONRES|    33 | Senate concurrent resolutions |

**Coverage:** Federal only. **No state-level coverage yet** (Maryland comes in Phase B2 once LegiScan is added).

**Freshness signal** (queries Nia can run any time):

```sql
-- Postgres: when did each source last sync?
SELECT source_name, sync_status, last_sync_at, record_count
  FROM ingestion_sources;
```

```javascript
// Mongo: per-task freshness
db.ingestion_log.aggregate([
  {$match: {status: "ok"}},
  {$sort:  {ended_at: -1}},
  {$group: {_id: "$task", last_run: {$first: "$ended_at"}, last_counts: {$first: "$counts"}}}
])
```

---

## 4. Vector layer

**Not populated yet.** Qdrant is running and empty. Embedding pipeline ownership and model choice are open.

### Open decisions before vectors come online

1. **Where does the embedding pipeline live?**
   - **(A) Maurice owns it.** Phase G builds an embedding pass into the Tier 2→Tier 3 pipeline. Bills get embedded as soon as Maurice writes `plain_english`. Nia just queries.
   - **(B) Nia's connector owns it.** Connector layer embeds inline using whatever model Nia uses for retrieval. Simpler boundary today, but every future consumer of vectors would have to run its own pipeline.
   - **Recommendation: (A).** Embedding belongs upstream of the query layer so the model choice can change without touching every consumer.

2. **Which embedding model?**
   The retrieval call and the pipeline that writes embeddings **must use the same model and the same preprocessing**. Mismatched embeddings = noise. Top candidates:

   | Model | Dims | Notes |
   |---|---|---|
   | `voyage-3-large` (Voyage AI) | 1024 | Strong retrieval performance, especially on legal/legislative text. Recommended. |
   | `text-embedding-3-large` (OpenAI) | 3072 (or 1536 if truncated) | Easy, widely used, decent retrieval. |
   | `bge-large-en-v1.5` (local via sentence-transformers) | 1024 | Free, runs on the Oracle locally. Lower quality than the API models but no per-call cost. |

   No commitment until we agree.

3. **Chunking strategy.** Bills are not uniformly short. Some are one paragraph, some are 800 pages. Recommendation:
   - Chunk at section boundaries when the bill's text version has structure (most do).
   - Fall back to 800-token sliding windows with 100-token overlap.
   - One chunk per row in Qdrant; metadata below.

### Planned metadata shape

When `bill_vectors` is populated, each point will carry:

```json
{
  "id": "uuid",
  "vector": [/* dim */],
  "payload": {
    "external_id":        "119-HR-524",
    "bill_id":            "uuid → gov_postgres.bills.id",
    "chunk_index":        0,
    "chunk_text":         "...",
    "chunk_section":      "Section 3 — Findings",
    "embedding_model":    "voyage-3-large",
    "embedded_at":        "2026-05-20T...",
    "source":             "plain_english" | "full_text" | "summary",
    "congress":           119,
    "type":               "HR",
    "policy_area":        "Taxation",
    "portal_tag":         ["money", "tech"],
    "sponsor_party":      "R",
    "sponsor_state":      "MI",
    "scope":              "federal"
  }
}
```

The payload filters above are what make hybrid retrieval (vector + structured) cheap — Nia can do `find bills similar to {anchor} where portal_tag contains 'health' and sponsor_party='D'` in one Qdrant call.

---

## 5. Query patterns

### What Nia should prefer

**Postgres (once Phase C lands):**
- Use the indexed columns for filters: `scope`, `state_code`, `status`, `portal_tag` (GIN — `WHERE portal_tag @> ARRAY['health']`), `time_bucket`, `session`, `sponsor_id`.
- Range queries on `last_action_at` / `introduced_at` are fine; both columns have implicit B-tree indexes when used with `ORDER BY`.
- Don't `SELECT *` on `bills` — `plain_english` will be long when populated.

**Mongo (today):**
- Lookup by `external_id` is unique-indexed — `db.bills.findOne({external_id: "119-HR-524"})`.
- Recent activity: `db.bills.find().sort({update_date_including_text: -1}).limit(50)` — works because the list-endpoint pull sorts by this and we preserve it.
- Sponsor's bills: `db.bills.find({primary_sponsor_bioguide_id: "M001194"})` — only meaningful for bills where B.2 has run.
- Avoid full-collection scans on string fields with regex. For text search, lean on Postgres FTS once Phase C lands.

### Views / materialized views

**None yet.** As query patterns settle (Nia is the first real consumer), we'll likely add:
- `bills_recent` — last 30 days of state transitions
- `politicians_active` — current term, filterable by chamber + party + state
- `bipartisan_bills` — bills where cosponsors span both parties (depends on B.3)

If there's a query Nia runs many times per day, surface it — we'll consider promoting to a view.

### RPC functions

**None planned for v1.** If a frequent multi-filter shape like "find similar bills by topic + state + party in one call" emerges, that's a candidate for a small Postgres function — surface the pattern and it'll be considered.

---

## 6. Update cadence

| Source | Cadence | Method |
|---|---|---|
| Congress.gov list endpoint → Mongo `bills` | Currently manual, **moving to daily 06:00 local** via launchd on the Oracle (ETA this week) | `python -m feeder.congress_gov` |
| Congress.gov detail endpoint → Mongo `bills` | After the list pull each day | `python -m feeder.congress_gov_detail` |
| Mongo → Postgres `bills` (Phase C) | Daily, post-detail | `python -m enricher.enrich_bills` (not built yet) |
| Postgres `bills` → Qdrant `bill_vectors` (Phase G) | After Maurice writes plain_english | TBD |
| Supabase mirror of Tier 2 (Phase D) | Hourly | TBD |

**Nia's posture:** **trust on read, no polling, no push.** Query when asked. If a question demands freshness, read `ingestion_log` or `ingestion_sources.last_sync_at` and include the freshness in the response: *"Based on the data as of 2026-05-11 06:02 UTC ..."*

---

## 7. Stability

Contract Nia can rely on:

- **Schema is additive only.** New tables, new columns, new Mongo fields will appear over time. No renames, no drops. If a column is going away, it'll be deprecated for at least a release cycle.
- **`external_id` is immutable.** `"119-HR-524"` will always mean the same bill. Same for bioguide IDs.
- **`portal_tag` taxonomy** uses 12 slug keys (`planet`, `money`, `housing`, `health`, `tech`, `edu`, `safety`, `culture`, `food`, `rights`, `military`, `shop`). If we change the taxonomy, the change will go to a versioned column (`portal_tag_v2`) — the v1 column stays alongside through a transition.
- **Status values** are the 9-state lifecycle in `gov_postgres.bills.status`: `introduced | committee | floor_scheduled | passed_one_chamber | passed_both_chambers | enrolled | signed | vetoed | dead`. New states would be additive at the end.

Known coming changes:

| Change | When | Breaking? |
|---|---|---|
| Tier 2 Postgres rows start appearing | Phase C, this week | No — just new rows |
| Cosponsors / actions / text fields land in Mongo `bills` | Phase B.3 | Additive — new top-level fields |
| `gov_postgres.bills.plain_english` populated | Phase G | Additive |
| Qdrant collections created | Phase G | New surface, doesn't affect existing |
| State coverage (Maryland) added | Phase B.2+ (LegiScan) | Additive — `state_code` populated for new rows |

---

## 8. Sample rows

### Mongo `bills` — list-only fields (typical bill, pre-B.2)

```json
{
  "_id": "ObjectId('66431a...')",
  "external_id": "119-HR-1234",
  "congress": 119,
  "type": "HR",
  "number": "1234",
  "title": "To amend the Internal Revenue Code of 1986 to ...",
  "origin_chamber": "House",
  "origin_chamber_code": "H",
  "latest_action_date": "2025-02-12",
  "latest_action_text": "Referred to the House Committee on Ways and Means.",
  "update_date": "2025-02-13",
  "update_date_including_text": "2025-02-13T20:00:00Z",
  "api_url": "https://api.congress.gov/v3/bill/119/hr/1234?format=json",
  "human_url": "https://www.congress.gov/bill/119th-congress/house-bill/1234",
  "source": "congress_gov",
  "raw": { /* …trimmed for brevity… */ },
  "first_seen_at": "2026-05-11T17:13:45.000Z",
  "last_seen_at":  "2026-05-11T18:24:23.000Z",
  "last_ingest_run_id": "07baa693-..."
}
```

### Mongo `bills` — list + detail (real, from B.2 run today)

```json
{
  "_id": "ObjectId('...')",
  "external_id": "119-HR-524",
  "congress": 119,
  "type": "HR",
  "number": "524",
  "title": "NO GOTION Act",
  "origin_chamber": "House",
  "origin_chamber_code": "H",
  "latest_action_date": "2025-01-16",
  "latest_action_text": "Referred to the House Committee on Ways and Means.",
  "update_date": "2025-01-23",
  "update_date_including_text": "2025-01-23T15:25:34Z",
  "api_url": "https://api.congress.gov/v3/bill/119/hr/524?format=json",
  "human_url": "https://www.congress.gov/bill/119th-congress/house-bill/524",
  "source": "congress_gov",

  "introduced_date": "2025-01-16",
  "policy_area": "Taxation",
  "constitutional_authority_text": "Article I, Section 8 of the Constitution ...",

  "sponsors": [
    {
      "bioguide_id": "M001194",
      "full_name": "Rep. Moolenaar, John R. [R-MI-2]",
      "first_name": "John",
      "last_name": "Moolenaar",
      "middle_name": "R.",
      "party": "R",
      "state": "MI",
      "district": 2,
      "is_by_request": false,
      "url": "https://api.congress.gov/v3/member/M001194?format=json"
    }
  ],
  "primary_sponsor_bioguide_id": "M001194",

  "actions_count": 3,
  "cosponsors_count": 27,
  "committees_count": 1,
  "subjects_count": 1,
  "summaries_count": 1,
  "text_versions_count": 1,
  "titles_count": 4,

  "actions_url": "https://api.congress.gov/v3/bill/119/hr/524/actions?...",
  "cosponsors_url": "https://api.congress.gov/v3/bill/119/hr/524/cosponsors?...",
  "committees_url": "https://api.congress.gov/v3/bill/119/hr/524/committees?...",
  "subjects_url": "https://api.congress.gov/v3/bill/119/hr/524/subjects?...",
  "summaries_url": "https://api.congress.gov/v3/bill/119/hr/524/summaries?...",
  "text_versions_url": "https://api.congress.gov/v3/bill/119/hr/524/text?...",
  "titles_url": "https://api.congress.gov/v3/bill/119/hr/524/titles?...",

  "detail_raw": { /* …full detail response… */ },
  "detail_fetched_at": "2026-05-11T...",
  "detail_fetch_run_id": "6e25f088-...",
  "detail_update_date": "2025-01-23",
  "detail_update_date_including_text": "2025-01-23T15:25:34Z",

  "first_seen_at": "2026-05-11T17:13:45.000Z",
  "last_seen_at":  "2026-05-11T18:24:23.000Z",
  "last_ingest_run_id": "07baa693-..."
}
```

### Postgres `bills` — planned shape (Phase C output)

Will look like this once the enricher runs:

```
external_id   | 119-HR-524
chamber       | house
bill_number   | HR 524
title         | NO GOTION Act
plain_english | NULL (until Maurice; Phase G)
introduced_at | 2025-01-16 00:00:00+00
status        | committee
last_action   | Referred to the House Committee on Ways and Means.
last_action_at| 2025-01-16 00:00:00+00
sponsor_id    | <uuid → politicians.id where external_id='M001194'>
portal_tag    | {money, tech}              -- via topics.tag_text
scope         | federal
state_code    | NULL
session       | 119
cosponsor_count | 27
bipartisan    | false                      -- can't compute until B.3 (cosponsor parties)
time_bucket   | 2025-01-16 00:00:00+00
```

### Postgres `politicians` — planned shape (no feeder yet)

```
external_id  | M001194
name         | Rep. Moolenaar, John R.
party        | R
office       | representative
scope        | federal
state_code   | MI                            -- only set when scope='state'? we use it for federal-state too
region       | MI-2
chamber      | house
website      | https://moolenaar.house.gov
...
```

### Vector chunk — planned shape

(No real example yet; this is the target):

```json
{
  "id": "a3b9...",
  "vector": [/* 1024 floats for voyage-3-large */],
  "payload": {
    "external_id": "119-HR-524",
    "bill_id": "<uuid>",
    "chunk_index": 0,
    "chunk_text": "A BILL To amend the Internal Revenue Code of 1986 to deny credits for clean vehicles ...",
    "chunk_section": "Title / Preamble",
    "embedding_model": "voyage-3-large",
    "embedded_at": "2026-05-20T...",
    "source": "full_text",
    "congress": 119,
    "type": "HR",
    "policy_area": "Taxation",
    "portal_tag": ["money", "tech"],
    "sponsor_party": "R",
    "sponsor_state": "MI",
    "scope": "federal"
  }
}
```

---

## 9. Naming

Disambiguation, because this domain has a lot of overlapping words:

| Term | What it means |
|---|---|
| **WhoIsOurGov / WIOG** | The brand. The product. The thing users see. |
| **Oracle** | The whole three-tier stack running on the Mac mini at `10.1.10.4`. *Codename for the system.* When someone says "the Oracle," they mean Mongo + Postgres + Qdrant together. |
| **Tier 1 / Tier 2 / Tier 3** | The architectural layers within the Oracle. Tier 1 = raw lake (Mongo). Tier 2 = structured (Postgres). Tier 3 = vectors (Qdrant). |
| **gov_mongo / gov_postgres / gov_qdrant** | The three Docker containers / databases themselves. These are the names that appear in connection strings and code. |
| **Filter Feeder Mode** | A *pattern*, not a database. Describes how the Oracle ingests: wide net into Tier 1, narrow through Tier 2, vectorize into Tier 3. "Filter DB" is **not** a real layer — if someone uses that phrase they probably mean "Tier 1 Mongo, where filtering hasn't happened yet." |
| **The feeders** | The Python jobs that fill Tier 1 from external APIs. Live in `PolySciFi/who-is-our-gov/feeder/`. `congress_gov.py` (list), `congress_gov_detail.py` (detail). |
| **The enricher** | The Python job that goes Tier 1 → Tier 2 (Phase C). Will live in `PolySciFi/who-is-our-gov/feeder/feeder/enrich_bills.py`. Not built yet. |
| **Maurice** | The offline LLM that generates `plain_english` summaries during enrichment. Writes data. |
| **Nia** | The online LLM that answers user questions. Reads data only. Subject of this doc. |
| **Bills POC** | A separate prototype on Sentiment-vs-Power's Supabase that surfaced bills in Scrollvate. **Not** Nia's data source — eventually retires when Oracle data flows to Supabase via Phase D. |

---

## Five things to internalize

1. Connect to **Mongo `gov_mongo` at `10.1.10.4:27019`** with the `nia_reader` role (provision SQL in §1). That's where the data is today.
2. Use **`external_id`** ("119-HR-524") as the natural key everywhere — it's stable, immutable, and shared across Mongo, the planned Postgres rows, and the planned vector payloads.
3. **Postgres is on deck** (Phase C ETA this week). When it's ready, switch to it for everything except raw-archive lookups. Detect readiness by querying `gov_postgres.bills` for a non-zero row count, or by checking `state.value WHERE key='filter_feeder_mode'` flipping to `'active'`.
4. **Qdrant is empty.** No vector retrieval until the embedding model is locked and Phase G writes points.
5. **Schema is additive-only.** Build against today's shape with confidence; new fields will arrive but nothing will disappear.

If a sample row in §8 doesn't match what's actually in the database, treat that as a contract bug — the database is the source of truth, this doc is the contract that should match it. Surface the mismatch with the actual payload so the contract can be corrected.

---

*Blacksky LLC — Since 2000.*
*Ubuntu: I am because we are.*
