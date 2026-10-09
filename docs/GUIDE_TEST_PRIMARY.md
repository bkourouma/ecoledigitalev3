# 🧭 Guide de test — Pack Primaire (École Les Flamboyants)

Parcours complet, étape par étape, sur une **école neuve et vide**. Chaque étape indique **qui se connecte, quel menu ouvrir, quoi faire et quelles données saisir**.

- Application : <http://localhost:3000> (connexion : <http://localhost:3000/v2/login>)
- Date de référence : **J = vendredi 9 octobre 2026**. Année scolaire créée : **2026-2027**.
- Suivez les étapes **dans l'ordre** : chaque étape utilise les données de la précédente.
- **Deux comptes existent pour l'instant** : le propriétaire (qui fait tout le parcours) et le directeur. Les gestes qui demandent un autre rôle sont à la fin (phase "À jouer quand les autres comptes existeront").
- Rédigé en lisant le code, sans rejouer chaque scénario : si ce que vous voyez diffère d'un ✅, notez-le.

---

## Avant de commencer

### 1. Lancer l'application

```bash
pnpm dev:v2
```

L'école est déjà créée dans la base locale `ecoledigitale_v2`. Pour la recréer (vide, avec son seul compte) :

```bash
pnpm dev:v2:new-school
```

### 2. Une fenêtre de navigateur

| Fenêtre | Usage |
| :--- | :--- |
| **A** — normale | Toujours connectée en **propriétaire** |
| **B** — navigation privée | Les autres comptes, plus tard (on change de compte avec « Se déconnecter », menu du compte) |

### 3. Compte

| Rôle | E-mail | MFA |
| :--- | :--- | :---: |
| Propriétaire | `direction.generale@ecole-flamboyants.test` | oui |
| Directeur | `directeur@ecole-flamboyants.test` | oui |

Connexion : `/v2/login` → panneau **« Comptes par tenant »** (attendre quelques secondes) → établissement `ecole-flamboyants` → cliquer le compte (e-mail et mot de passe se remplissent) → **« Se connecter »** → **« Afficher le code MFA »** sous le compte → saisir le code à 6 chiffres → **« Valider »**. Le panneau n'existe pas sur `/login`.

> Juste après l'ouverture d'une page, un message transitoire (« Établissement inconnu… », « non incluse dans l'offre ») peut s'afficher : attendre 3-4 secondes.

### 4. Fichiers fournis (`docs/guide-test-primary/jeux-de-donnees/`)

| Fichier | Utilisé |
| :--- | :--- |
| `01-eleves-valide-primaire.csv` | import des élèves (3 lignes) |
| `01-eleves-erreurs-primaire.csv` | import avec erreurs (9 lignes) |
| `02-tuteurs-valide-primaire.csv` | import des tuteurs (3 lignes) |

### 5. Légende

✅ résultat attendu · ⚠️ *Test d'erreur* · ⚠️ *Écart connu* défaut déjà repéré · 🕓 à jouer plus tard · ☐ OK ☐ KO à cocher.
Texte entre « » = libellé de l'interface ; texte entre guillemets droits ou `code` = valeur à saisir ou message du serveur.

---

## Phase 1 — Première connexion et visite de l'école vide

Objectif : se connecter au seul compte de l'école (le propriétaire, avec MFA), constater que l'école est vide, compléter son profil, puis éprouver la sécurité du compte et la déconnexion.

### Étape 1 — Se connecter en propriétaire (avec MFA)
👤 **propriétaire** (MFA) · fenêtre **A** · 📂 Page de connexion (`/v2/login`)
🔑 **Connexion** (fenêtre **A**) : `/v2/login` → établissement `ecole-flamboyants` → compte **propriétaire** (`direction.generale@ecole-flamboyants.test`, avec code MFA) → « Se connecter ».

1. Ouvrir l'adresse (si un sélecteur « Établissement » apparaît, choisir `ecole-flamboyants`).
2. Dans le panneau « Comptes par tenant », cliquer le compte « Propriétaire » : e-mail et mot de passe se remplissent.
3. Essai refusé : remplacer le mot de passe par `MotDePasseFaux-2026`, cliquer **« Se connecter »**.
4. Recliquer le compte « Propriétaire », cliquer **« Afficher le code MFA »**, puis **« Se connecter »**.
5. Écran « Vérification en deux étapes » : cliquer **« Valider »** (code prérempli).

✅ Arrivée sur `/v2/direction`, « Tableau de bord » (onglet actif), nom "École Primaire Les Flamboyants" en haut à gauche. Le panneau ne liste qu'**un seul compte** (propriétaire, badge MFA).

⚠️ *Test d'erreur* (action 3, au plus 2 essais : 5 échecs = blocage d'une minute) : « Identifiants invalides. Vérifiez votre e-mail et votre mot de passe. » et le champ « Mot de passe » est vidé.

☐ OK ☐ KO

---

### Étape 2 — Lire le tableau de bord de l'école vide
👤 **propriétaire** · fenêtre **A** · 📂 `/v2/direction`, puis Menu **« Personnes »** > **« Élèves »** (`/v2/students`)

1. Attendre 3 à 4 secondes la fin des chargements, lire les cartes « Indicateurs de la direction ».
2. Ouvrir **« Élèves »** (`/v2/students`).
3. Ouvrir Menu **« Utilisateurs »** (`/v2/admin/members`) ; ne rien cliquer sur la ligne du membre.

✅ « Élèves en scolarité » = `0` avec « 0 inscription(s) au total · 0 classe(s) » ; les autres cartes affichent « Non mesuré » ou `0`, sans erreur rouge. « Aucun élève pour le moment. » ; « Membres » : **une seule ligne**, `direction.generale@ecole-flamboyants.test`.

⚠️ *À savoir* : « Établissement inconnu… » ou « Cette fonctionnalité n'est pas incluse dans l'offre… » juste après la connexion = chargement ; attendre 4 s, sinon F5.

☐ OK ☐ KO

---

### Étape 3 — Compléter le profil, vérifier l'établissement, l'abonnement et la mise en service
👤 **propriétaire** · fenêtre **A** · 📂 Menu **« Établissement »** (`/v2/settings`)

1. Onglet « Profil et marque » : saisir :

| Champ | Valeur |
| :--- | :--- |
| Adresse | `Cocody, Abidjan (adresse fictive)` |
| Couleur principale | `#B45309` |

2. Cliquer **« Enregistrer le profil »**, puis F5.
3. Onglet « Établissements et campus », puis onglet « Abonnement et usage ».
4. Onglet « Mise en service » (ne pas cliquer « Passer en production » : définitif).

✅ « Profil enregistré. » ; après F5, adresse et couleur conservées. Un seul établissement "École Primaire Les Flamboyants" (« Primaire », « Actif ») avec le campus « Campus principal ». Offre `PROFESSIONAL` · « Actif » · pack « Primaire » · « Illimitée ». « Progression : 5 étape(s) sur 11 », « Année académique » = « À faire ».

⚠️ *Test d'erreur* : « Couleur principale » = `orange` → « Couleur hexadécimale attendue (ex. #1A73E8). », puis **« Annuler les modifications »**.

☐ OK ☐ KO

---

### Étape 4 — Se déconnecter puis se reconnecter
👤 **propriétaire** · fenêtre **A** · 📂 En-tête **« Se déconnecter »**, puis `/v2/login`

1. Cliquer **« Se déconnecter »**.
2. Taper à la main `/v2/direction`.
3. Taper `/v2/login`, cliquer le compte « Propriétaire », **« Afficher le code MFA »**, **« Se connecter »**, puis **« Valider »**.

✅ Après la déconnexion : retour sur `/login` ; `/v2/direction` redirige vers la connexion, aucune donnée de l'école visible. Après la reconnexion : arrivée sur `/v2/direction`.

⚠️ *Écart connu* : après « Se déconnecter », l'application renvoie vers `/login` (sans panneau de comptes) : retaper `/v2/login`.

☐ OK ☐ KO

---

## Phase 2 — Structure académique de l'école

Objectif : poser l'année 2026-2027 et ses trimestres, les matières et curriculums du primaire et de la maternelle, puis les trois classes.

### Étape 5 — Créer l'année 2026-2027
👤 **propriétaire** · fenêtre **A** · 📂 Menu **« Académique »** > **« Années et périodes »** (`/v2/academic/years`)

1. Cliquer **« Nouvelle année »**.
2. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Code | `2026-2027` |
| Libellé | `Année scolaire 2026-2027` |
| Début | `07/09/2026` |
| Fin | *(laisser vide)* |

3. Cliquer **« Nouvelle année »** (validation de la fenêtre), puis F5.

✅ « L'année Année scolaire 2026-2027 a été créée. » · ligne du 7 septembre 2026 au 6 septembre 2027, état « Brouillon », boutons « Périodes », « Ouvrir », « Modifier ».

⚠️ *Test d'erreur* : code `2026-2027`, libellé `Doublon`, début `07/09/2027` → « Ce code d'année existe déjà dans l'établissement. » (annuler).

☐ OK ☐ KO

---

### Étape 6 — Générer les trois trimestres
👤 **propriétaire** · fenêtre **A** · 📂 **« Années et périodes »** > bouton **« Périodes »** de la ligne de l'année

1. Cliquer **« Périodes »** sur la ligne « Année scolaire 2026-2027 ».
2. Cliquer **« Générer depuis un plan »**.
3. « Plan de périodes » = `Trois trimestres`.
4. Cliquer **« Générer depuis un plan »** (bouton de la fenêtre).

✅ "3 périodes ont été générées." ; trois périodes « Planifiée » :

| Période | Dates attendues |
| :--- | :--- |
| Trimestre 1 | du 7 septembre 2026 au 5 janvier 2027 |
| Trimestre 2 | du 6 janvier au 7 mai 2027 |
| Trimestre 3 | du 8 mai au 6 septembre 2027 |

