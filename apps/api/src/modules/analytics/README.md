# Module `analytics` — pilotage de la direction et du propriétaire (spec v2/025)

Read-models **tenant-isolés** (effectifs, présences, résultats FINAL, scolarité, trésorerie, paie, charge d'enseignement) alimentés par les **événements** des autres modules, avec fraîcheur explicite (`asOf`), reconstruction idempotente et API `/api/v1/analytics/*`. Spécification : `specs/v2/025-analytics/` (`spec.md`, `data-model.md`, `plan.md`, `parity.md`).

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

22 tables, toutes `tenant_id` + RLS forcée (allowlist d'isolation vide) : file et fraîcheur (`refresh_requests`, `refresh_state`, `settings`), dimensions (`dim_scope`, `dim_year`, `dim_period`, `dim_classroom`), faits (`enrollment_facts`, `result_facts`, `result_line_facts`, `result_scopes`, `attendance_daily`, `staff_presence_facts`, `finance_summary`, `finance_by_group`, `finance_by_learner`, `finance_aged`, `finance_aged_learner`, `collections_daily`, `cash_session_facts`, `payroll_status_facts`, `teaching_load_facts`). Détail : `specs/v2/025-analytics/data-model.md`.

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
| `GET /freshness`, `GET/PUT /settings`, `POST /rebuild` | `analytics.read` / `.settings.manage` / `.rebuild` | état des lectures, réglages d'affichage, reconstruction |
| `GET /export/<jeu>.csv` | permission du jeu + `analytics.export` | CSV (BOM, `;`, anti-injection), audité |

Toutes les routes exigent la feature `analytics.direction`. Les réponses portent `meta` (`asOf`, `stale`, `gaps`, périmètre) ; `Cache-Control: private, max-age=15`, `ETag` et 304.

## Événements

Publiés : `analytics.snapshot.refreshed` (seulement si le contenu a changé), `analytics.rebuild.requested`. Consommés (6 abonnés, voir `domain/refresh-plan.ts`) : `academic.*` (année, période, classe, inscription), `people.student.*` / `teaching_assignment.*`, `results.period.closed|reopened`, `results.decision.confirmed`, `attendance.session.*` / absences / congés, `finance.*` (factures, paiements, remboursements, caisse), `payroll.*`.

## Jobs

`analytics.process-refreshes` (toutes les 30 s) exécute les demandes échues (reprise exponentielle, 5 tentatives) ; `analytics.nightly-rebuild` (03:10) reconstruit chaque tenant.

## Tests

- `test/analytics.test.ts` : manifeste, plan événement -> demandes, CSV, mesures, plugin chargé par le registre (401/403/feature, 304, audit de la paie).
- `test/refresh.integration.test.ts` (Postgres) : année simulée par ports en mémoire (`test/support/world.ts`), cohérence read-model / source, idempotence, coalescence, panne et reprise, source absente, isolation tenant et campus.
- `apps/api/test/adapters/analytics.integration.test.ts` (Postgres) : VRAIS modules (règles nationales comprises), faits comparés à un SQL direct sur les schémas sources.

```bash
pnpm --filter @ecoledigitale/api exec vitest run src/modules/analytics
ED_PG_IMAGE=postgres:17-alpine node packages/database/scripts/with-postgres.mjs --root apps/api src/modules/analytics test/adapters/analytics
```
