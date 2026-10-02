-- =============================================================================
-- 2102 — Module councils : procès-verbal (snapshot immuable), signatures datées,
--        demandes de déverrouillage, journal
-- =============================================================================
--
-- Le procès-verbal est un INSTANTANÉ (`snapshot`, schéma `council-minutes/1`) pris à la clôture de la
-- séance, scellé par un hash calculé PAR LA BASE (`councils.minutes_hash`). Le PDF est rendu dans le
-- worker depuis ce snapshot seul (spec 013, port `DocumentRenderer`). Chaque signature porte le hash
-- signé et sa date ; une fois toutes les signatures exigées recueillies, la base passe le procès-verbal
-- puis la séance à SIGNED (2104). Aucune suppression, aucune modification du contenu.
-- =============================================================================

-- Hash canonique d'un snapshot : SHA-256 du texte jsonb (ordre des clés déterministe côté Postgres).
-- Le snapshot ne contient que chaînes, entiers, booléens et null (jamais de flottant).
CREATE FUNCTION councils.minutes_hash(p_snapshot jsonb) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(p_snapshot::text, 'UTF8')), 'hex')
$$;

CREATE TABLE councils.minutes (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES kernel.tenants (id),
  council_id        uuid NOT NULL,
  version           integer NOT NULL CHECK (version >= 1),
  status            text NOT NULL DEFAULT 'GENERATED' CHECK (status IN ('GENERATED', 'SIGNED', 'SUPERSEDED', 'REVOKED')),
  schema_name       text NOT NULL DEFAULT 'council-minutes/1' CHECK (schema_name ~ '^[a-z][a-z-]*/[0-9]+$'),
  snapshot          jsonb NOT NULL,
  snapshot_hash     text NOT NULL CHECK (snapshot_hash ~ '^[0-9a-f]{64}$'),
  generated_at      timestamptz NOT NULL DEFAULT now(),
  generated_by      uuid NOT NULL,
  render_status     text NOT NULL DEFAULT 'PENDING' CHECK (render_status IN ('PENDING', 'RENDERED', 'FAILED')),
  render_object_key text,                                 -- StoragePort : PDF rendu
  render_hash       text CHECK (render_hash IS NULL OR render_hash ~ '^[0-9a-f]{64}$'),
  signed_at         timestamptz,
  supersedes_id     uuid,
  revoked_reason    text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, council_id, version),
  FOREIGN KEY (tenant_id, council_id) REFERENCES councils.councils (tenant_id, id),
  FOREIGN KEY (tenant_id, supersedes_id) REFERENCES councils.minutes (tenant_id, id),
  CHECK (status <> 'SIGNED' OR signed_at IS NOT NULL),
  CHECK (status <> 'REVOKED' OR length(btrim(coalesce(revoked_reason, ''))) >= 10),
  CHECK (render_status <> 'RENDERED' OR (render_object_key IS NOT NULL AND render_hash IS NOT NULL))
);
SELECT kernel.enable_tenant_rls('councils.minutes');
-- Une seule version vivante (non remplacée, non révoquée) par séance.
CREATE UNIQUE INDEX minutes_one_live ON councils.minutes (tenant_id, council_id) WHERE status IN ('GENERATED', 'SIGNED');
CREATE INDEX minutes_by_hash ON councils.minutes (tenant_id, snapshot_hash);
GRANT SELECT, INSERT, UPDATE ON councils.minutes TO app_user;

-- Signatures datées. `signed_hash` = hash du snapshot signé (contrôlé par la base). Une signature
-- électronique est celle de l'utilisateur de la session ; une signature papier numérisée porte sa pièce.
CREATE TABLE councils.minute_signatures (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES kernel.tenants (id),
  minutes_id          uuid NOT NULL,
  participant_id      uuid NOT NULL,
  role_code           text NOT NULL,
  signer_name         text NOT NULL CHECK (length(btrim(signer_name)) > 0),
  method              text NOT NULL CHECK (method IN ('ELECTRONIC', 'SCANNED_PAPER')),
  signed_hash         text NOT NULL CHECK (signed_hash ~ '^[0-9a-f]{64}$'),
  signed_at           timestamptz NOT NULL DEFAULT now(),
  signed_by_user      uuid NOT NULL,
  evidence_object_key text,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, minutes_id, participant_id),
  FOREIGN KEY (tenant_id, minutes_id) REFERENCES councils.minutes (tenant_id, id),
  FOREIGN KEY (tenant_id, participant_id) REFERENCES councils.participants (tenant_id, id),
  CHECK (method <> 'SCANNED_PAPER' OR evidence_object_key IS NOT NULL)
);
SELECT kernel.enable_tenant_rls('councils.minute_signatures');
GRANT SELECT, INSERT ON councils.minute_signatures TO app_user;          -- append-only

-- Demandes de déverrouillage : motivées, approuvées (par une autre personne si le réglage l'exige),
-- consommées par UNE réouverture.
CREATE TABLE councils.unlock_requests (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  council_id       uuid NOT NULL,
  requested_by     uuid NOT NULL,
  requested_by_name text NOT NULL,
  requested_at     timestamptz NOT NULL DEFAULT now(),
  reason           text NOT NULL CHECK (length(btrim(reason)) >= 20),
  status           text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED', 'APPROVED', 'REJECTED', 'CONSUMED', 'EXPIRED')),
  decided_by       uuid,
  decided_by_name  text,
  decided_at       timestamptz,
  decision_note    text,
  four_eyes_waived boolean NOT NULL DEFAULT false,
  consumed_at      timestamptz,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, council_id) REFERENCES councils.councils (tenant_id, id),
  CHECK (status = 'REQUESTED' OR status = 'EXPIRED' OR decided_by IS NOT NULL),
  CHECK (decided_by IS NULL OR four_eyes_waived OR decided_by <> requested_by),
  CHECK (status <> 'CONSUMED' OR consumed_at IS NOT NULL)
);
SELECT kernel.enable_tenant_rls('councils.unlock_requests');
CREATE UNIQUE INDEX unlock_requests_one_open ON councils.unlock_requests (tenant_id, council_id) WHERE status IN ('REQUESTED', 'APPROVED');
GRANT SELECT, INSERT, UPDATE ON councils.unlock_requests TO app_user;

-- Journal de la séance (append-only) : transitions, convocations, quorum, signatures, effets…
CREATE TABLE councils.events (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES kernel.tenants (id),
  council_id  uuid NOT NULL,
  kind        text NOT NULL CHECK (kind ~ '^[A-Z][A-Z0-9_]{1,40}$'),
  actor_id    uuid,
  actor_kind  text CHECK (actor_kind IS NULL OR actor_kind IN ('user', 'system', 'superAdmin')),
  reason      text,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, council_id) REFERENCES councils.councils (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('councils.events');
CREATE INDEX events_by_council ON councils.events (tenant_id, council_id, occurred_at);
GRANT SELECT, INSERT ON councils.events TO app_user;                      -- append-only
