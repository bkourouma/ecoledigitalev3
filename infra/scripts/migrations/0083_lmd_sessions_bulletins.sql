-- 0083_lmd_sessions_bulletins.sql
-- LMD : gestion des deux sessions (1 = normale, 2 = rattrapage) et bulletins
-- officiels générés (date de génération permanente + statut).
--
-- 1) professional_ecue_notes.session : session de saisie de la note (1|2).
--    La note d'examen devient unique PAR SESSION (une note S1 + une note S2
--    possibles) ; au calcul, la note de Session 2 remplace celle de Session 1.
-- 2) professional_ecue_results.session_obtention : session à laquelle l'ECUE
--    a été validée (1, 2, ou NULL si non validée).
-- 3) professional_bulletins : bulletin officiel généré par étudiant × semestre
--    (instantané JSON + date de génération DÉFINITIVE + statut).
-- Additif et idempotent.

ALTER TABLE professional_ecue_notes
    ADD COLUMN IF NOT EXISTS session INT NOT NULL DEFAULT 1
        CHECK (session IN (1, 2));

-- L'examen manuel devient unique par session (S1 et S2 peuvent coexister).
DROP INDEX IF EXISTS uniq_prof_ecue_notes_examen;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_prof_ecue_notes_examen
    ON professional_ecue_notes (tenant_id, ecue_id, student_id, ue_session_id, session)
    WHERE nature = 'examen';

ALTER TABLE professional_ecue_results
    ADD COLUMN IF NOT EXISTS session_obtention INT
        CHECK (session_obtention IS NULL OR session_obtention IN (1, 2));

CREATE TABLE IF NOT EXISTS professional_bulletins (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL,
    student_id   UUID NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
    semestre_id  UUID NOT NULL REFERENCES professional_semestres(id) ON DELETE CASCADE,
    statut       TEXT NOT NULL DEFAULT 'provisoire'
                 CHECK (statut IN ('provisoire', 'definitif')),
    data         JSONB NOT NULL,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, student_id, semestre_id)
);
CREATE INDEX IF NOT EXISTS idx_prof_bulletins_semestre
    ON professional_bulletins (tenant_id, semestre_id);
