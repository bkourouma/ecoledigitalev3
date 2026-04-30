# Implementation Plan: Espace Propriétaire (rôle Owner)

**Branch**: `027-compte-proprietaire-owner` | **Date**: 2026-04-17 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `d:\ecoledigitale-main\specs\027-compte-proprietaire-owner\spec.md`

**Setup note**: Les scripts `.specify/scripts/powershell/setup-plan.ps1` et `update-agent-context.ps1` ne sont pas présents dans ce dépôt ; les chemins et la branche sont alignés sur la spec `027`. À ajouter depuis le gabarit SpectKit si vous versionnez les scripts.

## Summary

Introduire le rôle machine **`owner`** (affichage « Propriétaire ») dans le référentiel des rôles par tenant, l’exposer dans les JWT / chargements de rôles comme les autres rôles, et livrer un **espace dédié** (API sous préfixe dédié + application web) réservé aux utilisateurs ayant ce rôle sur le tenant actif (`X-Tenant` + contexte RLS). Le périmètre fonctionnel couvre : **tableau de bord KPI**, vues **finances** (agrégats, recouvrement, impayés, export PDF/CSV avec minimisation PII), **synthèses académiques** (lecture seule), **personnel / RH** (synthèse + validation des rémunérations enseignants alignée sur le workflow `teacher_payments`), **formations pro** (lecture + export selon règles existantes), **alertes pilotage** (lecture + acquittement), **gestion des attributions de rôles** pour les utilisateurs du tenant. Aucune route « owner » ne doit permettre de modifier notes, devoirs, cours, classes ou contenu pédagogique.

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js 18+ (aligné monorepo)  
**Primary Dependencies**: Fastify 4.x (API), Zod (validation), `@ecoledigitale/contracts` ; Next.js 15 / React 18 (web) ; schémas partagés dans `packages/contracts`  
**Storage**: PostgreSQL avec RLS (`tenant_id`, `app.tenant_id`) — tables existantes : `roles` (`key`, `name`, `tenant_id`), `user_roles`, `student_payments`, `tuition_schedules`, `payment_periods`, `teacher_payments`, `teaching_hours`, `semester_averages`, `attendance_*`, `assignment_submissions`, formations pro / inscriptions selon modules déjà déployés  
**Testing**: Tests d’intégration Fastify sur les routes `/api/v1/owner/*` (403 pour rôles non owner) ; tests unitaires sur agrégations et middleware ; E2E optionnel (Playwright) sur garde de route `(owner)`  
**Target Platform**: API + web déployées comme le reste d’EcoleDigitale (Linux / hébergement actuel)  
**Project Type**: Monorepo web + API (`apps/api`, `apps/web`, `packages/contracts`, `infra/scripts/migrations`)  
**Performance Goals**: Tableau de bord et vues listées exploitables en conditions normales (< 3 min parcours utilisateur côté spec SC-001) ; requêtes agrégées paginées ou limitées par fenêtre temporelle pour éviter full scans  
**Constraints**: Isolation tenant stricte ; réutiliser la vérification JWT + **blacklist** existante (`token_blacklist` / `blacklist.service.ts`) ; pas d’affaiblissement du contrôle tenant JWT vs `X-Tenant` ; exports financiers : colonnes élèves minimisées (initiales / pseudo-ID) sur vues globales  
**Scale/Scope**: ~8 groupes de routes owner, ~10 pages Next sous groupe de routes `(owner)`, 1 migration rôle + migration optionnelle pour persistance des alertes / acquittements

## Constitution Check

*La constitution du dépôt (`.specify/memory/constitution.md`) est encore un gabarit non rempli. Les garde-fous ci-dessous reflètent les principes effectifs observés dans le code EcoleDigitale.*

| Garde-fou | Statut |
|-----------|--------|
| Isolation multi-tenant (RLS + `tenant_id` sur requêtes) | ✅ PASS — toute requête owner via pool avec contexte tenant comme les routes existantes |
| Auth JWT + cohérence tenant header | ✅ PASS — même plugin `auth-middleware` ; pas d’exception « cross-tenant » pour owner sauf spec produit explicite |
| Révocation jetons | ✅ PASS — réutiliser le flux blacklist existant |
| Contrats partagés pour payloads API | ✅ PASS — Zod dans `packages/contracts`, export central |
| Pas de fuite de droits (admin ≠ owner) | ✅ PASS — tests 403 obligatoires |

**Gate Status**: ✅ **PASSED** — poursuite Phase 0 / 1.

## Project Structure

### Documentation (this feature)

