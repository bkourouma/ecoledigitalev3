-- 0099_student_status_history.sql
-- Historique des changements de statut des élèves.
--
-- POURQUOI
-- `student_profiles.status` est ÉCRASÉ à chaque changement. On sait donc qu'un
-- élève est aujourd'hui « abandonné », jamais QUAND il l'est devenu ni pourquoi.
-- Trois indicateurs en dépendent et restent inaccessibles :
--
--   * la courbe de survie d'une cohorte (rentrée = 100 %, décroissance mensuelle) ;
--   * le taux d'abandon daté, donc comparable d'une année sur l'autre ;
--   * la LTV prédictive, qui a besoin d'une date de sortie explicite.
--
-- CE QUE CETTE MIGRATION FAIT
-- Elle crée la table et un déclencheur qui l'alimente à partir de MAINTENANT.
-- Elle ne reconstruit PAS le passé : `updated_at` ne dit pas quel champ a changé,
-- en déduire une date de sortie serait une invention. Les écrans annoncent donc
-- « historique disponible depuis le JJ/MM/AAAA » plutôt que de présenter une
-- courbe partielle comme complète.
--
-- Additif et idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS student_status_history (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    student_id  UUID NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
    old_status  TEXT,
    new_status  TEXT NOT NULL,
    /** Motif structuré, quand l'interface en propose un. */
    reason_code TEXT,
    reason_text TEXT,
    changed_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_student_status_history_student
    ON student_status_history (tenant_id, student_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_student_status_history_changed
    ON student_status_history (tenant_id, changed_at);

ALTER TABLE student_status_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS student_status_history_tenant_isolation ON student_status_history;
CREATE POLICY student_status_history_tenant_isolation ON student_status_history
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::UUID);

COMMENT ON TABLE student_status_history IS
    'Historique des statuts élève, alimenté par déclencheur depuis la migration 0099. Ne contient rien d''antérieur : le passé n''est pas reconstituable.';

/**
 * Déclencheur d'historisation.
 *
 * Volontairement minimal : il n'écrit QUE sur un changement effectif de statut,
 * et n'échoue jamais l'écriture d'origine. Un historique de pilotage ne doit pas
 * pouvoir bloquer une inscription.
 *
 * `changed_by` est laissé à NULL : l'auteur vit dans le contexte applicatif, pas
 * dans la session PostgreSQL. Les services qui connaissent l'utilisateur peuvent
 * compléter la ligne ; mieux vaut un auteur inconnu qu'un auteur inventé.
 */
CREATE OR REPLACE FUNCTION trg_student_status_history() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
        BEGIN
            INSERT INTO student_status_history
                (tenant_id, student_id, old_status, new_status)
            VALUES
                (NEW.tenant_id, NEW.id, OLD.status::text, NEW.status::text);
        EXCEPTION WHEN OTHERS THEN
            -- L'historique est un service de pilotage : il ne fait pas échouer
            -- la mise à jour métier qui l'a déclenché.
            RAISE WARNING '[0099] historisation du statut élève ignorée : %', SQLERRM;
        END;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS student_status_history_trigger ON student_profiles;
CREATE TRIGGER student_status_history_trigger
    AFTER UPDATE OF status ON student_profiles
    FOR EACH ROW
    EXECUTE FUNCTION trg_student_status_history();

-- Repère de départ : la date d'installation borne la profondeur de l'historique.
-- Les écrans s'en servent pour dire « mesuré depuis le … » au lieu de laisser
-- croire à une série complète.
INSERT INTO student_status_history (tenant_id, student_id, old_status, new_status, reason_code)
SELECT sp.tenant_id, sp.id, NULL, sp.status::text, 'baseline_0099'
FROM student_profiles sp
WHERE NOT EXISTS (
    SELECT 1 FROM student_status_history h WHERE h.student_id = sp.id
);

COMMIT;
