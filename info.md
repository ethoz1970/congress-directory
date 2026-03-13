# WhoIsOurGov — Project Documentation

## Overview

WhoIsOurGov is a full-stack web application for exploring members of the U.S. Congress and state governors. It features advanced filtering, sorting, favorites, detailed member profiles, news mentions, YouTube videos, committee assignments, and shareable trading cards.

- **Frontend:** Next.js 14 (TypeScript) hosted on Vercel
- **Backend:** FastAPI (Python) hosted on Google Cloud Run
- **Database:** Google Firestore (NoSQL)
- **Authentication:** Firebase Auth (Google Sign-in)
- **Domain:** [whoisourgov.com](https://whoisourgov.com)

---

## Project Structure

```
who-is-our-gov/
├── frontend/                        # Next.js 14 application
│   ├── app/
│   │   ├── page.tsx                 # Main directory grid (primary UI)
│   │   ├── layout.tsx               # Root layout with AuthProvider & GA
│   │   ├── admin/page.tsx           # Admin dashboard
│   │   ├── card/[bioguide_id]/page.tsx  # Shareable trading card page
│   │   ├── profile/page.tsx         # User profile with favorites
│   │   └── components/
│   │       ├── SlideOutPanel.tsx     # Member detail slide-out panel
│   │       ├── UserMenu.tsx         # Auth & favorites dropdown
│   │       └── GoogleAnalytics.tsx  # GA4 tracker
│   ├── lib/
│   │   ├── api.ts                   # Fetch wrapper with API_URL
│   │   ├── AuthContext.tsx          # Firebase auth context
│   │   ├── firebase.ts             # Firebase config & init
│   │   └── useFavorites.ts         # Custom hook for favorites
│   ├── public/
│   │   ├── legislators/            # ~451 legislator photos (JPG)
│   │   └── governors/              # ~52 governor photos (JPG)
│   ├── package.json
│   └── tsconfig.json
│
├── backend/                         # FastAPI Python application
│   ├── main.py                      # API endpoints (846 lines)
│   ├── requirements.txt
│   ├── Dockerfile                   # Container image for Cloud Run
│   ├── Procfile                     # Process definition
│   ├── firebase-credentials.json    # Firebase service account (not in git)
│   ├── import_legislators.py        # Import from @unitedstates project
│   ├── import_ideology.py           # Import VoteView ideology scores
│   ├── import_legislation.py        # Import Congress.gov bill counts
│   ├── import_news_mentions.py      # GNews API news imports
│   ├── import_committees.py         # Committee assignment imports
│   ├── import_governors.py          # Import state governors
│   ├── download_legislator_images.py
│   ├── download_governor_images.py
│   ├── governors-current.json       # Governor data
│   └── jobs/
│       └── news-import/             # Cloud Run Job for scheduled news
│           ├── main.py
│           ├── Dockerfile
│           ├── requirements.txt
│           └── setup.sh
│
└── info.md                          # This file
```

---

## Local Development Setup

### Prerequisites

- **Node.js** 18+
- **Python** 3.11+
- **Firebase credentials** (`firebase-credentials.json` in `backend/`)
- **API keys:** Congress.gov, GNews (optional), YouTube (optional)

### Frontend

```bash
cd frontend
npm install

# Create environment file
echo "NEXT_PUBLIC_API_URL=http://localhost:8002" > .env.local

# Start dev server
npm run dev
```

Frontend runs at **http://localhost:3000**

### Backend

```bash
cd backend

# Create and activate virtual environment
python -m venv venv
source venv/bin/activate        # macOS/Linux
# venv\Scripts\activate          # Windows

# Install dependencies
pip install -r requirements.txt

# Place firebase-credentials.json in this directory

# Start dev server
uvicorn main:app --reload --host 0.0.0.0 --port 8002
```

Backend runs at **http://localhost:8002**

### Populating the Database

Run these import scripts (in order) to populate Firestore:

```bash
cd backend
source venv/bin/activate

# 1. Import all current legislators (required)
python import_legislators.py

# 2. Import ideology/leadership scores
python import_ideology.py --congress 118

# 3. Import committee assignments
python import_committees.py

# 4. Import legislation counts (optional, requires CONGRESS_API_KEY)
python import_legislation.py

# 5. Import news mentions (optional, requires GNEWS_API_KEY)
python import_news_mentions.py --api-key YOUR_GNEWS_KEY

# 6. Import governors
python import_governors.py
```

---

## Frontend Details

### Tech Stack

- **Framework:** Next.js 14 (App Router)
- **Language:** TypeScript 5
- **Styling:** Tailwind CSS 4
- **Auth:** Firebase Auth (Google Sign-in)
- **Analytics:** Google Analytics 4

### Dependencies

```json
{
  "dependencies": {
    "firebase": "^12.7.0",
    "next": "16.1.0",
    "react": "19.2.3",
    "react-dom": "19.2.3"
  }
}
```

### Pages

| Page | Path | Description |
|------|------|-------------|
| Main Directory | `/` | Grid of all legislators with filtering, sorting, search, hero slideshow, and "Find Your Rep" |
| Profile | `/profile` | Authenticated user's favorites, stats, latest videos, and news from favorites |
| Trading Card | `/card/[bioguide_id]` | Shareable public card for a single member (with Open Graph meta) |
| Admin | `/admin` | Admin dashboard showing all users, stats, and favorites counts |

### Key Features

- **Grid layout** with adjustable columns (1–5)
- **Filtering** by chamber, party, state, gender, bills enacted, news mentions, years in congress
- **Sorting** by bills enacted, news mentions, ideology, terms, years, age, state, name
- **Weighted OR search** across name, party, state
- **Hero slideshow** with 3 rotating slides
- **"Find Your Rep"** by zip code (returns 2 senators + 1 representative)
- **Favorites** (requires sign-in) with real-time Firestore sync
- **Slide-out panel** with full member details, committees, YouTube videos, news
- **Visual card indicators:**
  - Party color triangle (upper right) — Red/Blue/Purple
  - News mentions triangle (upper left) — Yellow-to-red heat scale
  - Bills enacted triangle (lower right) — Green shades
  - Ideology badge (lower left) — Blue/Purple/Red
- **Mobile responsive** (triangles 50% smaller, stacked layouts)

### State Management

- **AuthContext** (`lib/AuthContext.tsx`) — Firebase auth state, Google sign-in/out
- **useFavorites** (`lib/useFavorites.ts`) — Real-time Firestore favorites with `onSnapshot`
- **API wrapper** (`lib/api.ts`) — Centralized fetch with `NEXT_PUBLIC_API_URL`

### Admin Access

Admin emails are hardcoded in `frontend/app/admin/page.tsx` and `frontend/app/components/UserMenu.tsx`:
- `marioguzman1970@gmail.com`
- `blackskymedia@gmail.com`

---

## Backend Details

### Tech Stack

- **Framework:** FastAPI (Python)
- **Server:** Uvicorn (ASGI)
- **Database:** Google Firestore
- **Hosting:** Google Cloud Run
- **Container:** Docker (python:3.11-slim)

### Dependencies

```
fastapi
uvicorn
firebase-admin
httpx
python-dotenv
gunicorn
```

### API Endpoints

#### Legislators
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/legislators` | All legislators (cached 24hrs, filterable by state/party/chamber) |
| GET | `/api/legislators/{bioguide_id}` | Single legislator by ID |
| GET | `/api/legislators/state/{state}` | Legislators by state |
| GET | `/api/stats` | Breakdown by chamber, party, gender, state |

#### Committees
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/committees` | All committees |
| GET | `/api/committees/{committee_id}` | Single committee |
| GET | `/api/committees/{committee_id}/members` | Committee members |
| GET | `/api/legislators/{bioguide_id}/committees` | Legislator's committee assignments |

#### Legislation
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/legislators/{bioguide_id}/sponsored-legislation` | Sponsored bills (Congress.gov) |
| GET | `/api/legislators/{bioguide_id}/cosponsored-legislation` | Cosponsored bills |
| GET | `/api/legislators/{bioguide_id}/legislation-summary` | Cached counts |
| POST | `/api/cache/refresh-legislation` | Refresh legislation cache |

#### YouTube
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/legislators/{bioguide_id}/youtube-videos` | Recent videos (cached 24hrs) |

#### Utility
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/find-rep?zip={zipcode}` | Find representatives by zip code |
| GET | `/api/cache/status` | Cache status and expiry |
| POST | `/api/cache/clear` | Clear all in-memory cache |
| GET | `/api/hello` | Health check |

### Caching Strategy

- **In-memory cache:** 24 hours for all legislators and individual lookups
- **Firestore cache collections:** `legislation_cache`, `youtube_cache` (24 hours each)
- **Clear cache:** `POST /api/cache/clear` or redeploy the service

### External API Integrations

| API | Purpose | Key Location |
|-----|---------|-------------|
| Congress.gov | Legislation data, bill counts | `CONGRESS_API_KEY` env var |
| GNews | News mention counts & headlines | Google Secret Manager |
| YouTube Data API v3 | Member YouTube videos | Google Secret Manager |
| whoismyrepresentative.com | Zip code → representatives | No key required |

---

## Database Schema (Firestore)

### `legislators` collection
Document ID: `{bioguide_id}` (e.g., `P000197`)

Key fields: `bioguide_id`, `full_name`, `first_name`, `last_name`, `party`, `state`, `chamber`, `district`, `senate_class`, `term_start`, `term_end`, `birthday`, `gender`, `phone`, `office`, `website`, `contact_form`, `ideology_score`, `leadership_score`, `sponsored_count`, `cosponsored_count`, `enacted_count`, `news_mentions`, `news_sample_headlines`, `photo_url`, `external_ids` (thomas, govtrack, opensecrets, twitter, youtube, facebook, etc.)

### `users` collection
Document ID: `{firebase_uid}`

Fields: `uid`, `email`, `displayName`, `photoURL`, `createdAt`, `lastLogin`

### `favorites` collection
Document ID: `{user_uid}_{bioguide_id}`

Fields: `userId`, `bioguide_id`, `createdAt`

### `committees` collection
Document ID: `{thomas_id}`

Fields: `thomas_id`, `name`, `type`, `chamber`

### `committee_memberships` collection
Document ID: `{bioguide_id}`

Fields: `bioguide_id`, `committees[]`, `subcommittees[]`

### `legislation_cache` collection
Document ID: `{bioguide_id}`

Fields: `sponsored_count`, `cosponsored_count`, `enacted_count`, `recent_sponsored[]`, `recent_enacted[]`, `cached_at`

### `youtube_cache` collection
Document ID: `{bioguide_id}`

Fields: `videos[]`, `cached_at`

---

## Import Scripts

| Script | Purpose | Usage |
|--------|---------|-------|
| `import_legislators.py` | Import/update legislators from @unitedstates project | `python import_legislators.py [--clear]` |
| `import_ideology.py` | Import ideology & leadership scores from GovTrack | `python import_ideology.py [--congress 118]` |
| `import_legislation.py` | Fetch bill counts from Congress.gov | `python import_legislation.py [--force] [--limit N] [--delay S]` |
| `import_news_mentions.py` | Update news mentions from GNews | `python import_news_mentions.py --api-key KEY [--limit 100] [--days 30]` |
| `import_committees.py` | Import committee assignments | `python import_committees.py` |
| `import_governors.py` | Import state governors | `python import_governors.py` |
| `download_legislator_images.py` | Download legislator photos | `python download_legislator_images.py` |
| `download_governor_images.py` | Download governor photos | `python download_governor_images.py` |

---

## Scheduled Jobs

### News Import (Cloud Run Job)

- **Schedule:** Daily at 6:00 AM Eastern
- **Purpose:** Import news mentions for ~100 legislators per run
- **Cycle:** Covers all ~541 members over ~6 days
- **Location:** `backend/jobs/news-import/`

```bash
# Deploy
gcloud run jobs deploy news-import-job --source . --region=us-central1

# Manual run
gcloud run jobs execute news-import-job --region=us-central1

# View logs
gcloud run jobs logs news-import-job --region=us-central1
```

---

## Deployment

### Frontend (Vercel)

- Automatic deploy on push to `main` branch
- GitHub integration configured
- Environment variable: `NEXT_PUBLIC_API_URL` set in Vercel dashboard

```bash
# Build
npm run build

# Preview locally
npm start
```

### Backend (Google Cloud Run)

```bash
cd backend
gcloud run deploy congress-api --source . --region=us-central1
```

- **Container:** Docker with `python:3.11-slim`
- **Port:** 8080
- **Health check:** `GET /api/hello`

### Environment Variables

#### Frontend (`.env.local` or Vercel dashboard)
```
NEXT_PUBLIC_API_URL=https://congress-api-370988201370.us-central1.run.app
```

#### Backend (Cloud Run environment)
```
GOOGLE_CLOUD_PROJECT=congress-api-441519
CONGRESS_API_KEY=<your-key>
YOUTUBE_API_KEY=<stored in Secret Manager>
GNEWS_API_KEY=<stored in Secret Manager>
```

---

## Firebase Configuration

- **Project ID:** ethoz1970
- **Auth Domain:** ethoz1970.firebaseapp.com
- **Storage Bucket:** ethoz1970.firebasestorage.app

---

## Data Flow

```
 User Browser
      │
      ▼
 Frontend (Vercel / Next.js)
      │
      ├── Firebase Auth (Google Sign-in)
      │         │
      │         ▼
      │   Firestore (users, favorites)
      │
      ├── API calls ──────────────────────────┐
      │                                        ▼
      │                              Backend API (Cloud Run / FastAPI)
      │                                        │
      │                              ┌─────────┼─────────┐
      │                              ▼         ▼         ▼
      │                         In-Memory   Firestore  External APIs
      │                          Cache     (legislators, (Congress.gov,
      │                         (24hrs)    committees,   GNews, YouTube,
      │                                    caches)       whoismyrep)
      │
      └── Static assets (legislator/governor photos from /public)
```

---

## Quick Reference

| What | Where |
|------|-------|
| Live site | https://whoisourgov.com |
| Backend API | https://congress-api-370988201370.us-central1.run.app |
| Frontend dev | `cd frontend && npm run dev` → localhost:3000 |
| Backend dev | `cd backend && uvicorn main:app --reload --port 8002` → localhost:8002 |
| Firebase console | https://console.firebase.google.com/project/ethoz1970 |
| Cloud Run console | Google Cloud Console → Cloud Run |
| GitHub repo | https://github.com/ethoz1970/congress-directory |
