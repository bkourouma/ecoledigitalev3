-- 0080_ue_categorie.sql
-- Ajoute une catégorie pédagogique à l'UE (regroupement au bulletin) :
-- Unités Fondamentales / de Spécialité / de Culture Générale.
-- Additif et idempotent.

ALTER TABLE professional_ue
    ADD COLUMN IF NOT EXISTS categorie TEXT
        CHECK (categorie IS NULL OR categorie IN ('fondamentale', 'specialite', 'culture_generale'));
