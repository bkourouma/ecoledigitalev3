[⬅ Sommaire](../GUIDE_TEST_UTILISATEUR_COMPLET.md) · [← Précédent](12-eleves-affectes-etat.md) · [Suivant →](13b-examens-suite.md)

# Phase 13 — Examens : session, candidats, centres, notes, résultats

Le responsable des examens du Collège Le Baobab prépare une session "BEPC" de démonstration : type d'examen, centre, session, candidats (élèves de la 6e A et candidats libres), répartition en salles, convocations, notes, résultats, corrections, puis la direction publie. **Règles de démonstration** : aucune règle d'examen officielle n'est livrée (ni BEPC, ni BAC, ni CEPE réel) ; les écrans affichent le bandeau « Règles de démonstration » et les documents portent un filigrane de démonstration. Ne tirez aucune conclusion réglementaire de ce qui s'affiche.

Précondition : graine du collège (classe 6e A avec ses élèves, deux sessions de démonstration `OFF-DEMO` et `BLANC-DEMO`). **Ne publiez ni n'archivez jamais `OFF-DEMO` ni `BLANC-DEMO`** : tout se passe sur les sessions "test guide". Les enregistrements créés ici ne se suppriment pas depuis les écrans.

## Étape 225 — Se connecter et lire l'état de départ du module Examens
👤 **responsable des examens** (secondaire-test, `examens@secondaire-test.test`, sans MFA) · fenêtre **A** · 📂 Menu **« Examens »** (`/v2/examinations`)

Attendu au départ : liste « Sessions d'examen » avec deux lignes, "Session OFF-DEMO" (Officiel, « Inscriptions ouvertes », pastille « Démonstration ») et "Session BLANC-DEMO" (Examen blanc, « Épreuves en cours »). Aucun centre, aucun candidat libre.

1. Se connecter (clic sur le compte dans le panneau de droite de `/v2/login`, puis « Se connecter »).
2. Lire la barre d'onglets : « Sessions », « Candidats », « Répartition », « Centres et salles », « Examens blancs », « Notes et résultats », « Imports », « Corrections », « Statistiques », « Exports et documents », « Types d'examens ». L'onglet « Examen de l'élève » est absent (réservé aux familles).
3. Ouvrir « Types d'examens » (`/v2/examinations/types`) : une seule carte `EXAM_DEMO — Examen de démonstration (6E)`. Aucun type BEPC n'existe encore.

✅ Deux sessions, un seul type, le bouton « Nouvelle session » visible en haut à droite.

☐ OK ☐ KO

---

## Étape 226 — Créer le type d'examen "BEPC test guide"
👤 **responsable des examens** (secondaire-test) · fenêtre **A** · 📂 Menu **« Examens »** > **« Types d'examens »** (`/v2/examinations/types`)

1. Cliquer **« Nouveau type »**.
2. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Code | `TG_BEPC` |
| Libellé | `BEPC test guide (démonstration)` |
| Niveau d'enseignement | `LOWER_SECONDARY` |
| Niveau de classe visé | `6E` |
| Origine des données | « Démonstration (fictif) » |
| Référence de la source | `Guide de test, données fictives` |

3. Cliquer **« Créer le type »**.

✅ La fenêtre se ferme ; la carte `TG_BEPC — BEPC test guide (démonstration)` apparaît avec les pastilles « Démonstration » et « Actif », et reste après rechargement. Le type n'a pas encore d'épreuve.

⚠️ *Test d'erreur* : ouvrir **« Nouveau type »**, saisir le code `TG_BEPC` une seconde fois → "Ce code de type d'examen existe déjà." ; code `TG BEPC` (espace) → "Format invalide.".

☐ OK ☐ KO

---

## Étape 227 — Ajouter une filière et trois épreuves au type
👤 **responsable des examens** (secondaire-test) · fenêtre **A** · 📂 **« Types d'examens »** > carte `TG_BEPC` > **« Afficher le détail »**

1. Dans « Filières », cliquer **« Ajouter une filière »**, saisir Code `TGA`, Libellé `Série A test guide`, puis **« Ajouter la filière »**.
2. Dans « Épreuves », cliquer **« Ajouter une épreuve »** trois fois, puis **« Ajouter l'épreuve »** à chaque fois :

