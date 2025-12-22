import os
import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
import firebase_admin
from firebase_admin import credentials, firestore
from typing import Optional, List

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

@app.get("/api/hello")
def hello():
    return {"message": "Hello from Python!"}

# ============ LEGISLATOR ENDPOINTS ============

@app.get("/api/legislators")
def get_legislators(
    state: Optional[str] = None,
    party: Optional[str] = None,
    chamber: Optional[str] = None
):
    """
    Get all legislators, optionally filtered by state, party, or chamber.
    """
    query = db.collection("legislators")
    
    if state:
        query = query.where("state", "==", state.upper())
    
    if party:
        query = query.where("party", "==", party)
    
    if chamber:
        query = query.where("chamber", "==", chamber)
    
    docs = query.stream()
    legislators = []
    for doc in docs:
        legislator = doc.to_dict()
        legislator["id"] = doc.id
        legislators.append(legislator)
    
    legislators.sort(key=lambda l: (
        l.get("state", ""),
        l.get("chamber", ""),
        l.get("last_name", "")
    ))
    
    return legislators

@app.get("/api/legislators/{bioguide_id}")
def get_legislator(bioguide_id: str):
    """Get a single legislator by their Bioguide ID."""
    doc = db.collection("legislators").document(bioguide_id).get()
    
    if not doc.exists:
        raise HTTPException(status_code=404, detail="Legislator not found")
    
    legislator = doc.to_dict()
    legislator["id"] = doc.id
    return legislator

@app.get("/api/legislators/state/{state}")
def get_legislators_by_state(state: str, chamber: Optional[str] = None):
    """Get all legislators for a given state."""
    query = db.collection("legislators").where("state", "==", state.upper())
    
    if chamber:
        query = query.where("chamber", "==", chamber)
    
    docs = query.stream()
    
    legislators = []
    for doc in docs:
        legislator = doc.to_dict()
        legislator["id"] = doc.id
        legislators.append(legislator)
    
    legislators.sort(key=lambda l: (
        0 if l.get("chamber") == "Senate" else 1,
        l.get("last_name", "")
    ))
    
    return legislators

@app.get("/api/stats")
def get_stats():
    """Get summary statistics about the legislators."""
    docs = db.collection("legislators").stream()
    
    legislators = [doc.to_dict() for doc in docs]
    
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
async def get_legislation_summary(bioguide_id: str):
    """
    Get a summary of sponsored and cosponsored legislation counts.
    This is a quick overview without fetching all bills.
    """
    leg_doc = db.collection("legislators").document(bioguide_id).get()
    if not leg_doc.exists:
        raise HTTPException(status_code=404, detail="Legislator not found")
    
    sponsored_count = 0
    cosponsored_count = 0
    recent_sponsored = []
    
    async with httpx.AsyncClient() as client:
        # Get sponsored legislation count and recent bills
        try:
            url = f"{CONGRESS_API_BASE}/member/{bioguide_id}/sponsored-legislation"
            params = {"api_key": CONGRESS_API_KEY, "format": "json", "limit": 5}
            response = await client.get(url, params=params, timeout=30.0)
            if response.status_code == 200:
                data = response.json()
                sponsored_count = data.get("pagination", {}).get("count", 0)
                recent_sponsored = data.get("sponsoredLegislation", [])[:5]
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
    
    return {
        "bioguide_id": bioguide_id,
        "sponsored_count": sponsored_count,
        "cosponsored_count": cosponsored_count,
        "recent_sponsored": recent_sponsored
    }


# ============ LEGACY ENDPOINTS ============

@app.get("/api/senators")
def get_senators(
    state: Optional[str] = None,
    party: Optional[str] = None
):
    """Get all senators (legacy endpoint)."""
    return get_legislators(state=state, party=party, chamber="Senate")
