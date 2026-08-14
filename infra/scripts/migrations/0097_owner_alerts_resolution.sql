-- 0097_owner_alerts_resolution.sql
-- Cycle de vie et actionnabilité des alertes de pilotage.
--
-- POURQUOI
-- Une alerte n'est utile que si elle est datée, chiffrée, CLIQUABLE vers l'écran
-- qui permet d'agir, acquittable, et AUTO-RÉSOLUE quand sa condition disparaît.
-- Deux de ces cinq propriétés manquaient :
--
--   * `resolved_at` : une alerte dont la cause a été corrigée restait ouverte
--     jusqu'à ce qu'un humain l'acquitte à la main. On confondait donc « traité »
--     et « plus d'actualité », et la liste se remplissait de bruit.
--   * `href` : le propriétaire lisait « 12 impayés de plus de 60 jours » sans
--     savoir où aller les traiter.
--
-- Une alerte résolue automatiquement n'est PAS un acquittement : `acknowledged_at`
-- reste le geste humain, `resolved_at` la disparition de la condition. Les deux
-- sont distincts pour que l'historique reste lisible.
--
-- Additif et idempotent.

BEGIN;

-- `owner_pilotage_alerts` vient de la migration 0053, qui n'a pas été appliquée
-- partout : on ne fait pas échouer un déploiement pour une table absente.
DO $$
BEGIN
    IF to_regclass('public.owner_pilotage_alerts') IS NULL THEN
        RAISE NOTICE '[0097] owner_pilotage_alerts absente (migration 0053 non appliquée) : rien à faire.';
        RETURN;
    END IF;

    ALTER TABLE owner_pilotage_alerts ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
    ALTER TABLE owner_pilotage_alerts ADD COLUMN IF NOT EXISTS href TEXT;

    COMMENT ON COLUMN owner_pilotage_alerts.resolved_at IS
        'Horodatage de la disparition automatique de la condition. Distinct de acknowledged_at, qui est le geste humain.';
    COMMENT ON COLUMN owner_pilotage_alerts.href IS
        'Lien profond vers l''écran qui permet d''agir sur cette alerte.';

    -- Les listes d'alertes ouvertes filtrent désormais sur les deux colonnes.
    CREATE INDEX IF NOT EXISTS idx_owner_alerts_tenant_open
        ON owner_pilotage_alerts (tenant_id, created_at DESC)
        WHERE acknowledged_at IS NULL AND resolved_at IS NULL;

    RAISE NOTICE '[0097] owner_pilotage_alerts : resolved_at et href en place.';
END
$$;

COMMIT;
