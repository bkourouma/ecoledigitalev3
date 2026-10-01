# @ecoledigitale/worker

Processus de fond de la plateforme v2 (ADR-004, plan §3.9). Il héberge :

1. le **relais d'outbox** : `kernel.domain_events` (non publiés) -> file BullMQ `domain-events` ;
2. les **abonnés d'événements** des modules (`modules/<key>/subscribers.ts`), avec reprises, concurrence et dead-letter ;
3. les **jobs planifiés** (`modules/<key>/jobs.ts`) à la place des `setInterval` du process API ;
4. un serveur de santé minimal (`/health`, `/ready`).

Il est **distinct de l'API** : on peut redémarrer ou dupliquer l'un sans l'autre. Les `setInterval` de
`apps/api/src/jobs/*.job.ts` ne sont pas touchés ici ; ils migreront module par module vers `jobs.ts`.

## Architecture

```
 use case (API)                         apps/worker
 ┌────────────────────┐   COMMIT   ┌──────────────────────────────────────────────────────┐
 │ données + PgOutbox │──────────▶ │ kernel.domain_events (published_at IS NULL)          │
 │ Writer (même tx)   │  NOTIFY    └───────────────┬──────────────────────────────────────┘
 └────────────────────┘ (tenant)                   │ relais : par tenant, FOR UPDATE SKIP LOCKED
                                                   ▼
                                  BullMQ  « domain-events »   (jobId = id d'événement)
                                                   │ routeur : motif -> abonnés
                          ┌────────────────────────┼────────────────────────┐
                          ▼                        ▼                        ▼
              domain-events-sub-<A>     domain-events-sub-<B>     domain-events-sub-<C>
                 (retry, concurrence, handler idempotent, TenantDb du tenant de l'événement)
                                   │ échecs définitifs
                                   ▼
                       BullMQ « domain-events-dead »  (DLQ)
```

| Fichier | Rôle |
|---|---|
| `src/events/relay.ts` | relais d'outbox, backoff, échec définitif, panne Redis |
| `src/events/notifications.ts` | LISTEN/NOTIFY (accélérateur de latence) |
| `src/events/publisher.ts` | publication BullMQ, dédoublonnage, DLQ |
| `src/events/consumers.ts` | routeur + workers d'abonnés |
| `src/events/registry.ts`, `pattern.ts`, `backoff.ts` | registre, routage par motif, backoff |
| `src/events/dlq-admin.ts`, `src/cli/dlq.ts` | exploitation de la DLQ |
| `src/scheduler/` | jobs planifiés (BullMQ Job Schedulers + verrou d'unicité Redis) |
| `src/jobs/` | jobs du socle : `outbox-cleanup`, `ensure-partitions` |
| `src/discovery/` | découverte de `modules/*/subscribers.ts` et `jobs.ts` |
| `src/sdk.ts` | **l'API pour les modules** : `defineSubscriber`, `idempotent`, `defineScheduledJob` (types seuls, aucune dépendance d'exécution) |
| `migrations/` | `0601`-`0603` (plage 0600-0699) |

### Garanties

* **Au moins une fois**, jamais « perdu » : l'événement est écrit dans la transaction de la donnée ; le relais ne le
  marque `published_at` qu'**après** l'ajout à BullMQ, dans la même transaction que le `SELECT ... FOR UPDATE SKIP LOCKED`.
  Un crash entre les deux republie l'événement, que BullMQ **ignore** (même `jobId`) tant que le job n'est pas purgé
  (24 h de rétention des jobs terminés).
* **Plusieurs instances** du worker : sans doublon (`SKIP LOCKED`), partage du travail automatique.
* **Handlers idempotents obligatoires** (doublons possibles après une panne ou au-delà de la fenêtre de dédoublonnage) :
  utiliser `idempotent()` (ci-dessous). **Pas de garantie d'ordre** entre événements.
* **Isolation tenant** : un handler reçoit un `TenantDb` **lié au tenant de l'événement** (contexte système) ; la RLS
  reste le verrou de dernier recours. Le relais lit tenant par tenant (`SystemDb`), jamais en vue globale.
* **Panne Redis** : aucune tentative n'est comptabilisée contre les événements (ce n'est pas leur faute) ; le relais
  se met en pause avec un backoff (0,5 s -> 30 s) et reprend seul.
* **Latence** : < 100 ms typique avec LISTEN/NOTIFY (mesuré : médiane ≈ 25-40 ms, max < 70 ms), < 1 s en polling pur
  (`WORKER_RELAY_POLL_INTERVAL_MS`).

