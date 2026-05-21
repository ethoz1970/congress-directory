"""
topics.py — keyword-based portal classifier.

Ported from sentiment-vs-power/pipeline/topics.py. Keeping a local copy
inside the WIOG Oracle's pipeline so the enricher doesn't need to import
across project boundaries. The two copies should stay in sync until we
adopt a single canonical taxonomy (eventually as a row set in
gov_postgres or a shared package).

`tag_text(text, limit=3)` returns up to N portal ids whose keyword set
matches the input. Bills with no keyword hits return an empty list and
get stored in Postgres with portal_tag = '{}' (empty array). A later
classifier — Maurice, a zero-shot model, whatever — would write at a
different classifier_version so its labels coexist with these.
"""
from __future__ import annotations


PORTALS = [
    {"id": "planet",   "emoji": "🌍", "name": "Planet & Climate",
     "color": "#2d6a4f",
     "keywords": ["climate", "temperature", "weather", "hurricane", "flood",
                  "drought", "wildfire", "emissions", "carbon", "epa",
                  "oil", "pipeline", "fossil fuel", "renewable", "solar",
                  "wind energy", "gas price", "offshore", "keystone"]},
    {"id": "money",    "emoji": "💵", "name": "Money & Economy",
     "color": "#0d6e4f",
     "keywords": ["economy", "gdp", "recession", "inflation", "tariff",
                  "tax", "fed", "federal reserve", "interest rate", "market",
                  "stock", "s&p", "nasdaq", "dow", "binance", "crypto",
                  "bitcoin", "ethereum", "wall street", "jobs report",
                  "unemployment", "cftc", "sec"]},
    {"id": "housing",  "emoji": "🏠", "name": "Housing",
     "color": "#8a4a1a",
     "keywords": ["housing", "rent", "mortgage", "homeless", "homebuyer",
                  "zoning", "hud", "eviction", "landlord", "section 8",
                  "public housing"]},
    {"id": "health",   "emoji": "💊", "name": "Health",
     "color": "#8b2a3e",
     "keywords": ["medicaid", "medicare", "opioid", "fentanyl", "vaccine",
                  "health", "hospital", "pharma", "drug pricing", "fda",
                  "obamacare", "aca", "mental health", "maternal", "nih",
                  "insulin", "ozempic"]},
    {"id": "tech",     "emoji": "📱", "name": "Tech & Platforms",
     "color": "#2a4a8b",
     "keywords": ["ai ", "artificial intelligence", "algorithm", "chatgpt",
                  "meta", "zuckerberg", "musk", "google", "apple",
                  "amazon", "tiktok", "bytedance", "silicon valley",
                  "data privacy", "section 230", "content moderation",
                  "deepfake", "cryptocurr", "openai"]},
    {"id": "edu",      "emoji": "🎓", "name": "Education",
     "color": "#5e3a8b",
     "keywords": ["school", "student", "teacher", "university", "college",
                  "student loan", "tuition", "title ix", "pell grant",
                  "curriculum", "department of education", "charter school",
                  "public school"]},
    {"id": "safety",   "emoji": "🛡️", "name": "Safety & Crime",
     "color": "#8b0a0a",
     "keywords": ["crime", "police", "shooting", "gun violence",
                  "firearm", "cartel", "border", "ice raid", "terrorism",
                  "fbi", "atf", "mass shooting", "drug lord", "el mencho",
                  "el chapo"]},
    {"id": "culture",  "emoji": "🎭", "name": "Media & Culture",
     "color": "#2a6a8b",
     "keywords": ["hollywood", "sports", "museum", "art ", "content",
                  "state of the union", "sotu", "book ban", "library",
                  "statue", "monument", "speech"]},
    {"id": "food",     "emoji": "🌽", "name": "Food & Agriculture",
     "color": "#7a5a1a",
     "keywords": ["snap", "food stamp", "farm bill", "agriculture",
                  "nutrition", "hunger", "food bank", "usda", "dairy",
                  "ethanol", "grocery"]},
    {"id": "rights",   "emoji": "⚖️", "name": "Rights & Representation",
     "color": "#6a1a6a",
     "keywords": ["civil rights", "voting rights", "abortion", "roe",
                  "lgbt", "transgender", "immigration", "deport",
                  "deported", "asylum", "dei", "title vii", "ada",
                  "disability", "save act", "election integrity"]},
    {"id": "military", "emoji": "🪖", "name": "Military & Foreign",
     "color": "#3a4a2a",
     "keywords": ["military", "troops", "pentagon", "ukraine", "russia",
                  "israel", "gaza", "iran", "nato", "defense", "navy",
                  "army", "marines", "veteran", "china", "taiwan",
                  "afghanistan", "venezuela", "cuba"]},
    {"id": "shop",     "emoji": "🛒", "name": "Consumer & Retail",
     "color": "#8b5a2a",
     "keywords": ["consumer", "shopping", "target ", "walmart", "retail",
                  "small business", "amazon.com", "costco", "kroger"]},
]


