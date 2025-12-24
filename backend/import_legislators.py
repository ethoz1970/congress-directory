import firebase_admin
from firebase_admin import credentials, firestore
import requests

# Initialize Firebase
cred = credentials.Certificate("firebase-credentials.json")
firebase_admin.initialize_app(cred)
db = firestore.client()

# Fetch current legislators from @unitedstates project
DATA_URL = "https://unitedstates.github.io/congress-legislators/legislators-current.json"
SOCIAL_URL = "https://unitedstates.github.io/congress-legislators/legislators-social-media.json"

def fetch_legislators():
    """Fetch current legislators from the @unitedstates project."""
    print("Fetching legislators data...")
    response = requests.get(DATA_URL)
    response.raise_for_status()
    return response.json()

def fetch_social_media():
    """Fetch social media data from the @unitedstates project."""
    print("Fetching social media data...")
    response = requests.get(SOCIAL_URL)
    response.raise_for_status()
    data = response.json()
    # Create lookup by bioguide_id
    social_lookup = {}
    for entry in data:
        bioguide = entry.get("id", {}).get("bioguide")
        if bioguide:
            social_lookup[bioguide] = entry.get("social", {})
    return social_lookup

def extract_legislator_data(legislator, social_lookup):
    """Extract relevant fields for a legislator from the raw data."""
    
    # Get the most recent term
    terms = legislator.get("terms", [])
    if not terms:
        return None
    
    current_term = terms[-1]
    term_type = current_term.get("type")
    
    # Determine chamber
    if term_type == "sen":
        chamber = "Senate"
    elif term_type == "rep":
        chamber = "House"
    else:
        return None
    
    # Count terms by chamber
    senate_terms = len([t for t in terms if t.get("type") == "sen"])
    house_terms = len([t for t in terms if t.get("type") == "rep"])
    total_terms = len(terms)
    
    # Calculate first elected date (start of first term)
    first_term_start = terms[0].get("start") if terms else None
    
    name = legislator.get("name", {})
    bio = legislator.get("bio", {})
    ids = legislator.get("id", {})
    
    # Get social media data
    bioguide_id = ids.get("bioguide")
    social = social_lookup.get(bioguide_id, {})
    
    data = {
        "bioguide_id": bioguide_id,
        "first_name": name.get("first"),
        "last_name": name.get("last"),
        "full_name": name.get("official_full"),
        "nickname": name.get("nickname"),
        "party": current_term.get("party"),
        "caucus": current_term.get("caucus"),
        "state": current_term.get("state"),
        "chamber": chamber,
        "term_start": current_term.get("start"),
        "term_end": current_term.get("end"),
        "birthday": bio.get("birthday"),
        "gender": bio.get("gender"),
        "phone": current_term.get("phone"),
        "office": current_term.get("office"),
        "website": current_term.get("url"),
        "contact_form": current_term.get("contact_form"),
        "first_term_start": first_term_start,
        "total_terms": total_terms,
        "senate_terms": senate_terms,
        "house_terms": house_terms,
        "external_ids": {
            "thomas": ids.get("thomas"),
            "govtrack": ids.get("govtrack"),
            "opensecrets": ids.get("opensecrets"),
            "votesmart": ids.get("votesmart"),
            "wikipedia": ids.get("wikipedia"),
            "ballotpedia": ids.get("ballotpedia"),
            "twitter": social.get("twitter"),
            "youtube": social.get("youtube"),
            "youtube_id": social.get("youtube_id"),
            "facebook": social.get("facebook"),
            "instagram": social.get("instagram"),
        }
    }
    
    # Add Senate-specific fields
    if chamber == "Senate":
        data["state_rank"] = current_term.get("state_rank")
        data["senate_class"] = current_term.get("class")
    
    # Add House-specific fields
    if chamber == "House":
        data["district"] = current_term.get("district")
    
    return data

def import_legislators():
    """Import all current legislators into Firestore."""
    
    raw_legislators = fetch_legislators()
    social_lookup = fetch_social_media()
    
    # Transform all legislators
    legislators = []
    for leg in raw_legislators:
        legislator_data = extract_legislator_data(leg, social_lookup)
        if legislator_data:
            legislators.append(legislator_data)
    
    senators = [l for l in legislators if l["chamber"] == "Senate"]
    representatives = [l for l in legislators if l["chamber"] == "House"]
    
    print(f"Found {len(senators)} senators and {len(representatives)} representatives")
    print(f"Total: {len(legislators)} legislators")
    
    # Clear existing legislators collection
    print("Clearing existing legislators collection...")
    existing = db.collection("legislators").stream()
    for doc in existing:
        doc.reference.delete()
    
    # Import legislators
    print("Importing legislators...")
    for legislator in legislators:
        # Use bioguide_id as document ID for easy lookups
        doc_ref = db.collection("legislators").document(legislator["bioguide_id"])
        doc_ref.set(legislator)
    
    print(f"\nSuccessfully imported {len(legislators)} legislators!")
    
    # Print summary by chamber and party
    print("\nBreakdown by chamber:")
    print(f"  Senate: {len(senators)}")
    print(f"  House: {len(representatives)}")
    
    print("\nBreakdown by party:")
    parties = {}
    for l in legislators:
        party = l["party"]
        parties[party] = parties.get(party, 0) + 1
    for party, count in sorted(parties.items()):
        print(f"  {party}: {count}")

if __name__ == "__main__":
    import_legislators()
