-- Marks a photo as queued/running for AI enrichment so the admin sees an
-- "enriching…" state per photo. Cleared when ingest finishes.
ALTER TABLE products ADD COLUMN ai_enqueued_at timestamptz;
