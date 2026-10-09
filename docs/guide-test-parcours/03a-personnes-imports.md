[⬅ Sommaire](../GUIDE_TEST_UTILISATEUR_COMPLET.md) · [← Précédent](02-structure-academique.md) · [Suivant →](03b-personnes-imports-suite.md)

# Phase 3 — Personnes : tuteurs, élèves, personnel, inscriptions et imports

On crée à la main la famille KOUASSI (tuteur, élève), le premier enseignant du guide et l'inscription de l'élève, puis on remplit la 6e A par des imports (fichier valide, fichier avec erreurs, inscriptions, classeur Excel). À la fin, la 6e A compte **35 élèves sur 40**.

Précondition : phase *Structure académique* jouée, donc les classes `6e B test guide` (code `TG-6EB`, **active**, capacité 30, effectif 0 / 30) et `6e C test guide` (`TG-6EC`, brouillon) existent. La 6e A de la graine compte 12 élèves.

> ⚠️ **Deux élèves "KOUASSI Aïcha test guide" existeront à la fin de la phase** : celle créée à la main (née le **12/05/2014**, classe 6e B, la seule que les phases suivantes utilisent) et celle de l'import (née le **12/03/2014**, matricule d'origine `TG-ELV-S01`, classe 6e A). Ce ne sont pas des doublons (dates de naissance différentes). Dans les listes, distinguez-les par le **matricule** et la **classe**.

> ⚠️ **Les imports écrivent des données définitives** (aucun retour arrière à l'écran). Respectez l'ordre des étapes et **n'exécutez pas** le fichier de démonstration `eleves-demonstration.csv` (la capacité de la 6e A serait dépassée). Gardez l'onglet au premier plan pendant la validation et l'exécution d'un import.

---

## Étape 29 — Lire la liste des élèves de départ
👤 **secrétariat** (secondaire-test) · fenêtre **A** · 📂 Menu **« Personnes »** > **"Élèves"** (`/v2/students`)

Premier passage de ce compte : `secretariat@secondaire-test.test` (**MFA** : le code du moment est proposé sur la page de connexion).

Attendu au départ : au moins 12 élèves (DIABATE Nadia, DIABATE Salimata, BAMBA Aya… ; Nadia porte le matricule `00001`), 8 inscrits en 6e A et 4 « Non inscrit » ou en attente.

1. Lire les colonnes « Élève », « Matricule », « Classe », « Inscription », « Statut » et la barre d'onglets « Élèves », « Nouvel élève », « Tuteurs ».
2. Dans « Rechercher un élève », saisir `diabate` (minuscules).

✅ DIABATE Nadia et DIABATE Salimata sont retrouvées (la recherche ignore casse et accents). `zzzz` affiche « Aucun élève ne correspond à votre recherche. »

☐ OK ☐ KO

---

## Étape 30 — Créer le tuteur KOUASSI Marcel test guide
👤 **secrétariat** (secondaire-test) · fenêtre **A** · 📂 Onglet **« Tuteurs »** (`/v2/guardians`)

1. Cliquer **« Nouveau tuteur »** (fenêtre « Créer un tuteur »).
2. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Nom | `KOUASSI` |
| Prénoms | `Marcel test guide` |
| Sexe | « Masculin » |
| Date de naissance | `03/04/1980` |
| Lieu de naissance | `Abidjan` |
| Nationalité (code pays) | `CI` |
| Adresse e-mail | `marcel.kouassi.tg@exemple.test` |
| Téléphone | `+225 07 58 12 34 56` |
| Ville | `Abidjan` |
| Adresse | `Rue des Jardins, Cocody (fictif)` |
| Lieu de résidence | `Cocody` |
| Profession | `Commerçant` |

3. Cliquer **« Créer »**.

✅ Message "Le tuteur KOUASSI Marcel test guide a été créé." ; la ligne apparaît avec **0** enfant et la pastille « Sans compte ». Le téléphone peut s'afficher sans espaces.

⚠️ *Test d'erreur* : fenêtre ouverte, Nom et Prénoms vides, « Créer » → « Ce champ est obligatoire. » sous chacun. E-mail `marcel.exemple` → "Adresse e-mail invalide." Téléphone `12` → "Téléphone trop court."

☐ OK ☐ KO

---

## Étape 31 — Signaler un doublon de tuteur
👤 **secrétariat** (secondaire-test) · fenêtre **A** · 📂 Onglet **« Tuteurs »** (`/v2/guardians`)

1. Cliquer **« Nouveau tuteur »** et saisir seulement Nom `KOUASSI` et Prénoms `Marcel test guide`, puis **« Créer »**.
2. Lire l'encadré, puis cocher **« Ce n'est pas un doublon : créer quand même »**.

✅ La fenêtre reste ouverte ; l'encadré annonce "1 dossier ressemble à cette personne" avec la mention « Même nom » (une date de naissance manque d'un côté). Après la case cochée, le champ « Motif de la création » apparaît. **Fermer la fenêtre sans créer** : le tuteur n'existe qu'une fois (recherche `KOUASSI`).

