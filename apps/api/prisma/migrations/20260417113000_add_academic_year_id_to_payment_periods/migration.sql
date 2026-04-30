ALTER TABLE "public"."payment_periods"
ADD COLUMN "academic_year_id" UUID;

CREATE INDEX "idx_payment_periods_academic_year_id"
ON "public"."payment_periods"("academic_year_id" ASC);

ALTER TABLE "public"."payment_periods"
ADD CONSTRAINT "payment_periods_academic_year_id_fkey"
FOREIGN KEY ("academic_year_id")
REFERENCES "public"."academic_years"("id")
ON DELETE SET NULL
ON UPDATE NO ACTION;
