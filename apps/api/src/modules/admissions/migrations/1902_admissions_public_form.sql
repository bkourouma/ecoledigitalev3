-- =============================================================================
-- 1902 — Module admissions : formulaire public — jetons à usage unique et journal de tentatives
-- =============================================================================
--
-- Défense contre le spam du formulaire public (l'API pose AUSSI un limiteur de débit adossé à Redis,
-- `runtime.rateLimiter`, et vérifie un CAPTCHA si l'établissement l'exige) :
--   1. Un JETON de formulaire est émis au chargement de la page ; seul son EMPREINTE SHA-256 est stockée.
--   2. Le jeton n'est valable qu'après un DÉLAI MINIMAL (`min_ready_at` : un robot qui poste dans la
--      seconde est refusé), expire, et ne sert QU'UNE FOIS (consommation atomique).
--   3. Chaque tentative est journalisée avec l'empreinte (HMAC) de l'IP et de l'agent, jamais en clair.
-- Aucune donnée sensible n'est exposée par le formulaire : il ne renvoie qu'un code de suivi opaque.
-- =============================================================================

CREATE TABLE admissions.public_form_sessions (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id  uuid NOT NULL,
  token_hash      text NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  issued_at       timestamptz NOT NULL DEFAULT now(),
  min_ready_at    timestamptz NOT NULL,
  expires_at      timestamptz NOT NULL,
  consumed_at     timestamptz,
  ip_hash         text CHECK (ip_hash IS NULL OR ip_hash ~ '^[0-9a-f]{64}$'),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, token_hash),
  CHECK (min_ready_at >= issued_at),
  CHECK (expires_at > min_ready_at)
);
SELECT kernel.enable_tenant_rls('admissions.public_form_sessions');
CREATE INDEX public_form_sessions_to_purge ON admissions.public_form_sessions (tenant_id, expires_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON admissions.public_form_sessions TO app_user;   -- DELETE : purge des jetons expirés

-- Consommation ATOMIQUE : vrai si et seulement si le jeton existe, n'est pas expiré, a dépassé son délai
-- minimal et n'a jamais servi. Une seule transaction gagne, même sous concurrence (verrou de ligne).
CREATE FUNCTION admissions.consume_form_session(p_token_hash text) RETURNS boolean
LANGUAGE sql AS $$
  WITH c AS (
    UPDATE admissions.public_form_sessions s
       SET consumed_at = now()
     WHERE s.tenant_id = kernel.current_tenant_id() AND s.token_hash = p_token_hash
       AND s.consumed_at IS NULL AND s.expires_at > now() AND s.min_ready_at <= now()
    RETURNING 1)
  SELECT EXISTS (SELECT 1 FROM c)
$$;
GRANT EXECUTE ON FUNCTION admissions.consume_form_session(text) TO app_user;

-- Un jeton consommé ne change plus.
CREATE FUNCTION admissions.public_form_sessions_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'admissions.form_session_consumed: un jeton consommé est figé' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.token_hash <> OLD.token_hash OR NEW.issued_at <> OLD.issued_at OR NEW.min_ready_at <> OLD.min_ready_at OR NEW.expires_at <> OLD.expires_at THEN
    RAISE EXCEPTION 'admissions.form_session_immutable: l''échéance et l''empreinte d''un jeton ne se modifient pas' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER public_form_sessions_guard BEFORE UPDATE ON admissions.public_form_sessions
  FOR EACH ROW EXECUTE FUNCTION admissions.public_form_sessions_guard();

CREATE TABLE admissions.submission_attempts (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id  uuid NOT NULL,
  ip_hash         text NOT NULL CHECK (ip_hash ~ '^[0-9a-f]{64}$'),
  ua_hash         text CHECK (ua_hash IS NULL OR ua_hash ~ '^[0-9a-f]{64}$'),
  outcome         text NOT NULL CHECK (outcome IN ('ACCEPTED', 'REJECTED_RATE', 'REJECTED_BOT', 'REJECTED_TOKEN', 'REJECTED_VALIDATION', 'REJECTED_DUPLICATE')),
  application_id  uuid,
  attempted_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('admissions.submission_attempts');
CREATE INDEX submission_attempts_by_ip ON admissions.submission_attempts (tenant_id, ip_hash, attempted_at DESC);
GRANT SELECT, INSERT, DELETE ON admissions.submission_attempts TO app_user;   -- DELETE : purge (rétention courte)

-- Tentatives récentes d'une empreinte d'IP (décision de refus par l'API, complète le limiteur Redis).
CREATE FUNCTION admissions.recent_attempts(p_ip_hash text, p_window interval) RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT count(*)::integer FROM admissions.submission_attempts a
   WHERE a.tenant_id = kernel.current_tenant_id() AND a.ip_hash = p_ip_hash AND a.attempted_at > now() - p_window
$$;
GRANT EXECUTE ON FUNCTION admissions.recent_attempts(text, interval) TO app_user;
