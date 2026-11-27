-- Customer accounts (phone + WhatsApp code login) and loyalty coupons.
CREATE TABLE customers (
  id bigserial PRIMARY KEY,
  phone text NOT NULL UNIQUE,          -- normalized 2547XXXXXXXX
  name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE login_codes (
  phone text PRIMARY KEY,
  code text NOT NULL,
  expires_at timestamptz NOT NULL
);

-- Personal loyalty coupons earned by a customer (one per order-count milestone).
CREATE TABLE customer_coupons (
  id bigserial PRIMARY KEY,
  customer_id bigint NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  coupon_id bigint NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  milestone int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, milestone)
);

INSERT INTO app_settings (key, value) VALUES ('loyalty_n', '3'), ('loyalty_percent', '10')
  ON CONFLICT DO NOTHING;
