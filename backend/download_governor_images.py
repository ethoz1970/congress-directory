#!/usr/bin/env python3
"""
Downloads all governor images from NGA to frontend/public/governors/
and updates governors-current.json with local paths.
"""

import json
import os
import time
import urllib.request
from pathlib import Path


def download_image(url, output_path):
    """Download an image from URL to local path."""
    try:
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        })
        with urllib.request.urlopen(req, timeout=30) as response:
            with open(output_path, 'wb') as f:
                f.write(response.read())
        return True
    except Exception as e:
        print(f"  Error downloading: {e}")
        return False


def main():
    # Paths
    script_dir = Path(__file__).parent
    json_path = script_dir / "governors-current.json"
    output_dir = script_dir.parent / "frontend" / "public" / "governors"

    # Create output directory
    output_dir.mkdir(parents=True, exist_ok=True)
    print(f"Output directory: {output_dir}")

    # Load governors data
    with open(json_path, 'r') as f:
        governors = json.load(f)

    print(f"Found {len(governors)} governors\n")

    downloaded = 0
    failed = []

    for gov in governors:
        # Get state from terms
        terms = gov.get('terms', [])
        if not terms:
            continue

        state = terms[0].get('state')
        name = gov.get('name', {}).get('official_full', 'Unknown')
        photo_url = gov.get('photo_url')

        if not state or not photo_url:
            print(f"Skipping {name}: missing state or photo_url")
            failed.append(state or 'UNKNOWN')
            continue

        # Determine file extension from URL
        ext = '.jpg'
        if '.png' in photo_url.lower():
            ext = '.png'
        elif '.jpeg' in photo_url.lower():
            ext = '.jpeg'

        output_file = output_dir / f"{state}{ext}"
        local_path = f"/governors/{state}{ext}"

        print(f"Downloading {state} ({name})...", end=" ")

        if download_image(photo_url, output_file):
            print(f"OK -> {output_file.name}")
            # Update the photo_url to local path
            gov['photo_url'] = local_path
            downloaded += 1
        else:
            print("FAILED")
            failed.append(state)

        # Be nice to the server
        time.sleep(0.3)

    # Save updated JSON with local paths
    with open(json_path, 'w') as f:
        json.dump(governors, f, indent=2)

    print(f"\n{'='*50}")
    print(f"Downloaded: {downloaded}/{len(governors)}")
    print(f"Failed: {len(failed)}")
    if failed:
        print(f"Failed states: {', '.join(failed)}")
    print(f"\nUpdated {json_path}")
    print(f"Images saved to {output_dir}")
    print(f"\nNext steps:")
    print(f"  1. Run: python import_governors.py --clear")
    print(f"  2. Run: curl -X POST http://localhost:8002/api/cache/clear")


if __name__ == "__main__":
    main()
