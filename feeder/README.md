# WHOISOURGOV — Filter Feeder

Tier 1 ingestion: pulls bills from external APIs (Congress.gov first,
LegiScan and the Maryland MGA scraper later) and writes them into
`gov_mongo` on the Oracle. Tier 2 enrichment and the bridge to Supabase
are separate jobs, downstream of this.

This folder is the **staging copy** — code lives here on the workstation
for dev and version control. Once a feeder stabilizes, we either:
- run it scheduled directly from the workstation (cron / launchd on the
  workstation, with the Oracle reachable over LAN), OR
- rsync it to the Oracle and schedule it there.

## Layout

```
feeder/
├── README.md
├── requirements.txt          ← pymongo + psycopg
├── .env.example              ← copy → .env, fill in API keys + Oracle creds
├── .gitignore                ← keeps .env out of git
└── feeder/                   ← Python package
    ├── __init__.py
    ├── client.py             ← env loader + Mongo/Postgres connection helpers
    ├── http.py               ← stdlib urllib wrapper with retry + backoff
    └── congress_gov.py       ← Phase B.1: list-endpoint pull → gov_mongo
```

## One-time setup

```bash
# From this folder:
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Configure credentials.
cp .env.example .env
$EDITOR .env
# Fill in:
#   CONGRESS_GOV_API_KEY  ← from https://api.congress.gov/sign-up
#   MONGO_PASSWORD        ← same value you set in /Users/blind/whoisourgov/.env
#   POSTGRES_PASSWORD     ← same value you set on the Oracle
```

## Smoke-test connectivity first

Before running an actual pull, verify the workstation can reach the
Oracle on both ports:

```bash
python -m feeder.client
```

Expected:
```
→ MONGO  : 10.1.10.4:27019/whoisourgov
  ✓ ping ok — 9 collection(s): [...]
→ POSTG  : 10.1.10.4:5434/whoisourgov
  · congress_gov     pending
  · legiscan_federal pending
  · mga_maryland     pending
→ KEYS   : congress.gov=set  legiscan=unset
```

If Mongo or Postgres errors out, the most common causes are:
- Wrong password in `.env` (must match the Oracle's `.env` exactly).
- The Mac mini's firewall blocking 5434/27019 — open System Settings →
  Network → Firewall → allow `Docker.app`.
- The Oracle is on a different network — confirm `ping 10.1.10.4` works.

## Phase B.1 — first pull

Start with a single page (250 bills) to verify the path end-to-end:

```bash
python -m feeder.congress_gov --max-pages 1
```

Expected output:
```
→ run a4b9c1d2  congress=119  from_date=all
  · page  1  offset=    0  bills= 250  total=9123
→ done. status=ok {'pages': 1, 'bills_inserted': 250, 'bills_updated': 0, 'bills_seen': 250, 'errors': 0}
```

Then verify the data landed:

```bash
# Workstation → Oracle Mongo
python - <<'EOF'
from feeder.client import mongo_db
db = mongo_db()
print("bills count :", db.bills.count_documents({}))
print("records count:", db.records.count_documents({}))
print("\nlatest bill :")
b = db.bills.find().sort("last_seen_at", -1).limit(1).next()
for k in ("external_id", "title", "latest_action_date", "latest_action_text", "human_url"):
    print(f"  {k:<22s} {b.get(k)}")
EOF
```

If that looks right, run the full pull:

```bash
python -m feeder.congress_gov
```

The full 119th Congress is ~9K bills across ~40 pages and takes about
two minutes (well under Congress.gov's 5000 req/hr limit).

## Daily delta — re-running

The script is idempotent. Rerunning it does a full re-pull and upserts
everything; `bills_updated` will be high but `bills_inserted` will be
near zero. To do an incremental pull, pass `--from-date`:

```bash
python -m feeder.congress_gov --from-date 2026-05-10T00:00:00Z
```

That returns only bills updated since the timestamp — typically 100–500
on a normal weekday.

## Phase B.2 — per-bill detail

`feeder/congress_gov_detail.py` walks `gov_mongo.bills` for entries that
need their detail refreshed and hits `/v3/bill/{congress}/{type}/{number}`
for each. The detail endpoint adds:

- `introduced_date`
- `sponsors[]` — full objects with `bioguide_id`, party, state, district
- `primary_sponsor_bioguide_id` (convenience scalar — first sponsor)
- `policy_area` (e.g. "Taxation", "Health")
- Counts + URLs for sub-resources (actions, cosponsors, committees,
  subjects, summaries, text versions, titles) — B.3 walks the URLs

Staleness query: a bill needs detail when `detail_fetched_at` is null OR
when `update_date_including_text` (set by B.1 on each list-endpoint
pull) differs from `detail_update_date_including_text` (captured at
last detail fetch). So B.1 + B.2 together act as a clean change feed
— re-running B.2 after B.1 only pays the per-bill cost for bills that
actually moved.

Rate budget: default pacing is 0.8s/call = ~4,500/hour, well under the
5,000/hour Congress.gov limit. A first-time backfill of all ~15,600
bills takes ~3.5 hours — use `--max N` to chunk it across sessions.

```bash
# Smoke test (5 bills, ~5 seconds).
python -m feeder.congress_gov_detail --max 5

# A reasonable chunk for one sitting (~15 minutes).
python -m feeder.congress_gov_detail --max 1000

# Full first backfill — go grab dinner, expect ~3.5h.
python -m feeder.congress_gov_detail

# Subsequent daily runs only touch the bills that changed.
python -m feeder.congress_gov_detail

# Force a complete refetch (rare — useful after a parser bump).
python -m feeder.congress_gov_detail --refresh-all
```

After a smoke run, peek at one bill's enriched shape:

```bash
python - <<'EOF'
from feeder.client import mongo_db
db = mongo_db()
b = db.bills.find_one({"detail_fetched_at": {"$ne": None}})
for k in ("external_id", "title", "introduced_date", "policy_area",
         "primary_sponsor_bioguide_id", "actions_count", "cosponsors_count",
         "committees_count", "subjects_count", "summaries_count"):
    print(f"  {k:<32s} {b.get(k)}")
print(f"  sponsors[0]                      {b['sponsors'][0] if b.get('sponsors') else None}")
EOF
```

## What's NOT in this feeder yet

- **Actions, cosponsors, votes, text.** Separate sub-endpoints, separate
  feeder modules. Phase B.3.
- **State coverage.** No LegiScan, no MGA scraper. Phase B.2+ (after
  Maryland comes online).
- **Scheduled runs.** Right now this is hand-run. Once it's stable,
  schedule it via cron / launchd.
- **Tier 2 enrichment.** Mongo → Postgres normalization is the next
  phase (C) — not this feeder's job.
