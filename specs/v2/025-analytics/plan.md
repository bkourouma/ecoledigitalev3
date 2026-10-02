# Plan d'implémentation — 025-analytics

## 1. Architecture

```
 modules sources (academic, people, results, attendance, finance, payroll, tenancy)
        │ événements (outbox)                    ▲ API publique (index.ts) — lectures, appels SÉQUENTIELS
        ▼                                        │
 analytics/subscribers.ts  ──►  analytics.refresh_requests  ──►  job analytics.process-refreshes (30 s)
   (6 abonnés, idempotents)      (une demande coalescée par        │
                                  genre × périmètre)               ▼
                                                      application/refresh.ts
                                                      lecture de la source par PORT (hors transaction)
                                                      → empreinte → remplacement du périmètre + refresh_state
                                                        + analytics.snapshot.refreshed   (UNE transaction)
 job analytics.nightly-rebuild / POST /rebuild ─► application/rebuild.ts (même chemin de lecture, force)

 HTTP /api/v1/analytics/*  ─►  application/queries.ts  ─►  infrastructure/read-repository.ts (SQL du seul schéma analytics)
                                  + scope.ts (périmètre utilisateur, asOf, gaps)
 Web /v2/owner|direction/*  ─►  apps/web/src/platform/v2/analytics.ts (client typé par packages/contracts/src/v2/analytics.ts)
```

- **Ports sources** (`application/ports.ts`) : `scopes`, `calendar`, `enrollments`, `results`, `attendance`, `staffPresence`, `finance`, `payroll`, `teachingLoad`. `analytics` n'importe aucun autre module (`check:boundaries`). Les **adaptateurs** `platform/adapters/analytics-sources.ts` les construisent sur l'API publique des fournisseurs ; ils sont branchés par `wireApiPorts` (`registerAnalyticsPorts`) et `installWorkerAdapters` (`setAnalyticsWorkerPorts`). Port absent ⇒ `UNAVAILABLE` + manque déclaré, jamais une erreur 500.
- **Ports en mémoire** (`InMemoryAnalyticsWorld`) : mêmes cas d'usage, source simulée ; servent aux tests de cohérence et aux scénarios d'année simulée.
- **Contrats** : `packages/contracts/src/v2/analytics.ts` (requêtes, réponses, permissions, features) réexporté par `v2/index.ts`.

## 2. Organisation du code

```
apps/api/src/modules/analytics/
  manifest.ts index.ts subscribers.ts jobs.ts README.md
  migrations/1600_analytics_init.sql
  domain/        types.ts events.ts refresh-plan.ts metrics.ts csv.ts display-thresholds.ts   (purs)
  application/   ports.ts port-registry.ts deps.ts refresh.ts rebuild.ts requests.ts
                 scope.ts queries.ts admin.ts exports.ts
  infrastructure/ sql.ts requests-repository.ts facts-repository.ts dims-repository.ts
                 read-repository.ts in-memory-sources.ts
  http/plugin.ts
  test/          analytics.test.ts (unitaires + plugin par le registre)
                 refresh.integration.test.ts (année simulée, cohérence, idempotence, flux)
                 support/world.ts (année simulée déterministe)
apps/api/src/platform/adapters/analytics-sources.ts      (+ kit.ts : `payroll`, index.ts : câblage)
apps/api/test/adapters/analytics.integration.test.ts     (VRAIS modules, SQL direct sur les sources)
apps/web/src/platform/v2/analytics.ts
apps/web/src/app/v2/direction/**  apps/web/src/app/v2/owner/**
```

## 3. Jalons (un commit par lot vert)

| Lot | Contenu | Preuve |
|---|---|---|
| 0 | Gabarit `pnpm module:new analytics`, plage 1600-1699 | gabarit vert avant modification |
| 1 | Specs + DDL + domaine + infrastructure + file/rafraîchissement/reconstruction + lectures + HTTP + contrats | `type-check:v2`, `check:boundaries`, tests du module (unitaires + intégration) |
| 2 | Adaptateurs de plateforme + câblage API/worker + test sur vrais modules | `test/adapters/analytics.integration.test.ts` |
| 3 | Rôles : justification de la permission sensible (module `rbac`, correctif minimal) | `rbac` : `system-roles.test.ts` |
| 4 | Client web typé + écrans + i18n | `pnpm test` web, `tsc` sans erreur sur les nouveaux fichiers |
| 5 | Barrières globales | `check:boundaries`, `check:secrets`, `test:isolation`, suite `apps/api`, `apps/web` |

