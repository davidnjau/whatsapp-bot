CREATE TABLE templates (
  id bigserial PRIMARY KEY,
  name text NOT NULL UNIQUE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id bigserial PRIMARY KEY,
  chat_id text NOT NULL,
  template_name text,
  variables jsonb NOT NULL DEFAULT '{}',
  rendered text NOT NULL,
  attachment jsonb,
  send_id bigint REFERENCES sends(id),
  scheduled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_created_idx ON notifications (created_at DESC);
CREATE INDEX notifications_chat_idx ON notifications (chat_id);

INSERT INTO templates (name, body) VALUES
  ('order_confirmed',
   E'Hi {{name}}, your order {{order_id}} is confirmed! Total: {{total}}.\nWe''ll message you when it''s on the way. Asante!'),
  ('payment_received',
   E'Hi {{name}}, we''ve received your payment of {{amount}} for {{reference}}. Thank you / Asante! 🙏'),
  ('out_for_delivery',
   E'Hi {{name}}, your order {{order_id}} is out for delivery and should reach you {{eta}}.'),
  ('appointment_reminder',
   E'Hi {{name}}, a reminder about your appointment on {{date}} at {{time}}.\nReply here if you need to reschedule.')
ON CONFLICT (name) DO NOTHING;
