-- Link a cart to a logged-in customer so the admin can follow up on an
-- abandoned cart. Stays NULL for fully anonymous carts (no contact on file).
ALTER TABLE carts ADD COLUMN customer_id bigint REFERENCES customers(id);
CREATE INDEX carts_customer_idx ON carts (customer_id);
