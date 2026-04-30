-- Add programme_id (filiere) to cycle fees and make it mandatory
ALTER TABLE "public"."cycles_frais"
ADD COLUMN IF NOT EXISTS "programme_id" UUID;

-- Remove old uniqueness (tenant + cycle) to allow one fee config per programme
ALTER TABLE "public"."cycles_frais"
DROP CONSTRAINT IF EXISTS "cycles_frais_tenant_id_cycle_id_key";

-- Ensure every cycle with fees has at least one programme (required for mandatory programme_id)
INSERT INTO "public"."programmes" (
  "tenant_id",
  "cycle_id",
  "name",
  "code",
  "version",
  "status",
  "description"
)
SELECT DISTINCT
  cf.tenant_id,
  cf.cycle_id,
  CONCAT('Filiere par defaut - ', c.name),
  CONCAT('AUTO-', UPPER(SUBSTRING(REPLACE(cf.cycle_id::text, '-', ''), 1, 14))),
  '1.0',
  'draft'::"public"."programme_status",
  'Programme cree automatiquement pendant la migration des frais par filiere.'
FROM "public"."cycles_frais" cf
JOIN "public"."cycles" c
  ON c.id = cf.cycle_id
LEFT JOIN "public"."programmes" p
  ON p.tenant_id = cf.tenant_id
 AND p.cycle_id = cf.cycle_id
WHERE p.id IS NULL;

-- Backfill: assign an existing row to the first programme of its cycle
WITH cycle_programmes AS (
  SELECT
    cf.id AS cycle_fee_id,
    p.id AS programme_id,
    ROW_NUMBER() OVER (
      PARTITION BY cf.id
      ORDER BY p.created_at ASC, p.id ASC
    ) AS rn
  FROM "public"."cycles_frais" cf
  JOIN "public"."programmes" p
    ON p.tenant_id = cf.tenant_id
   AND p.cycle_id = cf.cycle_id
)
UPDATE "public"."cycles_frais" cf
SET "programme_id" = cp.programme_id
FROM cycle_programmes cp
WHERE cp.cycle_fee_id = cf.id
  AND cp.rn = 1
  AND cf.programme_id IS NULL;

-- Backfill: duplicate existing cycle fee rows for other programmes of the same cycle
WITH cycle_programmes AS (
  SELECT
    cf.id AS cycle_fee_id,
    cf.tenant_id,
    cf.cycle_id,
    cf.inscription,
    cf.scolarite,
    cf.annexes,
    cf.autres,
    cf.currency,
    cf.created_at,
    cf.updated_at,
    p.id AS programme_id,
    ROW_NUMBER() OVER (
      PARTITION BY cf.id
      ORDER BY p.created_at ASC, p.id ASC
    ) AS rn
  FROM "public"."cycles_frais" cf
  JOIN "public"."programmes" p
    ON p.tenant_id = cf.tenant_id
   AND p.cycle_id = cf.cycle_id
)
INSERT INTO "public"."cycles_frais" (
  "id",
  "tenant_id",
  "cycle_id",
  "programme_id",
  "inscription",
  "scolarite",
  "annexes",
  "autres",
  "currency",
  "created_at",
  "updated_at"
)
SELECT
  uuid_generate_v4(),
  cp.tenant_id,
  cp.cycle_id,
  cp.programme_id,
  cp.inscription,
  cp.scolarite,
  cp.annexes,
  cp.autres,
  cp.currency,
  cp.created_at,
  cp.updated_at
FROM cycle_programmes cp
WHERE cp.rn > 1
  AND NOT EXISTS (
    SELECT 1
    FROM "public"."cycles_frais" existing
    WHERE existing.tenant_id = cp.tenant_id
      AND existing.cycle_id = cp.cycle_id
      AND existing.programme_id = cp.programme_id
  );

-- Safety guard: prevent making the column mandatory if some rows cannot be linked
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "public"."cycles_frais"
    WHERE "programme_id" IS NULL
  ) THEN
    RAISE EXCEPTION 'Migration aborted: some cycles_frais rows cannot be linked to a programme. Create programmes for those cycles first.';
  END IF;
END $$;

-- Filiere is now mandatory
ALTER TABLE "public"."cycles_frais"
ALTER COLUMN "programme_id" SET NOT NULL;

-- FK to programmes
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cycles_frais_programme_id_fkey'
  ) THEN
    ALTER TABLE "public"."cycles_frais"
    ADD CONSTRAINT "cycles_frais_programme_id_fkey"
      FOREIGN KEY ("programme_id")
      REFERENCES "public"."programmes"("id")
      ON DELETE CASCADE
      ON UPDATE NO ACTION;
  END IF;
END $$;

-- New uniqueness for cycle + filiere
CREATE UNIQUE INDEX IF NOT EXISTS "cycles_frais_tenant_id_cycle_id_programme_id_key"
ON "public"."cycles_frais"("tenant_id", "cycle_id", "programme_id");

CREATE INDEX IF NOT EXISTS "idx_cycles_frais_programme_id"
ON "public"."cycles_frais"("programme_id");
