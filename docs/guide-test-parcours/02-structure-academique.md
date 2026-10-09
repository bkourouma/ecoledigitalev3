[⬅ Sommaire](../GUIDE_TEST_UTILISATEUR_COMPLET.md) · [← Précédent](01-connexion-abonnement-roles.md) · [Suivant →](03a-personnes-imports.md)

# Phase 2 — Structure académique

Le directeur des études lit l'année en cours, prépare l'année suivante (`TG-2027-2028`), crée un programme et son curriculum, puis la classe `TG-6EB` ("6e B test guide") qu'il active. Le propriétaire termine par l'aperçu de la reconduction, sans rien écrire.

Précondition : phase précédente terminée (aucune session ouverte dans la fenêtre **A**). Les années, programmes et classes ne se suppriment pas : les noms portent "test guide" ou le préfixe `TG-`.

## Étape 15 — Lire l'année en cours et ses périodes
👤 **directeur des études** (secondaire-test, `etudes@secondaire-test.test`, **MFA**) · fenêtre **A** · 📂 Menu **« Académique »** > **« Années et périodes »** (`/v2/academic/years`)

1. Se connecter (clic sur le compte du panneau, **« Se connecter »**, **« Valider »**).
2. Taper `/v2/academic` : redirection vers `/v2/academic/years`.
3. Lire la ligne "Année scolaire 2026-2027" : colonnes « Année », « Code », « Dates », « État » ; badges « Ouverte » et « Courante ».
4. Cliquer **« Périodes »** en bout de ligne.