⚠️ *Test d'erreur* : rejouer le même plan → « L'année a déjà des périodes de ces types : supprimez-les (si elles sont encore planifiées) avant d'appliquer le plan. »

☐ OK ☐ KO

---

### Étape 7 — Ouvrir l'année, la définir courante, ouvrir le Trimestre 1
👤 **propriétaire** · fenêtre **A** · 📂 **« Années et périodes »** (`/v2/academic/years`)

1. Essai refusé : dans le panneau « Périodes », ligne « Trimestre 1 », cliquer **« Ouvrir »**.
2. Sur la ligne de l'année, cliquer **« Ouvrir »**, puis **« Définir comme courante »**.
3. Dans le panneau « Périodes », ligne « Trimestre 1 », cliquer **« Ouvrir »**, puis F5.

✅ « L'année Année scolaire 2026-2027 est ouverte. » · "…est désormais l'année courante." (badges « Ouverte » et « Courante ») · « La période Trimestre 1 est ouverte. » ; Trimestre 2 et 3 restent « Planifiée ».

⚠️ *Test d'erreur* (action 1) : « Ouvrez l'année avant d'ouvrir ses périodes. » Ne cliquer ni « Clore les notes », ni « Clore », ni « Clôturer ».

☐ OK ☐ KO

---

### Étape 8 — Lire les programmes et les niveaux du pack
👤 **propriétaire** · fenêtre **A** · 📂 Menu **« Académique »** > **« Programmes et niveaux »** (`/v2/academic/programs`)

1. Dans « Arborescence des programmes », cliquer `MATERNELLE`, lire « Niveaux couverts ».
2. Cliquer `PRIMAIRE`, lire « Niveaux couverts ».

✅ Deux programmes (aucune matière à ce stade) :

| Programme | Niveaux couverts | Contrat de calcul |
| :--- | :--- | :--- |
| `MATERNELLE` "Enseignement préscolaire" | Petite Section, Moyenne Section, Grande Section | `competency-period@1` |
| `PRIMAIRE` "Enseignement primaire" | CP1, CP2, CE1, CE2, CM1, CM2 | `coef-period@1` |

⚠️ *Test d'erreur* : **« Nouveau programme »**, code `MATERNELLE`, libellé `Doublon`, niveau d'enseignement "Maternelle" → « Ce code de programme existe déjà dans l'établissement. » (fermer sans créer).

☐ OK ☐ KO

---

### Étape 9 — Créer les curriculums (brouillons) et le nœud Grande Section
👤 **propriétaire** · fenêtre **A** · 📂 Menu **« Académique »** > **« Curriculum »** (`/v2/academic/curriculum`)

1. « Programme » = `Enseignement primaire (PRIMAIRE)`, « Année » = `Année scolaire 2026-2027`, cliquer **« Créer une version vide »**.
2. « Programme » = `Enseignement préscolaire (MATERNELLE)` (même année), cliquer **« Créer une version vide »**.
3. Sur ce curriculum, cliquer **« Ajouter à la racine »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Type de nœud | Niveau |
| Code | `GS` |
| Libellé | `Grande Section` |
| Niveau | Grande Section |

4. Cliquer **« Ajouter »**.

✅ « La version a été créée. » (deux fois, pastille « Brouillon », "Aucun nœud") · « Le nœud Grande Section a été ajouté. » · arbre « Niveau Grande Section GS ».

⚠️ *Écart connu* : aucun écran « Matières » n'existe ; les matières ne se créent que par l'import des deux étapes suivantes (la recherche de matière de « Ajouter un enfant » est vide).

☐ OK ☐ KO

---

### Étape 10 — Importer les matières du primaire (CSV)
👤 **propriétaire** · fenêtre **A** · 📂 Menu **« Imports »** > **« Imports Excel / CSV »** (`/v2/imports`)

Créer le fichier `flamboyants-matieres-primaire.csv` (UTF-8) :

```
Code du noeud,Libellé,Type de noeud (code),Code du parent,Code de la matière,Niveau (code),Coefficient,Ordre d'affichage,Obligatoire
CP1,CP1,LEVEL,,,CP1,,1,oui
CP1-FRANC,Français,SUBJECT,CP1,FRANC,,4,1,oui
CP1-MATHS,Mathématiques,SUBJECT,CP1,MATHS,,4,2,oui
CP1-EVEIL,Éveil / Sciences,SUBJECT,CP1,EVEIL,,2,3,oui
CP1-EPS,Éducation physique et sportive,SUBJECT,CP1,EPS,,1,4,oui
CM2,CM2,LEVEL,,,CM2,,2,oui
CM2-FRANC,Français,SUBJECT,CM2,FRANC,,4,1,oui
CM2-MATHS,Mathématiques,SUBJECT,CM2,MATHS,,4,2,oui
CM2-EVEIL,Éveil / Sciences,SUBJECT,CM2,EVEIL,,2,3,oui
CM2-EPS,Éducation physique et sportive,SUBJECT,CM2,EPS,,1,4,oui
```

1. Onglet **« Nouvel import »** : importeur `Matières et curriculum`, choisir le fichier, **« Envoyer et continuer »**.
2. Étape « Colonnes » (association automatique complète) : « Version de curriculum (brouillon) » = `Enseignement primaire — brouillon (0 noeud(s))`, **« Enregistrer et valider le fichier »**.
3. À l'aperçu (quelques secondes) : cocher « J'ai consulté l'aperçu et les erreurs, et je confirme le lancement de l'import. », **« Lancer l'import »**.
4. Menu **« Curriculum »** (`PRIMAIRE`, 2026-2027) : déplier l'arbre.

✅ Aperçu : « À créer » 10 · « En erreur » 0 · « Avertissements » 8 · « Import terminé ». Arbre "10 nœuds" : `CP1` et `CM2`, chacun avec Français (coef. 4), Mathématiques (4), Éveil / Sciences (2), Éducation physique et sportive (1).

⚠️ *Test d'erreur* (action 2) : version laissée vide → « Cette option est obligatoire. »

☐ OK ☐ KO

---

### Étape 11 — Importer les matières de la Grande Section et ajouter l'EPS à la main
👤 **propriétaire** · fenêtre **A** · 📂 **« Imports Excel / CSV »** (`/v2/imports/new`), puis **« Curriculum »**

Créer le fichier `flamboyants-matieres-gs.csv` (UTF-8) :

```
Code du noeud,Libellé,Type de noeud (code),Code du parent,Code de la matière,Niveau (code),Coefficient,Ordre d'affichage,Obligatoire
GS-LANGAGE,Langage oral,SUBJECT,GS,LANGAGE,,1,1,oui
GS-EVEIL,Éveil / Sciences,SUBJECT,GS,EVEIL,,1,2,oui
```

1. Même import que l'étape précédente : fichier ci-dessus, « Version de curriculum (brouillon) » = `Enseignement préscolaire — brouillon (1 noeud(s))`, confirmer, **« Lancer l'import »**.
2. Menu **« Curriculum »** (`MATERNELLE`, 2026-2027) : sélectionner `GS`, cliquer **« Ajouter un enfant »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Type de nœud | Matière |
| Code | `GS-EPS` |
| Libellé | `Éducation physique et sportive` |
| Matière | taper `physique`, choisir `Éducation physique et sportive` (EPS) |
| Coefficient | `1` |

3. Cliquer **« Ajouter »**.

✅ Aperçu : « À créer » 2 · « Avertissements » 1 · « Import terminé » · « Le nœud Éducation physique et sportive a été ajouté. » · arbre "4 nœuds" (`GS` et ses trois matières).

⚠️ *Test d'erreur* : second nœud `GS-EPS` sous `GS` → « Ce code existe déjà parmi les nœuds frères. » (fermer sans créer).

☐ OK ☐ KO

---

### Étape 12 — Publier les deux curriculums (irréversible)
👤 **propriétaire** · fenêtre **A** · 📂 Menu **« Académique »** > **« Curriculum »** (`/v2/academic/curriculum`)

1. `PRIMAIRE`, 2026-2027 : cliquer **« Rapport de validation »**.
2. Cliquer **« Publier »**, puis **« Publier »** dans la fenêtre « Publier cette version ».
3. Refaire les actions 1 et 2 pour `MATERNELLE`.

✅ « Le curriculum est valide (4 avertissements). » (primaire) et "(2 avertissements)." (maternelle) · « La version est publiée. » · pastille « Publiée » ; plus de « Ajouter un enfant » ni de « Ajouter à la racine ».

⚠️ *Irréversible* : une version publiée ne se modifie plus que par amendement motivé.

☐ OK ☐ KO

---

### Étape 13 — Créer les trois classes (et tenter d'activer CP1 A)
👤 **propriétaire** · fenêtre **A** · 📂 Menu **« Académique »** > **« Classes »** (`/v2/academic/classrooms`)

1. Cliquer **« Nouvelle classe »**. Pour chaque classe : « Année » = `Année scolaire 2026-2027`, « Nature » = Classe, « Capacité bloquante » décochée, puis :

| Champ | Classe 1 | Classe 2 | Classe 3 |
| :--- | :--- | :--- | :--- |
| Programme | Enseignement préscolaire | Enseignement primaire | Enseignement primaire |
| Niveau | Grande Section | CP1 | CM2 |
| Curriculum | Version publiée 1 (4 nœuds) | Version publiée 1 (10 nœuds) | Version publiée 1 (10 nœuds) |
| Code | `GS-A` | `CP1-A` | `CM2-A` |
| Nom | `Grande Section A` | `CP1 A` | `CM2 A` |
| Capacité | `25` | `35` | `40` |

2. Cliquer **« Nouvelle classe »** (validation) après chacune.
3. Cliquer le nom `CP1 A`, puis **« Activer »**, puis **« Activer »** dans la fenêtre.

