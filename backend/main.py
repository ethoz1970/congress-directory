import os
import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
import firebase_admin
from firebase_admin import credentials, firestore
from typing import Optional, List
from datetime import datetime, timedelta

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
}
CACHE_DURATION = timedelta(hours=24)  # Cache for 24 hours

def get_cached_legislators():
    """Get legislators from cache or Firestore"""
    now = datetime.now()
    
    # Check if cache is valid
    if cache["legislators"]["data"] and cache["legislators"]["expires"] and cache["legislators"]["expires"] > now:
        return cache["legislators"]["data"]
    
    # Fetch from Firestore
    docs = db.collection("legislators").stream()
    legislators = []
    for doc in docs:
        legislator = doc.to_dict()
        legislator["id"] = doc.id
        legislators.append(legislator)
        # Also cache individually
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
    """Get single legislator from cache or Firestore"""
    now = datetime.now()
    
    # Check individual cache
    if bioguide_id in cache["legislators_by_id"]:
        cached = cache["legislators_by_id"][bioguide_id]
        if cached["expires"] > now:
            return cached["data"]
    
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

@app.get("/api/hello")
def hello():
    return {"message": "Hello from Python!"}

@app.post("/api/cache/clear")
def clear_cache():
    """Clear the in-memory cache to force fresh data from Firestore."""
    cache["legislators"]["data"] = None
    cache["legislators"]["expires"] = None
    cache["legislators_by_id"] = {}
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
    state: Optional[str] = None,
    party: Optional[str] = None,
    chamber: Optional[str] = None
):
    """
    Get all legislators, optionally filtered by state, party, or chamber.
    Uses caching to reduce Firestore reads.
    """
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
def get_legislator(bioguide_id: str):
    """Get a single legislator by their Bioguide ID. Uses caching."""
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
def get_stats():
    """Get summary statistics about the legislators."""
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
def get_committees(committee_type: Optional[str] = None):
    """Get all committees, optionally filtered by type."""
    query = db.collection("committees")
    
    if committee_type:
        query = query.where("type", "==", committee_type.lower())
    
    docs = query.stream()
    committees = []
    for doc in docs:
        committee = doc.to_dict()
        committee["id"] = doc.id
        committees.append(committee)
    
    committees.sort(key=lambda c: c.get("name", ""))
    
    return committees

@app.get("/api/committees/{committee_id}")
def get_committee(committee_id: str):
    """Get a single committee by its thomas_id."""
    doc = db.collection("committees").document(committee_id).get()
    
    if not doc.exists:
        raise HTTPException(status_code=404, detail="Committee not found")
    
    committee = doc.to_dict()
    committee["id"] = doc.id
    return committee

@app.get("/api/committees/{committee_id}/members")
def get_committee_members(committee_id: str):
    """Get all members of a committee."""
    docs = db.collection("committee_memberships").stream()
    
    members = []
    for doc in docs:
        data = doc.to_dict()
        for assignment in data.get("committees", []):
            if assignment.get("committee_id") == committee_id:
                leg_doc = db.collection("legislators").document(data["bioguide_id"]).get()
                if leg_doc.exists:
                    member = {
                        "bioguide_id": data["bioguide_id"],
                        "legislator": leg_doc.to_dict(),
                        "rank": assignment.get("rank"),
                        "title": assignment.get("title"),
                        "party": assignment.get("party"),
                    }
                    members.append(member)
                break
    
    members.sort(key=lambda m: m.get("rank") or 999)
    
    return members

