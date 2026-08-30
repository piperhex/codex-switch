CREATE TABLE IF NOT EXISTS prompt_plugin_items (
  "id" uuid PRIMARY KEY,
  "name" varchar(120) NOT NULL,
  "version" varchar(40) NOT NULL,
  "type" varchar(16) NOT NULL,
  "text" text NOT NULL,
  "uploaderId" uuid NULL,
  "uploaderEmail" varchar(160) NOT NULL,
  "installCount" integer NOT NULL DEFAULT 0,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "CK_prompt_plugin_items_type" CHECK ("type" IN ('injection', 'filter')),
  CONSTRAINT "FK_prompt_plugin_items_uploader"
    FOREIGN KEY ("uploaderId") REFERENCES users ("id") ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "IDX_prompt_plugin_items_uploader_name"
  ON prompt_plugin_items ("uploaderId", "name");
CREATE INDEX IF NOT EXISTS "IDX_prompt_plugin_items_createdAt"
  ON prompt_plugin_items ("createdAt");
