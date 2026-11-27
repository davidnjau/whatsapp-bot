-- Short-lived hold so two buyers can't grab the same single piece.
-- reserved_by holds either a web cart id (uuid text) or a WhatsApp chat_id.
ALTER TABLE products ADD COLUMN reserved_until timestamptz;
ALTER TABLE products ADD COLUMN reserved_by text;
CREATE INDEX products_reserved_idx ON products (reserved_until);
