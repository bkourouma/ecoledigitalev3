-- 0084_fix_grh_s2_credits.sql
-- Module Professionnel — correction des crédits, LICENCE GESTION DES RESSOURCES
-- HUMAINES, Semestre 2 (chaque semestre doit totaliser 20 crédits).
--
-- L1 GRH S2 et L2 GRH S2 totalisaient 22 crédits (8 + 6 + 6 + 2).
--
--  • L2 GRH S2 : aligné sur la maquette officielle -> UE2 et UE3 passent de 6 à 5
--    (UE2 = 2 + 3, UE3 = 3 + 2). Total = 8 + 5 + 5 + 2 = 20.
--  • L1 GRH S2 : l'UE3 « Outils Quantitatifs et Langues » passe de 6 à 4 (2 + 2),
--    conformément à la structure des S1/S3 de la même filière où l'UE « Outils »
--    vaut 4. Total = 8 + 6 + 4 + 2 = 20.
--
-- La somme des crédits ECUE de chaque UE reste égale au nombre d'UV de l'UE.
-- Idempotent : valeurs cibles fixes, ciblées par code.
-- NB : LICENCE 3 GRH S2 (= 22) reste à corriger — maquette non fournie.

-- ===================== LICENCE 1 GRH — Semestre 2 =====================
-- UE3 « Outils Quantitatifs et Langues » : 6 -> 4
UPDATE professional_ue
   SET nb_uv = 4, updated_at = now()
 WHERE code = 'L1GRH-S2-UE3' AND nb_uv <> 4;
-- ECUE de l'UE3 : Statistiques Descriptives & Anglais des Affaires I : 3 -> 2
UPDATE professional_ecue
   SET credits = 2, updated_at = now()
 WHERE code IN ('L1GRH-EC-STD', 'L1GRH-EC-AN1') AND credits IS DISTINCT FROM 2;

-- ===================== LICENCE 2 GRH — Semestre 2 =====================
-- UE2 « Formation et Développement des RH » et UE3 « Psychologie et Management » : 6 -> 5
UPDATE professional_ue
   SET nb_uv = 5, updated_at = now()
 WHERE code IN ('L2GRH-S2-UE2', 'L2GRH-S2-UE3') AND nb_uv <> 5;
-- ECUE ramenées de 3 à 2 : Ingénierie de la Formation (UE2), Leadership et
-- Management des Équipes (UE3). Les deux autres (Gestion des Carrières,
-- Psychologie des Organisations) restent à 3.
UPDATE professional_ecue
   SET credits = 2, updated_at = now()
 WHERE code IN ('L2GRH-EC-IDF', 'L2GRH-EC-LME') AND credits IS DISTINCT FROM 2;
