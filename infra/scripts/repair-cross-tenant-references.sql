-- ===========================================================================
-- Réparation des liens entre établissements créés par la copie d'un nouveau tenant
-- ===========================================================================
--
-- Avant le correctif de `tenant-provisioning.service.ts`, créer un tenant copiait
-- les classes (`programmes`) de l'établissement de référence SANS remapper leurs
-- références :
--   - `filiere_id` restait celui d'une filière de l'autre établissement ;
--   - `approved_by` restait celui d'un compte de l'autre établissement.
-- Effet visible : la liste des classes d'un tenant neuf affichait les noms de
-- filières d'un autre établissement.
--
-- Ce script, pour chaque classe concernée :
--   1. crée dans son établissement la filière homonyme (si elle n'existe pas) ;
--   2. rattache la classe à cette filière ;
--   3. vide `approved_by` s'il désigne un compte d'un autre établissement.
--
-- À exécuter avec un rôle qui contourne la RLS (propriétaire des tables), sinon
-- les lignes des autres établissements sont invisibles et rien n'est trouvé.
--
--   Répétition à blanc (aucune modification) :
--     psql "$DATABASE_URL" -v commit=0 -f infra/scripts/repair-cross-tenant-references.sql
--   Application :
--     psql "$DATABASE_URL" -v commit=1 -f infra/scripts/repair-cross-tenant-references.sql
--
-- Idempotent : rejoué, il ne trouve plus rien à réparer. Faire une sauvegarde avant
-- le passage avec commit=1.
-- ===========================================================================
\set ON_ERROR_STOP on
BEGIN;

\echo '--- AVANT : classes rattachées à une filière d''un autre établissement'
SELECT t.slug AS etablissement, count(*) AS classes
FROM programmes p
JOIN tenants t   ON t.id = p.tenant_id
JOIN filieres f  ON f.id = p.filiere_id
WHERE f.tenant_id <> p.tenant_id
GROUP BY t.slug ORDER BY 1;

\echo '--- AVANT : classes dont approved_by est un compte d''un autre établissement'
SELECT t.slug AS etablissement, count(*) AS classes
FROM programmes p
JOIN tenants t ON t.id = p.tenant_id
JOIN users u   ON u.id = p.approved_by
WHERE u.tenant_id IS DISTINCT FROM p.tenant_id
GROUP BY t.slug ORDER BY 1;

-- 1. Filières manquantes, créées sous le bon établissement.
INSERT INTO filieres (tenant_id, name, domaine)
SELECT DISTINCT p.tenant_id, f.name, f.domaine
FROM programmes p
JOIN filieres f ON f.id = p.filiere_id
WHERE f.tenant_id <> p.tenant_id
ON CONFLICT (tenant_id, name) DO NOTHING;

-- 2. Rattachement à la filière de l'établissement.
UPDATE programmes p
SET filiere_id = own.id
FROM filieres foreign_f
JOIN filieres own ON own.name = foreign_f.name
WHERE foreign_f.id = p.filiere_id
  AND foreign_f.tenant_id <> p.tenant_id
  AND own.tenant_id = p.tenant_id;

-- 3. Comptes d'un autre établissement.
UPDATE programmes p
SET approved_by = NULL
FROM users u
WHERE u.id = p.approved_by
  AND u.tenant_id IS DISTINCT FROM p.tenant_id;

\echo '--- APRES : doit être vide'
SELECT 'filiere_autre_etablissement' AS anomalie, count(*) AS classes
FROM programmes p JOIN filieres f ON f.id = p.filiere_id
WHERE f.tenant_id <> p.tenant_id
UNION ALL
SELECT 'approved_by_autre_etablissement', count(*)
FROM programmes p JOIN users u ON u.id = p.approved_by
WHERE u.tenant_id IS DISTINCT FROM p.tenant_id;

\if :commit
COMMIT;
\echo '>>> REPARATION VALIDEE (COMMIT)'
\else
ROLLBACK;
\echo '>>> REPETITION A BLANC : rien n a ete modifie (ROLLBACK)'
\endif
