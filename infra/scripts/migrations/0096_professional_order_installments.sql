-- 0096_professional_order_installments.sql
-- Échéancier des commandes du Module Professionnel.
--
-- POURQUOI
-- `professional_orders` porte un `montant_total` mais AUCUNE date d'échéance.
-- Conséquence : on sait dire qu'une commande est « incomplète », jamais qu'elle
-- est « en retard ». C'est le trou le plus coûteux du modèle financier — il
-- interdit la balance âgée, le recouvrement par échéance et toute prévision de
-- trésorerie côté professionnel, là où le scolaire dispose déjà de
-- `student_tuition_installments`.
--
-- CE QUE FAIT CETTE MIGRATION
-- 1. Crée `professional_order_installments`, calqué sur l'échéancier scolaire.
-- 2. Backfille UNE échéance par commande existante, avec une règle explicite :
--    échéance unique, montant = total de la commande, exigible à la date de
--    début de la première session commandée (à défaut : date de la commande).
--
-- SUR LE BACKFILL
-- Cette règle est un DÉFAUT, pas une vérité historique : personne n'a jamais
-- saisi d'échéance pour ces commandes. Elle dit « c'était dû à l'ouverture de
-- la cohorte », ce qui est la pratique constatée. Un établissement qui échelonne
-- réellement peut ensuite remplacer ces lignes. Le backfill ne touche jamais une
-- commande qui a déjà une échéance : il est rejouable sans écraser une saisie.
--
-- Le montant payé n'est pas dupliqué ici : il reste calculé depuis
-- `professional_payments` agrégés par commande, seule source de l'encaissé.
--
-- Additif et idempotent (patron RLS 0061/0069/0087/0091).

BEGIN;

CREATE TABLE IF NOT EXISTS professional_order_installments (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    order_id   UUID NOT NULL REFERENCES professional_orders(id) ON DELETE CASCADE,
    /** 1 = premier versement attendu. */
    rang       SMALLINT NOT NULL CHECK (rang >= 1),
    montant    NUMERIC(12, 2) NOT NULL CHECK (montant >= 0),
    due_date   DATE NOT NULL,
    /** Libellé affiché à la famille (« Inscription », « 2e tranche »…). */
    libelle    TEXT,
    /** `true` quand la ligne vient du backfill 0096 et non d'une saisie. */
    is_default BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (order_id, rang)
);

CREATE INDEX IF NOT EXISTS idx_pro_order_installments_tenant_due
    ON professional_order_installments (tenant_id, due_date);

CREATE INDEX IF NOT EXISTS idx_pro_order_installments_order
    ON professional_order_installments (order_id);

ALTER TABLE professional_order_installments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS professional_order_installments_tenant_isolation
    ON professional_order_installments;

CREATE POLICY professional_order_installments_tenant_isolation
    ON professional_order_installments
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::UUID);

COMMENT ON TABLE professional_order_installments IS
    'Échéancier des commandes du Module Professionnel. Sans lui, aucun impayé professionnel ne peut être qualifié « en retard ». Le montant encaissé reste porté par professional_payments.';

COMMENT ON COLUMN professional_order_installments.is_default IS
    'Ligne issue du backfill 0096 (échéance unique à l''ouverture de la cohorte), pas d''une saisie de l''établissement.';

-- ---------------------------------------------------------------------------
-- Backfill : une échéance par commande non annulée encore dépourvue d'échéancier.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    n_inserted BIGINT := 0;
BEGIN
    INSERT INTO professional_order_installments
        (tenant_id, order_id, rang, montant, due_date, libelle, is_default)
    SELECT
        o.tenant_id,
        o.id,
        1,
        o.montant_total,
        COALESCE(
            -- Date de début de la première session commandée.
            (SELECT MIN(s.date_debut)
               FROM professional_enrollments en
               JOIN professional_ue_sessions s
                 ON s.id = en.ue_session_id AND s.tenant_id = en.tenant_id
              WHERE en.order_id = o.id
                AND en.tenant_id = o.tenant_id
                AND en.statut <> 'annulee'),
            o.created_at::date
        ),
        'Échéance unique (défaut)',
        true
    FROM professional_orders o
    WHERE o.statut <> 'annulee'
      AND NOT EXISTS (
          SELECT 1 FROM professional_order_installments i
          WHERE i.order_id = o.id
      );

    GET DIAGNOSTICS n_inserted = ROW_COUNT;
    RAISE NOTICE '[0096] % échéance(s) créée(s) par défaut sur les commandes existantes.', n_inserted;
END
$$;

COMMIT;
