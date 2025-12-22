"""
Import committee data from @unitedstates/congress-legislators project.
Run this script to populate/update committee data in Firestore.

Data sources:
- committees-current.json: Committee names and metadata
- committee-membership-current.json: Which legislators serve on which committees

Usage:
    cd backend
    source venv/bin/activate
    python import_committees.py
"""

import requests
import firebase_admin
from firebase_admin import credentials, firestore

# Initialize Firebase if not already done
try:
    firebase_admin.get_app()
except ValueError:
    cred = credentials.Certificate("firebase-credentials.json")
    firebase_admin.initialize_app(cred)

db = firestore.client()

# Data URLs
COMMITTEES_URL = "https://unitedstates.github.io/congress-legislators/committees-current.json"
MEMBERSHIP_URL = "https://unitedstates.github.io/congress-legislators/committee-membership-current.json"

def fetch_json(url):
    """Fetch JSON data from URL."""
    print(f"Fetching {url}...")
    response = requests.get(url)
    response.raise_for_status()
    return response.json()

def import_committees():
    """Import committee definitions."""
    committees_data = fetch_json(COMMITTEES_URL)
    
    print(f"\nFound {len(committees_data)} committees")
    
    # Clear existing committees
    committees_ref = db.collection("committees")
    existing = committees_ref.stream()
    for doc in existing:
        doc.reference.delete()
    print("Cleared existing committee data")
    
    # Import committees
    for committee in committees_data:
        thomas_id = committee.get("thomas_id")
        if not thomas_id:
            continue
            
        committee_doc = {
            "thomas_id": thomas_id,
            "name": committee.get("name", ""),
            "type": committee.get("type", ""),  # house, senate, or joint
            "url": committee.get("url", ""),
            "jurisdiction": committee.get("jurisdiction", ""),
            "rss_url": committee.get("rss_url", ""),
            "minority_url": committee.get("minority_rss_url", ""),
        }
        
        # Handle subcommittees
        subcommittees = []
        for sub in committee.get("subcommittees", []):
            subcommittees.append({
                "thomas_id": sub.get("thomas_id", ""),
                "name": sub.get("name", ""),
                "phone": sub.get("phone", ""),
            })
        committee_doc["subcommittees"] = subcommittees
        
        committees_ref.document(thomas_id).set(committee_doc)
    
    print(f"Imported {len(committees_data)} committees")
    return committees_data

def import_membership(committees_data):
    """Import committee membership data."""
    membership_data = fetch_json(MEMBERSHIP_URL)
    
    # Build a lookup for committee names
    committee_names = {}
    for committee in committees_data:
        thomas_id = committee.get("thomas_id")
        if thomas_id:
            committee_names[thomas_id] = committee.get("name", "")
            # Also add subcommittees
            for sub in committee.get("subcommittees", []):
                full_id = thomas_id + sub.get("thomas_id", "")
                committee_names[full_id] = sub.get("name", "")
    
    # Clear existing memberships
    memberships_ref = db.collection("committee_memberships")
    existing = memberships_ref.stream()
    for doc in existing:
        doc.reference.delete()
    print("Cleared existing membership data")
    
    # Process membership - reorganize by bioguide_id
    member_committees = {}  # bioguide_id -> list of committee assignments
    
    for committee_id, members in membership_data.items():
        # Determine if this is a subcommittee (has parent)
        is_subcommittee = len(committee_id) > 4  # Subcommittees have format like "HSAG03"
        
        # Get parent committee ID for subcommittees
        if is_subcommittee:
            parent_id = committee_id[:4]
            parent_name = committee_names.get(parent_id, "")
        else:
            parent_id = None
            parent_name = None
        
        committee_name = committee_names.get(committee_id, committee_id)
        
        for member in members:
            bioguide = member.get("bioguide")
            if not bioguide:
                continue
            
            if bioguide not in member_committees:
                member_committees[bioguide] = []
            
            assignment = {
                "committee_id": committee_id,
                "committee_name": committee_name,
                "is_subcommittee": is_subcommittee,
                "parent_committee_id": parent_id,
                "parent_committee_name": parent_name,
                "rank": member.get("rank"),
                "title": member.get("title"),  # Chair, Vice Chair, Ranking Member, etc.
                "party": member.get("party"),  # majority or minority
            }
            member_committees[bioguide].append(assignment)
    
    # Save to Firestore
    count = 0
    for bioguide, assignments in member_committees.items():
        # Sort: main committees first, then subcommittees; titles before regular members
        def sort_key(a):
            # Leadership positions first
            title_order = 0 if a.get("title") else 1
            # Main committees before subcommittees
            sub_order = 1 if a.get("is_subcommittee") else 0
            # Then by rank
            rank = a.get("rank") or 999
            return (sub_order, title_order, rank)
        
        assignments.sort(key=sort_key)
        
        memberships_ref.document(bioguide).set({
            "bioguide_id": bioguide,
            "committees": assignments
        })
        count += 1
    
    print(f"Imported membership data for {count} legislators")
    
    # Print some stats
    total_assignments = sum(len(v) for v in member_committees.values())
    print(f"Total committee/subcommittee assignments: {total_assignments}")

def main():
    print("=" * 60)
    print("Importing Congressional Committee Data")
    print("=" * 60)
    
    committees = import_committees()
    import_membership(committees)
    
    print("\n" + "=" * 60)
    print("Import complete!")
    print("=" * 60)

if __name__ == "__main__":
    main()