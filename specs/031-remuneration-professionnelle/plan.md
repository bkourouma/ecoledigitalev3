# Implementation Plan: Rémunération des enseignants — Module Professionnel

**Branch**: `031-remuneration-professionnelle` | **Date**: 2026-08-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/031-remuneration-professionnelle/spec.md`

## Summary

Étendre le module **Rémunération Enseignants** existant pour qu'il compte aussi
les heures du **Module Professionnel** (séances d'ECUE de la feature 030),
aujourd'hui invisibles pour le moteur de calcul — un enseignant intervenant
uniquement en professionnel est rémunéré 0.

**Approche technique** : ne rien dupliquer. Le moteur
(`payment-calculator.ts`) voit sa collecte d'heures extraite derrière une
interface `HourCollector` avec **deux** implémentations (académique — requête
actuelle inchangée ; professionnelle — séances ECUE validées). Le calcul, les
périodes, les configurations de paie, le workflow d'approbation, l'audit et les
rapports restent **partagés** : un enseignant reçoit **un seul** bulletin par
période, l'origine de chaque heure vivant sur la ligne de détail.

Trois ajouts de schéma dans une migration additive
**`0103_remuneration_professionnelle.sql`** : un cycle de vie
(`statut` + `validated_by`/`validated_at`) sur `professional_ecue_seances`, une
table de tarifs `professional_ecue_hourly_rates`, et l'ouverture de
`payment_hour_details` aux deux origines. La même migration **régularise cinq
défauts préexistants** : la FK `teaching_hours_id` qui rend le chemin horaire
académique inopérant, la colonne `payment_periods.academic_year_id` absente du
schéma versionné, la devise par défaut `'EUR'` — et, **découvertes par le constat
en base** ([`_constat.txt`](./_constat.txt)), deux contraintes déclarées par
`0011` mais **absentes de la base réelle** : l'unicité du paiement par
(enseignant, période, type) et l'anti-chevauchement des périodes. Cette dernière
pèse le plus lourd ici : sans elle, une séance validée tombant dans deux périodes
qui se recouvrent est payée **deux fois**.

Côté web, **deux** écrans nouveaux (Validation des séances, Tarifs ECUE) sous un
sous-menu `Rémunération` du Module Professionnel ; les quatre écrans de paie
existants gagnent un **filtre d'origine**.

## Technical Context

**Language/Version**: TypeScript 5.x (ES2022), Node.js 18+

**Primary Dependencies**: Fastify (API), `pg` (`Pool`/`PoolClient`), Zod via `@ecoledigitale/contracts`, Next.js 15 App Router + React + TanStack Query + Tailwind + Radix/shadcn (web), `exceljs`/PDF pour les exports

**Storage**: PostgreSQL 14+ avec Row-Level Security (GUC `app.tenant_id`), extension `btree_gist` (contraintes `EXCLUDE` anti-chevauchement)

**Testing**: Jest + ts-jest (API) ; nouvelles suites `payment-calculator-*`, `professional-seance-validation`, `professional-ecue-rates`

**Target Platform**: Serveur Linux (API port 8011) + navigateurs web

**Project Type**: Application web — monorepo pnpm (`apps/api`, `apps/web`, `packages/contracts`)

**Performance Goals**: calcul d'une période de 500 séances professionnelles × 100 enseignants en < 30 s (SC-006) — impose une collecte d'heures **par période** et non par enseignant

**Constraints**: isolation multi-tenant stricte (RLS) ; **aucune duplication** du module de paie ; **un seul** `teacher_payments` par (enseignant, période, type) — contrainte d'unicité existante conservée ; heures supplémentaires calculées sur le **cumul** des origines ; historisation du tarif dans le détail (un paiement approuvé est figé) ; migration **additive et idempotente** (aucun `DROP TABLE`) ; aucun backfill rétroactif des séances

**Scale/Scope**: 1 nouvelle table + 4 tables altérées + 1 vue ; ~12 endpoints (8 nouveaux, 4 enrichis) ; 2 écrans web nouveaux + 4 enrichis + 1 écran enseignant ; ~6 suites de tests

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

⚠️ **Constitution non renseignée** : `.specify/memory/constitution.md` ne contient
que des placeholders. Garde-fous advisory repris de 028/029/030 :

| Principe advisory | Statut |
|---|---|
| Isolation multi-tenant (RLS) | PASS — la table ajoutée porte `tenant_id` + policy `app.tenant_id` ; les colonnes ajoutées vivent sur des tables déjà sous RLS |
| Type Safety & Zod dans `packages/contracts` | PASS — schémas ajoutés dans `payments.ts` (origine, tarifs ECUE, validation de séance), re-exportés par le barrel |
| Sécurité d'abord (RBAC, serveur) | PASS — validation et tarification réservées à l'administration (`professional-guards.ts`) ; l'espace enseignant est borné à son propre `teacher_id` côté serveur |
| API-first / versionnée | PASS — endpoints sous `/api/v1/professional/remuneration` et extensions des routes `/api/v1/*payments*` existantes, **sans rupture** |
| Standards monorepo | PASS — répartition API / web / contrats |
| Migrations non destructives | PASS — `0103` est additive et idempotente ; le seul assouplissement est le passage d'un `NOT NULL` en nullable (élargissement, non destructif) |
| Code production-ready | ⚠️ JUSTIFIÉ — la feature **corrige** cinq défauts préexistants hors de son périmètre nominal (E4, E5, E6 + E7/E8 découverts au constat). Voir Complexity Tracking. |

**Verdict** : aucun gate bloquant.

**Re-check post-Phase 1** : le design (data-model, contrats) reste dans les
patrons existants — table sœur calquée sur `course_hourly_rates`, RLS identique,
collecte extraite sans réécriture du calcul. La correction des cinq défauts
reste circonscrite à `0103` et à la route de calcul. PASS.

## Project Structure

### Documentation (this feature)

```text
specs/031-remuneration-professionnelle/
├── plan.md              # Ce fichier (/speckit-plan)
├── spec.md              # Spécification fonctionnelle (/speckit-specify)
├── research.md          # Phase 0 — état des lieux, écarts, décisions D-R1..D-R12
├── data-model.md        # Phase 1 — schéma cible (migration 0103)
├── quickstart.md        # Phase 1 — mise en route & validation
├── contracts/
│   └── remuneration-professionnelle-api.md   # Phase 1 — surface API
├── checklists/
│   └── requirements.md  # Checklist qualité de la spec
└── tasks.md             # Phase 2 — tâches (/speckit-tasks)
```

### Source Code (repository root)

```text
infra/scripts/migrations/
└── 0103_remuneration_professionnelle.sql       # NOUVEAU — additive, idempotente

scripts/
├── apply-migration-0103-remuneration-pro.js    # NOUVEAU — runner
├── check-payment-hour-details-fk.js            # NOUVEAU — constat préalable (D-R7, risque R1)
└── seed-remuneration-professionnelle.js        # NOUVEAU — jeu de démo (séances + tarifs + config)

packages/contracts/src/
├── payments.ts                 # MODIFIÉ — HourSourceSchema, PaymentHourDetail (+source/seanceId),
│                               #   PaymentCalculationRequest (+scope), PaymentCalculationSkipReason
├── professional-remuneration.ts # NOUVEAU — SeanceStatut*, SeanceValidation*, ProfessionalEcueHourlyRate*
└── index.ts                    # MODIFIÉ — barrel re-export

apps/api/src/
├── services/
│   ├── payment-calculator.ts                       # MODIFIÉ — collecte extraite, agrégation 2 sources,
│   │                                               #   compte rendu enrichi, garde sur statut de paiement
│   ├── hour-collectors/
│   │   ├── types.ts                                # NOUVEAU — interface HourCollector + HourRecord
│   │   ├── academic-hour-collector.ts              # NOUVEAU — requête actuelle déplacée telle quelle
│   │   └── professional-hour-collector.ts          # NOUVEAU — séances ECUE validées
│   ├── professional-seance-validation.service.ts   # NOUVEAU — statut + validation en lot + chevauchements
│   └── professional-ecue-rates.service.ts          # NOUVEAU — CRUD tarifs ECUE + résolution
├── routes/
│   ├── professional-remuneration.ts                # NOUVEAU — /seances/validation, /ecue-rates, /my
│   ├── teacher-payments.ts                         # MODIFIÉ — paramètre `scope`, compte rendu enrichi
│   └── payment-reports.ts                          # MODIFIÉ — filtre `source` (liste, totaux, export)
├── index.ts                                        # MODIFIÉ — register(professionalRemunerationRoutes)
└── __tests__/                                      # NOUVEAU — suites de calcul et de validation

apps/web/src/
├── app/professionnel/admin/remuneration/
│   ├── seances/page.tsx                # NOUVEAU — Validation des séances
│   └── tarifs/page.tsx                 # NOUVEAU — Tarifs horaires ECUE
├── app/payments/
│   ├── calculate/page.tsx              # MODIFIÉ — sélecteur de périmètre + motifs d'exclusion
│   ├── manage/[id]/page.tsx            # MODIFIÉ — colonne origine dans le détail
│   └── reports/page.tsx                # MODIFIÉ — filtre origine + totaux par origine
├── app/api/teacher-payments/[id]/pdf/route.ts       # MODIFIÉ — bulletin avec origine
├── app/api/teacher-payments/[id]/statement/route.ts # MODIFIÉ — idem
└── components/layout/Sidebar.tsx       # MODIFIÉ — sous-menu « Rémunération » du Module Professionnel
```

**Structure Decision** : monorepo web existant, aucun nouveau package. La feature
se greffe sur deux modules déjà en place (paie 0011, professionnel 030) et
n'introduit qu'un seul répertoire de service nouveau (`hour-collectors/`), qui
matérialise la seule vraie abstraction ajoutée.

## Phases (exécution)

0. **Constat préalable** — vérifier en base de dev **et** de prod l'état réel de
   la FK `payment_hour_details_teaching_hours_id_fkey` et de la colonne
   `payment_periods.academic_year_id` (D-R7/D-R8, risque R1). Conditionne la
   forme finale de `0103`.
1. **DB** — `0103` + runner (data-model.md).
2. **Contrats** — schémas Zod (origine, tarifs ECUE, validation de séance, périmètre de calcul).
3. **API — socle** — extraction des collecteurs, agrégation dans le calculateur,
   garde sur les statuts de paiement, compte rendu enrichi.
4. **API — professionnel** — service de validation des séances, service de
   tarification ECUE, routes associées.
5. **API — restitution** — filtre d'origine dans les rapports, exports, bulletin PDF.
6. **Web** — 2 écrans nouveaux, 4 écrans enrichis, sous-menu, espace enseignant.
7. **Seeds & tests** — jeu de démonstration + suites Jest (calcul mixte,
   idempotence du recalcul, résolution de tarif, payabilité).

Découpage détaillé en tâches : `/speckit-tasks` (Phase 2).

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| La feature corrige **cinq défauts préexistants** hors de son périmètre nominal (E4 FK `teaching_hours_id` inopérante, E5 `academic_year_id` absente du versionné, E6 devise `'EUR'`, E7 unicité du paiement absente, E8 anti-chevauchement des périodes absent) | Tous se trouvent exactement sur le chemin qu'on étend. La FK (E4) rend l'insertion de tout détail horaire impossible : livrer la collecte professionnelle sans la corriger produirait un module qui échoue au premier calcul. `academic_year_id` (E5) est lue par la route de calcul elle-même. E8 fait payer **deux fois** une séance tombant dans deux périodes qui se recouvrent — la feature ajoute une source d'heures, donc aggrave ce risque. | Livrer d'abord la feature puis corriger : le module serait non fonctionnel entre les deux livraisons, et les tests d'acceptation (SC-001) ne pourraient pas passer. Corriger dans une migration séparée : mêmes tables, même déploiement — la séparation serait cosmétique et créerait un ordre d'application à respecter. |
| Ajout d'un `RAISE EXCEPTION` bloquant dans une migration (E7, E8) | Les deux contraintes échouent à la création si des données non conformes existent. Un message actionnable qui arrête le déploiement vaut mieux qu'un `ADD CONSTRAINT` qui plante avec une erreur Postgres brute — ou pire, qu'un `IF NOT EXISTS` qui la laisse silencieusement absente. | Poser la contrainte en `NOT VALID` puis valider plus tard : reporte le problème sans le signaler, et laisse la fenêtre de double paiement ouverte entre les deux étapes. |
| Introduction d'une abstraction `HourCollector` alors qu'il n'y a que deux implémentations | Sans elle, la requête professionnelle serait une seconde branche `if` dans une méthode déjà longue, et aucune des deux origines ne serait testable isolément (SC-009 exige de re-valider le chemin académique). | `UNION ALL` SQL entre les deux chaînes : jointures incompatibles (`class_courses` vs `professional_ecue`), requête intestable origine par origine, et régression garantie sur le chemin académique existant. |
| Passage d'un `NOT NULL` en nullable sur `payment_hour_details.teaching_hours_id` | Une ligne d'origine professionnelle n'a, par construction, pas de `teaching_hours_id`. | Table de détail séparée pour le professionnel : les rapports, totaux, PDF et le calcul des heures supplémentaires devraient tous faire l'union des deux tables — la complexité serait déplacée, pas supprimée. |