| Code | Libellé | Filière | Coefficient | Barème (sur) | Ordre |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `TG_EP1` | `Mathématiques test guide` | (vide) | `2` | `20` | `1` |
| `TG_EP2` | `Français test guide` | (vide) | `1` | `20` | `2` |
| `TG_EP3` | `Épreuve de série A test guide` | `TGA — Série A test guide` | `1` | `10` | `3` |

✅ La pastille `TGA — Série A test guide` apparaît ; le tableau « Épreuves » liste `TG_EP1`, `TG_EP2`, `TG_EP3` (cette dernière suivie de `[TGA]`), coefficients et barèmes en virgule française.

⚠️ *Test d'erreur* : épreuve avec Coefficient `0` → "Le coefficient doit être strictement positif." ; Code `TG_EP1` une seconde fois → "Ce code d'épreuve existe déjà.".

☐ OK ☐ KO

---

## Étape 228 — Créer le centre d'examen et ses salles
👤 **responsable des examens** (secondaire-test) · fenêtre **A** · 📂 Menu **« Examens »** > **« Centres et salles »** (`/v2/examinations/centers`)

Attendu au départ : « Aucun centre d'examen ».

1. Cliquer **« Nouveau centre »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Code | `TG-CTR1` |
| Nom | `Centre Cocody test guide` |
| Nature | « Centre propre » |
| Localité | `Cocody, Abidjan` |

2. Cliquer **« Créer le centre »**, puis **« Ajouter une salle »** deux fois (**« Ajouter la salle »** à chaque fois) :

| Code | Libellé | Capacité (places) |
| :--- | :--- | :--- |
| `S1` | `Salle 1 test guide` | `3` |
| `S2` | `Salle 2 test guide` | `2` |

3. Pour la salle `S2`, cliquer **« Désactiver »** (pastille « Inactive »), puis **« Activer »** pour la remettre « Active ».

✅ Carte `TG-CTR1 — Centre Cocody test guide` avec « Centre propre » et « Actif » ; deux salles dans le tableau (colonnes « Code », « Libellé », « Capacité (places) », « État »). Une troisième salle `S3` (2 places) sera ajoutée à l'étape *Répartir automatiquement les candidats*.

⚠️ *Test d'erreur* : salle avec Capacité `0` → "La valeur doit être supérieure ou égale à 1." ; code de centre `TG-CTR1` en double → "Ce code de centre existe déjà.".

☐ OK ☐ KO

---

## Étape 229 — Créer la session officielle et la session d'examen blanc
👤 **responsable des examens** (secondaire-test) · fenêtre **A** · 📂 Menu **« Examens »** > **« Sessions »** (`/v2/examinations`)

1. Cliquer **« Nouvelle session »** et saisir la session officielle :

