-- 0085_fix_l3grh_s2_credits.sql
-- Module Professionnel — correction des crédits, LICENCE 3 GESTION DES
-- RESSOURCES HUMAINES, Semestre 2 (doit totaliser 20 crédits).
--
-- Aligné sur la maquette officielle : le Semestre 2 totalisait 22 crédits
-- (8 + 6 + 6 + 2). On ramène :
--   • UE2 « Audit Social et Contrôle RH » : 6 -> 5 (Contrôle de Gestion Sociale 3 -> 2)
--   • UE3 « Santé, Sécurité et Qualité de Vie au Travail » : 6 -> 5
--     (Qualité de Vie et Bien-être au Travail 3 -> 2)
-- Total = 8 + 5 + 5 + 2 = 20. La somme des ECUE reste égale au nb_uv de l'UE.
-- Idempotent : valeurs cibles fixes, ciblées par code.

UPDATE professional_ue
   SET nb_uv = 5, updated_at = now()
 WHERE code IN ('L3GRH-S2-UE2', 'L3GRH-S2-UE3') AND nb_uv <> 5;

UPDATE professional_ecue
   SET credits = 2, updated_at = now()
 WHERE code IN ('L3GRH-EC-CGS', 'L3GRH-EC-QVB') AND credits IS DISTINCT FROM 2;
