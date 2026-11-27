-- Admin-created discount coupons (e.g. Christmas), applied at checkout.
CREATE TABLE coupons (
  id bigserial PRIMARY KEY,
  code text NOT NULL UNIQUE,
  percent int NOT NULL CHECK (percent > 0 AND percent <= 100),
  active boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  max_uses int,
  used_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE orders ADD COLUMN coupon_code text;
ALTER TABLE orders ADD COLUMN discount_ksh int NOT NULL DEFAULT 0;
