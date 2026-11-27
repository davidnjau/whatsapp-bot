-- Scheduled promotional banner campaigns.
CREATE TABLE campaigns (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  banner_type text NOT NULL DEFAULT 'text',   -- 'text' | 'photo'
  headline text,
  subtext text,
  button_text text,
  button_link text,
  desktop_media_id bigint REFERENCES media_library(id),
  mobile_media_id bigint REFERENCES media_library(id),
  photo_alt text,
  bg_color text NOT NULL DEFAULT '#faf9f5',
  text_color text NOT NULL DEFAULT '#2b2724',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  show_countdown boolean NOT NULL DEFAULT false,
  whatsapp_message text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX campaigns_window_idx ON campaigns (active, starts_at, ends_at);

-- Per-campaign photo history, so the admin can switch back to an earlier photo.
CREATE TABLE campaign_photos (
  id bigserial PRIMARY KEY,
  campaign_id bigint NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  desktop_media_id bigint NOT NULL REFERENCES media_library(id),
  mobile_media_id bigint REFERENCES media_library(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Default coupon lifetime (days) if the admin doesn't set an explicit expiry.
INSERT INTO app_settings (key, value) VALUES ('coupon_default_days', '7') ON CONFLICT DO NOTHING;
