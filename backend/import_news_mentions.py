#!/usr/bin/env python3
"""
Import news mention counts for all members of Congress using GNews API.
Counts how many news articles mention each member in the last 30 days.

Usage:
    python import_news_mentions.py [--limit 100] [--api-key YOUR_KEY]

Get your free API key at: https://gnews.io/

Free tier: 100 requests/day
Strategy: Run daily for ~100 members, cycle through all 541 over ~6 days
"""

import os
import sys
import argparse
import requests
import time
import firebase_admin
from firebase_admin import credentials, firestore
from datetime import datetime, timedelta

# Initialize Firebase
cred = credentials.Certificate("firebase-credentials.json")
try:
    firebase_admin.initialize_app(cred)
except ValueError:
    pass  # Already initialized
db = firestore.client()

# GNews API configuration
GNEWS_API_BASE = "https://gnews.io/api/v4/search"

def search_news_mentions(name: str, api_key: str, days: int = 30) -> dict:
    """
    Search for news articles mentioning a person's name.
    
    Args:
        name: Full name to search for (e.g., "Chuck Schumer")
        api_key: GNews API key
        days: Number of days to look back (default 30)
    
    Returns:
        Dict with total_articles count and sample headlines
    """
    # Calculate date range
    from_date = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%dT00:00:00Z")
    
    params = {
        "q": f'"{name}"',  # Exact phrase match
        "lang": "en",
        "country": "us",
        "from": from_date,
        "max": 10,  # We just need the count, but get a few for samples
        "apikey": api_key,
    }
    
    try:
        response = requests.get(GNEWS_API_BASE, params=params, timeout=15)
        response.raise_for_status()
        data = response.json()
        
        total = data.get("totalArticles", 0)
        articles = data.get("articles", [])
        
        # Extract sample headlines
        headlines = []
        for article in articles[:5]:
            headlines.append({
                "title": article.get("title", ""),
                "source": article.get("source", {}).get("name", ""),
                "date": article.get("publishedAt", ""),
                "url": article.get("url", ""),
            })
        
        return {
            "total_articles": total,
            "sample_headlines": headlines,
            "search_query": name,
            "days_searched": days,
        }
        
    except requests.exceptions.RequestException as e:
        print(f"    Error searching for {name}: {e}")
        return None


def update_legislator_news(bioguide_id: str, news_data: dict):
    """Update a legislator's news mentions in Firestore."""
    doc_ref = db.collection("legislators").document(bioguide_id)
    doc_ref.update({
        "news_mentions": news_data["total_articles"],
        "news_sample_headlines": news_data["sample_headlines"][:3],
        "news_updated_at": datetime.now(),
    })


def get_legislators_needing_update(limit: int = 100) -> list:
    """
    Get legislators that need news updates, prioritizing those never updated
    or updated longest ago.
    """
    legislators = []
    
    # Get all legislators
    docs = db.collection("legislators").stream()
    
    for doc in docs:
        data = doc.to_dict()
        news_updated = data.get("news_updated_at")
        # Convert Firestore timestamp to datetime if needed
        if news_updated and hasattr(news_updated, 'timestamp'):
            news_updated = datetime.fromtimestamp(news_updated.timestamp())
        legislators.append({
            "bioguide_id": doc.id,
            "full_name": data.get("full_name", ""),
            "news_updated_at": news_updated,
        })
    
    # Sort: Never updated first, then oldest updates
    def sort_key(l):
        if l["news_updated_at"] is None:
            return datetime(1900, 1, 1)  # Very old date for never updated
        if hasattr(l["news_updated_at"], 'replace'):
            return l["news_updated_at"].replace(tzinfo=None)
        return l["news_updated_at"]
    
    legislators.sort(key=sort_key)
    
    return legislators[:limit]


def main():
    parser = argparse.ArgumentParser(description="Import news mentions for Congress members")
    parser.add_argument("--api-key", type=str, help="GNews API key (or set GNEWS_API_KEY env var)")
    parser.add_argument("--limit", type=int, default=100, help="Max members to update (default: 100, max for free tier)")
    parser.add_argument("--days", type=int, default=30, help="Days to search back (default: 30)")
    parser.add_argument("--delay", type=float, default=1.0, help="Delay between requests in seconds (default: 1.0)")
    args = parser.parse_args()
    
    # Get API key
    api_key = args.api_key or os.environ.get("GNEWS_API_KEY")
    if not api_key:
        print("Error: GNews API key required.")
        print("Get a free key at: https://gnews.io/")
        print("Usage: python import_news_mentions.py --api-key YOUR_KEY")
        print("   or: export GNEWS_API_KEY=YOUR_KEY")
        sys.exit(1)
    
    print("=" * 60)
    print("News Mentions Import")
    print("=" * 60)
    print(f"Search period: Last {args.days} days")
    print(f"Max members to update: {args.limit}")
    print()
    
    # Get legislators to update
    legislators = get_legislators_needing_update(args.limit)
    print(f"Found {len(legislators)} members to update")
    print()
    
    updated = 0
    errors = 0
    
    for i, leg in enumerate(legislators):
        bioguide_id = leg["bioguide_id"]
        name = leg["full_name"]
        
        print(f"[{i+1}/{len(legislators)}] Searching: {name}...", end=" ")
        
        news_data = search_news_mentions(name, api_key, args.days)
        
        if news_data:
            update_legislator_news(bioguide_id, news_data)
            print(f"✓ {news_data['total_articles']} articles")
            updated += 1
        else:
            print("✗ Error")
            errors += 1
        
        # Rate limiting
        if i < len(legislators) - 1:
            time.sleep(args.delay)
    
    print()
    print("=" * 60)
    print("Import Complete!")
    print(f"  Updated: {updated}")
    print(f"  Errors: {errors}")
    print("=" * 60)
    
    # Show some stats
    if updated > 0:
        print("\nTo see results, check a legislator in the app or query Firestore.")
        print("Run this script daily to cycle through all 541 members over ~6 days.")


if __name__ == "__main__":
    main()
