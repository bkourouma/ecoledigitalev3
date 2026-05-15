-- Prepare login bootstrap data for fresh staging databases.

ALTER TABLE "public"."user_roles"
  ADD COLUMN IF NOT EXISTS "tenant_id" UUID;

UPDATE "public"."user_roles" ur
SET "tenant_id" = u."tenant_id"
FROM "public"."users" u
WHERE ur."user_id" = u."id"
  AND ur."tenant_id" IS NULL;

ALTER TABLE "public"."user_roles"
  ALTER COLUMN "tenant_id" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_roles_tenant_id_fkey'
  ) THEN
    ALTER TABLE "public"."user_roles"
      ADD CONSTRAINT "user_roles_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "user_roles_tenant_id_user_id_role_id_key"
  ON "public"."user_roles"("tenant_id", "user_id", "role_id");

INSERT INTO "public"."tenants" (
  "slug",
  "name",
  "is_active",
  "is_reference",
  "settings_json",
  "created_at",
  "updated_at"
)
VALUES (
  'ecoledigitale',
  'ecoledigitale',
  true,
  true,
  '{}'::jsonb,
  NOW(),
  NOW()
)
ON CONFLICT ("slug")
DO UPDATE SET
  "name" = EXCLUDED."name",
  "is_active" = true,
  "is_reference" = true,
  "updated_at" = NOW();

WITH reference_tenant AS (
  SELECT "id"
  FROM "public"."tenants"
  WHERE "slug" = 'ecoledigitale'
  LIMIT 1
),
default_roles("key", "name") AS (
  VALUES
    ('admin', 'Administrateur'),
    ('owner', 'Proprietaire'),
    ('student', 'Etudiant'),
    ('parent', 'Parent'),
    ('teacher', 'Enseignant'),
    ('formateur', 'Formateur')
)
INSERT INTO "public"."roles" (
  "tenant_id",
  "key",
  "name",
  "is_active",
  "is_system",
  "created_at",
  "updated_at"
)
SELECT
  reference_tenant."id",
  default_roles."key",
  default_roles."name",
  true,
  true,
  NOW(),
  NOW()
FROM reference_tenant
CROSS JOIN default_roles
ON CONFLICT ("tenant_id", "key")
DO UPDATE SET
  "name" = EXCLUDED."name",
  "is_active" = true,
  "is_system" = true,
  "updated_at" = NOW();
