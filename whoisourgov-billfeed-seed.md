# WHOISOURGOV — Bill Following + Scrollvate Integration Seed

**Project context:** This seed documents the bill following feature and its connection to the Scrollvate civic feed. It sits on top of the `whoisourgov` Oracle stack (see `whoisourgov-oracle-seed.md`) and defines the product logic, data flows, API surface, and feed mechanics that connect raw legislative data to the consumer-facing scroll experience.

**Philosophy:** Bills are content. Congress is the publisher. The people are the audience. Scrollvate is the delivery mechanism. The dopamine loop that social media built to sell ads is redirected toward civic accountability. This is the Culture Jam applied to legislative data.

---

## The Two Surfaces

This feature connects two surfaces that already exist:

| Surface | What it is | What bills add |
|---|---|---|
| **WhoIsOurGov** | Civic member directory — 537 federal members + 50 governors | Every bill becomes an event on a member's card. Votes become their public record. |
| **Scrollvate** | Civic doom scroll — phone-framed feed of 12 portal buckets | Bills replace generic events as the content unit. Every card is real legislation. |

Both surfaces read from the same spine — the `whoisourgov` Oracle stack. Bills are the content upgrade that makes both surfaces essential.

---

## The 12 Scrollvate Portals (Bill Buckets)

Every bill ingested through Filter Feeder Mode gets tagged to one or more of the 12 civic portals. These are the top-level navigation buckets in Scrollvate. Portal tags are stored as `portal_tag text[]` on the `bills` table (GIN indexed).

| Portal | Scope | Example bill types |
|---|---|---|
| Economy | Federal + State | Tax, budget, trade, labor, minimum wage |
| Health | Federal + State | Healthcare, insurance, mental health, drug policy |
| Education | Federal + State | School funding, student loans, curriculum |
| Housing | Federal + State | Rent, zoning, homelessness, affordable housing |
| Criminal Justice | Federal + State | Policing, sentencing, prison reform, civil rights |
| Environment | Federal + State | Climate, energy, land use, water |
| Immigration | Federal | Visa, asylum, border, citizenship |
| Defense | Federal | Military, veterans, national security |
| Civil Rights | Federal + State | Voting rights, equality, discrimination |
| Technology | Federal + State | Privacy, AI regulation, broadband |
| Transportation | Federal + State | Infrastructure, transit, roads |
| Government | Federal + State | Ethics, elections, redistricting, spending |

**Tagging logic:** Maurice handles portal classification during Tier 2 enrichment. A bill can carry multiple portal tags. The primary tag drives feed placement; secondary tags enable cross-portal discovery.

---

## Bill Lifecycle States

Every bill moves through a defined lifecycle. Status is tracked on the `bills` table and drives feed behavior in Scrollvate.

```
introduced
    ↓
committee
    ↓
floor_scheduled
    ↓
passed_one_chamber
    ↓
passed_both_chambers
    ↓
enrolled          ← sent to Governor (state) or President (federal)
    ↓
signed            ← becomes law
vetoed            ← returned, may be overridden
dead              ← no action, session ended, or failed vote
```

**Scrollvate feed behavior by status:**
- `introduced` — enters feed at base traction score
- `committee` — small traction bump, watch signal
- `floor_scheduled` — notification trigger for followers
- `passed_one_chamber` — significant traction bump, surfaces in Trending
- `passed_both_chambers` — major event, push notification to all followers
- `enrolled` — countdown signal (Governor/President has 10 days typically)
- `signed` — viral moment, receipt delivered to all who followed or liked
- `vetoed` — viral moment, member accountability trigger
- `dead` — archived, removed from active feed, accessible in All Bills

---

## Traction Score — Composite Algorithm v1.0

Traction is what makes bills rise in the Scrollvate feed. It is not editorial — it is mathematical, built from public record and user behavior.

**Inputs (weighted):**

| Signal | Weight | Source |
|---|---|---|
| Co-sponsor count | High | LegiScan / Congress.gov |
| Co-sponsor velocity (added in last 7 days) | High | LegiScan delta |
| Bipartisan co-sponsors | High | Computed from cosponsor party data |
| Committee action (hearing scheduled, markup) | Medium | LegiScan status |
| Chamber passage | High | LegiScan status |
| User follow count | High | `user_interactions` table |
| User like count | Medium | `user_interactions` table |
| User share count | High | `user_interactions` table |
| Media mentions (last 30 days) | Medium | `events` table |
| Racial Equity flag | Informational signal | MGA / state source |

