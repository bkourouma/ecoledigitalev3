# ADR-009 — Observabilité : journaux structurés, traces, métriques, santé

- **Statut :** Accepté
- **Date :** 2026-10-02
- **Références :** plan §3.9 et §2 (exploitation) ; ADR-001, ADR-002, ADR-004 (« les logs et traces du worker portent `request_id` et `tenant_id` »), ADR-008 ; `apps/api/src/platform/observability/`, `apps/worker/src/observability/`, `docs/architecture/runbook-exploitation.md`, `infra/observability/`

## Contexte

Avant cette décision : Fastify journalise avec pino (requête complète, URL **avec** sa chaîne de requête, en-têtes selon le niveau), le worker avec un autre pino (`jobId`, `tenantId`… en camelCase) et une redaction limitée à quelques chemins (`*.password`, `*.url`). Aucun identifiant ne relie la requête HTTP, l'événement d'outbox et le job du worker autrement que `request_id` dans la colonne `kernel.domain_events.request_id` (non journalisé côté API). Il n'existe ni trace, ni métrique, ni `/ready` (seulement `/api/v1/health` et `/api/v1/health/db`), ni règle d'alerte. Une panne de relais d'outbox, une DLQ qui grossit ou des paiements restés `PENDING` ne se verraient qu'à la plainte d'un utilisateur.

Contraintes : multi-tenant (un tenant bruyant ne doit pas faire exploser le coût des métriques), données de mineurs et données financières (aucune donnée personnelle dans les journaux, traces ou métriques), déploiement sans fournisseur imposé, **aucun appel réseau sortant sans configuration explicite**, exploitation par une petite équipe (peu de composants à opérer).

## Décision

### 1. Journaux : pino partout, un schéma unique, redaction centralisée

- Un seul schéma de ligne JSON pour l'API et le worker : `time`, `level`, `service` (`api`|`worker`), `msg`, et les champs de corrélation **en snake_case** `request_id`, `tenant_id`, `user_id`, `module`, `job_id`, `event_id`, `trace_id`, `span_id`. `user_id` est l'identifiant d'identité (UUID) ; **jamais** d'e-mail ni de nom.
- Les champs de corrélation sont ajoutés **automatiquement** (`mixin` pino lisant un `AsyncLocalStorage`), y compris pour le code d'un module qui journalise via `runtime.logger` ou `ctx.logger` : aucun module à modifier. Les clés camelCase historiques (`tenantId`, `requestId`, `jobId`, `eventId`) sont normalisées vers le snake_case au moment de l'écriture.
- **Redaction par défaut-refus** (`packages/kernel/src/logger.ts`, fonctions pures, sans dépendance) : toute valeur dont la clé désigne un secret ou une donnée personnelle (mot de passe, jeton, `authorization`, cookie, secret, clé, OTP/TOTP, numéro de carte/IBAN, e-mail, téléphone, contenu de message/corps de requête) devient `[REDACTED]`, à profondeur bornée et sans suivre les cycles ; les **valeurs** sont en plus filtrées par motif (e-mail, JWT, `Bearer …`, identifiants dans une URL de connexion, numéros de carte valides au contrôle de Luhn, IBAN). Les erreurs sont réduites à un sous-ensemble sûr (`type`, `message` filtré, `stack` filtrée, `code`) : jamais `detail`/`query`/`parameters` d'une erreur `pg`.
- Fastify : `disableRequestLogging` ; **une seule ligne par requête** à la fin (`request completed`) avec `method`, `route` (le **motif** de route, jamais l'URL), `status`, `duration_ms`, `module`. La chaîne de requête n'est jamais journalisée (jetons de réinitialisation, URL signées du stockage).
- `LOG_LEVEL` (API et worker) ; défaut `info` en production, `debug` sinon.
- Garde-fou : `assertNoForbiddenLogContent` (même module du kernel) est utilisé par des tests d'intégration qui capturent les journaux de l'API et du worker après un parcours contenant des secrets ; il échoue si une clé interdite porte autre chose que `[REDACTED]` ou si une valeur ressemble à un e-mail, un JWT, un `Bearer`, une carte.

### 2. Corrélation requête → événement → job

- `request_id` : en-tête `x-request-id` valide (`[A-Za-z0-9._-]{8,100}`), sinon UUID v7 généré en tout début de requête ; renvoyé dans la réponse (`x-request-id`) ; c'est **le même** que `RequestContext.requestId` (le hook écrit la valeur normalisée dans l'en-tête avant `v2-auth`/`v2-context`, qui la relisent). Il est déjà écrit dans `kernel.domain_events.request_id` par `createDomainEvent`.
- `traceparent` (W3C) : nouvelle colonne **nullable** `kernel.domain_events.traceparent` (migration worker `0604`). `PgOutboxWriter` l'écrit quand un fournisseur de contexte de trace est enregistré (traçage actif) et que l'événement n'en porte pas déjà un ; sans traçage actif, le SQL d'insertion est **inchangé**. Aucune donnée personnelle : `00-<trace_id>-<span_id>-<flags>`. `DomainEvent.traceparent?` est un champ optionnel ajouté au noyau (rétro-compatible).
- Le relais transmet `request_id` et `traceparent` dans les données du job BullMQ (`{ event, trace }`), le routeur et l'abonné les reprennent : les spans du worker sont des enfants du span HTTP d'origine, les journaux du worker portent le `request_id` de la requête qui a émis l'événement.
- **Continuité des événements dérivés** : un abonné qui appelle un use case avec `createSystemContext(tenantId)` créait un `requestId` neuf, donc rompait la chaîne (l'événement suivant, la ligne d'audit et les journaux n'avaient plus le `request_id` d'origine). Le noyau expose `setAmbientRequestIdProvider` : sans `requestId` explicite, un contexte hérite du `request_id` ambiant (corrélation en cours), sinon UUID v7 comme avant. Seule la plateforme branche ce fournisseur ; un `requestId` explicite l'emporte toujours. Les lignes de `SystemDb` (`event: "system_db"`) exposent l'identifiant de leur transaction sous `tx_request_id` pour ne pas masquer le `request_id` de corrélation.

