ALTER TABLE skill_market_items
  ADD COLUMN IF NOT EXISTS "official" boolean NOT NULL DEFAULT false;

UPDATE skill_market_items AS skill
SET "official" = true
FROM users AS uploader
WHERE skill."uploaderId" = uploader."id"
  AND uploader."role" = 'admin'
  AND skill."official" = false;
