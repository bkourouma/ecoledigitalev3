-- =============================================================================
-- 0129 — Index pour imputer la paie enseignante à une ouverture de classe
-- =============================================================================
--
-- CE QUE CET INDEX PRÉPARE
--
-- Le coût enseignant d'une ouverture de classe se calcule par ce chemin :
--
--   teacher_payments → payment_hour_details (seance_id)
--                    → professional_ecue_seances (ue_session_id, NOT NULL)
--                    → professional_ue_sessions → professional_ue.filiere_id
--
-- Chaque franc versé est donc rattachable à une séance, donc à une ouverture.
-- C'est ce chemin qui SUPPRIME la répartition inventée que l'écran Rentabilité
-- pratiquait — `total_amount / nb_filieres`, une clé sans fondement.
--
-- POURQUOI L'INDEX MAINTENANT, ALORS QUE LA TABLE EST VIDE
--
-- Mesuré le 23/09/2026 : `payment_hour_details` ne contient AUCUNE ligne, et
-- l'espace propriétaire déclare donc le coût par ouverture « non mesuré » plutôt
-- que de le remplacer par une approximation. Le jour où la paie sera alimentée,
-- la jointure `payment_hour_details.seance_id → professional_ecue_seances.id`
-- sera parcourue à chaque affichage de l'écran Ouvertures, sur autant de lignes
-- qu'il y a d'heures payées dans l'année. Sans index, ce sera un balayage
-- complet par ouverture affichée.
--
-- Poser l'index sur une table vide coûte quelques millisecondes ; le poser après
-- coup sur une table de production demande une fenêtre de maintenance.
--
-- ⚠ La migration 0103 documente (défaut E4) que le chemin horaire ACADÉMIQUE
-- n'avait jamais abouti : la clé étrangère rejetait les insertions et l'erreur
-- était avalée. Rien ne garantit que le chemin professionnel soit un jour
-- alimenté — cet index ne présuppose rien, il rend seulement la lecture
-- praticable le jour où il le sera.
--
-- Idempotente : `IF NOT EXISTS` sur les deux index.
-- =============================================================================

BEGIN;

-- Le sens de lecture réel : « pour cette séance, quelles heures ont été payées ».
-- `amount` est inclus pour que la somme se lise dans l'index, sans retour à la
-- table — c'est exactement ce que fait le calcul du coût par ouverture.
CREATE INDEX IF NOT EXISTS idx_payment_hour_details_seance
    ON payment_hour_details (seance_id)
    INCLUDE (amount)
    WHERE seance_id IS NOT NULL;

-- Le maillon suivant : « cette séance appartient à quelle ouverture ». La
-- colonne est NOT NULL, mais l'index composite avec le tenant évite de joindre
-- la table entière quand on remonte d'une ouverture vers ses séances.
CREATE INDEX IF NOT EXISTS idx_ecue_seances_ue_session
    ON professional_ecue_seances (tenant_id, ue_session_id);

COMMIT;
