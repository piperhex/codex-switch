CREATE TABLE IF NOT EXISTS currency_settings (
  id varchar(32) PRIMARY KEY,
  encrypted_api_key text,
  currencies jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_by_id uuid,
  updated_by_email varchar(160) NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
