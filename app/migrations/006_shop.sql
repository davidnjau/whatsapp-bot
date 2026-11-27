CREATE TABLE products (
  id bigserial PRIMARY KEY,
  title text,
  size text,
  price_ksh int,
  media_id bigint NOT NULL REFERENCES media_library(id),
  source_file text UNIQUE,
  ocr_source text,
  ocr_raw text,
  needs_review boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'draft',   -- draft | published | sold | archived
  status_send_id bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  sold_at timestamptz
);
CREATE INDEX products_status_idx ON products (status);

CREATE TABLE carts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cart_items (
  cart_id uuid NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  product_id bigint NOT NULL REFERENCES products(id),
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cart_id, product_id)
);

CREATE TABLE orders (
  id bigserial PRIMARY KEY,
  access_token uuid NOT NULL DEFAULT gen_random_uuid(),
  customer_name text NOT NULL,
  phone text NOT NULL,
  town text NOT NULL,
  delivery_option text NOT NULL,      -- agent | doorstep | errand
  delivery_location text NOT NULL,
  status text NOT NULL DEFAULT 'pending_payment',
  -- pending_payment | paid | packed | dropped | collected | cancelled
  total_ksh int NOT NULL,
  package_code text,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX orders_status_idx ON orders (status);

CREATE TABLE order_items (
  order_id bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id bigint NOT NULL REFERENCES products(id),
  price_ksh int NOT NULL,
  PRIMARY KEY (order_id, product_id)
);
