import firebase_admin
from firebase_admin import credentials, firestore
import json
import os

# Initialize Firebase (only if not already initialized)
try:
    firebase_admin.get_app()
except ValueError:
    cred = credentials.Certificate("firebase-credentials.json")
    firebase_admin.initialize_app(cred)

db = firestore.client()

def load_governors():
    """Load governors data from local JSON file."""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    json_path = os.path.join(script_dir, "governors-current.json")

    print(f"Loading governors from {json_path}...")
    with open(json_path, 'r') as f:
        return json.load(f)

def extract_governor_data(governor):
    """Extract relevant fields for a governor from the raw data."""

    # Get the most recent term
    terms = governor.get("terms", [])
    if not terms:
        return None

    current_term = terms[-1]
    name = governor.get("name", {})
    bio = governor.get("bio", {})
    ids = governor.get("id", {})
    external_ids = governor.get("id_external", {})

    state = current_term.get("state")

    # Create bioguide-style ID for governors: GOV-{state}
    bioguide_id = f"GOV-{state}"

    # Build full name from parts if official_full is not available
    full_name = name.get("official_full")
    if not full_name:
        first = name.get("first", "")
        middle = name.get("middle", "")
        last = name.get("last", "")
        full_name = f"{first} {middle} {last}".replace("  ", " ").strip()

    # Clean up social media handles (remove "prior: prior" placeholders)
    twitter = external_ids.get("twitter")
    if twitter and "prior" in twitter.lower():
        twitter = None

    facebook = external_ids.get("facebook")
    if facebook and "prior" in facebook.lower():
        facebook = None

    youtube = external_ids.get("youtube")
    if youtube and "prior" in youtube.lower():
        youtube = None

    data = {
        "bioguide_id": bioguide_id,
        "first_name": name.get("first"),
        "last_name": name.get("last"),
        "full_name": full_name,
        "party": current_term.get("party"),
        "state": state,
        "chamber": "Governor",
        "term_start": current_term.get("start"),
        "term_end": current_term.get("end"),
        "birthday": bio.get("birthday"),
        "gender": bio.get("gender"),
        "phone": current_term.get("phone"),
        "office": current_term.get("office"),
        "website": current_term.get("url"),
        "contact_form": current_term.get("contact_form"),
        "photo_url": governor.get("photo_url"),
        "external_ids": {
            "wikipedia": external_ids.get("wikipedia"),
            "ballotpedia": external_ids.get("ballotpedia"),
            "twitter": twitter,
            "youtube": youtube,
            "facebook": facebook,
        }
    }

    return data

def import_governors(clear_existing=False):
    """Import all current governors into Firestore.

    Args:
        clear_existing: If True, delete existing governors before importing.
                       If False (default), add/update governors without affecting legislators.
    """

    raw_governors = load_governors()

    # Transform all governors
    governors = []
    for gov in raw_governors:
        governor_data = extract_governor_data(gov)
        if governor_data:
            governors.append(governor_data)

    print(f"Found {len(governors)} governors")

    if clear_existing:
        # Only delete existing governor documents (not legislators)
        print("Clearing existing governors from collection...")
        existing = db.collection("legislators").where("chamber", "==", "Governor").stream()
        deleted_count = 0
        for doc in existing:
            doc.reference.delete()
            deleted_count += 1
        print(f"Deleted {deleted_count} existing governor records")

    # Import governors
    print("Importing governors...")
    for governor in governors:
        # Use bioguide_id as document ID for easy lookups
        doc_ref = db.collection("legislators").document(governor["bioguide_id"])
        doc_ref.set(governor)

    print(f"\nSuccessfully imported {len(governors)} governors!")

    # Print summary by party
    print("\nBreakdown by party:")
    parties = {}
    for g in governors:
        party = g["party"]
        parties[party] = parties.get(party, 0) + 1
    for party, count in sorted(parties.items()):
        print(f"  {party}: {count}")

    # Print summary by state
    print(f"\nStates covered: {len(set(g['state'] for g in governors))}")

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Import governor data into Firestore")
    parser.add_argument("--clear", action="store_true",
                        help="Clear existing governors before importing")

    args = parser.parse_args()
    import_governors(clear_existing=args.clear)
