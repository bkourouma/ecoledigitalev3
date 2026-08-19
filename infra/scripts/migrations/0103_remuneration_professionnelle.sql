-- 0103_remuneration_professionnelle.sql
-- Rémunération des enseignants du Module Professionnel (feature 031).
--
-- POURQUOI
-- Le moteur de paie (0011) ne sait compter que les heures de l'Académique :
-- sa seule source est `teacher_attendance_sessions` (via teacher_assignments →
-- class_courses). Les séances du Module Professionnel
-- (`professional_ecue_seances`, feature 030) ne sont jamais vues. Un enseignant
-- qui n'intervient qu'en professionnel est donc rémunéré 0.
--
-- Les deux modules désignent pourtant l'enseignant par la MÊME identité
-- (`teachers`) : configurations de paie, périodes, workflow d'approbation et
-- rapports valent déjà pour ses heures professionnelles. Il ne manque que la
-- COLLECTE des heures et leur TARIFICATION.
--
-- CE QUE CETTE MIGRATION FAIT
--   1. `professional_ecue_seances` gagne un cycle de vie (`statut`) et une
--      validation pour la paie (`validated_by`/`validated_at`). Sans cette
--      distinction, le calcul paierait le PLANNING : rien ne distingue
--      aujourd'hui une séance prévue d'une séance réellement faite.
--   2. `professional_ecue_hourly_rates` : tarif horaire par ECUE, éventuellement
--      nominatif, avec plage de validité sans chevauchement. Calquée sur
--      `course_hourly_rates` (dont le `course_id` référence `courses` et ne peut
--      donc pas porter un ECUE).
--   3. `payment_hour_details` s'ouvre aux DEUX origines : colonne `source` et
--      deux références exclusives. Une ligne professionnelle n'a, par
--      construction, pas de `teaching_hours_id`.
--
-- CE QU'ELLE RÉGULARISE AU PASSAGE (défauts préexistants, constatés en base —
-- voir specs/031-remuneration-professionnelle/_constat.txt)
--   E4 `payment_hour_details.teaching_hours_id` est NOT NULL avec une FK vers
--      `teaching_hours`, alors que payment-calculator.ts y insère des
--      `teacher_attendance_sessions.id`. Toute insertion viole la FK ; l'erreur
--      est avalée par le try/catch par paiement. Le chemin horaire académique
--      n'a donc JAMAIS abouti. On relâche la FK, on requalifie les lignes mal
--      rangées, on la recrée.
--   E5 `payment_periods.academic_year_id` est lue et écrite par
--      routes/payment-periods.ts mais créée par AUCUNE migration.
--   E6 `teacher_payments.currency` vaut 'EUR' par défaut dans
--      0011_teacher_remuneration.sql alors que la plateforme opère en XOF.
--   E7 `unique_teacher_payment_per_period` est déclarée par 0011 mais ABSENTE
--      de la base : rien ne garantit « un seul paiement par enseignant et par
--      période » contre deux calculs concurrents.
--   E8 `payment_periods_no_overlap` est déclarée par 0011 mais ABSENTE : deux
--      périodes peuvent se recouvrir, et une séance validée y tombant serait
--      payée DEUX FOIS. Cette migration ajoute une source d'heures : elle
--      aggraverait ce défaut si elle le laissait en place.
--
-- CE QU'ELLE NE FAIT PAS
-- Aucun backfill des séances existantes : toutes restent 'planifiee' et non
-- validées. Sur la base de dev, 570 séances sur 570 ont horaires et enseignant
-- renseignés — les initialiser à 'realisee' ferait payer, au premier calcul,
-- 570 séances que personne n'a vérifiées. La régularisation d'un historique est
-- une décision de gestion, pas un effet de bord de migration.
--
-- Additive et idempotente : aucun DROP TABLE, rejouable. Deux contrôles de
-- données (E7, E8) arrêtent la migration avec un message actionnable plutôt que
-- de poser une contrainte sur des données non conformes.
--
-- Rollback : DROP VIEW, DROP TABLE professional_ecue_hourly_rates, DROP des
-- colonnes ajoutées. Réversible AVANT le premier calcul, irréversible après
-- (des lignes de détail professionnelles sans teaching_hours_id existent alors).

BEGIN;

-- Requise par les contraintes EXCLUDE portant sur des uuid (patron 0011).
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ===========================================================================
-- 1. professional_ecue_seances — cycle de vie et validation pour la paie
-- ===========================================================================

