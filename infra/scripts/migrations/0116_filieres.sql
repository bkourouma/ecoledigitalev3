-- 0116 — Séparation filière / classe
--
-- Jusqu'ici la table `programmes` mélangeait deux notions : la filière
-- (« AUDIT ET CONTROLE DE GESTION ») et la classe qui la décline sur un cycle
-- (« MASTER 2 AUDIT ET CONTROLE DE GESTION »). Les UE, semestres, bulletins et
-- plannings du module professionnel sont accrochés à ces lignes : elles restent
-- donc en place et deviennent officiellement les CLASSES. La filière est
-- extraite dans une nouvelle table, et chaque classe la référence.

BEGIN;

CREATE TABLE IF NOT EXISTS filieres (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    domaine VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT filieres_name_unique_per_tenant UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_filieres_tenant_id ON filieres(tenant_id);

ALTER TABLE filieres ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS filieres_tenant_policy ON filieres;
CREATE POLICY filieres_tenant_policy ON filieres
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

DROP TRIGGER IF EXISTS update_filieres_updated_at ON filieres;
CREATE TRIGGER update_filieres_updated_at
    BEFORE UPDATE ON filieres
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE programmes
    ADD COLUMN IF NOT EXISTS filiere_id UUID REFERENCES filieres(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_programmes_filiere_id ON programmes(filiere_id);

-- Reprise des données : le nom de la filière est le nom de la classe amputé de
-- son préfixe de cycle (« LICENCE 2 », « MASTER 1 », « BTS 1 »...).
WITH derivees AS (
    SELECT
        p.tenant_id,
        BTRIM(
            REGEXP_REPLACE(
                p.name,
                '^\s*(LICENCE|MASTER|BTS|CERTIFICAT|DUT|BAC)\s*[0-9]*\s*',
                '',
                'i'
            )
        ) AS filiere_name,
        MIN(p.domaine) AS domaine
    FROM programmes p
    WHERE p.filiere_id IS NULL
    GROUP BY 1, 2
)
INSERT INTO filieres (tenant_id, name, domaine)
SELECT d.tenant_id, d.filiere_name, d.domaine
FROM derivees d
WHERE d.filiere_name <> ''
ON CONFLICT (tenant_id, name) DO NOTHING;

UPDATE programmes p
SET filiere_id = f.id
FROM filieres f
WHERE p.filiere_id IS NULL
  AND f.tenant_id = p.tenant_id
  AND f.name = BTRIM(
        REGEXP_REPLACE(
            p.name,
            '^\s*(LICENCE|MASTER|BTS|CERTIFICAT|DUT|BAC)\s*[0-9]*\s*',
            '',
            'i'
        )
      );

COMMIT;