✅ « La classe Grande Section A a été créée. » (idem `CP1 A`, `CM2 A`) · trois lignes « Brouillon », effectif `0 / 25`, `0 / 35`, `0 / 40`.

⚠️ *Test d'erreur* (action 3) : « Une classe du primaire ne s'active qu'avec un instituteur titulaire : affectez-en un d'abord. » Les trois classes restent « Brouillon » jusqu'à l'affectation des titulaires (phase « Personnes »).

☐ OK ☐ KO

---

### Étape 14 — Marquer « Année académique » et « Classes » terminées
👤 **propriétaire** · fenêtre **A** · 📂 Menu **« Établissement »** > onglet **« Mise en service »** (`/v2/settings/onboarding`)

1. Ligne « Année académique » : cliquer **« Marquer comme terminée »**.
2. Ligne « Classes » : cliquer **« Marquer comme terminée »** (ne pas cliquer « Passer en production »).

✅ « Étape mise à jour. » (deux fois) · « Année académique » et « Classes » = « Terminée » · « Progression : 7 étape(s) sur 11 ».

☐ OK ☐ KO

---

## Phase 3 — Pack Primaire : réglages et référentiels

Objectif : configurer le pack Primaire (réglages, modèle de pack, échelle, référentiel de compétences, phrases d'appréciation) et lire les états. *(Les pages affichent brièvement « Établissement inconnu » : attendre 3 à 4 secondes.)*

### Étape 15 — Régler la durée de conservation des archives
👤 **propriétaire** · fenêtre **A** · 📂 Menu **« Pack Primaire »** > onglet **« Paramètres »** (`/v2/primary/parametres`)

1. Cliquer l'onglet **« Paramètres »** et lire « Réglages de l'établissement » :

| Réglage | État au départ |
| :--- | :--- |
| « Exiger un titulaire pour activer une classe » | cochée |
| « Exiger la décision du conseil pour sceller un bilan » | cochée |
| « Activer la banque d'appréciations » | cochée |
| « Durée de conservation des archives (années) » | vide |

2. Saisir la durée :

| Champ | Valeur |
| :--- | :--- |
| Durée de conservation des archives (années) | `10` |

3. Cliquer **« Enregistrer les réglages »**, puis recharger la page (F5).
4. Vider le champ et cliquer de nouveau **« Enregistrer les réglages »**.

✅ « Réglages enregistrés. » à chaque enregistrement · après F5 le champ affiche `10`, puis il est vide à la fin.

⚠️ *Test d'erreur* : `201` → "La valeur doit être inférieure ou égale à 200."

☐ OK ☐ KO

---

### Étape 16 — Appliquer le modèle de pack
👤 **propriétaire** · fenêtre **A** · 📂 Menu **« Pack Primaire »** > onglet **« Paramètres »** (`/v2/primary/parametres`)

1. Section **« Modèle de pack »** : cliquer **« Appliquer le modèle de pack »**.
2. Dans la fenêtre, cliquer **« Annuler »** (rien ne se passe), puis rouvrir et cliquer **« Appliquer le modèle »**.
3. Descendre dans « Échelles d'appréciation » et « Référentiels de compétences » et comparer :

| Élément | Contenu de démonstration (pastille « Démonstration ») |
| :--- | :--- |
| Échelle `MASTERY_4` | N1 "Non acquis" · N2 « En cours d'acquisition » · N3 « Acquis » · N4 "Acquis avec aisance" (N3 et N4 : attendu atteint) |
| Référentiel `PRESCHOOL_DEMO` | « Compétences de la maternelle (démonstration) » · version 1 · « Publié » · 3 compétences |
| Référentiel `PRIMARY_DEMO` | « Compétences du primaire (démonstration) » · version 1 · « Publié » · 1 compétence |

✅ « Le modèle était déjà appliqué : rien n'a été modifié. » · la carte `MASTERY_4` porte « Démonstration » et « Verrouillée ».

☐ OK ☐ KO

---

### Étape 17 — Créer l'échelle FLAMBOYANTS_3
👤 **propriétaire** · fenêtre **A** · 📂 Menu **« Pack Primaire »** > onglet **« Paramètres »** (`/v2/primary/parametres`)

1. Dans « Échelles d'appréciation », cliquer **« Nouvelle échelle »**.
2. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Code de l'échelle | `FLAMBOYANTS_3` |
| Libellé | `Échelle des Flamboyants (3 niveaux)` |

3. Remplir les deux niveaux proposés, puis cliquer **« Ajouter un niveau »** pour le troisième :

| Niveau | Code | Libellé | « Attendu atteint » |
| :-: | :--- | :--- | :-: |
| 1 | `NA` | `Non acquis` | non |
| 2 | `EA` | `En cours d'acquisition` | non |
| 3 | `AC` | `Acquis` | **cochée** |

4. Cliquer **« Créer l'échelle »**.

✅ « Échelle créée. » · carte `FLAMBOYANTS_3` : NA Non acquis, EA En cours d'acquisition, AC Acquis (attendu atteint) · sans « Démonstration » ni « Verrouillée ».

⚠️ *Test d'erreur* : code `echelle-3` → « Code attendu : majuscules, chiffres et _ (2 à 40). »

☐ OK ☐ KO

---

### Étape 18 — Créer le référentiel FLAMBOYANTS_CE1 (brouillon)
👤 **propriétaire** · fenêtre **A** · 📂 Menu **« Pack Primaire »** > onglet **« Paramètres »** (`/v2/primary/parametres`)

1. Dans « Référentiels de compétences », cliquer **« Nouveau référentiel »**.
2. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Code du référentiel | `FLAMBOYANTS_CE1` |
| Libellé | `Français et mathématiques CE1 (Flamboyants)` |
| Échelle d'appréciation | `Échelle des Flamboyants (3 niveaux)` |
| Niveaux de classe concernés | `CE1` *(aucune classe CE1 : les 3 classes ne sont pas touchées)* |

3. Cliquer **« Créer le brouillon »**.

✅ « Référentiel créé en brouillon. » · ligne "Français et mathématiques CE1 (Flamboyants)" version 1 · « Brouillon » · « Aucune compétence » · bloc « Ce qui empêche la publication : » → « Ajoutez au moins une compétence. » · « Niveaux de l'échelle : NA, EA, AC ».

⚠️ *Test d'erreur* : code `ce1-francais` → « Code attendu : majuscules, chiffres et _ (2 à 40). »

☐ OK ☐ KO

---

### Étape 19 — Saisir domaines et compétences
👤 **propriétaire** · fenêtre **A** · 📂 Menu **« Pack Primaire »** > onglet **« Paramètres »** (`/v2/primary/parametres`)

1. Sur la version 1 de FLAMBOYANTS_CE1, cliquer **« Ouvrir »** puis **« Modifier la structure »**.
2. Cliquer **« Ajouter un domaine »** (4 fois), **« Ajouter une compétence »** pour la deuxième de chaque domaine, et saisir :

| Domaine (code / libellé) | Compétence (code / libellé) |
| :--- | :--- |
| `LO` / `Langage oral` | `LO.1` / `S'exprime en phrases complètes` |
| | `LO.2` / `Raconte un événement vécu en respectant l'ordre des faits` |
| `LECT` / `Lecture` | `LECT.1` / `Lit à voix haute un texte court en respectant la ponctuation` |
| | `LECT.2` / `Répond à des questions sur un texte lu` |
| `ECR` / `Écriture` | `ECR.1` / `Copie un texte court sans erreur` |
| | `ECR.2` / `Écrit une phrase simple sous dictée` |
| `MATH` / `Mathématiques` | `MATH.1` / `Dénombre, compare et range les nombres jusqu'à 1 000` |
| | `MATH.2` / `Résout un problème simple d'addition ou de soustraction` |

3. Cliquer **« Enregistrer la structure »**.

✅ « Structure enregistrée. » · la ligne indique "8 compétences" · le bloc « Ce qui empêche la publication : » a disparu.

⚠️ *Test d'erreur* : « Code de la compétence 1.1 » = `lo 1` → « Code attendu : majuscules, chiffres, . - et _ (1 à 40). »

☐ OK ☐ KO

---

### Étape 20 — Publier le référentiel
👤 **propriétaire** · fenêtre **A** · 📂 Menu **« Pack Primaire »** > onglet **« Paramètres »** (`/v2/primary/parametres`)

1. Sur FLAMBOYANTS_CE1 version 1, cliquer **« Publier »**.
2. Cocher **« Je comprends que la publication est définitive »**, puis cliquer **« Publier »** dans la fenêtre.
3. Remonter à « Échelles d'appréciation » et relire la carte `FLAMBOYANTS_3`.

✅ « Référentiel publié. » · pastille « Publié » · « Référentiel publié : immuable. Créez une nouvelle version pour le modifier. » · il ne reste que « Créer une nouvelle version » · `FLAMBOYANTS_3` porte « Verrouillée ».

⚠️ *Test d'erreur* : dans la fenêtre « Publier le référentiel », le bouton « Publier » reste inactif tant que la case n'est pas cochée.

☐ OK ☐ KO

---

### Étape 21 — Créer et publier la version 2
👤 **propriétaire** · fenêtre **A** · 📂 Menu **« Pack Primaire »** > onglet **« Paramètres »** (`/v2/primary/parametres`)

1. Sur la version 1, cliquer **« Créer une nouvelle version »**.
2. Sur la version 2 (brouillon), cliquer **« Modifier la structure »**, puis **« Ajouter une compétence »** sous "Langage oral" et saisir :

| Champ | Valeur |
| :--- | :--- |
| Code de la compétence 1.3 | `LO.3` |
| Libellé de la compétence 1.3 | `Participe à un échange en respectant le tour de parole` |

3. Cliquer **« Enregistrer la structure »**, puis **« Publier »**, cocher la case de confirmation et cliquer **« Publier »**.

✅ « Version 2 créée en brouillon. » (8 compétences) · « Structure enregistrée. » (9) · « Référentiel publié. » · version 2 « Publié », version 1 « Retiré ».

⚠️ *Test d'erreur* : avant l'étape 2, rouvrir la version 1 et cliquer « Créer une nouvelle version » → « Une version brouillon de ce référentiel existe déjà : la terminer ou la supprimer. »

☐ OK ☐ KO

---

### Étape 22 — Créer 3 phrases d'appréciation
👤 **propriétaire** · fenêtre **A** · 📂 Menu **« Pack Primaire »** > onglet **« Appréciations »** (`/v2/primary/appreciations`)

1. Lire la liste : 3 phrases « Démonstration » (`PERIOD_N1`, `PERIOD_N3`, `YEAR_GENERIC`).
2. Cliquer **« Nouvelle phrase »**, saisir une ligne, puis **« Créer la phrase »** (3 fois). Pour « Niveau de classe », choisir `CM2` / `CP1` (laisser « Tous » si la liste ne propose que « Tous ») :

| Code | Portée | Texte de la phrase | Niveau de maîtrise | Niveau de classe |
| :--- | :--- | :--- | :--- | :--- |
| `PERIOD_N2_ENCOURAGEMENT` | Période | `Des progrès sont visibles : poursuivez vos efforts avec régularité.` | `N2` | Tous |
| `YEAR_CM2_TRAVAIL` | Année | `Année de travail sérieuse : l'élève a fourni des efforts constants.` | Tous | `CM2` |
| `COMP_LECTURE_AISANCE` | Compétence | `Lit à voix haute avec aisance et en respectant la ponctuation.` | `AC` | `CP1` |

✅ « Phrase créée. » ×3 · les 3 phrases apparaissent sans pastille « Démonstration » (« Niveau N2 », « Classe CM2 », « Niveau AC », « Classe CP1 »).

⚠️ *Test d'erreur* : code `PERIOD_N1` → "Une phrase de code `PERIOD_N1` existe déjà."

☐ OK ☐ KO

---

### Étape 23 — Lire les états du primaire
👤 **propriétaire** · fenêtre **A** · 📂 Menu **« Pack Primaire »** > onglet **« États »** (`/v2/primary/etats`)

1. Ouvrir la liste **« Rapport »** : 7 choix. Choisir « Liste de classe » : les boutons « Afficher l'aperçu » et « Exporter en CSV » sont inactifs.
2. Choisir « Effectifs par niveau et par classe » (« Année » laissée par défaut), puis **« Afficher l'aperçu »**.
3. Choisir « Registre d'appel mensuel », saisir « Classe » = `Grande Section A` et « Mois » = `2026-10`, puis **« Afficher l'aperçu »**.

| Rapport | Champs demandés |
| :--- | :--- |
| Liste de classe | « Classe » |
| Effectifs par niveau et par classe | « Année » (facultatif) |
| Registre d'appel mensuel | « Classe », « Mois » (AAAA-MM) |
| Redoublants | « Année » (facultatif) |
| Couverture des compétences | « Classe », « Période » |
| Dossier du conseil des maîtres | « Conseil » |
| Avancement des classes | « Année » (facultatif) |

✅ Effectifs : colonnes Niveau, Classe, Élèves, Redoublants, une ligne par classe à `0` élève (Grande Section A, CP1 A, CM2 A) · Registre : titre "Registre d'appel — 2026-10", colonne Élève, aucune ligne.

⚠️ *Test d'erreur* : « Mois » = `10/2026` → « Mois attendu au format AAAA-MM. »

☐ OK ☐ KO

---

## Phase 4 — Personnes, inscriptions et titulaires

Créer le personnel, les 9 élèves (6 à la main, 3 par import) et leurs tuteurs, les inscrire, puis désigner les titulaires et activer les 3 classes.

⚠️ **Activer les classes seulement après l'affectation des titulaires** (sinon : « Une classe du primaire ne s'active qu'avec un instituteur titulaire… »).

### Étape 24 — Créer les 3 membres du personnel
👤 **propriétaire** · fenêtre **A** · 📂 Menu **« Personnes »** > **« Personnel »** (`/v2/staff`)

1. Ouvrir l'onglet **« Nouveau membre »** (`/v2/staff/new`). *(Si « Confirmez votre identité » s'affiche : saisir le code à 6 chiffres, puis « Confirmer et continuer ».)*
2. Pour chaque colonne, saisir (dates : taper les chiffres sans barres, ex. `12041988`) :