## 4. Stratégie de tests

1. **Unitaires** (sans base) : manifeste ↔ contrats ; table événement → demandes (y compris charges malformées) ; CSV (BOM, formules) ; mesures (taux, histogramme, empreinte) ; plugin chargé **par le registre** (401/403/feature, 304, validation).
2. **Intégration, année simulée** : reconstruction complète ; chaque agrégat API = calcul direct sur la source simulée (vue d'ensemble, effectifs, présences, résultats, finance, trésorerie, paie, charge) ; idempotence (contenu identique, aucun nouvel événement) ; coalescence (3 événements → 1 lecture) ; période rouverte ; source en panne (reprise, `asOf` conservé) ; source non branchée (`UNAVAILABLE`, `NOT_WIRED`) ; isolation tenant et périmètre campus.
3. **Intégration, vrais modules** : école supérieure complète (notes publiées, clôture avec les vraies règles, factures et paiements, séance et appel soumis, pointage du personnel) ; les faits d'`analytics` sont comparés à un SQL direct sur `results`, `finance`, `attendance`, `academic`, `people`.
4. **Isolation** : `assertTenantIsolation` sur les 22 tables ; `pnpm test:isolation` global.

## 5. Risques et parades

| Risque | Parade |
|---|---|
| Lecture lourde d'une source | lectures hors transaction d'analytics, par périmètre ; coalescence ; reconstruction nocturne ; plafonds (400 jours, pages) |
| `Promise.all` sur les lectures de modules (savepoints) | appels séquentiels dans les adaptateurs (règle platform-assembly §11) |
| Dérive entre l'API et le web | schémas Zod partagés ; client typé |
| Paie : fuite de salaires | permission `sensitive` (MFA), feature dédiée, audit des lectures et exports |
| Seuils de feux perçus comme des règles | valeurs d'affichage par défaut, réglables, jamais dans un calcul |

---

# Partie B — plan d'implémentation (indicateurs transverses et alertes)

| Lot | Contenu | Preuve |
|---|---|---|
| B1 | contrats (`analytics.ts` : admissions, vie scolaire, comparaisons, alertes, charges d'événements), migration 1601, domaine pur (`alert-metrics`, `alerts`) | `test/alerts.test.ts` (règles pures, catalogue, contrats, garde-fous HTTP) |
| B2 | ports `admissions` et `schoollife`, adaptateurs de plateforme, provenance des règles, genres `ADMISSIONS` / `SCHOOLLIFE` (refresh, reconstruction, abonnés) ; fonction publique additive `schoollife.getAggregateCounts` | `test/adapters/analytics.integration.test.ts` (vrais modules) |
| B3 | indicateurs (`application/indicators.ts`), alertes (`application/alerts.ts`, `alert-values.ts`, `alerts-repository.ts`), routes, exports, job `analytics.evaluate-alerts` | `test/alerts.integration.test.ts` (Postgres : cycle de vie, anti-doublon concurrent, périmé / en échec / non mesuré, A/B, périmètre, permissions, 404 uniforme, CSV, job) |
| B4 | livraison par `notifications` : déclencheur, lecteur, gabarit `analytics_alert`, règle livrée, rôles de l'alerte | `notifications/test/integration/analytics-alert.integration.test.ts`, contrat d'événement |
| B5 | écrans `/v2/analytics/*`, client typé, i18n `v2Analytics`, bandeau de démonstration | `apps/web/src/app/v2/analytics/_components/Screens.test.tsx`, `messages-coverage.test.ts`, balayage axe strict |
| B6 | barrières | `check:boundaries`, `check:secrets`, `test:isolation`, `type-check:v2`, `events-catalog` |

Risques : alerte sur donnée périmée (parade : exiger fraîcheur et absence de manque), spam (créneau de fréquence + clé unique + un seul épisode actif), fuite par la notification (libellé de catalogue, valeurs agrégées, aucun nom), contournement des préférences (aucun envoi direct : événement consommé par `notifications`).
