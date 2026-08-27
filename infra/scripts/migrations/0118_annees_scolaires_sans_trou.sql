-- 0118 — Années scolaires contiguës : fin au 31 août
--
-- LE PROBLÈME
-- Les années scolaires démarraient au 1er septembre et s'arrêtaient au 30 juin.
-- Juillet et août n'appartenaient donc à AUCUNE année :
--
--     2024-2025 : 01/09/2024 → 30/06/2025
--                                          ← juillet, août : trou
--     2025-2026 : 01/09/2025 → 30/06/2026
--
-- Toute donnée horodatée dans ce trou — un encaissement de frais d'inscription
-- passé en juillet, un bulletin de paie calculé en août, un bulletin de notes
-- généré après les jurys de rattrapage — est invisible de TOUTE vue annuelle.
-- Elle n'est pas perdue, elle n'est simplement rattachable à rien : les écrans
-- qui bornent sur `[start_date, end_date]` la sautent, et les totaux annuels ne
-- se recomposent pas en total établissement.
--
-- C'est exactement ce qu'on a observé : 102 000 000 FCFA d'encaissements au mois
-- en cours, et 0 sur chacune des trois années scolaires.
--
-- LA RÈGLE APPLIQUÉE
-- Une année couvre douze mois pleins : elle finit la veille du premier
-- anniversaire de son début. Une année démarrée le 1er septembre finit donc le
-- 31 août suivant, et l'année d'après reprend le 1er septembre — sans trou et
-- sans recouvrement.
--
-- La règle est exprimée en fonction de `start_date` plutôt qu'en dur au 31 août :
-- un établissement dont l'année démarre en octobre obtient une année cohérente,
-- close au 30 septembre, plutôt qu'une année de onze mois.
--
-- CE QUI N'EST PAS TOUCHÉ
-- Seules les années PLUS COURTES que douze mois sont allongées. Une année déjà
-- contiguë reste telle quelle, et la migration est donc rejouable sans effet.
-- Aucune année n'est raccourcie : personne ne perd de périmètre.
--
-- EFFET ATTENDU SUR LES CHIFFRES
-- Les fenêtres annuelles s'élargissent de deux mois. Les indicateurs bornés sur
-- l'année — pouls du tableau de bord, masse salariale, recouvrement — vont
-- donc INTÉGRER des montants qu'ils ignoraient. Ce n'est pas une dérive : c'est
-- la reprise de données qui n'étaient comptées nulle part.

BEGIN;

UPDATE academic_years
   SET end_date   = (start_date + INTERVAL '1 year' - INTERVAL '1 day')::date,
       updated_at = now()
 WHERE start_date IS NOT NULL
   AND (end_date IS NULL
        OR end_date < (start_date + INTERVAL '1 year' - INTERVAL '1 day')::date);

-- Garde-fou : aucune année ne doit plus en chevaucher une autre sur le même
-- établissement. Un chevauchement rendrait ambigu le rattachement d'une date à
-- une année, et l'on aurait remplacé un trou par un doublon.
DO $$
DECLARE
  n integer;
BEGIN
  SELECT COUNT(*) INTO n
    FROM academic_years a
    JOIN academic_years b
      ON b.tenant_id = a.tenant_id
     AND b.id <> a.id
     AND a.start_date <= b.end_date
     AND b.start_date <= a.end_date;
  IF n > 0 THEN
    RAISE EXCEPTION
      'Migration 0118 interrompue : % couple(s) d''années scolaires se chevauchent après élargissement. Vérifier les dates avant de rejouer.', n;
  END IF;
END $$;

COMMIT;
