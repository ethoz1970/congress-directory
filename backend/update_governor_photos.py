#!/usr/bin/env python3
"""
Fetch current governor photos from NGA website and update governors-current.json
"""

import json
import re
import time
import urllib.request
from pathlib import Path

# State name to abbreviation mapping
STATE_ABBREVS = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR",
    "california": "CA", "colorado": "CO", "connecticut": "CT", "delaware": "DE",
    "florida": "FL", "georgia": "GA", "hawaii": "HI", "idaho": "ID",
    "illinois": "IL", "indiana": "IN", "iowa": "IA", "kansas": "KS",
    "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD",
    "massachusetts": "MA", "michigan": "MI", "minnesota": "MN", "mississippi": "MS",
    "missouri": "MO", "montana": "MT", "nebraska": "NE", "nevada": "NV",
    "new-hampshire": "NH", "new-jersey": "NJ", "new-mexico": "NM", "new-york": "NY",
    "north-carolina": "NC", "north-dakota": "ND", "ohio": "OH", "oklahoma": "OK",
    "oregon": "OR", "pennsylvania": "PA", "rhode-island": "RI", "south-carolina": "SC",
    "south-dakota": "SD", "tennessee": "TN", "texas": "TX", "utah": "UT",
    "vermont": "VT", "virginia": "VA", "washington": "WA", "west-virginia": "WV",
    "wisconsin": "WI", "wyoming": "WY"
}

ABBREV_TO_STATE = {v: k for k, v in STATE_ABBREVS.items()}

def fetch_nga_photo(state_slug):
    """Fetch governor photo URL from NGA website"""
    url = f"https://www.nga.org/governors/{state_slug}/"
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=10) as response:
            html = response.read().decode('utf-8')

        # Look for governor photo - usually in wp-content/uploads
        # Pattern: src="https://www.nga.org/wp-content/uploads/....(jpg|png|jpeg)"
        patterns = [
            r'<img[^>]+src=["\']([^"\']*nga\.org/wp-content/uploads/[^"\']+(?:headshot|official|governor|portrait)[^"\']*\.(?:jpg|png|jpeg))["\']',
            r'<img[^>]+src=["\']([^"\']*nga\.org/wp-content/uploads/\d{4}/\d{2}/[^"\']+\.(?:jpg|png|jpeg))["\']',
        ]

        for pattern in patterns:
            matches = re.findall(pattern, html, re.IGNORECASE)
            if matches:
                # Return first match that looks like a headshot
                for match in matches:
                    if 'logo' not in match.lower() and 'icon' not in match.lower():
                        return match

        return None
    except Exception as e:
        print(f"  Error fetching {state_slug}: {e}")
        return None

def main():
    # Load current governors data
    json_path = Path(__file__).parent / "governors-current.json"
    with open(json_path, 'r') as f:
        governors = json.load(f)

    print(f"Updating photos for {len(governors)} governors...")

    updated = 0
    for gov in governors:
        # State is nested in terms[0].state
        terms = gov.get('terms', [])
        state_abbrev = terms[0].get('state') if terms else None
        state_slug = ABBREV_TO_STATE.get(state_abbrev)

        if not state_slug:
            print(f"  Unknown state: {state_abbrev}")
            continue

        name = gov.get('name', {}).get('official_full', 'Unknown')
        print(f"Fetching {state_abbrev} ({name})...", end=" ")

        photo_url = fetch_nga_photo(state_slug)
        if photo_url:
            gov['photo_url'] = photo_url
            print(f"OK: {photo_url[:60]}...")
            updated += 1
        else:
            print("NOT FOUND")

        # Be nice to the server
        time.sleep(0.5)

    # Save updated data
    with open(json_path, 'w') as f:
        json.dump(governors, f, indent=2)

    print(f"\nUpdated {updated}/{len(governors)} governor photos")
    print(f"Saved to {json_path}")

if __name__ == "__main__":
    main()
