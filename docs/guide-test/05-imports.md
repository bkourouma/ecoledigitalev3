# Chapitre 05. Imports Excel / CSV : historique, modèles, paramètres, assistant d'import et les huit importeurs

Ce chapitre couvre les écrans `app/v2/imports/**` : l'historique (`/v2/imports`), l'assistant « Nouvel import » (`/v2/imports/new`), la fiche d'un import (`/v2/imports/<identifiant>`), les modèles (`/v2/imports/templates`) et les paramètres (`/v2/imports/settings`). Module API : `apps/api/src/modules/imports` (importeurs `students`, `guardians`, `staff`, `classrooms`, `curriculum`, `enrollments`, `grades`/`grades_own`, `opening_balances` ; formats `.csv`, `.xlsx`, `.xls`, `.ods`).

**Adresses.** Le navigateur affiche exactement les routes de l'application, précédées de `/v2` (aucun préfixe supplémentaire : `next.config.js` et `middleware.ts` ne réécrivent pas `/v2`). Accès par le menu : module "Imports" > entrée "Imports Excel / CSV" (libellé fourni par l'API, portail d'administration). Un enseignant n'a pas ce menu dans son portail : il tape l'adresse (voir "À vérifier en test").

**Convention d'écriture des messages.** Les messages d'erreur du serveur (par ligne de fichier) contiennent des guillemets français dans l'application. Ils sont cités ici avec des guillemets droits `"..."` à l'intérieur du message : comparez le texte, pas le type de guillemets. Les libellés d'écran cités entre « ... » sont ceux de `apps/web/messages/fr-CI.json`. Les noms de colonnes des fichiers et les noms de cartes d'importeurs (fournis par l'API) sont écrits en `code` ou entre guillemets droits.

**Numéro de ligne.** "Ligne N" dans les erreurs est le numéro de ligne du tableur : l'en-tête est la ligne 1, la première donnée la ligne 2 (QA C-04-09 : la 5e donnée s'appelle "Ligne 6").

## Parcours conseillé