ALTER TABLE professional_ecue_seances
    /** Fait pédagogique : la séance a-t-elle eu lieu ? Constaté par la scolarité. */
    ADD COLUMN IF NOT EXISTS statut             TEXT NOT NULL DEFAULT 'planifiee',
    /** Auteur du dernier changement de statut. */
    ADD COLUMN IF NOT EXISTS statut_modifie_par UUID REFERENCES users(id),
    /** Date du dernier changement de statut. */
    ADD COLUMN IF NOT EXISTS statut_modifie_le  TIMESTAMPTZ,
    /** Acte de gestion : cette séance est payable. Distinct du statut. */
    ADD COLUMN IF NOT EXISTS validated_by       UUID REFERENCES users(id),
    /** Date de l'acte de validation. NULL = non validée, donc non payable. */
    ADD COLUMN IF NOT EXISTS validated_at       TIMESTAMPTZ;

DO $$ BEGIN
    ALTER TABLE professional_ecue_seances
        ADD CONSTRAINT professional_ecue_seances_statut_check
        CHECK (statut IN ('planifiee', 'realisee', 'annulee'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN professional_ecue_seances.statut IS
    'Cycle de vie pédagogique : planifiee (défaut) | realisee | annulee. Une séance n''est payable que si realisee ET validée.';
COMMENT ON COLUMN professional_ecue_seances.validated_at IS
    'Validation pour la paie, par l''administration. Distincte du statut : le statut constate un fait, la validation engage une dépense.';

-- Filtre principal de l'écran de validation.
CREATE INDEX IF NOT EXISTS idx_prof_ecue_seances_statut_date
    ON professional_ecue_seances (tenant_id, statut, date);

-- Index de couverture de la collecte d'heures (séances payables d'un enseignant).
CREATE INDEX IF NOT EXISTS idx_prof_ecue_seances_paie
    ON professional_ecue_seances (tenant_id, enseignant_id, date)
    WHERE validated_at IS NOT NULL;

-- ===========================================================================
-- 2. professional_ecue_hourly_rates — tarif horaire par ECUE
-- ===========================================================================

CREATE TABLE IF NOT EXISTS professional_ecue_hourly_rates (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    ecue_id         UUID NOT NULL REFERENCES professional_ecue(id) ON DELETE CASCADE,
    /** NULL = tarif générique de l'ECUE. Renseigné = tarif nominatif, prioritaire. */
    enseignant_id   UUID REFERENCES teachers(id) ON DELETE CASCADE,
    montant_horaire NUMERIC(12,2) NOT NULL CHECK (montant_horaire >= 0),
    devise          TEXT NOT NULL DEFAULT 'XOF',
    valide_du       DATE NOT NULL,
    /** NULL = sans date de fin. */
    valide_au       DATE,
    notes           TEXT,
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (valide_au IS NULL OR valide_au >= valide_du)
);

-- Pas deux tarifs chevauchants pour le même couple (ECUE, enseignant).
-- COALESCE neutralise le NULL : le tarif générique constitue son propre couple,
-- distinct de tout tarif nominatif (même patron que course_hourly_rates).
-- Garde par pg_constraint et non par EXCEPTION : une contrainte EXCLUDE crée un
-- index homonyme, donc un second passage lève duplicate_TABLE (42P07) et non
-- duplicate_object — que le bloc EXCEPTION ne rattraperait pas.
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'professional_ecue_hourly_rates_no_overlap'
    ) THEN
        ALTER TABLE professional_ecue_hourly_rates
            ADD CONSTRAINT professional_ecue_hourly_rates_no_overlap
            EXCLUDE USING gist (
                tenant_id WITH =,
                ecue_id   WITH =,
                COALESCE(enseignant_id, '00000000-0000-0000-0000-000000000000'::uuid) WITH =,
                daterange(valide_du, COALESCE(valide_au, 'infinity'::date), '[]') WITH &&
            );
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_prof_ecue_rates_ecue
    ON professional_ecue_hourly_rates (tenant_id, ecue_id);
CREATE INDEX IF NOT EXISTS idx_prof_ecue_rates_enseignant
    ON professional_ecue_hourly_rates (tenant_id, enseignant_id);
CREATE INDEX IF NOT EXISTS idx_prof_ecue_rates_validite
    ON professional_ecue_hourly_rates (valide_du, valide_au);

ALTER TABLE professional_ecue_hourly_rates ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY professional_ecue_hourly_rates_tenant_isolation
        ON professional_ecue_hourly_rates
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON TABLE professional_ecue_hourly_rates IS
    'Tarif horaire applicable à une ECUE, éventuellement nominatif. Résolution : (ecue, enseignant) > (ecue, NULL) > teacher_payment_configs.default_hourly_rate.';

