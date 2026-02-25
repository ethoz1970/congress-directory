import os
import json
import httpx
from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
import firebase_admin
from firebase_admin import credentials, firestore
from typing import Optional, List
from datetime import datetime, timedelta

# Local data mode: set USE_LOCAL_DATA=true to skip Firestore and use exported JSON files
USE_LOCAL_DATA = os.environ.get("USE_LOCAL_DATA", "").lower() in ("true", "1", "yes")

LOCAL_DATA = {}

if USE_LOCAL_DATA:
    local_data_dir = os.path.join(os.path.dirname(__file__), "local_data")
    for name in ("legislators", "committees", "committee_memberships"):
        path = os.path.join(local_data_dir, f"{name}.json")
        if os.path.exists(path):
            with open(path, "r") as f:
                LOCAL_DATA[name] = json.load(f)
            print(f"[LOCAL MODE] Loaded {len(LOCAL_DATA[name])} {name} from {path}")
        else:
            LOCAL_DATA[name] = []
            print(f"[LOCAL MODE] WARNING: {path} not found")
    db = None
else:
    cred = credentials.Certificate("firebase-credentials.json")
    firebase_admin.initialize_app(cred)
    db = firestore.client()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Congress.gov API configuration
# Set your API key here or via environment variable
CONGRESS_API_KEY = os.environ.get("CONGRESS_API_KEY", "YOUR_API_KEY_HERE")
CONGRESS_API_BASE = "https://api.congress.gov/v3"

# ============ CACHING ============
# Simple in-memory cache to reduce Firestore reads
cache = {
    "legislators": {"data": None, "expires": None},
    "legislators_by_id": {},  # Individual legislator cache
    "committees": {"data": None, "expires": None},
    "memberships_by_legislator": {"data": None, "expires": None},
    "memberships_by_committee": {"data": None, "expires": None},
    "sponsored_legislation": {},  # Keyed by (bioguide_id, limit, offset)
    "cosponsored_legislation": {},  # Keyed by (bioguide_id, limit, offset)
    "legislation_summaries": {},  # Keyed by bioguide_id
    "find_rep": {},  # Keyed by zip code
}
CACHE_DURATION = timedelta(hours=24)  # Cache for 24 hours
LEGISLATION_CACHE_DURATION = timedelta(hours=6)
FIND_REP_CACHE_DURATION = timedelta(hours=24)

def get_cached_legislators():
    """Get legislators from cache, local JSON, or Firestore"""
    now = datetime.now()

    # Check if cache is valid
    if cache["legislators"]["data"] and cache["legislators"]["expires"] and cache["legislators"]["expires"] > now:
        return cache["legislators"]["data"]

    if USE_LOCAL_DATA:
        legislators = LOCAL_DATA.get("legislators", [])
    else:
        # Fetch from Firestore
        docs = db.collection("legislators").stream()
        legislators = []
        for doc in docs:
            legislator = doc.to_dict()
            legislator["id"] = doc.id
            legislators.append(legislator)

    # Cache individually
    for legislator in legislators:
        cache["legislators_by_id"][legislator.get("bioguide_id")] = {
            "data": legislator,
            "expires": now + CACHE_DURATION
        }

    legislators.sort(key=lambda l: (
        l.get("state", ""),
        l.get("chamber", ""),
        l.get("last_name", "")
    ))

    # Update cache
    cache["legislators"]["data"] = legislators
    cache["legislators"]["expires"] = now + CACHE_DURATION

    return legislators

def get_cached_legislator(bioguide_id: str):
    """Get single legislator from cache, local JSON, or Firestore"""
    now = datetime.now()

    # Check individual cache
    if bioguide_id in cache["legislators_by_id"]:
        cached = cache["legislators_by_id"][bioguide_id]
        if cached["expires"] > now:
            return cached["data"]

    if USE_LOCAL_DATA:
        for leg in LOCAL_DATA.get("legislators", []):
            if leg.get("bioguide_id") == bioguide_id:
                cache["legislators_by_id"][bioguide_id] = {
                    "data": leg,
                    "expires": now + CACHE_DURATION
                }
                return leg
        return None

    # Fetch from Firestore
    doc = db.collection("legislators").document(bioguide_id).get()
    if not doc.exists:
        return None

    legislator = doc.to_dict()
    legislator["id"] = doc.id

    # Update cache
    cache["legislators_by_id"][bioguide_id] = {
        "data": legislator,
        "expires": now + CACHE_DURATION
    }

    return legislator

