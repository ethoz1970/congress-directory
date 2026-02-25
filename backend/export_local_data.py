"""
Export Firestore legislators data to a local JSON file for fast local development.

Usage:
    python export_local_data.py

Creates backend/local_data/legislators.json
"""

import json
import os
import firebase_admin
from firebase_admin import credentials, firestore
from datetime import datetime

cred = credentials.Certificate("firebase-credentials.json")
firebase_admin.initialize_app(cred)
db = firestore.client()

def serialize(obj):
    """Handle Firestore timestamps and other non-serializable types."""
    if hasattr(obj, 'isoformat'):
        return obj.isoformat()
    if hasattr(obj, 'timestamp'):
        return obj.isoformat() if hasattr(obj, 'isoformat') else str(obj)
    raise TypeError(f"Object of type {type(obj)} is not JSON serializable")

def export_collection(name):
    print(f"Exporting {name}...")
    docs = db.collection(name).stream()
    items = []
    for doc in docs:
        item = doc.to_dict()
        item["id"] = doc.id
        items.append(item)
    print(f"  -> {len(items)} documents")
    return items

def main():
    os.makedirs("local_data", exist_ok=True)

    # Export legislators
    legislators = export_collection("legislators")
    legislators.sort(key=lambda l: (l.get("state", ""), l.get("chamber", ""), l.get("last_name", "")))
    with open("local_data/legislators.json", "w") as f:
        json.dump(legislators, f, default=serialize, indent=2)

    # Export committee memberships
    memberships = export_collection("committee_memberships")
    with open("local_data/committee_memberships.json", "w") as f:
        json.dump(memberships, f, default=serialize, indent=2)

    # Export committees
    committees = export_collection("committees")
    with open("local_data/committees.json", "w") as f:
        json.dump(committees, f, default=serialize, indent=2)

    print(f"\nDone! Files written to local_data/")
    print(f"Set USE_LOCAL_DATA=true when running the backend to use these files.")

if __name__ == "__main__":
    main()
