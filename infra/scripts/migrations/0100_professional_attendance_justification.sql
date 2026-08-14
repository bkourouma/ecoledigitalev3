-- 0100_professional_attendance_justification.sql
-- Motif de justification d'une absence (module professionnel).
--
-- POURQUOI
-- Le bulletin distingue déjà les absences justifiées des autres : il compte
-- `professional_ecue_attendance.statut = 'excuse'` comme « justifiée » et
-- `'absent'` comme « non justifiée » (professional-bulletin.service.ts). Mais
-- le statut seul ne dit RIEN de la justification elle-même :
--
--   * pourquoi l'absence a-t-elle été justifiée (certificat médical, décès,
--     convocation…) — l'information reste dans le tiroir du secrétariat ;
--   * QUI l'a justifiée — `marked_by` désigne l'auteur de l'appel, souvent
--     l'enseignant, pas l'administrateur qui accorde la justification ;
--   * QUAND — `updated_at` bouge à chaque modification du pointage.
--
-- Sans ces trois informations, une justification n'est pas opposable : on ne
-- peut ni la vérifier, ni la contester, ni savoir qui l'a accordée.
--
-- CE QUE CETTE MIGRATION FAIT
-- Elle ajoute les trois colonnes correspondantes. Elle ne reconstruit pas le
-- passé : les absences déjà passées en 'excuse' gardent un motif NULL, affiché
-- comme « motif non renseigné » plutôt que d'inventer une raison.
--
-- Le motif reste un texte libre : les justificatifs varient d'un établissement
-- à l'autre, une liste fermée forcerait le secrétariat à ranger un cas réel
-- dans une case fausse.
--
-- Additif et idempotent. Rollback : DROP des trois colonnes (aucune autre
-- structure ne les référence).

BEGIN;

ALTER TABLE professional_ecue_attendance
    /** Motif de la justification, saisi par l'administration. NULL = non renseigné. */
    ADD COLUMN IF NOT EXISTS justification TEXT,
    /** Utilisateur ayant accordé la justification (≠ marked_by, auteur de l'appel). */
    ADD COLUMN IF NOT EXISTS justifie_par  UUID REFERENCES users(id),
    /** Date d'octroi de la justification (≠ updated_at, qui suit tout le pointage). */
    ADD COLUMN IF NOT EXISTS justifie_le   TIMESTAMPTZ;

COMMENT ON COLUMN professional_ecue_attendance.justification IS
    'Motif de justification de l''absence (texte libre). Renseigné uniquement quand statut = ''excuse''.';
COMMENT ON COLUMN professional_ecue_attendance.justifie_par IS
    'Utilisateur ayant accordé la justification, distinct de marked_by (auteur de l''appel).';
COMMENT ON COLUMN professional_ecue_attendance.justifie_le IS
    'Horodatage de la justification, distinct de updated_at.';

-- Un motif sans justification n'a pas de sens : si le pointage repasse en
-- présent / absent / retard, les trois colonnes doivent être vidées. C'est
-- l'API qui s'en charge (setAttendanceJustification / markSeanceAttendance) ;
-- la contrainte ci-dessous garantit qu'aucun autre chemin ne laisse un motif
-- orphelin derrière lui.
DO $$ BEGIN
    ALTER TABLE professional_ecue_attendance
        ADD CONSTRAINT professional_ecue_attendance_justification_statut
        CHECK (
            statut = 'excuse'
            OR (justification IS NULL AND justifie_par IS NULL AND justifie_le IS NULL)
        );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