| Champ | KOFFI | BAMBA | ZOKORA |
| :--- | :--- | :--- | :--- |
| Nom | `KOFFI` | `BAMBA` | `ZOKORA` |
| Prénoms | `Adjoua` | `Séraphin` | `Sylvie` |
| Sexe | « Féminin » | « Masculin » | « Féminin » |
| Date de naissance | `12/04/1988` | `03/09/1981` | `25/01/1990` |
| Lieu de naissance | `Abidjan` | `Abidjan` | `Abidjan` |
| Nationalité (code pays) | `CI` | `CI` | `CI` |
| Adresse e-mail | `adjoua.koffi@ecole-flamboyants.test` | `seraphin.bamba@ecole-flamboyants.test` | `sylvie.zokora@ecole-flamboyants.test` |
| Téléphone | `+225 07 00 00 00 21` | `+225 07 00 00 00 22` | `+225 07 00 00 00 23` |
| Ville | `Abidjan` | `Abidjan` | `Abidjan` |
| Catégorie | « Enseignant » | « Enseignant » | « Enseignant » |
| Intitulé du poste | `Institutrice titulaire` | `Instituteur titulaire` | `Institutrice de maternelle titulaire` |
| Date d'embauche | `01/09/2022` | `01/09/2015` | `01/09/2019` |

3. Cliquer **« Créer la fiche »**, puis **« Retour à la liste »** et **« Nouveau membre »** pour la fiche suivante.

✅ « KOFFI Adjoua — matricule P0001. », « BAMBA Séraphin — matricule P0002. », « ZOKORA Sylvie — matricule P0003. »

⚠️ *Test d'erreur* : « Créer la fiche » sur formulaire vide → « Ce champ est obligatoire. » sous « Nom » et « Prénoms ».

☐ OK ☐ KO

---

### Étape 25 — Relire la liste et modifier une fiche
👤 **propriétaire** · fenêtre **A** · 📂 Menu **« Personnes »** > **« Personnel »** (`/v2/staff`)

1. Lire le tableau « Liste du personnel ». Saisir `bamba` dans « Rechercher un membre du personnel », puis l'effacer.
2. Cliquer **KOFFI Adjoua**, puis **« Modifier »**.
3. Remplacer « Intitulé du poste » par `Institutrice titulaire du CP1`, cliquer **« Enregistrer »**.
4. Rouvrir **« Modifier »**, remettre `Institutrice titulaire`, **« Enregistrer »**.

✅ 3 lignes (P0001 à P0003), statut « En poste » · recherche `bamba` : 1 ligne · « La fiche a été mise à jour. » après chaque enregistrement.

⚠️ *Test d'erreur* : dans « Modifier », vider « Nom » → « Ce champ est obligatoire. » (fermer sans enregistrer).

⚠️ *Ne pas cliquer « Inviter au portail »* : il crée un accès réel (étape différée, comptes des titulaires).

☐ OK ☐ KO

---

### Étape 26 — Régler la confirmation et la numérotation des inscriptions
👤 **propriétaire** · fenêtre **A** · 📂 Menu **« Académique »** > **« Paramètres académiques »** (`/v2/academic/settings`)

1. Onglet **« Inscriptions »** : lire « Confirmation des inscriptions » (ne rien modifier).
2. Onglet **« Numérotation »**, section « Numéro d'inscription » : saisir

| Champ | Valeur |
| :--- | :--- |
| Motif du numéro d'inscription | `{PREFIX}-{YEAR}-{LEVEL}-{STUDENT_SEQ:4}` |
| Préfixe | `FLAM` |

3. Cliquer **« Enregistrer »**.

✅ Choix coché : **« Automatique »** · « La numérotation des inscriptions est enregistrée. » · numéros attendus de la forme `FLAM-2026-GS-0001`.

⚠️ *Test d'erreur* (avant l'action 2) : motif `FLAM-{YEAR}` + « Enregistrer » → « Le motif doit contenir {STUDENT_SEQ:n} : sans lui deux apprenants pourraient partager un numéro. »

☐ OK ☐ KO

---

### Étape 27 — Créer les 6 tuteurs saisis à la main
👤 **propriétaire** · fenêtre **A** · 📂 Menu **« Personnes »** > **« Élèves »**, onglet **« Tuteurs »** (`/v2/guardians`)

1. Cliquer **« Nouveau tuteur »**.
2. Saisir une ligne du tableau, puis **« Créer »** ; répéter pour les 6 :

| Nom | Prénoms | Sexe | Téléphone | Ville | Profession |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `ADOU` | `Roland` | « Masculin » | `+225 07 00 00 00 11` | `Abidjan` | `Commerçant` |
| `ASSI` | `Carine` | « Féminin » | `+225 07 00 00 00 12` | `Abidjan` | |
| `KOUASSI` | `Hervé` | « Masculin » | `+225 07 00 00 00 14` | `Abidjan` | |
| `YAO` | `Mariam` | « Féminin » | `+225 07 00 00 00 15` | `Abidjan` | |
| `COULIBALY` | `Awa` | « Féminin » | `+225 07 00 00 00 17` | `Abidjan` | |
| `N'GUESSAN` | `Berthe` | « Féminin » | `+225 07 00 00 00 18` | `Abidjan` | |

✅ « Le tuteur ADOU Roland a été créé. » (idem pour chacun) · liste de **6 tuteurs**, **0** enfant, « Sans compte ».

⚠️ *Test d'erreur* : « Créer » sur formulaire vide → « Ce champ est obligatoire. » sous « Nom » et « Prénoms ».

☐ OK ☐ KO

