# Project Context

## What this is
A "Who Is Our Government" web app — a congress/legislator directory with a FastAPI backend and Next.js frontend.

## Architecture
- **Backend**: `backend/main.py` — FastAPI, uses Firestore in production, local JSON files when `USE_LOCAL_DATA=true`
- **Frontend**: `frontend/` — Next.js/React app with TypeScript
- **Local dev**: Run `start.sh` which sets `USE_LOCAL_DATA=true` and uses exported JSON from `backend/local_data/`
- **Production**: Uses Firebase/Firestore for data storage

## Key patterns
- `get_cached_legislators()` and `get_cached_legislator(bioguide_id)` handle both local and Firestore modes — always use these instead of direct `db.collection("legislators")` calls
- Firestore-only features (e.g., YouTube cache) should be guarded with `if db:` checks
- `LOCAL_DATA` dict holds legislators, committees, committee_memberships loaded from JSON at startup

## Recent work (Feb 2026)
- Added full local data mode (`USE_LOCAL_DATA`) so the app runs without Firebase credentials
- Fixed YouTube videos endpoint (`/api/legislators/{bioguide_id}/youtube-videos`) to not crash in local mode (commit `be8b19a`)
- All endpoints now support both Firestore and local JSON modes
- GitHub repo: `ethoz1970/congress-directory`, branch: `main`

## Current state
- All changes committed and pushed to `main` as of commit `be8b19a`
- No pending work or uncommitted changes
