CREATE TABLE IF NOT EXISTS chat_settings (
  id varchar(32) PRIMARY KEY,
  policy jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
