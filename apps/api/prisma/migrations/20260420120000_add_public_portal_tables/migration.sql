DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'delivery_mode') THEN
    CREATE TYPE delivery_mode AS ENUM ('presential', 'remote', 'hybrid', 'elearning');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'session_professional_status') THEN
    CREATE TYPE session_professional_status AS ENUM ('planifiee', 'ouverte', 'complete', 'en_cours', 'terminee', 'annulee');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'statut_inscription') THEN
    CREATE TYPE statut_inscription AS ENUM ('EN_ATTENTE', 'CONFIRME', 'ANNULE');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS formateurs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  user_id UUID,
  civilite VARCHAR(20),
  nom VARCHAR(100) NOT NULL,
  prenom VARCHAR(100) NOT NULL,
  email VARCHAR(255) NOT NULL,
  telephone VARCHAR(20),
  specialites JSONB,
  bio TEXT,
  cv_url VARCHAR(500),
  photo_url VARCHAR(500),
  linkedin_url VARCHAR(500),
  tarif_journalier DECIMAL(15, 2),
  actif BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS formateurs_tenant_id_email_key
  ON formateurs(tenant_id, email);

CREATE INDEX IF NOT EXISTS idx_formateurs_tenant_id
  ON formateurs(tenant_id);

CREATE INDEX IF NOT EXISTS idx_formateurs_specialites
  ON formateurs USING GIN (specialites jsonb_ops);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'formateurs_tenant_id_fkey') THEN
    ALTER TABLE formateurs
      ADD CONSTRAINT formateurs_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'formateurs_user_id_fkey') THEN
    ALTER TABLE formateurs
      ADD CONSTRAINT formateurs_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS sessions_professionnelles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  formation_pro_id UUID NOT NULL,
  code_session VARCHAR(50),
  date_debut DATE NOT NULL,
  date_fin DATE NOT NULL,
  horaires VARCHAR(100),
  mode_formation delivery_mode NOT NULL,
  lieu VARCHAR(500),
  lien_visio VARCHAR(500),
  places_totales INTEGER NOT NULL,
  places_reservees INTEGER DEFAULT 0,
  places_disponibles INTEGER GENERATED ALWAYS AS (places_totales - COALESCE(places_reservees, 0)) STORED,
  prix_ht DECIMAL(15, 2),
  prix_ttc DECIMAL(15, 2),
  statut session_professional_status DEFAULT 'planifiee',
  notes_internes TEXT,
  created_at TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
  notes_formateur TEXT,
  notes_updated_at TIMESTAMPTZ(6)
);

CREATE UNIQUE INDEX IF NOT EXISTS sessions_professionnelles_tenant_id_code_session_key
  ON sessions_professionnelles(tenant_id, code_session);

CREATE INDEX IF NOT EXISTS idx_sessions_professionnelles_tenant_id
  ON sessions_professionnelles(tenant_id);

CREATE INDEX IF NOT EXISTS idx_sessions_professionnelles_formation_pro_id
  ON sessions_professionnelles(formation_pro_id);

CREATE INDEX IF NOT EXISTS idx_sessions_professionnelles_date_debut
  ON sessions_professionnelles(tenant_id, date_debut);

CREATE INDEX IF NOT EXISTS idx_sessions_professionnelles_statut
  ON sessions_professionnelles(tenant_id, statut);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sessions_professionnelles_tenant_id_fkey') THEN
    ALTER TABLE sessions_professionnelles
      ADD CONSTRAINT sessions_professionnelles_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sessions_professionnelles_formation_pro_id_fkey') THEN
    ALTER TABLE sessions_professionnelles
      ADD CONSTRAINT sessions_professionnelles_formation_pro_id_fkey
      FOREIGN KEY (formation_pro_id) REFERENCES formations_professionnelles(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS session_formateurs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  session_id UUID NOT NULL,
  formateur_id UUID NOT NULL,
  role VARCHAR(50),
  created_at TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS session_formateurs_tenant_id_session_id_formateur_id_key
  ON session_formateurs(tenant_id, session_id, formateur_id);

CREATE INDEX IF NOT EXISTS idx_session_formateurs_tenant_id
  ON session_formateurs(tenant_id);

CREATE INDEX IF NOT EXISTS idx_session_formateurs_session_id
  ON session_formateurs(session_id);

CREATE INDEX IF NOT EXISTS idx_session_formateurs_formateur_id
  ON session_formateurs(formateur_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'session_formateurs_tenant_id_fkey') THEN
    ALTER TABLE session_formateurs
      ADD CONSTRAINT session_formateurs_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'session_formateurs_session_id_fkey') THEN
    ALTER TABLE session_formateurs
      ADD CONSTRAINT session_formateurs_session_id_fkey
      FOREIGN KEY (session_id) REFERENCES sessions_professionnelles(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'session_formateurs_formateur_id_fkey') THEN
    ALTER TABLE session_formateurs
      ADD CONSTRAINT session_formateurs_formateur_id_fkey
      FOREIGN KEY (formateur_id) REFERENCES formateurs(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS support_session_associations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  support_id UUID NOT NULL,
  session_id UUID NOT NULL,
  created_at TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS unique_support_session
  ON support_session_associations(tenant_id, support_id, session_id);

CREATE INDEX IF NOT EXISTS idx_support_session_assoc_tenant_id
  ON support_session_associations(tenant_id);

CREATE INDEX IF NOT EXISTS idx_support_session_assoc_support_id
  ON support_session_associations(support_id);

CREATE INDEX IF NOT EXISTS idx_support_session_assoc_session_id
  ON support_session_associations(session_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'support_session_associations_tenant_id_fkey') THEN
    ALTER TABLE support_session_associations
      ADD CONSTRAINT support_session_associations_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'support_session_associations_support_id_fkey') THEN
    ALTER TABLE support_session_associations
      ADD CONSTRAINT support_session_associations_support_id_fkey
      FOREIGN KEY (support_id) REFERENCES supports_cours(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'support_session_associations_session_id_fkey') THEN
    ALTER TABLE support_session_associations
      ADD CONSTRAINT support_session_associations_session_id_fkey
      FOREIGN KEY (session_id) REFERENCES sessions_professionnelles(id) ON DELETE CASCADE;
  END IF;
