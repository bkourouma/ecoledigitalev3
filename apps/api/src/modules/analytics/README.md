# Module `analytics` — pilotage de la direction et du propriétaire (spec v2/025)

Read-models **tenant-isolés** (effectifs, présences, résultats FINAL, scolarité, trésorerie, paie, charge d'enseignement, **entonnoir d'admission, vie scolaire agrégée**) alimentés par les **événements** des autres modules, avec fraîcheur explicite (`asOf`), reconstruction idempotente et API `/api/v1/analytics/*`. Sur ces read-models : **comparaisons** entre périodes ou années et **alertes de direction configurables** livrées par `notifications` (partie B de la spec). Spécification : `specs/v2/025-analytics/` (`spec.md`, `data-model.md`, `plan.md`, `parity.md`).

**Aucune formule métier** : moyennes, rangs, crédits, décisions et validation viennent des résultats FINAL de `results` ; recouvrement, retards et balance âgée des requêtes de `finance` ; classification des présences et des inscriptions en scolarité d'`attendance` et d'`academic`. Ce module compte, regroupe et présente. Les seuils de feux (présence, recouvrement) sont des **réglages d'affichage** (`analytics.settings`), jamais des règles.

## Principe

```
événement (outbox) ─► abonné ─► analytics.refresh_requests (coalescée) ─► job process-refreshes
                                                                          │ lecture de la source par PORT
                                                                          ▼
                                       remplacement du périmètre + refresh_state (+ analytics.snapshot.refreshed)
```

- `analytics` n'importe aucun module et n'écrit aucun SQL vers leurs schémas ; ses **ports sources** (`application/ports.ts`) sont implémentés par `platform/adapters/analytics-sources.ts` sur l'API publique des fournisseurs.
- Un port non branché = demande `UNAVAILABLE` et manque déclaré dans la réponse (`meta.gaps`), jamais une erreur ni un zéro.
- Reconstruction (`rebuildTenant`, job nocturne, `POST /rebuild`) = même chemin de lecture, tout périmètre réécrit ; deux reconstructions donnent le **même contenu**.

## Tables (schéma `analytics`, migration `1600_analytics_init.sql`)

