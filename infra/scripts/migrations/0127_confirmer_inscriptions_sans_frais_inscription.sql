-- 0127 — Rattrapage : confirmer les inscriptions dont les frais d'inscription
-- sont soldés (ou inexistants au barème).
--
-- Contexte
-- --------
-- Une inscription à une UE naît `en_attente_paiement` et n'ouvre la scolarité
-- qu'une fois les FRAIS D'INSCRIPTION du barème de la classe soldés. Cette
-- bascule était portée par le seul service de paiement : elle n'était donc
-- évaluée qu'au moment d'un encaissement.
--
-- Conséquence : dans une classe SANS frais d'inscription au barème — où rien
-- n'est dû, donc où la condition est tenue d'emblée — aucun encaissement ne
-- survenait jamais pour déclencher l'évaluation. Les inscrits restaient
-- `en_attente_paiement` indéfiniment et n'apparaissaient nulle part : ni
-- feuille d'appel, ni saisie de notes, ni conduite, ni bulletin, ni
-- attestation.
--
-- Le code applique désormais la règle dès la création de l'inscription. Cette
-- migration répare les lignes créées AVANT ce correctif.
--
-- Ce qu'elle ne fait pas
-- ---------------------
-- Elle ne confirme QUE les inscriptions dont les frais d'inscription sont
-- effectivement soldés. Une classe qui facture réellement son inscription et
-- dont l'étudiant n'a rien réglé reste bloquée : c'est la règle métier, elle
-- est conservée telle quelle.
--
-- Idempotente : rejouable sans effet supplémentaire.

BEGIN;

UPDATE professional_enrollments e
SET statut = 'confirmee', updated_at = now()
FROM professional_orders o
WHERE o.id = e.order_id
  AND e.tenant_id = o.tenant_id
  AND e.statut = 'en_attente_paiement'
  AND o.programme_id IS NOT NULL
  -- Frais d'inscription du couple (étudiant, classe) : dû - payé <= 0,5.
  -- Un étudiant sans aucune commande de nature 'inscription' a un dû de 0,
  -- donc la condition est tenue.
  AND (
    SELECT COALESCE(SUM(oi.montant_total), 0)::float8
         - COALESCE(SUM((SELECT COALESCE(SUM(pm.montant), 0)
                         FROM professional_payments pm
                         WHERE pm.order_id = oi.id AND pm.statut = 'confirme')), 0)::float8
    FROM professional_orders oi
    WHERE oi.tenant_id = o.tenant_id
      AND oi.student_id = o.student_id
      AND oi.programme_id = o.programme_id
      AND oi.nature = 'inscription'
      AND oi.statut <> 'annulee'
  ) <= 0.5;

COMMIT;