def get_cached_committees():
    """Get committees from cache, local JSON, or Firestore"""
    now = datetime.now()
    if cache["committees"]["data"] and cache["committees"]["expires"] and cache["committees"]["expires"] > now:
        return cache["committees"]["data"]

    if USE_LOCAL_DATA:
        committees = LOCAL_DATA.get("committees", [])
    else:
        docs = db.collection("committees").stream()
        committees = []
        for doc in docs:
            committee = doc.to_dict()
            committee["id"] = doc.id
            committees.append(committee)

    committees.sort(key=lambda c: c.get("name", ""))
    cache["committees"]["data"] = committees
    cache["committees"]["expires"] = now + CACHE_DURATION
    return committees

def get_cached_memberships():
    """Get memberships indexed by legislator and by committee from cache, local JSON, or Firestore"""
    now = datetime.now()
    if (cache["memberships_by_legislator"]["data"] and
        cache["memberships_by_legislator"]["expires"] and
        cache["memberships_by_legislator"]["expires"] > now):
        return cache["memberships_by_legislator"]["data"], cache["memberships_by_committee"]["data"]

    if USE_LOCAL_DATA:
        raw = LOCAL_DATA.get("committee_memberships", [])
    else:
        docs = db.collection("committee_memberships").stream()
        raw = []
        for doc in docs:
            data = doc.to_dict()
            data["bioguide_id"] = doc.id
            raw.append(data)

    by_legislator = {}  # bioguide_id -> membership data
    by_committee = {}   # committee_id -> list of {bioguide_id, rank, title, party}

    for data in raw:
        bio_id = data.get("bioguide_id")
        by_legislator[bio_id] = data
        for assignment in data.get("committees", []):
            cid = assignment.get("committee_id")
            if cid:
                if cid not in by_committee:
                    by_committee[cid] = []
                by_committee[cid].append({
                    "bioguide_id": bio_id,
                    "rank": assignment.get("rank"),
                    "title": assignment.get("title"),
                    "party": assignment.get("party"),
                })

    cache["memberships_by_legislator"]["data"] = by_legislator
    cache["memberships_by_legislator"]["expires"] = now + CACHE_DURATION
    cache["memberships_by_committee"]["data"] = by_committee
    cache["memberships_by_committee"]["expires"] = now + CACHE_DURATION
    return by_legislator, by_committee

@app.get("/api/hello")
def hello():
    return {"message": "Hello from Python!"}

@app.post("/api/cache/clear")
def clear_cache():
    """Clear the in-memory cache to force fresh data from Firestore."""
    cache["legislators"]["data"] = None
    cache["legislators"]["expires"] = None
    cache["legislators_by_id"] = {}
    cache["committees"]["data"] = None
    cache["committees"]["expires"] = None
    cache["memberships_by_legislator"]["data"] = None
    cache["memberships_by_legislator"]["expires"] = None
    cache["memberships_by_committee"]["data"] = None
    cache["memberships_by_committee"]["expires"] = None
    cache["sponsored_legislation"] = {}
    cache["cosponsored_legislation"] = {}
    cache["legislation_summaries"] = {}
    cache["find_rep"] = {}
    return {"message": "Cache cleared successfully"}

@app.get("/api/cache/status")
def cache_status():
    """Check the current cache status."""
    now = datetime.now()
    legislators_cached = cache["legislators"]["data"] is not None
    legislators_expires = cache["legislators"]["expires"]
    expires_in = None
    if legislators_expires:
        expires_in = (legislators_expires - now).total_seconds()
    
    return {
        "legislators_cached": legislators_cached,
        "legislators_count": len(cache["legislators"]["data"]) if legislators_cached else 0,
        "individual_cached": len(cache["legislators_by_id"]),
        "expires_in_seconds": expires_in,
        "cache_duration_hours": CACHE_DURATION.total_seconds() / 3600
    }

# ============ LEGISLATOR ENDPOINTS ============