28 tables, toutes `tenant_id` + RLS forcée (allowlist d'isolation vide) : file et fraîcheur (`refresh_requests`, `refresh_state`, `settings`), dimensions (`dim_scope`, `dim_year`, `dim_period`, `dim_classroom`), faits (`enrollment_facts`, `result_facts`, `result_line_facts`, `result_scopes`, `attendance_daily`, `staff_presence_facts`, `finance_summary`, `finance_by_group`, `finance_by_learner`, `finance_aged`, `finance_aged_learner`, `collections_daily`, `cash_session_facts`, `payroll_status_facts`, `teaching_load_facts`) ; migration `1601_analytics_alerts_indicators.sql` : `admissions_campaign_facts`, `admissions_stage_facts`, `schoollife_facts`, `alert_rules`, `alert_events`, `alert_notifications`, et la colonne `result_scopes.rules_source_kind` (provenance des règles). Détail : `specs/v2/025-analytics/data-model.md`.

## Routes (`/api/v1/analytics`)

| Route | Permission | Contenu |
|---|---|---|
| `GET /scopes` | `analytics.read` | établissements, campus, années, périodes, classes, année par défaut |
| `GET /overview` | `analytics.read` | effectifs, présence du jour, moyenne générale, validation, enseignants présents |
| `GET /enrollment` | `analytics.read` | répartitions (statut, sexe, niveau, financement, campus, classe), redoublants, admissions |
| `GET /attendance` | `analytics.attendance.read` | présence par jour / classe, personnel |
| `GET /pedagogy/results` | `analytics.pedagogy.read` | résultats FINAL par classe, matière, période, distribution, décisions |
| `GET /pedagogy/teaching-load` | `analytics.pedagogy.read` | charge d'enseignement |
| `GET /finance/summary`, `/finance/receivables` | `analytics.finance.read` | scolarité, créances par classe / apprenant |
| `GET /treasury/collections`, `/aged`, `/cash` | `analytics.treasury.read` | encaissements, créances âgées, écarts de caisse |
| `GET /payroll/mass` | `analytics.payroll.read` (**sensible**, MFA, audité) + feature `analytics.payroll-insights` | masse salariale |
| `GET /charges` | `analytics.charges.read` | manque déclaré (aucun module de charges) |
| `GET /admissions/funnel` | `analytics.admissions.read` | entonnoir d'admission : dossiers par statut et par étape, places (comptages, aucun candidat) |
| `GET /schoollife/summary` | `analytics.schoollife.read` | 4 comptages de vie scolaire (confidentialité STANDARD) |
| `GET /compare/enrollment`, `/compare/attendance`, `/compare/results`, `/compare/finance` | `analytics.read`, `.attendance.read`, `.pedagogy.read`, `.finance.read` | comparaison entre deux années, fenêtres ou périodes (écart, variation) |
| `GET /alerts/metrics`, `GET /alerts/rules`, `GET /alerts`, `GET /alerts/:id` | `analytics.alerts.read` (+ permission de données de l'indicateur) | catalogue, règles, alertes (actives et historique), détail et notifications émises |
| `POST /alerts/rules`, `PUT /alerts/rules/:id` | `analytics.alerts.manage` (+ permission de données) | configuration (seuils, rôles destinataires, fréquence, périmètre) |
| `POST /alerts/:id/acknowledge` | `analytics.alerts.acknowledge` (+ permission de données) | accusé de réception avec note |
| `GET /freshness`, `GET/PUT /settings`, `POST /rebuild` | `analytics.read` / `.settings.manage` / `.rebuild` | état des lectures, réglages d'affichage, reconstruction |
| `GET /export/<jeu>.csv` | permission du jeu + `analytics.export` | CSV (BOM, `;`, anti-injection), audité |

Toutes les routes exigent la feature `analytics.direction`. Une alerte ou une règle hors du périmètre de l'utilisateur, d'un indicateur dont il n'a pas la permission de données, ou d'un identifiant mal formé répond le **même 404**. Les réponses portent `meta` (`asOf`, `stale`, `gaps`, périmètre) ; `Cache-Control: private, max-age=15`, `ETag` et 304.

## Événements

Publiés : `analytics.snapshot.refreshed` (seulement si le contenu a changé), `analytics.rebuild.requested`, **`analytics.alert.raised`** (consommé par `notifications`), `analytics.alert.acknowledged`, `analytics.alert.resolved`. Consommés (8 abonnés, dont `admissions.*` et `schoollife.*` pour les nouveaux genres `ADMISSIONS` et `SCHOOLLIFE` ; voir `domain/refresh-plan.ts`) : `academic.*` (année, période, classe, inscription), `people.student.*` / `teaching_assignment.*`, `results.period.closed|reopened`, `results.decision.confirmed`, `attendance.session.*` / absences / congés, `finance.*` (factures, paiements, remboursements, caisse), `payroll.*`.

## Jobs

`analytics.process-refreshes` (toutes les 30 s) exécute les demandes échues (reprise exponentielle, 5 tentatives) ; `analytics.nightly-rebuild` (03:10) reconstruit chaque tenant ; **`analytics.evaluate-alerts`** (toutes les 15 minutes) évalue les règles d'alerte de chaque tenant sur les read-models.

## Alertes de direction (partie B)

```
règle (seuils, rôles, fréquence) ─► job analytics.evaluate-alerts ─► read-models (fraîcheur exigée) ─► alerte (épisode)
                                                                       │ insertion alert_notifications (clé UNIQUE règle:gravité:créneau)
                                                                       ▼
                                          analytics.alert.raised (outbox, même transaction) ─► notifications ─► destinataires (par rôle)
```

- **Aucun envoi direct** : `notifications` (règle livrée `analytics.alert_raised`, gabarit `analytics_alert`) résout les titulaires des rôles de l'alerte et applique préférences, consentements, heures calmes et plafonds. L'établissement peut désactiver la règle de livraison ou en changer les canaux (`PUT /notifications/rules/analytics.alert_raised`).
- **Rien n'est évalué** sur une donnée jamais lue, périmée, non branchée ou en échec, ni sur une valeur non mesurée ; un taux de validation issu de règles de démonstration n'est pas mesuré. Une alerte active n'est donc jamais résolue « par défaut ».
- **Anti-doublon** : une alerte active par règle (index unique partiel), une notification par (règle, gravité, créneau) (clé unique), évaluations concurrentes sérialisées par verrou sur la règle.
- **Visibilité** : indicateur permis (permission de données) ET périmètre (établissement / campus) de l'utilisateur ; un utilisateur limité à un campus ne crée pas de règle sur l'établissement entier.
- Les valeurs notifiées sont des taux, montants et comptages agrégés (libellé de catalogue, jamais de nom). Le gestionnaire qui choisit les rôles destinataires d'un indicateur financier est responsable de leur droit d'en connaître la valeur (la permission `analytics.finance.read` est exigée de LUI à la création, pas des destinataires).

## Permissions à attribuer aux rôles (à faire dans `rbac/templates/system-roles.ts`, hors de ce module)

Les modèles `owner` et `directeur` (`*`, avec exclusions) reçoivent automatiquement les 5 nouvelles permissions : **rien à faire**. Pour les autres rôles, proposition (à arbitrer avec le propriétaire du produit, cohérente avec la décision 4 de la spec §9 : l'économe et le directeur des études n'ont pas encore de droits de lecture de données `analytics.*`) :

| Permission | Rôle(s) proposé(s) | Remarque |
|---|---|---|
| `analytics.alerts.read` | `econome`, `directeur_etudes` | voir les alertes qui les concernent ; chaque alerte reste filtrée par la permission de données de son indicateur |
| `analytics.alerts.acknowledge` | `econome`, `directeur_etudes` | utile seulement avec la permission de données correspondante |
| `analytics.alerts.manage` | aucun autre que `owner` / `directeur` | choisit des destinataires et des seuils : acte de direction |
| `analytics.admissions.read` | `admissions_officer`, `directeur_etudes` | comptages d'admission uniquement |
| `analytics.schoollife.read` | `directeur_etudes` | comptages STANDARD uniquement (déjà moins que `schoollife.read.all`) |
| permissions de données à ajouter pour que ces alertes servent | `econome` : `analytics.finance.read`, `analytics.treasury.read` ; `directeur_etudes` : `analytics.pedagogy.read`, `analytics.attendance.read` | **décision 4 de la spec §9 à lever** |

Aucune de ces permissions n'est `sensitive` : la masse salariale (`analytics.payroll.read`) reste la seule permission sensible du module.

## Tests

- `test/analytics.test.ts` : manifeste, plan événement -> demandes, CSV, mesures, plugin chargé par le registre (401/403/feature, 304, audit de la paie).
- `test/refresh.integration.test.ts` (Postgres) : année simulée par ports en mémoire (`test/support/world.ts`), cohérence read-model / source, idempotence, coalescence, panne et reprise, source absente, isolation tenant et campus.
- `apps/api/test/adapters/analytics.integration.test.ts` (Postgres) : VRAIS modules (règles nationales comprises), faits comparés à un SQL direct sur les schémas sources ; provenance des règles lue de `rules` ; admissions et vie scolaire lues par les API publiques.
- `test/alerts.test.ts` : gravité (franchissement strict), cohérence des seuils, créneaux de fréquence, catalogue, contrats, neutralisation CSV, garde-fous HTTP (permissions, 404 uniforme, validation).
- `test/alerts.integration.test.ts` (Postgres) : cycle de vie d'une alerte (notification, anti-doublon concurrent, rappel, accusé, montée en gravité, résolution, historique), donnée périmée / en échec / non mesurée / règles de démonstration, isolation A/B, périmètre campus, permissions de données, entonnoir, vie scolaire, comparaisons, export CSV neutralisé, job.
- `apps/api/src/modules/notifications/test/integration/analytics-alert.integration.test.ts` (Postgres) : livraison par `notifications` (rôles de l'alerte, préférences et consentements respectés, déduplication, désactivation par l'établissement, isolation).

```bash
pnpm --filter @ecoledigitale/api exec vitest run src/modules/analytics
ED_PG_IMAGE=postgres:17-alpine node packages/database/scripts/with-postgres.mjs --root apps/api src/modules/analytics test/adapters/analytics
```
