# Implementation Plan: Diplômes Professionnels

**Branch**: `029-professional-diplomas` | **Date**: 2026-05-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/029-professional-diplomas/spec.md`

## Summary

Ajout d'une capitalisation des achèvements du Module Professionnel (`028`) sous forme de **diplômes**. Un administrateur définit des diplômes rattachés à un programme, chacun exigeant un cumul d'**UV** sur un ensemble de **matières** (certaines marquées obligatoires). Le système détecte automatiquement l'éligibilité d'un étudiant à chaque achèvement d'inscription (`terminee`) et lui **octroie** le diplôme, avec instantané (snapshot) des exigences pour la traçabilité ; l'admin garde un contrôle manuel (octroi forcé, révocation motivée, recalcul de masse).

**Approche technique** : extension strictement **additive** du Module Professionnel — 3 nouvelles tables `professional_diploma*` multi-tenant (RLS), de nouvelles routes sous le préfixe existant `/api/v1/professional`, un nouveau service `ProfessionalDiplomasService` héritant du socle `ProfessionalBaseService` de `028`. La seule modification d'un fichier existant est l'ajout d'un appel **best-effort** au recalcul de diplômes après la transition d'inscription vers `terminee` (`completeEnrollment`), sans jamais compromettre cette transition (FR-020). Aucune table existante n'est modifiée ; aucune dépendance ni pattern nouveau n'est introduit.

## Technical Context

**Language/Version**: TypeScript 5.x (ES2022), Node.js 18+

**Primary Dependencies**: Fastify (API), `pg` (accès base via `Pool`/`PoolClient`), Zod via `@ecoledigitale/contracts` (schémas/types partagés), Next.js 15 App Router + React + TanStack Query + Tailwind + Radix/shadcn (web)

**Storage**: PostgreSQL 14+ avec Row-Level Security (RLS) ; contexte tenant via le GUC `app.tenant_id` positionné par `ProfessionalBaseService.withTenant` / `withTenantTx`

**Testing**: Jest + ts-jest pour l'API ; cible `apps/api/src/services/__tests__/professional-diplomas.service.test.ts` (≥ 30 tests sur logique pure + schémas Zod)

**Target Platform**: Serveur Linux (API port 8011) + navigateurs web

**Project Type**: Application web — monorepo pnpm (`apps/api` Fastify, `apps/web` Next.js, `packages/contracts` schémas partagés)

**Performance Goals**: charges standard d'application web SaaS ; le calcul de progression d'un diplôme (cumul d'UV, matières validées/restantes) et la réévaluation d'éligibilité à un achèvement doivent répondre en < 1 s en conditions nominales

**Constraints**: isolation multi-tenant stricte par RLS ; **aucun breaking change** sur `028`, le module académique classique ou les autres modules ; migration SQL **ordonnée (`0064`), idempotente et non destructive** ; toutes les règles métier vérifiées **côté serveur** ; le recalcul de diplômes ne doit jamais faire échouer l'achèvement d'une inscription (FR-020) ; un diplôme déjà octroyé n'est jamais révoqué automatiquement (FR-017)

**Scale/Scope**: SaaS multi-établissements ; volumétrie par tenant modérée (dizaines de diplômes, milliers d'inscriptions/an) ; périmètre = MVP : 3 nouvelles tables, ~14 endpoints, 3 zones web (admin/étudiant/parent)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

⚠️ **La constitution du projet n'est pas renseignée.** `.specify/memory/constitution.md` ne contient que le template de placeholders (`[PRINCIPLE_1_NAME]`, …). Aucun garde-fou exécutable ne peut en être dérivé.

**Recommandation** (non bloquante) : exécuter `/speckit-constitution` pour ratifier la constitution.

**Garde-fous advisory appliqués** (repris du plan `028`, qui a livré la base de référence) :

| Principe advisory | Statut dans ce plan |
|---|---|
| Isolation multi-tenant (RLS) | PASS — les 3 tables `professional_diploma*` portent `tenant_id` + RLS, patron `028`/`0060` repris (research R4) |
| Type Safety & validation Zod dans `packages/contracts` | PASS — schémas Zod dédiés `packages/contracts/src/professional-diplomas.ts` re-exportés par le barrel |
| Sécurité d'abord (RBAC, vérification serveur) | PASS — gardes de rôle `professional-guards.ts` réutilisées ; toutes les règles côté serveur ; aucun accès enseignant |
| API-first / API versionnée | PASS — endpoints sous le préfixe existant `/api/v1/professional` |
| Standards monorepo (`apps/` vs `packages/`) | PASS — code réparti API / web / contrats |
| Code production-ready (migrations, non-régression) | PASS — migration `0064` idempotente non destructive ; unique modification d'un fichier existant = appel best-effort additif |

**Verdict** : aucun gate bloquant. Le plan respecte les principes advisory.

**Re-check post-Phase 1** : le design (data-model, contrats) n'introduit aucune dépendance ni pattern nouveau et reste strictement additif sur `028` ; les six garde-fous advisory restent au statut PASS. Aucune entrée de *Complexity Tracking* requise.

## Project Structure

### Documentation (this feature)

```text
specs/029-professional-diplomas/
├── plan.md              # Ce fichier (/speckit-plan)
├── spec.md              # Spécification fonctionnelle (/speckit-specify)
├── research.md          # Phase 0 — décisions techniques (/speckit-plan)
├── data-model.md        # Phase 1 — modèle de données (/speckit-plan)
├── quickstart.md        # Phase 1 — mise en route & test (/speckit-plan)
├── contracts/           # Phase 1 — contrats d'API (/speckit-plan)
│   └── diplomas-api.md
├── checklists/
│   └── requirements.md  # Checklist qualité de la spec (/speckit-specify)
└── tasks.md             # Phase 2 — tâches (/speckit-tasks — NON créé par /speckit-plan)
```

### Source Code (repository root)

```text
apps/api/src/
├── routes/
│   └── professional.ts                       # MODIFIÉ — ajout des routes /diplomas, /student/diplomas, /parent/diplomas + nouveaux codes d'erreur dans ERROR_STATUS
├── services/
│   ├── professional-diplomas.service.ts      # NOUVEAU — ProfessionalDiplomasService (CRUD, exigences, éligibilité, octroi/révocation, recompute)
│   └── professional-enrollment.service.ts    # MODIFIÉ — completeEnrollment retourne aussi subject_id (additif) ; pas d'autre changement
├── middlewares/
│   └── professional-guards.ts                # EXISTANT — requireAdmin / requireStudent / requireParent réutilisés tels quels
└── services/__tests__/
    └── professional-diplomas.service.test.ts # NOUVEAU — tests Jest (≥ 30)