---

### Étape 28 — Créer l'élève ADOU Aïcha avec son tuteur
👤 **propriétaire** · fenêtre **A** · 📂 Menu **« Personnes »** > **« Élèves »**, onglet **« Nouvel élève »** (`/v2/students/new`)

1. Étape « Identité » : saisir

| Champ | Valeur |
| :--- | :--- |
| Nom | `ADOU` |
| Prénoms | `Aïcha` |
| Sexe | « Féminin » |
| Date de naissance | `14/03/2021` |
| Lieu de naissance | `Abidjan` |
| Nationalité (code pays) | `CI` |
| Ville | `Abidjan` |
| Adresse | `Cocody, Riviera (fictif)` |
| Lieu de résidence | `Cocody` |

2. **« Suivant »**. Étape « Tuteurs » : **« Ajouter un tuteur existant »** → « Tuteur » `ADOU` (choisir ADOU Roland) · « Lien de parenté » « Père » · cocher « Responsable financier » et « Autorité légale » (les trois autres cases restent cochées). **« Suivant »**.
3. Étape « Récapitulatif » : cliquer **« Créer le dossier »**.

✅ « ADOU Aïcha — matricule 00001. » · ADOU Roland compte **1** enfant · élève « Actif » et « Non inscrit ».

⚠️ *Test d'erreur* (après création, via « Nouvel élève ») : ressaisir ADOU / Aïcha / « Féminin » / `14/03/2021`, « Suivant » → encadré « 1 dossier ressemble à cette personne » (« Même nom et même date », matricule `00001`) ; **ne rien créer**.

☐ OK ☐ KO

---

### Étape 29 — Créer les 5 autres élèves
👤 **propriétaire** · fenêtre **A** · 📂 Onglet **« Nouvel élève »** (`/v2/students/new`)

1. Pour chaque ligne : « Identité » (champs du tableau) → **« Suivant »** → « Tuteurs » : **« Ajouter un tuteur existant »**, choisir le tuteur et le lien, cocher « Responsable financier » et « Autorité légale » → **« Suivant »** → **« Créer le dossier »**.

| Nom | Prénoms | Sexe | Naissance | Lieu | Nat. | Ville | Tuteur | Lien | Matricule |
| :--- | :--- | :--- | :--- | :--- | :-: | :--- | :--- | :--- | :-: |
| `ASSI` | `Brice` | « Masculin » | `02/07/2021` | `Abidjan` | `CI` | `Abidjan` | ASSI Carine | « Mère » | `00002` |
| `KOUASSI` | `Aya` | « Féminin » | `09/05/2020` | `Abidjan` | `CI` | `Abidjan` | KOUASSI Hervé | « Père » | `00003` |
| `YAO` | `Konan Éric` | « Masculin » | `30/01/2020` | `Abidjan` | `CI` | `Abidjan` | YAO Mariam | « Mère » | `00004` |
| `COULIBALY` | `Ibrahim` | « Masculin » | `11/04/2015` | `Abidjan` | `CI` | `Abidjan` | COULIBALY Awa | « Mère » | `00005` |
| `N'GUESSAN` | `Kouamé` | « Masculin » | `05/12/2015` | `Abidjan` | `CI` | `Abidjan` | N'GUESSAN Berthe | « Mère » | `00006` |

✅ « Dossier créé » : « NOM Prénoms — matricule 0000N. » · `/v2/students` : **6 élèves** « Actif » / « Non inscrit » · chaque tuteur : **1** enfant.

⚠️ *Test d'erreur* : « Suivant » à l'étape « Tuteurs » sans tuteur choisi → « Choisissez un tuteur. »

☐ OK ☐ KO

---

### Étape 30 — Inscrire 4 élèves (politique « Automatique »)
👤 **propriétaire** · fenêtre **A** · 📂 Menu **« Académique »** > **« Inscriptions »**, onglet **« Nouvelle inscription »** (`/v2/enrollments/new`)

1. Étape « Élève » : taper le nom, choisir l'élève, **« Suivant »**.
2. Étape « Classe » : « Année » `2026-2027`, « Classe » selon le tableau, « Mode d'inscription » « Par classe (cursus complet) », **« Suivant »**.
3. Étape « Financement » : « Privé » (laisser), **« Suivant »**, puis **« Inscrire »**. Cliquer **« Inscrire un autre élève »** et répéter :

| Élève | Classe | N° d'inscription attendu |
| :--- | :--- | :--- |
| ADOU Aïcha | `Grande Section A` | `FLAM-2026-GS-0001` |
| ASSI Brice | `Grande Section A` | `FLAM-2026-GS-0002` |
| KOUASSI Aya | `CP1 A` | `FLAM-2026-CP1-0003` |
| YAO Konan Éric | `CP1 A` | `FLAM-2026-CP1-0004` |

✅ « Inscription enregistrée » · "N° d'inscription : … Statut : active." (numéro = numéro d'ordre du matricule de l'élève).

⚠️ *Test d'erreur* : réinscrire ADOU Aïcha dans `Grande Section A` → « L'apprenant a déjà une inscription vivante dans cette classe. »

☐ OK ☐ KO

---

### Étape 31 — Essayer les politiques "Après paiement" et la dérogation
👤 **propriétaire** · fenêtre **A** · 📂 Menu **« Académique »** > **« Paramètres académiques »**, onglet **« Inscriptions »**, puis **« Inscriptions »** > **« Nouvelle inscription »**

1. Choisir la politique, **« Enregistrer »**, puis inscrire l'élève en `CM2 A` (« Par classe », « Privé ») :

| Politique | Élève | Attendu |
| :--- | :--- | :--- |
| « Après paiement des frais d'inscription » | COULIBALY Ibrahim | `FLAM-2026-CM2-0005` · Statut : **active** (aucun frais dû) |
| « Après paiement intégral » | N'GUESSAN Kouamé | `FLAM-2026-CM2-0006` · Statut : **en attente de confirmation** |

2. Pour N'GUESSAN Kouamé : **« Ouvrir l'inscription »** → **« Confirmer sans paiement »** → « Motif » `Test du guide : politique de paiement intégral` → **« Confirmer sans paiement »**.
3. Remettre le choix **« Automatique »**, **« Enregistrer »**.

✅ « Les politiques d'inscription sont enregistrées. » · « L'inscription est confirmée par dérogation. » · statut « Active » · politique « Automatique » rétablie.

⚠️ *Test d'erreur* : motif `abc` → « Le motif doit comporter au moins 5 caractères. »

☐ OK ☐ KO

---

### Étape 32 — Contrôler les inscriptions et les effectifs
👤 **propriétaire** · fenêtre **A** · 📂 Menu **« Académique »** > **« Inscriptions »**, onglet **« Liste des inscriptions »** (`/v2/enrollments`)

1. Filtrer « Statut » = « Active », puis « Classe » = `CM2 A`.
2. Saisir `FLAM-2026-CM2-0005` dans le filtre « N° d'inscription ».
3. Menu **« Classes »** (`/v2/academic/classrooms`) → ouvrir `CM2 A`.

✅ **6 inscriptions** « Active », « Privé », « Par classe », 2 par classe · `CM2 A` : effectif 2 (`FLAM-2026-CM2-0005` et `-0006`).

☐ OK ☐ KO

---

### Étape 33 — Importer les 3 derniers élèves (fichier valide)
👤 **propriétaire** · fenêtre **A** · 📂 Menu **« Imports »** > **« Imports Excel / CSV »**, onglet **« Nouvel import »** (`/v2/imports/new`)

Fichier : `docs/guide-test-primary/jeux-de-donnees/01-eleves-valide-primaire.csv` — contenu :

| Matricule d'origine | Nom | Prénoms | Sexe | Naissance | Classe (code) |
| :--- | :--- | :--- | :-: | :--- | :--- |
| `FLA-ELV-007` | `DAGO` | `Chantal` | F | `23/11/2021` | `GS-A` |
| `FLA-ELV-008` | `TRAORE` | `Fatoumata` | F | `18/09/2020` | `CP1-A` |
| `FLA-ELV-009` | `TANOH` | `Marie-Ange` | F | `27/08/2015` | `CM2-A` |

1. Carte **« Élèves »** · choisir le fichier · **« Envoyer et continuer »** ("Le fichier compte 18 colonne(s).").
2. Options : « Année scolaire des inscriptions » **`2026-2027`** · « Doublons probables… » « Refuser (recommandé) » · « Si la donnée existe déjà » « Ignorer les lignes déjà présentes ».
3. **« Enregistrer et valider le fichier »**. Cocher « J'ai consulté l'aperçu et les erreurs, et je confirme le lancement de l'import. », puis **« Lancer l'import »** (une seule fois : définitif).

✅ Aperçu : « À créer » **3**, « En erreur » **0** · rapport « Import terminé » : « Créées » **3** · `/v2/students` : **9 élèves** (`00007` à `00009`), inscrits `FLAM-2026-GS-0007`, `FLAM-2026-CP1-0008`, `FLAM-2026-CM2-0009`.

