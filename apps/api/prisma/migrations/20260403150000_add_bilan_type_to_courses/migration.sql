ALTER TABLE "courses"
    ADD COLUMN IF NOT EXISTS "bilan_type_id" UUID;

UPDATE "courses" AS c
SET "bilan_type_id" = p."bilan_type_id"
FROM "programmes" AS p
WHERE c."programme_id" = p."id"
  AND c."tenant_id" = p."tenant_id"
  AND c."bilan_type_id" IS NULL
  AND p."bilan_type_id" IS NOT NULL;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "courses"
        WHERE "bilan_type_id" IS NULL
    ) THEN
        RAISE EXCEPTION 'Impossible de rendre courses.bilan_type_id obligatoire: certains cours n''ont aucun type de bilan.';
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'courses_bilan_type_id_fkey'
    ) THEN
        ALTER TABLE "courses"
            ADD CONSTRAINT "courses_bilan_type_id_fkey"
            FOREIGN KEY ("bilan_type_id") REFERENCES "bilan_types"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_courses_bilan_type_id"
    ON "courses"("bilan_type_id");

ALTER TABLE "courses"
    ALTER COLUMN "bilan_type_id" SET NOT NULL;