@app.get("/api/legislators")
def get_legislators(
    response: Response,
    state: Optional[str] = None,
    party: Optional[str] = None,
    chamber: Optional[str] = None
):
    """
    Get all legislators, optionally filtered by state, party, or chamber.
    Uses caching to reduce Firestore reads.
    """
    response.headers["Cache-Control"] = "public, max-age=3600"
    # Get from cache (or refresh cache if expired)
    legislators = get_cached_legislators()

    # Apply filters in memory
    if state:
        legislators = [l for l in legislators if l.get("state", "").upper() == state.upper()]

    if party:
        legislators = [l for l in legislators if l.get("party") == party]

    if chamber:
        legislators = [l for l in legislators if l.get("chamber") == chamber]

    return legislators

@app.get("/api/legislators/{bioguide_id}")
def get_legislator(bioguide_id: str, response: Response):
    """Get a single legislator by their Bioguide ID. Uses caching."""
    response.headers["Cache-Control"] = "public, max-age=3600"
    legislator = get_cached_legislator(bioguide_id)

    if not legislator:
        raise HTTPException(status_code=404, detail="Legislator not found")

    return legislator

@app.get("/api/legislators/state/{state}")
def get_legislators_by_state(state: str, chamber: Optional[str] = None):
    """Get all legislators for a given state."""
    legislators = get_cached_legislators()
    
    # Filter in memory
    result = [l for l in legislators if l.get("state", "").upper() == state.upper()]
    
    if chamber:
        result = [l for l in result if l.get("chamber") == chamber]
    
    return result

@app.get("/api/stats")
def get_stats(response: Response):
    """Get summary statistics about the legislators."""
    response.headers["Cache-Control"] = "public, max-age=3600"
    legislators = get_cached_legislators()
    
    chambers = {}
    for l in legislators:
        chamber = l.get("chamber", "Unknown")
        chambers[chamber] = chambers.get(chamber, 0) + 1
    
    parties = {}
    for l in legislators:
        party = l.get("party", "Unknown")
        parties[party] = parties.get(party, 0) + 1
    
    genders = {}
    for l in legislators:
        gender = l.get("gender", "Unknown")
        label = {"M": "Male", "F": "Female"}.get(gender, "Unknown")
        genders[label] = genders.get(label, 0) + 1
    
    states = {}
    for l in legislators:
        state = l.get("state", "Unknown")
        states[state] = states.get(state, 0) + 1
    
    return {
        "total": len(legislators),
        "by_chamber": chambers,
        "by_party": parties,
        "by_gender": genders,
        "by_state": states
    }


# ============ COMMITTEE ENDPOINTS ============

@app.get("/api/committees")
def get_committees(response: Response, committee_type: Optional[str] = None):
    """Get all committees, optionally filtered by type."""
    response.headers["Cache-Control"] = "public, max-age=86400"
    committees = get_cached_committees()
    if committee_type:
        committees = [c for c in committees if c.get("type") == committee_type.lower()]
    return committees

@app.get("/api/committees/{committee_id}")
def get_committee(committee_id: str, response: Response):
    """Get a single committee by its thomas_id."""
    response.headers["Cache-Control"] = "public, max-age=86400"
    for c in get_cached_committees():
        if c.get("id") == committee_id or c.get("thomas_id") == committee_id:
            return c
    raise HTTPException(status_code=404, detail="Committee not found")

@app.get("/api/committees/{committee_id}/members")
def get_committee_members(committee_id: str, response: Response):
    """Get all members of a committee."""
    response.headers["Cache-Control"] = "public, max-age=86400"
    _, by_committee = get_cached_memberships()
    legislators_by_id = {l.get("bioguide_id"): l for l in get_cached_legislators()}

    members = []
    for entry in by_committee.get(committee_id, []):
        leg = legislators_by_id.get(entry["bioguide_id"])
        if leg:
            members.append({
                "bioguide_id": entry["bioguide_id"],
                "legislator": leg,
                "rank": entry.get("rank"),
                "title": entry.get("title"),
                "party": entry.get("party"),
            })

    members.sort(key=lambda m: m.get("rank") or 999)
    return members

