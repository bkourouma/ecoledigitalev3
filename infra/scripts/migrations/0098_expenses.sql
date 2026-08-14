-- 0098_expenses.sql
-- Dépenses de l'établissement.
--
-- POURQUOI
-- Aucune table ne porte les charges : ni loyer, ni énergie, ni fournitures, ni
-- amortissements, ni frais administratifs. Conséquence directe, l'espace
-- propriétaire ne peut afficher qu'une MARGE BRUTE PÉDAGOGIQUE — revenu encaissé
-- moins coût enseignant — et jamais un résultat d'exploitation. C'est la
-- dernière pièce manquante pour répondre à « où est-ce que je perds de l'argent
-- sans le voir ? ».
--
-- CE QUE CETTE MIGRATION NE FAIT PAS
-- Elle ne backfille RIEN. Il n'existe aucune source d'où déduire des charges
-- passées : les inventer donnerait une marge fausse, ce qui est pire qu'une
-- marge absente. La table naît vide et les écrans annoncent explicitement la
-- part des charges réellement saisies.
--
-- RATTACHEMENT À UNE FILIÈRE
-- `programme_id` est NULLABLE à dessein : le loyer ne se rattache à aucune
-- filière. Les charges non affectées restent au niveau établissement et ne sont
-- jamais réparties automatiquement — une clé de répartition inventée fabriquerait
-- des marges par filière qui n'ont aucun sens comptable.
--
-- Additif et idempotent (patron RLS 0061/0069/0087/0091/0096).

BEGIN;

CREATE TABLE IF NOT EXISTS expense_categories (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    code       TEXT NOT NULL,
    libelle    TEXT NOT NULL,
    /** `true` pour une charge fixe (loyer), `false` pour une charge variable. */
    est_fixe   BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS expenses (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    category_id UUID REFERENCES expense_categories(id) ON DELETE SET NULL,
    /** NULL = charge d'établissement, non affectée à une filière. */
    programme_id UUID REFERENCES programmes(id) ON DELETE SET NULL,
    libelle     TEXT NOT NULL,
    amount      NUMERIC(14, 2) NOT NULL CHECK (amount >= 0),
    currency    VARCHAR(8) NOT NULL DEFAULT 'XOF',
    /** Date d'engagement de la charge : c'est elle qui porte le rattachement. */
    incurred_on DATE NOT NULL,
    /** Date de décaissement réel. NULL = engagée mais pas encore payée. */
    paid_on     DATE,
    supplier    TEXT,
    notes       TEXT,
    created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_expenses_tenant_incurred
    ON expenses (tenant_id, incurred_on);

CREATE INDEX IF NOT EXISTS idx_expenses_tenant_programme
    ON expenses (tenant_id, programme_id);

-- Décaissements à venir : sert la prévision de trésorerie à 13 semaines.
CREATE INDEX IF NOT EXISTS idx_expenses_tenant_unpaid
    ON expenses (tenant_id, incurred_on)
    WHERE paid_on IS NULL;

ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS expense_categories_tenant_isolation ON expense_categories;
CREATE POLICY expense_categories_tenant_isolation ON expense_categories
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::UUID);

DROP POLICY IF EXISTS expenses_tenant_isolation ON expenses;
CREATE POLICY expenses_tenant_isolation ON expenses
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::UUID);

COMMENT ON TABLE expenses IS
    'Charges de l''établissement. Sans elles, le pilotage ne peut afficher qu''une marge brute pédagogique, jamais un résultat d''exploitation.';

COMMENT ON COLUMN expenses.programme_id IS
    'NULL = charge d''établissement. Aucune répartition automatique par filière : une clé inventée fabriquerait des marges dénuées de sens comptable.';

-- Catégories de départ, communes à toutes les écoles. Un établissement peut en
-- ajouter ; on ne présume d'aucun plan comptable local.
INSERT INTO expense_categories (tenant_id, code, libelle, est_fixe)
SELECT t.id, c.code, c.libelle, c.est_fixe
FROM tenants t
CROSS JOIN (VALUES
    ('loyer',          'Loyer et charges locatives',      true),
    ('energie',        'Énergie, eau, télécommunications', false),
    ('fournitures',    'Fournitures et consommables',      false),
    ('administratif',  'Frais administratifs',             true),
    ('maintenance',    'Entretien et maintenance',         false),
    ('amortissement',  'Amortissements',                   true),
    ('marketing',      'Communication et recrutement',     false),
    ('autre',          'Autres charges',                   false)
) AS c(code, libelle, est_fixe)
ON CONFLICT (tenant_id, code) DO NOTHING;

COMMIT;
