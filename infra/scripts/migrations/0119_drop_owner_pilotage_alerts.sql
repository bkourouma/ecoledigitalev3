-- 0119 — Suppression des alertes de pilotage propriétaire
--
-- POURQUOI
-- La fonctionnalité est retirée de l'espace propriétaire sur décision métier :
-- la carte « Alertes prioritaires » du tableau de bord, l'onglet « Alertes à
-- traiter » de Points de vigilance et les trois routes qui les servaient
-- (`GET /owner/alerts`, `POST /owner/alerts/sync`,
-- `PATCH /owner/alerts/:id/acknowledge`) n'existent plus.
--
-- Laisser la table sans lecteur en ferait une donnée fantôme : plus personne
-- ne l'alimente, plus personne ne l'acquitte, et le premier qui la retrouverait
-- dans six mois la prendrait pour une source vivante.
--
-- CE QUI EST PERDU
-- Uniquement des alertes RECALCULABLES. La table ne contenait que des lignes
-- produites par `syncOwnerPilotageAlerts` — domaines préfixés `auto_` : impayés
-- de plus de 90 jours, cours sans titulaire, recouvrement professionnel faible,
-- bulletins manquants, commandes payées sans paiement, incohérences de crédits
-- d'UE. Aucune saisie humaine n'y figurait : la seule action possible était
-- l'acquittement, et sur cette base aucune alerte ne l'avait été.
--
-- Les conditions qu'elles signalaient restent visibles là où elles se traitent :
-- les impayés sur l'écran Impayés, les cours sans titulaire sur Masse salariale,
-- les incohérences d'UE sur Catalogue, les écarts de caisse sur Impayés.
--
-- VÉRIFIÉ AVANT ÉCRITURE
-- Aucune clé étrangère entrante, aucune vue et aucun déclencheur ne dépendent
-- de cette table. La suppression n'entraîne donc rien d'autre.

BEGIN;

DROP TABLE IF EXISTS owner_pilotage_alerts;

-- Le type d'énumération n'a survécu que pour cette table. `IF EXISTS` et le
-- bloc conditionnel : d'autres installations peuvent ne jamais l'avoir créé,
-- et une migration ne doit pas échouer sur l'absence de ce qu'elle supprime.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'owner_alert_severity') THEN
    DROP TYPE owner_alert_severity;
  END IF;
EXCEPTION
  -- Le type est encore utilisé ailleurs : on le laisse en place plutôt que de
  -- faire échouer la migration. Une colonne orpheline vaut mieux qu'un déploiement
  -- bloqué.
  WHEN dependent_objects_still_exist THEN
    RAISE NOTICE 'owner_alert_severity encore référencé : type conservé.';
END $$;

COMMIT;
