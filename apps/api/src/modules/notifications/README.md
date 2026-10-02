# Module `notifications` — canaux externes, gabarits, journal, consentement, relances et alertes

Spec : `specs/v2/016-communications/` (partie B : `spec.md` §17 à §30, `data-model.md`, `plan.md`, `parity.md` §6, `open-questions.md` Q-18 à Q-29). Schéma Postgres `notifications`, migration **2600** (plage 2600-2699). Packs PRIMARY, SECONDARY, HIGHER, VIRTUAL. `dependsOn: ["messaging"]` (canal in-app, par son `index.ts`) ; destinataires, factures, résultats arrivent par des **ports**. **Le worker est indispensable à l'envoi.**

## Ce que fait le module

| Domaine | Fonctions |
|---|---|
| Canaux | `EMAIL` (SMTP, nodemailer, rebonds, pied de page de conformité), `SMS` (**Orange SMS API** par `NOTIFICATIONS_SMS_PROVIDER=orange` — décision du 2026-10-02 — ou adaptateur HTTP **générique** configurable), `WHATSAPP` (WaSender), `PUSH` (Web Push VAPID, un abonnement par appareil), `IN_APP` (messaging). Un canal non configuré **échoue explicitement** ; simulation seulement demandée, hors production |
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

Publiés (`{ v: 1, … }`, **jamais de contenu ni d'adresse**) : `notifications.delivery.failed`, `.delivery.bounced`, `.consent.changed`, `.template.published`, `.rule.updated`, `.urgent.sent`. Consommés : `finance.invoice.issued|overdue|paid`, `finance.payment.completed`, `attendance.absence.recorded|late.recorded|alert.triggered`, `reportcards.report_card.published`, `scheduling.occurrence.cancelled`, `messaging.announcement.published`, `people.staff_qualification.expiring`, `payroll.payslip.notification_requested`, et, ajoutés : `finance.payment.reconciliation_needed|refund.reconciliation_needed` (alerte économat + direction), `stateassign.reconciliation.discrepancy|receivable.overdue|control.due|control.anomaly_detected` (alerte économat, direction pour les contrôles), `schoollife.measure.notified|convocation.sent|convocation.cancelled` (tuteurs, texte neutre), `admissions.application.submitted|offer.issued` (responsable du dossier de candidature) (contrats : `apps/api/test/events-contracts/notifications.contracts.ts`).

### Abonnés ajoutés : alertes internes, vie scolaire, admissions

| Événement | Règle livrée (clé) | État par défaut | Gabarit | Destinataires |
|---|---|---|---|---|
| `finance.payment.reconciliation_needed` / `finance.refund.reconciliation_needed` | `finance.payment_reconciliation_needed`, `finance.refund_reconciliation_needed` | **active** | `reconciliation_needed` (interne) | rôles `econome`, `directeur` ; IN_APP + e-mail ; lien `/v2/finance/payments/pending` |
| `stateassign.reconciliation.discrepancy` | `stateassign.reconciliation_discrepancy` | **active** | `stateassign_alert` (interne) | rôle `econome` |
| `stateassign.receivable.overdue` | `stateassign.receivable_overdue` | **active** | `stateassign_alert` | rôle `econome` (une alerte par créance) |
| `stateassign.control.due` / `anomaly_detected` | `stateassign.control_due`, `stateassign.control_anomaly` | **active** | `stateassign_alert` | rôles `econome`, `directeur` |
| `schoollife.measure.notified` | `schoollife.measure_notified.guardians` | **désactivée** | `schoollife_measure_notified` | tuteurs de l'élève |
| `schoollife.convocation.sent` / `cancelled` | `schoollife.convocation_sent.guardians`, `schoollife.convocation_cancelled.guardians` | **désactivées** | `schoollife_convocation` | tuteurs de l'élève |
| `admissions.application.submitted` | `admissions.application_received.applicant` | **désactivée** | `admissions_application_received` | responsable du dossier (port `applicants`) ; e-mail, WhatsApp, SMS en `FIRST_REACHABLE` |
| `admissions.offer.issued` | `admissions.offer_issued.applicant` | **désactivée** | `admissions_offer_issued` | idem |

- **Aucune donnée sensible** : les alertes internes ne nomment aucun élève et n'incluent ni message du fournisseur ni référence d'acte (montants, libellés neutres, dates, jours de retard) ; les messages de vie scolaire ne disent ni la nature de la mesure, ni sa gravité, ni ses dates, ni le motif de la convocation (le lecteur ne lit pas `reasonKind` / `kind` / `severityCode`) ; une mesure confidentielle ou non visible des tuteurs est ignorée ; admissions : aucun nom, aucun lien secret.
- **Pourquoi vie scolaire et admissions sont désactivées par défaut** : `schoollife` informe DÉJÀ les tuteurs lui-même au moment où il publie ces événements (port `NotificationPort` -> envoi manuel, qui utilise désormais les gabarits dédiés) : activer ces règles doublerait le message, et `convocation.cancelled` ne dit pas si la convocation avait été envoyée. `admissions` a son propre canal (`ApplicantNotifier`, échec fermé tant qu'il n'est pas câblé) : activer la règle ET câbler ce canal enverrait deux fois. Un établissement les active par `PUT /rules/:key` après arbitrage.
- **Codes de gabarit** : snake_case (`schoollife_convocation`, `schoollife_measure_notified`) — la base impose `^[a-z][a-z0-9_]+$` ; ce sont les gabarits dédiés `schoollife.convocation` / `schoollife.measure.notified` demandés par la spec.
- **Idempotence** : une alerte de rapprochement par élément et par motif ; une alerte de créance par créance ; une décision ou une convocation par identifiant ; un rejeu ne double rien.
- **Admissions : coordonnées par port** : les événements ne portent aucune donnée personnelle ; l'audience `APPLICANT_GUARDIANS` interroge le port `applicants` (adaptateur `platform/adapters/notifications-admissions.ts` : cas d'usage public `getApplication` d'admissions, responsable principal à défaut premier tuteur). Port absent = échec fermé `notifications.port_unavailable` (le worker rejoue).
- **Manque connu** : il n'existe pas d'événement `admissions.interview.*` : la convocation d'entretien d'admission ne peut pas être consommée ; elle reste envoyée par `admissions` lui-même (à demander au propriétaire d'admissions : publier `admissions.interview.scheduled`).

## Ports et adaptateurs

| Port | Fournisseur (`platform/adapters`) |
|---|---|
| `RecipientDirectory` (élèves + tuteurs avec ou sans compte, classe, personnel, titulaires de rôles, comptes ; **coordonnées**) | `people-notifications.ts` : people (`listNotificationContactsOf*`, extension additive), academic, rbac, iam |
| `OverdueSource` (échéances en retard, relues avant l'envoi) | `sources-notifications.ts` : finance (`listOverdueInstallments`, extension additive) |
| `GradeSource` (deux résultats FINAL consécutifs) | `sources-notifications.ts` : results + academic + people |
| `TeachingLoadSource` | `sources-notifications.ts` : people + academic |
| `AnnouncementFeed` | `sources-notifications.ts` : messaging (`readAnnouncementForDelivery`, extension additive) |
| `ApplicantDirectory` (responsable d'un dossier de candidature) | `notifications-admissions.ts` : admissions (`getApplication`, API publique existante) |
| `ChannelAdapter` / `ChannelRegistry` | `infrastructure/channels/*` (réalisation du port `NotificationChannel` de messaging ; pont `toMessagingChannel`) |

Registre : `app.notificationsPorts` (API, `registerNotificationsPorts`) ; `setNotificationsWorkerPorts` (worker, branché par `installWorkerAdapters`). Port absent = échec fermé `notifications.port_unavailable`.

## Configuration (voir `.env.example`)

SMTP : `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL`, `SMTP_FROM_NAME` — `NOTIFICATIONS_UNSUBSCRIBE_SECRET` (obligatoire en production pour l'e-mail), `NOTIFICATIONS_WEBHOOK_SECRET`, `NOTIFICATIONS_DEFAULT_SENDER_NAME`, `NOTIFICATIONS_SIMULATE` (hors production), `NOTIFICATIONS_DISPATCH_BATCH`, `NOTIFICATIONS_LEASE_MS`, `NOTIFICATIONS_MAX_PENDING`, `V2_APP_BASE_URL` — SMS : `NOTIFICATIONS_SMS_PROVIDER` (`http` par défaut, `orange`, `none`), `ORANGE_SMS_*` (voir ci-dessous), `SMS_HTTP_PROFILE`, `SMS_HTTP_URL`, `SMS_HTTP_METHOD`, `SMS_HTTP_CONTENT_TYPE`, `SMS_HTTP_BODY`, `SMS_HTTP_HEADERS`, `SMS_HTTP_API_KEY[_HEADER|_PREFIX]`, `SMS_HTTP_USERNAME`, `SMS_HTTP_SENDER_ID`, `SMS_HTTP_SUCCESS_PATH|_EQUALS`, `SMS_HTTP_ID_PATH`, `SMS_HTTP_COST_PATH|_MULTIPLIER|_CURRENCY`, `SMS_HTTP_ERROR_PATH`, `SMS_HTTP_TIMEOUT_MS` — WhatsApp : `WASENDER_API_KEY`, `WASENDER_API_BASE_URL`, `WASENDER_SESSION[_NAME]`, `WASENDER_TIMEOUT_MS`, `WASENDER_SKIP_STATUS_CHECK`, `WHATSAPP_PROVIDER` — Push : `NOTIFICATIONS_VAPID_PUBLIC_KEY`, `NOTIFICATIONS_VAPID_PRIVATE_KEY`, `NOTIFICATIONS_VAPID_SUBJECT`.

### SMS : Orange SMS API (adaptateur dédié)

`NOTIFICATIONS_SMS_PROVIDER=orange` branche `infrastructure/channels/sms-orange.ts` derrière le même port `ChannelAdapter`. **Désactivé par défaut** : tant que `ORANGE_SMS_MODE` n'est pas `sandbox` ou `live`, le canal échoue explicitement (`channel_not_configured`).

| Mode | Effet |
|---|---|
| `disabled` (défaut) | échec explicite, aucun appel |
| `sandbox` | aucun appel réseau : valide numéro, longueur, consigne `SIMULATED` ; **refusé en production** |
| `live` | OAuth2 client-credentials (`POST {base}/oauth/v3/token`, jeton mis en cache, un seul appel concurrent, renouvelé sur 401 avec une reprise) puis `POST {base}/smsmessaging/v1/outbound/{tel:+expéditeur}/requests` |

Variables : `ORANGE_SMS_CLIENT_ID` / `ORANGE_SMS_CLIENT_SECRET` (ou `ORANGE_SMS_AUTHORIZATION_HEADER`), `ORANGE_SMS_SENDER` (numéro expéditeur déclaré chez Orange), `ORANGE_SMS_SENDER_NAME`, `ORANGE_SMS_API_BASE_URL`, `ORANGE_SMS_TOKEN_URL`, `ORANGE_SMS_TIMEOUT_MS`, `ORANGE_SMS_DEFAULT_DIAL_CODE` (225), `ORANGE_SMS_ALLOW_INTERNATIONAL`, `ORANGE_SMS_MAX_SEGMENTS` (3), `ORANGE_SMS_UNIT_COST` (XOF par segment, sans valeur par défaut : aucun tarif n'est supposé), `ORANGE_SMS_MAX_PER_MINUTE`, `ORANGE_SMS_QUOTA_PAUSE_SECONDS` (900).

- **Secrets** : variables d'environnement de la plateforme (le `SecretStorePort` appartient à `finance` et sert aux identifiants marchands PAR établissement ; le contrat Orange est unique pour la plateforme). Rien en dur, rien dans les journaux : l'adaptateur n'écrit aucun log, les messages d'erreur sont épurés (numéros masqués) et la redaction pino du noyau masque déjà `secret`, `token`, `authorization`, `credential`, `phone`.
- **Numéros** : normalisation E.164 (`+225` + 10 chiffres, « 0 » initial conservé pour la Côte d'Ivoire) ; un autre indicatif est refusé tant que `ORANGE_SMS_ALLOW_INTERNATIONAL=1` n'est pas posé (maîtrise du coût).
- **Classement** : 201 -> envoyé (identifiant = dernier segment de `resourceURL`) ; 401 -> jeton renouvelé puis une reprise, sinon `orange_auth_failed` ; 408 / 425 / 429 / 5xx / coupure / délai -> reprise (`Retry-After` respecté) ; refus « quota / forfait épuisé » -> reprise différée **et pause locale** (les envois suivants n'appellent pas Orange) ; autre 4xx -> échec définitif.
- **Coût et quota** : plafond par établissement et par canal déjà appliqué par le module (`dailyCaps.SMS`, plafond par destinataire) ; l'adaptateur ajoute le refus des messages de plus de `ORANGE_SMS_MAX_SEGMENTS` segments (GSM 7 bits / UCS-2), un plafond local par minute et le coût estimé (`segments x ORANGE_SMS_UNIT_COST`) au journal.
- **Idempotence** : l'API Orange n'a pas de clé d'idempotence ; un message déjà accepté n'est pas renvoyé par le même processus (mémoire bornée), mais entre processus, ou après un délai dépassé sans réponse, la livraison reste « au moins une fois » (un SMS peut doubler, jamais manquer).
- Les chemins, corps et codes d'erreur Orange sont à **valider avec la documentation et le contrat Orange** de l'établissement avant le premier envoi réel (aucun compte ni appel réel n'a été utilisé : tests contre un serveur local factice, `test/channels/sms-orange.test.ts`).

### SMS : adaptateur HTTP générique

Adaptateur de repli (`NOTIFICATIONS_SMS_PROVIDER` absent ou `http`) ; le fournisseur retenu est Orange (voir ci-dessus). Le **modèle de requête** (URL, méthode, en-têtes, corps JSON ou formulaire avec jetons `{{to}}`, `{{toDigits}}`, `{{text}}`, `{{sender}}`, `{{reference}}`, `{{username}}`) et la **lecture de la réponse** (chemin du critère de succès, de l'identifiant de message, du coût, du message d'erreur) sont des variables d'environnement. Exemple (API JSON) :

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

Q-18 (fournisseur SMS : **tranchée le 2026-10-02, Orange SMS API** ; reste à valider chemins, codes d'erreur, quota et tarifs avec le contrat Orange), Q-19 (consentement par défaut), Q-20 (message direct non lu), Q-21 (rebonds asynchrones), Q-26 à Q-28 (paliers, unités des seuils, rôle RH) dans `specs/v2/016-communications/open-questions.md`. Livraison « au moins une fois » (un worker tué entre l'envoi et la consignation peut renvoyer : le fournisseur reçoit la même clé d'idempotence). L'adaptateur de résultats FINAL (deux périodes consécutives) n'est éprouvé que sur « rien de clôturé » : la comparaison est testée avec un port simulé.
