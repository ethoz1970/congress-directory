import firebase_admin
from firebase_admin import credentials, firestore
import requests

# Initialize Firebase
cred = credentials.Certificate("firebase-credentials.json")
firebase_admin.initialize_app(cred)
db = firestore.client()

# Fetch current legislators from @unitedstates project
DATA_URL = "https://unitedstates.github.io/congress-legislators/legislators-current.json"

def fetch_legislators():
    """Fetch current legislators from the @unitedstates project."""
    print("Fetching legislators data...")
    response = requests.get(DATA_URL)
    response.raise_for_status()
    return response.json()

def extract_senator_data(legislator):
    """Extract relevant fields for a senator from the raw data."""
    
    # Get the most recent term
    terms = legislator.get("terms", [])
    if not terms:
        return None
    
    current_term = terms[-1]
    
    # Only process senators
    if current_term.get("type") != "sen":
        return None
    
    name = legislator.get("name", {})
    bio = legislator.get("bio", {})
    ids = legislator.get("id", {})
    
    return {
        "bioguide_id": ids.get("bioguide"),
        "first_name": name.get("first"),
        "last_name": name.get("last"),
        "full_name": name.get("official_full"),
        "nickname": name.get("nickname"),
        "party": current_term.get("party"),
        "caucus": current_term.get("caucus"),
        "state": current_term.get("state"),
        "state_rank": current_term.get("state_rank"),
        "class": current_term.get("class"),
        "term_start": current_term.get("start"),
        "term_end": current_term.get("end"),
        "birthday": bio.get("birthday"),
        "gender": bio.get("gender"),
        "phone": current_term.get("phone"),
        "office": current_term.get("office"),
        "website": current_term.get("url"),
        "contact_form": current_term.get("contact_form"),
        "external_ids": {
            "thomas": ids.get("thomas"),
            "govtrack": ids.get("govtrack"),
            "opensecrets": ids.get("opensecrets"),
            "votesmart": ids.get("votesmart"),
            "wikipedia": ids.get("wikipedia"),
            "ballotpedia": ids.get("ballotpedia"),
        }
    }

def import_senators():
    """Import all current senators into Firestore."""
    
    legislators = fetch_legislators()
    
    # Filter and transform to senators only
    senators = []
    for leg in legislators:
        senator_data = extract_senator_data(leg)
        if senator_data:
            senators.append(senator_data)
    
    print(f"Found {len(senators)} current senators")
    
    # Clear existing senators collection (optional - comment out to append)
    print("Clearing existing senators collection...")
    existing = db.collection("senators").stream()
    for doc in existing:
        doc.reference.delete()
    
    # Import senators
    print("Importing senators...")
    for senator in senators:
        # Use bioguide_id as document ID for easy lookups
        doc_ref = db.collection("senators").document(senator["bioguide_id"])
        doc_ref.set(senator)
        print(f"  Imported: {senator['full_name']} ({senator['state']})")
    
    print(f"\nSuccessfully imported {len(senators)} senators!")
    
    # Print summary by party
    parties = {}
    for s in senators:
        party = s["party"]
        parties[party] = parties.get(party, 0) + 1
    
    print("\nBreakdown by party:")
    for party, count in sorted(parties.items()):
        print(f"  {party}: {count}")

if __name__ == "__main__":
    import_senators()