END $$;

ALTER TABLE supports_cours
  ADD COLUMN IF NOT EXISTS formateur_id UUID,
  ADD COLUMN IF NOT EXISTS session_id UUID,
  ADD COLUMN IF NOT EXISTS video_provider VARCHAR(20),
  ADD COLUMN IF NOT EXISTS video_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS url_thumbnail VARCHAR(500),
  ADD COLUMN IF NOT EXISTS storage_provider VARCHAR(20);

DO $$
DECLARE
  tenant_record RECORD;
  placeholder_email TEXT;
  placeholder_id UUID;
BEGIN
  FOR tenant_record IN
    SELECT DISTINCT tenant_id
    FROM supports_cours
    WHERE formateur_id IS NULL
  LOOP
    placeholder_email := 'placeholder-' || tenant_record.tenant_id::text || '@formation-pro.local';

    INSERT INTO formateurs (tenant_id, nom, prenom, email, actif)
    VALUES (tenant_record.tenant_id, 'Equipe', 'Formation Pro', placeholder_email, true)
    ON CONFLICT (tenant_id, email) DO NOTHING;

    SELECT id
    INTO placeholder_id
    FROM formateurs
    WHERE tenant_id = tenant_record.tenant_id
      AND email = placeholder_email
    LIMIT 1;

    UPDATE supports_cours
    SET formateur_id = placeholder_id
    WHERE tenant_id = tenant_record.tenant_id
      AND formateur_id IS NULL;
  END LOOP;
END $$;

ALTER TABLE supports_cours
  ALTER COLUMN formateur_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_supports_cours_formateur_id
  ON supports_cours(formateur_id);

CREATE INDEX IF NOT EXISTS idx_supports_cours_session_id
  ON supports_cours(session_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supports_cours_tenant_id_fkey') THEN
    ALTER TABLE supports_cours
      ADD CONSTRAINT supports_cours_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supports_cours_formation_id_fkey') THEN
    ALTER TABLE supports_cours
      ADD CONSTRAINT supports_cours_formation_id_fkey
      FOREIGN KEY (formation_id) REFERENCES formations_professionnelles(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supports_cours_formateur_id_fkey') THEN
    ALTER TABLE supports_cours
      ADD CONSTRAINT supports_cours_formateur_id_fkey
      FOREIGN KEY (formateur_id) REFERENCES formateurs(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supports_cours_session_id_fkey') THEN
    ALTER TABLE supports_cours
      ADD CONSTRAINT supports_cours_session_id_fkey
      FOREIGN KEY (session_id) REFERENCES sessions_professionnelles(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  email_verified TIMESTAMP(3),
  nom TEXT,
  prenom TEXT,
  telephone TEXT,
  avatar_url TEXT,
  mot_de_passe_hash TEXT,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public_users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_account_id TEXT NOT NULL,
  refresh_token TEXT,
  access_token TEXT,
  expires_at INTEGER,
  token_type TEXT,
  scope TEXT,
  id_token TEXT,
  session_state TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS accounts_provider_provider_account_id_key
  ON accounts(provider, provider_account_id);

CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY,
  session_token TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES public_users(id) ON DELETE CASCADE,
  expires TIMESTAMP(3) NOT NULL
);

CREATE TABLE IF NOT EXISTS verification_tokens (
  identifier TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  expires TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS verification_tokens_identifier_token_key
  ON verification_tokens(identifier, token);

CREATE TABLE IF NOT EXISTS inscriptions_public (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public_users(id) ON DELETE CASCADE,
  formation_id UUID NOT NULL REFERENCES formations_professionnelles(id) ON DELETE RESTRICT,
  session_id UUID REFERENCES sessions_professionnelles(id) ON DELETE SET NULL,
  statut statut_inscription NOT NULL DEFAULT 'EN_ATTENTE',
  montant_paye DECIMAL(10, 2) NOT NULL,
  code_paiement TEXT NOT NULL UNIQUE,
  reference_paiement TEXT,
  moyen_paiement TEXT,
  date_inscription TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  date_confirmation TIMESTAMP(3)
);

CREATE INDEX IF NOT EXISTS idx_inscriptions_public_user_id
  ON inscriptions_public(user_id);

CREATE INDEX IF NOT EXISTS idx_inscriptions_public_formation_id
  ON inscriptions_public(formation_id);

CREATE INDEX IF NOT EXISTS idx_inscriptions_public_session_id
  ON inscriptions_public(session_id);