-- ===========================================================================
-- 3. payment_hour_details — ouverture aux deux origines (+ régularisation E4)
-- ===========================================================================

ALTER TABLE payment_hour_details
    /** Origine de l'heure : détermine laquelle des deux références est renseignée. */
    ADD COLUMN IF NOT EXISTS source                TEXT NOT NULL DEFAULT 'academique',
    /** Origine académique réelle (ce que le calculateur écrivait dans teaching_hours_id). */
    ADD COLUMN IF NOT EXISTS attendance_session_id UUID REFERENCES teacher_attendance_sessions(id) ON DELETE SET NULL,
    /** Origine professionnelle : la séance d'ECUE qui justifie la ligne. */
    ADD COLUMN IF NOT EXISTS seance_id             UUID REFERENCES professional_ecue_seances(id) ON DELETE SET NULL;

-- Ordre impératif : lever l'unicité et la FK AVANT de relâcher le NOT NULL.
ALTER TABLE payment_hour_details
    DROP CONSTRAINT IF EXISTS unique_teaching_hour_per_payment;
ALTER TABLE payment_hour_details
    DROP CONSTRAINT IF EXISTS payment_hour_details_teaching_hours_id_fkey;
ALTER TABLE payment_hour_details
    ALTER COLUMN teaching_hours_id DROP NOT NULL;

-- Régularisation E4 : les lignes dont teaching_hours_id désigne en réalité une
-- teacher_attendance_sessions sont remises dans la bonne colonne. Sans cela, la
-- FK recréée plus bas les rejetterait.
UPDATE payment_hour_details phd
   SET attendance_session_id = phd.teaching_hours_id,
       teaching_hours_id     = NULL,
       source                = 'academique'
 WHERE phd.teaching_hours_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM teaching_hours th WHERE th.id = phd.teaching_hours_id)
   AND EXISTS (SELECT 1 FROM teacher_attendance_sessions s WHERE s.id = phd.teaching_hours_id);

-- Reste-t-il des références qui ne correspondent à rien ? On ne devine pas :
-- on s'arrête avec un message actionnable plutôt que de recréer une FK qui
-- échouerait ou, pire, de supprimer des lignes de paie silencieusement.
DO $$
DECLARE orphans INT;
BEGIN
    SELECT count(*) INTO orphans
    FROM payment_hour_details phd
    WHERE phd.teaching_hours_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM teaching_hours th WHERE th.id = phd.teaching_hours_id);
    IF orphans > 0 THEN
        RAISE EXCEPTION
            '0103: % ligne(s) de payment_hour_details référencent un teaching_hours inexistant et ne correspondent à aucune teacher_attendance_sessions. Les examiner avant de rejouer la migration.', orphans;
    END IF;
END $$;

