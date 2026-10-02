# Module `notifications` — canaux externes, gabarits, journal, consentement, relances et alertes

Spec : `specs/v2/016-communications/` (partie B : `spec.md` §17 à §30, `data-model.md`, `plan.md`, `parity.md` §6, `open-questions.md` Q-18 à Q-29). Schéma Postgres `notifications`, migration **2600** (plage 2600-2699). Packs PRIMARY, SECONDARY, HIGHER, VIRTUAL. `dependsOn: ["messaging"]` (canal in-app, par son `index.ts`) ; destinataires, factures, résultats arrivent par des **ports**. **Le worker est indispensable à l'envoi.**

## Ce que fait le module

| Domaine | Fonctions |
|---|---|
| Canaux | `EMAIL` (SMTP, nodemailer, rebonds, pied de page de conformité), `SMS` (adaptateur HTTP **générique** configurable, fournisseur non choisi : Q-18), `WHATSAPP` (WaSender), `PUSH` (Web Push VAPID, un abonnement par appareil), `IN_APP` (messaging). Un canal non configuré **échoue explicitement** ; simulation seulement demandée, hors production |
| Gabarits | par établissement, **versionnés** (versions immuables, retour arrière), variables **typées**, aperçu, fr-CI, repli sur des gabarits livrés en DONNÉES ; absence, retard, paiement reçu, facture émise, relance, bulletin publié, convocation, annonce, urgence, seuil d'absences, changement d'horaire, alertes internes, bulletin de paie |
| Journal | une ligne par envoi (file ET trace) : destinataire **masqué**, canal, gabarit + version, statut, tentatives, erreur, identifiant fournisseur, coût ; reprise avec backoff ; dédoublonnage par clé d'événement ; adresse et contenu effacés à l'état terminal |
| Consentement | par personne, canal et catégorie ; modèle `IMPLIED` / `EXPLICIT` ; heures calmes (établissement et personne) ; urgence qui contourne (sauf suppression) ; désinscription par lien signé ; journal de preuve |
| Règles | déclencheur -> audience -> canaux (`ALL` / `FIRST_REACHABLE`) -> gabarit -> urgence -> seuils ; règles livrées surchargeables, règles `custom.*` ; validation (le gabarit n'exige rien que le déclencheur ne fournisse) |
| Relances | job quotidien, paliers J+3 / J+10 / J+30 configurables, jamais deux fois le même palier, arrêt dès paiement (relu à l'envoi + `finance.invoice.paid`) |
| Alertes | absences (>= seuil -> parents), retard de paiement (>= X jours -> économat), baisse de résultats FINAL (-> enseignants), charge d'enseignement (-> direction des études), document expirant (-> RH) |
| Envoi manuel | convocation, annonce, avis urgent (permission sensible, audité) |
| Anti-abus | plafond journalier par canal, par destinataire, file maximale, limiteur des routes publiques |

## Arborescence

```
manifest.ts          permissions, menus, événements publiés / consommés
index.ts             API publique (seul point d'import pour les autres modules)
worker-deps.ts       dépendances des abonnés et jobs du worker (ports du processus, audit, registre de canaux unique)
migrations/          2600_notifications_init.sql (11 tables, RLS, droits)
domain/              catalog, default-templates (DONNÉES), templating, consent, default-rules, triggers, event-readers, dunning,
                     alerts, backoff, addresses, tokens, time, events, errors, types — purs
application/         cas d'usage : enqueue, events, dispatch, dunning, alerts, templates, rules, settings, preferences, push, send,
                     journal, health, webhooks, housekeeping, runners ; ports.ts, deps.ts, port-registry.ts, audience.ts, rendering.ts
infrastructure/      *-repository.ts (SQL via Tx), channels/ (email-smtp, sms-http, whatsapp-wasender, web-push, in-app, registry),
                     in-memory-ports.ts, messaging-bridge.ts
http/                plugin.ts (routes /api/v1/notifications, sans préfixe), guards.ts
subscribers.ts       un abonné par événement déclencheur + arrêt des relances sur facture soldée
jobs.ts              dispatch (15 s), run-dunning (07:00), evaluate-alerts (07:30), housekeeping (04:15)
test/                unit (69 + canaux 25), integration (RLS A/B, flux complets, HTTP)
```

## Routes (`/api/v1/notifications`)

`GET /catalog` · `GET /triggers` · `GET /templates` · `GET /templates/:code/versions` · `POST /templates/:code` · `POST /templates/:code/{activate,enable,preview}` · `GET /rules` · `PUT|DELETE /rules/:key` · `GET|PUT /settings` · `GET /channels` · `POST /channels/test` · `GET /deliveries` · `GET /deliveries/stats` · `POST /send` · `POST /consent` · `GET /consent/log` · `GET|PUT /me/preferences` · `GET /me/push/{vapid-key,devices}` · `POST /me/push/{subscriptions,unsubscribe}` · `DELETE /me/push/devices/:id` · **publiques signées** : `GET|POST /public/unsubscribe?t=` et `POST /webhooks/:tenantId/delivery-status`.

## Permissions

`notifications.read`, `.templates.manage`, `.rules.manage`, `.settings.manage`, `.send`, `.send.urgent` (**sensible**, MFA), `.consent.manage`, `.own.manage` (personnel), `.child.manage` (parent), `.self.manage` (élève). Modèles de rôles système : accordés dans `rbac/templates/system-roles.ts` (la direction par `*`).

## Événements

Publiés (`{ v: 1, … }`, **jamais de contenu ni d'adresse**) : `notifications.delivery.failed`, `.delivery.bounced`, `.consent.changed`, `.template.published`, `.rule.updated`, `.urgent.sent`. Consommés : `finance.invoice.issued|overdue|paid`, `finance.payment.completed`, `attendance.absence.recorded|late.recorded|alert.triggered`, `reportcards.report_card.published`, `scheduling.occurrence.cancelled`, `messaging.announcement.published`, `people.staff_qualification.expiring`, `payroll.payslip.notification_requested` (contrats : `apps/api/test/events-contracts/notifications.contracts.ts`).

## Ports et adaptateurs

| Port | Fournisseur (`platform/adapters`) |
|---|---|
| `RecipientDirectory` (élèves + tuteurs avec ou sans compte, classe, personnel, titulaires de rôles, comptes ; **coordonnées**) | `people-notifications.ts` : people (`listNotificationContactsOf*`, extension additive), academic, rbac, iam |
| `OverdueSource` (échéances en retard, relues avant l'envoi) | `sources-notifications.ts` : finance (`listOverdueInstallments`, extension additive) |
| `GradeSource` (deux résultats FINAL consécutifs) | `sources-notifications.ts` : results + academic + people |
| `TeachingLoadSource` | `sources-notifications.ts` : people + academic |
| `AnnouncementFeed` | `sources-notifications.ts` : messaging (`readAnnouncementForDelivery`, extension additive) |
| `ChannelAdapter` / `ChannelRegistry` | `infrastructure/channels/*` (réalisation du port `NotificationChannel` de messaging ; pont `toMessagingChannel`) |

Registre : `app.notificationsPorts` (API, `registerNotificationsPorts`) ; `setNotificationsWorkerPorts` (worker, branché par `installWorkerAdapters`). Port absent = échec fermé `notifications.port_unavailable`.

## Configuration (voir `.env.example`)

SMTP : `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL`, `SMTP_FROM_NAME` — `NOTIFICATIONS_UNSUBSCRIBE_SECRET` (obligatoire en production pour l'e-mail), `NOTIFICATIONS_WEBHOOK_SECRET`, `NOTIFICATIONS_DEFAULT_SENDER_NAME`, `NOTIFICATIONS_SIMULATE` (hors production), `NOTIFICATIONS_DISPATCH_BATCH`, `NOTIFICATIONS_LEASE_MS`, `NOTIFICATIONS_MAX_PENDING`, `V2_APP_BASE_URL` — SMS : `SMS_HTTP_PROFILE`, `SMS_HTTP_URL`, `SMS_HTTP_METHOD`, `SMS_HTTP_CONTENT_TYPE`, `SMS_HTTP_BODY`, `SMS_HTTP_HEADERS`, `SMS_HTTP_API_KEY[_HEADER|_PREFIX]`, `SMS_HTTP_USERNAME`, `SMS_HTTP_SENDER_ID`, `SMS_HTTP_SUCCESS_PATH|_EQUALS`, `SMS_HTTP_ID_PATH`, `SMS_HTTP_COST_PATH|_MULTIPLIER|_CURRENCY`, `SMS_HTTP_ERROR_PATH`, `SMS_HTTP_TIMEOUT_MS` — WhatsApp : `WASENDER_API_KEY`, `WASENDER_API_BASE_URL`, `WASENDER_SESSION[_NAME]`, `WASENDER_TIMEOUT_MS`, `WASENDER_SKIP_STATUS_CHECK`, `WHATSAPP_PROVIDER` — Push : `NOTIFICATIONS_VAPID_PUBLIC_KEY`, `NOTIFICATIONS_VAPID_PRIVATE_KEY`, `NOTIFICATIONS_VAPID_SUBJECT`.

### SMS : adaptateur HTTP générique

Le fournisseur n'est pas choisi (Q-18). Le **modèle de requête** (URL, méthode, en-têtes, corps JSON ou formulaire avec jetons `{{to}}`, `{{toDigits}}`, `{{text}}`, `{{sender}}`, `{{reference}}`, `{{username}}`) et la **lecture de la réponse** (chemin du critère de succès, de l'identifiant de message, du coût, du message d'erreur) sont des variables d'environnement. Exemple (API JSON) :

```
SMS_HTTP_URL=https://api.fournisseur.example/v1/messages
SMS_HTTP_BODY={"to":"{{to}}","message":"{{text}}","from":"{{sender}}","reference":"{{reference}}"}
SMS_HTTP_API_KEY=<cle>          # envoyé en « Authorization: Bearer <cle> »
SMS_HTTP_SUCCESS_PATH=status    SMS_HTTP_SUCCESS_EQUALS=queued
SMS_HTTP_ID_PATH=data.messageId SMS_HTTP_COST_PATH=data.cost
```

Profil de référence : `SMS_HTTP_PROFILE=africastalking` (formulaire, en-tête `apiKey`, succès `SMSMessageData.Recipients.0.status = Success`) — **à valider avec le fournisseur retenu**. Classement : 2xx + succès -> envoyé ; 408 / 425 / 429 / 5xx / coupure / délai -> reprise (`Retry-After` respecté) ; autre 4xx ou succès non satisfait -> échec définitif. Les accusés de remise du fournisseur se branchent sur `POST /webhooks/:tenantId/delivery-status` (corps signé HMAC-SHA256, en-tête `x-notifications-signature: sha256=<hex>`).

## Tests

```bash
pnpm --filter @ecoledigitale/api exec vitest run src/modules/notifications                      # unitaires + canaux (SMTP / HTTP simulés)
ED_PG_IMAGE=postgres:17-alpine node packages/database/scripts/with-postgres.mjs --root apps/api src/modules/notifications   # + intégration
ED_PG_IMAGE=postgres:17-alpine node packages/database/scripts/with-postgres.mjs --root apps/api test/adapters/notifications.integration.test.ts   # adaptateurs réels
pnpm check:boundaries && pnpm --filter @ecoledigitale/api type-check:v2 && pnpm test:isolation
```

## Limites connues

Q-18 (fournisseur SMS), Q-19 (consentement par défaut), Q-20 (message direct non lu), Q-21 (rebonds asynchrones), Q-26 à Q-28 (paliers, unités des seuils, rôle RH) dans `specs/v2/016-communications/open-questions.md`. Livraison « au moins une fois » (un worker tué entre l'envoi et la consignation peut renvoyer : le fournisseur reçoit la même clé d'idempotence). L'adaptateur de résultats FINAL (deux périodes consécutives) n'est éprouvé que sur « rien de clôturé » : la comparaison est testée avec un port simulé.
