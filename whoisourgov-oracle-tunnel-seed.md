# WhoIsOurGov ↔ Oracle: Wire WIOG to consume Oracle data via Cloudflare Tunnel

> **Seed doc for a fresh Claude session working in the WhoIsOurGov codebase.**
> Paste this in as the first message. The new thread has zero context — this
> brief tells it what the Oracle is, what's already shipped, and what concrete
> work to do in the WIOG repo.

---

## 0. TL;DR

WhoIsOurGov today reads from its own Postgres + Firebase. Everything its
backend `import_*.py` jobs gather (Congress.gov bills, legislators,
committees, news mentions) is also being mirrored — with enrichment —
into "The Oracle," a private three-tier stack on a Mac mini at the studio.
The Oracle now has **plain-English bill summaries written by Nia for all
15,630 federal bills**, plus 587 federal legislators with Battlefield
momentum scores, plus structured event/news/sentiment tracking that WIOG
doesn't have yet.

**The job:** wire WhoIsOurGov to read from the Oracle via Cloudflare
Tunnel so politician profile pages and bill pages can show Nia
summaries, momentum scores, attention metrics, and cross-portal context
that WIOG's own database doesn't (and shouldn't) compute.

Direction is strictly Oracle → WIOG. WIOG never writes to Oracle.
WIOG's own DB stays the source of truth for user follows, vibes,
and anything user-generated. The Oracle is the source of truth for
*content enrichment*.

---

## 1. Architectural picture

```
┌──────────────────────────────────────────────────────────────────┐
│ The Oracle (Mac mini @ studio, LAN 10.1.10.4)                    │
│                                                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │ BST stack       │  │ Clock stack     │  │ Gov stack       │ │
│  │ (other project) │  │ (other project) │  │ ← WIOG cares    │ │
│  │                 │  │                 │  │   about this    │ │
│  │ postgres        │  │ postgres        │  │                 │ │
│  │ mongo           │  │ mongo           │  │ gov_postgres    │ │
│  │ qdrant          │  │ qdrant          │  │ gov_mongo       │ │
│  └─────────────────┘  └─────────────────┘  │ gov_qdrant      │ │
│                                            └─────────────────┘ │
│                                                                  │
│  FastAPI (port 8765) ← read API for dashboards + WIOG          │
│  Static UI  (port 8766) ← internal observability dashboard      │
│                                                                  │
│                  ▲                                               │
│                  │  Cloudflare Tunnel                            │
│                  ▼                                               │
└──────────────────┼──────────────────────────────────────────────┘
                   │
       ┌───────────┴────────────────────────────────┐
       │                                            │
       ▼                                            ▼
 https://oracle-api.blacksky-chat.us         https://oracle.blacksky-chat.us
 (FastAPI — politicians, bills,              (dashboard HTML for ops, internal use)
  enrichments, traction)
       │
       │ HTTPS GET (server-side from WIOG backend)
       ▼
┌──────────────────────────────────────────────────────────────────┐
│ WhoIsOurGov                                                       │
│  backend/  ← Cloud Run, Python — adds an OracleClient,           │
│              calls oracle-api.blacksky-chat.us, enriches          │
│              the responses it already serves to frontend          │
│  frontend/ ← Next.js — no changes needed for v1; the existing    │
│              legislator/bill pages just receive new fields        │
│  WIOG DB   ← stays the SoT for user follows, profile pics,        │
│              vibes, etc.                                          │
└──────────────────────────────────────────────────────────────────┘
```

**Key principle:** WIOG's backend stays the single hostname its frontend
talks to. The Oracle is a *server-side dependency* — the Next.js app
never calls oracle-api directly. This keeps CORS simple, keeps the
Oracle private-ish (only Cloud Run's IP range needs to be considered for
allowlisting later), and lets WIOG cache Oracle responses.

---

## 2. Current state — what's already shipped

### Oracle side (✅ done — no work needed here for v1)

- **Three Docker stacks** running on the Mac mini. Gov stack ports:
  Postgres `5434`, Mongo `27019`, Qdrant `6337`.
- **15,630 federal bills** in `gov_postgres.bills`, every one with
  `plain_english` + `impact_summary` written by Nia (a local Llama 3.1
  running on the workstation). Stamped with
  `enrichment_version='nia-enrichment-v1'`.
- **587 federal legislators** in `gov_postgres.politicians`, mirrored
  from the Sentiment-vs-Power Supabase `people` table by
  `feeder/sync_politicians.py`. Includes governors (state-scoped) and
  House/Senate (federal-scoped).
- **`bills.sponsor_id`** is a proper FK to `politicians.id` —
  backfilled by `sync_politicians --backfill-only`. Coverage > 90%
  (a few joint resolutions lack a primary sponsor upstream).
- **Cloudflare Tunnel** running as a launchd service, exposing four
  hostnames:
  - `https://oracle-api.blacksky-chat.us` → FastAPI on port 8765
  - `https://oracle.blacksky-chat.us` → static dashboard on 8766
  - `https://oracle-qdrant.blacksky-chat.us` → Qdrant on 6337
  - `https://oracle-pg.blacksky-chat.us` → Postgres TCP on 5434
    (needs `cloudflared access` client — not used in v1)
- **Oracle dashboard** at `oracle.blacksky-chat.us` shows container
  health, record counts, ingestion-source status, and the Nia
  enrichment progress bar. Refreshes every 30s.

### WhoIsOurGov side (✅ current production)

- `backend/main.py` — Cloud Run FastAPI serving the public WIOG API
  (`wiog-api...run.app` or whatever the deploy URL is).
- `backend/import_*.py` — daily/scheduled jobs that hit Congress.gov,
  Firebase, etc. and write to WIOG's own Postgres + Firebase.
- `frontend/app/` — Next.js routes for legislator and bill pages.
- `frontend/lib/` — API client + utilities.

WIOG does NOT yet:
- Show plain-English bill summaries (these live only in Oracle today)
- Show Battlefield momentum scores
- Show traction/attention metrics
- Cross-link bills to news/events from other portals

That's the gap this work closes.

---

## 3. Tunnel endpoints — what's reachable today

```
GET https://oracle-api.blacksky-chat.us/ping
    → {"ok": true, "message": "Oracle is alive."}

GET https://oracle-api.blacksky-chat.us/health
    → container health for all 9 Docker containers across 3 stacks

GET https://oracle-api.blacksky-chat.us/metrics
    → record counts, ingestion sources, system_state, enrichment progress
```

That's the entire current FastAPI surface — three ops endpoints. **The
Oracle has no read endpoints for politicians or bills yet.** You'll add
them as Phase 1 of this work.

The Postgres TCP tunnel (`oracle-pg.blacksky-chat.us:5434`) is wired
but not used in v1 — connecting through it from Cloud Run is awkward
because `cloudflared access` needs a sidecar. Punt on direct Postgres
until v3 if it's ever needed.

Auth on the FastAPI is **none** in v1. Cloudflare Tunnel network scope
is the only gate. We'll add an `X-Oracle-Key` middleware before
opening the API to anything beyond WIOG's Cloud Run egress IPs.

---

## 4. What's in Oracle that WIOG should consume

### `gov_postgres.bills`

Per row (15,630 of them):

| column | what it is | WIOG use |
|---|---|---|
| `external_id` | `'119-HR-1234'` etc — natural key | join key |
| `bill_number` | e.g. `'H.R. 1234'` | display |
| `title` | official title | already has |
| `plain_english` | **Nia-written, ~240 chars** — "this bill does X" | **NEW on bill cards** |
| `impact_summary` | **Nia-written, ~280 chars** — "if it passes..." | **NEW in bill detail** |
| `status` | `introduced` / `passed_house` / `enrolled` / etc | display + filter |
| `last_action` / `last_action_at` | most recent congressional action | display |
| `chamber` | `house` / `senate` | filter |
| `scope` | `federal` (state coming later) | filter |
| `cosponsor_count` | integer | display |
| `bipartisan` | bool | "bipartisan" pill |
| `primary_sponsor_bioguide_id` | links to politicians | join |
| `sponsor_id` | uuid FK → politicians.id | join |
| `portal_tag` | text[] of topic tags | filter / category pages |
| `traction_score` | float (Battlefield momentum) | sort key |

### `gov_postgres.politicians`

Per row (587 of them):

| column | what it is | WIOG use |
|---|---|---|
| `id` | uuid PK | internal |
| `external_id` | `'A000370'` etc — bioguide id | join with WIOG's bioguide_id |
| `name` | full name | display |
| `party` / `state_code` / `chamber` | basics | display |
| `office` | `representative` / `senator` / `governor` | display |
| `age` | computed from birthday | display |
| `media_count_30d` | news mentions in last 30 days | "in the news" badge |
| `phone` / `website` / `contact_form` | contact info | already has |

### Cross-table queries WIOG cares about

- **"bills sponsored by politician X"** —
  `SELECT * FROM bills WHERE sponsor_id = $1 ORDER BY last_action_at DESC`
- **"most active bills this week"** —
  `SELECT * FROM bills ORDER BY traction_score DESC LIMIT 50`
- **"bills by topic"** —
  `SELECT * FROM bills WHERE 'climate' = ANY(portal_tag)`
- **"bipartisan bills with momentum"** —
  `SELECT * FROM bills WHERE bipartisan AND traction_score > 5`

---

## 5. Phased plan

### Phase 1 — Server-side reads (this thread)

Goal: WIOG legislator profile pages show Nia-written plain-English
summaries on the bills they've sponsored.

**Oracle side (one rsync to the Mac mini):**

1. Add a new FastAPI router on the Oracle dashboard for read endpoints.
   File: `oracle-ui/dashboard/api.py` already exists — add to it, don't
   spin up a separate service. Endpoints to add:

   - `GET /politicians/{external_id}` → single politician row
   - `GET /politicians/{external_id}/bills` → bills they sponsored,
     newest first, with `plain_english` + `impact_summary` included
   - `GET /bills/{external_id}` → single bill row with sponsor joined
   - `GET /bills?limit=50&sort=traction&topic=climate&...` → list with
     filters (status, chamber, scope, state_code, topic, bipartisan)
     and sorts (`traction`, `recent`, `cosponsor_count`)
   - `GET /bills/by-sponsor/{bioguide_id}` → alias for the second one,
     in case bioguide is more natural at WIOG callsites than the uuid

2. Add `X-Oracle-Key` middleware. Read key from `.env`. Cloud Run will
   send it on every request.

3. Restart the dashboard service:
   `launchctl unload && launchctl load
    ~/Library/LaunchAgents/com.blacksky.oracle-dashboard.plist`
   then `curl https://oracle-api.blacksky-chat.us/politicians/A000370`
   and confirm it returns a row.

**WIOG side (this is most of the work):**

4. Add `backend/oracle_client.py` — a tiny httpx-based client with one
   class `OracleClient` exposing `get_politician(bioguide_id)`,
   `get_bills_by_sponsor(bioguide_id)`, `get_bill(external_id)`,
   `list_bills(**filters)`. Reads `ORACLE_API_URL` +
   `ORACLE_API_KEY` from env. Use `httpx.AsyncClient` with a 2s
   connect / 5s read timeout. Always wrap in try/except — if Oracle
   is unreachable, return `None` and let the calling endpoint serve
   stale-or-no enrichment rather than failing.

5. In `backend/main.py`, find the legislator-detail route. After it
   loads the WIOG-native legislator record, fan out to
   `oracle_client.get_bills_by_sponsor(legislator.bioguide_id)` and
   merge the results into the response under a new key like
   `recent_bills` or `bills_with_summary`. Keep the WIOG-native
   field names untouched for backwards compat.

6. Add an in-process cache for Oracle responses (e.g. `cachetools.TTLCache`
   with a 10-minute TTL). Oracle data changes on Nia's schedule, not
   real-time, so this is safe and dramatically cuts Cloud Run
   egress + Oracle load.

7. Configure Cloud Run env vars (`ORACLE_API_URL=https://oracle-api.blacksky-chat.us`,
   `ORACLE_API_KEY=<generate one>`). Match the key on Oracle's `.env`.

8. Deploy. Verify by hitting WIOG's legislator endpoint for any rep
   who has sponsored bills, and confirm `recent_bills[].plain_english`
   is populated.

**Frontend side (lightweight):**

9. In `frontend/app/legislator/[bioguide]/page.tsx` (or wherever the
   detail page lives), render the new `recent_bills[]` array. Each
   card shows: bill number, title, **plain_english (under the title,
   smaller font)**, status pill, last action date. Click → open the
   bill detail page if WIOG has one, or a new `/bill/[externalId]`
   route.

10. If a bill detail page exists, surface `impact_summary` prominently
    ("If this passes…" block). Otherwise create one in v2.

### Phase 2 — Bill detail page + cross-portal links (next thread)

- Build `/bill/[externalId]` with full impact summary, cosponsor list,
  traction history (mini-chart), and a "in the news" block pulling
  from Oracle's events table.
- Pull news mentions from the Oracle's `events` table once the events
  sync (Oracle Phase 2) ships.

### Phase 3 — Tailscale + Postgres direct (future)

If WIOG ever needs query patterns the FastAPI doesn't cover (analytics,
ad-hoc joins, large reads), drop a Tailscale node on Cloud Run and
connect WIOG's backend directly to `gov_postgres` over the tailnet.
Faster, fewer hops, but operationally heavier. Don't reach for it until
real query patterns demand it.