DO $$ BEGIN
    ALTER TABLE payment_hour_details
        ADD CONSTRAINT payment_hour_details_teaching_hours_id_fkey
        FOREIGN KEY (teaching_hours_id) REFERENCES teaching_hours(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Exactement une référence d'origine, cohérente avec `source`.
DO $$ BEGIN
    ALTER TABLE payment_hour_details
        ADD CONSTRAINT payment_hour_details_source_ref_exclusive
        CHECK (
            (source = 'academique'
               AND seance_id IS NULL
               AND (teaching_hours_id IS NOT NULL OR attendance_session_id IS NOT NULL))
            OR
            (source = 'professionnel'
               AND seance_id IS NOT NULL
               AND teaching_hours_id IS NULL
               AND attendance_session_id IS NULL)
        );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- L'unicité d'origine ne peut plus être une contrainte unique simple : deux
-- NULL ne sont pas égaux en SQL. Un index partiel par référence rétablit le
-- garde-fou contre le doublon de ligne lors d'un recalcul.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_phd_payment_teaching_hour
    ON payment_hour_details (payment_id, teaching_hours_id)
    WHERE teaching_hours_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_phd_payment_attendance
    ON payment_hour_details (payment_id, attendance_session_id)
    WHERE attendance_session_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_phd_payment_seance
    ON payment_hour_details (payment_id, seance_id)
    WHERE seance_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_phd_payment_source
    ON payment_hour_details (payment_id, source);
CREATE INDEX IF NOT EXISTS idx_phd_tenant_seance
    ON payment_hour_details (tenant_id, seance_id);

COMMENT ON COLUMN payment_hour_details.source IS
    'academique | professionnel. Détermine laquelle des références (teaching_hours_id/attendance_session_id vs seance_id) est renseignée.';

-- ===========================================================================
-- 4. payment_periods — colonne hors schéma versionné (E5) + anti-chevauchement (E8)
-- ===========================================================================

-- Nullable volontairement : les bases où la colonne a été créée à la main
-- peuvent avoir des lignes sans valeur. Le durcissement en NOT NULL fera l'objet
-- d'une migration ultérieure, une fois le rattrapage constaté.
ALTER TABLE payment_periods
    ADD COLUMN IF NOT EXISTS academic_year_id UUID REFERENCES academic_years(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_payment_periods_academic_year
    ON payment_periods (tenant_id, academic_year_id);

-- E8 : sans ce garde-fou, deux périodes qui se recouvrent font tomber une même
-- séance validée dans les deux — donc payée deux fois.
DO $$
DECLARE nb_chevauchements INT;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'payment_periods_no_overlap'
    ) THEN
        SELECT count(*) INTO nb_chevauchements
        FROM payment_periods a
        JOIN payment_periods b
          ON b.tenant_id = a.tenant_id
         AND b.id <> a.id
         AND b.status <> 'archived'
         AND daterange(a.period_start, a.period_end, '[]')
          && daterange(b.period_start, b.period_end, '[]')
        WHERE a.status <> 'archived';

        IF nb_chevauchements > 0 THEN
            RAISE EXCEPTION
                '0103: % chevauchement(s) entre périodes de paiement non archivées. Les résoudre avant de rejouer : une séance tombant dans deux périodes serait payée deux fois.', nb_chevauchements;
        END IF;

        ALTER TABLE payment_periods
            ADD CONSTRAINT payment_periods_no_overlap EXCLUDE USING gist (
                tenant_id WITH =,
                daterange(period_start, period_end, '[]') WITH &&
            ) WHERE (status <> 'archived');
    END IF;
END $$;

-- ===========================================================================
-- 5. teacher_payments — devise (E6) + unicité du paiement (E7)
-- ===========================================================================

ALTER TABLE teacher_payments
    ALTER COLUMN currency SET DEFAULT 'XOF';

-- E7 : porte la règle « un seul paiement par enseignant, période et type »,
-- toutes origines confondues — c'est ce qui permet d'additionner les heures
-- académiques et professionnelles sur un bulletin unique.
DO $$
DECLARE dups INT;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'unique_teacher_payment_per_period'
    ) THEN
        SELECT count(*) INTO dups FROM (
            SELECT 1 FROM teacher_payments
            GROUP BY tenant_id, teacher_id, payment_period_id, payment_type
            HAVING count(*) > 1
        ) d;

        IF dups > 0 THEN
            RAISE EXCEPTION
                '0103: % groupe(s) de paiements en double (tenant, enseignant, période, type). Les résoudre avant de rejouer.', dups;
        END IF;

        ALTER TABLE teacher_payments
            ADD CONSTRAINT unique_teacher_payment_per_period
            UNIQUE (tenant_id, teacher_id, payment_period_id, payment_type);
    END IF;
END $$;

-- ===========================================================================
-- 6. Vue de lecture enrichie — évite de répéter la jointure d'origine
-- ===========================================================================

CREATE OR REPLACE VIEW v_payment_hour_details_enriched AS
SELECT
    phd.id,
    phd.tenant_id,
    phd.payment_id,
    phd.source,
    phd.teaching_hours_id,
    phd.attendance_session_id,
    phd.seance_id,
    phd.hours_count,
    phd.hourly_rate,
    phd.amount,
    phd.is_overtime,
    phd.created_at,
    CASE phd.source WHEN 'professionnel' THEN se.date        ELSE tas.session_date END AS session_date,
    CASE phd.source WHEN 'professionnel' THEN ec.libelle     ELSE c.name          END AS intitule,
    CASE phd.source WHEN 'professionnel' THEN ec.code        ELSE c.code          END AS code,
    us.libelle AS cohorte_libelle
FROM payment_hour_details phd
LEFT JOIN professional_ecue_seances    se  ON se.id  = phd.seance_id
LEFT JOIN professional_ecue            ec  ON ec.id  = se.ecue_id
LEFT JOIN professional_ue_sessions     us  ON us.id  = se.ue_session_id
LEFT JOIN teacher_attendance_sessions  tas ON tas.id = phd.attendance_session_id
LEFT JOIN class_courses                cc  ON cc.id  = tas.class_course_id
LEFT JOIN courses                      c   ON c.id   = cc.course_id;

COMMENT ON VIEW v_payment_hour_details_enriched IS
    'Détail horaire enrichi du libellé de son origine (ECUE + cohorte, ou cours). Hérite du RLS des tables sous-jacentes : ne lire que dans un contexte où app.tenant_id est positionné.';

COMMIT;
