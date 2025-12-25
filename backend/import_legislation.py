#!/usr/bin/env python3
"""
Import legislation data for all members of Congress into Firestore.
This script fetches sponsored/cosponsored legislation counts and enacted bills
from the Congress.gov API and stores them in Firestore for quick access.

Usage:
    python import_legislation.py [--force] [--limit N] [--delay SECONDS]

Options:
    --force     Force refresh even if cached data exists
    --limit N   Only process N legislators (for testing)
    --delay S   Delay between API calls in seconds (default: 0.5)
"""

import os
import sys
import time
import argparse
import requests
import firebase_admin
from firebase_admin import credentials, firestore
from datetime import datetime, timezone, timedelta

# Initialize Firebase
cred = credentials.Certificate("firebase-credentials.json")
try:
    firebase_admin.initialize_app(cred)
except ValueError:
    # Already initialized
    pass
db = firestore.client()

# Congress.gov API configuration
CONGRESS_API_KEY = os.environ.get("CONGRESS_API_KEY", "h1wzKqEKckOfc62GgSCc2NYq6g7iKevWraaXiEaO")
CONGRESS_API_BASE = "https://api.congress.gov/v3"

def get_all_legislators():
    """Get all legislators from Firestore."""
    print("Fetching legislators from Firestore...")
    legislators = []
    docs = db.collection("legislators").stream()
    for doc in docs:
        data = doc.to_dict()
        legislators.append({
            "bioguide_id": data.get("bioguide_id"),
            "full_name": data.get("full_name"),
            "chamber": data.get("chamber"),
            "party": data.get("party")
        })
    print(f"Found {len(legislators)} legislators")
    return legislators

def check_cache(bioguide_id, force=False):
    """Check if we have recent cached data for this legislator."""
    if force:
        return None
    
    cache_ref = db.collection("legislation_cache").document(bioguide_id)
    cache_doc = cache_ref.get()
    
    if cache_doc.exists:
        cache_data = cache_doc.to_dict()
        cached_at = cache_data.get("cached_at")
        if cached_at:
            if hasattr(cached_at, 'timestamp'):
                cache_age = datetime.now(timezone.utc) - cached_at.replace(tzinfo=timezone.utc)
                if cache_age < timedelta(hours=24):
                    return cache_data
    return None

def fetch_legislation_data(bioguide_id, delay=0.5):
    """Fetch legislation data from Congress.gov API."""
    sponsored_count = 0
    cosponsored_count = 0
    enacted_count = 0
    recent_sponsored = []
    recent_enacted = []
    
    headers = {"accept": "application/json"}
    
    # Get sponsored legislation
    try:
        url = f"{CONGRESS_API_BASE}/member/{bioguide_id}/sponsored-legislation"
        params = {"api_key": CONGRESS_API_KEY, "format": "json", "limit": 250}
        response = requests.get(url, params=params, headers=headers, timeout=30)
        
        if response.status_code == 200:
            data = response.json()
            sponsored_count = data.get("pagination", {}).get("count", 0)
            all_sponsored = data.get("sponsoredLegislation", [])
            recent_sponsored = all_sponsored[:5]
            
            # Count enacted bills
            for bill in all_sponsored:
                latest_action = bill.get("latestAction", {})
                action_text = latest_action.get("text", "") if latest_action else ""
                if "Became Public Law" in action_text or "became public law" in action_text.lower():
                    enacted_count += 1
                    if len(recent_enacted) < 5:
                        recent_enacted.append(bill)
            
            # Paginate if more than 250 bills
            total_count = data.get("pagination", {}).get("count", 0)
            if total_count > 250:
                offset = 250
                while offset < total_count:
                    time.sleep(delay)  # Rate limiting
                    params["offset"] = offset
                    response = requests.get(url, params=params, headers=headers, timeout=30)
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
        elif response.status_code == 429:
            print(f"  Rate limited, waiting 60 seconds...")
            time.sleep(60)
            return fetch_legislation_data(bioguide_id, delay)
    except Exception as e:
        print(f"  Error fetching sponsored legislation: {e}")
    
    time.sleep(delay)  # Rate limiting between calls
    
    # Get cosponsored legislation count
    try:
        url = f"{CONGRESS_API_BASE}/member/{bioguide_id}/cosponsored-legislation"
        params = {"api_key": CONGRESS_API_KEY, "format": "json", "limit": 1}
        response = requests.get(url, params=params, headers=headers, timeout=30)
        
        if response.status_code == 200:
            data = response.json()
            cosponsored_count = data.get("pagination", {}).get("count", 0)
        elif response.status_code == 429:
            print(f"  Rate limited, waiting 60 seconds...")
            time.sleep(60)
    except Exception as e:
        print(f"  Error fetching cosponsored legislation: {e}")
    
    return {
        "bioguide_id": bioguide_id,
        "sponsored_count": sponsored_count,
        "cosponsored_count": cosponsored_count,
        "enacted_count": enacted_count,
        "recent_sponsored": recent_sponsored,
        "recent_enacted": recent_enacted,
    }

def save_to_firestore(data):
    """Save legislation data to Firestore."""
    bioguide_id = data["bioguide_id"]
    
    # Add timestamp
    data["cached_at"] = datetime.now(timezone.utc)
    
    # Save to legislation_cache collection
    cache_ref = db.collection("legislation_cache").document(bioguide_id)
    cache_ref.set(data)
    
    # Also update the legislator document with summary stats
    legislator_ref = db.collection("legislators").document(bioguide_id)
    legislator_ref.update({
        "sponsored_count": data["sponsored_count"],
        "cosponsored_count": data["cosponsored_count"],
        "enacted_count": data["enacted_count"],
        "legislation_updated_at": data["cached_at"]
    })

def main():
    parser = argparse.ArgumentParser(description="Import legislation data for all members")
    parser.add_argument("--force", action="store_true", help="Force refresh even if cached")
    parser.add_argument("--limit", type=int, default=0, help="Limit number of legislators to process")
    parser.add_argument("--delay", type=float, default=0.5, help="Delay between API calls in seconds")
    args = parser.parse_args()
    
    print("=" * 60)
    print("Legislation Import Script")
    print("=" * 60)
    
    # Get all legislators
    legislators = get_all_legislators()
    
    if args.limit > 0:
        legislators = legislators[:args.limit]
        print(f"Limited to {args.limit} legislators")
    
    # Process each legislator
    processed = 0
    skipped = 0
    errors = 0
    
    total = len(legislators)
    
    for i, legislator in enumerate(legislators):
        bioguide_id = legislator["bioguide_id"]
        full_name = legislator["full_name"]
        
        print(f"\n[{i+1}/{total}] {full_name} ({bioguide_id})")
        
        # Check cache first
        cached = check_cache(bioguide_id, force=args.force)
        if cached:
            print(f"  Using cached data (enacted: {cached.get('enacted_count', 0)})")
            skipped += 1
            continue
        
        # Fetch fresh data
        try:
            data = fetch_legislation_data(bioguide_id, delay=args.delay)
            save_to_firestore(data)
            print(f"  Sponsored: {data['sponsored_count']}, Cosponsored: {data['cosponsored_count']}, Enacted: {data['enacted_count']}")
            processed += 1
        except Exception as e:
            print(f"  ERROR: {e}")
            errors += 1
        
        # Rate limiting
        time.sleep(args.delay)
    
    print("\n" + "=" * 60)
    print(f"Import Complete!")
    print(f"  Processed: {processed}")
    print(f"  Skipped (cached): {skipped}")
    print(f"  Errors: {errors}")
    print("=" * 60)

if __name__ == "__main__":
    main()