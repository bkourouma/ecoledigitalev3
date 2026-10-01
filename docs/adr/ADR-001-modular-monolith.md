# ADR-001 — Modular monolith : modules, manifeste, frontières

- **Statut :** Accepté
- **Date :** 2026-10-01
- **Références :** plan D3, sections 3.1 et 3.3 ; PRD principe « modular monolith »

## Contexte

L'API actuelle est un monolithe Fastify sans frontières internes : des fichiers de routes de plusieurs milliers de lignes (par exemple `routes/professional.ts`, plus de 4 000 lignes), du SQL écrit directement dans les routes, des gardes par rôle répétées (`requireAdmin` plus de 170 fois) et des menus définis côté client dans une `Sidebar.tsx` de plus de 2 000 lignes. Ajouter les packs Primary, Secondary, Higher et Virtual, avec activation par plan (entitlements), exige de savoir précisément ce qui appartient à quoi.

Le choix de pile est déjà tranché (D3) : on garde Fastify, `pg` et des migrations SQL. Pas de microservices : l'équipe est petite et l'exploitation doit rester simple.

## Décision

L'API devient un **modular monolith**. Un seul déploiement, mais un code organisé en modules métier à frontières contrôlées.

**Structure d'un module** (`apps/api/src/modules/<module>/`) :

```
index.ts        API publique : seul point d'entrée pour les autres modules
manifest.ts     clé, packs, permissions, features, menus, événements publiés/consommés
domain/         entités, règles pures, événements
application/    use cases (une fonction par cas d'usage, transactionnels)
infrastructure/ repositories SQL, adaptateurs externes
http/           plugin Fastify, schémas Zod importés de packages/contracts
```

**Règles :**

1. Chaîne unique : route → use case → repository. Aucune requête SQL dans une route.
2. Un module n'importe d'un autre module que son `index.ts`. Aucun import vers `domain/`, `application/` ou `infrastructure/` d'un autre module.
3. Un module possède son schéma Postgres (voir ADR-006) ; pas de SQL direct vers le schéma d'un autre module. La communication passe par l'API publique (appel synchrone) ou par des événements (ADR-004).
4. Le **manifeste** déclare les permissions `resource.action`, les features, les packs concernés, les entrées de menu et les événements. Un **registre de modules** agrège les manifestes ; la sidebar, les gardes `requirePermission`/`requireFeature` et la console super-admin en sont dérivés.
5. Le code pur partagé vit dans `packages/` (`kernel`, `contracts`, `rules-engine`, `database`, `auth`). `rules-engine` n'a aucune dépendance d'I/O.
6. Les contrats Zod de `packages/contracts` sont écrits avant les routes ; le client web est typé à partir de ces contrats.

**Garde-fous automatisés (bloquants en CI) :** `dependency-cruiser` avec une règle « import inter-modules uniquement via `index.ts` », une règle « `packages/rules-engine` n'importe ni `pg`, ni Fastify, ni `node:fs` » et une règle « pas de `pg` hors de `infrastructure/`». Un test vérifie que chaque module a un manifeste valide.

## Conséquences

- Les modules peuvent être construits en parallèle (par exemple Finance pendant le cœur académique) sans se marcher dessus.
- Un module peut être supprimé proprement (code + schéma), ce qui sert la suppression d'Imhotep et le remplacement progressif des piles historiques.
- Un module peut être extrait en service plus tard, si le besoin se présente, sans réécriture de son contrat.
- Coût : davantage de fichiers et de cérémonie par cas d'usage ; les modules « transverses » (audit, notifications) doivent exposer une API publique soignée.
- Le code historique reste hors modules (`legacy`) jusqu'à son remplacement tranche par tranche ; dependency-cruiser s'applique d'abord aux nouveaux modules.

## Alternatives rejetées

- **NestJS** : impose un framework complet et une réécriture de tout le HTTP pour un gain surtout cosmétique ; contraire à D3.
- **Microservices** : coût d'exploitation, de cohérence transactionnelle et de tests disproportionné à l'équipe actuelle.
- **Monolithe en couches techniques** (controllers/services/repositories globaux) : c'est l'état actuel ; il ne donne aucune frontière métier ni suppression propre.
- **Conventions sans outillage** : sans règle bloquante en CI, les frontières s'érodent en quelques mois.
