-- Admin-tunable thresholds for the GPU & Ingest dashboard (key/value store
-- from 013). FX last-good rate + manual override live under fx_* keys, written
-- at runtime.
INSERT INTO app_settings (key, value) VALUES
  ('runway_warn_days', '5'),
  ('balance_warn_usd', '10'),
  ('failrate_alert_pct', '20')
ON CONFLICT DO NOTHING;
