BEGIN;

-- Existing accounts retain their IDs, roles and relations. Ambiguous normalized
-- emails must be resolved by an administrator before this migration can run.
UPDATE "User" SET "email" = lower(btrim("email"));
ALTER TABLE "User"
  ADD COLUMN "googleSubject" TEXT,
  ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
  ALTER COLUMN "role" SET DEFAULT 'contributor',
  DROP COLUMN "password";
CREATE UNIQUE INDEX "User_googleSubject_key" ON "User"("googleSubject");

COMMIT;