@app.get("/api/legislators/{bioguide_id}/committees")
def get_legislator_committees(bioguide_id: str, response: Response):
    """Get all committees that a legislator serves on."""
    response.headers["Cache-Control"] = "public, max-age=86400"
    leg = get_cached_legislator(bioguide_id)
    if not leg:
        raise HTTPException(status_code=404, detail="Legislator not found")

    by_legislator, _ = get_cached_memberships()
    data = by_legislator.get(bioguide_id)

    if not data:
        return {"bioguide_id": bioguide_id, "committees": [], "subcommittees": []}

    committees = []
    subcommittees = []
    for assignment in data.get("committees", []):
        if assignment.get("is_subcommittee"):
            subcommittees.append(assignment)
        else:
            committees.append(assignment)

    return {
        "bioguide_id": bioguide_id,
        "committees": committees,
        "subcommittees": subcommittees
    }


# ============ CONGRESS.GOV API ENDPOINTS ============

@app.get("/api/legislators/{bioguide_id}/sponsored-legislation")
async def get_sponsored_legislation(
    bioguide_id: str,
    response: Response,
    limit: int = Query(default=20, le=250),
    offset: int = Query(default=0)
):
    """
    Get bills sponsored by a legislator from Congress.gov API.
    """
    response.headers["Cache-Control"] = "public, max-age=1800"
    # Verify legislator exists
    if not get_cached_legislator(bioguide_id):
        raise HTTPException(status_code=404, detail="Legislator not found")

    # Check in-memory cache
    now = datetime.now()
    cache_key = (bioguide_id, limit, offset)
    if cache_key in cache["sponsored_legislation"]:
        cached = cache["sponsored_legislation"][cache_key]
        if cached["expires"] > now:
            return cached["data"]

    url = f"{CONGRESS_API_BASE}/member/{bioguide_id}/sponsored-legislation"
    params = {
        "api_key": CONGRESS_API_KEY,
        "format": "json",
        "limit": limit,
        "offset": offset
    }

    async with httpx.AsyncClient() as client:
        try:
            resp = await client.get(url, params=params, timeout=30.0)
            resp.raise_for_status()
            data = resp.json()

            result = {
                "bioguide_id": bioguide_id,
                "pagination": data.get("pagination", {}),
                "bills": data.get("sponsoredLegislation", [])
            }
            cache["sponsored_legislation"][cache_key] = {"data": result, "expires": now + LEGISLATION_CACHE_DURATION}
            return result
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                return {
                    "bioguide_id": bioguide_id,
                    "pagination": {"count": 0},
                    "bills": []
                }
            raise HTTPException(status_code=e.response.status_code, detail="Congress.gov API error")
        except httpx.RequestError:
            raise HTTPException(status_code=503, detail="Unable to reach Congress.gov API")


@app.get("/api/legislators/{bioguide_id}/cosponsored-legislation")
async def get_cosponsored_legislation(
    bioguide_id: str,
    response: Response,
    limit: int = Query(default=20, le=250),
    offset: int = Query(default=0)
):
    """
    Get bills cosponsored by a legislator from Congress.gov API.
    """
    response.headers["Cache-Control"] = "public, max-age=1800"
    if not get_cached_legislator(bioguide_id):
        raise HTTPException(status_code=404, detail="Legislator not found")

    # Check in-memory cache
    now = datetime.now()
    cache_key = (bioguide_id, limit, offset)
    if cache_key in cache["cosponsored_legislation"]:
        cached = cache["cosponsored_legislation"][cache_key]
        if cached["expires"] > now:
            return cached["data"]

    url = f"{CONGRESS_API_BASE}/member/{bioguide_id}/cosponsored-legislation"
    params = {
        "api_key": CONGRESS_API_KEY,
        "format": "json",
        "limit": limit,
        "offset": offset
    }

    async with httpx.AsyncClient() as client:
        try:
            resp = await client.get(url, params=params, timeout=30.0)
            resp.raise_for_status()
            data = resp.json()

            result = {
                "bioguide_id": bioguide_id,
                "pagination": data.get("pagination", {}),
                "bills": data.get("cosponsoredLegislation", [])
            }
            cache["cosponsored_legislation"][cache_key] = {"data": result, "expires": now + LEGISLATION_CACHE_DURATION}
            return result
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                return {
                    "bioguide_id": bioguide_id,
                    "pagination": {"count": 0},
                    "bills": []
                }
            raise HTTPException(status_code=e.response.status_code, detail="Congress.gov API error")
        except httpx.RequestError:
            raise HTTPException(status_code=503, detail="Unable to reach Congress.gov API")


