-- Mot de passe initial en clair (affichage admin, comme student_profiles.initial_password)
ALTER TABLE users ADD COLUMN IF NOT EXISTS initial_password TEXT;

COMMENT ON COLUMN users.initial_password IS 'Dernier mot de passe initial ou réinitialisé (affichage admin uniquement)';
