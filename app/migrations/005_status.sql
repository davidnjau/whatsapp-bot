CREATE TABLE audiences (
  id bigserial PRIMARY KEY,
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audience_members (
  audience_id bigint NOT NULL REFERENCES audiences(id) ON DELETE CASCADE,
  chat_id text NOT NULL,
  PRIMARY KEY (audience_id, chat_id)
);

CREATE TABLE status_definitions (
  id bigserial PRIMARY KEY,
  status_type text NOT NULL,          -- text | image | video | voice
  input jsonb NOT NULL,               -- text/backgroundColor/font/caption/convert (+ media_id or file url)
  audience_id bigint REFERENCES audiences(id) ON DELETE SET NULL,
  schedule_kind text NOT NULL,        -- once | daily
  scheduled_at timestamptz,
  cron text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE media_library (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  path text NOT NULL,
  mimetype text,
  size_bytes bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);
