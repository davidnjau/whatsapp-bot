CREATE TABLE chat_shop_sessions (
  chat_id text PRIMARY KEY,
  state text NOT NULL,                 -- awaiting_town | awaiting_delivery | awaiting_location
  product_id bigint REFERENCES products(id),
  town text,
  delivery_option text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
