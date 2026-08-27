-- 0117 — Portée d'un nom de classe
--
-- Le nom donné à une ouverture (« Classe A MASTER 1 TRANSPORT LOGISTIQUE ») se
-- poursuit d'un semestre à l'autre. Les semestres déjà ouverts se déduisent des
-- ouvertures existantes, mais une chose ne se déduit de rien : savoir si ce nom
-- était prévu pour les trois semestres, pour deux, ou pour un seul.
--
-- Cette table ne stocke que cette déclaration. Le nom reste par ailleurs un
-- simple libellé sur l'ouverture : aucune clé étrangère n'est ajoutée ailleurs,
-- et un nom sans déclaration continue de fonctionner (il est alors considéré
-- comme couvrant tous les semestres de la classe).

BEGIN;

CREATE TABLE IF NOT EXISTS professional_classe_noms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    classe_id UUID NOT NULL REFERENCES programmes(id) ON DELETE CASCADE,
    nom VARCHAR(255) NOT NULL,
    -- Semestres visés. Pas de clé étrangère possible sur un tableau : les ids
    -- devenus obsolètes sont ignorés à la lecture, par intersection avec les
    -- semestres réels de la classe.
    semestre_ids UUID[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT professional_classe_noms_unique UNIQUE (tenant_id, classe_id, nom)
);

CREATE INDEX IF NOT EXISTS idx_professional_classe_noms_classe
    ON professional_classe_noms(tenant_id, classe_id);

ALTER TABLE professional_classe_noms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS professional_classe_noms_tenant_policy ON professional_classe_noms;
CREATE POLICY professional_classe_noms_tenant_policy ON professional_classe_noms
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

DROP TRIGGER IF EXISTS update_professional_classe_noms_updated_at ON professional_classe_noms;
CREATE TRIGGER update_professional_classe_noms_updated_at
    BEFORE UPDATE ON professional_classe_noms
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMIT;
