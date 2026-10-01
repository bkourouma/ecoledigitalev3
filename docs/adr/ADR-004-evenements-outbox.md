# ADR-004 — Événements : transactional outbox, BullMQ/Redis et `apps/worker`

- **Statut :** Accepté
- **Date :** 2026-10-01
- **Références :** plan section 3.9 ; ADR-001, ADR-002

## Contexte

Aujourd'hui, il n'existe aucune file de jobs : `bullmq` et `ioredis` sont installés mais jamais importés, Redis est absent du compose, et les tâches périodiques tournent en `setInterval` dans le process de l'API. Les notifications (e-mail, SMS) sont simulées. La génération de PDF, les recalculs de résultats, les imports et les webhooks de paiement sont des traitements longs ou sujets à échec qui n'ont pas leur place dans une requête HTTP.

Par ailleurs, les modules (ADR-001) doivent réagir aux faits des autres sans les importer. Il faut une communication asynchrone fiable : on ne peut pas perdre un événement parce que le processus s'arrête entre le commit et la publication.

## Décision

1. **Transactional outbox.** Un use case qui doit publier un événement l'écrit dans la table `platform.domain_events` (`id`, `tenant_id`, `type`, `version`, `payload` JSONB, `occurred_at`, `request_id`, `published_at`, `attempts`) **dans la même transaction** que la modification de données. La table est sous RLS (ADR-002).
2. **Relais.** Un relais lit les événements non publiés (`SELECT ... FOR UPDATE SKIP LOCKED`), les pousse dans BullMQ et marque `published_at`. Garantie : **au moins une fois**.
3. **Consommateurs idempotents.** Chaque consommateur déduplique par `event.id` (table de traitement ou clé d'idempotence). Les handlers sont écrits en supposant des doublons et des réordonnancements limités.
4. **BullMQ + Redis.** Redis est ajouté au compose et à l'environnement. Les files sont nommées par fonction (`pdf`, `notifications`, `recompute`, `imports`, `webhooks`), avec reprises exponentielles, plafond de tentatives et file des échecs (dead-letter) consultable.
5. **`apps/worker`.** Un processus distinct de l'API héberge les consommateurs et les tâches planifiées (jobs répétables BullMQ, à la place des `setInterval`). Il se connecte en `app_user` et établit le contexte tenant à partir de l'événement ; les rares traitements transverses utilisent `SystemDb` (audité).
6. **Contrat d'événement.** Les types d'événements sont déclarés dans le manifeste du module émetteur et les schémas Zod sont dans `packages/contracts`. Un événement est versionné (`type` + `version`) ; on ajoute des champs, on n'en retire pas sans nouvelle version.
7. **Séparation des usages.** Événement de domaine = fait métier passé (`grade.published`, `payment.received`). Commande asynchrone = demande d'exécution (`pdf.render`) ; elle peut passer par la même mécanique mais n'est pas déclarée comme événement de domaine.

## Conséquences

- Fin des `setInterval` dans l'API : celle-ci peut être redémarrée et dupliquée sans doubler les tâches planifiées.
- Cohérence : pas d'événement fantôme (publié sans commit) ni d'événement perdu (commit sans publication).
- Complexité opérationnelle : Redis à exploiter (persistance, sauvegarde de configuration), un second processus à déployer et à superviser ; les logs et traces du worker portent `request_id` et `tenant_id`.
- Le délai de livraison est de l'ordre de la seconde (intervalle du relais) ; inadapté à du temps réel strict, suffisant pour ce produit.
- Exigence de tests : tests d'idempotence des consommateurs, test de reprise après arrêt du relais.

## Alternatives rejetées

- **Publication directe vers Redis après commit** : perte d'événement si le processus tombe entre les deux.
- **Bus externe (Kafka, RabbitMQ, NATS)** : surdimensionné pour un monolithe ; un système de plus à opérer.
- **LISTEN/NOTIFY Postgres seul** : pas de persistance ni de reprise, pas de gestion native des échecs.
- **Garder `setInterval` dans l'API** : pas de coordination entre instances, pas de reprise, ressources de l'API consommées par les traitements lourds.
- **File de jobs dans Postgres (pg-boss, graphile-worker)** : viable et sans Redis, mais BullMQ est déjà dans les dépendances et Redis servira aussi au rate limiting (plan 3.15).