⚠️ *Test d'erreur* : case cochée, « Motif de la création » vide, « Créer » → "Un motif est requis pour confirmer un doublon possible."

☐ OK ☐ KO

---

## Étape 32 — Créer l'élève KOUASSI Aïcha test guide avec son tuteur
👤 **secrétariat** (secondaire-test) · fenêtre **A** · 📂 Onglet **« Nouvel élève »** (`/v2/students/new`)

1. Étape « Identité » : saisir

| Champ | Valeur |
| :--- | :--- |
| Nom | `KOUASSI` |
| Prénoms | `Aïcha test guide` |
| Sexe | « Féminin » |
| Date de naissance | `12/05/2014` |
| Lieu de naissance | `Abidjan` |
| Nationalité (code pays) | `CI` |
| Adresse e-mail | `aicha.kouassi.tg@exemple.test` |
| Téléphone | `+225 07 58 12 34 57` |
| Ville | `Abidjan` |
| Adresse | `Rue des Jardins, Cocody (fictif)` |

   puis **« Suivant »** : aucun encadré de doublon ne doit apparaître.
2. Étape « Tuteurs » : **« Ajouter un tuteur existant »** ; dans « Tuteur » (placeholder "Rechercher un tuteur…") taper `test guide` et choisir KOUASSI Marcel test guide ; « Lien de parenté » = "Père". Laisser cochés « Contact principal », « Contact d'urgence », « Accès au portail parents » ; **cocher « Responsable financier »**. **« Suivant »**.
3. Étape « Récapitulatif » : relire « Tuteurs à lier » (`1`) et la note « Le matricule est attribué automatiquement à la création. » Cliquer **« Créer le dossier »**.

✅ Écran « Dossier créé » : "KOUASSI Aïcha test guide — matricule N." **Relever le matricule N**. Boutons « Ouvrir la fiche » et « Inscrire maintenant ». Sur `/v2/guardians`, KOUASSI Marcel test guide compte maintenant **1** enfant.

⚠️ *Test d'erreur* : (sans rien créer) Sexe laissé sur « Choisir… » puis « Suivant » → "Le sexe est obligatoire pour un élève." Date de naissance `12/05/2030` → "Date de naissance invraisemblable."

🔒 *Test de droit* : en tant que **directeur des études** (`etudes@secondaire-test.test`, MFA), taper `/v2/students/new` → page « Accès refusé ».

☐ OK ☐ KO

---

## Étape 33 — Signaler un doublon d'élève
👤 **secrétariat** (secondaire-test) · fenêtre **A** · 📂 Onglet **« Nouvel élève »** (`/v2/students/new`)

1. Ressaisir l'identité exacte : Nom `KOUASSI`, Prénoms `Aïcha test guide`, Sexe « Féminin », Date de naissance `12/05/2014`, puis **« Suivant »**.

✅ L'encadré affiche "1 dossier ressemble à cette personne" avec « Même nom et même date », le matricule, le rôle « Élève » et le lien « Ouvrir la fiche ». Le passage à l'étape suivante est bloqué.

2. Changer la date en `13/05/2014` : plus de doublon (les homonymes de dates différentes ne sont pas des doublons). Revenir à `12/05/2014`, cocher **« Ce n'est pas un doublon : créer quand même »** : le champ « Motif de la création » apparaît. **Quitter la page sans rien créer** (menu « Élèves »).

