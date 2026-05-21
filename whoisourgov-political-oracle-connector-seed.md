# WHOISOURGOV — Political Oracle Connector Contract

> Engineering contract for wiring an externally-built **RAG-based Political
> Oracle** (US-government-focused) into the WIOG data lake. Sister doc to
> `whoisourgov-nia-connector-seed.md` (Nia is our in-house conversational
> agent; the Political Oracle is a separate, externally-built RAG system
> the user has trained and wants to feed from our structured catalog).
>
> Audience: the LLM (or the engineer) wiring the Political Oracle to the
> WIOG data lake.
> Last updated: **2026-05-12**.

---

## Naming note: "Oracle" disambiguation

We have a name collision worth calling out at the top:

| Term | What it means here |
|---|---|
| **The Oracle** | Our codename for the *three-tier data stack* on the Mac mini at LAN `10.1.10.4` (Mongo + Postgres + Qdrant). It's infrastructure, not AI. |
| **Political Oracle** | *Your* externally-built RAG agent — the consumer this doc is written for. An LLM/retrieval system, not a database. |

When this doc says "the Oracle" without modifier, it means our infrastructure
stack. When it says "Political Oracle" or "the RAG," it means your agent.
Worth considering a clearer name on your side eventually (Beacon, Pundit,
Sentinel, Scribe — anything that doesn't overload "Oracle") but the
collision is documentation-level only; nothing in the wire-up depends on it.

---

## TL;DR

| Question | Answer |
|---|---|
| **What's the canonical metadata source?** | Postgres `gov_postgres` at `10.1.10.4:5434/whoisourgov` (also called the *Filter DB* in conversation). |
| **Where's the raw bill text?** | Mongo `gov_mongo` at `10.1.10.4:27019/whoisourgov`. Empty today for `bill_texts`; arrives in Phase B.3. |
| **What about vectors?** | Qdrant `gov_qdrant` at `10.1.10.4:6337` — running but empty. Phase G of our roadmap; embedding-model choice is open. |
| **How should the RAG ingest?** | Pull from Tier 2 Postgres hourly, filter on `oracle_synced_at > last_local_sync`. Embed locally with your own model. Don't vectorize the firehose. |
| **Auth?** | Read-only Postgres role `political_oracle_reader` — provisioning SQL below. No public endpoint; the Oracle stays on LAN. Use Tailscale or SSH tunnel if the RAG runs off-network. |
| **What's the right retrieval pattern?** | Tiered hybrid: structured SQL filter first → vector search over surviving IDs → detail expansion. See §3. |

---

## 1. Access shape

### Connection targets

| Service | Host | Port | DB / namespace | When to use |
|---|---|---|---|---|
| Postgres + pgvector 16 | 10.1.10.4 | 5434 | `whoisourgov` | Default. Catalog filters, attribute reads. |
| MongoDB 7 | 10.1.10.4 | 27019 | `whoisourgov` | Raw bill text (Phase B.3+), citation back-references. |
| Qdrant | 10.1.10.4 | 6337 / 6338 | — | Optional. Empty today; will hold our own embeddings later if we commit to a shared model. |

### Connection strings

```env
# Add these to the Political Oracle's .env
WIOG_POSTGRES_DSN=postgresql://political_oracle_reader:<password>@10.1.10.4:5434/whoisourgov
WIOG_MONGO_URI=mongodb://political_oracle_reader:<password>@10.1.10.4:27019/whoisourgov?authSource=admin&readPreference=secondaryPreferred
WIOG_QDRANT_URL=http://10.1.10.4:6337
```

### Provisioning (run once on the Oracle)

```sql
-- Postgres: read-only role scoped to the public schema.
CREATE ROLE political_oracle_reader WITH LOGIN PASSWORD '<strong-password>';
GRANT CONNECT ON DATABASE whoisourgov TO political_oracle_reader;
GRANT USAGE   ON SCHEMA   public      TO political_oracle_reader;
GRANT SELECT  ON ALL TABLES IN SCHEMA public TO political_oracle_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO political_oracle_reader;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public
  FROM political_oracle_reader;
```

```javascript
// Mongo: a read-only user (in mongosh on the Oracle, against the admin db).
db.getSiblingDB('admin').createUser({
  user: 'political_oracle_reader',
  pwd:  '<strong-password>',
  roles: [ { role: 'read', db: 'whoisourgov' } ]
});
```

### Reachability

The Oracle is LAN-only by design. If the Political Oracle runs off-network:

| Path | Best for |
|---|---|
| **Tailscale** | Recommended. Both sides join the same tailnet; the Oracle is reachable at its tailnet IP from anywhere. Single config. |
| **SSH tunnel** | Dev / debug — `ssh -L 5434:localhost:5434 -L 27019:localhost:27019 blind@<oracle-public>`. |
| **Cloud Run proxy** | If we ever expose a small HTTP wrapper publicly (Phase D bridge to Supabase already does this for browser reads). Hasn't been done for the Postgres side. |

---

## 2. Schema (what to ingest into the RAG)

Three entity types matter for civic Q&A. Order roughly by ingestion priority.

### `politicians` — ~600 rows, small, ingest fully

`gov_postgres.politicians` (will be populated alongside Phase B.3 — currently empty in the Oracle's Tier 2, but the same data is mirrored in Supabase via `sync_wiog.py` at `people` table with shape: `bioguide_id PK, full_name, party, chamber, state, district, metadata JSONB`).

For the RAG: embed *one document per politician* with:

```
{full_name}, {party}, {chamber} from {state}.
Sponsored {sponsored_count} bills this session.
Recent sponsorship themes: {top portal_tags from their sponsored bills}.
Top committees: {committee names}.
```

That's ~50 tokens per politician × 600 = 30K tokens total to embed. Trivial cost. Powers "find senators who care about X" and "who sponsors a lot of healthcare bills."

### `bills` — 15K+ and growing, ingest with curation

`gov_postgres.bills` post-Phase-C. The Oracle-sourced row carries:

```
external_id, congress, type, number, title, status,
introduced_at, last_action, last_action_at,
sponsor (via sponsor_id → politicians),
portal_tag text[], policy_area,
cosponsor_count, bipartisan, racial_equity_flag,
plain_english (NULL until Maurice ships)
```

**Do NOT embed all 15K naively.** Most bills die in committee unread. Two strategies:

- **Tiered ingestion**: embed bills whose `battlefield_score > threshold` (see the Battlefield scoring in `pipeline/bills_pack.py`). That's ~500–2000 bills at any time — the ones that actually matter. Re-rank weekly.
- **On-demand embedding**: don't pre-embed at all. When a user query mentions a specific bill or topic, run the structured filter first, then embed only the surviving candidates inline. Trades latency for index size.

For the embed chunk (until Maurice):
```
{type} {number}: {title}.
Policy area: {policy_area}.
Sponsored by {sponsor_full_name} ({sponsor_party}-{sponsor_state}).
{cosponsor_count} cosponsors. Bipartisan: {true/false}.
Status: {status}. Latest action: {latest_action_text} on {latest_action_date}.
```

After Maurice (Phase G):
```
{type} {number}: {title}.
{plain_english}            ← Maurice-generated plain English, 1-2 sentences
Policy area: {policy_area}.
Sponsored by {sponsor_full_name} ({sponsor_party}-{sponsor_state}).
Status: {status}.
```

Maurice is where the embed quality jumps from "OK retrieval" to "very good retrieval" — wait for it if you can.

### `votes` — sparse but heavy when present

`gov_postgres.votes` empty today; lands with Phase B.3. Shape:

```
politician_id, bill_id, vote ('yea'|'nay'|'present'|'absent'),
timestamp, time_bucket
```

For RAG: do **not** embed individual vote rows. Build derived documents instead — one per (politician, last 90 days) summarizing their vote pattern:

```
{full_name} cast {N} votes in the last 90 days.
Voted YES on: {bill_number}: {title} [+ 5 more]
Voted NO on: {bill_number}: {title} [+ 5 more]
Most contested with: {Senator X} (disagreed 12/47 times).
Most aligned with: {Senator Y} (agreed 41/47 times).
```

That's 600 documents at ~200 tokens each. Powers "what did Senator X vote against last month" and "who votes most like Sanders."

### News + events context

Not in `gov_postgres` directly — lives in our Supabase mirror (`events` table, ~400 rows of gNews + YouTube). If your RAG also pulls news, the cleanest integration is:

```sql
-- Get bills with concurrent news coverage from Supabase
SELECT b.external_id, b.title, b.status, e.headline, e.url, e.timestamp
  FROM bills b
  JOIN events e ON e.related_bill_id = b.id
 WHERE e.timestamp > now() - interval '30 days'
 ORDER BY e.timestamp DESC;
```

Currently `events.related_bill_id` is unpopulated — we'll fix that in a near-term phase (regex-extract bill numbers from headlines, set the FK). Until then, news↔bill cross-referencing is manual.

---

## 3. Tiered hybrid retrieval — recommended pattern

The pattern that scales to 15K+ corpus without burning the embedding budget on every query:

```
USER QUESTION
    │
    ▼
[ stage 1 — STRUCTURED FILTER ]
   Parse hard constraints from the question:
     - explicit IDs (bill numbers, bioguide IDs, member names)
     - filterable attributes (state, party, chamber, date range,
       portal_tag, status, policy_area)
   Run SQL against gov_postgres.bills + politicians.
   Output: ~50–200 candidate IDs.
    │
    ▼
[ stage 2 — VECTOR RETRIEVAL OVER CANDIDATES ]
   Embed the question. Search your vector index — but ONLY over
   the IDs that survived stage 1.
   Output: top-K (typically K=5–10) most semantically relevant.
    │
    ▼
[ stage 3 — DETAIL EXPANSION ]
   For each top-K result, fetch the full row from gov_postgres,
   plus joined sponsor + recent actions. Optionally pull bill_text
   from gov_mongo for the closest 1–2 results if the question
   demands it.
   Output: rich context block, ready for LLM synthesis.
    │
    ▼
LLM SYNTHESIZES ANSWER with citations
```

The key insight: stage 1 is essentially free. Even on 15K rows, a query like
```sql
SELECT external_id FROM bills
 WHERE 'health' = ANY(portal_tag)
   AND status IN ('passed_one_chamber','passed_both_chambers','signed')
   AND last_action_at > now() - interval '90 days'
```
returns in 10ms because of the GIN index on `portal_tag` and the regular B-tree on `status`. You then vector-search 80 candidates instead of 15K.

If the user's question has *no* structural constraints (e.g. "what's interesting today"), stage 1 falls back to `WHERE battlefield_score > 100` or `ORDER BY oracle_synced_at DESC LIMIT 200` — the Battlefield ranking is the prior.

---

## 4. Ingestion topology

Three viable patterns. Listed by complexity.

### (A) Pull, hourly (recommended for v1)

The Political Oracle pulls from `gov_postgres` on a schedule:

```sql
SELECT * FROM bills
 WHERE oracle_synced_at > :last_local_sync
 ORDER BY oracle_synced_at;
```

For each row returned: embed (if new), upsert into your vector store, update `last_local_sync` watermark. Same shape for `politicians`. Cron / launchd job at hourly cadence.

Pros: zero coupling, no infrastructure on our side, your RAG controls its own freshness.
Cons: hourly lag from Oracle → your RAG.

### (B) Push via webhook (future)

We'd add a notification hook on `oracle_synced_at` changes (e.g. via Postgres `LISTEN/NOTIFY`) and post to your RAG's ingest endpoint. Lower lag (~seconds), more coupling.

Not built today. Phase H+ if needed.

### (C) Federated (no ingestion, query-time joins)

Your RAG doesn't ingest at all — it joins our Postgres at query time. Vector store stays small (only your *own* documents). Retrievals join across networks.

Pros: zero staleness, smaller vector index.
Cons: dependence on Oracle availability during every query. Latency adds up.

For most production RAGs, (A) is the right answer.

---

## 5. Caching

Bill text rarely changes after passage. Bill metadata changes more often (status moves, cosponsors accumulate). Three caching tiers worth considering:

- **Long cache (30d)** — `bill_texts` content, plain_english summaries. Invalidate on `update_date_including_text` change.
- **Medium cache (24h)** — politician profiles (their sponsored-bills list, committee memberships).
- **Short cache (1h)** — `latest_action_text`, `cosponsor_count`, `status`. These move daily during active sessions.

If your RAG embeds something, store the source's `update_date_including_text` alongside the embedding. On re-ingest, compare timestamps and skip if unchanged — saves >90% of recurring embedding cost.

---

## 6. Sample queries (run these to validate the connector)

```sql
-- The 50 highest-momentum bills in the active session.
-- These are the prior for "what's interesting today" queries.
SELECT external_id, title, status, cosponsor_count, last_action_at
  FROM bills
 WHERE scope = 'federal' AND session = '119'
 ORDER BY (cosponsor_count
           + CASE status
               WHEN 'signed'              THEN 100
               WHEN 'passed_both_chambers' THEN 60
               WHEN 'passed_one_chamber'   THEN 30
               WHEN 'floor_scheduled'      THEN 15
               ELSE 0 END) DESC
 LIMIT 50;

-- All Maryland senators' sponsored bills.
SELECT b.external_id, b.title, b.status, p.full_name
  FROM bills b
  JOIN politicians p ON p.id = b.sponsor_id
 WHERE p.state_code = 'MD'
   AND p.chamber    = 'senate'
   AND p.scope      = 'federal'
 ORDER BY b.last_action_at DESC NULLS LAST;

-- Bipartisan health bills currently in motion.
SELECT external_id, title, status, cosponsor_count
  FROM bills
 WHERE 'health' = ANY(portal_tag)
   AND bipartisan = TRUE
   AND status IN ('committee','floor_scheduled','passed_one_chamber')
 ORDER BY cosponsor_count DESC
 LIMIT 20;
```

These three queries cover ~80% of what civic Q&A actually asks. Pin them as canned filters in your RAG's tool layer.

---

## 7. Naming / glossary (so the wire-up doesn't get confused)

| Term | What it is |
|---|---|
| **The Oracle** | Our three-tier data stack (Mongo + Postgres + Qdrant) on `10.1.10.4`. |
| **Filter DB** | Tier 2 Postgres `gov_postgres`. Where structured, queryable bill catalog lives. |
| **Raw lake** | Tier 1 Mongo `gov_mongo`. Where every API response is archived untouched. |
| **Filter Feeder** | The *pattern* of "wide ingest to Tier 1 → narrow enrich to Tier 2 → vectorize to Tier 3." NOT a database. |
| **Maurice** | Our offline LLM that writes `plain_english` summaries during Tier 2 enrichment. |
| **Nia** | Our in-house conversational LLM, read-only. Separate from the Political Oracle. |
| **Political Oracle** | Your externally-built RAG. Subject of this doc. |
| **`external_id`** | Stable bill key shape: `"119-HR-1234"`. Use this as the natural key across systems. |
| **`bioguide_id`** | Politician's Library-of-Congress ID. Stable, immutable. Same shape as Congress.gov's. |

---

## 8. What's NOT in the contract yet

Things this doc will need to extend when they ship:

- **`bill_texts`** — full bill body (Phase B.3). Until then, embed metadata only.
- **`plain_english`** — Maurice's summaries (Phase G). Until then, your embed quality will plateau.
- **`bill_vectors` in Qdrant** — our own embedding collection (Phase G). If our model matches yours, we can share; if not, you carry your own.
- **`votes`** — full per-rep vote records (Phase B.3). Powers accountability queries.
- **State coverage** — Maryland MGA first, then more (Phase B.2+). Until then, scope='federal' always.

---

## 9. Hard rules

1. **Read-only.** The Political Oracle never writes back to `gov_postgres` or `gov_mongo`. It can write to its own vector store, its own caches, its own conversation logs — but the WIOG data lake stays one-direction-out.
2. **Cite, don't paraphrase.** Every factual claim the Political Oracle makes should carry a source URL back to Congress.gov (the `url` field on a bill, the WIOG card link) or back to a raw_record_id in our Mongo for traceability.
3. **Refresh on `update_date_including_text`, not on schedule.** Re-embedding a bill whose source timestamp didn't move wastes budget. Pin this watermark in your ingestion loop.
4. **`external_id` is the join key.** Never invent your own bill IDs. Same shape on every system: `"119-HR-1234"`.
5. **The Oracle stays LAN-only.** If the Political Oracle runs off-network, it joins our tailnet — never the reverse (we don't open public ports).

---

*Blacksky LLC — Since 2000.*
*Ubuntu: I am because we are.*