```
specs/027-compte-proprietaire-owner/
├── plan.md                 # Ce fichier
├── research.md             # Phase 0
├── data-model.md           # Phase 1
├── quickstart.md           # Phase 1
├── contracts/
│   └── owner-openapi.yaml  # Contrat REST minimal
├── checklists/
│   └── requirements.md     # Déjà créé avec /speckit.specify
└── tasks.md                # Phase 2 (/speckit.tasks)
```

### Source Code (repository root)

```
d:\ecoledigitale-main\
├── infra\scripts\migrations\
│   └── NNN_add_owner_role.sql              # INSERT roles key='owner' par tenant (+ optionnel table alertes)
├── apps\api\src\
│   ├── middlewares\requireOwner.ts         # ou hooks/ — vérif roles JWT inclut 'owner' + tenant
│   ├── routes\owner\
│   │   └── index.ts                        # GET dashboard, finances, academic, staff, formations, alerts, …
│   ├── services\owner\                     # optionnel : OwnerDashboardService, etc.
│   └── index.ts                            # enregistrement fastify.register(ownerRoutes, { prefix: '/api/v1/owner' })
├── packages\contracts\src\
│   ├── owner.schema.ts                     # schémas Zod réponses / query params
│   └── index.ts                            # export owner.*
└── apps\web\src\app\
    └── (owner)\
        ├── layout.tsx
        ├── page.tsx
        ├── dashboard\page.tsx
        ├── finances\page.tsx
        ├── finances\rapport\page.tsx
        ├── academique\page.tsx
        ├── staff\page.tsx
        ├── formations\page.tsx
        ├── alertes\page.tsx
        └── acces\page.tsx
```

**Structure Decision**: Monorepo existant ; nouvelle surface **API** isolée sous `/api/v1/owner` avec middleware appliqué **par route** (ou préHandler enregistré sur chaque route du plugin) ; UI sous `app/(owner)/` avec garde de rôle alignée sur les patterns `(parent)` / admin existants.

## Complexity Tracking

*Aucune violation majeure identifiée. Si une table dédiée « alertes pilotage » est ajoutée, la complexité reste limitée à une migration + service de lecture/écriture acquittement.*

| Sujet | Justification |
|-------|----------------|
| Table optionnelle `owner_pilotage_alerts` (ou équivalent) | Les notifications parent (`notifications`) ne sont pas adaptées ; les alertes owner nécessitent sévérité, domaine, acquittement par user owner |

## Phases & livrables

### Phase 0 — Recherche & décisions

Consolidé dans [research.md](./research.md) : choix du `roles.key`, stratégie alertes, mapping validation paie → `teacher_payments`, bibliothèque graphiques front.

### Phase 1 — Design

- [data-model.md](./data-model.md) — entités, états, RLS  
- [contracts/owner-openapi.yaml](./contracts/owner-openapi.yaml) — contrat REST  
- [quickstart.md](./quickstart.md) — vérification locale et scénarios de test manuels  

### Phase 2 — Tâches d’implémentation

Généré : [tasks.md](./tasks.md) (**`/speckit.tasks`**).

## Implementation notes (priorité recommandée)

1. **Migration SQL** : pour chaque ligne de `tenants`, insérer dans `roles` si absent : `key = 'owner'`, `name` libellé métier (ex. « Propriétaire »). Ne pas utiliser de colonne `description` tant qu’elle n’existe pas en base (schéma actuel `0001_init.sql` : `key`, `name` uniquement sur `roles`).
2. **Auth** : s’assurer que le login / refresh JWT inclut la clé `owner` dans `roles[]` lorsque `user_roles` le porte (même mécanisme que `admin`, `teacher`, …).
3. **`requireOwner`** : même pattern que les gardes `admin` inline ou extrait ; réponse 403 si `!request.user?.roles.includes('owner')` ; **chaque** handler des routes owner doit passer par ce garde (pas seulement un parent `register`).
4. **`GET /api/v1/owner/dashboard`** : requêtes SQL agrégées sur `student_payments`, `enrollments`/`cycles`, `teacher_payments`, `semester_averages`, présence, soumissions devoirs, formations pro — documenter les jointures exactes au moment de l’implémentation en lisant les migrations concernées.
5. **Contrats** : `owner.schema.ts` + types exportés ; aligner les noms de champs sur l’OpenAPI.
6. **Front** : layout avec sidebar ; hook `useOwnerDashboard` suivant la convention data-fetch du web (SWR / TanStack Query / fetch — à confirmer dans `apps/web` au moment de l’implémentation).
7. **Tests** : matrice 403 pour `admin`, `teacher`, `student`, `parent`, `formateur` sur un échantillon d’URLs owner.

## Post-design Constitution Check

Réévaluation après design : toujours ✅ — isolation tenant, auth, blacklist, interdiction modification académique via surface owner respectées par conception des routes (lecture / exports / validations ciblées uniquement).
