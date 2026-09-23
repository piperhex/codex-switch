-- Apply before starting the updated admin-go service. No NestJS changes are required.
BEGIN;
CREATE TABLE IF NOT EXISTS chat_relay_budgets (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    hour_start timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    bytes bigint NOT NULL CHECK (bytes > 0 AND bytes <= 262144),
    closed boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS chat_relay_budgets_pending
    ON chat_relay_budgets (user_id, hour_start) WHERE NOT closed;
CREATE INDEX IF NOT EXISTS chat_relay_budgets_expiry ON chat_relay_budgets (expires_at);
COMMIT;
