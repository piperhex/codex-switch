CREATE TABLE IF NOT EXISTS public.chat_push_subscriptions (
 id varchar(64) PRIMARY KEY, owner_id varchar(128) NOT NULL,
 token varchar(256) NOT NULL, account varchar(64) NOT NULL, expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS chat_push_subscription_owner ON public.chat_push_subscriptions(owner_id, expires_at);
CREATE TABLE IF NOT EXISTS public.chat_push_deliveries (
 id varchar(64) PRIMARY KEY, owner_id varchar(128) NOT NULL, subscription_id varchar(64) NOT NULL,
 device_id varchar(200) NOT NULL, thread_id varchar(200) NOT NULL, event_id varchar(200) NOT NULL,
 kind varchar(20) NOT NULL, receipt varchar(200) NOT NULL DEFAULT '', attempts integer NOT NULL DEFAULT 0,
 next_at timestamptz NOT NULL, created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS chat_push_delivery_pending ON public.chat_push_deliveries(next_at) WHERE attempts < 8;
CREATE INDEX IF NOT EXISTS chat_push_delivery_owner ON public.chat_push_deliveries(owner_id, created_at);