Les imports exécutés **créent des données définitives** (aucun retour arrière à l'écran). Suivez l'ordre : chaque fichier s'appuie sur les précédents.

| Ordre | Compte | Scénarios |
|---|---|---|
| A | Secrétariat | 5.1, 5.2, 5.3 (lecture de la graine, sans exécuter) |
| B | Directeur | 5.4 à 5.8 (modèles, réglages, cartes) |
| C | Secrétariat | 5.9 à 5.11 (fichiers refusés, plafonds, quota) |
| D | Secrétariat | 5.12 (élèves valides, **exécution**), 5.14, 5.15, 5.13, 5.17, 5.18 |
| E | Directeur des études | 5.20, 5.21 (classes, curriculum) |
| F | Secrétariat | 5.22 (inscriptions) |
| G | Directeur | 5.19, 5.24, 5.23 (personnel, soldes d'ouverture avec MFA, notes) et enseignant 5.23 |
| H | Secrétariat / directeur | 5.25 à 5.32 (formats, cycle de vie, modes, annulation) |
| I | Tous rôles | 5.33 à 5.36 (droits, adresses interdites, isolation, qualité) |

## Prérequis

- Environnement créé par `pnpm dev:v2:seed` (graine `scripts/seed-v2/demo/imports.ts` : un import d'élèves "eleves-demonstration.csv" validé par le secrétariat, 15 lignes, matricules `IMP-0001` à `IMP-0015`).
- Application `http://localhost:3000`, API `http://localhost:4000`, **worker démarré** : la validation et l'exécution d'un import sont faites par le worker. Sans lui, l'import reste « Validation en cours » ou « En attente de traitement ».
- Garder l'onglet au premier plan pendant la validation et l'exécution : la relecture de l'état (toutes les 1,5 s) est suspendue en arrière-plan (QA C-04-08). Si la barre reste à 0, rechargez `/v2/imports/<identifiant>`.
- Fichiers d'exemple : `docs/guide-test/jeux-de-donnees/` (préfixes `01-` à `08-`, dossier `imports-cas-limites/`). Index : `jeux-de-donnees/README.md`. Les classeurs `.xlsx`, `.xls`, `.ods` et les fichiers volumineux se régénèrent avec `node docs/guide-test/jeux-de-donnees/generer-fichiers-imports.mjs [--gros] [--enorme]`.
- Capacité de la classe 6e A (secondaire) : 40 places, capacité dure. Les scénarios exécutent au total 10 + 3 + 6 + 4 = 23 élèves (35 avec les 12 de la graine). **N'exécutez pas en plus l'import de démonstration (15 lignes)** : au-delà de 40 inscrits les lignes seraient refusées par la capacité.
- Mots de passe et codes MFA : jamais dans ce guide ; voir la page `/login`.

## Comptes

| Rôle | Collège Le Baobab | École Les Palmiers | Université Horizon | MFA |
|---|---|---|---|---|
| Secrétariat | `secretariat@secondaire-test.test` | `secretariat@primaire-test.test` | `secretariat@superieur-test.test` | oui |
| Directeur des études | `etudes@secondaire-test.test` | `etudes@primaire-test.test` | `etudes@superieur-test.test` | oui |
| Directeur | `directeur@secondaire-test.test` | `directeur@primaire-test.test` | `directeur@superieur-test.test` | oui |
| Propriétaire | `direction.generale@secondaire-test.test` | `direction.generale@primaire-test.test` | `direction.generale@superieur-test.test` | oui |
| Économe | `econome@secondaire-test.test` | `econome@primaire-test.test` | `econome@superieur-test.test` | oui |
| Enseignant / instituteur | `enseignant@secondaire-test.test` | `enseignant@primaire-test.test` | `enseignant@superieur-test.test` | non |
| Éducateur, responsable pédagogique, responsable des examens, chargé d'admissions, parent, élève (refus attendu) | `educateur@`, `pedagogie@`, `examens@`, `admissions@`, `parent@`, `eleve@` + `secondaire-test.test` | idem `primaire-test.test` | idem `superieur-test.test` | selon le rôle |

## Droits

Gardes des pages (`apps/web/src/app/v2/imports/**/page.tsx`) et des cartes (API : `imports.<...>` ET droits du module visé, `apps/api/src/modules/imports/README.md`). Un import n'est visible que par son auteur ou par qui détient `imports.manage`.

| Écran | Permission | Propriétaire / directeur | Directeur des études | Secrétariat | Économe | Enseignant / instituteur | Autres rôles |
|---|---|---|---|---|---|---|---|
| Historique `/v2/imports`, fiche `/v2/imports/<id>`, modèles | `imports.read` | oui (voit tous les imports) | oui (les siens) | oui (les siens) | oui (les siens) | oui (les siens) | refusé |
| Nouvel import `/v2/imports/new` | `imports.create` | oui | oui | oui | oui | oui | refusé |
| Paramètres `/v2/imports/settings` | `imports.manage` | oui | refusé | refusé | refusé | refusé | refusé |
| Supprimer un modèle de mapping | `imports.template.manage` | oui | refusé | refusé | refusé | refusé | refusé |
| Annuler un import en cours | `imports.cancel` | oui | oui | oui | non | oui | refusé |

Cartes d'importeurs et droit de **lancer** (en plus de `imports.create`) :

| Carte (nom affiché) | Clé | Lancer | Droits du module visé | Rôles qui lancent |
|---|---|---|---|---|
| "Élèves" | `students` | `imports.import.students` | `student.create` (+ `student.update` si "Mettre à jour", + `enrollment.create` si colonne Classe) | secrétariat, directeur, propriétaire |
| "Parents et tuteurs" | `guardians` | `imports.import.guardians` | `guardian.manage` | secrétariat, directeur, propriétaire |
| "Enseignants et personnel" | `staff` | `imports.import.staff` | `staff.create` (+ `staff.update`) | directeur, propriétaire |
| "Classes" | `classrooms` | `imports.import.classrooms` | `academic.classroom.manage` | directeur des études, directeur, propriétaire |
| "Matières et curriculum" | `curriculum` | `imports.import.curriculum` | `curriculum.manage` (+ `academic.program.manage` si colonne matière) | directeur des études, directeur, propriétaire |
| "Inscriptions" | `enrollments` | `imports.import.enrollments` | `enrollment.create` | secrétariat, directeur, propriétaire |
| "Notes" | `grades` | `imports.import.grades` | `grade.enter`, `assessment.manage` | directeur, propriétaire |
| "Notes de mes classes" | `grades_own` | `imports.import.grades_own` | `grade.enter` (sans `assessment.manage`) | enseignant, instituteur (leurs évaluations) |
| "Soldes financiers d'ouverture" | `opening_balances` | `imports.import.opening_balances` (**sensible : MFA**) | `finance.invoice.create` | directeur, propriétaire |

L'écran ne montre qu'une des deux cartes de notes : "Notes" si l'utilisateur peut l'utiliser, sinon "Notes de mes classes" (`visibleImporters`).

**Refus d'une page** : redirection serveur vers `/unauthorized` : titre "Accès refusé", texte "Vous n'avez pas les droits nécessaires pour afficher cette page.", lien "Retour à l'accueil". Une personne non connectée est renvoyée vers `/login`.

**Adresses à taper à la main, refus attendu (page "Accès refusé") :**

| Compte | Adresses |
|---|---|
| Éducateur, parent, élève, chargé d'admissions, responsable des examens, responsable pédagogique | `/v2/imports`, `/v2/imports/new`, `/v2/imports/templates`, `/v2/imports/settings` |
| Secrétariat, directeur des études, économe, enseignant | `/v2/imports/settings` |
| Tout compte sans `imports.read` | `/v2/imports/<identifiant d'un import existant>` |

## Données de départ

- Import "eleves-demonstration.csv" (auteur : secrétariat de chaque établissement), état « Prêt à importer », 15 lignes, fichier `scripts/seed-v2/demo/imports.ts`. **Défaut connu (QA C-04-10)** : le fichier utilise la colonne Classe mais la graine n'enregistre pas l'option « Année scolaire des inscriptions » : les 15 lignes sont en erreur ("La colonne "Classe" exige l'option "Année scolaire des inscriptions".", code `imports.options_invalid`). Le guide historique annonçait "15 à créer" : c'est faux sans correction (scénario 5.3).
- 12 élèves de la graine, de numéros d'élève (matricule de la plateforme) `00001` à `00012` dans l'ordre de l'annexe (DIABATE Nadia = `00001`, N'GUESSAN Aya = `00012`, rapports QA 07 et 13) ; les 8 premiers ont une inscription confirmée en 6e A (`6E-A`), les 4 autres sont en attente. Seules les inscriptions confirmées (`ACTIVE`) figurent sur une feuille de notes.
- Classes de la graine : `6E-A` (secondaire, programme `COLLEGE`, niveau `6E`), `CP1-A` (primaire, `PRIMAIRE`, `CP1`), `L1-A` (supérieur, `INFO`, `L1`). Financement par défaut `PRIVATE`.
- Catégories de personnel : `TEACHER` (Enseignant), `EDUCATOR` (Éducateur), `ADMIN` (Personnel administratif), `DIRECTION`, `SUPPORT` ; liens de parenté : `FATHER` (Père), `MOTHER` (Mère), `LEGAL_GUARDIAN` (Tuteur légal), `GRANDPARENT`, `SIBLING`, `UNCLE_AUNT`, `EMERGENCY_CONTACT`, `OTHER` (`apps/api/src/modules/people/domain/reference-data.ts`). Le fichier accepte le code ou le libellé, sans tenir compte des accents ni de la casse ("MERE" = "Mère").
- Programmes du modèle de pack : `COLLEGE` (niveaux `6E`, `5E`, `4E`, `3E`), `LYCEE` (`2NDE`, `1ERE`, `TLE`) ; primaire `MATERNELLE`, `PRIMAIRE` (`CP1` à `CM2`) ; le programme `INFO` du supérieur est créé par la graine avec le seul niveau `L1`. Types de noeud : `LEVEL`, `PERIOD`, `GROUP`, `UE`, `ECUE`, `SUBJECT`.
- Réglages par défaut : 5 000 lignes, 100 colonnes, 5 Mo, lots de 200, "tout ou rien" jusqu'à 5 000 lignes, 5 imports actifs, 50 par 24 h, conservation 30 jours (`DEFAULT_SETTINGS`, `domain/records.ts`).

## Référence des gabarits (tels que l'application les fournit)

### Règles communes à tous les fichiers

| Sujet | Règle (source : `infrastructure/files/*.ts`, `domain/coerce.ts`) |
|---|---|
| Formats | `.csv`, `.tsv`, `.txt` (texte), `.xlsx`, `.xls`, `.ods` ; le type réel est lu sur les octets, l'extension et le type annoncé ne servent qu'à repérer une incohérence |
| CSV du gabarit | UTF-8 **avec BOM**, séparateur `;`, fins de ligne CRLF, première ligne = libellés de colonnes **sans astérisque**, puis 2 ou 3 lignes d'exemple fictives |
| CSV accepté en entrée | UTF-8 avec ou sans BOM, UTF-16 avec BOM, repli windows-1252 ; séparateur détecté parmi `;` `,` tabulation ; guillemets doublés, sauts de ligne entre guillemets |
| XLSX du gabarit | feuille "Données" (en-têtes + exemples) et feuille "Aide" (Champ, Obligatoire, Type, Description, Exemple) ; cellules en texte |
| Feuille lue | la première feuille visible, ou celle nommée dans « Feuille (facultatif) » (insensible à la casse ; sinon "La feuille "X" n'existe pas dans le classeur.") |
| Limites par défaut | 5 Mo, 5 000 lignes de données, 100 colonnes, 2 000 caractères par cellule ; plafonds du produit : 20 Mo, 20 000 lignes, 200 colonnes |
| Lignes vides | ignorées (le numéro de ligne reste celui du tableur) |
| Dates | `JJ/MM/AAAA` ou `AAAA-MM-JJ` (séparateurs `/`, `-`, `.`) ou numéro de série Excel ; année à 2 chiffres refusée ; "31/02/2014" refusée |
| Entiers / montants | séparateurs de milliers admis (espace, apostrophe) : "75 000" valide ; "1500,00" accepté ; "1500,5" et "1.500" refusés ; jamais d'arrondi |
| Décimaux (notes, coefficients) | virgule ou point ; au plus 4 décimales côté fichier |
| Oui / non | oui, o, yes, y, true, vrai, 1, x / non, n, no, false, faux, 0 |
| Sexe | M, H, masculin, homme, garçon, male / F, féminin, femme, fille, female |
| Téléphone | 6 à 15 chiffres, séparateurs `+ . - ( )` et espaces admis |
| Code | lettres, chiffres, `_` `.` `-` ; minuscules mises en majuscules, espaces en `_` ; 60 caractères au plus |
| Doublon dans le fichier | la première ligne reste, les suivantes sont refusées : "Cette ligne répète la ligne N du fichier (même identifiant) : elle est ignorée." |

### Élèves (`students`) : modèle `modele-import-students.csv`

Options : « Année scolaire des inscriptions » (facultative en apparence, **obligatoire dès que la colonne Classe est associée**) ; "Doublons probables (même nom et même naissance)" : "Refuser (recommandé)" ou "Créer malgré le doublon". Politique "existant" : ignorer ou mettre à jour (`student.update`). Idempotence : matricule d'origine, sinon n° national, sinon nom + naissance.

| En-tête exact | Obligatoire | Type | Longueur max | Exemple du modèle |
|---|---|---|---|---|
| `Matricule d'origine` | non (recommandé : rend l'import rejouable) | texte | 100 | 2024-0001 |
| `Nom` | oui | texte | 120 | KONE |
| `Prénoms` | oui | texte | 120 | Aminata |
| `Sexe` | oui | texte | M ou F (voir ci-dessus) | F |
| `Date de naissance` | non | date | | 03/04/2012 |
| `Lieu de naissance` | non | texte | 160 | Abidjan |
| `Nationalité (code pays)` | non | code à 2 lettres | | CI |
| `N° national` | non | texte | 60 | 20120403-AB12 |
| `N° acte de naissance` | non | texte | 80 | 123/2012 |
| `E-mail` | non | e-mail | 320 | (vide) |
| `Téléphone`, `Téléphone secondaire` | non | téléphone | 40 | 07 01 02 03 04 |
| `Adresse` / `Ville` / `Résidence` | non | texte | 300 / 120 / 200 | Cocody, Riviera 2 / Abidjan / Riviera 2 |
| `Classe (code)` | non | code | 60 | 6EME_A (n'existe pas dans la graine) |
| `Financement (code)` | non | code | 60 | PRIVATE |
| `Référence d'affectation` | non | texte | 100 | (vide) |

Lignes d'exemple : KONE Aminata (2024-0001) et TRAORE Ibrahim (2024-0002), classe `6EME_A`.

### Parents et tuteurs (`guardians`) : `modele-import-guardians.csv`

Option : "Doublons probables (même nom, même téléphone)". Un tuteur de plusieurs enfants occupe plusieurs lignes ; identité = nom + prénoms + (téléphone, sinon e-mail) ; il n'est créé qu'une fois, chaque ligne crée un lien.

| En-tête exact | Obligatoire | Type / valeurs | Exemple |
|---|---|---|---|
| `Matricule de l'élève` | oui | matricule d'origine ou n° d'élève existant | 2024-0001 |
| `Nom du tuteur`, `Prénoms du tuteur` | oui | texte (120) | KONE, Mariam |
| `Sexe du tuteur` | non | M / F | F |
| `Téléphone`, `Téléphone secondaire`, `E-mail` | non | téléphone, e-mail | 07 01 02 03 04 |
| `Adresse`, `Ville`, `Profession`, `Employeur` | non | texte (300, 120, 160, 160) | Cocody, Riviera 2 / Abidjan / Commerçante |
| `Lien de parenté` | oui | code ou libellé du lien (60) | MERE |
| `Contact principal`, `Contact d'urgence`, `Répondant financier`, `Autorité parentale`, `Autorisé à récupérer l'enfant`, `Accès au portail` | non | oui / non | oui, oui, oui, oui, oui, non |

### Enseignants et personnel (`staff`) : `modele-import-staff.csv`

Option : doublons probables. Politique : ignorer / mettre à jour (`staff.update`). Idempotence : matricule d'origine, sinon e-mail, sinon nom + naissance.

| En-tête exact | Obligatoire | Type | Exemple |
|---|---|---|---|
| `Matricule d'origine` | non | texte (100) | ENS-014 (modèle : ENS-001) |
| `Nom`, `Prénoms` | oui | texte (120) | YAO, Kouadio |
| `Sexe`, `Date de naissance`, `Lieu de naissance`, `Nationalité (code pays)` | non | M/F, date, texte, code | M, 15/08/1985, Yamoussoukro, CI |
| `E-mail`, `Téléphone`, `Adresse`, `Ville` | non | | k.yao@exemple.ci, 07 22 33 44 55, Yopougon Niangon, Abidjan |
| `Catégorie` | oui | code ou libellé (60) | ENSEIGNANT |
| `Poste` | non | texte (160) | Professeur de mathématiques |
| `Date d'embauche` | non | date | 01/09/2015 |

### Classes (`classrooms`) : `modele-import-classrooms.csv`

Options obligatoires : "Établissement", "Année scolaire". Clé : établissement + année + code. Politique : ignorer / mettre à jour (nom, effectif, dates).

| En-tête exact | Obligatoire | Type | Exemple (modèle) |
|---|---|---|---|
| `Code de la classe` | oui | code (60) | 6EME_A |
| `Nom de la classe` | oui | texte (160) | 6ème A |
| `Programme (code)` | oui | code | COLLEGE |
| `Niveau (code)` | oui | code | 6EME (le code réel est `6E`) |
| `Effectif maximal` | non | entier de 1 à 10 000 | 45 |
| `Début`, `Fin` | non | date (dans l'année) | (vides) |

### Matières et curriculum (`curriculum`) : `modele-import-curriculum.csv`

Option obligatoire : "Version de curriculum (brouillon)" (seule une version en brouillon accepte des noeuds). Un parent doit être déclaré plus haut dans le fichier ou exister déjà. Coefficients et crédits sont repris tels quels.

| En-tête exact | Obligatoire | Type | Exemple |
|---|---|---|---|
| `Code du noeud` | oui | code (60) | MATHS |
| `Libellé` | oui | texte (160) | Mathématiques |
| `Type de noeud (code)` | oui | code | SUBJECT |
| `Code du parent` | non | code | (vide) |
| `Code de la matière` | non | code (créée depuis le libellé si inconnue) | MATHS |
| `Niveau (code)` | non (exigé par un noeud LEVEL) | code | |
| `Coefficient`, `Crédits`, `Volume horaire total` | non | décimal positif | 4, (vide), 120 |
| `Type de période (code)` + `N° de période` | non (le second est exigé avec le premier) | code + entier 1 à 99 | |
| `Ordre d'affichage` | non | entier 0 à 100 000 | 1 |
| `Obligatoire` | non | oui / non | oui |

### Inscriptions (`enrollments`) : `modele-import-enrollments.csv`

Option obligatoire : « Année scolaire des inscriptions » (année brouillon ou ouverte seulement). Aucune fiche élève n'est créée. Pas de mise à jour.

| En-tête exact | Obligatoire | Type | Exemple |
|---|---|---|---|
| `Matricule de l'élève` | oui | matricule d'origine, n° d'élève ou n° d'inscription (120) | 2024-0001 |
| `Classe (code)` | oui | code (60) | 6EME_A |
| `Financement (code)` | non | code (défaut : privé) | PRIVATE |
| `Référence d'affectation` | non | texte (100) | |
| `Date d'inscription` | non (défaut : aujourd'hui) | date | |

### Notes (`grades`, `grades_own`) : `modele-import-grades.csv`

Option obligatoire : "Évaluation" (brouillon seulement). Aucun calcul : la note est transmise telle quelle (barème et décimales contrôlés par le module des évaluations). Idempotence : une note identique est ignorée.

| En-tête exact | Obligatoire | Type | Exemple |
|---|---|---|---|
| `Matricule de l'élève` | oui | matricule d'origine ou n° d'élève | 2024-0001 |
| `Note ou code` | oui | note (14,5) ou `ABS` (absent), `ABJ` (absent justifié), `DISP` (dispensé) | 14,5 / ABS / 9 |
| `Observation` | non | texte (500) | Absent le jour du devoir |

### Soldes financiers d'ouverture (`opening_balances`) : `modele-import-opening_balances.csv`

Option obligatoire : "Année scolaire par défaut des factures (ex. 2024-2025)" (texte). Importeur sensible : MFA au lancement. Pas de mise à jour. Idempotence : référence.

| En-tête exact | Obligatoire | Type | Exemple |
|---|---|---|---|
| `Référence` | oui | texte (100), unique | REPRISE-2025-0001 |
| `Matricule de l'élève` | oui | matricule d'origine ou n° d'élève | 2024-0001 |
| `Type` | non | FACTURE (défaut) ou AVOIR | FACTURE |
| `Montant (FCFA)` | oui | entier de 1 à 2 000 000 000 | 150000 |
| `Libellé` | non | texte (300) | Solde scolarité 2024-2025 |
| `Année scolaire` | non (défaut : l'option) | texte (20) | 2024-2025 |
| `Échéance` | non | date | 31/12/2025 |
| `Facture visée (avoir)` | oui pour un AVOIR | référence d'une facture de reprise | |
| `Motif de l'avoir` | oui pour un AVOIR | texte (300) | |

## Scénarios

### A. Écrans de lecture et de réglage

#### 5.1 Historique des imports
Compte : secrétariat (Collège Le Baobab) · Où : menu "Imports" > "Imports Excel / CSV" (`/v2/imports`) · Prérequis : graine.
1. Ouvrir l'entrée du menu. Lire le titre "Imports Excel et CSV" et la barre d'onglets : « Historique », « Nouvel import », « Modèles » (pas de « Paramètres » pour ce compte).
2. Lire le tableau (légende "Historique des imports") : colonnes Fichier, Données, État, Lignes, Durée, Date.
3. Repérer la ligne "eleves-demonstration.csv", Données "Élèves", État « Prêt à importer », Lignes "15 ligne(s)".
4. Filtre « Type de données » = "Parents et tuteurs" : « Aucun import pour le moment. » avec l'aide "Lancez un premier import pour intégrer vos élèves ou vos enseignants." Remettre « Tous ».
5. Filtre « État » = « Terminé » : liste vide ; remettre « Tous ».
6. Cliquer sur le nom du fichier : la fiche s'ouvre (5.2).
Résultat attendu : un seul import visible (celui du secrétariat) ; le bouton « Nouvel import » est proposé ; aucun import d'un autre utilisateur n'apparaît.
Cas invalides : sans objet (lecture). Avec le compte directeur, l'historique montre en plus les imports des autres.
- [ ] Cas nominal  - [ ] Filtres  - [ ] Droit refusé pour éducateur (`/v2/imports`)

#### 5.2 Fiche d'un import (`/v2/imports/<identifiant>`) : import de démonstration
Compte : secrétariat · Où : clic sur "eleves-demonstration.csv" · Prérequis : 5.1.
1. L'assistant s'ouvre à l'étape « 4. Erreurs et aperçu avant import » ; titre de page "Importer des données", sous-titre "Fichier : eleves-demonstration.csv", pastille « Prêt à importer ».
2. La liste d'étapes montre : Fichier, Colonnes, Validation, Aperçu, Import, Rapport (l'étape « Validation » porte aussi "et erreurs" pour les lecteurs d'écran).
3. Lire les compteurs : « À créer » 0, « À mettre à jour » 0, « À ignorer » 0, « En erreur » 15, « Avertissements » 0.
4. Section « Problèmes les plus fréquents » : "15 ×" suivi du message `La colonne "Classe" exige l'option "Année scolaire des inscriptions".` et du code `imports.options_invalid`.
5. Section « Erreurs du fichier » : la liste « Problèmes par ligne » ; la case « Seulement les lignes à problème » est décochée ; ouvrir « Voir les valeurs du fichier » pour la ligne 2 : la valeur `IMP-0001` est affichée.
6. Le bouton « Lancer l'import » est inactif (case de confirmation décochée ; de plus 0 ligne à écrire).
7. Noter le lien en bas : « Retour à l'historique ».
Résultat attendu : défaut connu C-04-10 : aperçu avec 15 erreurs alors que l'état est « Prêt à importer ». Ne rien lancer.
Cas invalides : | Saisie | Message attendu |
|---|---|
| `/v2/imports/00000000-0000-0000-0000-000000000000` (identifiant inexistant) | bloc d'erreur "Import introuvable (00000000-0000-0000-0000-000000000000)." avec bouton de nouvel essai |
| `/v2/imports/abc` (identifiant mal formé) | bloc d'erreur "Données invalides." (à vérifier en test) |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour parent (`/v2/imports/<identifiant>`)

#### 5.3 Corriger l'aperçu sans exécuter (relecture de l'aperçu)
Compte : secrétariat · Où : fiche de l'import de démonstration · Prérequis : 5.2.
1. Cliquer « Modifier les colonnes » : retour à l'étape « 2. Associer les colonnes du fichier » (état « Colonnes associées »).
2. Constater que les 18 champs sont déjà associés et que la section « Options de l'import » contient « Année scolaire des inscriptions » (vide, "Choisir…") et "Doublons probables (même nom et même naissance)" ("Refuser (recommandé)").
3. Choisir l'année "Année scolaire 2026-2027 (courante)" (le texte exact dépend de l'année de la base). Laisser « Ignorer les lignes déjà présentes ».
4. Cliquer « Enregistrer et valider le fichier » ; attendre la barre « Validation des lignes » puis l'étape « 4. Erreurs et aperçu avant import ».
5. Lire : « À créer » 15, « En erreur » 0, message "Aucune erreur : toutes les lignes sont valides.", et "Cet aperçu n'écrit rien : les données ne seront créées qu'après votre confirmation ci-dessous."
6. **Ne pas lancer.** Quitter par « Retour à l'historique » : l'import reste « Prêt à importer ». Le rouvrir par `/v2/imports/<identifiant>` : l'étape « Aperçu » est retrouvée ("Vous pouvez quitter cette page : l'import est conservé." s'affiche sous les étapes « Colonnes »).
Résultat attendu : l'aperçu se recalcule sans rien écrire ; la liste `/v2/students` ne compte aucun nouvel élève.
Cas invalides : | Saisie | Message attendu |
|---|---|
| Laisser « Année scolaire des inscriptions » vide puis valider | sous le champ : "Cette option est obligatoire." si l'option était exigée ; pour les élèves elle ne l'est pas : les 15 lignes reviennent en erreur (même message qu'en 5.2) |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Aucune écriture constatée

#### 5.4 Modèles de fichier : télécharger et contrôler les gabarits
Compte : directeur · Où : « Modèles » (`/v2/imports/templates`) · Prérequis : aucun. (Les téléchargements demandent l'autorisation du navigateur ; un agent doit la demander.)
1. Ouvrir l'onglet « Modèles ». Lire "Modèles de fichier à remplir et modèles de mapping de votre établissement." et "Chaque modèle contient les colonnes attendues et des lignes d'exemple fictives ; le modèle Excel a une feuille d'aide."
2. Pour chaque carte (neuf importeurs côté direction, huit si l'on compte "Notes de mes classes" à part : la page liste tous les importeurs de l'API), cliquer « CSV » puis « Excel ». Noms attendus : `modele-import-<clé>.csv` et `modele-import-<clé>.xlsx`.
3. Ouvrir chaque CSV (Bloc-notes, encodage UTF-8) : séparateur `;`, en-têtes identiques à la colonne "En-tête exact" des tableaux de "Référence des gabarits", 2 ou 3 lignes d'exemple.
4. Ouvrir chaque .xlsx : feuille "Données" et feuille "Aide" (colonnes Champ, Obligatoire, Type, Description, Exemple).
Résultat attendu : 9 CSV + 9 XLSX ; aucune cellule du modèle ne commence par `=`, `+`, `-`, `@` ; les lignes d'exemple sont fictives.
Cas invalides : un compte sans `imports.read` (éducateur) tape l'adresse : "Accès refusé".
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour éducateur

#### 5.5 Importer un modèle tel quel (erreurs attendues)
Compte : secrétariat puis directeur des études · Où : « Nouvel import » · Prérequis : 5.4 (fichiers téléchargés).
1. Secrétariat : importer `modele-import-students.csv` tel quel, importeur "Élèves", option année = année courante. Résultat : les deux lignes (2024-0001, 2024-0002) sont en erreur : `Classe "6EME_A" inconnue pour cette année scolaire.` (colonne Classe (code), code `imports.reference_unknown`).
2. Même fichier **sans** choisir l'année : `La colonne "Classe" exige l'option "Année scolaire des inscriptions".`
3. Secrétariat : `modele-import-guardians.csv` : `Aucun élève avec le matricule "2024-0001" (importez d'abord les élèves).`
4. Directeur des études : `modele-import-classrooms.csv` (établissement et année à choisir) : la ligne est en erreur `Niveau "6EME" inconnu (niveaux : ...)` ; le programme `COLLEGE` est accepté.
5. Ne rien lancer (aucune ligne valide).
Résultat attendu : le gabarit n'est pas adapté à la graine (codes `6EME_A`, `6EME`) ; aucun import ne peut être lancé.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour éducateur

#### 5.6 Modèles de mapping : enregistrer, réutiliser, supprimer
Compte : directeur · Où : étape « 2. Associer les colonnes du fichier » puis « Modèles » · Prérequis : 5.12 jusqu'à l'étape des colonnes (fichier `01-students-entetes-libres-secondaire.csv`, 5.27).
1. Dans « Modèles », section « Modèles de mapping enregistrés » : « Aucun modèle enregistré. » et l'aide "Enregistrez-en un depuis l'étape "Colonnes" d'un import."
2. Téléverser `01-students-entetes-libres-secondaire.csv` (importeur "Élèves"). À l'étape des colonnes, cocher « Enregistrer ce mapping comme modèle », saisir « Nom du modèle » = `Modèle élèves test guide`.
3. Cliquer « Enregistrer et valider le fichier ».
4. Retour sur « Modèles » : la ligne `Modèle élèves test guide` (colonnes Nom, Données, Champs associés, Modifié le).
5. Nouvel import avec le même fichier : la liste « Appliquer un modèle enregistré » propose le modèle, présélectionné (au moins 80 % des en-têtes identiques).
6. Retour sur « Modèles » : « Supprimer » puis « Confirmer la suppression » (ou « Annuler »).
Résultat attendu : modèle créé, proposé, supprimé ; un modèle du même nom pour le même importeur est refusé : "Un modèle de ce nom existe déjà pour cet importeur."
Cas invalides : | Saisie | Message attendu |
|---|---|
| Cocher l'enregistrement sans nom | "Donnez un nom au modèle." (champ) |
| Même nom deux fois (casse ignorée) | "Un modèle de ce nom existe déjà pour cet importeur." |
| Secrétariat (sans `imports.template.manage`) tente l'enregistrement | refus du serveur affiché en haut de l'étape (à vérifier en test : libellé exact du refus) ; pas de bouton « Supprimer » dans « Modèles » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour secrétariat

#### 5.7 Paramètres des imports
Compte : directeur · Où : « Paramètres » (`/v2/imports/settings`) · Prérequis : aucun. **Ces réglages sont partagés par tous les testeurs : restaurer les valeurs d'origine à la fin.**
1. Lire "Paramètres des imports" et "Plafonds et quotas de l'établissement. Les limites du produit ne sont pas modifiables."
2. Huit champs avec leur maximum : « Lignes par fichier » (5000, max 20000), « Colonnes par fichier » (100, max 200), « Taille du fichier (Mo) » (5, max 20), « Lignes par lot d'écriture » (200, max 500), "Lignes en mode tout ou rien" (5000), « Imports actifs en même temps » (5, max 50), « Imports par 24 heures » (50, max 1000), « Conservation des valeurs du fichier (jours) » (30, max 365).
3. Modifier « Imports par 24 heures » à 60 puis « Enregistrer » : "Paramètres enregistrés." ; recharger : 60 persiste. Remettre 50.
Résultat attendu : valeurs persistées ; les limites du produit s'affichent après chaque champ ("Maximum : …").
Cas invalides : | Saisie | Message attendu |
|---|---|
| « Lignes par fichier » = 20001 | "Entrez un nombre entier entre 1 et 20000." |
| « Taille du fichier (Mo) » = 0 ou 21 | "Entrez un nombre entier entre 1 et 20." |
| « Lignes par lot d'écriture » = 501 | "Entrez un nombre entier entre 1 et 500." |
| « Lignes par fichier » = 100 avec "Lignes en mode tout ou rien" = 200 | "Le plafond du mode "tout ou rien" ne peut pas dépasser le nombre maximal de lignes." |
| Champ vide ou décimal (12,5) | "Entrez un nombre entier entre 1 et …" |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour secrétariat (`/v2/imports/settings`)

#### 5.8 Nouvel import : cartes d'importeurs et saisies obligatoires
Compte : secrétariat puis directeur · Où : « Nouvel import » (`/v2/imports/new`).
1. Lire le titre "1. Choisir l'importeur et envoyer le fichier" et la légende « Quelles données importer ? » avec l'aide "Chaque type de données exige, en plus du droit d'importer, le droit de les créer."
2. Secrétariat : cartes utilisables "Élèves", "Parents et tuteurs", "Inscriptions" ; les autres sont grisées avec "Droits manquants : ...".
3. Directeur : toutes les cartes ; "Soldes financiers d'ouverture" porte le badge « Authentification renforcée ».
4. Cliquer la carte "Élèves" : la section "Colonnes attendues pour "Élèves"" liste les colonnes ; « obligatoire » sur Nom, Prénoms, Sexe ; boutons « Télécharger le modèle Excel » et « Télécharger le modèle CSV ».
5. Cliquer « Envoyer et continuer » sans rien choisir.
Résultat attendu : messages sous les champs.
Cas invalides : | Saisie | Message attendu |
|---|---|
| Aucun importeur choisi | "Choisissez le type de données à importer." |
| Aucun fichier | "Choisissez un fichier .xlsx, .xls, .ods ou .csv." |
| Feuille (facultatif) = `Inconnue` avec un classeur | "La feuille "Inconnue" n'existe pas dans le classeur." (voir 5.26) |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour éducateur (`/v2/imports/new`)

### B. Fichiers refusés et plafonds

#### 5.9 Fichiers refusés à l'envoi
Compte : secrétariat · Où : « Nouvel import », importeur "Élèves" · Fichiers : `jeux-de-donnees/imports-cas-limites/` (choisir "Tous les fichiers" dans la fenêtre de choix). Un refus ne crée aucun import (l'historique ne change pas).
| Fichier | Message attendu (HTTP 400) | Code |
|---|---|---|
| `vide.csv` (0 octet) | "Le fichier est vide." | `imports.file_empty` |
| `entetes-seulement.csv` | "Le fichier ne contient aucune ligne de données sous les en-têtes." | `imports.no_header` |
| `faux-fichier-pdf.csv` (PDF renommé) | "Ce fichier est un PDF. Seuls les fichiers .xlsx, .xls, .ods et .csv sont acceptés." | `imports.file_type_unsupported` |
| `faux-classeur-texte.xlsx` (texte renommé) | "Le fichier se nomme ".xlsx" mais son contenu est du texte, pas un classeur Excel." | `imports.file_type_mismatch` |
| `faux-xlsx-document-word.xlsx` (archive Word) | "Cette archive ZIP n'est pas un classeur Excel (.xlsx)." | `imports.file_type_unsupported` |
| `faux-ods-texte.ods` (texte OpenDocument) | "Cette archive n'est pas un classeur OpenDocument de type tableur." | `imports.file_type_mismatch` |
| `autre-extension.json` | "L'extension ".json" n'est pas prise en charge. Utilisez un fichier .xlsx, .xls, .ods ou .csv." | `imports.file_type_unsupported` |
| `imports-gros/trop-volumineux-5200-lignes.csv` (5,8 Mo, à générer avec `--gros`) | "Le fichier dépasse la taille autorisée (5 Mio)." | `imports.file_too_large` |
| `imports-gros/enorme-21mo.csv` (22 Mo, `--enorme`) | "Le fichier est trop volumineux." (HTTP 413, avant toute lecture ; peut être coupé plus tôt par le proxy de l'application : à vérifier en test) | `imports.file_too_large` |
Le message s'affiche en bandeau d'erreur sous le bouton « Envoyer et continuer ». Un fichier choisi puis un autre : le second remplace le premier.
- [ ] Cas nominal (9 refus)  - [ ] Aucun import créé  - [ ] Droit refusé pour éducateur

#### 5.10 Plafonds de lignes, de colonnes et de taille (via les paramètres)
Compte : directeur (réglages) puis secrétariat (envoi) · **Restaurer les réglages à la fin.**
1. Directeur, `/v2/imports/settings` : « Lignes par fichier » = 5, « Enregistrer ».
2. Secrétariat : envoyer `01-students-valide-secondaire.csv` (10 lignes) : "Le fichier dépasse 5 lignes de données." (`imports.too_many_rows`).
3. Directeur : remettre 5000 ; « Colonnes par fichier » = 5. Secrétariat : même fichier (18 colonnes) : "Le fichier compte 18 colonnes ; le maximum est 5." (`imports.too_many_columns`). Remettre 100.
4. Directeur : « Taille du fichier (Mo) » = 1. Secrétariat : envoyer `imports-gros/trop-volumineux-5200-lignes.csv` : "Le fichier dépasse la taille autorisée (1 Mio)." Remettre 5.
Résultat attendu : refus avant création de l'import ; réglages restaurés.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour secrétariat (réglages)

#### 5.11 Quota d'imports actifs (brouillons non annulables à l'écran)
Compte : secrétariat, puis directeur pour le réglage. Principe : un import dans l'état « Fichier reçu », « Colonnes associées », « Validation en cours », « Prêt à importer », « En attente de traitement » ou « Import en cours » compte comme **actif pour tout l'établissement** (pas par utilisateur). Aucun écran ne permet d'annuler ni de supprimer un brouillon (écart ci-dessous) ; l'abandon automatique intervient après 72 h (tâche nocturne).
1. Directeur : « Imports actifs en même temps » = 1.
2. Secrétariat : l'import de démonstration est déjà actif. Envoyer `01-students-valide-secondaire.csv`.
Résultat attendu : refus 409 "Trop d'imports en cours (1 au plus) : terminez ou annulez un import avant d'en commencer un autre." (`imports.quota_active_jobs`). Remettre 5 (ou 50 pour la suite des tests).
Cas invalides : | Saisie | Message attendu |
|---|---|
| Quota journalier atteint (« Imports par 24 heures » = 1, deuxième envoi) | "Quota journalier atteint (1 imports par 24 h)." (`imports.quota_daily_jobs`) |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour secrétariat (réglages)

### C. Les importeurs, un par un

Pour chaque importeur : étapes de l'assistant communes (« Envoyer et continuer », association des colonnes, « Enregistrer et valider le fichier », aperçu, case de confirmation, « Lancer l'import »). Les noms de colonnes sont ceux des gabarits ci-dessus ; la proposition automatique associe toutes les colonnes d'un fichier du dossier `jeux-de-donnees`.

#### 5.12 Élèves : fichier valide, jusqu'à l'exécution (secondaire)
Compte : secrétariat (Collège Le Baobab) · Où : « Nouvel import » · Fichier : `01-students-valide-secondaire.csv` · Prérequis : 5.3 lue, quota libre (5.11).
1. Carte "Élèves" ; « Fichier à importer » = le fichier ; « Feuille (facultatif) » vide ; « Envoyer et continuer ». Le titre devient "2. Associer les colonnes du fichier" ; "Le fichier compte 18 colonne(s). La proposition automatique est modifiable." ; le tableau "Premières lignes du fichier" montre les 10 lignes.
2. Vérifier que les 18 champs sont associés ; options : « Année scolaire des inscriptions » = année courante (**à choisir**) ; "Doublons probables (même nom et même naissance)" = "Refuser (recommandé)" ; « Si la donnée existe déjà » = « Ignorer les lignes déjà présentes ».
3. « Enregistrer et valider le fichier ». Barre « Validation des lignes ».
4. Aperçu : « À créer » 10, « À mettre à jour » 0, « À ignorer » 0, « En erreur » 0, « Avertissements » 0 ; "Aucune erreur : toutes les lignes sont valides." ; ouvrir « Lignes qui seront créées » (10).
5. Mode « Importer les lignes valides seulement » (par défaut). Cocher « J'ai consulté l'aperçu et les erreurs, et je confirme le lancement de l'import. » puis « Lancer l'import » (**irréversible**).
6. Écran « Import en cours » (état « En attente de traitement » puis « Import en cours »), puis rapport : « Import terminé », « Décomptes de l'import » : Créées 10, Mises à jour 0, Ignorées 0, En erreur 0 ; « Détails de l'import » : Fichier, Données "Élèves", Auteur (nom du secrétariat), Début, Durée, Mode « Lignes valides seulement ».
7. `/v2/students` : chercher `test guide` : 10 élèves (KOUASSI Aïcha test guide, KOUASSI Yves test guide, KONÉ Fanta test guide, TRAORE Mamadou test guide, YAO Adjoua test guide, BAMBA Ismaël test guide, COULIBALY Awa test guide, DIABATE Seydou test guide, BROU Esther test guide, OUATTARA Souleymane test guide), classe 6e A, inscription « En attente » (politique : attente du paiement de l'inscription). Fiche de KOUASSI Aïcha : naissance 12/03/2014, lieu Abidjan, e-mail aicha.kouassi.tg@exemple.test.
Résultat attendu : 10 élèves et 10 inscriptions créés ; l'effectif de la classe passe de 12 à 22. Sexe "Fille"/"Masculin" et dates `2014-02-14` acceptés.
Cas invalides : | Saisie | Message attendu |
|---|---|
| Associer « Nom » à "— Ne pas importer ce champ —" | sous le champ : "Associez une colonne à ce champ obligatoire." et bandeau "Champs obligatoires sans colonne : Nom." |
| Associer la même colonne à deux champs | la liste désactive la colonne : "déjà utilisée" |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour économe (lancement)

#### 5.13 Élèves : fichier avec erreurs de lignes
Compte : secrétariat · Fichier : `01-students-erreurs-secondaire.csv` (15 lignes) · Prérequis : 5.12 exécuté (élèves de la graine et `TG-ELV-*` présents). Options : année courante, "Refuser (recommandé)", ignorer l'existant.
Résultat attendu : « À créer » 3, « En erreur » 12, « Avertissements » 1 ; « Problèmes les plus fréquents » ; « Erreurs du fichier » : 12 lignes. Détail (filtre « Champ concerné » / « Code d'erreur » `imports.required`, etc.) :
| Ligne | Contenu | Champ | Message attendu | Code |
|---|---|---|---|---|
| 2 | TG-ERR-01 SANGARE Mariam | | valide | |
| 3 | sexe vide | Sexe | Le champ "Sexe" est obligatoire. | `imports.required` |
| 4 | sexe `X` | Sexe | "Sexe" : valeur non reconnue (attendu M ou F) | `imports.invalid_value` |
| 5 | naissance 31/02/2014 | Date de naissance | Date de naissance : "31/02/2014" n'est pas une date valide (attendu JJ/MM/AAAA ou AAAA-MM-JJ). | `imports.invalid_date` |
| 6 | naissance 01/01/2099 | Date de naissance | La date de naissance est dans le futur. | `imports.rule_violation` |
| 7 | nom vide | Nom | Le champ "Nom" est obligatoire. | `imports.required` |
| 8 | classe `6E-Z` | Classe (code) | Classe "6E-Z" inconnue pour cette année scolaire. | `imports.reference_unknown` |
| 9 | financement `XYZ` | Financement (code) | Type de financement "XYZ" inconnu. | `imports.reference_unknown` |
| 10 | e-mail `ange.tiemoko.exemple.test` | E-mail | E-mail : "ange.tiemoko.exemple.test" n'est pas une adresse e-mail valide. | `imports.invalid_email` |
| 11 | téléphone `12` | Téléphone | Téléphone : "12" n'est pas un numéro de téléphone valide. | `imports.invalid_phone` |
| 12 | nationalité `CIV` | Nationalité (code pays) | "Nationalité (code pays)" : code pays à deux lettres attendu (ex. CI) | `imports.invalid_value` |
| 13 | matricule TG-ERR-01 répété | (ligne entière) | Cette ligne répète la ligne 2 du fichier (même identifiant) : elle est ignorée. | `imports.duplicate_in_file` |
| 14 | DIABATE Nadia, 19/01/2014 | (ligne entière) | Doublon probable avec : DIABATE Nadia (00001). Vérifiez, ou choisissez "créer malgré le doublon". | `people.possible_duplicate` |
| 15 | TG-ERR-13 ZOKORA Léonie | | valide | |
| 16 | sans matricule d'origine, LOROUGNON | Matricule d'origine | Aucun matricule d'origine : les doublons ne seront détectés que par le nom et la date de naissance. (avertissement, ligne valide) | `imports.rule_violation` |
Notes : la ligne 14 vaut pour le secondaire (la graine du primaire et du supérieur a d'autres dates de naissance) ; le nom du doublon et le numéro sont à relever en test. Les lignes 5 à 7, 10 à 13 sont détectées à la lecture ; 8, 9, 14 au contrôle contre l'existant.
1. Le mode « Tout ou rien » est grisé : "Indisponible tant que le fichier contient des erreurs."
2. Cliquer « Télécharger les erreurs (CSV) » et « Télécharger les erreurs (Excel) » : fichiers `01-students-erreurs-secondaire-erreurs.csv` / `.xlsx` ; une ligne par problème avec Ligne, Colonne du fichier, Champ, Gravité, Code, Message, puis les valeurs du fichier.
3. Mode valides seulement, confirmation, « Lancer l'import ». Rapport : « Import terminé avec des erreurs » ; Créées 3 ; En erreur 12 (les lignes refusées à la validation comptent comme en erreur) ; 3 élèves ajoutés (TG-ERR-01, TG-ERR-13, LOROUGNON).
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour économe (lancement)

#### 5.14 Élèves : rejeu du même fichier, sans doublon
Compte : secrétariat · Fichier : `01-students-valide-secondaire.csv` de nouveau · Prérequis : 5.12 terminé.
1. Envoyer le fichier. Au titre "2. Associer les colonnes du fichier", un avertissement s'affiche : "Ce fichier (même contenu) a déjà été importé : les lignes déjà importées seront ignorées, sans doublon."
2. Valider avec « Ignorer les lignes déjà présentes ».
Résultat attendu : « À ignorer » 10, « À créer » 0 ; avertissement par ligne "Déjà importée lors d'un import précédent : ligne ignorée (aucun doublon)." ; liste d'échantillons « Lignes qui seront ignorées » ; ligne de blocage "Aucune ligne à écrire : toutes les lignes sont invalides ou déjà importées." ; le bouton « Lancer l'import » reste inactif. `/v2/students` ne compte aucun doublon.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour parent

#### 5.15 Élèves : mettre à jour les lignes déjà présentes
Compte : secrétariat · Fichier : `01-students-maj-secondaire.csv` (3 lignes, 7 colonnes : matricule, nom, prénoms, sexe, téléphone, adresse, ville) · Prérequis : 5.12.
1. À l'étape des colonnes choisir « Mettre à jour les lignes déjà présentes » ("Les champs présents dans le fichier remplacent ceux de la base ; les champs absents ne sont jamais effacés.").
2. Aperçu : « À mettre à jour » 3 ; lancer. Rapport : Mises à jour 3.
3. Fiches de KOUASSI Aïcha / Yves, KONÉ Fanta : téléphone et adresse changés (adresse "Cocody, Angré 8e tranche") ; date de naissance et classe inchangées. Le format d'affichage du téléphone est à relever.
Résultat attendu : champs absents du fichier non effacés. Cas invalide : compte sans `student.update` (aucun rôle de test n'en manque parmi les comptes du chapitre) : à vérifier en test.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour économe

#### 5.16 Élèves : primaire et supérieur
Comptes : secrétariat de l'École Les Palmiers, puis de l'Université Horizon · Fichiers : `01-students-valide-primaire.csv` (classe `CP1-A`, naissances 2018-2019, TG-ELV-P01 à P10, ex. KOFFI Amenan test guide) et `01-students-valide-superieur.csv` (classe `L1-A`, naissances 2003-2005, TG-ELV-U01 à U10, ex. KOUADIO Jean-Baptiste test guide).
Même parcours qu'en 5.12 ; année courante de l'établissement à choisir. Résultat attendu : 10 créés dans chaque établissement ; le même fichier envoyé dans l'autre établissement : classe inconnue (`Classe "CP1-A" inconnue pour cette année scolaire.`), les établissements sont isolés.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour économe

#### 5.17 Élèves sans classe (préparation des inscriptions)
Compte : secrétariat · Fichier : `01-students-sans-classe-secondaire.csv` (15 colonnes, sans Classe, Financement ni Référence d'affectation ; TG-INS-01 à 06 : ABLE Rachel, BAH Moussa, CAMARA Hawa, DJÉ Armand, EHUI Sylvie, FOFANA Karim, tous "test guide").
1. Aucune option d'année n'est nécessaire ; valider ; aperçu « À créer » 6 ; lancer.
Résultat attendu : 6 fiches élèves **sans inscription** (liste `/v2/students`, colonne classe vide) ; elles seront inscrites en 5.22.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour économe

#### 5.18 Parents et tuteurs
Compte : secrétariat · Fichiers : `02-guardians-valide-secondaire.csv` (11 lignes) puis `02-guardians-erreurs-secondaire.csv` (10 lignes) · Prérequis : 5.12 exécuté (élèves `TG-ELV-S01` à `S10`). Option "Doublons probables (même nom, même téléphone)" = "Refuser (recommandé)".
Fichier valide : aperçu « À créer » 11 ; lancer ; rapport Créées 11. Le tuteur KOUASSI Marie-Claire test guide figure sur 2 lignes (élèves S01 et S02) : **une seule fiche tuteur**, deux liens. Liens variés : "MERE", "PERE", "Tuteur légal", "Grand-parent", "Oncle ou tante", "MOTHER", "FATHER". Contrôle : `/v2/guardians` et la fiche de KOUASSI Aïcha (tuteur principal Marie-Claire, lien Mère) ; KOUASSI Yves a deux tuteurs (Marie-Claire principale, Bernard non principal).
Fichier avec erreurs (prérequis : le fichier valide importé) : « À créer » 2, « En erreur » 8, « Avertissements » 1.
| Ligne | Contenu | Message attendu | Code |
|---|---|---|---|
| 2 | S05 + GNAGNE Eugénie, Oncle ou tante | valide | |
| 3 | élève `TG-ELV-X99` | Aucun élève avec le matricule "TG-ELV-X99" (importez d'abord les élèves). | `imports.reference_unknown` |
| 4 | lien `Cousin` | Lien de parenté "Cousin" inconnu (liens : ...) (liste des liens à relever) | `imports.reference_unknown` |
| 5 | nom du tuteur vide | Le champ "Nom du tuteur" est obligatoire. | `imports.required` |
| 6 | téléphone `07-AB` | Téléphone : "07-AB" n'est pas un numéro de téléphone valide. | `imports.invalid_phone` |
| 7 | e-mail `simone@@exemple` | E-mail : "simone@@exemple" n'est pas une adresse e-mail valide. | `imports.invalid_email` |
| 8 | Contact principal `peut-être` | Contact principal : "peut-être" n'est pas une valeur oui / non. | `imports.invalid_value` |
| 9 | ni téléphone ni e-mail | Ni téléphone ni e-mail : le tuteur ne sera pas joignable. (avertissement, ligne valide) | `imports.rule_violation` |
| 10 | répète la ligne 2 | Cette ligne répète la ligne 2 du fichier (même identifiant) : elle est ignorée. | `imports.duplicate_in_file` |
| 11 | sexe du tuteur `Z` | "Sexe du tuteur" : valeur non reconnue (attendu M ou F) | `imports.invalid_value` |
Rejeu du fichier valide : « À ignorer » 11, "Déjà importée lors d'un import précédent : ligne ignorée (aucun doublon)."
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour économe

#### 5.19 Enseignants et personnel
Compte : directeur · Fichiers : `03-staff-valide-secondaire.csv` (8 lignes : TG-ENS-001 KOUADIO Brice test guide … TG-ENS-008 BEUGRÉ Estelle test guide ; catégories "Enseignant", `TEACHER`, "Éducateur", `ADMIN`, `SUPPORT`, "Personnel administratif" ; dates ISO et JJ/MM/AAAA mélangées) puis `03-staff-erreurs-secondaire.csv` (10 lignes).
Valide : aperçu « À créer » 8, lancer, Créées 8 ; `/v2/staff` : 8 fiches `test guide` (aucun compte de connexion n'est créé).
Erreurs : « À créer » 2, « En erreur » 8, « Avertissements » 1 :
| Ligne | Contenu | Message attendu | Code |
|---|---|---|---|
| 2 | TG-STE-01 LOBA Fabrice | valide | |
| 3 | catégorie `CUISINIER` | Catégorie "CUISINIER" inconnue (catégories : ...) (liste à relever) | `imports.reference_unknown` |
| 4 | prénoms vides | Le champ "Prénoms" est obligatoire. | `imports.required` |
| 5 | naissance `1985-13-45` | Date de naissance : "1985-13-45" n'est pas une date valide (attendu JJ/MM/AAAA ou AAAA-MM-JJ). | `imports.invalid_date` |
| 6 | embauche 1995 avant naissance 2000 | La date d'embauche précède la date de naissance. | `imports.rule_violation` |
| 7 | embauche 01/01/2099 | La date d'embauche est dans le futur. (avertissement, ligne valide) | `imports.rule_violation` |
| 8 | e-mail `sophie.rouamba.exemple.test` | E-mail : "sophie.rouamba.exemple.test" n'est pas une adresse e-mail valide. | `imports.invalid_email` |
| 9 | répète la ligne 2 | Cette ligne répète la ligne 2 du fichier (même identifiant) : elle est ignorée. | `imports.duplicate_in_file` |
| 10 | naissance 01/01/1915 | La date de naissance est invraisemblable (avant 1920). | `imports.rule_violation` |
| 11 | TRAORE Kouadio, 10/04/1978 | Doublon probable avec : TRAORE Kouadio. Vérifiez, ou choisissez "créer malgré le doublon". (suppose la fiche de la graine à cette date : à vérifier en test) | `people.possible_duplicate` |
Option "Doublons probables" = "Créer malgré le doublon" : la ligne 11 devient un avertissement et la fiche est créée (à vérifier en test).
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour secrétariat (carte grisée) 

#### 5.20 Classes
Compte : directeur des études · Fichiers : `04-classrooms-valide-secondaire.csv`, `04-classrooms-erreurs-secondaire.csv`, `04-classrooms-valide-primaire.csv`, `04-classrooms-valide-superieur.csv`, `04-classrooms-erreurs-superieur.csv`, `04-classrooms-echec-ecriture-superieur.csv`.
1. Importeur "Classes" ; options obligatoires : "Établissement" (Collège Le Baobab) et "Année scolaire" (année courante). Sans elles : "Cette option est obligatoire."
2. Valide secondaire (8 lignes : TG-5EA, TG-5EB, TG-4EA, TG-4EB, TG-3EA, TG-3EB, TG-6ED [saisi en minuscules : `college`, `6e`], TG-3EC avec dates 14/09/2026 à 30/06/2027 à adapter à l'année) : « À créer » 8 ; lancer ; `/v2/academic/classrooms` : 8 classes `test guide` (statut brouillon, effectifs 40 à 50). Si le programme `COLLEGE` de la graine ne couvre pas un niveau (5E, 4E, 3E), les lignes sont refusées à l'écriture : "Le niveau n'est pas couvert par le programme." (à vérifier : Structure académique > Programmes).
3. Erreurs secondaire (12 lignes) : « À créer » 2 (lignes 2 et 5), « À ignorer » 1 (ligne 12), « En erreur » 9 :
| Ligne | Contenu | Message attendu | Code |
|---|---|---|---|
| 2 | TG-E5A | valide | |
| 3 | programme `LYCEEX` | Programme "LYCEEX" inconnu dans cet établissement (programmes : ...) | `imports.reference_unknown` |
| 4 | niveau `7E` | Niveau "7E" inconnu (niveaux : ...) | `imports.reference_unknown` |
| 5 | niveau `2NDE` dans `COLLEGE` | valide à l'aperçu ; **refusée à l'écriture** : "Le niveau n'est pas couvert par le programme." | (à relever) |
| 6 | code vide | Le champ "Code de la classe" est obligatoire. | `imports.required` |
| 7 | effectif `0` | "Effectif maximal" : Number must be greater than or equal to 1 (message anglais, écart) | `imports.invalid_value` |
| 8 | effectif `quarante` | Effectif maximal : "quarante" n'est pas un nombre entier valide. | `imports.invalid_value` |
| 9 | effectif `40,5` | Effectif maximal : "40,5" comporte une partie décimale. | `imports.invalid_value` |
| 10 | fin avant début | La date de fin précède la date de début. | `imports.rule_violation` |
| 11 | répète la ligne 2 | Cette ligne répète la ligne 2 du fichier (même identifiant) : elle est ignorée. | `imports.duplicate_in_file` |
| 12 | `6E-A` (existe) | ligne ignorée (« À ignorer ») | |
| 13 | nom vide | Le champ "Nom de la classe" est obligatoire. | `imports.required` |
   Lancer en mode valides seulement : TG-E5A créée, la ligne 5 « Refusée » : rapport « Import terminé avec des erreurs ».
4. Primaire (École Les Palmiers, programme `PRIMAIRE`, 6 classes TG-CP2A à TG-CM2A) et supérieur (programme `INFO`, TG-L1P à TG-L1S) : même parcours. `04-classrooms-erreurs-superieur.csv` : ligne 2 `L2` dans `INFO` (acceptée à l'aperçu, refusée à l'écriture), ligne 3 programme `MASTERX` inconnu, ligne 4 niveau `L9` inconnu, ligne 5 `L1-A` ignorée.
5. Tout ou rien : `04-classrooms-echec-ecriture-superieur.csv` (3 lignes sans erreur de lecture, dont `TG-L2X` niveau `L2`). Mode "Tout ou rien" (permis car 0 erreur) : état « Échec », "Mode "tout ou rien" : la ligne 3 a été refusée par le module cible. Aucune donnée n'a été écrite." et note "Mode tout ou rien : aucune donnée n'a été écrite." (guillemets français autour de "tout ou rien" dans l'application) ; `TG-L1T` et `TG-L1U` **ne sont pas créées**. Avec « Importer les lignes valides seulement » (autre envoi) : 2 créées, 1 en erreur.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour secrétariat (carte grisée)

#### 5.21 Matières et curriculum
Compte : directeur des études · Fichiers : `05-curriculum-valide-secondaire.csv` (6 lignes), `05-curriculum-valide-superieur.csv` (8 lignes), `05-curriculum-erreurs-secondaire.csv` (13 lignes) · Prérequis : une **version de curriculum en brouillon** pour le programme et l'année (créée dans `/v2/academic/curriculum`, chapitre 03). Option "Version de curriculum (brouillon)" : la liste n'affiche que les brouillons ("... — brouillon (N noeud(s))") ; une version publiée est refusée : "Seule une version en brouillon peut recevoir des noeuds."
1. Secondaire : la première ligne `6E` (type `LEVEL`) est ignorée si le brouillon contient déjà le niveau, créée sinon. Les cinq matières (Arts plastiques, Éducation musicale, Informatique, SVT, Éducation civique `test guide`, codes `TG-ARTP`…) sont des noeuds `SUBJECT` sous `6E` ; coefficients "1", "2", "1,5". Aperçu : avertissements "La matière "TG-ARTP" n'existe pas : elle sera créée à partir du libellé." (carte requérant `academic.program.manage`). Lancer : Créées 5 (+1 si le niveau est créé).
2. Supérieur : niveau `L1`, période `S1` (`SEMESTER`, rang 1), UE `TG-IUE1` (6 crédits) avec `TG-IE11` et `TG-IE12` (3+3), UE `TG-IUE2` (5 crédits) avec `TG-IE21` et `TG-IE22` (2+3). Lancer : 8 noeuds (moins ceux déjà présents). Contrôle dans le curriculum : la validation de la version doit être cohérente (crédits d'une UE = somme de ses ECUE).
3. Erreurs (13 lignes) :
| Ligne | Contenu | Message attendu | Code |
|---|---|---|---|
| 3 | TG-CE1 | valide (avertissement : matière créée) | |
| 4 | parent `XYZ` | Le parent "XYZ" n'existe pas dans la version et n'est pas déclaré plus haut dans le fichier. | `imports.reference_unknown` |
| 5 | parent = le noeud lui-même | Un noeud ne peut pas être son propre parent. | `imports.rule_violation` |
| 6 | type `MATIERE` | Type de noeud "MATIERE" inconnu (types : ...) | `imports.reference_unknown` |
| 7 | type de période sans rang | Le n° de période est obligatoire avec un type de période. | `imports.required` |
| 8 | coefficient `-2` | Coefficient : "-2" ne peut pas être négatif. | `imports.invalid_value` |
| 9 | coefficient `abc` | Coefficient : "abc" n'est pas un nombre valide. | `imports.invalid_value` |
| 10 | code vide | Le champ "Code du noeud" est obligatoire. | `imports.required` |
| 11 | répète la ligne 3 | Cette ligne répète la ligne 3 du fichier (même identifiant) : elle est ignorée. | `imports.duplicate_in_file` |
| 12 | niveau `9E` | Niveau "9E" inconnu. | `imports.reference_unknown` |
| 13 | parent déclaré plus bas | Le parent "TG-CE11" n'existe pas dans la version et n'est pas déclaré plus haut dans le fichier. | `imports.reference_unknown` |
| 14 | groupe TG-CE11 | valide | |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour secrétariat (carte grisée)

#### 5.22 Inscriptions
Compte : secrétariat · Fichiers : `06-enrollments-valide-secondaire.csv` (6 lignes), `06-enrollments-erreurs-secondaire.csv` (11 lignes) · Prérequis : 5.17 (TG-INS-01 à 06), 5.12 (TG-ELV-S*), 5.20 (classe `TG-5EA`).
1. Carte "Inscriptions" ; option obligatoire « Année scolaire des inscriptions » (l'année courante ou celle qui s'ouvre ; une année close est refusée : "Cette année scolaire n'accepte plus d'inscription : choisissez l'année courante ou celle qui s'ouvre.").
2. Valide : « À créer » 6 (la ligne 5 saisit `6e-a` en minuscules et la date 15/09/2026 ; à adapter à l'année) ; lancer ; Créées 6 ; inscriptions « En attente » en 6e A.
3. Erreurs (prérequis : élèves S* inscrits en 6E-A) : « À ignorer » 2, « En erreur » 9, rien à écrire (bouton inactif) :
| Ligne | Contenu | Message attendu | Code |
|---|---|---|---|
| 2 | `TG-INS-99` | Aucun élève avec le matricule "TG-INS-99". L'importeur d'inscriptions ne crée pas de fiche : importez d'abord les élèves. | `imports.reference_unknown` |
| 3 | classe `6E-Z` | Classe "6E-Z" inconnue pour cette année scolaire. | `imports.reference_unknown` |
| 4 | financement `XYZ` | Type de financement "XYZ" inconnu. | `imports.reference_unknown` |
| 5 | date 31/02/2026 | Date d'inscription : "31/02/2026" n'est pas une date valide (attendu JJ/MM/AAAA ou AAAA-MM-JJ). | `imports.invalid_date` |
| 6 | date 01/01/1980 | La date d'inscription est invraisemblable (avant 1990). | `imports.rule_violation` |
| 7 | S01 déjà en 6E-A | L'élève est déjà inscrit dans cette classe : ligne ignorée. (avertissement) | `imports.already_imported` |
| 8 | S02 vers `TG-5EA` | L'élève est déjà inscrit cette année dans la classe "6E-A" : un changement de classe se fait dans les inscriptions, pas par import. | `academic.class_enrollment_exists` |
| 9 | matricule vide | Le champ "Matricule de l'élève" est obligatoire. | `imports.required` |
| 10 | classe vide | Le champ "Classe (code)" est obligatoire. | `imports.required` |
| 11 | S08 déjà en 6E-A | ligne ignorée (comme 7) | `imports.already_imported` |
| 12 | S08 répété | Cette ligne répète la ligne 11 du fichier (même identifiant) : elle est ignorée. | `imports.duplicate_in_file` |
Cas de capacité : si la classe est pleine (40), l'aperçu avertit "La classe "6E-A" (40 places, N inscrits) risque d'être pleine : l'inscription sera refusée si la capacité est atteinte." et l'écriture est refusée au-delà.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour économe (lancement)

#### 5.23 Notes (direction) et notes de mes classes (enseignant)
Prérequis : une **évaluation en brouillon** dans la classe 6e A, barème 20, créée dans `/v2/assessments/new` (chapitre 08), par exemple "Contrôle import test guide" (matière Français, enseignant `enseignant@secondaire-test.test`). Les notes visent les élèves **confirmés** de la graine (numéros `00001` à `00008`) ; vérifier d'abord ces numéros sur `/v2/students` (si l'ordre diffère, adapter la première colonne).
Compte direction : carte "Notes" ; option obligatoire "Évaluation" (liste "titre — date (barème 20)", brouillons seulement ; une évaluation non brouillon est refusée : "Les notes de cette évaluation sont figées : retournez la feuille en brouillon avant d'importer.").
1. `07-grades-valide-secondaire.csv` (8 lignes : 14,5 ; 12 ; ABS ; 17,25 ; ABJ ; DISP ; 9,5 ; 20) : aperçu « À créer » 8 ; lancer ; la feuille de notes (`/v2/assessments/<id>/grades`) montre les 8 saisies, "ABS" = absent non justifié, "ABJ" = absent justifié, "DISP" = dispensé ; aucune moyenne calculée par l'import.
2. `07-grades-erreurs-secondaire.csv` (11 lignes, sur une évaluation vierge ou après 1) : « À créer » 1, « En erreur » 10 :
| Ligne | Contenu | Message attendu | Code |
|---|---|---|---|
| 2 | 00001 = 13 | valide (si la note existe déjà et diffère : ignorée "Une note différente existe déjà : ligne ignorée (choisissez "mettre à jour" pour la remplacer).") | |
| 3 | matricule `99999` | Aucun élève avec le matricule "99999". | `imports.reference_unknown` |
| 4 | note `21` | La note 21 dépasse le barème (20). | (code du module des évaluations) |
| 5 | note `abc` | "Note ou code" : une note numérique (ex. 14,5) ou un code ABS, ABJ, DISP est attendu | `imports.invalid_value` |
| 6 | note `-3` | même message que la ligne 5 | `imports.invalid_value` |
| 7 | note `14,555` | Une note a 2 décimale(s) au plus dans cet établissement. (si le réglage est 2) | (module évaluations) |
| 8 | note vide | Le champ "Note ou code" est obligatoire. | `imports.required` |
| 9 | matricule vide | Le champ "Matricule de l'élève" est obligatoire. | `imports.required` |
| 10 | 00001 répété | Cette ligne répète la ligne 2 du fichier (même identifiant) : elle est ignorée. | `imports.duplicate_in_file` |
| 11 | `TG-ELV-S01` (inscription en attente) | L'élève "TG-ELV-S01" n'est pas inscrit dans la classe de cette évaluation. | `imports.reference_unknown` |
| 12 | observation de 501 caractères | "Observation" est trop long (500 caractères au plus). | `imports.invalid_value` |
3. Rejeu de 1 : « À ignorer » 8 ("La note est identique à celle déjà saisie."). Avec une valeur modifiée et « Ignorer » : "Une note différente existe déjà : ligne ignorée ..." ; avec « Mettre à jour les lignes déjà présentes » : « À mettre à jour ».
4. **Enseignant** (`enseignant@secondaire-test.test`) : seule la carte "Notes de mes classes" est proposée (jamais "Notes") ; l'option "Évaluation" ne liste que ses propres brouillons ; l'évaluation d'un collègue donne : "Évaluation inconnue ou hors de vos classes : vous ne pouvez importer que les notes de vos propres évaluations." (même message qu'une évaluation inexistante). Le fichier valide s'importe comme en 1.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour secrétariat (aucune carte de notes)

#### 5.24 Soldes financiers d'ouverture (MFA, irréversible)
Compte : directeur (MFA) · Fichiers : `08-opening-balances-valide-secondaire.csv` (8 lignes), `08-opening-balances-erreurs-secondaire.csv` (13 lignes) · Prérequis : 5.12 (élèves `TG-ELV-S01` à `S09`).
1. Carte "Soldes financiers d'ouverture" (badge « Authentification renforcée »). Option obligatoire "Année scolaire par défaut des factures (ex. 2024-2025)" = `2025-2026` (sans elle : "Cette option est obligatoire." ; format erroné : message `L'année scolaire par défaut est obligatoire (ex. 2024-2025).`). « Mettre à jour les lignes déjà présentes » est grisé : "Indisponible : ces documents ne se modifient pas."
2. Valide : montants 45000, 120000, "75 000", 30000, 60000, 100000, 85000 et un avoir de 20000 (TG-REPRISE-007) qui vise TG-REPRISE-002 (même fichier, ligne plus haut) ; types FACTURE, `facture`, vide (défaut), AVOIR ; échéances 31/12/2026 ou 2026-12-31. Aperçu « À créer » 8. Note "Cet import crée des documents financiers : votre session doit être en authentification renforcée (MFA), et l'opération est enregistrée dans le journal d'audit."
3. Lancer : une fenêtre "Confirmez votre identité" peut s'ouvrir ("Saisissez le code à 6 chiffres...") : saisir le code du moment (jamais écrit dans ce guide) puis « Confirmer et continuer ». Rapport : Créées 8. Contrôle : factures de reprise sur `/v2/finance/invoices` (élèves S01 à S08, 7 factures et 1 avoir sur la facture de S02) ; leur création déclenche la numérotation habituelle.
4. Sans MFA (compte non authentifié en MFA ou économe) : "Cet import touche aux soldes financiers : confirmez votre identité par l'authentification renforcée (MFA)." (`imports.mfa_required`). L'économe peut préparer et valider, mais pas lancer : refus du serveur à « Lancer l'import » (message exact à relever ; l'écran ne désactive pas le bouton).
5. Erreurs (13 lignes) : « À créer » 2, « En erreur » 11, « Avertissements » 1 :
| Ligne | Contenu | Message attendu | Code |
|---|---|---|---|
| 2 | TG-REPRISE-E01 | valide | |
| 3 | montant `1500,5` | Montant (FCFA) : "1500,5" comporte une partie décimale. Les montants s'expriment en francs entiers, sans décimale. | `imports.amount_not_integer` |
| 4 | montant `abc` | Montant (FCFA) : "abc" n'est pas un nombre entier valide. | `imports.amount_invalid` |
| 5 | montant `-5000` | Montant (FCFA) : "-5000" ne peut pas être négatif. | `imports.amount_invalid` |
| 6 | montant `0` | "Montant (FCFA)" : Number must be greater than or equal to 1 (message anglais, écart) | `imports.invalid_value` |
| 7 | référence vide | Le champ "Référence" est obligatoire. | `imports.required` |
| 8 | élève `99999-TG` | Aucun élève avec le matricule "99999-TG" (importez d'abord les élèves). | `imports.reference_unknown` |
| 9 | AVOIR sans facture ni motif | Un avoir doit viser une facture de reprise (colonne "Facture visée"). et Un avoir exige un motif. | `imports.required` |
| 10 | AVOIR visant `TG-REPRISE-INCONNUE` | La facture de reprise "TG-REPRISE-INCONNUE" est inconnue : importez-la avant (ou plus haut dans ce fichier). | `imports.reference_unknown` |
| 11 | type `REMBOURSEMENT` | "Type" : valeur non reconnue (attendu FACTURE ou AVOIR) | `imports.invalid_value` |
| 12 | référence répétée | Cette ligne répète la ligne 2 du fichier (même identifiant) : elle est ignorée. | `imports.duplicate_in_file` |
| 13 | facture avec "Facture visée" | "Facture visée" n'a de sens que pour un avoir : valeur ignorée. (avertissement, ligne valide) | `imports.rule_violation` |
| 14 | échéance 31/02/2027 | Échéance : "31/02/2027" n'est pas une date valide (attendu JJ/MM/AAAA ou AAAA-MM-JJ). | `imports.invalid_date` |
6. Rejeu du fichier valide : « À ignorer » 8 ("Cette référence a déjà été importée : ligne ignorée.") ; aucune facture en double.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour secrétariat (carte grisée)

### D. Formats et cycle de vie d'un import

#### 5.25 Les quatre formats : .csv, .xlsx, .xls, .ods
Compte : secrétariat · Fichiers : `01-students-formats-secondaire.csv`, `.xlsx`, `.xls`, `.ods` (5 lignes chacun : 4 valides + 1 à la date 31/02/2014 ; matricules `TG-FC`, `TG-FX`, `TG-FS`, `TG-FO`) · Prérequis : 5.12.
Pour chacun : importeur "Élèves", année courante. Résultat attendu identique : « À créer » 4, « En erreur » 1, ligne 6 : Date de naissance : "31/02/2014" n'est pas une date valide ... Le format est reconnu par le contenu (feuille "Eleves" pour les classeurs). **N'exécuter qu'un seul de ces quatre fichiers** (capacité de la classe) : par exemple le .xlsx, Créées 4.
Cas invalides : renommer le `.xls` en `.xlsx` : "Le contenu est un classeur Excel ancien (.xls) mais le fichier se nomme ".xlsx"." (`imports.file_type_mismatch`).
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour éducateur

#### 5.26 Classeur à plusieurs feuilles, dates Excel, formules
Compte : secrétariat · Prérequis : 5.12 (aperçu seulement).
1. `01-students-feuilles-secondaire.xlsx` (feuilles "LISEZ-MOI" puis "Eleves"). Envoi avec « Feuille (facultatif) » vide : la feuille lue est la première (LISEZ-MOI) ; à l'étape des colonnes, une seule colonne, bandeau "Champs obligatoires sans colonne : Nom, Prénoms, Sexe." → impossible de continuer. Recommencer avec « Feuille (facultatif) » = `Eleves` (ou `eleves`) : 4 lignes, dates saisies comme vraies dates Excel (le tableau "Premières lignes du fichier" les montre en numéros de série, ex. 41647) ; l'aperçu les lit correctement (« À créer » 4).
2. `01-students-formule-secondaire.xlsx` : une cellule contient une formule. Avertissement à l'étape des colonnes : "1 cellule(s) contiennent une formule : seule la valeur enregistrée est lue, jamais recalculée." Aperçu : « À créer » 3.
Cas invalides : | Saisie | Message attendu |
|---|---|
| Feuille = `Inconnue` | "La feuille "Inconnue" n'existe pas dans le classeur." (`imports.sheet_unknown`) |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour éducateur

#### 5.27 Encodage, séparateur, en-têtes libres et en double
Compte : secrétariat · Fichiers dans `imports-cas-limites/` et à la racine (aperçu seulement, 4 lignes valides chacun) :
| Fichier | Particularité | Résultat attendu |
|---|---|---|
| `01-students-encodage-ansi-secondaire.csv` | windows-1252 (accents é, ô) | accents corrects dans les premières lignes ; « À créer » 4 |
| `01-students-encodage-virgule-secondaire.csv` | séparateur `,`, UTF-8 sans BOM | 6 colonnes reconnues ; « À créer » 4 |
| `01-students-encodage-tabulation-secondaire.tsv` | séparateur tabulation | idem |
| `01-students-entetes-libres-secondaire.csv` | en-têtes `matricule;nom;prénom;sexe;date de naissance;classe` | les 6 champs sont associés automatiquement (alias) ; option année à choisir ; « À créer » 5 |
| `01-students-entetes-doubles-secondaire.csv` | deux colonnes `Nom` | avertissement "1 en-tête(s) en double ont été renommés ("Nom (2)")." ; la colonne `Nom (2)` reste non associée |
Cas invalide : mettre une colonne obligatoire sur "— Ne pas importer ce champ —" : "Associez une colonne à ce champ obligatoire."
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour éducateur

#### 5.28 Relecture de l'aperçu, reprise et confirmation obligatoire
Compte : secrétariat · Fichier : `01-students-sans-classe-secondaire.csv` renommé ou un autre fichier valide pas encore exécuté (par exemple `01-students-formule-secondaire.xlsx`).
1. Atteindre l'aperçu ; quitter par « Retour à l'historique ». L'import apparaît « Prêt à importer » ; le rouvrir par son nom : on retombe sur l'aperçu, sans le tableau "Premières lignes du fichier" (affiché seulement juste après l'envoi).
2. « Modifier les colonnes » : retour à l'étape des colonnes (état « Colonnes associées ») ; changer l'option « Si la donnée existe déjà » ; « Enregistrer et valider le fichier » : nouvelle validation, compteurs recalculés.
3. Constater que « Lancer l'import » est inactif tant que la case « J'ai consulté l'aperçu et les erreurs, et je confirme le lancement de l'import. » n'est pas cochée.
4. Ne pas lancer : l'import reste actif (compte dans le quota 5.11).
Résultat attendu : aucune écriture avant la confirmation ; la page peut être quittée et rouverte (même depuis un autre navigateur, avec le même compte).
Cas invalide : lancer par l'API sans confirmation n'est pas possible depuis l'écran (le bouton reste inactif).
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour parent

#### 5.29 Modes d'import : « Tout ou rien » et lignes valides seulement
Compte : secrétariat ou directeur des études · Fichiers : `04-classrooms-echec-ecriture-superieur.csv` (5.20, étape 5) et `01-students-erreurs-secondaire.csv` (5.13).
1. Fichier avec erreurs de lecture : "Tout ou rien" grisé : "Indisponible tant que le fichier contient des erreurs."
2. Fichier sans erreur de lecture mais refusé à l'écriture : "Tout ou rien" choisi, import « Échec » ; rien n'est écrit ; « Lignes valides seulement » : écrit les lignes acceptées, « Terminé avec des erreurs ».
3. Fichier de plus de 5000 lignes en "Tout ou rien" : voir 5.10 (le réglage "Lignes en mode tout ou rien" plafonne : `Le mode "tout ou rien" est limité à N lignes (M ici).`).
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour économe

#### 5.30 Exécution irréversible, progression et rapport
Compte : secrétariat · Fichier : `01-students-sans-classe-secondaire.csv` si 5.17 n'a pas été fait, sinon `01-students-formats-secondaire.xlsx` (5.25).
1. Lancer comme en 5.12. Observer « Import en cours » : barre « Lignes traitées », compteurs « Créées », « Mises à jour », « Ignorées », « En erreur », message "L'import s'exécute en tâche de fond. Vous pouvez quitter la page : il continue et reprend seul en cas d'incident."
2. À la fin : rapport. Boutons « Télécharger le rapport (Excel) », « Télécharger le rapport (CSV) » (colonnes Ligne, Validation, Action prévue, Résultat, Identifiant créé, Problèmes, puis le fichier) et, s'il y a des erreurs, « Télécharger les erreurs (CSV) » ; bouton « Nouvel import ».
3. L'historique affiche la ligne : "N créée(s), N mise(s) à jour, N ignorée(s), N en erreur" et la durée.
4. **Aucune annulation d'un import terminé** : il n'existe aucun bouton ; le serveur répondrait "Cet import est déjà terminé (COMPLETED) : il ne peut plus être annulé." (non atteignable à l'écran). Un import qui a écrit des données reste dans l'historique ("Cet import a écrit des données : il reste dans l'historique.").
Résultat attendu : données définitives ; rapport téléchargeable ; relancer le même import : refusé "Cet import est déjà lancé." ou "Validez l'import (et consultez l'aperçu) avant de le lancer." (non atteignable à l'écran).
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour parent

#### 5.31 Annulation pendant l'exécution
Comptes : directeur (réglage) puis secrétariat · Fichier : `imports-gros/01-students-300-lignes-secondaire.csv` (généré par `--gros`, 300 élèves sans classe `TG-BIG-*`) · **Crée jusqu'à 300 fiches ; ne pas l'exécuter en entier.**
1. Directeur : « Lignes par lot d'écriture » = 10 (sinon le lot de 200 est annulé en bloc et rien n'est conservé). 
2. Secrétariat : importer, valider (quelques secondes), lancer.
3. Pendant « Import en cours », cliquer « Annuler l'import » : la confirmation "Annuler l'import ? Les lignes déjà écrites sont conservées." avec « Oui, annuler l'import » et « Non, continuer ». Cliquer « Non, continuer » puis refaire et confirmer « Oui, annuler l'import ».
4. Message "Annulation demandée : l'import s'arrête entre deux lignes." ; état final « Annulé » ; note "L'import a été annulé : N ligne(s) avaient déjà été traitées." ; les lignes des lots déjà validés sont conservées.
5. Directeur : remettre le lot à 200.
Cas invalide : l'économe n'a pas `imports.cancel` : le bouton n'est pas proposé.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour économe

#### 5.32 Neutralisation des formules dans les rapports
Compte : secrétariat · Fichier : `01-students-formules-erreurs-secondaire.csv` (3 lignes dont le Nom vaut `=2+2`, `+CMD`, `@SOMME(A1)`, sexe manquant).
1. Atteindre l'aperçu : « À créer » 0, « En erreur » 3, bouton inactif. Les valeurs sont affichées comme du texte.
2. Télécharger « Télécharger les erreurs (CSV) » et l'ouvrir dans un tableur : les valeurs commencent par une apostrophe (`'=2+2`, `'+CMD`, `'@SOMME(A1)`) et ne s'exécutent pas.
Résultat attendu : aucune formule évaluée ; rien n'est écrit.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour parent

### E. Droits et isolation

#### 5.33 Cartes et boutons selon le rôle
Comptes : secrétariat, directeur des études, économe, enseignant, directeur · Où : « Nouvel import ».
| Compte | Cartes utilisables | Remarques |
|---|---|---|
| Secrétariat | "Élèves", "Parents et tuteurs", "Inscriptions" | autres cartes grisées avec "Droits manquants : ..." |
| Directeur des études | "Classes", "Matières et curriculum" | idem |
| Économe | cartes dont il détient les droits du module (préparer seulement) | peut aller jusqu'à l'aperçu ; « Lancer l'import » est refusé par le serveur (à vérifier en test : message) |
| Enseignant / instituteur | "Notes de mes classes" | jamais "Notes" |
| Directeur / propriétaire | toutes ("Soldes financiers d'ouverture" avec MFA) | voit les imports des autres |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour éducateur

#### 5.34 Adresses interdites (saisie manuelle)
Comptes : éducateur, parent, élève (puis chargé d'admissions, responsable des examens, responsable pédagogique) : taper `/v2/imports`, `/v2/imports/new`, `/v2/imports/templates`, `/v2/imports/settings` : page "Accès refusé" à chaque fois. Comptes secrétariat, directeur des études, économe, enseignant : `/v2/imports/settings` : "Accès refusé".
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé (4 comptes)

#### 5.35 Visibilité d'un import d'un autre utilisateur et isolation entre établissements
1. Directeur : l'historique contient "eleves-demonstration.csv" et les imports du secrétariat (filtre par type possible).
2. Directeur des études : copier l'adresse `/v2/imports/<identifiant>` d'un import du secrétariat : bloc d'erreur "Import introuvable (...)" (aucune fuite d'existence). Son historique ne montre que ses imports.
3. Secrétariat de l'École Les Palmiers : l'historique ne montre aucun import du Collège ; son import de démonstration utilise la classe `CP1-A`. L'adresse d'un import du collège : "Import introuvable (...)".
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour tout compte hors établissement

#### 5.36 Qualité transversale
Contrôler : états de chargement ("Envoi et lecture du fichier…", "Enregistrement du mapping et lancement de la validation…", "Lancement de l'import…"), état vide de l'historique et des modèles, bandeaux d'erreur avec bouton de nouvel essai, navigation au clavier (focus sur le titre de l'étape à chaque changement d'étape, étapes annoncées "terminée"), liste d'erreurs lisible sur téléphone (cartes empilées), pagination des erreurs (20 par page : « Précédent » / « Suivant », "Page 1 sur N"), codes techniques `imports.*` affichés à côté des messages (écart Mineur C-04-09).
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour parent

## Données créées

Voir `_annexe-fragments/05-imports.md`. Résumé : élèves `TG-ELV-S01` à `S10` (secondaire), `TG-ELV-P01` à `P10` (primaire), `TG-ELV-U01` à `U10` (supérieur), `TG-ERR-01`, `TG-ERR-13`, élève sans matricule LOROUGNON test guide, `TG-INS-01` à `06`, un fichier des formats (`TG-FX-01` à `04`) ; tuteurs (KOUASSI Marie-Claire test guide, etc.) ; 8 fiches personnel `TG-ENS-001` à `008` ; classes `TG-5EA`, `TG-5EB`, `TG-4EA`, `TG-4EB`, `TG-3EA`, `TG-3EB`, `TG-6ED`, `TG-3EC`, `TG-E5A`, `TG-CP2A`..., `TG-L1P`...; noeuds de curriculum `TG-*` ; notes sur "Contrôle import test guide" ; factures de reprise `TG-REPRISE-001` à `008`, `TG-REPRISE-E01`, `TG-REPRISE-E10` ; imports dans l'historique ; modèle de mapping `Modèle élèves test guide` (supprimé en 5.6).

## Écarts constatés

| Écran | Constat | Gravité |
|---|---|---|
| Graine / historique | L'import de démonstration "eleves-demonstration.csv" est « Prêt à importer » avec 15 lignes sur 15 en erreur (option année absente, `scripts/seed-v2/demo/imports.ts`) ; le guide historique annonçait 15 à créer | Mineur |
| Étape des colonnes (élèves) | L'aide de l'option « Année scolaire des inscriptions » dit "Par défaut : l'année courante" et l'option n'est pas marquée obligatoire, mais le contrôle refuse la colonne Classe sans elle | Majeur |
| Assistant | Aucun écran n'annule ni ne supprime un brouillon (« Fichier reçu », « Colonnes associées », « Prêt à importer ») : le bouton d'annulation n'existe que pendant l'exécution ; `useDeleteImport` n'est utilisé nulle part. Les brouillons occupent le quota d'imports actifs (5 pour tout l'établissement) pendant 72 h | Majeur |
| Messages de lignes | Codes techniques `imports.*` affichés à côté de chaque message (QA C-04-09) | Mineur |
| Messages de lignes | Effectif ou montant égal à 0 : message anglais "Number must be greater than or equal to 1" | Mineur |
| Validation | Barre de progression figée si l'onglet est en arrière-plan (QA C-04-08) | Mineur |
| Étape des colonnes | Les dates Excel natives s'affichent en numéro de série (ex. 41647) dans "Premières lignes du fichier" | Suggestion |
| Lecteur .xlsx | Un classeur écrit par la bibliothèque SheetJS (type de contenu `.bin` "macroEnabled" par défaut) déclenche à tort l'avertissement "Le classeur contient des macros" ; les fichiers de ce dossier ont ce défaut retiré | Suggestion |
| Aperçu (économe) | Le bouton « Lancer l'import » n'est pas désactivé pour qui n'a pas le droit de lancer (`canRun` non utilisé) | Mineur (à confirmer) |
| Guide historique | C05.N2 affirmait "Enseignant : aucun accès" ; depuis O-02 l'enseignant a `imports.read`, `imports.create`, `imports.import.grades_own` | Information |

## À vérifier en test

- Numéros d'élève `00001` à `00012` de la graine (fichiers `07-grades-*`) ; sinon adapter.
- Niveaux couverts par le programme `COLLEGE` de la graine (5E, 4E, 3E) ; sinon les classes de 5.20 sont refusées à l'écriture.
- Nombre de décimales de note autorisé (2 par défaut ?) et message exact de dépassement de barème ; codes des erreurs du module des évaluations.
- Doublon probable : nom affiché et numéro (élèves 00001, personnel TRAORE Kouadio) ; effet de "Créer malgré le doublon".
- Liste exacte des liens, catégories, niveaux, programmes et types de noeud dans les messages "(liens : ...)".
- Format d'affichage du téléphone après import ; refus de la date d'embauche future par la fiche personnel ; année `2025-2026` acceptée sur une facture de reprise.
- Enseignant : l'entrée de menu n'existe peut-être pas dans son portail (le menu "Imports Excel / CSV" est déclaré pour le portail d'administration) ; accès par l'adresse.
- Fichier de 21 Mo : réponse "Le fichier est trop volumineux." ou coupure par le proxy.
- Message de refus de l'économe à « Lancer l'import » et message de refus d'enregistrement d'un modèle sans droit.
- `/v2/imports/abc` : "Données invalides." ou autre bloc d'erreur.
- Temps de validation du fichier de 300 lignes (jusqu'à plusieurs secondes) et lisibilité de la progression.

## Non couvert / limites connues

- Annulation ou suppression d'un brouillon, annulation d'un import terminé : aucune fonction à l'écran.
- Fichiers protégés par mot de passe, bombes de décompression, macros, liens externes, entités XML, délai de conversion `.xls`/`.ods` : couverts par les tests automatiques du module (`test/unit/files.test.ts`, `legacy.test.ts`), pas par ce guide.
- Reprise après arrêt brutal du worker, concurrence entre deux exécutants, limiteur de débit (20 envois par minute, 60 écritures, 60 téléchargements) : tests automatiques seulement.
- Purge des valeurs après la durée de conservation (30 jours) : tâche planifiée, non observable en test court ; le message "Les valeurs du fichier ont été supprimées (durée de conservation dépassée)." n'est pas atteignable.
- Import de la page `/v2/examinations` (candidats, résultats) : autre module, voir le chapitre 20.
- Importeur "Notes de mes classes" en primaire : même fichier et mêmes règles qu'en 5.23 avec `enseignant@primaire-test.test` (non détaillé).
