-- Store generated trainer passwords for admin visibility on cards
ALTER TABLE "public"."formateurs"
  ADD COLUMN IF NOT EXISTS "initial_password" VARCHAR(255);

ALTER TABLE "public"."formateurs_aspci"
  ADD COLUMN IF NOT EXISTS "initial_password" VARCHAR(255);
