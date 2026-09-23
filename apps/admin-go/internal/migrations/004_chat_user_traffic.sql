CREATE TABLE IF NOT EXISTS chat_relay_user_limits (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    monthly_limit_bytes bigint NOT NULL DEFAULT -1 CHECK (monthly_limit_bytes >= -1)
);
CREATE TABLE IF NOT EXISTS chat_relay_user_months (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    month_start timestamptz NOT NULL,
    bytes bigint NOT NULL DEFAULT 0 CHECK (bytes >= 0),
    PRIMARY KEY (user_id, month_start)
);
CREATE TABLE IF NOT EXISTS chat_relay_user_hours (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    hour_start timestamptz NOT NULL,
    bytes bigint NOT NULL DEFAULT 0 CHECK (bytes >= 0),
    PRIMARY KEY (user_id, hour_start)
);
CREATE INDEX IF NOT EXISTS chat_relay_user_hours_hour_idx ON chat_relay_user_hours(hour_start);
