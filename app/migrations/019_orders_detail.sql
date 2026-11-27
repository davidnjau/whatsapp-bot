-- Order detail view support: per-status timestamps for the timeline, M-Pesa
-- reference, admin-only internal notes, and a per-order message log.
ALTER TABLE orders ADD COLUMN packed_at timestamptz;
ALTER TABLE orders ADD COLUMN dropped_at timestamptz;
ALTER TABLE orders ADD COLUMN cancelled_at timestamptz;
ALTER TABLE orders ADD COLUMN mpesa_ref text;
ALTER TABLE orders ADD COLUMN internal_notes text;

-- Messages the admin sent a customer about a specific order. send_id links to
-- the outbound queue so we can show delivered/failed status.
CREATE TABLE order_messages (
  id bigserial PRIMARY KEY,
  order_id bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  body text NOT NULL,
  send_id bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_messages_order_idx ON order_messages (order_id, created_at);
