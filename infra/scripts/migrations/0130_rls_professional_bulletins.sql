-- =============================================================================
-- 0130 — Row-Level Security sur professional_bulletins
-- =============================================================================
--
-- L'ÉCART QUE CETTE MIGRATION COMBLE
--
-- `professional_bulletins` est créée par la migration 0083 SANS `ENABLE ROW
-- LEVEL SECURITY` ni policy, alors que toutes ses voisines en ont une. Mesuré le
-- 23/09/2026 : c'est la SEULE table `professional_*` dans ce cas.
--
-- Un bulletin porte les notes, les moyennes et les décisions de jury d'un
-- étudiant nommé. C'est la donnée la plus sensible du module.
--
-- ⚠ CE QUE CETTE MIGRATION NE FAIT PAS, ET IL FAUT LE SAVOIR
--
-- **La RLS ne s'applique pas au PROPRIÉTAIRE de la table**, sauf si
-- `FORCE ROW LEVEL SECURITY` est activé — et il ne l'est sur AUCUNE table de
-- cette base. Vérifié le 23/09/2026 : en local, l'application se connecte avec
-- le rôle `postgres`, qui est aussi le propriétaire, et contourne donc toutes
-- les policies existantes. En production le rôle applicatif est `ecoledigitale`
-- (cf. `infra/.env.example`), mais s'il a créé les tables par ces mêmes
-- migrations, il en est propriétaire et les contourne aussi.
--
-- Autrement dit : la RLS de ce dépôt est aujourd'hui une ceinture de sécurité
-- qui ne serre pas. **Ce qui isole réellement les tenants, c'est le
-- `WHERE tenant_id = $1` explicite** que chaque requête porte — la « seconde
-- ceinture » documentée dans les services.
--
-- Cette migration a donc deux mérites, et pas trois :
--   1. elle aligne la table sur ses voisines, pour qu'un audit ne trouve plus
--      une exception inexpliquée ;
--   2. elle protège le jour où un rôle NON propriétaire lira la base — un
--      compte de lecture, un outil de BI, une réplique analytique.
--
-- Elle ne dispense pas du `WHERE tenant_id`, et ne doit pas donner le sentiment
-- que l'isolation est acquise. Rendre la RLS effective demande une décision
-- d'exploitation : soit un rôle applicatif non propriétaire, soit
-- `ALTER TABLE ... FORCE ROW LEVEL SECURITY` sur l'ensemble des tables — ce qui
-- casserait immédiatement tout accès n'ayant pas posé `app.tenant_id`, et se
-- teste hors production avant d'être appliqué.
--
-- La policy reproduit MOT POUR MOT celle des tables voisines
-- (`professional_orders`, `professional_ecue_notes`, …) : une formulation
-- différente sur une seule table serait le prochain écart à découvrir.
--
-- Idempotente : `IF NOT EXISTS` sur la policy, et `ENABLE` est sans effet si
-- déjà actif.
-- =============================================================================

BEGIN;

ALTER TABLE professional_bulletins ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'professional_bulletins'
       AND policyname = 'professional_bulletins_tenant_isolation'
  ) THEN
    CREATE POLICY professional_bulletins_tenant_isolation
        ON professional_bulletins
       FOR ALL
     USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);
  END IF;
END $$;

COMMIT;
