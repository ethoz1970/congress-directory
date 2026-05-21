"""
client.py — env loader + connection helpers for the Oracle's Tier 1 / Tier 2.

The feeder is designed to run on either:
  (a) the workstation, reaching the Oracle's Mongo + Postgres over LAN
      (the default — uses 10.1.10.4 as the host)
  (b) the Oracle itself, reaching its own containers via localhost
      (override GOV_MONGO_HOST / GOV_POSTGRES_HOST in .env)

Two flavors of overrides are supported per database:
  * GOV_MONGO_URI / GOV_POSTGRES_DSN — full connection string, takes precedence
  * GOV_MONGO_HOST / GOV_MONGO_PORT / MONGO_PASSWORD — composed automatically

A tiny .env loader at module import time keeps this dependency-free (no
need to pull in python-dotenv).
"""
from __future__ import annotations

import os
from contextlib import contextmanager
from pathlib import Path


# -----------------------------------------------------------------------------
# .env loader — single file at the feeder root; gitignored.
# -----------------------------------------------------------------------------
def _load_dotenv() -> None:
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if not env_path.exists():
        return
    for raw in env_path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        # setdefault — explicit shell env wins over .env
        os.environ.setdefault(key, value)


_load_dotenv()


# -----------------------------------------------------------------------------
# API keys.
# -----------------------------------------------------------------------------
CONGRESS_GOV_API_KEY = os.environ.get("CONGRESS_GOV_API_KEY", "")
LEGISCAN_API_KEY     = os.environ.get("LEGISCAN_API_KEY", "")


# -----------------------------------------------------------------------------
# Mongo (Tier 1).
# -----------------------------------------------------------------------------
_MONGO_HOST = os.environ.get("GOV_MONGO_HOST", "10.1.10.4")
_MONGO_PORT = os.environ.get("GOV_MONGO_PORT", "27019")
_MONGO_PW   = os.environ.get("MONGO_PASSWORD", "")

GOV_MONGO_URI = os.environ.get(
    "GOV_MONGO_URI",
    f"mongodb://blacksky:{_MONGO_PW}@{_MONGO_HOST}:{_MONGO_PORT}/whoisourgov"
    "?authSource=admin",
)


def mongo_db():
    """Return a pymongo Database handle for 'whoisourgov'. Lazy-imports pymongo."""
    from pymongo import MongoClient

    client = MongoClient(GOV_MONGO_URI, serverSelectionTimeoutMS=10_000)
    # Surface connectivity errors EARLY rather than on first query.
    client.admin.command("ping")
    return client["whoisourgov"]


# -----------------------------------------------------------------------------
# Postgres (Tier 2). Used only for marking ingestion_sources rows as we go.
# -----------------------------------------------------------------------------
_PG_HOST = os.environ.get("GOV_POSTGRES_HOST", "10.1.10.4")
_PG_PORT = os.environ.get("GOV_POSTGRES_PORT", "5434")
_PG_PW   = os.environ.get("POSTGRES_PASSWORD", "")

GOV_POSTGRES_DSN = os.environ.get(
    "GOV_POSTGRES_DSN",
    f"postgresql://blacksky:{_PG_PW}@{_PG_HOST}:{_PG_PORT}/whoisourgov",
)


@contextmanager
def postgres_conn():
    """Yield a psycopg connection to the Oracle's gov_postgres."""
    import psycopg

    with psycopg.connect(GOV_POSTGRES_DSN) as conn:
        yield conn


# -----------------------------------------------------------------------------
# Supabase (Phase D bridge target). Same Postgres protocol; different host.
# -----------------------------------------------------------------------------
SUPABASE_DB_URL = os.environ.get("SUPABASE_DB_URL", "")
SUPABASE_DIRECT_URL = os.environ.get("SUPABASE_DIRECT_URL", "")


@contextmanager
def supabase_conn(direct: bool = False):
    """
    Yield a psycopg connection to the Supabase Postgres.

    The pooler URL (SUPABASE_DB_URL, port 6543) is fine for short-lived
    upsert batches. For multi-thousand-row backfills, pass direct=True
    to use SUPABASE_DIRECT_URL (port 5432) and avoid the pooler's
    per-statement timeout.
    """
    import psycopg

    dsn = SUPABASE_DIRECT_URL if direct else SUPABASE_DB_URL
    if not dsn:
        raise RuntimeError(
            "SUPABASE_DB_URL (or SUPABASE_DIRECT_URL with direct=True) is not "
            "set in .env — bridge can't run"
        )
    with psycopg.connect(dsn) as conn:
        yield conn


# -----------------------------------------------------------------------------
# Smoke test: `python -m feeder.client` verifies both connections.
# -----------------------------------------------------------------------------
def _smoke() -> int:
    print(f"→ MONGO  : {_MONGO_HOST}:{_MONGO_PORT}/whoisourgov")
    try:
        db = mongo_db()
        cols = db.list_collection_names()
        print(f"  ✓ ping ok — {len(cols)} collection(s): {sorted(cols)}")
    except Exception as e:
        print(f"  ! Mongo failed: {type(e).__name__}: {e}")
        return 1

    print(f"→ POSTG  : {_PG_HOST}:{_PG_PORT}/whoisourgov")
    try:
        with postgres_conn() as conn, conn.cursor() as cur:
            cur.execute("SELECT source_name, sync_status FROM ingestion_sources ORDER BY 1")
            for row in cur.fetchall():
                print(f"  · {row[0]:<16s}  {row[1]}")
    except Exception as e:
        print(f"  ! Postgres failed: {type(e).__name__}: {e}")
        return 1

    print(f"→ KEYS   : congress.gov={'set' if CONGRESS_GOV_API_KEY else 'MISSING'}  "
          f"legiscan={'set' if LEGISCAN_API_KEY else 'unset'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(_smoke())