@app.get("/api/legislators/{bioguide_id}/committees")
def get_legislator_committees(bioguide_id: str):
    """Get all committees that a legislator serves on."""
    leg_doc = db.collection("legislators").document(bioguide_id).get()
    if not leg_doc.exists:
        raise HTTPException(status_code=404, detail="Legislator not found")
    
    membership_doc = db.collection("committee_memberships").document(bioguide_id).get()
    
    if not membership_doc.exists:
        return {
            "bioguide_id": bioguide_id,
            "committees": [],
            "subcommittees": []
        }
    
    data = membership_doc.to_dict()
    
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
    limit: int = Query(default=20, le=250),
    offset: int = Query(default=0)
):
    """
    Get bills sponsored by a legislator from Congress.gov API.
    
    Args:
        bioguide_id: The legislator's Bioguide ID
        limit: Number of results to return (max 250)
        offset: Starting position for pagination
    """
    # Verify legislator exists
    leg_doc = db.collection("legislators").document(bioguide_id).get()
    if not leg_doc.exists:
        raise HTTPException(status_code=404, detail="Legislator not found")
    
    url = f"{CONGRESS_API_BASE}/member/{bioguide_id}/sponsored-legislation"
    params = {
        "api_key": CONGRESS_API_KEY,
        "format": "json",
        "limit": limit,
        "offset": offset
    }
    
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(url, params=params, timeout=30.0)
            response.raise_for_status()
            data = response.json()
            
            return {
                "bioguide_id": bioguide_id,
                "pagination": data.get("pagination", {}),
                "bills": data.get("sponsoredLegislation", [])
            }
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
    limit: int = Query(default=20, le=250),
    offset: int = Query(default=0)
):
    """
    Get bills cosponsored by a legislator from Congress.gov API.
    """
    leg_doc = db.collection("legislators").document(bioguide_id).get()
    if not leg_doc.exists:
        raise HTTPException(status_code=404, detail="Legislator not found")
    
    url = f"{CONGRESS_API_BASE}/member/{bioguide_id}/cosponsored-legislation"
    params = {
        "api_key": CONGRESS_API_KEY,
        "format": "json",
        "limit": limit,
        "offset": offset
    }
    
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(url, params=params, timeout=30.0)
            response.raise_for_status()
            data = response.json()
            
            return {
                "bioguide_id": bioguide_id,
                "pagination": data.get("pagination", {}),
                "bills": data.get("cosponsoredLegislation", [])
            }
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
async def get_legislation_summary(bioguide_id: str, refresh: bool = False):
    """
    Get a summary of sponsored and cosponsored legislation counts,
    including bills signed into law. Results are cached in Firestore
    and refreshed daily or on demand.
    """
    leg_doc = db.collection("legislators").document(bioguide_id).get()
    if not leg_doc.exists:
        raise HTTPException(status_code=404, detail="Legislator not found")
    
    # Check for cached data
    cache_ref = db.collection("legislation_cache").document(bioguide_id)
    cache_doc = cache_ref.get()
    
    if cache_doc.exists and not refresh:
        cached_data = cache_doc.to_dict()
        cached_at = cached_data.get("cached_at")
        
        # Use cache if less than 24 hours old
        if cached_at:
            from datetime import datetime, timezone, timedelta
            cache_time = cached_at
            if hasattr(cache_time, 'timestamp'):
                # Firestore timestamp
                cache_age = datetime.now(timezone.utc) - cache_time.replace(tzinfo=timezone.utc)
            else:
                cache_age = timedelta(hours=25)  # Force refresh if can't parse
            
            if cache_age < timedelta(hours=24):
                return {
                    "bioguide_id": bioguide_id,
                    "sponsored_count": cached_data.get("sponsored_count", 0),
                    "cosponsored_count": cached_data.get("cosponsored_count", 0),
                    "enacted_count": cached_data.get("enacted_count", 0),
                    "recent_sponsored": cached_data.get("recent_sponsored", []),
                    "recent_enacted": cached_data.get("recent_enacted", []),
                    "cached": True,
                    "cached_at": str(cached_at)
                }
    
    # Fetch fresh data from Congress.gov API
    sponsored_count = 0
    cosponsored_count = 0
    enacted_count = 0
    recent_sponsored = []
    recent_enacted = []
    
    async with httpx.AsyncClient() as client:
        # Get sponsored legislation count and recent bills
        try:
            url = f"{CONGRESS_API_BASE}/member/{bioguide_id}/sponsored-legislation"
            params = {"api_key": CONGRESS_API_KEY, "format": "json", "limit": 250}
            response = await client.get(url, params=params, timeout=30.0)
            if response.status_code == 200:
                data = response.json()
                sponsored_count = data.get("pagination", {}).get("count", 0)
                all_sponsored = data.get("sponsoredLegislation", [])
                recent_sponsored = all_sponsored[:5]
                
                # Count enacted bills (check for "Became Public Law" in latestAction)
                for bill in all_sponsored:
                    latest_action = bill.get("latestAction", {})
                    action_text = latest_action.get("text", "") if latest_action else ""
                    if "Became Public Law" in action_text or "became public law" in action_text.lower():
                        enacted_count += 1
                        if len(recent_enacted) < 5:
                            recent_enacted.append(bill)
                
                # If more than 250 bills, we need to paginate to get accurate enacted count
                total_count = data.get("pagination", {}).get("count", 0)
                if total_count > 250:
                    offset = 250
                    while offset < total_count:
                        params["offset"] = offset
                        response = await client.get(url, params=params, timeout=30.0)
                        if response.status_code == 200:
                            data = response.json()
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
        
        # Get cosponsored legislation count
        try:
            url = f"{CONGRESS_API_BASE}/member/{bioguide_id}/cosponsored-legislation"
            params = {"api_key": CONGRESS_API_KEY, "format": "json", "limit": 1}
            response = await client.get(url, params=params, timeout=30.0)
            if response.status_code == 200:
                data = response.json()
                cosponsored_count = data.get("pagination", {}).get("count", 0)
        except:
            pass
    
    # Cache the results in Firestore
    from datetime import datetime, timezone
    cache_data = {
        "bioguide_id": bioguide_id,
        "sponsored_count": sponsored_count,
        "cosponsored_count": cosponsored_count,
        "enacted_count": enacted_count,
        "recent_sponsored": recent_sponsored,
        "recent_enacted": recent_enacted,
        "cached_at": datetime.now(timezone.utc)
    }
    cache_ref.set(cache_data)
    
    return {
        "bioguide_id": bioguide_id,
        "sponsored_count": sponsored_count,
        "cosponsored_count": cosponsored_count,
        "enacted_count": enacted_count,
        "recent_sponsored": recent_sponsored,
        "recent_enacted": recent_enacted,
        "cached": False
    }


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
async def get_youtube_videos(bioguide_id: str, refresh: bool = False):
    """
    Get recent YouTube videos for a legislator.
    Results are cached in Firestore for 24 hours.
    """
    if not YOUTUBE_API_KEY:
        return {"videos": [], "error": "YouTube API key not configured"}
    
    # Get legislator to find YouTube channel
    doc = db.collection("legislators").document(bioguide_id).get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="Legislator not found")
    
    legislator = doc.to_dict()
    external_ids = legislator.get("external_ids", {})
    youtube_channel = external_ids.get("youtube")
    youtube_id = external_ids.get("youtube_id")
    
    if not youtube_channel and not youtube_id:
        return {"videos": [], "bioguide_id": bioguide_id}
    
    # Check cache first
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
            
            # Cache the results
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


