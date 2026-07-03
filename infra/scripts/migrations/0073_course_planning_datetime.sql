-- ===========================================================================
-- 0073_course_planning_datetime.sql
-- Module Professionnel — Planning des cours : passage d'une PÉRIODE
-- (date_debut → date_fin, timestamps) à une planification détaillée
-- DATE + HEURE (date, heure_debut, heure_fin), à l'instar du module
-- simple-schedule (session_date, start_time, end_time).
--
-- Idempotent + reprise des données existantes (date_debut/date_fin → date/heures).
-- ===========================================================================

-- 1) Nouvelles colonnes : jour + heures.
ALTER TABLE professional_course_plannings
    ADD COLUMN IF NOT EXISTS date        DATE,
    ADD COLUMN IF NOT EXISTS heure_debut TIME,
    ADD COLUMN IF NOT EXISTS heure_fin   TIME;

-- 2) Reprise depuis les anciennes colonnes (uniquement si elles existent encore).
--    heure_fin n'est conservée que si le créneau tient sur la même journée.
DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'professional_course_plannings' AND column_name = 'date_debut'
    ) THEN
        UPDATE professional_course_plannings
        SET date        = COALESCE(date, date_debut::date),
            heure_debut = COALESCE(heure_debut, date_debut::time),
            heure_fin   = COALESCE(
                heure_fin,
                CASE
                    WHEN date_fin::date = date_debut::date AND date_fin::time > date_debut::time
                    THEN date_fin::time
                END
            )
        WHERE date IS NULL;
    END IF;
END $$;

-- 3) Date et heure de début obligatoires (heure de fin optionnelle).
ALTER TABLE professional_course_plannings
    ALTER COLUMN date SET NOT NULL,
    ALTER COLUMN heure_debut SET NOT NULL;

-- 4) Suppression des anciennes colonnes de période (et de leur CHECK associé).
ALTER TABLE professional_course_plannings
    DROP COLUMN IF EXISTS date_debut,
    DROP COLUMN IF EXISTS date_fin;

-- 5) Remplace l'index sur les anciennes colonnes par un index sur le jour.
DROP INDEX IF EXISTS idx_prof_course_planning_dates;
CREATE INDEX IF NOT EXISTS idx_prof_course_planning_date
    ON professional_course_plannings (tenant_id, date);

-- 6) L'heure de fin, si fournie, doit être postérieure à l'heure de début.
DO $$ BEGIN
    ALTER TABLE professional_course_plannings
        ADD CONSTRAINT prof_course_planning_heures_chk
        CHECK (heure_fin IS NULL OR heure_fin > heure_debut);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