@app.get("/api/legislators/{bioguide_id}/legislation-summary")
async def get_legislation_summary(bioguide_id: str, response: Response, refresh: bool = False):
    """
    Get a summary of sponsored and cosponsored legislation counts,
    including bills signed into law. Results are cached in-memory and in Firestore,
    refreshed daily or on demand.
    """
    response.headers["Cache-Control"] = "public, max-age=3600"
    if not get_cached_legislator(bioguide_id):
        raise HTTPException(status_code=404, detail="Legislator not found")

    now = datetime.now()

    # Check in-memory cache first
    if not refresh and bioguide_id in cache["legislation_summaries"]:
        cached = cache["legislation_summaries"][bioguide_id]
        if cached["expires"] > now:
            return cached["data"]

    # Check Firestore cache
    if db and not refresh:
        cache_ref = db.collection("legislation_cache").document(bioguide_id)
        cache_doc = cache_ref.get()

        if cache_doc.exists:
            cached_data = cache_doc.to_dict()
            cached_at = cached_data.get("cached_at")

            if cached_at:
                from datetime import timezone
                cache_time = cached_at
                if hasattr(cache_time, 'timestamp'):
                    cache_age = datetime.now(timezone.utc) - cache_time.replace(tzinfo=timezone.utc)
                else:
                    cache_age = timedelta(hours=25)

                if cache_age < timedelta(hours=24):
                    result = {
                        "bioguide_id": bioguide_id,
                        "sponsored_count": cached_data.get("sponsored_count", 0),
                        "cosponsored_count": cached_data.get("cosponsored_count", 0),
                        "enacted_count": cached_data.get("enacted_count", 0),
                        "recent_sponsored": cached_data.get("recent_sponsored", []),
                        "recent_enacted": cached_data.get("recent_enacted", []),
                        "cached": True,
                        "cached_at": str(cached_at)
                    }
                    # Store in in-memory cache
                    cache["legislation_summaries"][bioguide_id] = {"data": result, "expires": now + CACHE_DURATION}
                    return result

    # Fetch fresh data from Congress.gov API
    sponsored_count = 0
    cosponsored_count = 0
    enacted_count = 0
    recent_sponsored = []
    recent_enacted = []

    async with httpx.AsyncClient() as client:
        try:
            url = f"{CONGRESS_API_BASE}/member/{bioguide_id}/sponsored-legislation"
            params = {"api_key": CONGRESS_API_KEY, "format": "json", "limit": 250}
            resp = await client.get(url, params=params, timeout=30.0)
            if resp.status_code == 200:
                data = resp.json()
                sponsored_count = data.get("pagination", {}).get("count", 0)
                all_sponsored = data.get("sponsoredLegislation", [])
                recent_sponsored = all_sponsored[:5]

                for bill in all_sponsored:
                    latest_action = bill.get("latestAction", {})
                    action_text = latest_action.get("text", "") if latest_action else ""
                    if "Became Public Law" in action_text or "became public law" in action_text.lower():
                        enacted_count += 1
                        if len(recent_enacted) < 5:
                            recent_enacted.append(bill)

                total_count = data.get("pagination", {}).get("count", 0)
                if total_count > 250:
                    offset = 250
                    while offset < total_count:
                        params["offset"] = offset
                        resp = await client.get(url, params=params, timeout=30.0)
                        if resp.status_code == 200:
                            data = resp.json()
                            for bill in data.get("sponsoredLegislation", []):
                                latest_action = bill.get("latestAction", {})
                                action_text = latest_action.get("text", "") if latest_action else ""
                                if "Became Public Law" in action_text or "became public law" in action_text.lower():
                                    enacted_count += 1
                                    if len(recent_enacted) < 5:
                                        recent_enacted.append(bill)
                        offset += 250
        except:
            pass

        try:
            url = f"{CONGRESS_API_BASE}/member/{bioguide_id}/cosponsored-legislation"
            params = {"api_key": CONGRESS_API_KEY, "format": "json", "limit": 1}
            resp = await client.get(url, params=params, timeout=30.0)
            if resp.status_code == 200:
                data = resp.json()
                cosponsored_count = data.get("pagination", {}).get("count", 0)
        except:
            pass

    # Cache in Firestore
    if db:
        from datetime import timezone
        cache_ref = db.collection("legislation_cache").document(bioguide_id)
        cache_ref.set({
            "bioguide_id": bioguide_id,
            "sponsored_count": sponsored_count,
            "cosponsored_count": cosponsored_count,
            "enacted_count": enacted_count,
            "recent_sponsored": recent_sponsored,
            "recent_enacted": recent_enacted,
            "cached_at": datetime.now(timezone.utc)
        })

    result = {
        "bioguide_id": bioguide_id,
        "sponsored_count": sponsored_count,
        "cosponsored_count": cosponsored_count,
        "enacted_count": enacted_count,
        "recent_sponsored": recent_sponsored,
        "recent_enacted": recent_enacted,
        "cached": False
    }
    cache["legislation_summaries"][bioguide_id] = {"data": result, "expires": now + CACHE_DURATION}
    return result