### 3. Traces : OpenTelemetry, désactivées par défaut

- SDK Node (`@opentelemetry/sdk-trace-node`) + exportateur OTLP/HTTP, **activé uniquement** si `OTEL_EXPORTER_OTLP_ENDPOINT` (ou `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`) est défini et `OTEL_SDK_DISABLED` ne vaut pas `true`. Sans configuration : aucun SDK, aucun fournisseur de traces, **aucune connexion réseau**.
- Variables standard : `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS` (secret : jamais journalisé), `OTEL_SERVICE_NAME`, `OTEL_TRACES_SAMPLER_ARG` (ratio, défaut `0.1` en production, `1` ailleurs ; échantillonneur `parentbased_traceidratio`). Le drapeau « échantillonné » d'un `traceparent` entrant n'est honoré que si `OBS_TRUST_INBOUND_TRACEPARENT=true` (derrière une passerelle de confiance) : par défaut, une requête publique ne peut ni imposer ni forcer l'échantillonnage.
- Spans : serveur HTTP Fastify (créé par notre hook, nommé `METHOD <motif de route>`), `pg` (`@opentelemetry/instrumentation-pg`, instruction réduite au verbe, `BEGIN`/`COMMIT`/`SET_CONFIG` écartés pour réduire le bruit), HTTP sortant des adaptateurs (`instrumentation-http` client et `instrumentation-undici`/`fetch`), BullMQ côté worker : `outbox publish` (producteur), `route`, `handle <abonné>` et `job <nom>` (consommateurs) — créés à la main parce que BullMQ ne propage pas de contexte W3C sans son module de télémétrie dédié.
- Attributs : `tenant.id` (UUID du tenant, pas de PII), `enduser.id` = identifiant d'identité, `request.id`, `ed.module`. **Un exportateur enveloppant** (`SanitizingSpanExporter`) filtre tous les attributs et événements d'un span avant export (URL sortantes sans chaîne de requête, motifs d'e-mail/jeton), en dernière ligne de défense.

### 4. Métriques : `prom-client`, Prometheus, `/metrics` protégé

- Registre Prometheus par processus ; l'API et le worker exposent chacun leurs séries. Pas de collecteur OTLP de métriques en v1 : un Collector OTLP peut **scruter** `/metrics` (récepteur `prometheus`) si l'on veut tout pousser en OTLP.
- **`/metrics` n'est jamais public sans authentification.** Trois modes, dans cet ordre : (a) `METRICS_PORT` → serveur dédié sur `METRICS_HOST` (défaut `127.0.0.1`), jamais le port public ; (b) `METRICS_TOKEN` (≥ 24 caractères) → `GET /metrics` sur le port applicatif avec `Authorization: Bearer`, comparaison en temps constant ; (c) ni l'un ni l'autre → **aucune route** `/metrics`. Un serveur dédié lié à une adresse non loopback **exige** `METRICS_TOKEN`. Le worker applique la même règle à son serveur de santé (qui écoute sur `0.0.0.0` dans l'image) : sans jeton, `/metrics` y répond 404. Le reverse proxy ne route que `/api/v1/` et `/health` vers l'API : le `/metrics` racine n'est de toute façon pas joignable depuis Internet.
- **Cardinalité** : les étiquettes sont `module` (≈ 25 valeurs), `route` (motif Fastify, jamais l'URL ; plafond configurable avec repli sur `__other__`), `method`, `status_class` (`2xx`…), `queue`, `subscriber`, `job` — des ensembles **finis et connus au démarrage**. **`tenant_id` n'est pas une étiquette** de série à haut volume : avec ≈ 10² tenants × ≈ 10³ routes × 10 buckets, un seul histogramme dépasserait 10⁶ séries. L'analyse par tenant se fait dans les journaux et traces (qui portent `tenant_id`). Option bornée : `METRICS_TENANT_LABEL_MAX=N` (défaut `0` = désactivé) active un unique compteur `ed_tenant_http_requests_total{tenant_id}` limité aux N premiers tenants vus (les suivants sont agrégés dans `other`), pour repérer un tenant bruyant.
- Séries : latence/erreurs HTTP par route et module ; pool PG (total, inactif, en attente, durée d'acquisition) ; files BullMQ (profondeur par état, âge du plus ancien job en attente, échecs, DLQ) ; relais d'outbox (retard de publication, plus ancien événement en attente, échecs, pannes Redis, dernière réussite) ; abonnés (durée, succès/échecs/doublons) ; jobs planifiés (durée, dernière réussite persistée dans Redis — elle survit au redémarrage du worker) ; paiements `PENDING` (nombre, plus ancien, périmés) ; rendus PDF (durée, échecs par type d'abonné de rendu).

### 5. Santé

- `GET /health` (liveness) : 200 tant que le processus répond, sans toucher à aucune dépendance. `GET /ready` (readiness) : sondes **PostgreSQL**, **Redis**, **migrations** (schémas et tables attendus présents — API : un schéma par module qui possède des migrations ; worker : ceux des modules découverts avec un dossier `migrations/` — ; `app_user` ne peut pas lire les tables de suivi du migrateur, le contrôle est donc structurel), **worker vivant** (battement de cœur Redis, écrit par chaque worker toutes les 10 s, valable 30 s) et **stockage objet**. Sondes **requises** par défaut : `postgres`, `redis` (si configuré), `migrations` ; `worker` et `storage` sont signalées comme dégradation (`status: "degraded"`, HTTP 200) — redémarrer l'API ne répare ni un worker arrêté ni un bucket indisponible. `OBS_READY_REQUIRE` change la liste. Chaque sonde a un délai de 2 s. La réponse publique ne contient que des noms de sonde et des booléens (`OBS_HEALTH_DETAILS=true` ajoute les messages d'erreur, pour un réseau interne).
- Le worker expose les mêmes routes sur son serveur de santé existant (`/health`, `/ready`, ajout de `migrations` et `storage`).

### 6. Organisation du code

- `packages/kernel/src/logger.ts` : redaction et schéma de journal purs, sans dépendance (le noyau reste pur).
- `apps/api/src/platform/observability/core/` : cœur **sans Fastify** (configuration, corrélation, traçage, métriques, sondes) importé aussi par le worker (le worker importe déjà `platform/adapters` de l'API ; le bundle esbuild l'embarque).
- `apps/api/src/platform/observability/plugin.ts` : plugin Fastify (identifiant de requête, span serveur, journal d'accès, métriques HTTP, routes `/health`, `/ready`, `/metrics`).
- `apps/worker/src/observability/` : instrumentation du worker (relais, routeur, abonnés, jobs, files, battement de cœur, jauges métier).
- Règles `dependency-cruiser` : `observability-core-framework-free` (le cœur n'importe ni Fastify, ni module, ni legacy) et `observability-no-modules` (la plateforme d'observabilité n'importe aucun module).

## Conséquences

- Positives : un `request_id` retrouve la requête, l'événement et le job ; l'exploitation dispose de SLO, d'alertes et d'un tableau de bord fournis ; aucun coût ni appel réseau sans configuration ; aucune donnée personnelle dans les trois canaux (testé) ; les modules ne sont pas modifiés.
- Négatives : une colonne ajoutée à l'outbox (migration worker `0604`, additive) et un fournisseur de contexte de trace dans `PgOutboxWriter` ; onze paquets OpenTelemetry et `prom-client` à embarquer (le bundle du worker passe à ≈ 7,5 Mo) ; les spans `pg` ajoutent un coût (quelques microsecondes par requête SQL) et sont donc échantillonnés ; la jauge « paiements en attente » lit `finance.payments` (lecture seule, sans donnée personnelle) depuis le worker : exception assumée et documentée à la règle « jamais de SQL sur le schéma d'un autre module », couverte par un test contre le vrai schéma migré (si finance renomme la colonne, le test échoue).
- Le noyau change aussi (`DomainEvent.traceparent?`, `setAmbientRequestIdProvider`) et `packages/database` (fournisseur de `traceparent` dans `PgOutboxWriter`, `fetchPendingEvents` avec lecture facultative de la colonne) : tous additifs et sans effet tant que l'observabilité n'est pas branchée.
- Limites : le code legacy (`console.log`, `fastify.log` de ses routes) est protégé par la redaction mais n'est pas restructuré ; les spans des routes legacy portent le motif de route mais pas de `module` v2 (`legacy`) ; l'âge du plus ancien événement d'outbox est estimé par le relais (événements vus au dernier passage), pas par un comptage global.
- Garde-fous CI : tests unitaires (redaction, propagation, cardinalité, authentification de `/metrics`), tests d'intégration (corrélation de bout en bout, santé, aucune fuite dans les journaux capturés), règles `check:boundaries`.

## Alternatives rejetées

- **`@opentelemetry/sdk-node` + auto-instrumentations** : tire ~40 instrumentations (dont `fs`, `dns`, `net`) pour en utiliser quatre, et active par défaut des exportateurs réseau ; on assemble le SDK minimal.
- **Instrumentation HTTP serveur automatique** : les attributs `http.url`/`http.target` contiennent la chaîne de requête (jetons) et le nom de route n'est pas connu ; notre span serveur utilise le motif de route.
- **`tenant_id` en étiquette par défaut** : cardinalité non bornée (voir §4).
- **Métriques OTLP natives** : API de métriques plus jeune, deux pipelines à exploiter ; Prometheus est ubiquitaire et scrutable par un Collector.
- **`traceparent` dans le `payload` de l'événement** : les schémas de payload des modules sont versionnés et parfois stricts ; une colonne dédiée n'impacte aucun contrat.
- **Dériver le `trace_id` du `request_id`** : sans lien avec le span HTTP réel, des `x-request-id` rejoués par un client produiraient des identifiants de span en double.
- **Journaux via `console`** : pas de niveaux, pas de redaction, pas de corrélation.
