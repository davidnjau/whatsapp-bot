-- Phone a shopper typed at checkout, captured onto the cart before they pay so
-- an abandoned checkout (never submitted) is still reachable for follow-up.
-- Used when the cart has no logged-in customer.
ALTER TABLE carts ADD COLUMN contact_phone text;
