# Implementation Plan: Restructuration pédagogique — Filière → UE → ECUE

**Branch**: `030-pedagogie-ue-ecue` | **Date**: 2026-06-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/030-pedagogie-ue-ecue/spec.md` + PRD `docs/PRD-restructuration-pedagogique-filiere-ue-ecue.md`

## Summary

Introduire une couche **UE (Unité d'Enseignement)** entre la **Filière**
(`programmes`, via `filiere_id`) et l'**ECUE** (ex-`professional_subjects`) du
Module Professionnel, et **séparer les responsabilités** : l'UE porte tout
l'**administratif** (prix, UV, cohortes/sessions, inscription, commande,
paiement, prérequis, composition du diplôme) ; l'ECUE porte tout le
**pédagogique** (supports, devoirs/évaluations, notes, séances, présence). Une
ECUE est **mutualisable** (rattachable à plusieurs UE, y compris de filières
différentes) via la liaison `professional_ue_ecue` (coefficient, obligatoire,
ordre).

**Approche technique** : migration **`0069_pedagogie_ue_ecue.sql`** unique et
**destructive** (D13 — aucune reprise de données) qui crée le nouveau modèle,
repointe les FK de `professional_assignments`, `professional_enrollments`,
`professional_diploma_requirements`, `professional_diplomas` et `live_sessions`,
puis supprime les tables `professional_subject*` / `professional_session*`
obsolètes. Renommage technique complet en aval : contrats Zod
(`ProfessionalEcue*` + nouveaux `ProfessionalUe*`/`…Seance*`/`…Result*`),
services API (catalogue ECUE + **nouveau service UE** + résultats/validation +
diplômes repointés), endpoints REST (`/subjects`→`/ecue`, ajout `/ue`,
`/ue-sessions`, `/seances`), écrans web (admin UE/ECUE/cohortes/séances,
parcours étudiant par UE, présence par séance), seeds et tests. Rupture directe
des endpoints assumée (dev only).

## Technical Context

**Language/Version**: TypeScript 5.x (ES2022), Node.js 18+

**Primary Dependencies**: Fastify (API), `pg` (`Pool`/`PoolClient`), Zod via `@ecoledigitale/contracts`, Next.js 15 App Router + React + TanStack Query + Tailwind + Radix/shadcn (web)

**Storage**: PostgreSQL 14+ avec Row-Level Security (GUC `app.tenant_id` via `ProfessionalBaseService.withTenant`/`withTenantTx`)

**Testing**: Jest + ts-jest (API) ; suites `apps/api/src/__tests__/professional-*` + `services/__tests__/professional-*`

**Target Platform**: Serveur Linux (API port 8011) + navigateurs web

**Project Type**: Application web — monorepo pnpm (`apps/api`, `apps/web`, `packages/contracts`)

**Performance Goals**: charges SaaS standard ; calcul de validation UE/diplôme (cumul d'UV, ECUE obligatoires validées) < 1 s en conditions nominales

**Constraints**: isolation multi-tenant stricte (RLS) ; **Académique non modifié** (D1) ; migration `0069` ordonnée (DROP filles→parents), à passage unique ; mutualisation ECUE **inter-filières** (pas de contrainte filière sur la liaison) ; seuil ECUE 10/20 figé + **validation manuelle** ; validation UE = toutes ECUE obligatoires validées, **sans compensation** ; toutes les règles vérifiées côté serveur ; rupture directe des endpoints (dev only)

**Scale/Scope**: SaaS multi-établissements ; ~10 nouvelles tables + 4 repointées + 1 partagée altérée (`live_sessions`) ; ~40 endpoints (renommés + nouveaux) ; web admin + étudiant + enseignant + parent ; 2 seeds + ~10 suites de tests à adapter

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

⚠️ **Constitution non renseignée** : `.specify/memory/constitution.md` ne contient que des placeholders. Aucun garde-fou exécutable n'en est dérivé. Garde-fous advisory repris de 028/029 :

| Principe advisory | Statut |
|---|---|
| Isolation multi-tenant (RLS) | PASS — toutes les nouvelles tables portent `tenant_id` + policy `app.tenant_id` (patron 0061) |
| Type Safety & Zod dans `packages/contracts` | PASS — schémas dédiés renommés/ajoutés, re-exportés par le barrel |
| Sécurité d'abord (RBAC, serveur) | PASS — `professional-guards.ts` réutilisé ; règles (prérequis, prix figé, validation) côté serveur |
| API-first / versionnée | PASS — endpoints sous `/api/v1/professional` (rupture directe assumée, dev only) |
| Standards monorepo | PASS — répartition API / web / contrats |
| Code production-ready | ⚠️ JUSTIFIÉ — migration **destructive** `0069` (DROP), dérogation au principe « non destructif » des migrations 028/029, couverte par D13 (aucune reprise de données). Voir Complexity Tracking. |

**Verdict** : aucun gate bloquant ; la seule dérogation (migration destructive) est explicitement actée par le PRD (D13) et tracée ci-dessous.

**Re-check post-Phase 1** : le design (data-model, contrats) reste dans les patrons existants (RLS, services héritant de `ProfessionalBaseService`, contrats Zod). La dérogation reste limitée à `0069`. PASS.

## Project Structure

### Documentation (this feature)

```text
specs/030-pedagogie-ue-ecue/
├── plan.md              # Ce fichier (/speckit-plan)
├── spec.md              # Spécification fonctionnelle (/speckit-specify)
├── research.md          # Phase 0 — décisions techniques
├── data-model.md        # Phase 1 — schéma cible (migration 0069)
├── quickstart.md        # Phase 1 — mise en route & validation
├── contracts/
│   └── professional-ue-ecue-api.md   # Phase 1 — surface API
├── checklists/
│   └── requirements.md  # Checklist qualité de la spec
└── tasks.md             # Phase 2 — tâches (/speckit-tasks)
```

### Source Code (repository root)

```text
infra/scripts/migrations/
└── 0069_pedagogie_ue_ecue.sql                 # NOUVEAU — schéma cible (destructif, D13)

