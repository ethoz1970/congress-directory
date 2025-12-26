#!/usr/bin/env python3
"""
Import GovTrack ideology and leadership scores for all members of Congress.
Data is fetched from GovTrack's public CSV files and stored in Firestore.

Usage:
    python import_ideology.py [--congress 118]

The scores are:
- ideology: Left-right score (lower = more liberal, higher = more conservative)
- leadership: PageRank-based leadership score (higher = more influential)
"""

import os
import sys
import csv
import argparse
import requests
import firebase_admin
from firebase_admin import credentials, firestore
from io import StringIO

# Initialize Firebase
cred = credentials.Certificate("firebase-credentials.json")
try:
    firebase_admin.initialize_app(cred)
except ValueError:
    # Already initialized
    pass
db = firestore.client()

# GovTrack data URLs
GOVTRACK_DATA_BASE = "https://www.govtrack.us/data/analysis/by-congress"

def fetch_sponsorship_analysis(congress: int, chamber: str) -> list:
    """
    Fetch sponsorship analysis data from GovTrack.
    
    Args:
        congress: Congress number (e.g., 118)
        chamber: 'h' for House, 's' for Senate
    
    Returns:
        List of dictionaries with member data
    """
    url = f"{GOVTRACK_DATA_BASE}/{congress}/sponsorshipanalysis_{chamber}.txt"
    print(f"Fetching {url}...")
    
    try:
        response = requests.get(url, timeout=30)
        response.raise_for_status()
        
        # Parse CSV
        reader = csv.DictReader(StringIO(response.text))
        members = []
        for row in reader:
            members.append({
                "govtrack_id": int(row["ID"]),
                "ideology": float(row["ideology"]) if row["ideology"] else None,
                "leadership": float(row["leadership"]) if row["leadership"] else None,
                "name": row["name"],
                "party": row["party"],
                "description": row["description"],
            })
        
        print(f"  Found {len(members)} members")
        return members
        
    except requests.exceptions.RequestException as e:
        print(f"  Error fetching data: {e}")
        return []

def get_legislator_by_govtrack_id(govtrack_id: int):
    """Look up a legislator by their GovTrack ID."""
    # Query legislators collection for matching govtrack_id
    docs = db.collection("legislators").where(
        "external_ids.govtrack", "==", govtrack_id
    ).limit(1).stream()
    
    for doc in docs:
        return doc.id, doc.to_dict()
    
    return None, None

def update_legislator_scores(bioguide_id: str, ideology: float, leadership: float):
    """Update a legislator's ideology and leadership scores."""
    doc_ref = db.collection("legislators").document(bioguide_id)
    doc_ref.update({
        "ideology_score": ideology,
        "leadership_score": leadership,
    })

def main():
    parser = argparse.ArgumentParser(description="Import GovTrack ideology scores")
    parser.add_argument("--congress", type=int, default=118, help="Congress number (default: 118)")
    args = parser.parse_args()
    
    print("=" * 60)
    print(f"GovTrack Ideology Import - {args.congress}th Congress")
    print("=" * 60)
    
    # Fetch data for both chambers
    house_members = fetch_sponsorship_analysis(args.congress, "h")
    senate_members = fetch_sponsorship_analysis(args.congress, "s")
    
    all_members = house_members + senate_members
    print(f"\nTotal members with scores: {len(all_members)}")
    
    # Build lookup by GovTrack ID
    scores_by_govtrack = {}
    for member in all_members:
        if member["ideology"] is not None:
            scores_by_govtrack[member["govtrack_id"]] = {
                "ideology": member["ideology"],
                "leadership": member["leadership"],
                "name": member["name"],
            }
    
    print(f"Members with valid ideology scores: {len(scores_by_govtrack)}")
    
    # Get all legislators from Firestore
    print("\nFetching legislators from Firestore...")
    legislators = db.collection("legislators").stream()
    
    updated = 0
    not_found = 0
    no_score = 0
    
    for doc in legislators:
        data = doc.to_dict()
        bioguide_id = doc.id
        full_name = data.get("full_name", "Unknown")
        
        # Get GovTrack ID from external_ids
        external_ids = data.get("external_ids", {})
        govtrack_id = external_ids.get("govtrack")
        
        if not govtrack_id:
            print(f"  No GovTrack ID for {full_name}")
            not_found += 1
            continue
        
        # Look up scores
        if govtrack_id in scores_by_govtrack:
            scores = scores_by_govtrack[govtrack_id]
            ideology = scores["ideology"]
            leadership = scores["leadership"]
            
            # Update Firestore
            update_legislator_scores(bioguide_id, ideology, leadership)
            print(f"  ✓ {full_name}: ideology={ideology:.3f}, leadership={leadership:.3f}")
            updated += 1
        else:
            print(f"  - {full_name}: No score available (new member or insufficient data)")
            no_score += 1
    
    print("\n" + "=" * 60)
    print("Import Complete!")
    print(f"  Updated: {updated}")
    print(f"  No GovTrack ID: {not_found}")
    print(f"  No score available: {no_score}")
    print("=" * 60)
    
    # Print ideology range info
    if scores_by_govtrack:
        ideologies = [s["ideology"] for s in scores_by_govtrack.values()]
        print(f"\nIdeology score range: {min(ideologies):.3f} to {max(ideologies):.3f}")
        print("(Lower = more liberal/progressive, Higher = more conservative)")

if __name__ == "__main__":
    main()

