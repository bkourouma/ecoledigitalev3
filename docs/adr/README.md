# Architecture Decision Records (ADR)

Les ADR consignent les décisions d'architecture structurantes d'EcoleDigitale : ce qui a été décidé, pourquoi, et ce qu'on a écarté. Ils complètent le plan `docs/PLAN_Mise_en_oeuvre_EcoleDigitale_SaaS.md` (section 3) et le PRD `docs/PRD_EcoleDigitale_SaaS.md`.

Un ADR n'est jamais réécrit après acceptation : on en ouvre un nouveau qui le remplace (statut `Remplacé par ADR-0XX`).

## Index

| ADR | Titre | Statut |
|-----|-------|--------|
| [ADR-001](ADR-001-modular-monolith.md) | Modular monolith : modules, manifeste, frontières | Accepté |
| [ADR-002](ADR-002-tenancy-rls.md) | Multi-tenancy et Row-Level Security | Accepté |
| [ADR-003](ADR-003-dsl-regles-academiques.md) | Langage de règles (DSL) du Rules Engine | Accepté |
| [ADR-004](ADR-004-evenements-outbox.md) | Événements : transactional outbox, BullMQ/Redis, `apps/worker` | Accepté |
| [ADR-005](ADR-005-acces-donnees-typage.md) | Accès aux données : `pg` + SQL et stratégie de typage | Proposé (spike d'une demi-journée) |
| [ADR-006](ADR-006-schemas-par-module-reset-base.md) | Un schéma Postgres par module et reset de la base | Accepté |
| [ADR-007](ADR-007-conventions.md) | Conventions : UUID, montants, dates, i18n, nommage | Accepté |
| [ADR-008](ADR-008-identite-et-sessions.md) | Identité globale, accès par tenant, sessions et MFA | Accepté |


## Statuts possibles

`Proposé` (en discussion ou dépend d'un spike) → `Accepté` → éventuellement `Remplacé par ADR-0XX` ou `Abandonné`.

## Gabarit

Copier ce gabarit dans `ADR-0XX-titre-court.md` (numéro suivant, titre en minuscules sans accents, tirets).

```markdown
# ADR-0XX — Titre

- **Statut :** Proposé | Accepté | Remplacé par ADR-0YY | Abandonné
- **Date :** AAAA-MM-JJ
- **Références :** décisions du plan (Dn), sections du PRD, autres ADR

## Contexte
Le problème, les contraintes, les constats de l'existant qui forcent la décision.

## Décision
Ce qui est décidé, formulé de façon assez précise pour être vérifiable (idéalement par un garde-fou automatisé).

## Conséquences
Positives, négatives, travail induit, garde-fous CI, impact sur les autres ADR.

## Alternatives rejetées
Chaque option écartée, avec la raison.
```
