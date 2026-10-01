# ADR-006 — Un schéma Postgres par module et reset de la base

- **Statut :** Accepté
- **Date :** 2026-10-01
- **Références :** plan D2, D7, D8, sections 3.4 et 5.3 ; ADR-001, ADR-002

## Contexte

La base actuelle est le produit de **164 migrations SQL** accumulées, plus un Prisma partiel (tables Imhotep) avec un contournement `_prisma_migrations` dans le script de déploiement. Toutes les tables vivent dans le schéma `public`, sans appartenance claire à une fonctionnalité. Deux piles académiques et trois piles de paiement coexistent.

Le plan décide d'unifier le cœur académique (D2), de supprimer Imhotep (D7) et part de l'hypothèse qu'**aucune donnée de production n'est à préserver** (D8). L'ADR-001 donne à chaque module la propriété de ses tables.

## Décision

**1. Un schéma Postgres par module.** Le schéma porte le nom court du module : `platform` (tenants, plans, entitlements, outbox), `iam`, `audit`, `academic`, `assess`, `finance`, `documents`, `comms`, etc. Chaque module crée et migre uniquement son schéma. Pas de clé étrangère inter-modules vers une table interne : on référence par identifiant (UUID) et on vérifie par l'API publique du module. Exception admise : références vers `platform.tenants` (clé d'isolation).

**2. Migrations.** Fichiers SQL conservés, un répertoire par module (`modules/<module>/migrations/NNNN_description.sql`), exécutés par un runner à checksum (une table de suivi par dossier de migrations : `public.schema_migrations` pour la baseline, `schema_migrations_<module>` pour chaque module ; version, nom, checksum, date). Un fichier appliqué ne se modifie jamais ; une divergence de checksum fait échouer le démarrage. Les migrations sont jouées par le rôle `migrator` (ADR-002). L'ordre d'exécution suit la dépendance des modules (la baseline `kernel` d'abord). Prisma et `_prisma_migrations` sont conservés jusqu'au reset de la Phase 2 (ils portent le chemin de migration de production du legacy), puis supprimés avec la baseline v2.

**3. Reset de la base (baseline v2).**
- Avant toute suppression : dump complet de la base (tâche 0.7) et vérification qu'aucun tenant réel n'a de données à conserver (hypothèse D8, à reconfirmer).
- Les 164 migrations historiques sont **archivées sous le tag git `legacy-final`** (le tag pointe sur le dernier commit qui les contient), puis retirées de l'arbre principal quand la dernière tranche de la phase 2 est terminée.
- Le schéma v2 est posé **module par module** à partir d'une base vide ; l'ancien schéma `public` coexiste tant que des tranches de la phase 2 n'ont pas remplacé leurs tables (chaque tranche supprime les anciennes tables qu'elle remplace).
- Les environnements de démo, de test et d'e2e sont reconstruits par **seeds déterministes** (un jeu par pack), qui servent aussi aux tests de caractérisation (tranche 2.0).
- Toute exécution destructive en production (suppression de tables, reset) requiert la **confirmation explicite** du responsable, après sauvegarde vérifiée.

## Conséquences

- Suppression propre : retirer un module (ou une pile historique) = retirer son code et son schéma.
- Lisibilité : le schéma d'une table indique son propriétaire ; les revues de dépendances se font sur les imports (ADR-001) et sur les clés étrangères (interdites entre modules).
- Les requêtes ne se font plus dans `public` : le `search_path` de `app_user` est fixé, et les repositories qualifient leurs tables.
- Les jointures inter-modules en SQL sont interdites ; les lectures croisées (rapports, tableaux de bord) passent par des modèles de lecture alimentés par des événements (ADR-004) ou par l'API publique. À surveiller pour la performance de l'analytique.
- Le tag `legacy-final` doit être posé et poussé avant la suppression des anciennes migrations ; sinon l'historique n'est plus consultable simplement.

## Alternatives rejetées

- **Tout dans `public` avec préfixes** (`acad_…`, `fin_…`) : aucune garantie de frontière, droits Postgres par schéma impossibles.
- **Migration des données existantes vers la nouvelle structure** : inutile selon D8 ; double écriture et scripts de reprise coûteux et risqués.
- **Conserver les 164 migrations comme base de la v2** : la structure dérive des deux piles à fusionner ; on traînerait des tables mortes et le contournement Prisma.
- **Base ou schéma par tenant** : voir ADR-002.
- **Un seul répertoire de migrations global** : conflits d'ordre entre équipes et pas de lien entre une migration et son module.
