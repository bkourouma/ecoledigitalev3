[⬅ Sommaire](../GUIDE_TEST_UTILISATEUR_COMPLET.md) · [← Précédent](14-paie.md) · [Suivant →](16a-messagerie.md)

# Phase 15 — Documents (GED)

Objectif : déposer, versionner, chercher, partager et protéger des pièces dans l'explorateur de documents du Collège Le Baobab, en vérifiant les niveaux de confidentialité selon le rôle.

Précondition : le worker tourne (l'indexation du texte des PDF prend 1 à 2 minutes) ; les fichiers d'essai sont dans `docs/guide-test/jeux-de-donnees/` (préfixe `ged-`). La graine ne dépose **aucun document** : l'explorateur est vide. Aucun antivirus n'est branché : les versions portent le badge « Non analysé » (c'est normal). Ne jamais créer de fichier EICAR.

---

## Étape 273 — Découvrir l'explorateur vide
👤 **secrétariat** (secondaire-test, `secretariat@secondaire-test.test`, MFA) · fenêtre **A** · 📂 Menu **« Documents »** (`/v2/documents`)

Attendu au départ : aucun document ; les 17 catégories de départ sont créées à la première lecture.

1. Ouvrir **« Documents »** : lire le titre, la barre de section (**« Documents »**, **« Recherche dans les PDF »**, **« Échéances »**) et les boutons **« Recherche dans le contenu »**, **« Échéances »**, **« Déposer un document »**.
2. Relever les filtres **« Rechercher »**, **« Catégorie »**, **« Type de document »**, **« Portée »**, **« Échéance »**, **« Concerne »** (le filtre **« État »** est absent pour le secrétariat). Ouvrir la liste **« Catégorie »**.

✅ « Aucun document ne correspond. » avec une aide invitant à déposer un premier document ; la liste **« Catégorie »** compte 17 entrées (par exemple "Règlement intérieur et chartes", "Assurances", "Pièces comptables") ; la barre de section ne contient ni « Catégories », ni « Quarantaine », ni « Paramètres ».

☐ OK ☐ KO

---

## Étape 274 — Déposer le règlement intérieur (niveau « Interne »)
👤 **secrétariat** · fenêtre **A** · 📂 **« Documents »** > bouton **« Déposer un document »** (`/v2/documents`)

1. Cliquer **« Déposer un document »**.
2. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Catégorie | `Règlement intérieur et chartes` |
| Fichier | `ged-document-test-guide-v1.pdf` |
| Titre | `Règlement intérieur test guide` |
| Description | `Document de démonstration` |
| Étiquettes | `test guide, règlement` |
| Date d'expiration | (vide) |
| Visibilité | « Selon la catégorie » |

3. Cliquer **« Déposer »**.

✅ La page du document s'ouvre (`/v2/documents/<identifiant>`). Badges « Établissement », « Interne » et « Texte en cours de lecture » (puis « Texte cherchable » après 1 à 2 minutes et rechargement). « Fichier actuel » = `ged-document-test-guide-v1.pdf`, « Étiquettes » = `test guide, règlement`, « Empreinte SHA-256 » de 64 caractères. Section "1 version" : « Version 1 · version actuelle » avec le badge « Non analysé ». Boutons **« Télécharger »**, **« Nouvelle version »**, **« Modifier »** ; **pas** de bouton « Archiver » (le secrétariat ne peut pas archiver). Section « Partages » : « Ce document n'est partagé avec personne. » ; section « Historique » : « Document déposé ».

⚠️ *Test d'erreur* : déposer une seconde fois `ged-document-test-guide-v1.pdf` dans la même catégorie, sans personne concernée → "Ce fichier existe déjà dans cette catégorie pour cette personne." (et non « Une erreur est survenue. Veuillez réessayer. »). Aucun document n'est créé.

☐ OK ☐ KO

---

## Étape 275 — Refuser les dépôts invalides
👤 **secrétariat** · fenêtre **A** · 📂 **« Documents »** > **« Déposer un document »** (`/v2/documents`)

Pour chaque ligne : ouvrir la fenêtre, saisir, cliquer **« Déposer »** (ou choisir le fichier : certains refus sont immédiats à la sélection). Si le sélecteur n'affiche pas un fichier, choisir "Tous les fichiers".

| Saisie | Message attendu |
| :--- | :--- |
| Aucun fichier choisi | Choisissez un fichier. |
| Aucune catégorie choisie | Choisissez une catégorie. |
| Catégorie `Assurances` sans date d'expiration | La date d'expiration est obligatoire pour cette catégorie. |
| `ged-fichier-vide-test-guide.pdf` | Le fichier ‹ ged-fichier-vide-test-guide.pdf › est vide. |
| `ged-note-word-test-guide.docx` dans `Assurances` | Le fichier ‹ ged-note-word-test-guide.docx › n'a pas un format accepté (pdf, jpg, jpeg, png, webp). |
| `ged-faux-pdf-test-guide.pdf` (texte renommé en .pdf) dans `Règlement intérieur et chartes` | Le contenu du fichier ne correspond pas à l'extension ‹ .pdf › (contenu réel : texte). |
| `ged-facture.exe.pdf` | Nom de fichier refusé (extension intermédiaire dangereuse). |

✅ Chaque refus laisse la liste inchangée (aucun document créé). Le type est contrôlé sur le **contenu réel** : le faux PDF est refusé malgré la bonne extension.

*(Facultatif : un fichier de 30 Mo, créé dans PowerShell par `$f=[IO.File]::Create("ged-trop-lourd-test-guide.pdf"); $f.SetLength(31457280); $f.Close()`, donne "dépasse la taille maximale (15 Mo)" ; le supprimer ensuite.)*

☐ OK ☐ KO

---

## Étape 276 — Déposer une pièce à échéance et lire l'écran des échéances
👤 **secrétariat** · fenêtre **A** · 📂 **« Documents »** > **« Échéances »** (`/v2/documents/expirations`)

1. **« Déposer un document »**, catégorie `Assurances` (le texte « Cette catégorie exige une date d'expiration. » s'affiche) :

| Champ | Valeur |
| :--- | :--- |
| Titre | `Attestation d'assurance test guide` |
| Fichier | `ged-image-test-guide.png` |
| Date d'expiration | `28/10/2026` (J + 20 jours) |

2. Cliquer **« Déposer »**. Puis déposer, dans la même catégorie :

| Champ | Valeur |
| :--- | :--- |
| Titre | `Assurance échue test guide` |
| Fichier | `ged-document-test-guide-v1.pdf` |
| Date d'expiration | `07/10/2026` (la veille de J : une date passée est acceptée) |

3. Ouvrir **« Échéances »** (titre « Échéances des documents »). Relever l'« Horizon » (30 jours) et les onglets **« À échoir »**, **« Échus »**, **« Sans échéance »**.
4. Passer l'« Horizon » à `15 jours`.

✅ Badges "Expire dans 20 jours" (attestation) et « Échu le 07/10/2026 » (assurance échue). Horizon 30 jours : « À échoir sous 30 jours » = 1, « Échus » = 1 ; l'onglet **« À échoir »** liste l'attestation, **« Échus »** l'assurance échue. Horizon 15 jours : compteur 0 et « Aucun document n'arrive à échéance dans cet horizon. ». L'onglet **« Sans échéance »** est vide : « Aucun document sans échéance exigée. ».

⚠️ *Test d'erreur* : voir l'étape précédente (date obligatoire pour `Assurances`).

☐ OK ☐ KO

---

## Étape 277 — Déposer une nouvelle version
👤 **secrétariat** · fenêtre **A** · 📂 **« Documents »** > fiche de "Règlement intérieur test guide"

1. Ouvrir la fiche de "Règlement intérieur test guide" et cliquer **« Nouvelle version »** (fenêtre « Déposer une nouvelle version » : « La version 2 remplacera la version actuelle ; les versions précédentes restent consultables. »).
2. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Nouveau fichier | `ged-document-test-guide-v2.pdf` |
| Note de version | `Mise à jour test guide` |
| Nouvelle date d'expiration | (vide) |

3. Cliquer **« Déposer la version »**.
4. Cliquer **« Télécharger la version 1 »**, puis **« Télécharger la version 2 »**.

✅ Section "2 versions" : « Version 2 · version actuelle » (avec sa note) et « Version 1 » ; « Fichier actuel » = `ged-document-test-guide-v2.pdf` ; le titre ne change pas ; les deux fichiers se téléchargent ; l'historique ajoute « Nouvelle version déposée (version 2) ». Le texte cherchable de la version 1 est effacé aussitôt (vérifié à l'étape *Rechercher dans l'explorateur et dans le contenu des PDF*).

⚠️ *Test d'erreur* : redéposer `ged-document-test-guide-v2.pdf` → "Ce fichier est identique à la version actuelle." ; aucun fichier puis **« Déposer la version »** → Choisissez un fichier.

☐ OK ☐ KO

---

## Étape 278 — Aperçu, téléchargement et historique
👤 **secrétariat** · fenêtre **A** · 📂 **« Documents »** > fiches de documents

1. Déposer dans `Règlement intérieur et chartes` (catégorie à choisir à chaque fois) trois documents :

| Titre | Fichier |
| :--- | :--- |
| `Image test guide` | `ged-image-test-guide.png` |
| `Note de service test guide` | `ged-note-de-service-test-guide.txt` |
| `Note Word test guide` | `ged-note-word-test-guide.docx` |

2. Sur "Règlement intérieur test guide" : cliquer **« Prévisualiser la version 2 »**, puis **« Prévisualiser la version 1 »**, puis **« Télécharger »**.
3. Sur chacun des trois nouveaux documents : cliquer **« Prévisualiser la version 1 »**.
4. Sur "Règlement intérieur test guide", descendre à **« Historique »**.

✅ PDF : « Aperçu de la version 2 » dans un cadre. Image : l'image 64 x 48 s'affiche. Texte : le contenu dans un bloc. **Word : pas d'aperçu**, message "La prévisualisation des documents Office n'est pas activée : téléchargez le fichier." avec un bouton **« Réessayer »** ; le fichier se télécharge normalement. Historique (le plus récent en premier, avec auteur et date) : « Document déposé », « Nouvelle version déposée », « Prévisualisé », « Téléchargé », « Consulté ».

⚠️ *Écart connu* : l'auteur de l'historique peut s'afficher par identifiant de connexion plutôt que par nom. Le cadre PDF peut être bloqué par le navigateur (à relever).

☐ OK ☐ KO

---

## Étape 279 — Modifier les informations d'un document
👤 **secrétariat** · fenêtre **A** · 📂 **« Documents »** > fiche de "Note de service test guide" > **« Modifier »**

1. Cliquer **« Modifier »** (fenêtre « Modifier le document » : « Modifier les informations ne change pas le fichier : pour le remplacer, déposez une nouvelle version. »).
2. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Titre | `Note de service modifiée test guide` |
| Étiquettes | `test guide, note` |
| Description | `Texte brut` |

3. Cliquer **« Enregistrer »**.

✅ La fenêtre se ferme (aucun message flash) ; le titre et les étiquettes changent sur la fiche et dans la liste ; l'historique ajoute « Informations modifiées ».

⚠️ *Test d'erreur* : sur "Attestation d'assurance test guide", **« Modifier »**, vider « Date d'expiration », **« Enregistrer »** → Cette catégorie exige une date d'expiration.

☐ OK ☐ KO

---

## Étape 280 — Déposer une pièce confidentielle (propriétaire)
👤 **propriétaire** (secondaire-test, `direction.generale@secondaire-test.test`, MFA) · fenêtre **A** · 📂 **« Documents »** > **« Déposer un document »** (`/v2/documents`)

1. Se déconnecter du secrétariat, se connecter en propriétaire. **« Déposer un document »** :

| Champ | Valeur |
| :--- | :--- |
| Catégorie | `Pièces comptables` |
| Document concernant | « Aucune personne (établissement) » |
| Fichier | `ged-comptable-test-guide.pdf` |
| Titre | `Pièce comptable test guide` |

2. Cliquer **« Déposer »**.
3. Déposer ensuite, dans `Règlement intérieur et chartes`, le titre `Scan sans texte test guide` avec `ged-page-sans-texte-test-guide.pdf` (PDF sans aucun texte, comme un scan).
4. Ouvrir `/v2/documents` avec la « Portée » « Tout ce que je peux voir ».

✅ La liste montre tous les documents déposés depuis le début de la phase, dont "Pièce comptable test guide" avec le badge « Confidentiel ». Le propriétaire (comme le directeur) lit tous les niveaux.

☐ OK ☐ KO

---

## Étape 281 — Vérifier les niveaux de confidentialité selon le rôle
👤 **secrétariat**, puis **enseignant** (TRAORE Kouadio, `enseignant@secondaire-test.test`, sans MFA), puis **parent** (DIABATE Séka, `parent@secondaire-test.test`, sans MFA) · fenêtres **A** (secrétariat) et **B** · 📂 **« Documents »** (`/v2/documents`)

Pour chaque compte : ouvrir `/v2/documents`, « Portée » « Tout ce que je peux voir », et noter ce qui est listé. Le secrétariat ouvre aussi **« Déposer un document »** et lit la liste **« Catégorie »**.

✅

| Compte | Règlement intérieur test guide (Interne) | Attestation d'assurance test guide (Restreint) | Pièce comptable test guide (Confidentiel) |
| :--- | :---: | :---: | :---: |
| Secrétariat | oui | oui | **non** |
| Enseignant | oui | **non** | **non** |
| Parent | **non** | **non** | **non** |

La liste de dépôt du secrétariat ne propose pas "Dossier médical", "Contrats de travail" ni "Pièces comptables" (14 catégories sur 17).

☐ OK ☐ KO

---

## Étape 282 — Rechercher dans l'explorateur et dans le contenu des PDF
👤 **propriétaire**, puis **secrétariat** · fenêtre **A** · 📂 **« Documents »** > **« Recherche dans les PDF »** (`/v2/documents/search`)

Précondition : au moins 2 minutes se sont écoulées depuis le dépôt de "Pièce comptable test guide" et de "Scan sans texte test guide" (sinon, réessayer plus tard).

1. Propriétaire, `/v2/documents` : saisir `guide` dans **« Rechercher »**, puis un nom de fichier, puis une étiquette (`règlement`).
2. Propriétaire, `/v2/documents/search` : saisir successivement `b` (1 caractère), `palmierversion2deux`, `baobabcertif2026`, `piece comptable fictive` (sans accent), `caissecompta2026`.
3. Ouvrir les fiches de "Scan sans texte test guide" et de "Règlement intérieur test guide".
4. Se reconnecter en **secrétariat** et chercher `caissecompta2026`.

✅ `b` : « Saisissez au moins 2 caractères. ». `palmierversion2deux` trouve "Règlement intérieur test guide" avec l'extrait surligné. **`baobabcertif2026` ne trouve plus rien** (« Aucun document ne contient ces mots. » : le texte de la version 1 a été effacé à l'arrivée de la version 2). La recherche ignore accents et majuscules ; `caissecompta2026` trouve la pièce comptable pour le propriétaire. "Scan sans texte test guide" porte le badge « Sans texte » et l'avis « Ce PDF ne contient pas de texte (probablement un scan) : il n'est pas cherchable par son contenu. Il n'y a pas de reconnaissance de caractères. » ; le règlement porte « Texte cherchable ». Pour le **secrétariat**, `caissecompta2026` ne donne **aucun résultat** et aucun indice de l'existence de la pièce.

☐ OK ☐ KO

---

## Étape 283 — Partager un document avec une personne, puis retirer le partage
👤 **secrétariat** puis **enseignant** · fenêtres **A** et **B** · 📂 **« Documents »** > fiche de "Attestation d'assurance test guide" > section « Partages »

1. Secrétariat : dans « Partages », saisir :

| Champ | Valeur |
| :--- | :--- |
| Partager avec | `TRAORE` puis choisir TRAORE Kouadio |
| Droit accordé | « Lecture » |
| Fin du partage | (vide) |
| Note | `Pour information test guide` |

2. Cliquer **« Partager »**.
3. Enseignant : `/v2/documents`, « Portée » « Partagés avec moi » ; ouvrir le document, cliquer **« Télécharger »**, chercher **« Nouvelle version »** et **« Modifier »**.
4. Secrétariat : cliquer **« Retirer le partage de TRAORE Kouadio »**. Enseignant : recharger l'explorateur puis rouvrir l'adresse de la fiche.

✅ « Document partagé avec TRAORE Kouadio. » et la ligne "Lecture · sans date de fin · Pour information test guide". L'enseignant voit le document « Restreint » malgré son niveau « Interne » et peut le télécharger, mais n'a ni « Nouvelle version » ni « Modifier ». Après le retrait, le document disparaît de ses listes et son adresse répond "Document introuvable (`<identifiant>`).". L'historique montre « Partagé » puis « Partage retiré ».

⚠️ *Test d'erreur* : le secrétariat se cherche lui-même → "Vous ne pouvez pas partager un document avec vous-même." ; « Fin du partage » = hier → "La date de fin du partage doit être dans le futur.".

☐ OK ☐ KO

---

## Étape 284 — Parent, élève et enseignant déposent leurs propres pièces
👤 **parent**, **élève** (DIABATE Nadia, `eleve@secondaire-test.test`, sans MFA), **enseignant**, puis **secrétariat** · fenêtre **B** (puis **A**) · 📂 taper `/v2/documents`

⚠️ *Écart connu* : aucune entrée de menu ne mène à `/v2/documents` dans les portails parent, élève et enseignant ; il faut taper l'adresse. Si la liste « Catégorie » propose des catégories du personnel au parent (ou d'élève à l'enseignant), le dépôt échoue : à consigner.

1. Parent : `/v2/documents`, lire les options de « Portée » (« Tout ce que je peux voir », « Mes dépôts », « Partagés avec moi », « Mes enfants »), puis **« Déposer un document »** :

| Champ | Valeur |
| :--- | :--- |
| Catégorie | `Pièces d'identité de l'élève` |
| Fichier | `ged-image-test-guide.png` |
| Enfant concerné | `DIABATE Nadia` (la liste ne propose que Nadia et Salimata) |
| Titre | `Extrait de naissance Nadia test guide` |

2. Élève : déposer dans `Pièces d'identité de l'élève` ("Document concernant : DIABATE Nadia") le fichier `ged-document-test-guide-v1.pdf`, titre `Pièce Nadia déposée par l'élève test guide`.
3. Enseignant : déposer dans `Diplômes et attestations` le fichier `ged-image-test-guide.png`, titre `Diplôme enseignant test guide`, puis ouvrir la « Portée » « Mon dossier de personnel ».
4. Secrétariat (A) : déposer pour `DIABATE Salimata` dans `Dossier d'inscription` le fichier `ged-document-test-guide-v1.pdf`, titre `Pièce élève Salimata test guide`. Filtrer ensuite « Concerne » « Élève », « Personne concernée » `DIABATE Nadia`.
5. Parent : recharger « Mes enfants ».

✅ Le parent ne peut choisir que Nadia ou Salimata ; son document est visible dans « Mes enfants » ; l'élève voit sa pièce et celle du parent ; l'enseignant voit son diplôme dans « Mon dossier de personnel » ; le secrétariat voit les pièces d'élèves (niveau « Restreint ») ; le parent voit la pièce de Salimata déposée par le secrétariat (catégorie « Lisible par les tuteurs »).

⚠️ *Test d'erreur* : la liste « Catégorie » de l'enseignant ne propose pas `Contrats de travail`, celle du parent ne propose pas `Pièces comptables`.

☐ OK ☐ KO

---

## Étape 285 — Restreindre la visibilité d'une pièce
👤 **secrétariat**, **parent**, **économe** (`econome@secondaire-test.test`, MFA) · fenêtres **A** et **B** · 📂 **« Documents »** > fiche de "Pièce élève Salimata test guide" > **« Modifier »**

1. Secrétariat : **« Modifier »**, « Visibilité » « Personnel seulement », **« Enregistrer »** (la fenêtre rappelle : « Modifier la visibilité change aussitôt qui peut voir ce document. »). Parent : recharger « Mes enfants ». Économe : ouvrir l'adresse de la fiche.
2. Secrétariat : « Visibilité » « Privé ». Économe : rouvrir la fiche. Propriétaire : rouvrir la fiche.
3. Secrétariat : revenir à « Selon la catégorie ».

✅ « Personnel seulement » : le parent ne voit plus la pièce, l'économe la voit encore (niveau « Restreint »). « Privé » : l'économe obtient "Document introuvable (`<identifiant>`)." ; le propriétaire la voit. Retour à « Selon la catégorie » : le parent la revoit.

☐ OK ☐ KO

---

## Étape 286 — Créer une catégorie et accorder un droit par personne
👤 **propriétaire**, puis **enseignant** · fenêtres **A** et **B** · 📂 **« Documents »** > **« Catégories »** (`/v2/documents/categories`)

1. Propriétaire : lire les cinq groupes et la note « Changer le niveau de confidentialité d'une catégorie change aussitôt qui peut voir ses documents. ». Cliquer **« Nouvelle catégorie »** :

| Champ | Valeur |
| :--- | :--- |
| Code | `TG_CATEGORIE` |
| Type de document | « Établissement » |
| Libellé | `Catégorie test guide` |
| Description | `Catégorie de test du guide` |
| Niveau de confidentialité | « Confidentiel (direction) » |
| Extensions acceptées | laisser .pdf .jpg .jpeg .png cochées |

2. Cliquer **« Enregistrer »**, puis déposer dans cette catégorie le titre `Pièce de catégorie test guide` avec `ged-image-test-guide.png`.
3. Sur la ligne de la catégorie, **« Droits par personne »** : « Personne » `TRAORE Kouadio`, « Droit accordé » « Lecture », **« Accorder le droit »**. Enseignant : ouvrir `/v2/documents`.
4. Propriétaire : **« Retirer »** (droit de TRAORE Kouadio). Enseignant : recharger.

✅ La catégorie apparaît dans « Établissement » ; l'enseignant voit la pièce (confidentielle) tant que le droit existe, plus rien après « Retirer ». Les champs « Code » et « Type de document » ne sont plus modifiables après création.

⚠️ *Test d'erreur* : code `TG-CAT` → Code invalide : majuscules, chiffres et _ (2 à 40 caractères). ; libellé vide → Le libellé est obligatoire.

☐ OK ☐ KO

---

## Étape 287 — Lire les paramètres de stockage et la quarantaine
👤 **propriétaire** · fenêtre **A** · 📂 **« Documents »** > **« Paramètres »** (`/v2/documents/settings`)

1. Lire « Stockage utilisé » (jauge, compteurs « Documents », « Versions », « Archivés », « En quarantaine ») et « Réglages » : « Taille maximale d'un fichier (Mo) » `15`, « Seuils d'alerte d'expiration (jours) » `30, 7, 1`, « Conservation après archivage (jours) » `0`, « Conservation de la quarantaine (jours) » `30`, « Versions maximales par document » `50`.
2. Mettre « Versions maximales par document » à `2`, cliquer **« Enregistrer »**. Sur "Règlement intérieur test guide" (2 versions), **« Nouvelle version »** avec `ged-comptable-test-guide.pdf`.
3. Remettre `50`, **« Enregistrer »**.
4. Ouvrir **« Quarantaine »** (`/v2/documents/quarantine`) et parcourir les onglets.

✅ « Paramètres enregistrés. » ; refus "Ce document a atteint le nombre maximal de versions (2)." ; réglages remis à 50. Quarantaine : « Aucun fichier. » partout (aucun antivirus).

⚠️ *Test d'erreur* : « Taille maximale d'un fichier (Mo) » = `200` → Taille invalide (100 Mo au plus).

☐ OK ☐ KO

---

## Étape 288 — Contrôler les droits et l'isolation des documents
👤 **enseignant**, **chargé d'admissions** (`admissions@secondaire-test.test`, sans MFA), **parent**, **secrétariat** · fenêtre **B** (puis **A**) · 📂 adresses tapées à la main

1. Enseignant : taper `/v2/documents/categories`, `/v2/documents/quarantine`, `/v2/documents/settings`.
2. Chargé d'admissions : taper `/v2/documents`, `/v2/documents/search`, `/v2/documents/expirations`.
3. Secrétariat (A) : déposer `Pièce élève Aya BAMBA test guide` (`Dossier d'inscription`, élève `BAMBA Aya`, `ged-image-test-guide.png`) et copier l'adresse de la fiche.
4. Parent : coller cette adresse, puis `/v2/documents/00000000-0000-0000-0000-000000000000`.

✅ Étapes 1 et 2 : « Accès refusé » ("Vous n'avez pas les droits nécessaires pour afficher cette page."). Étape 4 : les deux adresses donnent **la même réponse** "Document introuvable (`<identifiant>`).", sans révéler l'existence de la pièce de BAMBA Aya.

☐ OK ☐ KO

---

## Étape 289 — ⚠️ Archiver puis restaurer un document
👤 **directeur des études** (`etudes@secondaire-test.test`, MFA), puis **propriétaire** · fenêtre **A** · 📂 **« Documents »** > fiche de "Image test guide"

⚠️ Action sensible : l'archivage retire le document des listes de tout le monde sauf de la gestion ; il se restaure (propriétaire), mais l'historique garde les deux événements.

1. Constater que le secrétariat n'a pas de bouton « Archiver » (étape *Déposer le règlement intérieur*). Directeur des études : ouvrir la fiche, **« Archiver »** (fenêtre « Archiver ce document »).
2. Saisir « Motif de l'archivage » : `ab`, puis `Doublon de test test guide`, cliquer **« Archiver »**.
3. Propriétaire : filtre « État » « Archivés », ouvrir le document, cliquer **« Restaurer »**.

✅ Motif de 2 caractères : « Le motif doit comporter au moins 3 caractères. » ; ensuite « Document archivé : il n'apparaît plus dans les listes. » ; le document disparaît de la liste « Actifs ». Propriétaire : avis « Ce document est archivé. Motif : Doublon de test test guide » ; après **« Restaurer »** : « Document restauré. » ; l'historique garde « Archivé » et « Restauré ».

📚 *Pour aller plus loin* : chapitre 14, scénarios 14.11 (lecture auditée d'un document confidentiel), 14.15 (archivage d'une catégorie, échéance exigée) et 14.18 (isolation entre établissements).

**Ce que la phase laisse dans l'application :** documents (Collège Le Baobab) `Règlement intérieur test guide` (2 versions), `Image test guide`, `Note de service modifiée test guide`, `Note Word test guide`, `Scan sans texte test guide`, `Attestation d'assurance test guide` (échéance 28/10/2026), `Assurance échue test guide`, `Pièce comptable test guide`, `Extrait de naissance Nadia test guide`, `Pièce Nadia déposée par l'élève test guide`, `Diplôme enseignant test guide`, `Pièce élève Salimata test guide`, `Pièce élève Aya BAMBA test guide`, `Pièce de catégorie test guide` ; catégorie `TG_CATEGORIE` ("Catégorie test guide") ; paramètres remis à l'état de départ (15 Mo, 30/7/1, 0, 30, 50).

---

[⬅ Sommaire](../GUIDE_TEST_UTILISATEUR_COMPLET.md) · [← Précédent](14-paie.md) · [Suivant →](16a-messagerie.md)