packages/contracts/src/
├── professional-diplomas.ts                  # NOUVEAU — schémas Zod + types des diplômes
└── index.ts                                  # MODIFIÉ — re-export de professional-diplomas

apps/web/src/
├── app/professionnel/admin/diplomes/         # NOUVEAU — liste, new, [id], [id]/edit, [id]/exigences
├── app/professionnel/etudiant/diplomes/      # NOUVEAU — mes diplômes, [id] progression
├── app/parent/professionnel/diplomes/        # NOUVEAU — diplômes enfant (lecture seule)
└── lib/hooks/use-professional-diplomas.ts     # NOUVEAU — hooks TanStack Query

infra/scripts/migrations/
└── 0064_professional_diplomas.sql            # NOUVEAU — 3 tables + RLS + index (idempotent, non destructif)
```

**Structure Decision**: Application web monorepo, **extension du Module Professionnel `028`**. Le découpage suit exactement `028` : un service héritant de `ProfessionalBaseService` (contexte tenant + enveloppe `ok`/`fail`), des schémas Zod dans `packages/contracts`, des routes ajoutées au fichier `professional.ts` existant sous le préfixe `/api/v1/professional`, une migration SQL numérotée idempotente. **Deux fichiers existants seulement** sont modifiés, de façon strictement additive : `professional.ts` (nouvelles routes + codes d'erreur) et `professional-enrollment.service.ts` (`completeEnrollment` expose `subject_id`). Aucune nouvelle dépendance, aucun nouveau pattern d'infrastructure.

## Complexity Tracking

> Aucune violation de constitution à justifier (constitution non renseignée ; le plan respecte tous les principes advisory). Section sans objet.
