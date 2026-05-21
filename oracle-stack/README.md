# WHOISOURGOV — Oracle Stack

Three-tier data home for the bill-following + legislative-record feature.
This folder is the **staging copy** — files live here for review and
version control on a workstation, then get rsync'd to the actual Oracle
(the Mac mini at LAN `10.1.10.4`) and brought up under Docker Desktop.

The architectural rationale and full schema lives in
`../whoisourgov-oracle-seed.md`. This README is the operations layer.

## What's in here

```
oracle-stack/
├── docker-compose.yml          ← three services: gov_postgres / gov_mongo / gov_qdrant
├── .env.example                ← copy → .env on the Oracle, fill in passwords + keys
├── .gitignore                  ← keeps .env out of any repo
├── README.md                   ← this file
└── docker/
    ├── postgres/init.sql       ← seeds Tier 2 schema + ingestion_sources rows
    ├── mongo/init.js           ← creates Tier 1 collections + indexes
    └── qdrant/config.yaml      ← Tier 3 service config (collections via API)
```

## Cohabitation discipline — read before deploying

The Oracle already hosts two other tenants. **Do not touch their volumes
or containers.** The WIOG stack uses offset ports and prefixed container
names so it slots in cleanly:

| Tenant                 | Containers (DO NOT TOUCH)            | Ports                  |
|------------------------|--------------------------------------|------------------------|
| BST                    | `oracle_postgres` / `oracle_mongo` / `oracle_qdrant` | default      |
| Eternal Ledger / Clock | `clock_postgres` / `clock_mongo` / `clock_qdrant`    | 5433 / 27018 / 6335-6336 |
| **WIOG (this stack)**  | `gov_postgres` / `gov_mongo` / `gov_qdrant`          | **5434 / 27019 / 6337-6338** |

If any of those container names already exist with different services
attached, halt and reconcile before continuing.

## One-time setup on the Oracle

```bash
# 1. From your workstation — push the staged files to the Oracle.
#    Adjust the SSH user/host if 'blind@10.1.10.4' isn't your convention.
rsync -av --delete \
  /path/to/PolySciFi/who-is-our-gov/oracle-stack/ \
  blind@10.1.10.4:/Users/blind/whoisourgov/

# 2. SSH in and finish configuration.
ssh blind@10.1.10.4
cd /Users/blind/whoisourgov

# 3. Copy the env template and paste in real values.
cp .env.example .env
$EDITOR .env       # fill in POSTGRES_PASSWORD, MONGO_PASSWORD, API keys

# 4. Bring the three services up. First boot runs the init scripts
#    automatically (postgres init.sql, mongo init.js) — subsequent
#    boots skip them because the volumes are already populated.
docker compose up -d

# 5. Wait ~30s for healthchecks to settle, then verify.
docker compose ps
```

`docker compose ps` should show all three services as `Up (healthy)`.
If any are restarting, check `docker compose logs <service>` for the
actual error — usually a typo in `.env` or a port clash with an
existing tenant.

## Smoke-test each tier

Run these from inside the Oracle (or proxy them through `docker exec`).

```bash
# Tier 2 — Postgres tables exist and ingestion_sources is seeded.
docker exec gov_postgres psql -U blacksky -d whoisourgov -c "\dt"
docker exec gov_postgres psql -U blacksky -d whoisourgov \
  -c "SELECT source_name, scope, state_code, sync_status FROM ingestion_sources;"

# Tier 1 — Mongo collections exist.
docker exec gov_mongo mongosh \
  -u blacksky -p "$MONGO_PASSWORD" --authenticationDatabase admin \
  --eval "db.getSiblingDB('whoisourgov').getCollectionNames()"

# Tier 3 — Qdrant is live and reporting an empty collection list.
curl -s http://localhost:6337/collections | jq .
```

Expected:
- `\dt` shows 9 tables (politicians, bills, bill_cosponsors, votes,
  events, sentiment, user_interactions, traction_history,
  ingestion_sources) plus `state`.
- `getCollectionNames()` returns the 9 collections from `init.js`.
- Qdrant returns `{ "result": { "collections": [] }, … "status": "ok" }`.

## Connection strings for the API layer

Add these to whichever app reads from the Oracle (e.g. the WIOG API
service that Scrollvate calls). Passwords come from `.env`.

```env
GOV_POSTGRES=postgresql://blacksky:<password>@10.1.10.4:5434/whoisourgov
GOV_MONGO=mongodb://blacksky:<password>@10.1.10.4:27019/whoisourgov?authSource=admin
GOV_QDRANT=http://10.1.10.4:6337
```

## Updating the stack later

The init scripts only run on **first boot** of an empty volume. To apply
schema changes after that, write them as proper migration SQL/JS and run
them against the live container. Don't edit `init.sql` and `docker
compose down -v` — that wipes everything.

```bash
# Apply a one-off schema change against the running Tier 2.
docker exec -i gov_postgres psql -U blacksky -d whoisourgov \
  < migrations/0002_whatever.sql

# Or for Mongo, run a script via mongosh.
docker exec -i gov_mongo mongosh \
  -u blacksky -p "$MONGO_PASSWORD" --authenticationDatabase admin \
  whoisourgov < migrations/0002_whatever.js
```

When the schema settles, we can promote these to a proper
`migrations/` folder mirroring what the Sentiment-vs-Power Supabase
side uses.

## What this stack is NOT yet

- **No ingestion code.** This is just the empty house. The filter
  feeders (LegiScan, Congress.gov, MGA scraper) are the next step.
- **No API layer.** Scrollvate currently talks to Supabase + the old
  Cloud Run WIOG API; rewiring it to read from this Oracle is a
  separate piece of work.
- **No Maurice.** Plain-English summaries and portal-tagging on the
  Tier 2 side come after ingestion is flowing.

Phase 1 = "stack up and verifiable." We're at end-of-Phase-1 when
all three smoke tests pass.