# ============ FIND YOUR REP ENDPOINT ============

@app.get("/api/find-rep")
async def find_rep(zip: str = Query(..., min_length=5, max_length=5)):
    """
    Find representatives and senators by zip code using whoismyrepresentative.com API.
    Returns matched bioguide_ids from our database.
    """
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"https://whoismyrepresentative.com/getall_mems.php?zip={zip}&output=json",
                timeout=10.0,
                headers={"User-Agent": "CongressDirectory/1.0"}
            )
            
            if response.status_code != 200:
                raise HTTPException(status_code=response.status_code, detail=f"Failed to fetch representative data: {response.status_code}")
            
            try:
                data = response.json()
            except:
                raise HTTPException(status_code=500, detail=f"Invalid JSON response: {response.text[:200]}")
            
            # The API returns {"results": [...]} with name, state, district, etc.
            results = data.get("results", [])
            
            if not results:
                return {
                    "zip": zip,
                    "representatives": [],
                    "raw_results": [],
                    "message": "No representatives found for this zip code"
                }
            
            # Match with our legislators by name
            matched = []
            for rep in results:
                name = rep.get("name", "")
                state = rep.get("state", "")
                
                # Clean the name - remove "Rep. " or "Sen. " prefix
                clean_name = name.replace("Rep. ", "").replace("Sen. ", "").strip()
                
                # Extract last name (usually the last word, but handle suffixes like Jr., III)
                name_parts = clean_name.split()
                last_name = name_parts[-1] if name_parts else ""
                # Handle suffixes
                if last_name.lower() in ["jr.", "jr", "sr.", "sr", "ii", "iii", "iv"]:
                    last_name = name_parts[-2] if len(name_parts) > 1 else ""
                
                # Query legislators by state
                query = db.collection("legislators").where("state", "==", state).stream()
                
                for doc in query:
                    leg = doc.to_dict()
                    leg_last_name = leg.get("last_name", "").lower()
                    leg_full_name = leg.get("full_name", "").lower()
                    
                    # Check if last names match
                    if last_name.lower() == leg_last_name or last_name.lower() in leg_full_name:
                        matched.append({
                            "bioguide_id": leg.get("bioguide_id"),
                            "full_name": leg.get("full_name"),
                            "party": leg.get("party"),
                            "state": leg.get("state"),
                            "chamber": leg.get("chamber"),
                            "district": leg.get("district"),
                            "api_name": name,
                        })
                        break
            
            return {
                "zip": zip,
                "representatives": matched,
                "raw_results": results
            }
            
    except httpx.RequestError as e:
        raise HTTPException(status_code=500, detail=f"API request failed: {str(e)}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error: {str(e)}")
