CREATE TABLE IF NOT EXISTS user_feedback (
  "id" uuid PRIMARY KEY,
  "content" text NOT NULL,
  "version" varchar(40) NOT NULL,
  "platform" varchar(500) NOT NULL,
  "userId" uuid NULL,
  "email" varchar(160) NULL,
  "lastRepliedAt" timestamptz NULL,
  "lastRepliedById" uuid NULL,
  "lastRepliedByEmail" varchar(160) NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "IDX_user_feedback_createdAt"
  ON user_feedback ("createdAt");

CREATE TABLE IF NOT EXISTS user_feedback_attachments (
  "id" uuid PRIMARY KEY,
  "feedbackId" uuid NOT NULL,
  "fileName" varchar(255) NOT NULL,
  "mimeType" varchar(80) NOT NULL,
  "size" integer NOT NULL,
  "data" bytea NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "FK_user_feedback_attachments_feedback"
    FOREIGN KEY ("feedbackId") REFERENCES user_feedback ("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "IDX_user_feedback_attachments_feedbackId"
  ON user_feedback_attachments ("feedbackId");
