CREATE TABLE IF NOT EXISTS chat_relay_traffic (
  hour_start timestamptz NOT NULL,
  reporter_id uuid NOT NULL,
  bytes bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (hour_start, reporter_id)
);