# ============ LEGACY ENDPOINTS ============

@app.post("/api/cache/refresh-legislation")
async def refresh_all_legislation_cache(limit: int = Query(default=10, le=50)):
    """
    Refresh legislation cache for legislators. Use limit to control how many
    to refresh at once (to avoid API rate limits). Call repeatedly to refresh all.
    Returns list of bioguide_ids that were refreshed.
    """
    from datetime import datetime, timezone, timedelta
    
    # Get legislators whose cache is old or missing
    legislators = db.collection("legislators").stream()
    to_refresh = []
    
    for leg in legislators:
        bioguide_id = leg.id
        cache_doc = db.collection("legislation_cache").document(bioguide_id).get()
        
        if not cache_doc.exists:
            to_refresh.append(bioguide_id)
        else:
            cached_data = cache_doc.to_dict()
            cached_at = cached_data.get("cached_at")
            if cached_at:
                if hasattr(cached_at, 'timestamp'):
                    cache_age = datetime.now(timezone.utc) - cached_at.replace(tzinfo=timezone.utc)
                    if cache_age > timedelta(hours=24):
                        to_refresh.append(bioguide_id)
                else:
                    to_refresh.append(bioguide_id)
            else:
                to_refresh.append(bioguide_id)
        
        if len(to_refresh) >= limit:
            break
    
    # Refresh each one
    refreshed = []
    for bioguide_id in to_refresh[:limit]:
        try:
            await get_legislation_summary(bioguide_id, refresh=True)
            refreshed.append(bioguide_id)
        except:
            pass
    
    return {
        "refreshed": refreshed,
        "count": len(refreshed),
        "remaining": len(to_refresh) - len(refreshed)
    }


@app.get("/api/senators")
def get_senators(
    state: Optional[str] = None,
    party: Optional[str] = None
):
    """Get all senators (legacy endpoint)."""
    return get_legislators(state=state, party=party, chamber="Senate")


# ============ YOUTUBE ENDPOINTS ============

YOUTUBE_API_KEY = os.environ.get("YOUTUBE_API_KEY", "")
YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3"

