-- Paid/redeemed access to a stylist answer for a specific dress + kind.
CREATE TABLE stylist_access (
  id bigserial PRIMARY KEY,
  visitor text NOT NULL,          -- cart-cookie id for anonymous visitors
  dress_id bigint NOT NULL,
  kind text NOT NULL,             -- 'fit' | 'style'
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stylist_access_lookup ON stylist_access (visitor, dress_id, kind);
