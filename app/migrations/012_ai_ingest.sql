-- AI-ingestion fields (auto-filled by the digitization worker, owner reviews).
ALTER TABLE products ADD COLUMN silhouette text;
ALTER TABLE products ADD COLUMN stretch_level text;
ALTER TABLE products ADD COLUMN fit_notes text;
ALTER TABLE products ADD COLUMN social_caption text;
ALTER TABLE products ADD COLUMN occasions jsonb;
ALTER TABLE products ADD COLUMN embedding jsonb;        -- 512-d vector; pgvector later
ALTER TABLE products ADD COLUMN ai_ingested_at timestamptz;

-- Where a media-library object physically lives: local disk or MinIO/S3.
ALTER TABLE media_library ADD COLUMN storage text NOT NULL DEFAULT 'disk';
