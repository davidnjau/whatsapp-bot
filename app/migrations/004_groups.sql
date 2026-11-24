CREATE TABLE group_settings (
  group_id text PRIMARY KEY,
  welcome_enabled boolean NOT NULL DEFAULT false,
  welcome_text text,
  moderation_enabled boolean NOT NULL DEFAULT false,
  keyword_replies jsonb NOT NULL DEFAULT '[]',
  flag_links boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE announcements (
  id bigserial PRIMARY KEY,
  group_ids jsonb NOT NULL,
  content jsonb NOT NULL,
  send_ids jsonb NOT NULL DEFAULT '[]',
  scheduled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
