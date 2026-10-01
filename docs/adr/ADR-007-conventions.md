# ADR-007 — Conventions : UUID, montants, dates, i18n et nommage

- **Statut :** Accepté
- **Date :** 2026-10-01
- **Références :** plan section 3.4 et 3.14 ; PRD (pays, devise, langue) ; ADR-002, ADR-005

## Contexte

Le produit vise d'abord la Côte d'Ivoire (XOF, français, fuseau `Africa/Abidjan`), avec l'ambition d'ajouter d'autres pays et d'autres devises via un `CountryProfile`. Le code actuel mélange des conventions : identifiants entiers et UUID, montants parfois en flottants, chaînes en français ou en anglais dans les identifiants, absence d'i18n. Ces choix coûtent cher à corriger plus tard ; on les fixe avant d'écrire le premier module.

## Décision

**1. Identifiants.** UUID partout (v4 ou v7 ; v7 recommandé pour la localité d'index), type `uuid` en base, générés côté application par `packages/kernel` (`newId()`) avec défaut `gen_random_uuid()`. Pas de clé fonctionnelle comme clé primaire. Les identifiants lisibles par l'humain (matricule, numéro de reçu) sont des colonnes séparées, uniques par tenant.

**2. Montants.**
- Stockés en **entiers** : unité mineure de la devise (`bigint`). Le XOF n'ayant pas de sous-unité, 1 000 FCFA est stocké `1000`. Aucune colonne `float`/`real`/`double` pour de l'argent.
- Chaque montant est accompagné d'un code devise ISO 4217 (`currency`) ; l'exposant (0 pour XOF, 2 pour EUR) vient de la table des devises, jamais d'une constante.
- Dans le code : type `Money { amount: bigint; currency }` dans `packages/kernel`. Les arrondis de répartition (échéanciers, remises) utilisent des règles explicites et testées, sans flottants. Dans les contrats JSON, le montant est un entier ou une chaîne décimale entière ; pas de nombre à virgule.
- Les notes et seuils académiques ne sont **pas** des montants : ils utilisent l'arithmétique décimale du Rules Engine (ADR-003).

**3. Dates et heures.** Horodatages en **UTC** (`timestamptz`) en base et dans les API (ISO 8601 avec `Z`). Conversion vers le fuseau du `CountryProfile` (`Africa/Abidjan`, UTC+0 sans changement d'heure) **à l'affichage uniquement**. Les dates sans heure (naissance, début d'année scolaire) sont de type `date`, sans fuseau. Le code passe par une horloge injectée (`Clock`) pour rendre les tests déterministes ; pas de `new Date()` direct dans les modules.

**4. Internationalisation.** Locale par défaut `fr-CI` ; `next-intl` côté web. Les textes affichés sont dans des catalogues de messages, pas dans les composants. Les formats (nombres, dates, devises) passent par `Intl` avec la locale du `CountryProfile` ; XOF affiché sans décimale (« 25 000 FCFA »). Les messages d'erreur de l'API portent un **code stable** (`grade.already_published`) que le web traduit ; le Rules Engine renvoie ses erreurs de publication en français.

**5. Nommage.**
- **Identifiants de code en anglais** : tables, colonnes, schémas, fonctions, types, routes, clés d'événements, permissions (`grade.publish`), valeurs d'énumération (`PUBLISHED`).
- **Libellés utilisateur en français** : interface, e-mails, PDF, messages d'erreur affichés, noms de rôles et de gabarits. Ils vivent dans des catalogues ou des tables de données (donnée de pack), pas dans la logique.
- Base : `snake_case` pour tables et colonnes, noms de tables au pluriel, `tenant_id` en première colonne métier, `created_at`/`updated_at` systématiques. Code TypeScript : `camelCase` pour variables, `PascalCase` pour types.
- Termes métier en anglais stabilisés dans un glossaire du dépôt (par exemple `Enrollment` = inscription, `Guardian` = tuteur, `Classroom` = classe, `ReportCard` = bulletin) pour que code et PRD se recoupent.

## Conséquences

- Pas de perte de précision financière ; les tests de calcul sont exacts.
- L'ajout d'un pays ou d'une devise relève de données (`CountryProfile`), pas de code.
- Le glossaire anglais/français évite les doubles vocabulaires (`etudiant`/`student`) qui existent aujourd'hui dans le code.
- Un linter (règles ESLint et un test sur le catalogue) interdit les colonnes monétaires en flottant, les accents dans les identifiants et `new Date()` dans `modules/**`.
- Les montants `bigint` demandent un traitement explicite en JSON (sérialisation en chaîne ou en nombre sûr) ; à encapsuler dans `kernel` pour que le reste du code l'ignore.

## Alternatives rejetées

- **`numeric(12,2)` pour les montants** : inutilement général pour le XOF et source d'erreurs d'arrondi côté JavaScript.
- **Flottants** : erreurs d'arrondi inacceptables en finance.
- **Entiers auto-incrémentés comme identifiants** : fuite de volumétrie, collisions à l'import, énumération des ressources.
- **Stocker l'heure locale** : ambiguïtés et conversions silencieuses ; l'UTC est la seule référence stable.
- **Identifiants et libellés en français** : mélange avec les API et bibliothèques anglophones, accents dans le code ; la traduction se fait à l'affichage.
