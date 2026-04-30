-- Rend les dates de l'année académique optionnelles (non destructif)
-- Ne supprime aucune année existante

ALTER TABLE academic_years
    DROP CONSTRAINT IF EXISTS academic_year_dates_check;

ALTER TABLE academic_years
    ALTER COLUMN start_date DROP NOT NULL,
    ALTER COLUMN end_date DROP NOT NULL;

COMMENT ON COLUMN academic_years.start_date IS 'Date de début optionnelle; les bornes temporelles sont principalement définies par les périodes';
COMMENT ON COLUMN academic_years.end_date IS 'Date de fin optionnelle; les bornes temporelles sont principalement définies par les périodes';

