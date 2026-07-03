-- 0074_ecue_credits.sql
-- Module Professionnel — ajoute les crédits (UV) sur l'ECUE.
-- L'ECUE portait jusqu'ici uniquement code/libellé ; on stocke désormais ses
-- crédits (ex. 4, 3) saisis depuis la page de création des matières/ECUE.
-- Idempotent.

ALTER TABLE professional_ecue
    ADD COLUMN IF NOT EXISTS credits INTEGER CHECK (credits IS NULL OR credits >= 0);
