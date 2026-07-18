DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'app_announcements'
      AND column_name = 'contentEn'
  ) THEN
    ALTER TABLE app_announcements
      ADD COLUMN "contentEn" text NOT NULL DEFAULT '';

    -- Preserve the existing announcement for both languages until an
    -- administrator configures a dedicated English version.
    UPDATE app_announcements
    SET "contentEn" = "content"
    WHERE "content" <> '';
  END IF;
END $$;

ALTER TABLE app_announcements
  ADD COLUMN IF NOT EXISTS "link" varchar(2048) NOT NULL DEFAULT '';
