-- 0079_student_gender.sql
-- Ajoute le genre (sexe) sur la fiche étudiant. La route /students insère et
-- met à jour déjà cette colonne de façon conditionnelle ; elle sera donc
-- persistée automatiquement une fois la colonne présente.
-- Additif et idempotent.

ALTER TABLE student_profiles
    ADD COLUMN IF NOT EXISTS gender TEXT
        CHECK (gender IS NULL OR gender IN ('masculin', 'feminin'));
