-- 0104_seance_duree_payee.sql
-- Dérogation comptable sur le volume horaire d'une séance + traçage de la
-- saisie comptable (feature 031, extension).
--
-- POURQUOI
-- La durée d'une séance se déduit de ses horaires (`heure_fin - heure_debut`)
-- et n'est pas stockée : une durée persistée EN PLUS des horaires donnerait
-- deux vérités qui divergent au premier décalage d'emploi du temps.
--
-- Mais le comptable doit pouvoir corriger le volume horaire retenu pour la
-- paie, et le faire sans réécrire l'emploi du temps :
--
--   * une séance planifiée 08:00–11:00 dont seules 2 h sont dues n'a pas à
--     voir son créneau pédagogique modifié pour une raison comptable ;
--   * une séance sans horaires est aujourd'hui impayable, alors que son volume
--     est parfaitement connu de l'administration ;
--   * le prévu et le payé doivent rester lisibles côte à côte, sans quoi une
--     correction devient indétectable en contrôle.
--
-- CE QUE CETTE MIGRATION FAIT
--   1. `duree_payee` — dérogation NULLABLE. Renseignée, elle l'emporte pour la
--      paie ; les horaires restent le registre pédagogique, intacts.
--      La durée retenue est donc : COALESCE(duree_payee, heure_fin - heure_debut).
--   2. Traçage de cette dérogation (`duree_payee_par`, `duree_payee_le`) : un
--      volume horaire modifié par la personne qui le valide doit se voir.
--   3. `saisie_comptable` + `cree_par` — marque les séances ajoutées depuis
--      l'écran de paie, que l'enseignant n'avait pas enregistrées.
--
-- CE QU'ELLE NE CHANGE PAS
-- Aucune séance existante n'acquiert de dérogation : `duree_payee` reste NULL
-- partout, la durée continue de venir des horaires. La migration ne rend
-- payable aucune séance qui ne l'était pas.
--
-- Additive et idempotente. Rollback : DROP des cinq colonnes.

BEGIN;

ALTER TABLE professional_ecue_seances
    /** Volume horaire retenu pour la paie. NULL = déduit des horaires. */
    ADD COLUMN IF NOT EXISTS duree_payee     NUMERIC(5,2),
    /** Auteur de la dérogation (≠ validated_by : corriger n'est pas valider). */
    ADD COLUMN IF NOT EXISTS duree_payee_par UUID REFERENCES users(id),
    /** Date de la dérogation. */
    ADD COLUMN IF NOT EXISTS duree_payee_le  TIMESTAMPTZ,
    /** Séance ajoutée depuis l'écran de paie, pas par l'enseignant. */
    ADD COLUMN IF NOT EXISTS saisie_comptable BOOLEAN NOT NULL DEFAULT false,
    /** Auteur de la saisie, quand elle vient de l'administration. */
    ADD COLUMN IF NOT EXISTS cree_par        UUID REFERENCES users(id);

DO $$ BEGIN
    ALTER TABLE professional_ecue_seances
        ADD CONSTRAINT professional_ecue_seances_duree_payee_positive
        CHECK (duree_payee IS NULL OR duree_payee > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN professional_ecue_seances.duree_payee IS
    'Dérogation comptable sur le volume horaire. NULL = durée déduite de heure_fin - heure_debut. Renseignée, elle l''emporte pour la paie sans modifier les horaires.';
COMMENT ON COLUMN professional_ecue_seances.saisie_comptable IS
    'true = séance ajoutée depuis l''écran de validation de paie (l''enseignant ne l''avait pas enregistrée).';

-- Retrouver rapidement les séances corrigées ou ajoutées par la comptabilité :
-- ce sont elles qu'un contrôle regarde en premier.
CREATE INDEX IF NOT EXISTS idx_prof_ecue_seances_derogation
    ON professional_ecue_seances (tenant_id, date)
    WHERE duree_payee IS NOT NULL OR saisie_comptable;

COMMIT;
