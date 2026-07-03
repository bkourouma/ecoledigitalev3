# Implementation Plan: Module Professionnel (inscription à la carte)

**Branch**: `028-professional-module` | **Date**: 2026-05-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/028-professional-module/spec.md`

## Summary

Ajout d'un **Module Professionnel** permettant l'inscription **à la carte** à des matières professionnelles organisées par programme, avec prérequis, panier, commande et paiement. L'approche technique : un **espace de noms dédié et distinct** (`professional_*` côté base, `/api/v1/professional/*` côté API), greffé sur le monorepo existant (Fastify + Next.js + contrats Zod partagés) **sans modifier** le module académique classique ni le module « formations professionnelles » existant. Toutes les nouvelles tables sont multi-tenant avec Row-Level Security calquée sur le patron existant. La logique métier (éligibilité, prérequis, capacité, idempotence du paiement) est appliquée côté serveur dans une couche de services dédiée.

## Technical Context

**Language/Version**: TypeScript 5.x (ES2022), Node.js 18+

**Primary Dependencies**: Fastify (API), `pg` / `@fastify/postgres` (accès base), Zod via `@ecoledigitale/contracts` (schémas/types partagés), Next.js 15 App Router + React + TanStack Query + Tailwind + Radix UI (web)

**Storage**: PostgreSQL 14+ avec Row-Level Security (RLS) ; contexte tenant via le GUC `app.tenant_id`

**Testing**: Jest + ts-jest pour l'API (`apps/api/src/__tests__/*.test.ts`) ; Playwright pour l'e2e web

**Target Platform**: Serveur Linux (VPS mutualisé, API port 8011) + navigateurs web

**Project Type**: Application web — monorepo pnpm (`apps/api` Fastify, `apps/web` Next.js, `packages/contracts` schémas partagés)

**Performance Goals**: charges standard d'application web SaaS ; les requêtes de catalogue (programmes, matières, sessions inscriptibles avec état des prérequis) doivent répondre en < 1 s en conditions nominales

**Constraints**: isolation multi-tenant stricte par RLS ; **aucun breaking change** sur les modules existants ; migration SQL **ordonnée, idempotente et non destructive** ; règles métier vérifiées **côté serveur** ; idempotence du paiement

**Scale/Scope**: SaaS multi-établissements ; volumétrie par tenant modérée (centaines à quelques milliers d'étudiants) ; périmètre = MVP (Phase 1) : 6 nouvelles tables, ~20 endpoints, 1 zone web par rôle

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

⚠️ **La constitution du projet n'est pas renseignée.** `.specify/memory/constitution.md` ne contient que le template de placeholders (`[PRINCIPLE_1_NAME]`, …). Aucun garde-fou exécutable ne peut en être dérivé.

**Recommandation** : exécuter `/speckit-constitution` pour ratifier la constitution (le fichier `.specify/CONSTITUTION_SUMMARY_2025-10-08.md` atteste qu'une version v1.0.0 a existé et peut servir de base de reconstruction).

**Garde-fous advisory appliqués** en l'absence de constitution formelle (issus de `CONSTITUTION_SUMMARY_2025-10-08.md` et du journal de décisions §3 du document de référence) :

| Principe advisory | Statut dans ce plan |
|---|---|
| Isolation multi-tenant (RLS) | PASS — toutes les tables `professional_*` portent `tenant_id` + RLS, patron existant repris (recherche R5) |
| Type Safety & validation Zod dans `packages/contracts` | PASS — schémas Zod dédiés `packages/contracts/src/professional.ts` |
| Sécurité d'abord (RBAC, vérification serveur) | PASS — `authMiddleware` global + gardes de rôle ; toutes les règles côté serveur |
| API-first / API versionnée | PASS — endpoints sous `/api/v1/professional/*` |
| Standards monorepo (`apps/` vs `packages/`) | PASS — code réparti API / web / contrats |
| Code production-ready (migrations, non-régression) | PASS — migration idempotente non destructive ; aucun impact sur les modules existants |

**Verdict** : aucun gate bloquant (aucune constitution formelle). Le plan respecte les principes advisory. **Action de suivi non bloquante** : ratifier la constitution.

**Re-check post-Phase 1** : le design (data-model, contrats) n'introduit aucune dépendance ni pattern nouveau ; les six garde-fous advisory restent au statut PASS. Aucune entrée de *Complexity Tracking* requise.

## Project Structure

### Documentation (this feature)

```text
specs/028-professional-module/
├── plan.md              # Ce fichier (/speckit-plan)
├── spec.md              # Spécification fonctionnelle (/speckit-specify)
├── research.md          # Phase 0 — décisions techniques (/speckit-plan)
├── data-model.md        # Phase 1 — modèle de données (/speckit-plan)
├── quickstart.md        # Phase 1 — mise en route & test (/speckit-plan)
├── contracts/           # Phase 1 — contrats d'API (/speckit-plan)
│   └── professional-api.md
├── checklists/
│   └── requirements.md  # Checklist qualité de la spec (/speckit-specify)
└── tasks.md             # Phase 2 — tâches (/speckit-tasks — NON créé par /speckit-plan)
```

### Source Code (repository root)

```text
apps/api/src/
├── routes/
│   └── professional.ts                    # NOUVEAU — routes /api/v1/professional/* (export async (fastify) => {})
├── services/
│   ├── professional-catalog.service.ts    # NOUVEAU — matières, prérequis, sessions
│   ├── professional-enrollment.service.ts # NOUVEAU — catalogue étudiant, panier, commande, éligibilité
│   └── professional-payment.service.ts    # NOUVEAU — paiement, idempotence, reçus
├── middlewares/
│   └── requireOwner.ts                    # EXISTANT — modèle pour les gardes de rôle ; ajout possible de requireAdmin
├── plugins/
│   └── tenant-context.ts                  # MODIFIÉ — ajout de "/api/v1/professional" à tenantRequiredPrefixes
├── index.ts                               # MODIFIÉ — register(professionalRoutes, { prefix: "/api/v1/professional" })
└── __tests__/
    └── professional-*.test.ts             # NOUVEAU — tests Jest

packages/contracts/src/
├── professional.ts                        # NOUVEAU — schémas Zod + types
└── index.ts                               # MODIFIÉ — re-export du module professional

apps/web/src/
├── app/professionnel/                     # NOUVEAU — zone web (calquée sur formations-professionnelles/)
│   ├── admin/                             # catalogue, matières, prérequis, sessions, suivi
│   └── etudiant/                          # choix programme, catalogue, panier, commande, paiement, mes inscriptions
├── app/parent/professionnel/              # NOUVEAU — vues parent lecture seule
├── app/api/v1/professional/               # NOUVEAU — routes proxy Next.js vers l'API backend
└── lib/hooks/use-professional-*.ts        # NOUVEAU — hooks TanStack Query

infra/scripts/migrations/
└── 0061_professional_module.sql           # NOUVEAU — tables + RLS + index (idempotent)

scripts/
└── apply-migration-0061-professional-module.js  # NOUVEAU (optionnel) — runner Node de la migration
```

**Structure Decision**: Application web monorepo. Le module suit **exactement** le découpage du module analogue « formations professionnelles » : un fichier de routes Fastify par domaine exportant `async (fastify) => {}`, des classes de service prenant le pool `pg`, des schémas Zod dans `packages/contracts`, une zone Next.js App Router par rôle, une migration SQL numérotée. Aucune nouvelle dépendance, aucun nouveau pattern d'infrastructure.

## Complexity Tracking

> Aucune violation de constitution à justifier (constitution non renseignée ; le plan respecte tous les principes advisory). Section sans objet.