@app.get("/api/legislators/{bioguide_id}/youtube-videos")
async def get_youtube_videos(bioguide_id: str, response: Response, refresh: bool = False):
    """
    Get recent YouTube videos for a legislator.
    Results are cached in Firestore for 24 hours.
    """
    response.headers["Cache-Control"] = "public, max-age=3600"
    if not YOUTUBE_API_KEY:
        # In local dev, proxy to production API
        try:
            async with httpx.AsyncClient() as client:
                prod_url = f"https://congress-api-370988201370.us-central1.run.app/api/legislators/{bioguide_id}/youtube-videos"
                resp = await client.get(prod_url, timeout=10.0)
                if resp.status_code == 200:
                    return resp.json()
        except Exception:
            pass
        return {"videos": [], "error": "YouTube API key not configured"}
    
    # Get legislator to find YouTube channel
    legislator = get_cached_legislator(bioguide_id)
    if not legislator:
        raise HTTPException(status_code=404, detail="Legislator not found")
    external_ids = legislator.get("external_ids", {})
    youtube_channel = external_ids.get("youtube")
    youtube_id = external_ids.get("youtube_id")
    
    if not youtube_channel and not youtube_id:
        return {"videos": [], "bioguide_id": bioguide_id}
    
    # Check cache first (Firestore cache only available when db is connected)
    cache_ref = None
    if db:
        cache_ref = db.collection("youtube_cache").document(bioguide_id)
        cache_doc = cache_ref.get()

        if cache_doc.exists and not refresh:
            cache_data = cache_doc.to_dict()
            cached_at = cache_data.get("cached_at")
            if cached_at:
                from datetime import datetime, timedelta
                cache_time = cached_at
                if hasattr(cache_time, 'timestamp'):
                    cache_age = datetime.now().timestamp() - cache_time.timestamp()
                    # Cache for 24 hours
                    if cache_age < 86400:
                        return {
                            "videos": cache_data.get("videos", []),
                            "bioguide_id": bioguide_id,
                            "cached": True
                        }
    
    # Fetch from YouTube API using uploads playlist method
    try:
        async with httpx.AsyncClient() as client:
            # First, get channel ID if we only have username
            channel_id = youtube_id
            
            if not channel_id and youtube_channel:
                # Try to get channel by username/handle
                search_url = f"{YOUTUBE_API_BASE}/search"
                search_params = {
                    "key": YOUTUBE_API_KEY,
                    "q": youtube_channel,
                    "type": "channel",
                    "part": "snippet",
                    "maxResults": 1
                }
                search_resp = await client.get(search_url, params=search_params)
                if search_resp.status_code == 200:
                    search_data = search_resp.json()
                    items = search_data.get("items", [])
                    if items:
                        channel_id = items[0]["snippet"]["channelId"]
            
            if not channel_id:
                return {"videos": [], "bioguide_id": bioguide_id, "error": "Channel not found"}
            
            # Get channel's uploads playlist ID
            channel_url = f"{YOUTUBE_API_BASE}/channels"
            channel_params = {
                "key": YOUTUBE_API_KEY,
                "id": channel_id,
                "part": "contentDetails"
            }
            channel_resp = await client.get(channel_url, params=channel_params)
            
            if channel_resp.status_code != 200:
                return {"videos": [], "bioguide_id": bioguide_id, "error": f"Channel lookup error: {channel_resp.status_code}"}
            
            channel_data = channel_resp.json()
            if not channel_data.get("items"):
                return {"videos": [], "bioguide_id": bioguide_id, "error": "Channel not found"}
            
            uploads_playlist_id = channel_data["items"][0]["contentDetails"]["relatedPlaylists"]["uploads"]
            
            # Get videos from uploads playlist
            playlist_url = f"{YOUTUBE_API_BASE}/playlistItems"
            playlist_params = {
                "key": YOUTUBE_API_KEY,
                "playlistId": uploads_playlist_id,
                "part": "snippet",
                "maxResults": 5
            }
            
            response = await client.get(playlist_url, params=playlist_params)
            
            if response.status_code != 200:
                return {"videos": [], "bioguide_id": bioguide_id, "error": f"YouTube API error: {response.status_code}"}
            
            data = response.json()
            videos = []
            
            for item in data.get("items", []):
                snippet = item.get("snippet", {})
                video_id = snippet.get("resourceId", {}).get("videoId")
                
                if video_id:
                    videos.append({
                        "video_id": video_id,
                        "title": snippet.get("title", ""),
                        "description": snippet.get("description", "")[:200],
                        "thumbnail_url": snippet.get("thumbnails", {}).get("medium", {}).get("url", ""),
                        "published_at": snippet.get("publishedAt", "")
                    })
            
            # Cache the results (only when Firestore is available)
            if cache_ref:
                from datetime import datetime
                cache_ref.set({
                    "bioguide_id": bioguide_id,
                    "videos": videos,
                    "cached_at": datetime.now(),
                    "channel_id": channel_id
                })
            
            return {
                "videos": videos,
                "bioguide_id": bioguide_id,
                "cached": False
            }
            
    except Exception as e:
        return {"videos": [], "bioguide_id": bioguide_id, "error": str(e)}


@app.get("/api/youtube-videos/batch")
async def get_youtube_videos_batch(
    ids: str = Query(..., description="Comma-separated bioguide IDs"),
    response: Response = None
):
    """
    Get YouTube videos for multiple legislators in a single request.
    Returns a dict keyed by bioguide_id.
    """
    if response:
        response.headers["Cache-Control"] = "public, max-age=3600"

    bioguide_ids = [bid.strip() for bid in ids.split(",") if bid.strip()][:20]  # Max 20
    results = {}

    for bid in bioguide_ids:
        try:
            # Reuse the existing single endpoint logic via internal call
            video_response = Response()
            video_data = await get_youtube_videos(bid, video_response)
            results[bid] = video_data
        except Exception:
            results[bid] = {"videos": [], "bioguide_id": bid, "error": "Failed to fetch"}

    return results


