#!/usr/bin/env python3
"""
Downloads all legislator images from @unitedstates/images GitHub repo
and stores them locally in frontend/public/legislators/
"""

import argparse
import json
import os
import time
import urllib.request
from pathlib import Path

# URLs
LEGISLATORS_URL = "https://unitedstates.github.io/congress-legislators/legislators-current.json"
IMAGE_BASE_URL = "https://raw.githubusercontent.com/unitedstates/images/gh-pages/congress/450x550"


def fetch_legislators():
    """Fetch current legislators list from @unitedstates project."""
    print("Fetching legislators list...")
    req = urllib.request.Request(LEGISLATORS_URL, headers={
        'User-Agent': 'Mozilla/5.0'
    })
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.loads(response.read().decode('utf-8'))


def download_image(bioguide_id, output_path):
    """Download a legislator image from GitHub."""
    url = f"{IMAGE_BASE_URL}/{bioguide_id}.jpg"
    try:
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0'
        })
        with urllib.request.urlopen(req, timeout=30) as response:
            with open(output_path, 'wb') as f:
                f.write(response.read())
        return True
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return False  # Image not found - not an error
        print(f"  HTTP Error {e.code}: {e.reason}")
        return False
    except Exception as e:
        print(f"  Error: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(description='Download legislator images')
    parser.add_argument('--force', action='store_true',
                        help='Re-download existing images')
    args = parser.parse_args()

    # Paths
    script_dir = Path(__file__).parent
    output_dir = script_dir.parent / "frontend" / "public" / "legislators"

    # Create output directory
    output_dir.mkdir(parents=True, exist_ok=True)
    print(f"Output directory: {output_dir}")

    # Fetch legislators
    legislators = fetch_legislators()
    print(f"Found {len(legislators)} legislators\n")

    downloaded = 0
    skipped = 0
    not_found = 0
    failed = []

    for i, leg in enumerate(legislators, 1):
        bioguide_id = leg.get('id', {}).get('bioguide')
        name = leg.get('name', {}).get('official_full', 'Unknown')

        if not bioguide_id:
            print(f"Skipping {name}: no bioguide_id")
            continue

        output_file = output_dir / f"{bioguide_id}.jpg"

        # Skip if already exists (unless --force)
        if output_file.exists() and not args.force:
            skipped += 1
            continue

        print(f"[{i}/{len(legislators)}] Downloading {bioguide_id} ({name})...", end=" ")

        if download_image(bioguide_id, output_file):
            print("OK")
            downloaded += 1
        else:
            if not output_file.exists():
                print("NOT FOUND")
                not_found += 1
            else:
                print("FAILED")
                failed.append(bioguide_id)

        # Rate limiting - be nice to GitHub
        time.sleep(0.1)

    print(f"\n{'='*50}")
    print(f"Downloaded: {downloaded}")
    print(f"Skipped (already exists): {skipped}")
    print(f"Not found: {not_found}")
    print(f"Failed: {len(failed)}")
    if failed:
        print(f"Failed IDs: {', '.join(failed[:10])}{'...' if len(failed) > 10 else ''}")

    total_images = len(list(output_dir.glob("*.jpg")))
    print(f"\nTotal images in directory: {total_images}")
    print(f"\nNext steps:")
    print(f"  1. Run: python import_legislators.py")
    print(f"  2. Run: curl -X POST http://localhost:8002/api/cache/clear")


if __name__ == "__main__":
    main()
