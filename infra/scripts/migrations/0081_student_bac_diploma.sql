-- 0081_student_bac_diploma.sql
-- Ajoute sur la fiche étudiant les informations liées au baccalauréat et au
-- dernier diplôme obtenu :
--   * bac_obtention_date : date d'obtention du BAC
--   * bac_series         : série du BAC (ex. A, C, D, G2…)
--   * last_diploma       : URL du fichier du dernier diplôme (document scanné)
-- La route /students/with-user insère ces colonnes ; le fichier du diplôme est
-- ensuite uploadé via /students/:id/diploma. Additif et idempotent.

ALTER TABLE student_profiles
    ADD COLUMN IF NOT EXISTS bac_obtention_date DATE,
    ADD COLUMN IF NOT EXISTS bac_series         VARCHAR(100),
    ADD COLUMN IF NOT EXISTS last_diploma       TEXT;

-- last_diploma stocke désormais une URL de fichier (et non un simple libellé) :
-- élargir la colonne si elle avait été créée en VARCHAR(255) précédemment.
ALTER TABLE student_profiles
    ALTER COLUMN last_diploma TYPE TEXT;
