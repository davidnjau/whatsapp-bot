-- Simple key/value store for admin-toggled shop settings.
CREATE TABLE app_settings (
  key text PRIMARY KEY,
  value text NOT NULL
);
INSERT INTO app_settings (key, value) VALUES ('hide_sold', 'false') ON CONFLICT DO NOTHING;
