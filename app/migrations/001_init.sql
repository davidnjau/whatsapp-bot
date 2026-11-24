CREATE TABLE contacts (
  id bigserial PRIMARY KEY,
  chat_id text NOT NULL UNIQUE,
  phone text,
  name text,
  opted_in boolean NOT NULL DEFAULT true,
  opt_in_source text,
  opted_out_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE webhook_events (
  id bigserial PRIMARY KEY,
  event_key text NOT NULL UNIQUE,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  error text
);

CREATE TABLE chats (
  chat_id text PRIMARY KEY,
  kind text NOT NULL DEFAULT 'dm',
  name text,
  bot_paused boolean NOT NULL DEFAULT false,
  paused_reason text,
  handoff_at timestamptz,
  last_inbound_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE messages (
  id bigserial PRIMARY KEY,
  waha_message_id text UNIQUE,
  chat_id text NOT NULL,
  from_me boolean NOT NULL DEFAULT false,
  type text,
  body text,
  media jsonb,
  ack int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_chat_idx ON messages (chat_id, created_at DESC);

CREATE TABLE sends (
  id bigserial PRIMARY KEY,
  chat_id text NOT NULL,
  module text NOT NULL,
  kind text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  waha_message_id text,
  attempts int NOT NULL DEFAULT 0,
  error text,
  scheduled_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sends_status_idx ON sends (status);
CREATE INDEX sends_sent_at_idx ON sends (sent_at);
CREATE INDEX sends_waha_msg_idx ON sends (waha_message_id);
