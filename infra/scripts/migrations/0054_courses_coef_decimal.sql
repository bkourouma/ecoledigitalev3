-- Coefficient décimal (ex. 1,5) : INTEGER était trop restrictif pour l'API / le formulaire.
ALTER TABLE courses
  ALTER COLUMN coef TYPE NUMERIC(8, 2)
  USING CASE WHEN coef IS NULL THEN NULL ELSE coef::numeric END;

COMMENT ON COLUMN courses.coef IS 'Coefficient (nombre décimal, ex. 1 ou 2,5)';
