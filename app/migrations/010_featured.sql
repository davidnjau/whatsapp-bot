-- Dresses the owner has chosen to spin in the shop's "fitting room" hero.
ALTER TABLE products ADD COLUMN featured boolean NOT NULL DEFAULT false;
CREATE INDEX products_featured_idx ON products (featured) WHERE featured;
