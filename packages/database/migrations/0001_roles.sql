-- no-role
-- =============================================================================
-- 0001 — Rôles Postgres de la plateforme v2
-- =============================================================================
--
-- Deux rôles de GROUPE, jamais de connexion directe :
--
--   migrator  : propriétaire des objets (DDL). Les migrations s'exécutent sous
--               `SET ROLE migrator` (le runner le fait). Il n'a pas BYPASSRLS :
--               avec FORCE ROW LEVEL SECURITY il est lui aussi soumis aux policies.
--   app_user  : rôle de l'API et des jobs. NOBYPASSRLS, NON propriétaire, aucun
--               droit de DDL. C'est le seul rôle avec lequel l'application se
--               connecte (via un rôle LOGIN membre de app_user, voir ci-dessous).
--
-- ⚠ AUCUN mot de passe ni attribut LOGIN dans ce fichier. Les rôles de
-- connexion se créent HORS migrations, par l'exploitation, avec un secret
-- injecté (gestionnaire de secrets), par exemple :
--
--     CREATE ROLE api_login   LOGIN PASSWORD :'secret' IN ROLE app_user; -- secret-scan:allow (placeholder psql)
--     CREATE ROLE deploy_login LOGIN PASSWORD :'secret' IN ROLE migrator; -- secret-scan:allow (placeholder psql)
--
-- Les rôles sont GLOBAUX au cluster Postgres (pas à la base) : ce script est
-- idempotent et converge les attributs vers l'état attendu à chaque exécution.
--
-- Doit être exécuté par un superuser (NOSUPERUSER/NOBYPASSRLS se convergent aussi
-- sur des rôles préexistants). La directive `-- no-role` ci-dessus l'exclut de
-- `SET ROLE migrator` : un rôle de groupe ne peut pas se modifier lui-même, même
-- quand il existe déjà (autre base du même cluster).
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migrator') THEN
    CREATE ROLE migrator NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN;
  END IF;
END
$$;

-- Convergence : même si les rôles existaient avec d'autres attributs
-- (p. ex. créés à la main avec BYPASSRLS), on les ramène à l'état voulu.
ALTER ROLE migrator NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
ALTER ROLE app_user NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;

-- Droits sur la base courante (CONNECT/TEMP pour l'application ; CREATE
-- pour que migrator puisse créer des schémas).
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT, TEMPORARY ON DATABASE %I TO app_user', current_database());
  EXECUTE format('GRANT CONNECT, CREATE ON DATABASE %I TO migrator', current_database());
END
$$;

-- L'application ne crée jamais d'objet dans `public` (hérité de PG < 15 où
-- PUBLIC avait CREATE sur ce schéma).
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