⚠️ *Test d'erreur* : validation avec « Année scolaire des inscriptions » vide → « En erreur » **3**, `La colonne « Classe » exige l'option « Année scolaire des inscriptions ».` (puis « Modifier les colonnes »).

☐ OK ☐ KO

---

### Étape 34 — Importer les 3 tuteurs (fichier valide)
👤 **propriétaire** · fenêtre **A** · 📂 Onglet **« Nouvel import »** (`/v2/imports/new`)

Fichier : `docs/guide-test-primary/jeux-de-donnees/02-tuteurs-valide-primaire.csv` — contenu :

| Matricule de l'élève | Tuteur | Téléphone | Lien |
| :--- | :--- | :--- | :--- |
| `FLA-ELV-007` | `DAGO` `Prosper` | `+225 07 00 00 00 13` | `FATHER` |
| `FLA-ELV-008` | `TRAORE` `Issouf` | `+225 07 00 00 00 16` | `FATHER` |
| `FLA-ELV-009` | `TANOH` `Léon` | `+225 07 00 00 00 19` | `FATHER` |

1. Carte **« Parents et tuteurs »** · choisir le fichier · **« Envoyer et continuer »**.
2. « Doublons probables (même nom, même téléphone) » = « Refuser (recommandé) », **« Enregistrer et valider le fichier »**.
3. Cocher la case de confirmation, **« Lancer l'import »**.

✅ Aperçu : « À créer » **3**, « En erreur » **0** · « Import terminé », « Créées » **3** · `/v2/guardians` : **9 tuteurs** ; TRAORE Issouf : **1** enfant (lien « Père »).

☐ OK ☐ KO

---

### Étape 35 — Importer un fichier d'élèves avec erreurs
👤 **propriétaire** · fenêtre **A** · 📂 Onglet **« Nouvel import »** (`/v2/imports/new`)

Fichier : `docs/guide-test-primary/jeux-de-donnees/01-eleves-erreurs-primaire.csv` (9 lignes).

1. Carte **« Élèves »** · choisir le fichier · **« Envoyer et continuer »** · « Année scolaire des inscriptions » `2026-2027` · « Refuser (recommandé) » · **« Enregistrer et valider le fichier »**.
2. Lire l'aperçu et le tableau « Erreurs du fichier ». **Ne pas lancer** (« Lancer l'import » est inactif, « Tout ou rien » grisé).
3. Cliquer **« Télécharger les erreurs (CSV) »**.

✅ « À créer » **0** · « À ignorer » **1** · « En erreur » **8** · fichier `01-eleves-erreurs-primaire-erreurs.csv` · `/v2/students` : toujours **9 élèves** :

| Ligne | Contenu | Message attendu |
| :-: | :--- | :--- |
| 2 | DAGO Chantal | ignorée : `Déjà importée lors d'un import précédent : ligne ignorée (aucun doublon).` |
| 3 | même matricule | `Cette ligne répète la ligne 2 du fichier (même identifiant) : elle est ignorée.` |
| 4 | naissance `31/02/2021` | `Date de naissance : "31/02/2021" n'est pas une date valide (attendu JJ/MM/AAAA ou AAAA-MM-JJ).` |
| 5 | sexe vide | `Le champ « Sexe » est obligatoire.` |
| 6 | ADOU Aïcha | `Doublon probable avec : ADOU Aïcha (00001). Vérifiez, ou choisissez « créer malgré le doublon ».` |
| 7 | classe `CE2-Z` | `Classe "CE2-Z" inconnue pour cette année scolaire.` |
| 8 | nom vide | `Le champ « Nom » est obligatoire.` |
| 9 | naissance `01/01/2099` | `La date de naissance est dans le futur.` |
| 10 | e-mail `rita.zadi.exemple.test` | `E-mail : "rita.zadi.exemple.test" n'est pas une adresse e-mail valide.` |

⚠️ *Ne jamais choisir « Créer malgré le doublon »* (ligne 6) : une seconde ADOU Aïcha serait créée.

☐ OK ☐ KO

---

### Étape 36 — Désigner les 3 titulaires
👤 **propriétaire** · fenêtre **A** · 📂 Menu **« Personnes »** > **« Affectations »** (`/v2/staff/assignments`), onglet **« Par classe »**

1. Choisir « Classe », cliquer **« Désigner »** sur la ligne « Titulaire de classe », saisir (« Rôle » = « Titulaire de classe » et « Période » = « Toute l'année » par défaut), puis **« Affecter »** ; répéter pour les 3 classes :

| Classe | Enseignant | Rôle | Période | Début |
| :--- | :--- | :--- | :--- | :--- |
| `Grande Section A` | `ZOKORA Sylvie` | « Titulaire de classe » | « Toute l'année » | `07/09/2026` |
| `CP1 A` | `KOFFI Adjoua` | « Titulaire de classe » | « Toute l'année » | `07/09/2026` |
| `CM2 A` | `BAMBA Séraphin` | « Titulaire de classe » | « Toute l'année » | `07/09/2026` |

2. Onglet **« Par enseignant »** : choisir `KOFFI Adjoua`.

✅ « L'affectation est enregistrée. » · avertissement « Aucun contrat actif ne couvre le début de cette affectation (la paie décide). » (sans effet) · la ligne « Titulaire de classe » affiche le nom · KOFFI : `CP1 A`, « Titulaire de classe ».

⚠️ *Test d'erreur* (avant toute désignation) : 📂 **« Classes »** (`/v2/academic/classrooms`) > `Grande Section A` > **« Activer »** (×2) → refus `Une classe du primaire ne s'active qu'avec un instituteur titulaire : affectez-en un d'abord.` ; la classe reste « Brouillon ».

☐ OK ☐ KO

---

### Étape 37 — Activer les 3 classes
👤 **propriétaire** · fenêtre **A** · 📂 Menu **« Académique »** > **« Classes »** (`/v2/academic/classrooms`)

1. Ouvrir `Grande Section A`, cliquer **« Activer »**, puis **« Activer »** dans la fenêtre. Répéter pour `CP1 A` et `CM2 A`.
2. Lire la colonne « État » de la liste des classes.
3. Menu **« Pack Primaire »** (`/v2/primary/direction`) : lire « Avancement des classes ».
4. *(Facultatif, avant les scénarios suivants)* **« Affectations »** > « Par classe » > classe > **« Désigner »** : même enseignant, « Rôle » « Responsable », cocher **« Enseignant généraliste (toutes les matières) »**, « Début » `07/09/2026`, **« Affecter »**.

✅ « La classe Grande Section A est active. » (idem) · les 3 classes « Active » · « Avancement des classes » : colonne « Élèves » = **3** par classe · action 4 : « L'affectation est enregistrée. » et une ligne « Enseignant généraliste ».

⚠️ *Écart connu* : la case « généraliste » n'existe que pour « Responsable », d'où l'action 4 (refusée tant que la classe est en « Brouillon »).

☐ OK ☐ KO

---

## Phase 5 — Appel et compétences

Objectif : faire et valider les appels du vendredi 9 octobre 2026, lire la grille de compétences, poser puis retirer le marquage « prête ».

### Étape 38 — Faire et valider les appels du 9 octobre
👤 **propriétaire** · fenêtre **A** · 📂 Menu **« Présences »** > **« Faire l'appel »** (`/v2/attendance/call`)

1. Dans « Appel de la journée » > « Autre classe », renseigner, puis cliquer **« Ouvrir »** (trois fois, un appel à la fois) :

| | Appel 1 | Appel 2 | Appel 3 |
| :--- | :--- | :--- | :--- |
| Autre classe | `Grande Section A` | `CP1 A` | `CP1 A` |
| Date | `2026-10-09` | `2026-10-09` | `2026-10-09` |
| Demi-journée | `Journée entière` | `Matin` | `Après-midi` |
| Élève à toucher (« Absent ») | ASSI Brice | KOUASSI Aya | TRAORE Fatoumata |

2. Pour chaque appel : toucher l'élève, cliquer **« Soumettre l'appel »**, puis **« Mes séances »** pour revenir.
3. Rouvrir `CP1 A` au `Matin` : même appel, pas de doublon.
4. 📂 Menu **« Présences »** > **« Suivi des appels »** (`/v2/attendance/sessions`) : vérifier que « Du » / « Au » encadrent le 9 octobre, puis cliquer **« Valider »** sur les trois lignes « Soumis ».

✅ « Appel soumis. » (Grande Section A : Présent 2, Absent 1) ; le matin rouvert garde « Appel soumis » et KOUASSI Aya « Absent » ; « Appel validé. » ×3 : lignes « Journalier », "Journalier · Matin", "Journalier · Après-midi" à l'état « Validé ».

⚠️ *Test d'erreur* : `Grande Section A` + `Matin` → "La politique d'appel de ce cycle prévoit un seul appel par jour : l'appel du matin ou de l'après-midi n'est pas autorisé."

⚠️ *Écart connu* : le bouton « Appel du jour » de la carte CP1 A dans « Ma classe » est toujours refusé ("Précisez la demi-journée de l'appel : matin ou après-midi.") : toujours passer par « Faire l'appel ».

☐ OK ☐ KO

---

### Étape 39 — Lire la grille de compétences
👤 **propriétaire** · fenêtre **A** · 📂 Menu **« Pack Primaire »** > **« Compétences »** (`/v2/primary/competences`)

1. Sélectionner :

| Champ | Valeur |
| :--- | :--- |
| Classe | `Grande Section A` |
| Période | la première période |
| Vue / Élève | « Fiche élève » / ADOU Aïcha |

2. Lire les domaines `D1` et `D2` et les quatre niveaux : N1 `Non acquis`, N2 `En cours d'acquisition`, N3 `Acquis`, N4 `Acquis avec aisance`.
3. Cliquer **« Tableau »**, puis remplacer la classe par `CP1 A`, puis `CM2 A`.
4. Revenir sur `Grande Section A` (fiche ADOU Aïcha) : pour `Compétence 1.1 (démonstration)`, cliquer **N3 Acquis**, puis **« Enregistrer »**.

✅ Grande Section A : « 0 sur 9 compétences renseignées », « Non évaluée » partout, tableau 3 élèves × `D1.1`, `D1.2`, `D2.1` ; CP1 A et CM2 A : « 0 sur 3 compétences renseignées » ; aucun chiffre, aucune moyenne.

⚠️ *Test d'erreur* : l'enregistrement est refusé ("Un compte sans fiche de personnel ne saisit pas d'évaluation (l'auteur de la saisie est tracé).") ; cliquer **« Annuler ma saisie non enregistrée »** → la cellule redevient « Non évaluée ». La vraie saisie se joue avec l'instituteur (dernière phase).

☐ OK ☐ KO

---

### Étape 40 — Marquer une période « prête » puis retirer le marquage
👤 **propriétaire** · fenêtre **A** · 📂 Menu **« Pack Primaire »** > **« Ma classe »** (`/v2/primary/classe`)

1. Vérifier les trois cartes (`GS`, `CP1`, `CM2`, 3 élèves chacune, pastille « Non titulaire »).
2. Sur **CM2 A**, sous « Périodes », cliquer **« Marquer Trimestre 1 prête »** (ou « Marquer Semestre 1 prête »), puis **« Marquer prête »**.
3. Cliquer **« Retirer le marquage de Trimestre 1 »**, saisir « Motif du retrait » puis **« Retirer le marquage »** (deux essais) :

| Essai | Motif du retrait |
| :--- | :--- |
| 1 | `court` |
| 2 | `Marquage posé pour la recette, à retirer` |

✅ « Trimestre 1 : marquée prête, les familles voient désormais les compétences et le rang provisoire. » (pastille « Prête pour les familles »), puis « Trimestre 1 : marquage retiré, les familles ne voient plus que les périodes validées ou publiées. »

⚠️ *Test d'erreur* : motif `court` → "Au moins 10 caractères."

☐ OK ☐ KO

---

## Phase 6 — Conseil, bilans et états

Objectif : rédiger la banque d'appréciations, tenir le conseil de la CM2 A, préparer bilans et archive (sans rien figer), lire avancement et états.

### Étape 41 — Composer et gérer la banque d'appréciations
👤 **propriétaire** · fenêtre **A** · 📂 Menu **« Pack Primaire »** > **« Appréciations »** (`/v2/primary/appreciations`)

1. Filtrer « Portée » = `Année` (1 phrase), puis « Niveau de maîtrise » = `N3` (1 phrase) ; revenir à « Tous ».
2. Sur la phrase N3 : **« Ajouter à ma rédaction »**, cocher **« J'ai relu et je valide ce texte »**, cliquer **« Copier le texte validé »**.
3. Cliquer **« Nouvelle phrase »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Code | `RECETTE_LECTURE` |
| Portée | `Période` |
| Texte de la phrase | `Lecture fluide en progrès constant (phrase de recette).` |
| Niveau de maîtrise | `N3` |
| Niveau de classe | `CP1` |

4. Cliquer **« Créer la phrase »**, puis **« Désactiver »**, cocher **« Afficher aussi les phrases désactivées »**, **« Activer »**, de nouveau **« Désactiver »**.

✅ 3 phrases de démonstration au départ ; « Texte copié : collez-le dans l'appréciation du bulletin. » ; « Phrase créée. » ; une fois désactivée : pastille « Désactivée » et « Ajouter à ma rédaction » inactif.

⚠️ *Test d'erreur* : code `recette-lecture` → "Code attendu : majuscules, chiffres et _ (2 à 60)."

☐ OK ☐ KO

---

### Étape 42 — Tenir le conseil des maîtres de la CM2 A
👤 **propriétaire** · fenêtre **A** · 📂 Menu **« Pack Primaire »** > **« Conseil des maîtres »** (`/v2/primary/conseil`)

1. « Préparer un conseil » : « Classe » = `CM2 A`, « Période » = la première période, date vide, puis **« Préparer le conseil »**.
2. « Feuille de présence » : ajouter les participants, régler chaque « Présence de … » sur **« Présent »**, ne cocher aucune « Signature », cliquer **« Enregistrer la feuille de présence »**.

| Participant | Rôle |
| :--- | :--- |
| `KOFFI Adjoua` | `Président` |
| `ZOKORA Sylvie` | `Secrétaire` |
| BAMBA Séraphin (déjà listé) | Titulaire de la classe |

3. « Dossiers, un par un » : « Ma proposition » = `Passage en classe supérieure`, « Notes et observations » = `Élève à l'aise en lecture (recette)`, **« Enregistrer ma proposition »** ; puis **« Reporter ce dossier »** et **« Remettre à l'examen »**.
4. Sur le dossier de COULIBALY Ibrahim (une seule décision, définitive) : si « Confirmer la proposition de la règle » est grisé, choisir **« Retenir un autre code »** :

| Champ | Valeur |
| :--- | :--- |
| Décision retenue | `Passage en classe supérieure` |
| Justification | `Décision de recette prise en séance pour un cas limite` |
| Date réelle de la séance (« Procès-verbal ») | `2026-10-09` |

5. Cliquer **« Confirmer la décision »**, puis **« Demander le procès-verbal »**.

✅ « Conseil préparé : un dossier par élève a été créé. » · « Feuille de présence enregistrée. » · « Proposition enregistrée. » · « Décision enregistrée : Passage en classe supérieure. » (pastille « Décidé») · « Procès-verbal demandé : il sera disponible dans les documents officiels. »

⚠️ *Test d'erreur* : justification `court` → « La justification compte au moins 20 caractères. »

⚠️ *Écart connu* : dans une école neuve, la préparation peut être refusée (« État de la période introuvable ») ou la décision refusée ("La règle n'a produit aucune proposition pour cet élève : les résultats de la période ne sont pas calculés.") : relever le message, marquer l'étape « bloquée », passer à la suivante.

☐ OK ☐ KO

---

### Étape 43 — Préparer bilans et archive (sans rien figer)
👤 **propriétaire** · fenêtre **A** · 📂 Menu **« Pack Primaire »** > **« Bilans annuels »** (`/v2/primary/bilans`) puis **« Archives »** (`/v2/primary/archives`)

1. Sélectionner « Année » = `2026-2027`, « Classe » = `CM2 A`, cliquer **« Préparer les brouillons »**, puis une seconde fois.
2. Sur une ligne élève (par exemple COULIBALY Ibrahim) : **« Sceller »**, puis **« Sceller le bilan »** (refus attendu), puis « Annuler ».
3. Menu « Archives » : « Année » = `2026-2027`, cliquer **« Préparer l'archive »**.

✅ « Brouillons préparés : 3 créés, 0 actualisés, 0 scellés laissés intacts. » (2ᵉ fois : "0 créés, 3 actualisés…") ; 3 lignes « Version 1 », « Brouillon » ; refus "Toutes les périodes de l'année ne sont pas clôturées." ; « Archive préparée. », « 0 bilans scellés sur 3 », aucun bouton « Geler l'archive ».

⚠️ *Ne jamais geler l'archive* pendant la recette (irréversible pour toute l'école). Si un bilan se scelle contre toute attente, c'est irréversible : le noter.

