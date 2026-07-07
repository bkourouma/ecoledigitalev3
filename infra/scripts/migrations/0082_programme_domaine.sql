-- 0082_programme_domaine.sql
-- Ajoute le « domaine » (grand domaine scientifique) sur les filières
-- (programmes). Champ optionnel. Additif et idempotent.
--
-- Seed des domaines pour les filières existantes selon le suffixe de code :
--   DAF                          -> Sciences Juridiques, Politiques et Administratives
--   FC, GRH, MM, TL, ACG         -> Sciences de Gestion des entreprises
--   GL, IA, RT                   -> Sciences et Technologies
-- Le suffixe est le code sans le préfixe de niveau (L1/L2/L3/M1/M2).

ALTER TABLE programmes
    ADD COLUMN IF NOT EXISTS domaine VARCHAR(255);

-- Sciences Juridiques, Politiques et Administratives
UPDATE programmes
   SET domaine = 'Sciences Juridiques, Politiques et Administratives'
 WHERE domaine IS NULL
   AND regexp_replace(code, '^[LM][0-9]', '') = 'DAF';

-- Sciences de Gestion des entreprises
UPDATE programmes
   SET domaine = 'Sciences de Gestion des entreprises'
 WHERE domaine IS NULL
   AND regexp_replace(code, '^[LM][0-9]', '') IN ('FC', 'GRH', 'MM', 'TL', 'ACG');

-- Sciences et Technologies
UPDATE programmes
   SET domaine = 'Sciences et Technologies'
 WHERE domaine IS NULL
   AND regexp_replace(code, '^[LM][0-9]', '') IN ('GL', 'IA', 'RT');