---

## 6. Concrete task list for this thread

In order. Stop and ask the user between phases.

1. Read the existing FastAPI dashboard API: `~/sites/oracle-ui/dashboard/api.py`
   to understand the conventions. Don't restructure it — extend it.
2. Draft the new read endpoints on the Oracle side and show the user
   the diff before applying. They'll rsync to the Mac mini and reload
   the launchd service themselves.
3. Draft `backend/oracle_client.py` in the WIOG repo. Show the diff.
4. Wire the legislator endpoint in `backend/main.py` to fan out to the
   Oracle. Show the diff.
5. Walk through the Cloud Run deploy + env var setup.
6. Lightweight frontend touch-up so the new fields render.
7. End-to-end test: pick three legislators (one with lots of bills,
   one obscure, one governor) and verify the WIOG profile page now
   shows Nia summaries.

---

## 7. Open questions to confirm with the user upfront

Before writing any code, ask:

- **What's the WIOG production URL?** (Need this to know what frontend
  proxies are in front of `backend/main.py`.)
- **Is the legislator detail endpoint already structured to accept
  augmentation, or will adding `recent_bills` break the frontend's
  TypeScript types?** (Might need to ship the type change first.)
- **Do you want the Oracle key in Cloud Run env vars, or in Secret
  Manager?** (Recommend Secret Manager; env vars work fine for v1.)
