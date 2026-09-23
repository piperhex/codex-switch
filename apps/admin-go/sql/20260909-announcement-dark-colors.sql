ALTER TABLE app_announcements
  ADD COLUMN IF NOT EXISTS "darkTextColor" varchar(7) NOT NULL DEFAULT '#C4D7C8',
  ADD COLUMN IF NOT EXISTS "darkBackgroundColor" varchar(7) NOT NULL DEFAULT '#203128';
