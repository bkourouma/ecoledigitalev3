Dans le dépôt EcoleDigitaleV2 (monorepo pnpm : `apps/api` Fastify, `apps/web`
Next.js 15 App Router, `packages/contracts` Zod, PostgreSQL avec RLS).

# Ce qu'il faut faire

Refondre l'écran **Validation des séances** du Module Professionnel :
`apps/web/src/app/professionnel/admin/remuneration/seances/page.tsx`
(URL : `/professionnel/admin/remuneration/seances`)

Aujourd'hui cet écran liste TOUTES les séances, validées comprises. Or il sert à
traiter ce qui reste à faire : les séances déjà validées le polluent.

## 1. Deux onglets

**« À traiter »** (par défaut) — uniquement les séances **non encore validées**.
C'est le plan de travail du comptable.

**« Historique »** — les séances **déjà validées**, en lecture. Y afficher en
plus, par séance : la date de validation, son auteur, et l'état du paiement
auquel elle est rattachée s'il existe (`paiement_statut`).

Les compteurs du haut (Séances affichées / À valider / Payables / Heures
payables) doivent refléter l'onglet actif.

## 2. Trois filtres à ajouter

**Session (cohorte)** — c'est l'entrée métier principale : ce sont les sessions
qui portent les cours, donc les heures. Voir `/professionnel/admin/sessions`.

**Année scolaire** — dérivée de la date des séances, avec le pivot de septembre
déjà utilisé ailleurs. Reprendre EXACTEMENT la fonction `anneeScolaireOf` de
`apps/web/src/app/professionnel/admin/presences/page.tsx` (ligne ~57) :
une date au mois ≥ 9 appartient à « AAAA-AAAA+1 », sinon « AAAA-1-AAAA ».
S'inspirer de l'ergonomie des filtres de cette page.

**Filière** si c'est cohérent avec le filtre Session (optionnel).

Conserver les filtres existants : enseignant, dates, statut, payabilité,
« avec présences saisies ».

# Ce qui existe déjà — ne pas le refaire

L'API supporte **déjà** `ueSessionId` et `validated` :
`GET /api/v1/professional/remuneration/seances`
Schéma : `ProfessionalSeancePaieQuerySchema` dans
`packages/contracts/src/professional-remuneration.ts`.

Champs acceptés : `enseignantId`, `ueSessionId`, `ecueId`, `fromDate`, `toDate`,
`statut`, `validated`, `payable`, `hasAttendance`, `limit`, `offset`.

Le hook web est `useSeancesPaie` dans
`apps/web/src/lib/hooks/use-professional-remuneration.ts`.

Pour la liste des cohortes : `useProfessionalUeSessionsList` dans
`apps/web/src/lib/hooks/use-professional-catalog-admin.ts`.

**L'année scolaire n'existe PAS côté API.** Deux options — choisir et justifier :
soit filtrer côté client sur les séances déjà chargées (simple, mais faux dès
que la pagination tronque), soit ajouter `anneeScolaire` au schéma et à la
requête SQL (plus juste). Je penche pour la seconde.

# Contraintes à respecter absolument

**Ne pas toucher aux règles de payabilité.** Le prédicat vit à UN SEUL endroit :
`SEANCE_PAYABLE_PREDICATE` dans
`apps/api/src/services/professional-seance-validation.service.ts`.
Il est importé par le collecteur d'heures (`hour-collectors/professional-hour-collector.ts`)
et par la validation en lot. Le recopier ailleurs a déjà causé un bug où l'écran
annonçait des séances validables que le serveur refusait.

**Ne pas dupliquer le calcul.** Cet écran ne calcule aucun montant : il prépare
la source d'heures. Le moteur est `apps/api/src/services/payment-calculator.ts`.

**Thème sombre.** L'application est en sombre par défaut avec des tokens
sémantiques. Utiliser `bg-background`, `text-foreground`, `border-input`,
`text-muted-foreground`, `bg-muted`, `bg-card` — jamais `bg-gray-50`,
`text-gray-600` ni `bg-white`, qui deviennent illisibles.

**Tableau responsive.** Le conteneur applicatif est en `overflow-x-hidden`
(`apps/web/src/components/layout/Layout.tsx`) : ce qui dépasse est COUPÉ sans
barre de défilement. Garder les libellés tronqués (`truncate` + `title`), les
colonnes secondaires masquées aux petites largeurs (`hidden lg:table-cell`), et
une largeur totale qui tient dans ~1300 px.

**Isolation multi-tenant** : toutes les requêtes passent par
`ProfessionalBaseService.withTenant` (GUC `app.tenant_id`).

# Vérification

Après implémentation, lancer avec l'API démarrée :

    node scripts/verify-remuneration-031.js

25 invariants doivent passer. Ils couvrent la payabilité, l'idempotence du
recalcul et les verrous — si l'un tombe, la refonte a cassé la chaîne de paie.

Jeu de démonstration : `node scripts/seed-remuneration-professionnelle.js`
(attention : remet les séances de juillet 2026 à « planifiée »).

Contexte fonctionnel complet : `docs/workflow-paie-enseignants.md`.
Spécification : `specs/031-remuneration-professionnelle/`.

# Ce que je veux en retour

Les écrans vérifiés dans un navigateur, pas seulement compilés : capture ou
description de ce qui s'affiche réellement dans les deux onglets, filtres
appliqués.