# ============ FIND YOUR REP ENDPOINT ============

@app.get("/api/find-rep")
async def find_rep(zip: str = Query(..., min_length=5, max_length=5), response: Response = None):
    """
    Find representatives and senators by zip code using whoismyrepresentative.com API.
    Always returns both senators for the state plus the house representative.
    """
    if response:
        response.headers["Cache-Control"] = "public, max-age=86400"

    # Check in-memory cache
    now = datetime.now()
    if zip in cache["find_rep"]:
        cached = cache["find_rep"][zip]
        if cached["expires"] > now:
            return cached["data"]

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"https://whoismyrepresentative.com/getall_mems.php?zip={zip}&output=json",
                timeout=10.0,
                headers={"User-Agent": "CongressDirectory/1.0"}
            )

            if resp.status_code != 200:
                raise HTTPException(status_code=resp.status_code, detail=f"Failed to fetch representative data: {resp.status_code}")

            try:
                data = resp.json()
            except:
                raise HTTPException(status_code=500, detail=f"Invalid JSON response: {resp.text[:200]}")

            results = data.get("results", [])

            if not results:
                return {
                    "zip": zip,
                    "representatives": [],
                    "raw_results": [],
                    "message": "No representatives found for this zip code"
                }

            state = results[0].get("state", "") if results else ""

            if not state:
                return {
                    "zip": zip,
                    "representatives": [],
                    "raw_results": results,
                    "message": "Could not determine state from zip code"
                }

            # Use cached legislators instead of raw Firestore queries
            all_legislators = get_cached_legislators()

            matched = []
            matched_bioguides = set()

            for rep in results:
                name = rep.get("name", "")
                rep_state = rep.get("state", "")

                clean_name = name.replace("Rep. ", "").replace("Sen. ", "").strip()
                name_parts = clean_name.split()
                last_name = name_parts[-1] if name_parts else ""
                if last_name.lower() in ["jr.", "jr", "sr.", "sr", "ii", "iii", "iv"]:
                    last_name = name_parts[-2] if len(name_parts) > 1 else ""

                state_legs = [l for l in all_legislators if l.get("state", "").upper() == rep_state.upper()]

                for leg in state_legs:
                    leg_last_name = leg.get("last_name", "").lower()
                    leg_full_name = leg.get("full_name", "").lower()
                    bioguide = leg.get("bioguide_id")

                    if (last_name.lower() == leg_last_name or last_name.lower() in leg_full_name) and bioguide not in matched_bioguides:
                        matched.append({
                            "bioguide_id": bioguide,
                            "full_name": leg.get("full_name"),
                            "party": leg.get("party"),
                            "state": leg.get("state"),
                            "chamber": leg.get("chamber"),
                            "district": leg.get("district"),
                            "api_name": name,
                        })
                        matched_bioguides.add(bioguide)
                        break

            # Ensure both senators for the state
            senators = [l for l in all_legislators if l.get("state", "").upper() == state.upper() and l.get("chamber") == "Senate"]

            for leg in senators:
                bioguide = leg.get("bioguide_id")
                if bioguide not in matched_bioguides:
                    matched.append({
                        "bioguide_id": bioguide,
                        "full_name": leg.get("full_name"),
                        "party": leg.get("party"),
                        "state": leg.get("state"),
                        "chamber": leg.get("chamber"),
                        "district": leg.get("district"),
                        "api_name": None,
                    })
                    matched_bioguides.add(bioguide)

            matched.sort(key=lambda x: (0 if x["chamber"] == "Senate" else 1, x["full_name"]))

            result = {
                "zip": zip,
                "state": state,
                "representatives": matched,
                "raw_results": results
            }
            cache["find_rep"][zip] = {"data": result, "expires": now + FIND_REP_CACHE_DURATION}
            return result

    except httpx.RequestError as e:
        raise HTTPException(status_code=500, detail=f"API request failed: {str(e)}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error: {str(e)}")
