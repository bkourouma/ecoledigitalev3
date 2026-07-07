-- 0083_fix_m2acg_s2_credits.sql
-- Module Professionnel — correction des crédits de la maquette
-- « MASTER 2 AUDIT ET CONTROLE DE GESTION », Semestre 2.
--
-- Anomalie : l'UE3 « Fiscalité et Droit des Affaires Avancé » (M2ACG-S2-UE3) et
-- ses deux ECUE (FAE, DAR) valaient 6 crédits (3 + 3), alors que la maquette
-- officielle prévoit 4 crédits (2 + 2). Le semestre totalisait donc 22 crédits
-- (8 + 6 + 6 + 2) au lieu des 20 attendus (8 + 6 + 4 + 2).
--
-- On aligne l'UE et ses ECUE sur la maquette : chaque semestre = 20 crédits, et
-- la somme des crédits ECUE d'une UE reste égale au nombre d'UV de l'UE.
-- Idempotent : valeurs cibles fixes, ciblées par code.

-- UE3 : 6 -> 4 UV
UPDATE professional_ue
   SET nb_uv = 4, updated_at = now()
 WHERE code = 'M2ACG-S2-UE3' AND nb_uv <> 4;

-- ECUE de l'UE3 : 3 -> 2 crédits chacune
UPDATE professional_ecue
   SET credits = 2, updated_at = now()
 WHERE code IN ('M2ACG-EC-FAE', 'M2ACG-EC-DAR')
   AND (credits IS DISTINCT FROM 2);
