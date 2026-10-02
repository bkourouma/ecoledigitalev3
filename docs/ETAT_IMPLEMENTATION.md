# État de l'implémentation EcoleDigitale v2

Mis à jour le 2026-10-01 sur la branche `feat/v2-phase-0`. Référence de pilotage : `docs/PLAN_Mise_en_oeuvre_EcoleDigitale_SaaS.md`.
Décisions métier validées : `specs/v2/DECISIONS-METIER.md`. Décisions d'architecture : `docs/adr/`. Contrat des modules : `docs/architecture/module-conventions.md`, `platform-assembly.md`, `new-module-guide.md`.

## Terminé et fusionné

| Domaine | Contenu |
|---------|---------|
| Phase 0 | Renommage EcoleDigitale, ADR 001-008, `specs/v2/` opérationnel, CI de base, scan de secrets, secrets retirés du dépôt, inventaire d'impact (`docs/inventory/`), code Imhotep retiré (aucune table supprimée) |
| Packages | `kernel` (contexte, Result, Money, Clock, Id, événements, manifeste de module), `database` (TenantDb, SystemDb, runner de migrations, RLS, test d'isolation), `rules-engine` (DSL sandboxé, 293 tests) |
| Plateforme | Registre de modules auto-découvert, `ModuleRuntime`, frontières `dependency-cruiser`, générateur `pnpm module:new`, test d'isolation global, `apps/worker` (BullMQ, outbox, jobs) |
| Modules backend | `tenancy`, `entitlements`, `iam`, `rbac`, `audit`, `platform`, `finance`, `academic`, `people`, `attendance`, `scheduling`, `rules`, `assess`, `results`, `reportcards`, `higher`, `payroll` |
| Authentification | Passerelle IAM <-> legacy, import des utilisateurs (`pnpm iam:import-legacy`), pages web derrière `NEXT_PUBLIC_AUTH_V2`, plan de bascule `docs/architecture/auth-cutover.md` |
| Web `/v2` | Fondation (tenant unique, client API typé, gardes serveur, PWA, i18n), administration (plateforme, établissement, rôles, audit), cœur académique et personnes, authentification V2, **portails parent, élève et enseignant** (`/v2/parent|student|teacher`, accès strictement limité, finance famille `/finance/me/*`, contestation de bulletin de paie : `apps/web/docs/v2-portals.md`) |
| Qualité | Caractérisation du legacy (`tests/characterization`, 68 tests, 19 anomalies cataloguées), parité démontrée de `results` et `payroll` |

Mesures de référence : API v2 environ 2 940 tests, critères de sortie Phase 1 61/61 (`pnpm test:phase1`, Redis requis), web 419 tests, `check:boundaries`, `check:secrets` et `type-check:v2` propres.

## En cours au moment de la rédaction (peut être terminé : vérifier `git log` et `git branch --list 'worktree-agent-*'`)

- Adaptateurs réels entre modules (ports), alignement des événements (`apps/api/test/events-catalog.test.ts`), rôles RBAC complets, stockage S3/MinIO, branchement du worker.
- Écrans `/v2` : présences et emploi du temps (appel hors-ligne) ; notes, résultats, règles, bulletins, supérieur ; finance et paie.

## Reste à faire (par priorité)

1. **Terminer l'assemblage de la Phase 2** : intégrer les chantiers ci-dessus ; test de bout en bout « année simulée » (provisionnement -> structure académique -> inscriptions -> paiement des frais d'inscription -> emploi du temps -> appels -> évaluations -> notes -> résultats -> bulletin PDF -> paie) ; tableaux de bord propriétaire (portails parent, élève, enseignant : livrés, voir ci-dessus) ; route de lecture du journal d'audit de plateforme (`GET /api/v1/platform/audit/logs`) ; alignement du contrat `POST /platform/tenants` ; écrans manquants (reconduction annuelle, paramètres académiques, pièces d'élève).
2. **Phase 3** : fournisseurs de paiement réels (Orange Money, MTN MoMo, Wave, CinetPay) derrière `PaymentProvider` (mode sandbox explicite, webhooks signés) ; notifications réelles (SMTP, SMS, WhatsApp, push) et gabarits par tenant (spec 016) ; gestion documentaire (spec 024) ; import Excel/CSV (spec 031 : upload, mapping, validation, aperçu, import, rapport) ; relances d'impayés automatiques.
3. **Phase 4, pack Primary** : specs 005, 007, 018 à rédiger puis implémenter (maternelle, primaire, admissions, moteur d'examens générique dont CEPE, élèves affectés par l'État). Les règles officielles ne s'inventent pas : voir `specs/v2/012-rules-engine/regulatory-sources-needed.md`.
4. **Phase 5, pack Secondary** : spec 006 (collège/lycée, séries, conseil de classe avec PV, vie scolaire, BEPC, BAC).
5. **Phase 6** : tableaux de bord de direction et alertes (spec 025), hors-ligne avancé, tests de charge, exercice de restauration, revue de sécurité complète, accessibilité.
6. **Mise en service** (actions à fort impact : voir les garde-fous du prompt) : reset de la base et archivage des migrations legacy, suppression du code legacy et de Prisma, image du worker (Chromium), variables d'environnement et rôles de base de production, bascule de l'authentification.

## Manques d'API identifiés par les écrans (à traiter dans le backlog C)

- ~~Finance : routes parent/élève~~ **Livré** : `/api/v1/finance/me/*` (`finance.child.read|pay`, `finance.self.read|pay`, propriété relue côté serveur, 404 uniforme, paiement en ligne initié par le parent). Les écrans `/v2/finance/me` et les portails utilisent ces routes (migration faite).
- ~~Paie : contestation par l'enseignant~~ **Livré** : `POST /api/v1/payroll/my/payslips/:id/dispute` (`payroll.my.dispute`).
- ~~Finance : export CSV serveur~~ **Livré** (`/finance/exports/*`, plafond `FINANCE_EXPORT_MAX_ROWS`, troncature signalée). ~~Rendu PDF des reçus et bulletins de paie~~ **Livré** (`GET /receipts/:id/pdf`, `GET /payslips/:id/pdf`, `/my/…`). **Reste** : route de lecture du rapprochement des webhooks en échec.
- ~~Lectures par lots~~ **Livré** : `GET /people/students/lookup`, `/people/staff/lookup` (et `getDisplayNamesOfStudents|Staff`). Reste à les consommer dans les écrans et DTO.
- ~~Adaptateur d'inscriptions : sens des clés libres des barèmes~~ **Défini et testé** (`levelKey` = niveau, `trackKey` = programme, `learnerType` = type de financement ; spec 004 AC8.1, README finance).
- Parité legacy manquante côté finance : saisie des charges et tableaux de bord propriétaire (trésorerie, scolarité), commandes/lots du parcours « professionnel », commissions de prospection.

## Dette connue

- tsc legacy : 365 erreurs (API), 412 (web) ; ne doivent pas augmenter. Jest legacy : 8 suites en échec historiques.
- Le test de performance payroll (<= 30 s) est sensible à la charge de la machine.
- Les parcours authentifiés des écrans `/v2` ne sont couverts que par Vitest (pas de Playwright avec infra complète).

## Questions métier ouvertes (valeur par défaut appliquée tant qu'elles ne sont pas tranchées)

Voir `specs/v2/004-academic-core/open-questions.md` (O-01 à O-23) et `specs/v2/012-rules-engine/open-questions.md` partie B (Q-01 à Q-40). Trois à faire confirmer : conduite non notée (semestre en attente, par défaut) ; précision des notes (3 décimales, 9,995 non arrondi) ; tarifs de paie en francs entiers.
