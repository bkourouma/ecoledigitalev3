-- 0077_emploi_temps_dates.sql
-- Période de validité d'un créneau d'emploi du temps : date de début / de fin.
-- (Un créneau hebdomadaire s'applique sur cette période.)

ALTER TABLE professional_emploi_temps
    ADD COLUMN IF NOT EXISTS date_debut DATE,
    ADD COLUMN IF NOT EXISTS date_fin   DATE;

DO $$ BEGIN
    ALTER TABLE professional_emploi_temps
        ADD CONSTRAINT prof_emploi_temps_dates_chk
        CHECK (date_fin IS NULL OR date_debut IS NULL OR date_fin >= date_debut);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