scripts/
├── apply-migration-0069-pedagogie-ue-ecue.js  # NOUVEAU — runner de 0069
├── seed-professional-module-029.js            # RÉÉCRIT — Filière→UE→ECUE, cohortes, séances
└── seed-professional-session-evaluations.js   # RÉÉCRIT — évaluations/résultats nouveau modèle

packages/contracts/src/
├── professional.ts            # MODIFIÉ — Ecue* (ex-Subject*) + Ue*/UeEcue*/UeSession*/EcueSeance*/EcueAttendance*/EcueResult*
├── professional-diplomas.ts   # MODIFIÉ — requirements ue_id + StudentProfessionalUeResult*
└── index.ts                   # MODIFIÉ — barrel re-exports

apps/api/src/
├── routes/
│   └── professional.ts                         # MODIFIÉ — /ecue, /ue, /ue-sessions, /seances, results ; codes d'erreur
├── services/
│   ├── professional-catalog.service.ts         # MODIFIÉ — sémantique ECUE (sans prix/UV)
│   ├── professional-ue.service.ts              # NOUVEAU — UE, composition, prérequis UE, cohortes, séances
│   ├── professional-results.service.ts         # NOUVEAU — résultats ECUE + validation UE → UV
│   ├── professional-enrollment.service.ts      # MODIFIÉ — ue_session_id, prix UE, prérequis UE
│   ├── professional-diplomas.service.ts        # MODIFIÉ — exigences UE, capitalisation UV par UE
│   ├── professional-ecue-materials.service.ts  # RENOMMÉ — ex professional-subject-materials
│   ├── professional-assignments.service.ts     # MODIFIÉ — ecue_id / ue_session_id
│   └── professional-live-sessions.service.ts   # MODIFIÉ — séance ECUE (professional_ecue_seance_id)
└── __tests__/                                  # MODIFIÉ — suites professional-* adaptées

apps/web/src/app/                               # MODIFIÉ — écrans admin (UE/ECUE/cohortes/séances/prérequis/diplôme=UE),
                                                #   parcours étudiant (catalogue/achat UE), présence par séance
```

**Structure Decision** : monorepo web existant. La feature étend le Module
Professionnel (028/029) en place ; pas de nouveau package. La seule altération
hors-module est ciblée : `live_sessions` (colonne parent repointée).

## Phases (exécution)

1. **DB** — `0069` + runner (data-model.md).
2. **Contrats** — Zod renommés/ajoutés (barrel).
3. **API** — services (catalogue ECUE, service UE, résultats/validation, enrollment, diplômes, materials, assignments, live) + routes + codes d'erreur.
4. **Web** — admin (UE/ECUE/composition/cohortes/séances/prérequis/diplôme=UE), étudiant (catalogue/achat UE/accès ECUE), enseignant (présence par séance).
5. **Seeds** — réécriture des 2 scripts.
6. **Tests** — adaptation des suites professional-*.

Découpage détaillé en tâches : `/speckit-tasks` (Phase 2).

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Migration **destructive** `0069` (DROP de tables, dérogation au principe « migrations non destructives » de 028/029) | D13 : aucune reprise de données (dev/seed only) ; repartir propre évite des colonnes mortes (prix/UV sur ECUE) et des FK trompeuses | Renommage en place (`ALTER … RENAME`) conserverait des colonnes/contraintes obsolètes à nettoyer ensuite et un historique de FK incohérent ; une migration de données est explicitement hors périmètre (D13) |
| Rupture directe des endpoints (pas de période de compatibilité) | Dev only (D2/D13) ; le front est mis à jour dans la même feature | Une couche d'alias `subjects→ecue` serait du code jetable sans consommateur de production |