| Champ | Valeur |
| :--- | :--- |
| Type d'examen | `TG_BEPC — BEPC test guide (démonstration)` |
| Nature | « Officiel » |
| Code | `TG-BEPC-2027` |
| Libellé | `Session BEPC test guide` |
| Année de la session | `2027` (remplacer l'année proposée) |
| Début des épreuves | `2027-06-14` |

2. Cliquer **« Créer la session »** : le détail de la session s'ouvre ; revenir par **« Retour aux sessions »**.
3. Recommencer avec la session d'examen blanc :

| Champ | Valeur |
| :--- | :--- |
| Type d'examen | `TG_BEPC — BEPC test guide (démonstration)` |
| Nature | « Examen blanc » |
| Session officielle préparée | "Session BEPC test guide" |
| Code | `TG-BLANC-2027` |
| Libellé | `BEPC blanc test guide` |
| Année de la session | `2027` |
| Début des épreuves | `2027-03-08` |

✅ Deux nouvelles lignes : "Session BEPC test guide" (Officiel, « Planifiée », avancement 0 %, début "14 juin 2027") et "BEPC blanc test guide" (Examen blanc, « Planifiée »).

⚠️ *Test d'erreur* : code `TG-BEPC-2027` une seconde fois → "Ce code de session existe déjà pour cet établissement." ; année `1999` → "La valeur doit être supérieure ou égale à 2000.".

☐ OK ☐ KO

---

## Étape 230 — Figer la définition et ouvrir les inscriptions
👤 **responsable des examens** (secondaire-test) · fenêtre **A** · 📂 **« Sessions »** > clic sur "Session BEPC test guide" (`/v2/examinations/sessions/<identifiant>`)

Attendu au départ : état « Planifiée », « Effectifs » tous à 0, « Aucune épreuve », texte "La définition (séries et épreuves) n'est pas encore copiée depuis le type d'examen."

1. Cliquer **« Copier et figer la définition »**.
2. Cliquer **« Passer à : Inscriptions ouvertes »**.
3. Sous « Écrans de la session », lire les liens : « Candidats », « Répartition », « Notes et résultats », « Imports », « Statistiques », « Corrections », « Exports et documents ».

✅ Message « Définition copiée : 3 épreuve(s). » ; le tableau « Épreuves » liste `TG_EP1`, `TG_EP2`, `TG_EP3` ; puis « La session est maintenant : Inscriptions ouvertes. » (avancement 17 %). Seule l'étape « Passer à : Inscriptions closes » est ensuite proposée. La définition figée ne se refige plus (le bouton a disparu).

⚠️ *Test d'erreur* : ouvrir "BEPC blanc test guide" (définition non copiée) → le bouton « Passer à : Inscriptions ouvertes » est désactivé et la liste de points bloquants affiche "La définition (séries, épreuves) n'est pas encore figée : la figer avant d'ouvrir les inscriptions.".

☐ OK ☐ KO

---

## Étape 231 — Ajouter les élèves de la 6e A et évaluer l'éligibilité
👤 **responsable des examens** (secondaire-test) · fenêtre **A** · 📂 Menu **« Examens »** > **« Candidats »** (`/v2/examinations/candidates`)

1. Dans « Session d'examen », choisir l'option commençant par `Session BEPC test guide`. Attendu : « Aucun candidat ».
2. Dans le bloc « Ajouter les élèves d'une classe », choisir la « Classe » `6e A` et cliquer **« Ajouter les élèves »**.
3. Recliquer **« Ajouter les élèves »**.
4. Cliquer **« Évaluer l'éligibilité de tous »**.
5. Saisir `DIABATE` dans « Rechercher », puis vider le champ.

✅ Étape 2 : « 9 candidat(s) ajouté(s), 0 déjà présent(s). » (9 au dernier relevé : relever le nombre exact, il sert à la suite). Étape 3 : « 0 candidat(s) ajouté(s), 9 déjà présent(s). ». Étape 4 : « 9 candidat(s) évalué(s) par la règle. » ; tous passent à « Éligible » (colonnes « Inscription » : « Brouillon » ; « Pièces » : « Dossier complet »). Étape 5 : seuls DIABATE Nadia et DIABATE Salimata restent. Le détail de session affiche « Candidats » 9, « Éligibles » 9, « Inscrits » 0.

⚠️ *Test d'erreur* : sans classe choisie, le bouton « Ajouter les élèves » est désactivé.

☐ OK ☐ KO

---

## Étape 232 — Inscrire un candidat, lui donner un identifiant officiel, inscrire en lot
👤 **responsable des examens** (secondaire-test) · fenêtre **A** · 📂 **« Candidats »** > clic sur "DIABATE Nadia" (`/v2/examinations/candidates/<identifiant>`)

1. Lire l'en-tête : sous-titre « Numéro de candidat : pas encore attribué », pastilles « Brouillon », « Éligible », « En attente ».
2. Cliquer **« Inscrire le candidat »**.
3. Dans « Identifiants officiels », saisir Type d'identifiant `OFFICIAL_NUMBER`, Valeur `TG-OFF-0001`, puis **« Enregistrer l'identifiant »**.
4. Revenir à la liste (**« Retour aux candidats »**), cocher dans cet ordre **DIABATE Salimata** puis **COULIBALY Moussa**, cliquer **« Inscrire la sélection (2) »**.

✅ Étape 2 : « Candidat inscrit, numéro TG_BEPC2027-00001. » et pastille « Inscrit ». Étape 3 : `OFFICIAL_NUMBER : TG-OFF-0001 (MANUAL)` et « Numéro officiel » de l'état civil = `TG-OFF-0001`. Étape 4 : « 2 candidat(s) inscrit(s). », numéros `TG_BEPC2027-00002` (Salimata) et `TG_BEPC2027-00003` (Moussa) (dans l'ordre de sélection ; sinon relever les numéros réels).