- **Should the legislator response also embed momentum/traction
  metrics, or just the bills?** (Phase 1 can stay narrow if that's
  cleaner.)

Do NOT bypass these — they shape the first PR.

---

## 8. Operational notes for the new Claude

- **Never write to the Oracle.** All WIOG ↔ Oracle traffic is read-only.
  If you find yourself writing a POST/PUT against `oracle-api`, stop.
- **The Oracle's dashboard API has no auth in v1.** You're adding it.
  Don't deploy without the `X-Oracle-Key` middleware — `oracle-api.blacksky-chat.us`
  is on the public internet.
- **WIOG's own DB is unchanged.** Don't migrate WIOG schema for this
  work. The Oracle is additive, not replacement.
- **Cache aggressively.** Oracle data is daily-fresh, not real-time.
  10-min TTL is fine. Cloud Run cold-start + Oracle round-trip is the
  expensive path; cache is the cheap one.
- **If Oracle is down, WIOG should degrade gracefully.** Show the
  legislator page without enrichments, not a 500.

---

## 9. Code-touchpoint inventory

When the new Claude starts work, these are the files most likely to
need edits. Read them first.

**On the Oracle (`~/sites/oracle-ui/dashboard/`):**

- `api.py` — extend with politician/bill read endpoints + auth middleware
- `.env` / `.env.example` — add `ORACLE_API_KEY`
- `requirements.txt` — should already have `psycopg2-binary`, `python-dotenv`

