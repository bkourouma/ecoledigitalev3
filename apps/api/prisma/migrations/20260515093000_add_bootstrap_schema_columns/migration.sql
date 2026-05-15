-- Align legacy baseline tables with the API bootstrap and super-admin services.

ALTER TABLE "public"."tenants"
  ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "is_reference" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "created_by_super_admin_id" UUID;

UPDATE "public"."tenants"
SET "is_active" = true
WHERE "is_active" IS NULL;

ALTER TABLE "public"."roles"
  ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "is_system" BOOLEAN NOT NULL DEFAULT false;

UPDATE "public"."roles"
SET "is_active" = true
WHERE "is_active" IS NULL;

UPDATE "public"."roles"
SET "is_system" = false
WHERE "is_system" IS NULL;

ALTER TABLE "public"."users"
  ADD COLUMN IF NOT EXISTS "initial_password" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "is_technical_account" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "active_role_key" VARCHAR(50);

UPDATE "public"."users"
SET "is_active" = true
WHERE "is_active" IS NULL;

UPDATE "public"."users"
SET "is_technical_account" = false
WHERE "is_technical_account" IS NULL;
