// whoisourgov — Mongo initialization
// Tier 1: raw archive. Source of truth.
// Everything ingested lands here first, untouched.
// Tier 2 (Postgres) and Tier 3 (Qdrant) are derived from this.

db = db.getSiblingDB('whoisourgov');

// Core collections
db.createCollection('records');             // raw ingestion — every source, every record
db.createCollection('politicians');         // full politician profiles, no flattening
db.createCollection('votes');               // full vote records
db.createCollection('bills');               // full bill metadata
db.createCollection('bill_texts');          // full bill text — too heavy for Postgres
db.createCollection('news_context');        // timestamped news / press releases / statements
db.createCollection('behavioral_data');     // vector-companion docs (richer metadata for Qdrant)

// Filter Feeder operational collections
db.createCollection('traction_snapshots'); // raw traction data before scoring pipeline
db.createCollection('ingestion_log');      // every filter feeder run logged raw

// Indexes — core
db.politicians.createIndex({ external_id: 1 }, { unique: true });
db.politicians.createIndex({ scope: 1, state_code: 1 });
db.politicians.createIndex({ office: 1 });

db.bills.createIndex({ external_id: 1 }, { unique: true });
db.bills.createIndex({ scope: 1, state_code: 1 });
db.bills.createIndex({ session: 1, status: 1 });
db.bills.createIndex({ sponsor_id: 1 });
db.bills.createIndex({ portal_tag: 1 });

db.bill_texts.createIndex({ bill_id: 1 }, { unique: true });

db.votes.createIndex({ politician_id: 1, timestamp: -1 });
db.votes.createIndex({ bill_id: 1 });

db.news_context.createIndex({ timestamp: -1 });
db.news_context.createIndex({ related_bill_id: 1 });

db.records.createIndex({ source: 1, timestamp: -1 });

// Filter Feeder indexes
db.traction_snapshots.createIndex({ subject_id: 1, timestamp: -1 });
db.ingestion_log.createIndex({ source: 1, timestamp: -1 });
db.ingestion_log.createIndex({ status: 1 });
