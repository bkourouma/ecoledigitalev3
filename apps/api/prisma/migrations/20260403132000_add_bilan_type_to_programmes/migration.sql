-- Add nullable column first to preserve existing rows during backfill
ALTER TABLE "programmes"
    ADD COLUMN IF NOT EXISTS "bilan_type_id" UUID;

-- Backfill existing programmes without using a database default.
-- Preference order per tenant:
-- 1. a type named "Bilan Général" / "Bilan General"
-- 2. otherwise the oldest available bilan type for the same tenant
UPDATE "programmes" AS p
SET "bilan_type_id" = bt."id"
FROM (
    SELECT DISTINCT ON (p2."id")
        p2."id" AS programme_id,
        bt2."id"
    FROM "programmes" p2
    JOIN "bilan_types" bt2
      ON bt2."tenant_id" = p2."tenant_id"
    WHERE p2."bilan_type_id" IS NULL
    ORDER BY
      p2."id",
      CASE
        WHEN LOWER(bt2."name") IN ('bilan général', 'bilan general') THEN 0
        ELSE 1
      END,
      bt2."created_at" ASC
) AS bt
WHERE p."id" = bt.programme_id
  AND p."bilan_type_id" IS NULL;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "programmes"
        WHERE "bilan_type_id" IS NULL
    ) THEN
        RAISE EXCEPTION 'Impossible de rendre programmes.bilan_type_id obligatoire: certains programmes n''ont aucun type de bilan disponible dans leur tenant.';
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'programmes_bilan_type_id_fkey'
    ) THEN
        ALTER TABLE "programmes"
            ADD CONSTRAINT "programmes_bilan_type_id_fkey"
            FOREIGN KEY ("bilan_type_id") REFERENCES "bilan_types"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_programmes_bilan_type_id"
    ON "programmes"("bilan_type_id");

ALTER TABLE "programmes"
    ALTER COLUMN "bilan_type_id" SET NOT NULL;
