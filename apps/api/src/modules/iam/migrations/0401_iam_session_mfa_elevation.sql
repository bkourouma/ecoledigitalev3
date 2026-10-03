-- =============================================================================
-- 0401 — Module iam : élévation d'authentification (step-up MFA) par session
-- =============================================================================
-- Additif. Une session ouverte SANS second facteur (ex. enrôlement TOTP après coup, connexion
-- fédérée) peut prouver un code TOTP en cours de route : `mfa_elevated_until` marque alors la
-- session comme « MFA satisfaite » jusqu'à cet instant (fenêtre courte, configurable).
-- Aucune valeur de code n'est stockée. Lue par `authenticateBearer` (jamais par le jeton).
-- =============================================================================
ALTER TABLE iam.sessions ADD COLUMN IF NOT EXISTS mfa_elevated_until timestamptz;

GRANT UPDATE (mfa_elevated_until) ON iam.sessions TO app_user;
