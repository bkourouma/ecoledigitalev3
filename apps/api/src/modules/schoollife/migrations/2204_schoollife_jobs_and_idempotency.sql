-- =============================================================================
-- 2204 — Module schoollife : clé d'idempotence de la saisie rapide d'incidents + support des jobs planifiés
-- =============================================================================
--
-- ADDITIVE : aucune migration existante n'est modifiée, aucune colonne existante n'est changée.
--
-- 1. Saisie rapide d'incidents rejouable (futur mode hors-ligne) : le client génère une clé (`client_key`) par saisie ; le
--    serveur la fait respecter par (établissement, déclarant, clé) — un rejeu renvoie l'incident déjà créé, sans doublon
--    ni second événement. `client_fingerprint` (SHA-256 du contenu normalisé) détecte la réutilisation d'une clé avec un
--    autre contenu (refus). Colonnes nullables : les incidents existants et les saisies sans clé ne changent pas.
-- 2. Réglages des rappels planifiés, VIDES/ÉTEINTS par défaut (aucune valeur réglementaire n'est codée) :
--    `convocation_reminder_hours` (NULL = pas de rappel) et `exclusion_boundary_notices` (faux = pas d'avis de début/fin).
-- 3. `job_notifications` : registre des envois AUTOMATIQUES (un par convocation et date prévue, un par début/fin d'exclusion).
--    La contrainte d'unicité est l'idempotence des jobs (le planificateur peut rejouer ; plusieurs instances sans doublon).
--    Cette table n'est PAS soumise à la règle « acteur humain » : elle ne porte aucune décision, seulement l'état d'un envoi.
-- =============================================================================

ALTER TABLE schoollife.incidents
  ADD COLUMN client_key         text CHECK (client_key IS NULL OR client_key ~ '^[A-Za-z0-9_.:-]{8,100}$'),
  ADD COLUMN client_fingerprint text CHECK (client_fingerprint IS NULL OR client_fingerprint ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT incidents_client_key_pair CHECK ((client_key IS NULL) = (client_fingerprint IS NULL));
CREATE UNIQUE INDEX incidents_client_key_unique ON schoollife.incidents (tenant_id, reported_by, client_key) WHERE client_key IS NOT NULL;

ALTER TABLE schoollife.settings
  ADD COLUMN convocation_reminder_hours integer CHECK (convocation_reminder_hours IS NULL OR convocation_reminder_hours BETWEEN 1 AND 720),
  ADD COLUMN exclusion_boundary_notices boolean NOT NULL DEFAULT false;

CREATE TABLE schoollife.job_notifications (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  kind             text NOT NULL CHECK (kind IN ('CONVOCATION_REMINDER', 'EXCLUSION_STARTED', 'EXCLUSION_ENDED')),
  subject_id       uuid NOT NULL,                     -- convocation ou mesure (sans FK : l'état de l'envoi survit à son sujet)
  occurrence       text NOT NULL CHECK (length(occurrence) BETWEEN 1 AND 64),  -- date prévue (convocation) ou borne (mesure)
  status           text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'SKIPPED')),
  attempts         integer NOT NULL DEFAULT 1 CHECK (attempts >= 1),
  error_code       text,
  sent_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, kind, subject_id, occurrence),
  CHECK (status <> 'SENT' OR sent_at IS NOT NULL)
);
SELECT kernel.enable_tenant_rls('schoollife.job_notifications');
CREATE INDEX job_notifications_open ON schoollife.job_notifications (tenant_id, status, updated_at) WHERE status IN ('PENDING', 'FAILED');
GRANT SELECT, INSERT, UPDATE ON schoollife.job_notifications TO app_user;