⚠️ *Test d'erreur* : case cochée, motif vide, « Suivant » → "Un motif est requis pour confirmer un doublon possible."

☐ OK ☐ KO

---

## Étape 34 — Lire et modifier la fiche élève
👤 **secrétariat** (secondaire-test) · fenêtre **A** · 📂 **"Élèves"** > fiche de `KOUASSI Aïcha test guide` (`/v2/students`)

1. Lire l'en-tête : nom, "Matricule N", pastilles « Actif » et « Non inscrit », boutons « Inscrire », « Modifier », « Changer le statut ». Onglets : « Identité », « Tuteurs », « Urgences », « Parcours scolaire », « Statut », « Pièces ».
2. Onglet « Identité » : « Première inscription » et « Compte du portail » = « Aucun compte » ; les valeurs absentes affichent « — ». La section « Tuteur principal » donne un lien vers KOUASSI Marcel test guide (lien de parenté peut s'afficher en code brut `FATHER`).
3. Section « Informations sensibles » : cliquer **« Afficher les informations sensibles »**, constater que les champs sont vides, puis **« Masquer »**.
   ⚠️ *Écart connu* : aucun écran ne permet de saisir l'identifiant national ni l'acte de naissance, ces champs restent vides.
4. Cliquer **« Modifier »**, changer « Ville » en `Yamoussoukro` et « Lieu de résidence » en `Plateau`, **« Enregistrer »**.

✅ « La fiche a été mise à jour. » Les nouvelles valeurs persistent après rechargement. Remettre « Ville » = `Abidjan` (facultatif).

⚠️ *Test d'erreur* : vider « Nom » puis « Enregistrer » → « Ce champ est obligatoire. »

🔒 *Test de droit* : en tant que **directeur des études**, la même fiche n'a ni « Modifier » ni section « Informations sensibles ».

☐ OK ☐ KO

---

## Étape 35 — Ajouter un contact d'urgence
👤 **secrétariat** (secondaire-test) · fenêtre **A** · 📂 **"Élèves"** > fiche de `DIABATE Nadia` > onglet **« Urgences »**

Le contact est ajouté à une fiche de la graine, car le compte parent du guide ne voit que Nadia et Salimata.

Attendu au départ : « Aucun contact d'urgence. »

1. Cliquer **« Ajouter un contact »** (fenêtre « Ajouter un contact d'urgence »).
2. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Nom du contact | `BAMBA Oncle test guide` |
| Lien avec l'élève | `Oncle` |
| Téléphone | `+225 07 12 34 56 78` |
| Adresse e-mail | `oncle.bamba.tg@exemple.test` |

3. Valider.

✅ « Le contact a été ajouté. » ; la ligne apparaît (colonnes « Nom », « Lien », « Téléphone », « Priorité »).

⚠️ *Test d'erreur* : Téléphone vide → « Ce champ est obligatoire. » ; Téléphone `12` → "Téléphone trop court."

☐ OK ☐ KO

---

## Étape 36 — Corriger les coordonnées du contact (parent)
👤 **parent** (secondaire-test) · fenêtre **B** · 📂 Taper l'adresse `/v2/students/children`

Premier passage de ce compte : `parent@secondaire-test.test` (pas de MFA). ⚠️ *Écart connu* : « Mes enfants » n'est pas dans le menu du portail, il faut taper l'adresse.

1. Lire « Mes enfants » : seules **DIABATE Nadia** et **DIABATE Salimata** sont listées.
2. Cliquer **« Ouvrir la fiche »** de Nadia. Section « Contacts d'urgence » : cliquer **« Corriger »** sur BAMBA Oncle test guide (fenêtre "Corriger les coordonnées de BAMBA Oncle test guide").
3. Changer « Téléphone » en `+225 07 12 34 56 79`, **« Enregistrer »**.

✅ « Les coordonnées ont été mises à jour. » Le parent ne peut modifier ni le lien ni la priorité et n'a aucun bouton d'ajout ou de retrait.

🔒 *Test de droit* : en tant que **parent**, taper `/v2/students` → « Accès refusé ».

☐ OK ☐ KO

---

## Étape 37 — Retirer le contact d'urgence
👤 **secrétariat** (secondaire-test) · fenêtre **A** · 📂 **"Élèves"** > fiche de `DIABATE Nadia` > onglet **« Urgences »**

1. Recharger l'onglet : le numéro est `+225 07 12 34 56 79` (corrigé par le parent).
2. Cliquer **« Retirer »** sur la ligne.

✅ « Le contact a été retiré. » ; l'onglet affiche de nouveau « Aucun contact d'urgence. »

☐ OK ☐ KO

---

## Étape 38 — Déposer l'acte de naissance de l'élève
👤 **secrétariat** (secondaire-test) · fenêtre **A** · 📂 **"Élèves"** > fiche de `KOUASSI Aïcha test guide` > onglet **« Pièces »**

Fichiers : `docs/guide-test/jeux-de-donnees/04-piece-eleve-test-guide.pdf` et `docs/guide-test/jeux-de-donnees/04-piece-eleve-invalide-test-guide.txt`.

Attendu au départ : « Aucune pièce au dossier. »

1. Cliquer **« Déposer une pièce »**.
2. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Type de pièce | « Acte de naissance » |
| Fichier | `04-piece-eleve-test-guide.pdf` |
| Intitulé | `Acte de naissance test guide` |
| Date d'émission | `10/06/2014` |

3. Cliquer **« Déposer »**.
4. Cliquer **« Ouvrir »** sur la pièce : le fichier s'ouvre dans un nouvel onglet.
5. Cliquer **« Retirer »**, saisir le « Motif du retrait » `Pièce de test retirée`, confirmer **« Retirer »**.

✅ La pièce apparaît en "Version 1", « Active » ; après le retrait, elle est « Retirée » dans l'historique avec son motif. ⚠️ *Écart connu* : si le stockage de fichiers n'est pas branché, le dépôt répond "Le stockage de fichiers n'est pas disponible." *(à vérifier)*

⚠️ *Test d'erreur* : « Déposer » sans fichier → « Choisissez un fichier. » ; fichier `04-piece-eleve-invalide-test-guide.txt` → « Format non accepté : PDF, JPEG, PNG ou WebP uniquement. » ; motif de retrait de 3 caractères → « Le motif doit comporter au moins 5 caractères. »

🔒 *Test de droit* : en tant que **directeur des études**, l'onglet « Pièces » affiche « Accès restreint ».

☐ OK ☐ KO

---

## Étape 39 — Créer l'enseignant OUATTARA Zénon test guide
👤 **directeur** (secondaire-test) · fenêtre **A** · 📂 Menu **« Personnes »** > **"Personnel"** > onglet **« Nouveau membre »** (`/v2/staff/new`)

Premier passage de ce compte : `directeur@secondaire-test.test` (**MFA**). Pour changer de compte : « Se déconnecter » dans la fenêtre A.

Attendu au départ (`/v2/staff`) : TRAORE Kouadio, YAO Fatou et KOUAME Adjoua, statut « En poste ».

1. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Nom | `OUATTARA` |
| Prénoms | `Zénon test guide` |
| Sexe | « Masculin » |
| Date de naissance | `17/04/1985` |
| Adresse e-mail | `zenon.ouattara.tg@exemple.test` |
| Téléphone | `+225 05 66 21 34 78` |
| Ville | `Abidjan` |
| Catégorie | « Enseignant » |
| Intitulé du poste | `Professeur de mathématiques test guide` |
| Date d'embauche | `01/09/2026` |

2. Cliquer **« Créer la fiche »**.

✅ Écran « Fiche créée » : "OUATTARA Zénon test guide — matricule P00NN." (`P` suivi de 4 chiffres : **relever le matricule**). Boutons « Ouvrir la fiche » et « Retour à la liste ».

3. Pour tester le doublon : « Nouveau membre », Nom `OUATTARA`, Prénoms `Autre test guide`, **même adresse e-mail** `zenon.ouattara.tg@exemple.test`, « Créer la fiche » : l'encadré annonce "1 dossier ressemble à cette personne" avec « Même e-mail ». **Ne pas créer** ; quitter la page.

⚠️ *Test d'erreur* : e-mail `zenon.exemple` → "Adresse e-mail invalide." ; Nom et Prénoms vides → « Ce champ est obligatoire. »

🔒 *Test de droit* : en tant que **secrétariat**, taper `/v2/staff` → « Accès refusé ».

☐ OK ☐ KO

---

## Étape 40 — Compléter la fiche du personnel (poste, contrat)
👤 **directeur** (secondaire-test) · fenêtre **A** · 📂 **"Personnel"** > fiche de `OUATTARA Zénon test guide` (`/v2/staff`)

1. Lire l'en-tête : "Matricule P00NN — Enseignant — Professeur de mathématiques test guide", boutons « Modifier », « Inviter au portail », « Changer le statut ». Onglets : « Identité », « Contrats », « Qualifications », « Compétences », « Disponibilités », « Charge horaire », « Historique ».
2. **« Modifier »**, changer « Intitulé du poste » en `Professeur principal test guide`, **« Enregistrer »** : « La fiche a été mise à jour. »
3. Onglet « Contrats » > **« Ajouter un contrat »** :

| Champ | Valeur |
| :--- | :--- |
| Type de contrat | "Contrat à durée déterminée" |
| Statut initial | « En cours » |
| Début | `01/09/2026` |
| Fin | `31/08/2027` |
| Volume horaire contractuel | `18` |
| Unité | « Par semaine » |
| Note | `Contrat de test du guide` |

4. Valider avec **« Ajouter un contrat »**, puis cliquer **« Terminer »** sur la ligne.

✅ « Le contrat a été ajouté. » (ligne "18 h / semaine", « En cours »), puis « Le contrat est terminé. »

⚠️ *Test d'erreur* : contrat sans type → « Ce champ est obligatoire. »

> L'invitation au portail (« Inviter au portail ») crée un accès fictif **non supprimable** : elle n'est pas jouée ici (voir le chapitre).

🔒 *Test de droit* : en tant que **directeur des études**, ni « Modifier » ni onglet « Contrats » sur cette fiche.

☐ OK ☐ KO

---

## Étape 41 — Affecter OUATTARA Zénon à l'enseignement des mathématiques
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 Menu **« Personnes »** > **"Affectations"** (`/v2/staff/assignments`)

Premier passage de ce compte : `etudes@secondaire-test.test` (**MFA**).

1. Lire « Affectations d'enseignement » : onglets « Par classe » et « Par enseignant », « Année » préremplie.
2. Onglet « Par classe » : dans « Classe », chercher `test guide` et choisir `6e B test guide`. La matrice « Matrice matière par rôle d'enseignement » liste les matières ; le bandeau signale celles sans responsable.
3. Sur la ligne `Mathématiques`, colonne « Responsable », cliquer **« Affecter »** (fenêtre "Affecter un enseignant à Mathématiques").
4. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Enseignant | `OUATTARA Zénon test guide` |
| Rôle | « Responsable » |
| Période | « Toute l'année » |
| Début | date du jour (par défaut) |
| Heures prévues | `4` |
| Note | `Affectation de test` |

5. Cliquer **« Affecter »**.

✅ « L'affectation est enregistrée. » ; le nom apparaît dans la cellule « Responsable » de Mathématiques. Onglet « Par enseignant » > `OUATTARA Zénon test guide` : « Charge horaire et affectations » liste l'affectation (4 h prévues).

⚠️ *Test d'erreur* : « Affecter » sans choisir d'enseignant → « Choisissez un enseignant. » ; un second responsable sur Mathématiques → "Cette matière a déjà un responsable (OUATTARA Zénon test guide) : ajoutez un co-enseignant (CO_TEACHER) ou terminez l'affectation existante."

🔒 *Test de droit* : en tant que **secrétariat**, taper `/v2/staff/assignments` → « Accès refusé ».

☐ OK ☐ KO

---

[⬅ Sommaire](../GUIDE_TEST_UTILISATEUR_COMPLET.md) · [← Précédent](02-structure-academique.md) · [Suivant →](03b-personnes-imports-suite.md)
