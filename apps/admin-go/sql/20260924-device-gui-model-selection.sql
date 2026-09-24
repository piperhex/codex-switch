BEGIN;
ALTER TABLE public.remote_devices
    ADD COLUMN IF NOT EXISTS "guiAccountId" character varying(120),
    ADD COLUMN IF NOT EXISTS "guiProviderId" character varying(120);
COMMIT;