⚠️ *Test d'erreur* : saisir `TG-OFF-0001` sur un autre candidat → "Cet identifiant désigne déjà un autre candidat de la session.".

☐ OK ☐ KO

---

## Étape 233 — Saisir un candidat libre à la main
👤 **responsable des examens** (secondaire-test) · fenêtre **A** · 📂 **« Candidats »** (session `Session BEPC test guide`)

Un candidat libre n'est pas un élève de l'établissement : aucun dossier élève n'est créé.

1. Dans le bloc « Candidat libre (sans dossier élève) », cliquer **« Saisir un candidat libre »**.
2. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Nom | `KOUASSI` |
| Prénoms | `Yves test guide` |
| Date de naissance | `2013-08-19` |
| Lieu de naissance | `Cocody, Abidjan` |
| Sexe | « Masculin » |
| Téléphone | `+225 07 41 22 63 18` |
| Adresse e-mail | `yves.kouassi.tg@exemple.test` |
| Type de pièce | `EXTRAIT_NAISSANCE` |
| Numéro de la pièce | `EN-TG-0100` |
| Nom du tuteur | `KOUASSI Marcel` |
| Lien avec le candidat | `Père` |
| Le candidat est dans la classe de l'examen | coché |
| Nombre de tentatives antérieures à cet examen | `0` |

3. Cliquer **« Enregistrer le candidat »**.
4. Ouvrir la fiche de `KOUASSI Yves test guide`, cliquer **« Évaluer par la règle »**, puis **« Inscrire le candidat »**.

✅ Dans la liste : `KOUASSI Yves test guide`, pastille « Candidat libre », « Brouillon », « Non évaluée ». Étape 4 : « Éligibilité évaluée par la règle. » (pastille « Éligible »), puis « Candidat inscrit, numéro TG_BEPC2027-00004. ».

⚠️ *Test d'erreur* : sans aucun téléphone ni e-mail → "Indiquer au moins un téléphone ou une adresse e-mail (candidat ou tuteur)." ; type de pièce sans numéro → "Le type et le numéro de la pièce vont ensemble.".

☐ OK ☐ KO

---

## Étape 234 — Importer des candidats libres depuis un fichier CSV
👤 **responsable des examens** (secondaire-test) · fenêtre **A** · 📂 **« Candidats »** (session `Session BEPC test guide`) > **« Importer un fichier CSV »**

Fichiers : `docs/guide-test/jeux-de-donnees/` (séparateur `;`).

1. Choisir `20-examens-candidats-libres-entetes.csv`.
2. Choisir `20-examens-candidats-libres-erreurs.csv`, puis cliquer **« Importer 2 candidat(s) »**.
3. Choisir `20-examens-candidats-libres.csv`, puis cliquer **« Importer 6 candidat(s) »**.
4. Saisir `test guide` dans « Rechercher ».
5. Ré-importer `20-examens-candidats-libres.csv`.

✅ Étape 1 : "Colonnes obligatoires absentes : classe_examen." et "Colonnes ignorées : remarque." ; aucun bouton d'envoi. Étape 2 : résumé "20-examens-candidats-libres-erreurs.csv : 2 ligne(s) valide(s), 6 ligne(s) à corriger." avec les lignes 3 à 8 expliquées ; résultat "1 candidat(s) libre(s) enregistré(s)." et, sous « Lignes refusées », le doublon d'identité de `SORO Aya test guide`. Étape 3 : résumé "20-examens-candidats-libres.csv : 6 ligne(s) valide(s), 0 ligne(s) à corriger." puis "6 candidat(s) libre(s) enregistré(s)." Étape 4 : les candidats libres (KONE Mariam, TRAORE Seydou, YAO Adjoua, DIABATE Ibrahim, BAMBA Fanta, COULIBALY Karim, KOUASSI Yves, SORO Aya) avec la pastille « Candidat libre ». Étape 5 : "0 candidat(s) libre(s) enregistré(s)." et six lignes refusées pour doublon : aucun doublon créé.