**On WhoIsOurGov:**

- `backend/main.py` — add Oracle fan-out to legislator endpoint
- `backend/oracle_client.py` — NEW FILE
- `backend/requirements.txt` — add `httpx`, `cachetools`
- `backend/.env.example` — document `ORACLE_API_URL`, `ORACLE_API_KEY`
- `frontend/lib/api.ts` (or similar) — update response types
- `frontend/app/legislator/[bioguide]/page.tsx` — render `recent_bills[]`
- `frontend/lib/types.ts` — add `Bill` + `BillSummary` types

---

## 10. Background docs in this repo (for deep context)

If the user has them, read in this order:

1. `whoisourgov-oracle-seed.md` — the original Oracle architecture spec
2. `whoisourgov-political-oracle-connector-seed.md` — the engineering
   contract for downstream consumers of the Oracle
3. `whoisourgov-nia-seed.md` — Nia's role in writing summaries
4. `oracle-stack/migrations/` — current gov_postgres schema (the
   actual `politicians` and `bills` table definitions live here)

If those don't exist in the WIOG repo, the human can copy them over.
They're not strictly required to do Phase 1; the schema columns in
section 4 above are what you need.

---

**End of seed.** Acknowledge once you've read it, then ask the four
"open questions" from section 7 before doing anything else.
