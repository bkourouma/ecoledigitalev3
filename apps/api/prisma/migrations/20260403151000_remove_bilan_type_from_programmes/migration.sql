ALTER TABLE "programmes"
    DROP CONSTRAINT IF EXISTS "programmes_bilan_type_id_fkey";

DROP INDEX IF EXISTS "idx_programmes_bilan_type_id";

ALTER TABLE "programmes"
    DROP COLUMN IF EXISTS "bilan_type_id";
