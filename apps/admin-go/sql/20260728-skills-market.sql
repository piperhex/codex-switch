CREATE TABLE IF NOT EXISTS skill_market_items (
  "id" uuid PRIMARY KEY,
  "title" varchar(120) NOT NULL,
  "description" text NOT NULL,
  "version" varchar(40) NOT NULL,
  "archiveFileName" varchar(255) NOT NULL,
  "archiveMimeType" varchar(80) NOT NULL,
  "archiveSize" integer NOT NULL,
  "archiveSha256" char(64) NOT NULL,
  "archiveData" bytea NOT NULL,
  "previewMimeType" varchar(80) NULL,
  "previewSize" integer NULL,
  "previewData" bytea NULL,
  "uploaderId" uuid NULL,
  "uploaderEmail" varchar(160) NOT NULL,
  "official" boolean NOT NULL DEFAULT false,
  "installCount" integer NOT NULL DEFAULT 0,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "FK_skill_market_items_uploader"
    FOREIGN KEY ("uploaderId") REFERENCES users ("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "IDX_skill_market_items_createdAt"
  ON skill_market_items ("createdAt");