**Computed fields:**
- `traction_score` — current composite, lives on `bills` table
- `traction_history` — hourly snapshots, powers momentum/velocity visualization
- Velocity = delta between last two `traction_history` snapshots — a bill gaining fast surfaces above a bill with a higher static score

**The social feedback loop:**
User engagement ON bills feeds back INTO traction scoring. Citizen activity and congressional activity are both inputs. No other civic platform has this. That is the moat.

---

## Bill Card — Content Unit for Scrollvate

Every bill surfaces in Scrollvate as a card. The card is the atomic content unit — designed to be scanned in 3 seconds, shared in one tap, and followed without friction.

**Card anatomy:**

```
┌─────────────────────────────────────┐
│  [Portal tag]          [Status badge]│
│                                     │
│  BILL NUMBER — Short title          │
│                                     │
│  Plain English summary              │
│  (Maurice-generated, 1-2 sentences) │
│                                     │
│  Sponsored by [Member card link]    │
│  [Party] · [State/District]         │
│                                     │
│  [Traction indicator / momentum bar]│
│                                     │
│  ♥ Like    ★ Follow    ↗ Share      │
│                                     │
│  Co-sponsors: 12  ·  Bipartisan ✓   │
└─────────────────────────────────────┘
```

**Design notes for Ebon:**
- Status badge color-coded by lifecycle stage (active / at risk / law / dead)
- Traction indicator is a momentum bar, not a number — shows velocity not just volume
- Bipartisan flag is prominent — it is a trust signal for civilian users
- Racial Equity flag surfaces when present — aligned with Blacksky's DNA
- Card is shareable as a standalone image — the civic screenshot moment

---

## Member Card — Legislative Record Layer

The bill feature extends the existing member card with a legislative record section. Members are not profiles. They are actors. Bills are the stage.

**New sections added to member card:**

```
SPONSORED BILLS
Bills this member introduced this session.
Sorted by traction score. Tap to follow.

VOTING RECORD
Recent votes on followed and trending bills.
Yea / Nay / Present / Absent.
Consistency score vs. stated positions (future phase).

ACCOUNTABILITY FEED
Every vote this member cast on a bill
you liked or followed — delivered automatically.
The user does not have to go looking.
The platform brings the receipt.
```

**The governor connection:**
Governors appear on the enrolled and signed/vetoed events for every state bill. Governor Moore's card becomes the terminus of every Maryland bill that reaches his desk. Follow a Maryland bill → automatically notified when Moore signs or vetoes it. Federal bills connect to the President the same way.

---

## Follow Model — Notification Architecture

Following a bill is a subscription to its lifecycle. The notification cadence is user-controlled.

**Follow actions:**
- `follow` — subscribe to all status changes
- `like` — express support, feeds traction, no notifications
- `share` — distribute to external platforms, feeds traction

**Notification triggers (by priority):**
1. Bill you follow passes a chamber — push notification
2. Bill you follow is enrolled (headed to Governor/President) — push notification
3. Bill you follow is signed or vetoed — push notification
4. Bill you follow is scheduled for floor vote — push notification
5. Member you follow sponsors a new bill — in-feed notification
6. Bill you follow has been inactive for 90 days — dead signal digest

**Notification cadence options:**
- Real-time — every trigger immediately
- Daily digest — all triggers bundled once per day
- Weekly digest — all triggers bundled once per week

**The accountability moment:**
User follows a bill → bill comes to a vote → member votes against it → user gets the receipt. Automatic. No research required. This is the core civic value proposition.

---

## Scrollvate Feed Architecture

The feed is the product. Five top-level buckets. Infinite scroll within each. No pagination.

**Top-level navigation (5 buckets, one thumb):**

| Bucket | What's in it | Sort default |
|---|---|---|
| 🔥 Trending | Highest traction velocity right now | Velocity DESC |
| ⚡ Active | Legislative movement in last 30 days | last_action_at DESC |
| ★ Following | Bills and members user has followed | last_action_at DESC |
| 📋 All Bills | Full 15-20K, searchable | introduced_at DESC |
| 💀 Dead | Session graveyard | traction_score DESC |

**Within each bucket — secondary filters (stackable):**
- Portal (12 civic categories)
- Chamber (House / Senate)
- Scope (Federal / State — MD first)
- Sponsor party (Democrat / Republican / Independent)
- Bipartisan only (toggle)
- Racial Equity flagged (toggle)
- District / state proximity (geo-aware, future phase)