def tag_text(text: str, limit: int = 3) -> list[str]:
    """Return up to `limit` portal ids whose keywords match the text."""
    t = (text or "").lower()
    if not t:
        return []
    hits: list[str] = []
    for p in PORTALS:
        for kw in p["keywords"]:
            if kw in t:
                hits.append(p["id"])
                break
        if len(hits) >= limit:
            break
    return hits


# Direct mapping from Congress.gov's official `policy_area` strings to our
# 12-portal taxonomy. Bill titles alone are often slogans or acronyms that
# never trip the keyword tagger ("NO GOTION Act" doesn't contain 'tax' or
# any other portal keyword); the policy_area field gives us authoritative
# topic signal that the tagger should respect.
#
# Some Congress.gov policy areas don't map cleanly to the SVP-12 taxonomy
# (e.g. "Transportation and Public Works", "Government Operations and
# Politics"). Those are intentionally absent and fall back to the title
# keyword tagger — empty portal_tag is honest output, not a bug.
POLICY_AREA_TO_PORTAL: dict[str, str] = {
    # money
    "Taxation":                                    "money",
    "Economics and Public Finance":                "money",
    "Finance and Financial Sector":                "money",
    "Commerce":                                    "money",
    "Foreign Trade and International Finance":     "money",
    "Labor and Employment":                        "money",
    # health
    "Health":                                      "health",
    # planet
    "Energy":                                      "planet",
    "Environmental Protection":                    "planet",
    "Public Lands and Natural Resources":          "planet",
    "Water Resources Development":                 "planet",
    "Animals":                                     "planet",
    # housing
    "Housing and Community Development":           "housing",
    # safety
    "Crime and Law Enforcement":                   "safety",
    "Emergency Management":                        "safety",
    # rights
    "Civil Rights and Liberties, Minority Issues": "rights",
    "Immigration":                                 "rights",
    "Native Americans":                            "rights",
    # military
    "Armed Forces and National Security":          "military",
    "International Affairs":                       "military",
    # edu
    "Education":                                   "edu",
    # tech
    "Science, Technology, Communications":         "tech",
    # culture
    "Arts, Culture, Religion":                     "culture",
    "Sports and Recreation":                       "culture",
    # food
    "Agriculture and Food":                        "food",
    # shop
    # (no clean Congress.gov mapping — title keywords like 'walmart' /
    # 'small business' still catch this)
}


def tag_bill(title: str | None, policy_area: str | None = None,
             limit: int = 3) -> list[str]:
    """
    Portal tags for a bill, combining two signals:
      1. Direct `policy_area → portal` mapping (authoritative, when present)
      2. Keyword match over the title (catches secondary themes)

    Returns up to `limit` portal ids, with the policy-area portal first
    if it produced a hit. Deduplicated; preserves insertion order.
    """
    hits: list[str] = []
    if policy_area and policy_area in POLICY_AREA_TO_PORTAL:
        hits.append(POLICY_AREA_TO_PORTAL[policy_area])

    for k in tag_text(title or "", limit=limit):
        if k not in hits:
            hits.append(k)
            if len(hits) >= limit:
                break

    return hits[:limit]


CLASSIFIER_VERSION = "keyword-v1"
