-- Add pedagogic fields for courses page redesign
ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS cm VARCHAR(255),
  ADD COLUMN IF NOT EXISTS td VARCHAR(255),
  ADD COLUMN IF NOT EXISTS tp VARCHAR(255),
  ADD COLUMN IF NOT EXISTS coef INTEGER,
  ADD COLUMN IF NOT EXISTS vhh VARCHAR(255);

COMMENT ON COLUMN courses.cm IS 'Cours magistral value (string)';
COMMENT ON COLUMN courses.td IS 'Travaux diriges value (string)';
COMMENT ON COLUMN courses.tp IS 'Travaux pratiques value (string)';
COMMENT ON COLUMN courses.coef IS 'Coefficient (integer)';
COMMENT ON COLUMN courses.vhh IS 'Volume horaire hebdomadaire value (string)';