☐ OK ☐ KO

---

### Étape 44 — Lire l'avancement et produire les états
👤 **propriétaire** · fenêtre **A** · 📂 Menu **« Pack Primaire »** > **« Avancement »** (`/v2/primary/direction`) puis **« États »** (`/v2/primary/etats`)

1. Lire le tableau « Avancement par classe et par période ».
2. Menu « États » : choisir « Rapport », renseigner, puis cliquer **« Afficher l'aperçu »** pour chacun :

| Rapport | Classe | Période / Mois |
| :--- | :--- | :--- |
| `Liste de classe` | `Grande Section A` | — |
| `Couverture des compétences` | `CM2 A` | la première période |
| `Registre d'appel mensuel` | `CP1 A` | `2026-10` |

3. Sur le registre du CP1 A, cliquer **« Exporter en CSV »**.
4. Menu **« Bulletin et compétences »** (`/v2/primary/mon-enfant`) : lire le message.

✅ **Valeurs attendues**

| Écran | Valeur |
| :--- | :--- |
| Avancement | tout « Rien de saisi » (rouge) : Grande Section A « 0 sur 9 » ; CP1 A « 0 sur 3 » ; CM2 A « 0 sur 3 », bilans « 0 sur 3 » |
| Liste de classe | ADOU Aïcha, ASSI Brice, DAGO Chantal |
| Couverture | chaque élève de la CM2 A : `1, 0, 0, 1` |
| Registre CP1 A | colonnes `09 matin`, `09 après-midi` ; KOUASSI Aya absente le matin, TRAORE Fatoumata l'après-midi ; fichier `attendance-register.csv` |
| Bulletin et compétences | « Aucun enfant n'est lié à votre compte. » |

⚠️ *Test d'erreur* : « Registre d'appel mensuel » sans « Mois » → « Afficher l'aperçu » et « Exporter en CSV » inactifs.

☐ OK ☐ KO

---

## Phase 7 — Actes de fin de recette

