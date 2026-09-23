CREATE TABLE IF NOT EXISTS app_faqs (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "questionZh" varchar(300) NOT NULL,
  "questionEn" varchar(300) NOT NULL,
  "answerZh" text NOT NULL,
  "answerEn" text NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true,
  "sortOrder" integer NOT NULL DEFAULT 0,
  "updatedById" uuid NULL,
  "updatedByEmail" varchar(160) NOT NULL DEFAULT '',
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS app_faqs_public_order_idx
  ON app_faqs ("enabled", "sortOrder" ASC, "createdAt" ASC);
