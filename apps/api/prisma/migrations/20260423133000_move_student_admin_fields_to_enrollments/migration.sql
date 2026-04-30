ALTER TABLE "public"."student_enrollments"
  ADD COLUMN IF NOT EXISTS "origin_school" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "lv2" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "scholarship_level" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "is_repeating" BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS "is_transfer" BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS "is_inscribed" BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS "transfer_decision" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "affectation_status" VARCHAR(50),
  ADD COLUMN IF NOT EXISTS "affectation_decision" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "cepe_code" VARCHAR(100);

UPDATE "public"."student_enrollments" se
SET
  "origin_school" = COALESCE(se."origin_school", sp."origin_school"),
  "lv2" = COALESCE(se."lv2", sp."lv2"),
  "scholarship_level" = COALESCE(se."scholarship_level", sp."scholarship_level"),
  "is_repeating" = COALESCE(se."is_repeating", sp."is_repeating", false),
  "is_transfer" = COALESCE(se."is_transfer", sp."is_transfer", false),
  "is_inscribed" = COALESCE(se."is_inscribed", sp."is_inscribed", true),
  "transfer_decision" = COALESCE(se."transfer_decision", sp."transfer_decision"),
  "affectation_status" = COALESCE(se."affectation_status", sp."affectation_status"),
  "affectation_decision" = COALESCE(se."affectation_decision", sp."affectation_decision"),
  "cepe_code" = COALESCE(se."cepe_code", sp."cepe_code")
FROM "public"."student_profiles" sp
WHERE sp."id" = se."student_id"
  AND sp."tenant_id" = se."tenant_id";