**Search:**
Always visible. Searches by bill number, keyword, sponsor name, or topic. Returns results across all buckets. Search is the power user path; the feed is the civilian path.

**Feed ranking logic:**
```
Base score = traction_score
Velocity bonus = delta traction last 24h × 1.5
Follower affinity = user has followed sponsor × 1.3
Portal match = user's most-engaged portals × 1.2
Recency decay = exponential decay over 30 days for dead bills
```

---

## Filter Feeder → Scrollvate Data Flow

```
LegiScan API / Congress.gov / MGA Maryland
            ↓
    [Tier 1 — MongoDB]
    Raw bill lands in bills collection
    Full text in bill_texts collection
    Ingestion logged in ingestion_log
            ↓
    [Tier 2 — PostgreSQL enrichment pipeline]
    Maurice generates plain_english summary
    Portal tags assigned (12 civic portals)
    Sponsor linked to politicians table
    Cosponsors written to bill_cosponsors
    Bipartisan flag computed
    Racial Equity flag read from source
    Traction score initialized
    Traction snapshot written to traction_history
            ↓
    [Tier 3 — Qdrant]
    plain_english embedded → bill_vectors
    Ready for semantic search and feed ranking
            ↓
    [WhoIsOurGov API layer]
    Bill card served to Scrollvate feed
    Member card updated with sponsored bill
    Portal bucket updated
    Trending recalculated
            ↓
    [Scrollvate consumer surface]
    Bill card appears in feed
    User likes / follows / shares
    Interaction written to user_interactions
    Traction score updated
    Traction snapshot written
    Feed re-ranks in real time
```

---

## Maurice's Role — Tier 2 Enrichment

Maurice processes every bill as it moves from Tier 1 to Tier 2. His job in this pipeline:

**Per bill prompt contract:**
```
Input:
- bill_number
- title
- full_text (from bill_texts collection)
- status
- sponsor name and party
- cosponsor count
- state_code / scope

Output (JSON):
- plain_english: string (1-2 sentences, civilian-readable, no jargon)
- portal_tags: string[] (from the 12 portal list)
- impact_summary: string (who does this affect and how)
- bipartisan_note: string | null (only if bipartisan, what parties aligned)
```

**Quality bar:** A 17-year-old with no civics background should be able to read plain_english and understand what this bill does and why it matters.

---

## Maryland Expansion (Phase 2)

Same infrastructure. Different ingestion source. No schema changes.

**What changes:**
- `ingestion_sources` row for `mga_maryland` flips to `active`
- `scope = 'state'`, `state_code = 'MD'` on all Maryland bills and politicians
- `session = '2026RS'` for current session
- `racial_equity_flag` becomes a first-class traction signal for Maryland bills (MGA already tags these)
- Governor Moore's existing card becomes the terminus for all enrolled Maryland bills

**What stays the same:**
- Three-tier Oracle architecture
- Filter Feeder Mode
- Traction algorithm
- Scrollvate feed mechanics
- Bill card design
- User interaction model

**Why Maryland first:**
- 188 members vs 537 — manageable validation set
- Active founding community already in place
- MGA session data available and well-structured
- Governor Moore already in WhoIsOurGov
- Local bills are more immediately tangible to everyday people
- Local civic tech is a press story — Maryland Matters, Baltimore Sun, WTOP
- Proves the model before the nationwide flip

---

## Expansion Path

| Phase | Scope | Bills | Members | Notes |
|---|---|---|---|---|
| 1 | Federal | ~15-20K | 537 | 119th Congress, existing dataset |
| 2 | Maryland | ~2-3K/session | 188 | Founding community validation |
| 3 | Next state | TBD | TBD | Based on user growth signals |
| 4 | Supreme Court | Cases as bills analog | 9 Justices | Opinions = content, dissents = votes |
| 5 | All 50 states | ~200K+ total | ~7,400+ | Filter Feeder opens fully |

---

## The Civic Social Network Statement

Bills go viral. Members get verdicts.

WhoIsOurGov is not a civic tracker. It is the social layer that Congress never had. The gap between what government does and what the public knows has always been the problem. Scrollvate closes it with the same mechanics people already use every day.

Users will not feel like they are doing civic duty. They will feel like they are scrolling. The education is invisible. The accountability is automatic.

This is Culture Jam applied to legislative data. Kalle Lasn identified the problem — media as hypnosis. Scrollvate is the tactical response — same delivery mechanism, completely different payload.

---

*Blacksky LLC — Since 2000.*
*Ubuntu: I am because we are.*
*Blacksky Media × Stereotype (Ebon Heath)*