⚠️ *Écart connu* : un fichier vide annonce comme colonnes absentes `nom, prenoms, naissance, lieu, sexe` (liste inexacte, `lieu` est facultatif).

☐ OK ☐ KO

---

## Étape 235 — Inscrire KONE Mariam et lire ses données restreintes
👤 **responsable des examens** (secondaire-test) · fenêtre **A** · 📂 **« Candidats »** > recherche `KONE` > clic sur `KONE Mariam test guide`

1. Lire la section « Données personnelles restreintes » : "Accès restreint : chaque consultation est tracée…" ; le « Numéro de pièce » est **masqué**.
2. Cliquer **« Afficher le numéro de pièce en entier »**.
3. Cliquer **« Évaluer par la règle »**, puis **« Inscrire le candidat »**.

✅ Étape 2 : numéro complet `EN-TG-0001` avec la mention "L'affichage complet du numéro de pièce a été tracé.". Étape 3 : « Éligible », puis « Candidat inscrit, numéro TG_BEPC2027-00005. ».

☐ OK ☐ KO

---

## Étape 236 — Éligibilité refusée : le responsable ne peut pas déroger
👤 **responsable des examens** (secondaire-test) · fenêtre **A** · 📂 **« Candidats »** > clic sur `BAMBA Fanta test guide` (déclarée hors de la classe de l'examen par le fichier)

1. Cliquer **« Évaluer par la règle »** : pastille « Non éligible » (motif affiché tel quel : `NOT_IN_EXAM_GRADE`).
2. Cliquer **« Inscrire le candidat »**.
3. Cliquer **« Saisir à la main »**, laisser « Éligible », cliquer **« Enregistrer »**, puis **« Annuler »**.
4. Constater l'absence du bouton « Accorder une dérogation » pour ce compte.

✅ Étape 2 : "l'éligibilité doit être établie avant l'inscription (statut INELIGIBLE)". Étape 3 : "Une règle d'éligibilité est épinglée à cette session : l'éligibilité se calcule par la règle (ou se déroge avec un motif)." Le candidat reste « Brouillon ».

⚠️ *Écart connu* : les motifs codés de la règle (`NOT_IN_EXAM_GRADE`) s'affichent bruts.

☐ OK ☐ KO

---

## Étape 237 — Accorder une dérogation (direction, MFA)
👤 **directeur** (secondaire-test, `directeur@secondaire-test.test`, MFA) · fenêtre **A** · 📂 **« Candidats »** > fiche `BAMBA Fanta test guide`

1. Se déconnecter, se connecter en directeur (code MFA proposé), ouvrir la même fiche.
2. Cliquer **« Accorder une dérogation »**.
3. Dans « Motif de la dérogation », saisir `Décision de démonstration du jury de l'établissement.` puis cliquer **« Accorder la dérogation »** (valider la seconde vérification si elle s'ouvre).

✅ Nouvelle ligne d'historique avec la pastille « Dérogation » et "Motif de la dérogation : Décision de démonstration du jury de l'établissement." ; l'éligibilité devient « Éligible » *(à vérifier)*.

⚠️ *Test d'erreur* : motif de 5 caractères → "Le motif doit comporter au moins 10 caractères." ; dérogation sur DIABATE Nadia (déjà éligible) → "Ce candidat est déjà éligible : aucune dérogation nécessaire.".

⚠️ *Écart connu* : le directeur des études (`etudes@secondaire-test.test`) détient le droit de dérogation mais le bouton est masqué pour lui (à confirmer) ; ne pas le tenter ici.

☐ OK ☐ KO

---

## Étape 238 — Inscrire BAMBA Fanta et retirer TRAORE Seydou
👤 **responsable des examens** (secondaire-test) · fenêtre **A** · 📂 **« Candidats »**

1. Se reconnecter en responsable des examens. Ouvrir la fiche `BAMBA Fanta test guide`, cliquer **« Inscrire le candidat »**.
2. Ouvrir la fiche `TRAORE Seydou test guide` (« Brouillon »), cliquer **« Retirer le candidat »**.
3. Dans « Motif du retrait », saisir `Désistement de démonstration.` puis cliquer **« Retirer »**.

✅ Étape 1 : « Candidat inscrit, numéro TG_BEPC2027-00006. ». Étape 3 : pastille « Retiré » ; plus de bouton d'inscription ni de retrait ; le détail de session affiche « Retirés » 1. Bilan : **6 candidats « Inscrit »** (00001 Nadia, 00002 Salimata, 00003 Moussa, 00004 Yves, 00005 Mariam, 00006 Fanta) et 1 « Retiré ».

⚠️ *Test d'erreur* : motif de retrait de 3 caractères → "Le motif doit comporter au moins 5 caractères.".

☐ OK ☐ KO

---

## Étape 239 — Anonymiser un candidat libre (direction)
👤 **directeur** (secondaire-test, MFA) · fenêtre **A** · 📂 **« Candidats »** > recherche `COULIBALY Karim` > fiche `COULIBALY Karim test guide` (« Brouillon »)

⚠️ Irréversible : contact, pièce d'identité et tuteur sont effacés ; le numéro, le résultat et l'historique sont conservés.

1. Se connecter en directeur. Cliquer **« Anonymiser le candidat »**.
2. Dans « Motif (demande de la personne, obligation légale…) », saisir `Demande d'effacement du candidat de démonstration.` puis cliquer **« Anonymiser »**.

✅ Pastille « Anonymisé » ; le bloc de données affiche « Ce candidat a été anonymisé : ces données ont été effacées. » ; le bouton « Anonymiser le candidat » disparaît. Avec `examens@`, ce bouton n'existe pas.

⚠️ *Test d'erreur* : motif de 5 caractères → "Le motif doit comporter au moins 10 caractères.".

☐ OK ☐ KO

---

## Étape 240 — Répartir automatiquement les candidats dans les salles
👤 **responsable des examens** (secondaire-test) · fenêtre **A** · 📂 Menu **« Examens »** > **« Répartition »** (`/v2/examinations/assignments`), session `Session BEPC test guide`

1. Lire la « Synthèse de la répartition » : « Inscrits » 6, « Placés » 0, « Capacité » 0.
2. Dans « Centres de la session », cocher `TG-CTR1 — Centre Cocody test guide`, cliquer **« Enregistrer les centres »**. « Capacité » passe à 5.
3. Cliquer **« Répartir automatiquement »**.
4. Aller dans **« Centres et salles »** > carte `TG-CTR1` > **« Ajouter une salle »** : Code `S3`, Libellé `Salle 3 test guide`, Capacité (places) `2` > **« Ajouter la salle »**.
5. Revenir à « Répartition », cliquer **« Répartir automatiquement »**.
6. Sur la ligne du candidat 00006 (`BAMBA Fanta test guide`), cliquer **« Changer »**, choisir la salle `S3` et le « Numéro de place » `2`, puis **« Enregistrer »**.
7. Sur la ligne du candidat 00005 (`KONE Mariam test guide`), cliquer **« Retirer la place »** (il servira à l'échec de convocation).

✅ Étape 2 : « Centres de la session enregistrés. ». Étape 3 : erreur "Capacité insuffisante : 6 candidat(s) à placer pour 5 place(s) libre(s) dans les salles actives des centres de la session." (tout ou rien, « Placés » reste à 0). Étape 5 : « 6 candidat(s) placé(s), 0 déjà placé(s). » ; tableau « Places attribuées » : 00001 S1 place 1, 00002 S1 place 2, 00003 S1 place 3, 00004 S2 place 1, 00005 S2 place 2, 00006 S3 place 1. Étape 6 : S3 place 2. Étape 7 : la ligne disparaît, « Sans place » 1. La fiche de DIABATE Nadia affiche "Centre Cocody test guide, salle S1, place 1.".

⚠️ *Test d'erreur* : dans « Changer », salle `S1` place `1` (déjà prise) → "Cette place est déjà attribuée.".

☐ OK ☐ KO

---

[⬅ Sommaire](../GUIDE_TEST_UTILISATEUR_COMPLET.md) · [← Précédent](12-eleves-affectes-etat.md) · [Suivant →](13b-examens-suite.md)
