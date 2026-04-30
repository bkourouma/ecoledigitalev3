ALTER TABLE "public"."teacher_payment_configs"
ADD COLUMN "academic_year_id" UUID;

CREATE INDEX "idx_teacher_payment_configs_academic_year_id"
ON "public"."teacher_payment_configs"("academic_year_id" ASC);

ALTER TABLE "public"."teacher_payment_configs"
ADD CONSTRAINT "teacher_payment_configs_academic_year_id_fkey"
FOREIGN KEY ("academic_year_id")
REFERENCES "public"."academic_years"("id")
ON DELETE SET NULL
ON UPDATE NO ACTION;
