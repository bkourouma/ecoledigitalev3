-- 0105_seance_detail_restrict.sql
-- Corrige une incohérence introduite par 0103 entre la clé étrangère
-- `payment_hour_details.seance_id` et la contrainte d'exclusivité d'origine.
--
-- LE DÉFAUT
-- 0103 a déclaré :
--     seance_id ... REFERENCES professional_ecue_seances(id) ON DELETE SET NULL
-- et, dans le même temps, un CHECK imposant que toute ligne de source
-- 'professionnel' porte un `seance_id` NON NULL.
--
-- Les deux ne peuvent pas coexister : supprimer une séance déclenche le
-- SET NULL, qui viole immédiatement le CHECK. La suppression échoue avec une
-- erreur de contrainte brute, incompréhensible pour l'utilisateur.
--
-- CE QUE CETTE MIGRATION FAIT
-- Elle passe la clé en ON DELETE RESTRICT : une séance qui JUSTIFIE un montant
-- payé ne peut plus être supprimée tant que ce montant existe.
--
-- POURQUOI RESTRICT ET NON CASCADE
-- CASCADE supprimerait les lignes de détail avec la séance — le paiement
-- garderait son total mais perdrait sa justification, et un bulletin approuvé
-- afficherait un montant que plus rien n'explique. C'est exactement ce que la
-- feature cherche à empêcher (FR-006 : une séance payée ne se dévalide pas).
--
-- RESTRICT ne bloque pas éternellement : un recalcul purge le détail d'un
-- paiement non verrouillé, ce qui libère la séance. Seules restent protégées
-- les séances qui justifient un paiement en cours.
--
-- La même logique s'applique à `attendance_session_id` (origine académique),
-- soumis au même CHECK et corrigé ici aussi.
--
-- Additive dans son effet, idempotente. Rollback : revenir à ON DELETE SET NULL
-- (et réintroduire le défaut).

BEGIN;

ALTER TABLE payment_hour_details
    DROP CONSTRAINT IF EXISTS payment_hour_details_seance_id_fkey;
ALTER TABLE payment_hour_details
    ADD CONSTRAINT payment_hour_details_seance_id_fkey
    FOREIGN KEY (seance_id) REFERENCES professional_ecue_seances(id) ON DELETE RESTRICT;

ALTER TABLE payment_hour_details
    DROP CONSTRAINT IF EXISTS payment_hour_details_attendance_session_id_fkey;
ALTER TABLE payment_hour_details
    ADD CONSTRAINT payment_hour_details_attendance_session_id_fkey
    FOREIGN KEY (attendance_session_id) REFERENCES teacher_attendance_sessions(id) ON DELETE RESTRICT;

COMMENT ON CONSTRAINT payment_hour_details_seance_id_fkey ON payment_hour_details IS
    'RESTRICT : une séance qui justifie un montant payé ne peut pas être supprimée. Un recalcul purge le détail et libère la séance.';

COMMIT;
