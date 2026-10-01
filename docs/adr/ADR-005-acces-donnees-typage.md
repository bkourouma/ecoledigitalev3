# ADR-005 — Accès aux données : `pg` + SQL et stratégie de typage

- **Statut :** Proposé (recommandation à confirmer par un spike d'une demi-journée)
- **Date :** 2026-10-01
- **Références :** plan D3, section 3.4 ; ADR-001, ADR-002, ADR-006

## Contexte

D3 a tranché : on garde Fastify, `pg` et des migrations SQL ; ni Prisma ni ORM. Il reste à décider comment obtenir des **requêtes typées** sans retomber dans des `any` et des casts dispersés. Le code actuel accède à `pg` de façon directe, avec des résultats non typés et du SQL dans les routes (ADR-001 y met fin : le SQL vit dans des repositories).

Deux voies sont sur la table :

**A. `kysely-codegen`** : introspecter le schéma Postgres pour générer les types, et construire les requêtes avec Kysely (constructeur de requêtes typé) sur le pilote `pg`.

**B. Types de ligne écrits à la main** : SQL brut via `pg`, un type `XRow` par table ou par requête dans le repository, validation Zod optionnelle en lecture, plus un test de conformité qui compare ces types au schéma réel.

| Critère | A. kysely-codegen | B. types à la main |
|---------|-------------------|--------------------|
| Dérive types / schéma | Impossible (régénéré) | Possible ; limitée par un test de conformité |
| Cohérence avec D3 (« pg + SQL ») | Ajoute une couche de requêtage (Kysely) | Totale |
| Compatibilité `TenantDb` / RLS | Bonne (Kysely sur un client transactionnel) | Native |
| Plusieurs schémas (ADR-006) | Supporté, noms qualifiés à surveiller | Naturel |
| Requêtes complexes (CTE, `LATERAL`, `FOR UPDATE SKIP LOCKED`) | Parfois contourné par du SQL brut injecté dans Kysely | SQL natif |
| Coût d'apprentissage et de revue | Nouvelle API à connaître | Faible : SQL lisible par tous |
| Étape de build | Génération à orchestrer (migration → codegen → commit) | Aucune |
| Lisibilité du SQL pour audit (RLS, perf) | Moyenne (SQL généré) | Maximale |

## Décision (recommandée)

Adopter **B : SQL brut via `pg` dans les repositories, avec types de ligne écrits à la main et un test de conformité automatisé**.

1. Chaque repository déclare ses types de ligne (`StudentRow`, etc.), colocalisés dans `infrastructure/`. Les types exposés par `index.ts` sont des objets de domaine, pas des lignes SQL.
2. La conversion ligne → domaine est explicite (mapper). Les colonnes `numeric`/`bigint` sont converties à cet endroit (voir ADR-007 pour les montants).
3. **Test de conformité (bloquant en CI)** : pour chaque type de ligne marqué `@table schema.table`, le test interroge `information_schema.columns` et vérifie que les colonnes et la nullabilité correspondent. Il ne détecte pas toutes les erreurs de requête mais attrape la dérive de schéma.
4. Validation Zod en lecture seulement aux frontières externes (JSONB, payloads d'événements, imports), pas sur chaque ligne.

## Pourquoi pas A, malgré la dérive évitée

La génération supprime une catégorie d'erreurs, mais elle introduit Kysely comme seconde langue de requêtes à côté du SQL, à l'inverse de D3 et du besoin de lire et d'optimiser du SQL (policies RLS, index, CTE de calculs de résultats). Les requêtes les plus sensibles (finance, résultats, outbox) sont justement celles qui se contournent en SQL brut. Le test de conformité attrape l'essentiel du risque de dérive pour un coût bien moindre.

## Spike proposé (0,5 jour) — condition de bascule

Porter sur les deux approches le repository `iam` (utilisateurs + rôles) et une requête de classement par fenêtre (`RANK() OVER`). Mesurer : temps d'écriture, lisibilité, nombre de `any`/casts, friction avec `TenantDb`, durée de la génération de types. **Bascule vers A si** l'écart d'erreurs de typage détectées au build est significatif **et** que les requêtes complexes restent lisibles ; sinon on confirme B et on passe le statut à `Accepté`.

## Conséquences

- Aucune nouvelle dépendance de requêtage ; l'équipe écrit et relit du SQL.
- Les types peuvent mentir tant que le test de conformité n'est pas en place : il est donc livré avec le premier repository.
- Si on bascule vers A, la migration est mécanique (les repositories encapsulent déjà tout le SQL, par ADR-001).

## Alternatives rejetées

- **Prisma / ORM** : écarté par D3 (RLS par `SET LOCAL`, schémas multiples et SQL spécialisé mal servis).
- **`pgtyped` / `@ts-safeql`** : typent le SQL brut depuis la base, bonne piste ; non retenus pour l'instant car ils demandent une base vivante à la compilation et ajoutent un outillage comparable à A. Ils restent une option du spike si B s'avère insuffisant.
- **`any` / casts libres** : état actuel, rejeté.
