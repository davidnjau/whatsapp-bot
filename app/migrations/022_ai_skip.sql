-- Let the admin exclude specific uploads from AI enrichment. Excluded photos
-- drop out of the "awaiting enrichment" queue but stay editable by hand.
ALTER TABLE products ADD COLUMN ai_skipped boolean NOT NULL DEFAULT false;