Objectif : gestes irréversibles du pack, à jouer une seule fois, à la toute fin, sur le propriétaire (jamais « Geler l'archive »).

### Étape 45 — ⚠️ Irréversible : signer la feuille de présence du conseil
👤 **propriétaire** · fenêtre **A** · 📂 Menu **« Pack Primaire »** > **« Conseil des maîtres »** (`/v2/primary/conseil`) > conseil de la CM2 A

⚠️ Irréversible : une présence signée est figée.

1. Ligne **BAMBA Séraphin** : « Présence de BAMBA Séraphin » = « Présent ».
2. Cocher **« Signature de BAMBA Séraphin »**.
3. Cliquer **« Enregistrer la feuille de présence »**, puis essayer de modifier la ligne.

✅ « Feuille de présence enregistrée. » · « Signée le … » · ligne verrouillée (« Une présence signée est figée : elle ne peut plus être modifiée. ») ; KOFFI Adjoua et ZOKORA Sylvie restent modifiables.

⚠️ *Test d'erreur* : présence « Absent » → la case « Signature de BAMBA Séraphin » devient inactive.

☐ OK ☐ KO

---

### Étape 46 — ⚠️ Irréversible : sceller puis réémettre un bilan annuel
👤 **propriétaire** · fenêtre **A** · 📂 Menu **« Pack Primaire »** > **« Bilans annuels »** (`/v2/primary/bilans`, CM2 A)

⚠️ Irréversible, une seule fois sur un seul bilan. Si « Sceller » a été refusé à l'étape des brouillons (année non close), marquer "non jouable (année non close)" et passer.

1. Cliquer **« Préparer les brouillons »**, puis sur un bilan « Prêt à sceller » : **« Sceller »** > **« Sceller le bilan »**.
2. Sur ce bilan « Scellé », cliquer **« Réémettre »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Motif | `court`, puis `Correction de la décision de passage (recette)` |

3. Cliquer **« Réémettre »**.

✅ « Bilan de … scellé. » (statut « Scellé », empreinte visible, « Sceller » disparu) · « Nouvelle version du bilan de … créée : elle doit être scellée à son tour. » (version 2 en « Brouillon »).

⚠️ *Test d'erreur* : motif `court` → « Le motif doit comporter au moins 10 caractères. »

☐ OK ☐ KO

---

## Phase 8 — À jouer quand les autres comptes existeront

🕓 Pas jouable aujourd'hui : comptes à créer et reliés à la bonne fiche (voir chaque étape), jour de recette postérieur au 9 octobre 2026, fenêtres A et B dans deux navigateurs.

### Étape 47 — Instituteur : appels, saisie des compétences, période « prête »
👤 **instituteur** · `enseignant@ecole-flamboyants.test` (fiche KOFFI Adjoua, titulaire du CP1 A) · fenêtre **B** · 📂 Menu **« Ma classe (primaire) »** (`/v2/primary/classe`), **« Mes appels »** (`/v2/teacher/attendance`), **« Compétences »** (`/v2/primary/competences`)
🔑 **Connexion** (fenêtre **B**) : `/v2/login` → établissement `ecole-flamboyants` → compte **instituteur** (`enseignant@ecole-flamboyants.test`, sans MFA) → « Se connecter ».

1. « Ma classe » : une seule carte **CP1 A** (« Titulaire »). « Mes appels » : cliquer **« Appel du matin »**, toucher YAO Konan Éric (« Absent »), **« Soumettre l'appel »** ; puis **« Appel de l'après-midi »**, tous présents.
2. « Compétences » (CP1 A, première période), vue « Fiche élève », niveaux à cliquer pour `Compétence 1.1 (démonstration)`, puis **« Enregistrer »** :

| Élève | Niveau |
| :--- | :--- |
| KOUASSI Aya | `N3 Acquis` |
| YAO Konan Éric | `N2 En cours d'acquisition` |
| TRAORE Fatoumata | aucune saisie |

3. « Ma classe » : **« Marquer … prête »** > **« Marquer prête »**. Retour dans « Compétences » : YAO Konan Éric en `N3`, **« Enregistrer »**, puis recharger la page.

✅ Deux lignes « Appel soumis » ; « 2 sur 3 compétences renseignées » (TRAORE Fatoumata « Non évaluée ») ; "… marquée prête …" ; refus "La classe et la période sont marquées prêtes : retirer le marquage avant de modifier la saisie."

☐ OK ☐ KO

---

### Étape 48 — Instituteur de maternelle : appel unique
👤 **instituteur de maternelle** · `instituteur.maternelle@ecole-flamboyants.test` (fiche ZOKORA Sylvie, titulaire de la Grande Section A) · fenêtre **B** · 📂 Menu **« Ma classe (primaire) »** (`/v2/primary/classe`)
🔑 **Connexion** (fenêtre **B**) : se déconnecter de `enseignant@ecole-flamboyants.test`, puis `/v2/login` → établissement `ecole-flamboyants` → compte **instituteur de maternelle** (`instituteur.maternelle@ecole-flamboyants.test`, sans MFA) → « Se connecter ».

1. Lire la carte unique **Grande Section A** (« Titulaire »).
2. Cliquer **« Appel du jour »**, **« Marquer DAGO Chantal absent »**, **« Transmettre l'appel »**, **« Fermer l'appel »**.
3. Rouvrir « Appel du jour ».

✅ « Appel transmis : 1 absent. » · « L'appel du jour est déjà transmis : vous pouvez encore corriger un élève. »

🔒 `/v2/primary/competences?classe=` + identifiant d'une autre classe → « Cet élément est introuvable ou hors de votre périmètre. »

☐ OK ☐ KO

---

### Étape 49 — Parent : ce que voit la famille
👤 **parent** · `parent@ecole-flamboyants.test` (fiche KOUASSI Hervé, père de KOUASSI Aya) · fenêtre **B** · 📂 Menu **« Bulletin et compétences »** (`/v2/primary/mon-enfant`)
🔑 **Connexion** (fenêtre **B**) : se déconnecter de `instituteur.maternelle@ecole-flamboyants.test`, puis `/v2/login` → établissement `ecole-flamboyants` → compte **parent** (`parent@ecole-flamboyants.test`, sans MFA) → « Se connecter ».

1. Dans « Enfant », choisir **KOUASSI Aya — CP1 A** (seul enfant proposé).
2. Lire « Compétences des périodes prêtes ou validées » puis « Bilans annuels ».

✅ `Domaine 1 (démonstration)` : N3 = 1, aucune moyenne ; « Aucun bilan annuel publié pour le moment. »

🔒 `/v2/primary/classe` puis `/v2/primary/bilans` → « Accès refusé ».

☐ OK ☐ KO

---

### Étape 50 — Instituteur : retirer le marquage, valider la grille
👤 **instituteur** · `enseignant@ecole-flamboyants.test` · fenêtre **B** · 📂 Menu **« Ma classe (primaire) »** (`/v2/primary/classe`) puis **« Compétences »**
🔑 **Connexion** (fenêtre **B**) : se déconnecter de `parent@ecole-flamboyants.test`, puis `/v2/login` → établissement `ecole-flamboyants` → compte **instituteur** (`enseignant@ecole-flamboyants.test`, sans MFA) → « Se connecter ».

1. « Ma classe » : **« Retirer le marquage de … »**, saisir le motif, **« Retirer le marquage »** (deux essais) : `court`, puis `Erreur de marquage constatée (recette)`.
2. « Compétences » (CP1 A, première période) : **« Valider la grille »**, confirmer **« Valider la grille »** dans la fenêtre.

✅ "Au moins 10 caractères." puis marquage retiré · « Grille validée : 2 compétences validées, 1 restée non évaluée. » · cases « Validée », aucun bouton « Réviser ».

🔒 `/v2/primary/etats`, `/v2/primary/direction`, `/v2/primary/parametres` → « Accès refusé ».

☐ OK ☐ KO

---

### Étape 51 — Propriétaire : réviser une compétence validée
👤 **propriétaire** · `direction.generale@ecole-flamboyants.test` · fenêtre **A** · 📂 Menu **« Pack Primaire »** > **« Compétences »** (`/v2/primary/competences`, CP1 A, première période)

1. Sur la case validée de KOUASSI Aya, cliquer **« Réviser »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Nouveau niveau | `N4 — Acquis avec aisance` |
| Motif de la révision | `court`, puis `Correction après relecture du cahier de classe (recette)` |

2. Cliquer **« Réviser »** (deux essais), puis rouvrir « Réviser » pour lire « Historique des révisions ».

✅ La case affiche N4 ; historique "N3 vers N4 le … : Correction après relecture du cahier de classe (recette)". Si une authentification forte est demandée, se reconnecter avec le code MFA.

⚠️ *Test d'erreur* : motif `court` → "Le motif compte au moins 10 caractères."

☐ OK ☐ KO

---

### Étape 52 — Élève : son espace
👤 **élève** · `eleve@ecole-flamboyants.test` (fiche KOUASSI Aya) · fenêtre **B** · 📂 Menu **« Bulletin et compétences »** (`/v2/primary/mon-enfant`)
🔑 **Connexion** (fenêtre **B**) : se déconnecter de `enseignant@ecole-flamboyants.test`, puis `/v2/login` → établissement `ecole-flamboyants` → compte **élève** (`eleve@ecole-flamboyants.test`, sans MFA) → « Se connecter ».

1. Lire le titre et les sections.
2. Taper `/v2/primary/classe` puis `/v2/primary/bilans`.

✅ « Mon bilan et mes compétences » · pas de liste d'enfants · compteurs de KOUASSI Aya seulement · « Aucun bilan annuel publié pour le moment. »

🔒 Les deux adresses → « Accès refusé ».

☐ OK ☐ KO

---

### Étape 53 — Directeur : avancement des classes
👤 **directeur** · `directeur@ecole-flamboyants.test` · fenêtre **A** · 📂 Menu **« Pack Primaire »** > **« Avancement »** (`/v2/primary/direction`)
🔑 **Connexion** (fenêtre **A**) : se déconnecter de `direction.generale@ecole-flamboyants.test`, puis `/v2/login` → établissement `ecole-flamboyants` → compte **directeur** (`directeur@ecole-flamboyants.test`, avec code MFA) → « Se connecter ».

1. Lire la ligne du CP1 A pour la première période.
2. Ouvrir « Compétences » (CP1 A).

✅ CP1 A : « En cours » (orange), « 2 sur 3 » / « 2 sur 3 » ; Grande Section A et CM2 A : « Rien de saisi » ; bouton « Réviser » proposé sur les cases validées.

☐ OK ☐ KO

---

## Phase 9 — Bilan de la recette

Objectif : cocher une seule case par ligne ; noter pour chaque anomalie le titre de l'étape, le message exact et une capture.

| Phase | OK | KO | Anomalies |
| :--- | :-: | :-: | :--- |
| Appel et compétences | ☐ | ☐ | |
| Conseil, bilans et états | ☐ | ☐ | |
| Actes de fin de recette | ☐ | ☐ | |
| À jouer quand les autres comptes existeront | ☐ | ☐ | |

Points connus (pas des anomalies nouvelles) : bouton « Appel du jour » refusé pour le CP1 A ; décision du conseil et scellement refusés tant que les périodes ne sont pas closes ; propriétaire sans fiche de personnel ne saisit pas de compétence.