### Échec d'un événement

| Où | Comportement |
|---|---|
| Relais (BullMQ refuse **cet** événement) | `attempts + 1`, `available_at` repoussé (backoff exponentiel plafonné) ; à `WORKER_RELAY_MAX_ATTEMPTS` : **échec définitif** = `available_at = 'infinity'` + `last_error` conservé + entrée `relay` dans la DLQ |
| Handler d'un abonné | `retry.attempts` tentatives avec backoff exponentiel (`retry.backoffMs` -> `retry.maxBackoffMs`) ; ensuite entrée `handler` dans la DLQ (le job reste aussi dans l'état « failed » de la file de l'abonné, 7 jours) |
| Routeur (Redis refuse l'ajout dans la file de l'abonné) | 10 tentatives, puis entrée `router` dans la DLQ |

## Variables d'environnement

Validées par Zod **au démarrage** : une valeur invalide arrête le process (code 78) avec la liste des variables en cause,
sans jamais afficher leurs valeurs.

| Variable | Défaut | Rôle |
|---|---|---|
| `REDIS_URL` | **obligatoire** | `redis://…` ou `rediss://…` |
| `WORKER_DATABASE_URL` | **obligatoire** | rôle de connexion **membre de `app_user`**. Jamais superuser, `BYPASSRLS` ni propriétaire : le worker le vérifie au démarrage et **refuse de démarrer** sinon. `DATABASE_URL` n'est jamais lu |
| `WORKER_QUEUE_PREFIX` | `ed` | préfixe des clés BullMQ (plusieurs environnements sur un Redis) |
| `WORKER_HTTP_HOST` / `WORKER_HTTP_PORT` | `127.0.0.1` / `8012` | serveur de santé (`0.0.0.0` dans l'image) |
| `LOG_LEVEL` | `info` | niveau pino (`silent` pour se taire) |
| `WORKER_PG_POOL_MAX` | `10` | taille du pool applicatif |
| `WORKER_PG_STATEMENT_TIMEOUT_MS` | `30000` | `statement_timeout` par transaction |
| `WORKER_SHUTDOWN_TIMEOUT_MS` | `25000` | attente des jobs en cours à l'arrêt, avant fermeture forcée (Docker : `stop_grace_period: 40s`) |
| `WORKER_TZ` | `UTC` | fuseau des expressions cron |
| `WORKER_MODULES_DIRS` | `apps/api/src/modules`, `modules/` | dossiers de modules (séparés par des virgules), **au build** pour le bundle |
| `WORKER_RELAY_ENABLED` | `true` | active le relais (le désactiver sur les instances « consommateurs seulement ») |
| `WORKER_RELAY_BATCH_SIZE` | `200` | événements par lot et par tenant |
| `WORKER_RELAY_SWEEP_INTERVAL_MS` | `5000` | balayage de tous les tenants (filet de sécurité de LISTEN/NOTIFY, retries échus) |
| `WORKER_RELAY_POLL_INTERVAL_MS` | `500` | cadence quand LISTEN/NOTIFY n'est pas connecté |
| `WORKER_RELAY_MAX_ATTEMPTS` | `10` | tentatives avant échec définitif |
| `WORKER_RELAY_BACKOFF_BASE_MS` / `_MAX_MS` | `1000` / `300000` | backoff exponentiel (relais et routeur) |
| `WORKER_SUBSCRIBERS_ENABLED` | `true` | active routeur + abonnés |
| `WORKER_ROUTER_CONCURRENCY` | `20` | concurrence du routeur |
| `WORKER_SCHEDULER_ENABLED` | `true` | active les jobs planifiés |
| `WORKER_PRUNE_SCHEDULERS` | `true` | retire de Redis les planifications dont le code a disparu |
| `OUTBOX_RETENTION_DAYS` | `30` | rétention des événements publiés et des marques d'idempotence |
| `OUTBOX_CLEANUP_BATCH_SIZE` | `1000` | taille des lots de purge |
| `AUDIT_ENSURE_PARTITIONS_FN` | `audit.ensure_partitions` | fonction SQL appelée par `ensure-partitions` |
| `AUDIT_PARTITIONS_MONTHS_AHEAD` | `3` | mois de partitions créés d'avance |

Redis : `maxmemory-policy noeviction` recommandé (BullMQ le vérifie) ; le compose de production active l'AOF.

## Prérequis base de données

1. Baseline `packages/database/migrations` (rôles `migrator`/`app_user`, schéma `kernel`, outbox).
2. Migrations du worker `apps/worker/migrations` (**plage 0600-0699**, versions globales) :
   * `0601` `kernel.processed_events` (idempotence, RLS forcée) ;
   * `0602` trigger `NOTIFY ed_domain_events` (payload = `tenant_id` du lot) ;
   * `0603` index partiel de purge des événements publiés.
   Le runner de la plateforme les applique avec tous les autres dossiers. Raccourci de développement
   (baseline + worker seulement, rôle capable de `SET ROLE migrator`) :
   `pnpm --filter @ecoledigitale/worker migrate -- --url "$MIGRATOR_DATABASE_URL"`.
3. Un rôle de connexion pour le worker : `CREATE ROLE worker_login LOGIN PASSWORD :'secret' IN ROLE app_user;`
   (secret injecté, jamais dans une migration ni dans git).

Le worker vérifie au démarrage : rôle ni `SUPERUSER` ni `BYPASSRLS`, hérite de `app_user`, tables `kernel.tenants`,
`kernel.domain_events`, `kernel.processed_events` présentes. Sinon : arrêt immédiat avec un message explicite.

## Lancer

```bash
# Développement (tsx, rechargement). Pour des logs lisibles : | pnpm dlx pino-pretty
export REDIS_URL=redis://localhost:6379
export WORKER_DATABASE_URL=postgresql://worker_login:***@localhost:5432/dbecoledigitale
pnpm --filter @ecoledigitale/worker dev

# Production : bundle esbuild unique, sans node_modules
pnpm --filter @ecoledigitale/worker build        # -> apps/worker/dist/index.cjs (+ dlq.cjs)
node apps/worker/dist/index.cjs
```

**Pourquoi un bundle et pas `tsc`** : `@ecoledigitale/kernel` et `@ecoledigitale/database` sont consommés en source
TypeScript (`main: ./src/index.ts`) ; un `tsc` du worker ne les compilerait pas et `node` ne sait pas les exécuter. Le bundle les
embarque, ainsi que les dépendances npm et **les modules découverts au build**. `pnpm type-check` fait le contrôle de types.

Arrêt gracieux (`SIGTERM`/`SIGINT`) : `/ready` passe à 503, le relais termine son lot, les workers BullMQ terminent leurs jobs
(jusqu'à `WORKER_SHUTDOWN_TIMEOUT_MS`, puis fermeture forcée : les jobs seront repris), puis fermeture de Redis, des pools PG et du
serveur HTTP. Un second signal force la sortie.

Santé : `GET /health` (liveness, toujours 200 tant que le process répond) ; `GET /ready` (200 si démarré, pas en arrêt, Redis **et**
PostgreSQL répondent ; 503 sinon, avec le détail par sonde).

### Docker

* Image : `infra/compose/Dockerfile.worker` (Node 20 Alpine, multi-étapes, utilisateur non root, aucun secret, `dist/` seulement).
  Le code de `apps/api/src` est monté le temps du build pour embarquer les modules : **un nouveau module impose de reconstruire l'image**.
  `pnpm-lock.yaml` doit contenir `apps/worker` (`pnpm install` après l'ajout du package).
* Production : service `ecoledigitale-worker` de `docker-compose.yml`, **profil `worker`** (non démarré par un `up` ordinaire tant que la base v2
  n'existe pas en production ; retirer la ligne `profiles` ensuite) :
  `docker compose -f infra/compose/docker-compose.yml --profile worker up -d --build ecoledigitale-worker`.
  Dépend de `postgres` et `redis` sains. **Sans `env_file`** : il ne reçoit ni `DATABASE_URL` ni autre secret ; fournir `WORKER_DATABASE_URL`
  par l'environnement ou le `.env` du projet compose.
* Développement : service `worker` (profil optionnel) de `docker-compose.dev.yml` ; en pratique on lance plutôt `pnpm … dev` hors Docker.

## Ajouter un abonné

Dans `modules/<key>/subscribers.ts` (ou `apps/api/src/modules/<key>/subscribers.ts`) — **aucun fichier central à modifier**,
le worker le découvre au démarrage (au build pour le bundle) :

```ts
import { defineSubscriber, idempotent } from "@ecoledigitale/worker/sdk";

export default [
  defineSubscriber({
    name: "finance.send-receipt",              // STABLE et unique : nom de file + clé d'idempotence
    pattern: "finance.payment.completed",      // type exact, « finance.*.completed », « finance.** », « ** » ou RegExp
    retry: { attempts: 5, backoffMs: 1_000, maxBackoffMs: 300_000 },
    concurrency: 5,
    handler: idempotent("finance.send-receipt", async (event, ctx, tx) => {
      // tx : transaction du TENANT de l'événement ; la marque « traité » est validée avec ces écritures
      await tx.query("INSERT INTO finance.receipts (...) VALUES (...)", [/* ... */]);
    }),
  }),
];
```

* **Motifs** : segments séparés par « . » ; `*` = exactement un segment ; `**` en dernier = un ou plusieurs segments ; `**` seul = tout ;
  une `RegExp` est testée sur le type complet.
* **`idempotent(subscriber, handler)`** réserve `(subscriber, event_id)` dans `kernel.processed_events` **dans la transaction** du handler :
  un doublon est ignoré, un échec annule la marque **et** les écritures (l'événement redevient rejouable). Effets externes (e-mail,
  HTTP) : non annulables, donnez-leur `event.id` comme clé d'idempotence ou faites-les après le commit.
* Le handler reçoit `ctx = { tenantId, db, tenantDb, systemDb, logger, subscriber, attempt, jobId }`. `ctx.db.run(fn)` est lié au tenant de l'événement ;
  `ctx.tenantDb` est le `TenantDb` complet (ouvrir une transaction pour un **autre** contexte, p. ex. un use case de module qui construit lui-même son
  `RequestContext` ; les jobs globaux le reçoivent aussi) ;
  `systemDb` est réservé aux rares traitements transverses (raison obligatoire, audité). Le logger porte déjà `jobId`, `tenantId`, `eventId`, `subscriber`.
* Impératif (tests, abonnés du socle) : `registerSubscriber("student.enrolled", handler, { name, retry, concurrency })`.
* Un module ne doit importer que `@ecoledigitale/worker/sdk`, le kernel, le package database, `zod`… (les dépendances propres à l'API ne sont pas
  installées dans l'image du worker).
* Déclarer le type dans `events.consumes` du manifeste du module.
* **Bundle esbuild** : esbuild lit le `tsconfig.json` le **plus proche** du fichier. Un module qui possède son propre `tsconfig.json`
  (audit, iam, rbac, finance) doit y déclarer le chemin `@ecoledigitale/worker/sdk` → `../../../../worker/src/sdk.ts`, sinon le build
  échoue (« Could not resolve @ecoledigitale/worker/sdk »). Le test `apps/api/test/phase1/worker-bundle.integration.test.ts` construit
  et démarre le vrai bundle pour le prouver.
* Abonnés et jobs réels livrés par les modules : audit (un abonné par `AUDIT_EVENT_SUBSCRIPTIONS`, jobs de partitions), rbac, entitlements,
  finance (`mark-overdue-invoices`), iam (`purge-expired-data`) — voir `docs/architecture/platform-assembly.md` §7.

## Ajouter un job planifié

`modules/<key>/jobs.ts` :

```ts
import { defineScheduledJob } from "@ecoledigitale/worker/sdk";

export default [
  // Une fois, globalement
  defineScheduledJob({
    name: "audit.detach-expired",
    cron: "30 3 1 * *",                       // 5 champs (6 avec secondes), fuseau WORKER_TZ
    handler: async ({ systemDb, logger }) => { /* ... */ },
  }),
  // Une fois par tenant actif (un échec n'arrête pas les autres ; le job est alors signalé en échec)
  defineScheduledJob({
    name: "finance.send-reminders",
    cron: "0 7 * * *",
    perTenant: true,
    handler: async ({ tenant, db, logger }) => { await db.run(async (tx) => { /* ... */ }); },
  }),
];
```

* Planification BullMQ (`upsertJobScheduler`) : N instances qui démarrent ensemble ne créent **qu'une** planification, chaque échéance est
  consommée par **une** instance.
* **Verrou d'unicité** Redis par job (TTL `lockTtlMs`, défaut 5 min, renouvelé tant que le job tourne) : une échéance qui arrive avant la fin
  de l'exécution précédente est ignorée. Après un `SIGKILL`, le verrou expire seul au bout de `lockTtlMs`.
* Le handler doit être **idempotent** et traiter par lots courts (plusieurs `db.run`) plutôt qu'en une longue transaction.

Jobs du socle : `outbox-cleanup` (03:17, par tenant : purge par lots des événements **publiés** de plus de `OUTBOX_RETENTION_DAYS` jours
et des marques d'idempotence du même âge ; les événements non publiés ou en échec définitif ne sont **jamais** supprimés) et
`ensure-partitions` (02:05 : appelle `audit.ensure_partitions` si le module audit est déployé, sinon no-op journalisé).

## Exploitation

### Rejouer la DLQ (`domain-events-dead`)

```bash
pnpm --filter @ecoledigitale/worker dlq -- list [--kind relay|router|handler] [--limit 50]
pnpm --filter @ecoledigitale/worker dlq -- replay <id>           # une entrée
pnpm --filter @ecoledigitale/worker dlq -- replay --all [--kind handler]
pnpm --filter @ecoledigitale/worker dlq -- remove <id>           # abandonner
# dans un conteneur (REDIS_URL / WORKER_DATABASE_URL déjà présents) :
docker compose --profile worker run --rm ecoledigitale-worker node dist/dlq.cjs list
```

Corriger d'abord la cause (code, donnée, service externe), puis rejouer. Le rejeu remet le compteur de tentatives à zéro :
* `relay` : `attempts = 0`, `available_at = now()` sur la ligne d'outbox (le relais la reprend) — `WORKER_DATABASE_URL` requis ;
* `router` / `handler` : le job est recréé (même `jobId`) avec le même nombre de tentatives ; l'idempotence évite tout double effet.

État en SQL (par tenant) : en attente `published_at IS NULL AND available_at <= now()` ; en retry `available_at > now()` ;
**échec définitif** `published_at IS NULL AND available_at = 'infinity'` (cause dans `last_error`).

### Passer à l'échelle

* Lancer **N réplicas** du même service : relais, routeur, abonnés et planificateur coopèrent sans configuration.
* Instances spécialisées : `WORKER_RELAY_ENABLED=false` (consommateurs seuls), `WORKER_SUBSCRIBERS_ENABLED=false` (relais seul),
  `WORKER_SCHEDULER_ENABLED=false`.
* Débit d'un abonné : `concurrency` (par instance) × nombre d'instances ; pool PG : `WORKER_PG_POOL_MAX` ≥ somme des concurrences + marge.
* Reprise après crash : les jobs « actifs » d'un process tué sont repris après `lockDuration` (15 s) + contrôle de jobs bloqués (5 s),
  soit ≈ 20 s.
* Coût du balayage : une transaction courte par tenant actif toutes les `WORKER_RELAY_SWEEP_INTERVAL_MS`. Avec LISTEN/NOTIFY le travail
  réel est ciblé sur les tenants notifiés ; augmenter l'intervalle au-delà de quelques centaines de tenants.

## Tests

```bash
pnpm --filter @ecoledigitale/worker test               # unitaires ; l'intégration est ignorée avec un message
pnpm --filter @ecoledigitale/worker test:integration   # Postgres 17 + Redis 7 éphémères dans Docker, supprimés ensuite
pnpm --filter @ecoledigitale/worker type-check
```

`test:integration` (`scripts/with-infra.mjs`) démarre `ed-wk-it-pg-<aléa>` et `ed-wk-it-redis-<aléa>` sur des ports libres de 127.0.0.1,
mot de passe aléatoire, et les supprime à la fin (même en cas d'échec). Sans Docker : `TEST_DATABASE_URL` et `TEST_REDIS_URL` vers des
instances **jetables**. Couverture d'intégration : 1 000 événements / 3 tenants / 3 relais concurrents (publiés exactement une fois),
crash entre l'ajout Redis et le COMMIT, arrêt/redémarrage en cours de route, `SIGKILL` du vrai bundle `node dist/index.cjs`, handler qui
échoue 2 fois puis réussit, DLQ après N échecs et rejeu, panne Redis, idempotence, isolation du contexte tenant (RLS), routage par motif,
arrêt gracieux, jobs planifiés (verrou, deux instances, par tenant), purge d'outbox, garde-fou de rôle (superuser / BYPASSRLS / non membre).

## Limites connues

* Pas de garantie d'ordre entre événements ; un abonné qui exige l'ordre par agrégat doit le gérer (version, `occurredAt`).
* Fenêtre de dédoublonnage BullMQ : 24 h après la fin d'un job ; au-delà seule l'idempotence des handlers protège.
* Les abonnés d'un module ajouté ou modifié exigent un rebuild du bundle (découverte à la construction en production).
* Les `setInterval` de l'API legacy tournent toujours ; à retirer module par module.
* Le contrat de `defineSubscriber`/`idempotent` vit ici (`@ecoledigitale/worker/sdk`) ; à terme un package partagé (kernel) évitera
  qu'un module importe depuis une app.
