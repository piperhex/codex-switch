CREATE TABLE IF NOT EXISTS public.desktop_service_credentials (
 owner_id varchar(128) NOT NULL, device_id varchar(128) NOT NULL,
 digest varchar(64) NOT NULL, created_at timestamptz NOT NULL,
 PRIMARY KEY(owner_id, device_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS desktop_service_credential_digest ON public.desktop_service_credentials(digest);
