-- Richer catalogue fields for the Dress Nation detail view + gallery media.
ALTER TABLE products ADD COLUMN fabric text;
ALTER TABLE products ADD COLUMN colour text;
ALTER TABLE products ADD COLUMN length_desc text;
ALTER TABLE products ADD COLUMN short_desc text;
ALTER TABLE products ADD COLUMN long_desc text;   -- paragraphs separated by a blank line
ALTER TABLE products ADD COLUMN care text;         -- one care note per line
ALTER TABLE products ADD COLUMN seed_key text UNIQUE;  -- idempotency marker for seeded dresses

-- Ordered gallery media for a product: model / mannequin / close-ups / video.
CREATE TABLE product_media (
  id bigserial PRIMARY KEY,
  product_id bigint NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  media_id bigint NOT NULL REFERENCES media_library(id),
  kind text NOT NULL DEFAULT 'photo',          -- model | mannequin | close | video | photo
  poster_media_id bigint REFERENCES media_library(id),  -- poster frame for a video
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX product_media_product_idx ON product_media (product_id, position);
