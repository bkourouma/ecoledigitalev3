-- CreateTable
CREATE TABLE IF NOT EXISTS "bilan_types" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bilan_types_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'bilan_types_tenant_id_fkey'
    ) THEN
        ALTER TABLE "bilan_types"
            ADD CONSTRAINT "bilan_types_tenant_id_fkey"
            FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_bilan_types_tenant_id"
    ON "bilan_types"("tenant_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_bilan_types_created_at"
    ON "bilan_types"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "uq_bilan_types_tenant_name_ci"
    ON "bilan_types"("tenant_id", LOWER("name"));

-- Row level security and policy kept in migration because Prisma schema cannot model them
ALTER TABLE "bilan_types" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'bilan_types'
          AND policyname = 'bilan_types_tenant_policy'
    ) THEN
        CREATE POLICY "bilan_types_tenant_policy" ON "bilan_types"
            FOR ALL
            USING ("tenant_id" = current_setting('app.tenant_id', true)::UUID);
    END IF;
END $$;

-- Keep compatibility with the project's existing updated_at trigger strategy
DROP TRIGGER IF EXISTS "update_bilan_types_updated_at" ON "bilan_types";
CREATE TRIGGER "update_bilan_types_updated_at"
    BEFORE UPDATE ON "bilan_types"
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE "bilan_types" IS 'Referentiel des types de bilan par tenant';
COMMENT ON COLUMN "bilan_types"."name" IS 'Libelle du type de bilan saisi sous forme de chaine';
COMMENT ON COLUMN "bilan_types"."description" IS 'Description optionnelle du type de bilan';