✅ Titre « Années académiques », dates du 1er septembre 2026 au 31 août 2027. Panneau « Périodes de Année scolaire 2026-2027 » avec la « Frise de l'année » et le tableau « Période », « Type », « Dates », « État » : 3 trimestres couvrant l'année sans trou (attendu : T1 et T2 « Ouverte », T3 « Planifiée » ; *relever l'état réel*). Le bouton « Nouvelle année » est visible ; pas de bouton « Clôturer » pour ce compte.

☐ OK ☐ KO

---

## Étape 16 — Créer l'année `TG-2027-2028`
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 **« Années et périodes »** > **« Nouvelle année »**

1. Cliquer **« Nouvelle année »**. Faire d'abord l'essai refusé : tout vide, valider → « Ce champ est obligatoire. » sous Code, Libellé et Début.
2. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Code | `TG-2027-2028` |
| Libellé | `Année test guide 2027-2028` |
| Début | `01/09/2027` |
| Fin | (vide : douze mois pleins par défaut) |

3. Cliquer **« Nouvelle année »** (bouton de validation de la fenêtre).

✅ Message « L'année Année test guide 2027-2028 a été créée. » ; la ligne apparaît à l'état « Brouillon », sans badge « Courante », du 1er septembre 2027 au 31 août 2028 ; boutons « Périodes », « Ouvrir », « Modifier ». Aucun bouton de suppression. Valeur conservée après rechargement.

⚠️ *Test d'erreur* : code `2026-2027`, libellé `Doublon`, début `01/09/2027` → "Ce code d'année existe déjà dans l'établissement." ; code `TG-FIN`, début `01/09/2027`, fin `01/08/2027` → "La fin de l'année doit suivre son début." ; code `TG-CHEV`, début `01/12/2026` → "L'année chevauche une autre année de l'établissement."

☐ OK ☐ KO

---

## Étape 17 — Générer les périodes de l'année test depuis un plan
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 **« Années et périodes »** > **« Périodes »** de la ligne "Année test guide 2027-2028"

1. Cliquer **« Périodes »** : message « Aucune période pour cette année. ».
2. Cliquer **« Générer depuis un plan »**. Cliquer d'abord **« Générer depuis un plan »** sans rien choisir.
3. Choisir dans « Plan de périodes » : "Trois trimestres" (la liste annonce "3 périodes seront créées" et leurs libellés). Valider.

✅ Étape 2 : « Choisissez un plan de périodes. ». Étape 3 : 3 périodes à l'état « Planifiée » couvrant l'année test sans trou ; relever leurs codes et dates. Réappliquer un plan refuse : "L'année a déjà des périodes de ces types : supprimez-les (si elles sont encore planifiées) avant d'appliquer le plan."

☐ OK ☐ KO

---

## Étape 18 — Lire les programmes
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 Menu **« Académique »** > **« Programmes »** (`/v2/academic/programs`)

1. Lire l'« Arborescence des programmes » : `COLLEGE` ("Enseignement secondaire — premier cycle") et `LYCEE` (second cycle).
2. Cliquer `COLLEGE`.

✅ Détail avec « Nature », « Domaine », « Durée (mois) », « Cycle diplômant », « Contrat de calcul des résultats » et « Niveaux couverts » : cases cochées 6e, 5e, 4e, 3e.

☐ OK ☐ KO

---

## Étape 19 — Créer le programme `TG-COL`
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 **« Programmes »** > **« Nouveau programme »**

1. Cliquer **« Nouveau programme »** (fenêtre « Créer un programme ») et saisir :

| Champ | Valeur |
| :--- | :--- |
| Code | `TG-COL` |
| Libellé | `Collège test guide` |
| Niveau d'enseignement | "Premier cycle du secondaire" |
| Programme parent | (laisser « Aucun (programme de premier niveau) ») |
| Cycle diplômant | décoché |
| Description | `Programme de test du guide` |

2. Cliquer **« Nouveau programme »** (validation).
3. Sélectionner le programme créé. Dans « Niveaux couverts », cocher "6e", cliquer **« Enregistrer les niveaux »**.

✅ Étape 2 : « Le programme Collège test guide a été créé. » (le code reste en majuscules). Étape 3 : « Les niveaux couverts ont été enregistrés. » ; valeurs conservées après rechargement.

⚠️ *Test d'erreur* : code `COLLEGE` → "Ce code de programme existe déjà dans l'établissement." ; code `TG COL` (espace) → "Code en majuscules (A-Z, 0-9, _ . -), 40 caractères max." ; code et libellé vides → « Ce champ est obligatoire. ».

☐ OK ☐ KO

---

## Étape 20 — Lire le curriculum de démonstration
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 Menu **« Académique »** > **« Curriculum »** (`/v2/academic/curriculum`)

1. Dans « Programme », choisir "Enseignement secondaire — premier cycle (COLLEGE)" ; dans « Année », "Année scolaire 2026-2027".
2. Cliquer **« Rapport de validation »**.
3. Cliquer un nœud matière (par exemple Français).

✅ « Version du curriculum » avec la pastille « Publiée », "5 nœuds" (un nœud de niveau nommé "6e A" par la graine, puis Français coef. 3, Mathématiques 3, Anglais 2, Histoire-Géographie 2), bandeau « Cette version est publiée : elle ne se modifie plus directement. Un amendement motivé et journalisé est possible. » Aucun bouton « Ajouter à la racine ». Rapport : "Le curriculum est valide (3 avertissements)" (niveaux 5e, 4e, 3e sans nœud, affichés par identifiant).

☐ OK ☐ KO

---

## Étape 21 — Construire le curriculum `TG-COL` (brouillon)
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 **« Curriculum »**

1. Choisir le programme `TG-COL` ("Collège test guide") et l'année "Année scolaire 2026-2027" : message « Aucun curriculum pour ce programme cette année. ». Cliquer **« Créer une version vide »**.
2. Cliquer **« Ajouter à la racine »** et créer le nœud de niveau ; puis, en sélectionnant le nœud `TG-6E` et **« Ajouter un enfant »**, les trois matières (champ « Matière » : taper `Fran`, `Math`, `Ang` et choisir dans la liste) :

| Type de nœud | Code | Libellé | Matière | Niveau | Coefficient |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Niveau | `TG-6E` | `6e test guide` | | 6e | |
| Matière | `TG-FRAN` | `Français test guide` | Français | | `3` |
| Matière | `TG-MATH` | `Mathématiques test guide` | Mathématiques | | `3` |
| Matière | `TG-ANG` | `Anglais test guide` | Anglais | | `2` |

3. Cliquer **« Rapport de validation »**.

✅ Étape 1 : « La version a été créée. » (état « Brouillon », "Aucun nœud"). Chaque ajout : « Le nœud … a été ajouté. ». Étape 3 : "Le curriculum est valide (sans avertissement)." La version reste en brouillon : la publication est faite plus loin (étape *Publier le curriculum TG-COL*).

⚠️ *Test d'erreur* : un second nœud de code `TG-FRAN` sous le même parent → "Ce code existe déjà parmi les nœuds frères." ; coefficient `abc` → "Décimal attendu (ex. 2 ou 2.5)." ; nœud de niveau "5e" → "Le niveau n'est pas couvert par le programme."

⚠️ *Écart connu* : le catalogue de matières ne se crée nulle part dans l'interface : n'utiliser que les matières de la graine.

☐ OK ☐ KO

---

## Étape 22 — Lire la classe de démonstration `6E-A`
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 Menu **« Académique »** > **« Classes »** (`/v2/academic/classrooms`)

1. Lire l'écran « Classes et promotions » : filtres « Année », « Programme », « État » (valeur « Tous ») ; colonnes « Classe », « Code », « Programme », « Niveau », « Effectif », « État ».
2. Cliquer sur le nom `6e A`.

✅ Classe `6E-A` "6e A", capacité 40, effectif `x / 40`, état « Active ». Fiche : « État », « Année », « Effectif », « Capacité », section « Élèves » (« Nom », « Matricule », « N° d'inscription », « Inscription ») et section « Enseignants » (« Enseignant », « Rôle », « Portée », « Période »). Ne pas utiliser « Terminer » ni « Annuler la classe » sur cette classe.

☐ OK ☐ KO

---

## Étape 23 — Créer les classes `TG-6EB` et `TG-6EC`
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 **« Classes »** > **« Nouvelle classe »**

1. Revenir à la liste, cliquer **« Nouvelle classe »** (fenêtre « Créer une classe ») et saisir :

| Champ | Valeur |
| :--- | :--- |
| Année | Année scolaire 2026-2027 |
| Programme | "Enseignement secondaire — premier cycle" |
| Niveau | 6e |
| Curriculum | "Version publiée 1 (5 nœuds)" |
| Code | `TG-6EB` |
| Nom | `6e B test guide` |
| Nature | « Classe » |
| Capacité | `30` |
| Capacité bloquante | décochée |

2. Cliquer **« Nouvelle classe »** (validation).
3. Recréer une seconde classe avec les mêmes valeurs, sauf : « Curriculum » laissé sur « Aucun », Code `TG-6EC`, Nom `6e C test guide`, Capacité `1`, « Capacité bloquante » **cochée**.

✅ Message « La classe 6e B test guide a été créée. » ; la ligne apparaît à l'état « Brouillon », effectif `0 / 30`. La seconde classe sert plus tard (classe pleine, transfert).

⚠️ *Test d'erreur* : code `6E-A` avec le même programme et niveau → "Ce code de classe existe déjà pour ce programme et ce niveau." ; nom `6e A` → "Ce nom de classe existe déjà pour ce programme et ce niveau." ; code `TG 6EB` → "Code en majuscules (A-Z, 0-9, _ . -), 40 caractères max."

☐ OK ☐ KO

---

## Étape 24 — Activer la classe `TG-6EB`
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 **« Classes »** > fiche de `6e B test guide`

1. Ouvrir la fiche de `6e B test guide` (état « Brouillon »).
2. Cliquer **« Activer »**. Dans la fenêtre « Activer 6e B test guide » ("L'activation ouvre la classe aux inscriptions et à la scolarité."), cliquer **« Activer »**.
3. Retourner à la liste, filtrer « Année » = Année scolaire 2026-2027 et « État » = « Active ».

✅ Message « La classe 6e B test guide est active. » ; la classe figure dans la liste filtrée avec l'effectif `0 / 30`.

⚠️ *Test d'erreur* : ouvrir la fiche de `6e C test guide` (sans curriculum) et tenter **« Activer »** → "Choisissez un curriculum avant d'activer la classe." ; la classe reste en « Brouillon » pour toute la suite (une classe en brouillon accepte les inscriptions).

☐ OK ☐ KO

---

## Étape 25 — Offres de cours : fonction réservée au supérieur
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 Adresse `/v2/academic/offerings`

1. Taper `/v2/academic/offerings` (l'entrée « Offres de cours » n'existe pas dans le menu « Académique » du Collège).

✅ L'écran s'ouvre avec l'avis « L'inscription à la carte n'est pas incluse dans l'offre de l'établissement. » et ne permet aucune action : la fonction `academic.a-la-carte` n'existe que pour le pack Supérieur.

☐ OK ☐ KO

---

## Étape 26 — Droits : ce que le directeur des études et l'enseignant ne voient pas
👤 **directeur des études** (secondaire-test) · fenêtre **A**, puis 👤 **enseignant** · fenêtre **B**

1. En directeur des études, taper `/v2/academic/rollover`, puis `/v2/academic/rollover/runs`.
2. Sur `/v2/academic/years`, constater qu'aucune ligne n'a de bouton « Clôturer ».
3. Fenêtre **B**, se connecter en enseignant (`enseignant@secondaire-test.test`) et taper `/v2/academic/years`, `/v2/academic/classrooms`, `/v2/academic/settings`.

✅ Étape 1 : redirection vers `/unauthorized`, « Accès refusé » (la reconduction est réservée au propriétaire et au directeur ; la barre « Cœur académique » n'a pas d'onglet « Reconduction »). Étape 3 : « Accès refusé » à chaque adresse ; le menu de l'enseignant n'a pas de module « Académique ». Se déconnecter de la fenêtre **B**.

🔒 *Test de droit* : fait dans cette étape (deux comptes).

☐ OK ☐ KO

---

## Étape 27 — ⚠️ Irréversible : publier le curriculum `TG-COL`
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 **« Curriculum »**, programme `TG-COL`, année "Année scolaire 2026-2027"

1. Sélectionner la version brouillon construite à l'étape *Construire le curriculum TG-COL*.
2. Cliquer **« Publier »**. La fenêtre « Publier cette version » ("Une version publiée sert de référence aux classes, aux offres et aux notes…") s'ouvre ; cliquer **« Publier »**.

✅ Message « La version est publiée. » ; la mention « Publiée le … » apparaît, la pastille passe à « Publiée » et tous les boutons d'édition disparaissent (la version ne se modifie plus que par amendement motivé, ce qui relève du directeur).

☐ OK ☐ KO

---

## Étape 28 — Reconduction annuelle : aperçu sans écriture
👤 **propriétaire** (secondaire-test, `direction.generale@secondaire-test.test`, **MFA**) · fenêtre **A** (après « Se déconnecter » du directeur des études) · 📂 Menu **« Académique »** > **« Reconduction annuelle »** (`/v2/academic/rollover`)

1. Se connecter en propriétaire. Ouvrir « Reconduction annuelle ».
2. Étape « Années » : cliquer d'abord **« Suivant »** sans rien choisir. Puis « Année source » = "Année scolaire 2026-2027" et « Année cible » = "Année test guide 2027-2028". **« Suivant »**.
3. Étape « Éléments à reconduire » (« Cochez ce que vous voulez copier. Chaque étape peut être refaite sans doublon. ») : laisser tout coché, **« Suivant »**.
4. Étape « Aperçu » : lire les rubriques.
5. Cliquer **« Actualiser l'aperçu »**. **Ne pas passer à l'étape suivante.**
6. Ouvrir « Historique des reconductions » (`/v2/academic/rollover/runs`), « Année source » = Année scolaire 2026-2027.

✅ Étape 2 : « Choisissez l'année source. » et « Choisissez l'année cible. ». Étape 4 : « Aperçu en lecture seule : aucune donnée n'a été modifiée. » ; « Curriculum par programme » avec « Sera cloné » pour `COLLEGE` ; « Classes à créer » avec `6e A`, `6e B test guide` (code et capacité) ; l'avertissement « L'année cible a déjà des périodes » (les périodes de l'année test existent) ; des anomalies « Décision de fin d'année manquante » et l'avertissement « Décisions de passage manquantes » (aucune décision de passage n'est saisie au départ). Le statut de l'année cible dans la liste est « Brouillon » (*à vérifier*). Étape 6 : "Aucune reconduction pour cette année." — rien n'a été créé.

⚠️ *Test d'erreur* : tout décocher à l'étape « Éléments à reconduire », **« Suivant »** → « Retenez au moins une étape. ».

⚠️ *Écart connu* : « Suivant » reste muet tant que l'aperçu n'est pas calculé ; patienter. Ne **pas** lancer la reconduction ici : elle est durable (chapitre 03, scénario 3.13), de même que la clôture de l'année test (3.14), à jouer en fin de guide.

☐ OK ☐ KO

---

📚 *Pour aller plus loin* : chapitre 03, scénarios 3.3 à 3.5 (trou et chevauchement entre années, ajout, suppression et cycle de vie d'une période), 3.6 (paramètres académiques), 3.8 (amendement et clonage du curriculum), 3.10 (offres de cours à la carte, supérieur), 3.11 (calendrier), 3.12 à 3.15 (reconduction réelle, clôture de l'année test, droits et isolation).

**Ce que la phase laisse dans l'application :**
- Année `TG-2027-2028` "Année test guide 2027-2028" à l'état « Brouillon », avec ses 3 périodes « Planifiée » (non ouverte, non clôturée).
- Programme `TG-COL` "Collège test guide" (niveau 6e couvert) avec son curriculum publié 2026-2027 (4 nœuds : `TG-6E`, `TG-FRAN`, `TG-MATH`, `TG-ANG`).
- Classe `TG-6EB` "6e B test guide" (programme `COLLEGE`, niveau 6e, capacité 30, curriculum « Version publiée 1 »), **active**, effectif 0.
- Classe `TG-6EC` "6e C test guide" (capacité 1 bloquante, sans curriculum), en « Brouillon ».
- Aucune reconduction lancée, aucune année clôturée.

---

[⬅ Sommaire](../GUIDE_TEST_UTILISATEUR_COMPLET.md) · [← Précédent](01-connexion-abonnement-roles.md) · [Suivant →](03a-personnes-imports.md)
