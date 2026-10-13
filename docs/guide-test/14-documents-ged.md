# Chapitre 14. Documents (gestion électronique)

> **Adresses.** Les écrans sont servis sous `http://localhost:3000/v2/documents/...` (API sur `http://localhost:4000`). Aucune réécriture n'ajoute ni ne retire `/v2` (`apps/web/next.config.js`, `apps/web/middleware.ts`) : l'adresse du navigateur est celle du dossier `apps/web/src/app/v2/documents`.
>
> **Convention de citation.** Les libellés entre « … » sont ceux de `apps/web/messages/fr-CI.json`. Quand un message contient lui-même des guillemets français, ils sont notés ‹ … › ici. Les valeurs à saisir sont en `code` ou entre guillemets droits. Les champs de date s'écrivent jj/mm/aaaa dans un navigateur en français (ou aaaa-mm-jj pour un pilotage automatique). La zone "Glissez un fichier ici…" est un bouton qui ouvre le sélecteur de fichiers du système (champ caché) : le glisser-déposer n'est pas indispensable.

## Prérequis

- Établissement : **Collège Le Baobab (démonstration)** (`secondaire-test`). Le module existe aux Palmiers et à l'Université Horizon avec les mêmes écrans. La page `/v2/higher/documents` (documents officiels du supérieur) est un autre module, hors de ce chapitre.
- Le seed ne dépose **aucun document** (`scripts/seed-v2/demo/*.ts` ne touche pas à `documents`) : l'explorateur est vide au départ. Les 17 catégories de départ sont créées à la **première lecture** du tenant (`ensureDefaults`, idempotent).
- Fichiers d'essai : **`docs/guide-test/jeux-de-donnees/ged-*`** (tous fictifs, quelques centaines d'octets à 6 Ko, aucune macro, aucun lien, aucun programme). Tableau ci-dessous. À choisir via le sélecteur de fichiers de la zone de dépôt (le champ accepte, selon la catégorie, des extensions précises : si le sélecteur ne montre pas un fichier, choisir "Tous les fichiers").
- Sous `pnpm dev:v2`, l'analyseur local `DOCUMENTS_SCANNER=dev-eicar` est actif (relancer l'application après la mise à jour) : les fichiers ordinaires sont « sains » et un fichier qui contient la chaîne d'essai EICAR est mis en quarantaine (écran « Quarantaine des documents »). Attention : l'antivirus de votre poste (Windows Defender) supprime ce fichier dès qu'il le voit ; créez-le dans un dossier exclu de l'analyse, ou envoyez-le depuis un navigateur sans l'enregistrer. Aucun vrai programme malveillant n'est détecté par ce mode.
- La recherche dans le contenu des PDF dépend du job `documents.text-index` du worker (chaque minute) : compter 1 à 2 minutes entre le dépôt et le premier résultat. Pas de reconnaissance de caractères (OCR).

| Fichier (`jeux-de-donnees/`) | Nature | Sert à |
|---|---|---|
| `ged-document-test-guide-v1.pdf` | vrai PDF avec texte, mot unique `baobabcertif2026` | dépôt, recherche, version 1 |
| `ged-document-test-guide-v2.pdf` | vrai PDF avec texte, mot unique `palmierversion2deux` | nouvelle version |
| `ged-comptable-test-guide.pdf` | vrai PDF avec texte, mot unique `caissecompta2026` | document confidentiel |
| `ged-page-sans-texte-test-guide.pdf` | vrai PDF sans aucun texte (un rectangle dessiné) | état « Sans texte » (comme un scan) |
| `ged-image-test-guide.png` | vraie image PNG 64 x 48 | image, aperçu image |
| `ged-note-de-service-test-guide.txt` | texte UTF-8 | aperçu texte |
| `ged-note-word-test-guide.docx` | Word minimal sans macro | Office : pas d'aperçu |
| `ged-faux-pdf-test-guide.pdf` | simple texte renommé en `.pdf` | extension trompeuse |
| `ged-fichier-vide-test-guide.pdf` | 0 octet | fichier vide |
| `ged-facture.exe.pdf` | vrai PDF au nom piégé (extension intermédiaire `.exe`) | nom refusé |

Fichier trop lourd (à produire sur le poste, 30 Mo, supérieur aux 15 Mo de départ) : dans PowerShell, `$f=[IO.File]::Create("ged-trop-lourd-test-guide.pdf"); $f.SetLength(31457280); $f.Close()` ; le supprimer ensuite.

## Comptes

| Rôle | E-mail | Rôle dans ce chapitre |
|---|---|---|
| Secrétariat | `secretariat@secondaire-test.test` | dépose, partage, lit l'historique (niveau « Restreint ») |
| Propriétaire | `direction.generale@secondaire-test.test` | lit tout (confidentiel), catégories, paramètres, quarantaine, restaure |
| Directeur des études | `etudes@secondaire-test.test` | archive (le secrétariat ne le peut pas) |
| Économe | `econome@secondaire-test.test` | dépose et lit (niveau « Restreint »), ne partage pas, n'archive pas |
| Enseignant (TRAORE Kouadio) | `enseignant@secondaire-test.test` | niveau « Interne », son dossier de personnel, partages reçus |
| Parent (DIABATE Séka) | `parent@secondaire-test.test` | dépose et lit les pièces de Nadia et Salimata DIABATE |
| Élève (Nadia) | `eleve@secondaire-test.test` | dépose et lit ses propres pièces |
| Responsable pédagogique, chargé d'admissions | `pedagogie@…`, `admissions@secondaire-test.test` | lecture « Interne » seulement ; aucun accès |

Mots de passe et codes de double authentification : jamais dans ce guide (clic sur le compte dans `/login`).

## Droits

Source : `apps/api/src/modules/rbac/templates/system-roles.ts`, `apps/api/src/modules/documents/domain/policy.ts` et gardes des pages. Une permission refusée envoie vers la page « Accès refusé » (`/unauthorized`) ; un document non visible répond **la même chose qu'un document inexistant** : "Document introuvable (`<identifiant>`).".

| Écran | Adresse | Permission | Rôles |
|---|---|---|---|
| Explorateur | `/v2/documents` | une permission de lecture du module | secrétariat, propriétaire, directeur, directeur des études, économe, responsable pédagogique, responsable des examens, enseignant, éducateur, parent, élève |
| Fiche d'un document | `/v2/documents/<identifiant>` | idem + droit sur ce document | idem |
| Recherche dans les PDF | `/v2/documents/search` | idem | idem |
| Échéances | `/v2/documents/expirations` | idem | idem |
| Catégories | `/v2/documents/categories` | `documents.category.manage` | propriétaire, directeur |
| Quarantaine | `/v2/documents/quarantine` | `documents.quarantine.manage` | propriétaire, directeur |
| Paramètres | `/v2/documents/settings` | `documents.settings.manage` | propriétaire, directeur |

Niveaux de lecture : « Interne » (`documents.read`), « Restreint » (`documents.read.restricted`), « Confidentiel » (`documents.read.confidential`, propriétaire et directeur seulement). Déposer : secrétariat, directeur des études, économe (dans les catégories de leur niveau), propriétaire/directeur (partout) ; enseignant et éducateur pour leur propre dossier ; parent pour ses enfants ; élève pour lui-même, **seulement dans une catégorie dont « La personne concernée ou son tuteur peut déposer » est cochée**. Partager : secrétariat, directeur des études, propriétaire, directeur. Archiver : directeur des études, propriétaire, directeur. Restaurer : propriétaire, directeur. Historique : ceux-là + le déposant.

Adresses à taper à la main, qui doivent être **refusées** (page « Accès refusé ») :

| Compte | Adresses | Résultat attendu |
|---|---|---|
| Enseignant | `/v2/documents/categories`, `/v2/documents/quarantine`, `/v2/documents/settings` | « Accès refusé » |
| Secrétariat, économe | `/v2/documents/categories`, `/v2/documents/quarantine`, `/v2/documents/settings` | « Accès refusé » |
| Chargé d'admissions | `/v2/documents`, `/v2/documents/search`, `/v2/documents/expirations` | « Accès refusé » |
| Directeur des études | `/v2/documents/settings`, `/v2/documents/quarantine` | « Accès refusé » |

## Données de départ

Aucun document, aucune échéance, aucun partage. 17 catégories (`apps/api/src/modules/documents/domain/default-categories.ts`) : élève (4) "Pièces d'identité de l'élève", "Dossier d'inscription", "Dossier médical", "Scolarité antérieure" ; personnel (4) "Pièces d'identité du personnel", "Contrats de travail", « Diplômes et attestations », "Habilitations et autorisations" ; établissement (3) "Règlement intérieur et chartes", "Agréments et pièces légales", "Assurances" ; académique (3) "Programmes et référentiels", "Calendriers et circulaires", "Pièces académiques d'élèves" ; financier (3) "Factures et justificatifs", "Preuves de paiement", "Pièces comptables". Paramètres de départ : fichier 15 Mo, seuils d'alerte 30, 7, 1 jours, conservation après archivage 0 (jamais purgé), quarantaine 30 jours, 50 versions par document.

---

## Scénarios

#### 14.1 Découvrir l'explorateur, les menus et les catégories de départ
Compte : secrétariat, puis propriétaire · Où : menu « Documents » (`/v2/documents`) puis `/v2/documents/categories` · Prérequis : aucun.
1. Secrétariat : ouvrir `/v2/documents`. Lire le titre « Documents », la barre de section (« Documents », « Recherche dans les PDF », « Échéances ») et les boutons « Recherche dans le contenu », « Échéances », « Déposer un document ». Relever les menus latéraux « Documents » et "Documents à échéance".
2. Relever les filtres : « Rechercher », « Catégorie », « Type de document », « Portée », « Échéance », « Concerne ». Le filtre « État » est **absent** pour le secrétariat.
3. Ouvrir la liste « Catégorie » : 17 catégories.
4. Propriétaire : ouvrir `/v2/documents/categories`. Lire les cinq groupes (« Dossier d'élève », « Dossier du personnel », « Établissement », « Académique », « Financier »), la note « Changer le niveau de confidentialité d'une catégorie change aussitôt qui peut voir ses documents. », et les badges de "Assurances" (« Restreint », « Échéance obligatoire »), "Dossier médical" (« Confidentiel », « Lisible par les tuteurs », « Dépôt par la personne concernée »), "Règlement intérieur et chartes" (« Interne »).
5. Propriétaire : relever aussi les entrées « Catégories », « Quarantaine », « Paramètres » de la barre de section.
Résultat attendu : étape 1 : « Aucun document ne correspond. » et un texte d'aide invitant à déposer un premier document ; aucune erreur. Étape 4 : 4, 4, 3, 3 et 3 catégories ; chaque catégorie affiche son code en police fixe (par exemple `INSTITUTION_INSURANCE`), ses extensions ("Assurances" : .pdf .jpg .jpeg .png .webp) et "aucun document". La barre de section du secrétariat ne contient ni « Catégories », ni « Quarantaine », ni « Paramètres ».
- [ ] Cas nominal  - [ ] Droit refusé pour le secrétariat (14.18)

#### 14.2 Déposer un document de niveau « Interne »
Compte : secrétariat · Où : `/v2/documents` > « Déposer un document » · Prérequis : 14.1.
1. Cliquer « Déposer un document » (fenêtre « Déposer un document »).
2. Remplir :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Catégorie | "Règlement intérieur et chartes" | oui |
   | Fichier | `ged-document-test-guide-v1.pdf` | oui |
   | Titre | `Règlement intérieur test guide` (200 caractères au plus) | non (vide : nom du fichier sans extension) |
   | Description | `Document de démonstration` (2000 au plus) | non |
   | Étiquettes | `test guide, règlement` (séparées par des virgules, 20 au plus) | non |
   | Date d'expiration | (vide) | non pour cette catégorie |
   | Visibilité | « Selon la catégorie » | non |
3. Cliquer « Déposer ».
Résultat attendu : la page du document s'ouvre (`/v2/documents/<identifiant>`). Badges « Établissement », « Interne », et « Texte en cours de lecture » (puis « Texte cherchable » après 1 à 2 minutes et rechargement). Informations : « Catégorie » Règlement intérieur et chartes, « Personne concernée » Établissement, « Déposé par » le compte du secrétariat, « Échéance » « Aucune échéance », « Fichier actuel » `ged-document-test-guide-v1.pdf` avec sa taille, « Étiquettes » `test guide, règlement`, « Empreinte SHA-256 » (64 caractères). Section "1 version" : « Version 1 · version actuelle » avec le badge « Non analysé ». Boutons « Télécharger », « Nouvelle version », « Modifier » ; **pas** de bouton « Archiver ». Section « Partages » : « Ce document n'est partagé avec personne. » ; section « Historique » : « Document déposé ». Dans la liste `/v2/documents`, la ligne affiche le titre, la catégorie, le fichier et sa taille, sans badge de niveau (« Interne » n'est pas badgé en liste).
Variante : déposer `ged-note-de-service-test-guide.txt` sans titre dans la même catégorie : le titre devient `ged-note-de-service-test-guide`.
- [ ] Cas nominal  - [ ] Droit refusé : le responsable pédagogique n'a pas le bouton « Déposer un document »

#### 14.3 Jeux invalides au dépôt
Compte : secrétariat · Où : « Déposer un document » · Prérequis : 14.2.
Pour chaque ligne, ouvrir la fenêtre, saisir, cliquer « Déposer » :

| Saisie | Message attendu |
|---|---|
| Aucun fichier choisi | Choisissez un fichier. |
| Aucune catégorie choisie | Choisissez une catégorie. |
| Catégorie "Pièces d'identité de l'élève", aucun élève | Indiquez la personne concernée. |
| Catégorie "Assurances" sans date d'expiration | La date d'expiration est obligatoire pour cette catégorie. |
| `ged-fichier-vide-test-guide.pdf` | Le fichier ‹ ged-fichier-vide-test-guide.pdf › est vide. (refus à la sélection) |
| `ged-note-word-test-guide.docx` dans "Assurances" | Le fichier ‹ ged-note-word-test-guide.docx › n'a pas un format accepté (pdf, jpg, jpeg, png, webp). (refus à la sélection) |
| `ged-faux-pdf-test-guide.pdf` dans "Règlement intérieur et chartes" | Le contenu du fichier ne correspond pas à l'extension ‹ .pdf › (contenu réel : texte). |
| `ged-facture.exe.pdf` | Nom de fichier refusé (extension intermédiaire dangereuse). |
| fichier de 30 Mo | Le fichier ‹ ged-trop-lourd-test-guide.pdf › dépasse la taille maximale (15 Mo). (refus à la sélection) |
| `ged-document-test-guide-v1.pdf` une seconde fois, même catégorie, sans personne | Ce fichier existe déjà dans cette catégorie pour cette personne. |

Résultat attendu : chaque refus laisse la liste inchangée (aucun document créé). Le contrôle du type porte sur le **contenu réel** : le faux PDF est refusé même avec la bonne extension, le type MIME déclaré par le navigateur n'est jamais utilisé. Le doublon (déjà noté C-04-02 : il répondait par une erreur 500, corrigé en 409) doit afficher le message ci-dessus et non « Une erreur est survenue. Veuillez réessayer. ».
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : aucune catégorie confidentielle n'est proposée (14.10)

#### 14.4 Pièce à échéance obligatoire, pièce échue et écran des échéances
Compte : secrétariat · Où : « Déposer un document », puis `/v2/documents/expirations` · Prérequis : 14.3.
1. Déposer dans "Assurances" (le texte « Cette catégorie exige une date d'expiration. » est affiché) : Titre `Attestation d'assurance test guide`, fichier `ged-image-test-guide.png`, « Date d'expiration » = **aujourd'hui + 20 jours**.
2. Déposer dans "Assurances" : Titre `Assurance échue test guide`, fichier `ged-document-test-guide-v1.pdf`, « Date d'expiration » = **hier**.
3. Ouvrir « Échéances » (`/v2/documents/expirations`, titre « Échéances des documents »). Relever l'« Horizon » (30 jours au départ), les trois compteurs, les onglets « À échoir », « Échus », « Sans échéance ».
4. Passer l'« Horizon » à "15 jours".
5. Dans l'explorateur, essayer le filtre « Échéance » (« À échoir bientôt », « Échues », « Avec une échéance », « Échéance manquante »).
Résultat attendu : étape 1 : badge "Expire dans 20 jours" ; étape 2 : badge « Échu le `<date d'hier>` » (une date passée est acceptée au dépôt). Étape 3 : « À échoir sous 30 jours » = 1, « Échus » = 1, « Sans échéance (exigée) » = 0 ; l'onglet « À échoir » liste l'attestation, « Échus » l'assurance échue. Étape 4 : le compteur devient « À échoir sous 15 jours » = 0 et l'onglet affiche « Aucun document n'arrive à échéance dans cet horizon. ». Onglet « Sans échéance » vide : « Aucun document sans échéance exigée. » (le remplir : 14.15). Les alertes à 30, 7 et 1 jours sont émises par un job quotidien : non visibles ici.
Cas invalides : voir 14.3 (date obligatoire).
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le chargé d'admissions (14.18)

#### 14.5 Nouvelle version d'un document
Compte : secrétariat · Où : fiche de "Règlement intérieur test guide" > « Nouvelle version » · Prérequis : 14.2.
1. Cliquer « Nouvelle version » (fenêtre « Déposer une nouvelle version » : « La version 2 remplacera la version actuelle ; les versions précédentes restent consultables. »).
2. Remplir :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Nouveau fichier | `ged-document-test-guide-v2.pdf` | oui |
   | Note de version | `Mise à jour test guide` (500 au plus) | non |
   | Nouvelle date d'expiration | (vide : l'échéance actuelle est conservée) | non pour cette catégorie |
3. Cliquer « Déposer la version ».
4. Cliquer « Télécharger la version 1 », puis « Télécharger la version 2 ».
Résultat attendu : section "2 versions" : « Version 2 · version actuelle » (avec sa note) et « Version 1 » ; « Fichier actuel » devient `ged-document-test-guide-v2.pdf` ; le titre ne change pas ; la liste affiche "2 versions" ; les deux fichiers se téléchargent ; l'historique ajoute « Nouvelle version déposée (version 2) ». Le texte cherchable de la version 1 est effacé aussitôt (voir 14.8).
Cas invalides :

| Saisie | Message attendu |
|---|---|
| Aucun fichier, clic « Déposer la version » | Choisissez un fichier. |
| Le fichier identique à la version actuelle (`ged-document-test-guide-v2.pdf` de nouveau) | Ce fichier est identique à la version actuelle. |
| Fichier `ged-faux-pdf-test-guide.pdf` | Le contenu du fichier ne correspond pas à l'extension ‹ .pdf › (contenu réel : texte). |

- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : le responsable pédagogique (lecture seule) n'a pas « Nouvelle version »

#### 14.6 Aperçu, téléchargement, historique ; types de fichiers
Compte : secrétariat · Où : fiches de documents · Prérequis : 14.5.
1. Déposer dans "Règlement intérieur et chartes" : `Image test guide` (`ged-image-test-guide.png`), `Note de service test guide` (`ged-note-de-service-test-guide.txt`), `Note Word test guide` (`ged-note-word-test-guide.docx`).
2. Sur "Règlement intérieur test guide" : cliquer « Prévisualiser la version 2 », puis « Prévisualiser la version 1 ».
3. Sur `Image test guide`, `Note de service test guide` puis `Note Word test guide` : cliquer « Prévisualiser la version 1 ».
4. Sur "Règlement intérieur test guide" : « Télécharger ». Descendre à « Historique ».
Résultat attendu : PDF : section « Aperçu de la version 2 » avec le PDF dans un cadre ; image : l'image 64 x 48 affichée (texte alternatif « Aperçu de ged-image-test-guide.png ») ; texte : le contenu dans un bloc ; Word : **pas d'aperçu**, le message de l'API "La prévisualisation des documents Office n'est pas activée : téléchargez le fichier." (la fonction d'aperçu Office est désactivée par défaut), avec un bouton « Réessayer » ; le fichier se télécharge normalement. Historique (le plus récent en premier, avec auteur et date) : « Document déposé », « Nouvelle version déposée », « Prévisualisé » (versions 1 et 2), « Téléchargé », et des « Consulté » à l'ouverture de la fiche.
- [ ] Cas nominal  - [ ] Cas invalide (Word)  - [ ] Droit refusé : le responsable pédagogique ne voit pas la section « Historique »

#### 14.7 Modifier les informations d'un document
Compte : secrétariat · Où : fiche de `Note de service test guide` > « Modifier » · Prérequis : 14.6.
1. Cliquer « Modifier » (fenêtre « Modifier le document » : « Modifier les informations ne change pas le fichier : pour le remplacer, déposez une nouvelle version. »).
2. Changer « Titre » en `Note de service modifiée test guide`, « Étiquettes » en `test guide, note`, « Description » en `Texte brut`, puis « Enregistrer ».
3. Rouvrir « Modifier », choisir « Visibilité » « Personnel seulement » puis « Enregistrer ».
4. Ouvrir « Modifier » sur le document de 14.4 (assurance), vider « Date d'expiration », « Enregistrer ».
Résultat attendu : le titre et les étiquettes changent sur la fiche et dans la liste (aucun message flash : la fenêtre se ferme) ; le badge « Personnel seulement » apparaît ; l'historique ajoute « Informations modifiées ». Étape 4 : refus « Cette catégorie exige une date d'expiration. ».
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : les rôles sans dépôt (responsable pédagogique) n'ont pas « Modifier »

#### 14.8 Recherche dans l'explorateur et dans le contenu des PDF
Comptes : propriétaire, puis secrétariat, économe, enseignant · Où : `/v2/documents` et `/v2/documents/search` (« Recherche dans les PDF ») · Prérequis : 14.5 ; déposer d'abord, en propriétaire, `Pièce comptable test guide` (14.10) et `Scan sans texte test guide` (`ged-page-sans-texte-test-guide.pdf`, catégorie "Règlement intérieur et chartes") ; attendre 2 minutes.
1. `/v2/documents` : saisir `guide` dans « Rechercher », puis le nom d'un fichier, une étiquette, puis `DIABATE` (propriétaire d'une pièce, 14.12).
2. `/v2/documents/search` : le message « Saisissez des mots à chercher » ; saisir `b` (1 caractère) ; puis `palmierversion2deux` ; puis `baobabcertif2026` ; puis `piece comptable fictive` (sans accent) ; puis `"Pièce comptable fictive"` (expression exacte) ; puis `contenu -caissecompta2026` ; puis `caissecompta2026` avec le filtre « Catégorie » "Pièces comptables".
3. Ouvrir la fiche de `Scan sans texte test guide` et de `Règlement intérieur test guide`.
4. Répéter `caissecompta2026` en secrétariat, en économe, en enseignant.
5. Propriétaire : lire le bloc « Index du texte des PDF » (compteurs « En attente », « Cherchables », « Sans texte (scans) », « Illisibles »), cliquer « Relancer les échecs », puis « Tout réindexer » > « Oui, tout réindexer » (une confirmation d'identité forte peut être demandée).
Résultat attendu : étape 2 : « Saisissez au moins 2 caractères. » pour 1 caractère ; `palmierversion2deux` trouve "Règlement intérieur test guide" avec l'extrait surligné ; **`baobabcertif2026` ne trouve plus rien** (« Aucun document ne contient ces mots. » : le texte de la version 1 a été effacé à l'arrivée de la version 2) ; la recherche ignore accents et majuscules ; `contenu -caissecompta2026` retrouve le règlement mais pas la pièce comptable. Étape 3 : `Scan sans texte test guide` porte le badge « Sans texte » et l'avis « Ce PDF ne contient pas de texte (probablement un scan) : il n'est pas cherchable par son contenu. Il n'y a pas de reconnaissance de caractères. » ; le règlement porte « Texte cherchable ». Étape 4 : **aucun résultat** pour secrétariat, économe et enseignant (la pièce est confidentielle) et aucun indice de son existence. Étape 5 : message "0 PDF remis en file de lecture." ou "N PDF remis en file de lecture." ; seule la gestion voit ce bloc. Un document déposé à l'instant mettant une minute à être cherchable, un premier essai peut être vide : réessayer.
Cas invalides : un seul caractère (message ci-dessus) ; un PDF protégé par mot de passe ou abîmé donnerait « Texte illisible » (non fourni ici).
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : aucun résultat sur le niveau supérieur au sien

#### 14.9 Partager un document avec une personne, puis retirer le partage
Comptes : secrétariat, enseignant · Où : fiche de `Attestation d'assurance test guide` > « Partages » · Prérequis : 14.4 ; l'enseignant a un compte du portail (seules les personnes ayant un compte sont trouvées).
1. Secrétariat : dans « Partages », champ « Partager avec », saisir `TRAORE` (2 caractères au moins) et choisir TRAORE Kouadio. « Droit accordé » : « Lecture » ; « Fin du partage » vide ; « Note » `Pour information test guide` ; cliquer « Partager ».
2. Enseignant : `/v2/documents`, « Portée » « Partagés avec moi », ouvrir le document, « Télécharger ». Chercher « Nouvelle version » et « Modifier ».
3. Secrétariat : cliquer « Retirer le partage de TRAORE Kouadio » (bouton « Retirer »). Enseignant : recharger l'explorateur, puis rouvrir l'adresse de la fiche.
4. Secrétariat : repartager avec « Droit accordé » « Lecture et dépôt de versions » ; l'enseignant doit alors voir « Nouvelle version » et « Modifier » ; retirer de nouveau.
Résultat attendu : étape 1 : message « Document partagé avec TRAORE Kouadio. » et la ligne "Lecture · sans date de fin · Pour information test guide". Étape 2 : le document « Restreint » est visible de l'enseignant malgré son niveau « Interne », téléchargeable, sans « Nouvelle version » ni « Modifier ». Étape 3 : le document disparaît des listes de l'enseignant et son adresse répond "Document introuvable (`<identifiant>`).". Historique : « Partagé » puis « Partage retiré ».
Cas invalides :

| Saisie | Message attendu |
|---|---|
| Partager avec soi-même (le secrétariat se cherche) | Vous ne pouvez pas partager un document avec vous-même. |
| « Fin du partage » = hier | La date de fin du partage doit être dans le futur. |
| Aucune personne choisie | le bouton « Partager » reste désactivé |

Rappel (déjà noté C-04-07, non traité) : partager un document « Personnel seulement » avec un tuteur ne produit aucun avertissement.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : l'économe ne voit pas la section « Partages » (pas de droit de partage)

#### 14.10 Niveaux de confidentialité selon le rôle
Comptes : propriétaire, secrétariat, économe, enseignant, responsable pédagogique, parent · Où : `/v2/documents` · Prérequis : documents des scénarios 14.2 (Interne) et 14.4 (Restreint).
1. Propriétaire : déposer `Pièce comptable test guide` : « Catégorie » "Pièces comptables", « Document concernant » « Aucune personne (établissement) », fichier `ged-comptable-test-guide.pdf`.
2. Pour chaque compte du tableau, ouvrir `/v2/documents` avec la « Portée » « Tout ce que je peux voir » et noter ce qui est listé.
3. Secrétariat et économe : ouvrir « Déposer un document » et lire la liste « Catégorie ».
Résultat attendu :

| Compte | `Règlement intérieur test guide` (Interne) | `Attestation d'assurance test guide` (Restreint) | `Pièce comptable test guide` (Confidentiel) |
|---|---|---|---|
| Propriétaire, directeur | oui | oui | oui |
| Directeur des études, secrétariat, économe | oui | oui | non |
| Enseignant, éducateur, responsable pédagogique, responsable des examens | oui | non (sauf partage 14.9) | non |
| Parent, élève | non | non | non |

Le secrétariat et l'économe ne se voient pas proposer "Dossier médical", "Contrats de travail", "Pièces comptables" au dépôt (14 catégories sur 17). Le badge « Confidentiel » apparaît en liste.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour les rôles du tableau

#### 14.11 Lecture auditée d'un document confidentiel
Compte : propriétaire · Où : fiche de `Pièce comptable test guide` · Prérequis : 14.10.
1. Ouvrir la fiche (une confirmation d'identité peut apparaître pour une permission sensible).
2. Cliquer « Prévisualiser la version 1 », puis « Télécharger ».
3. Lire « Historique ».
4. Ouvrir `/v2/audit` et chercher les lectures de documents.
Résultat attendu : l'historique montre « Consulté », « Prévisualisé » et « Téléchargé » avec l'auteur et l'heure ; le journal d'audit contient les lectures (celles d'un document confidentiel sont marquées sensibles) **sans** titre de document ni nom de fichier (README du module ; vérification dans le journal : à vérifier en test).
- [ ] Cas nominal  - [ ] Droit refusé : le secrétariat ne peut pas ouvrir cette fiche (14.18)

#### 14.12 Dépôts par un parent, un élève et un enseignant
Comptes : parent, élève, enseignant, secrétariat · Où : `/v2/documents` (taper l'adresse : aucune entrée de menu GED n'existe dans ces portails, voir Écarts) · Prérequis : aucun.
Leçon des rapports (C-12-06) : l'onglet « Documents » de la fiche d'un enfant du portail parent est en lecture seule ; en revanche, l'explorateur `/v2/documents` **permet** au parent de déposer, car les rôles « Parent » (`documents.child.upload`), « Élève » (`documents.self.upload`) et « Enseignant » (`documents.own.upload`) le portent et la catégorie le permet.
1. Parent : `/v2/documents`. Lire les options de « Portée » (« Tout ce que je peux voir », « Mes dépôts », « Partagés avec moi », « Mes enfants »). Cliquer « Déposer un document ».
2. Remplir :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Catégorie | "Pièces d'identité de l'élève" | oui |
   | Fichier | `ged-image-test-guide.png` | oui |
   | Enfant concerné | `DIABATE Nadia` (liste : Nadia et Salimata seulement) | oui |
   | Titre | `Extrait de naissance Nadia test guide` | non |
3. Cliquer « Déposer ».
4. Élève : déposer dans "Pièces d'identité de l'élève" ("Document concernant : DIABATE Nadia") `ged-document-test-guide-v1.pdf`, titre `Pièce Nadia déposée par l'élève test guide`.
5. Enseignant : déposer dans « Diplômes et attestations » `ged-image-test-guide.png`, titre `Diplôme enseignant test guide` (rattaché automatiquement à lui-même), puis ouvrir la « Portée » « Mon dossier de personnel ». Ouvrir « Déposer un document » et lire les catégories proposées.
6. Secrétariat : filtrer « Concerne » « Élève », « Personne concernée » `DIABATE Nadia` ; puis « Concerne » « Personnel », `TRAORE Kouadio`.
7. Secrétariat : déposer pour `DIABATE Salimata` dans "Dossier d'inscription", fichier `ged-document-test-guide-v1.pdf`, titre `Pièce élève Salimata test guide`. Parent : recharger.
Résultat attendu : le parent choisit un enfant parmi Nadia et Salimata DIABATE (jamais un autre élève) ; le document s'ouvre, il est visible dans « Mes enfants » ; l'élève voit sa pièce et celle du parent (audience « La personne concernée peut lire ») ; l'enseignant voit son diplôme dans « Mon dossier de personnel » ; le secrétariat voit les trois pièces (niveau « Restreint ») ; le parent voit la pièce de Salimata déposée par le secrétariat (la catégorie est « Lisible par les tuteurs »). La liste de catégories de dépôt du parent ne devrait contenir que les catégories d'élève déposables par le tuteur ; **si des catégories du personnel sont proposées au parent ou des catégories d'élève à l'enseignant, le dépôt échoue** : à consigner (voir À vérifier).
Cas invalides :

| Saisie | Message attendu |
|---|---|
| Enseignant : chercher "Contrats de travail" dans la liste « Catégorie » du dépôt | catégorie non proposée (dépôt par la direction seulement) |
| Parent : chercher "Pièces comptables" dans la liste « Catégorie » du dépôt | catégorie non proposée |

- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : le parent n'a pas « Partager » ni « Archiver »

#### 14.13 Visibilité « Personnel seulement » et « Privé »
Comptes : secrétariat, parent, élève, économe, enseignant · Où : fiche de `Pièce élève Salimata test guide` > « Modifier » · Prérequis : 14.12.
1. Secrétariat : « Modifier » > « Visibilité » « Personnel seulement » > « Enregistrer ». Parent : recharger « Mes enfants ». Économe : ouvrir l'adresse de la fiche.
2. Secrétariat : « Visibilité » « Privé ». Économe : rouvrir la fiche. Propriétaire : rouvrir la fiche.
3. Secrétariat : revenir à « Selon la catégorie ».
Résultat attendu : étape 1 : le parent ne voit plus la pièce (le texte « Modifier la visibilité change aussitôt qui peut voir ce document. » est affiché dans la fenêtre) ; l'économe la voit toujours (niveau « Restreint »). Étape 2 : « Privé » la réserve au déposant, aux gestionnaires (propriétaire) et aux personnes avec qui elle est partagée : l'économe obtient "Document introuvable (`<identifiant>`)." ; le propriétaire la voit. Étape 3 : le parent la revoit.
- [ ] Cas nominal  - [ ] Droit refusé : parent (visibilité modifiée) et économe (« Privé »)

#### 14.14 Archiver et restaurer
Comptes : directeur des études, secrétariat, propriétaire · Où : fiche de `Image test guide` · Prérequis : 14.6.
1. Secrétariat : constater l'absence du bouton « Archiver ».
2. Directeur des études : ouvrir la fiche, cliquer « Archiver » (fenêtre « Archiver ce document » : « Le document disparaît des listes ; la gestion peut le restaurer jusqu'à l'échéance de conservation, après quoi il est purgé. »). Saisir « Motif de l'archivage » `ab`, puis `Doublon de test test guide`, cliquer « Archiver ».
3. Recharger l'explorateur (secrétariat et directeur des études).
4. Propriétaire : filtre « État » « Archivés » ; ouvrir le document ; cliquer « Restaurer ».
Résultat attendu : motif de 2 caractères : « Le motif doit comporter au moins 3 caractères. » ; message « Document archivé : il n'apparaît plus dans les listes. » ; le document disparaît de la liste « Actifs » et son adresse répond "Document introuvable (`<identifiant>`)." pour tous sauf la gestion (la conservation par défaut est "jamais purgé" : 0 jour). Propriétaire : avis « Ce document est archivé. Motif : Doublon de test test guide » ; après « Restaurer » : « Document restauré. » ; l'historique garde « Archivé » et « Restauré ». Un document archivé n'accepte ni nouvelle version, ni partage.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : secrétariat et économe sans « Archiver », restauration réservée au propriétaire

#### 14.15 Catégories : créer, modifier, droit par personne, échéance exigée, archiver
Compte : propriétaire (puis enseignant) · Où : `/v2/documents/categories` · Prérequis : 14.1.
1. Cliquer « Nouvelle catégorie » :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Code | `TG_CATEGORIE` (majuscules, chiffres, `_`, 2 à 40 caractères ; ne changera plus) | oui |
   | Type de document | « Établissement » | oui |
   | Libellé | `Catégorie test guide` (120 au plus) | oui |
   | Description | `Catégorie de test du guide` | non |
   | Niveau de confidentialité | « Confidentiel (direction) » | non (départ « Restreint (secrétariat, études, économat) ») |
   | Extensions acceptées | laisser .pdf .jpg .jpeg .png cochées | oui, au moins une |
   | Taille maximale (Mo) | (vide : taille de l'établissement) | non |
   | Date d'expiration obligatoire | décochée | non |
   | Seuils d'alerte (jours) | (vide) | non |
   | Conservation après archivage (jours) | (vide) | non |
2. Cliquer « Enregistrer » : la catégorie apparaît dans « Établissement ».
3. Déposer (propriétaire) dans "Catégorie test guide" : titre `Pièce de catégorie test guide`, fichier `ged-image-test-guide.png`.
4. Sur la ligne de la catégorie, cliquer « Droits par personne » (fenêtre « Droits par personne : Catégorie test guide »). « Personne » `TRAORE Kouadio`, « Droit accordé » « Lecture », « Accorder le droit ». Enseignant : `/v2/documents` : la pièce est visible (catégorie confidentielle). Propriétaire : « Retirer » (droit de TRAORE Kouadio) ; enseignant : recharger.
5. Cliquer « Modifier » sur la catégorie : cocher « Date d'expiration obligatoire », « Enregistrer » ; ouvrir `/v2/documents/expirations` onglet « Sans échéance ». Décocher ensuite.
6. Cliquer « Archiver » sur la catégorie, puis ouvrir « Déposer un document », puis « Restaurer ».
Résultat attendu : étape 4 : l'enseignant, qui ne lit pas le niveau confidentiel, voit la pièce tant que le droit existe ; après « Retirer », plus rien. Étape 5 : Le compteur « Sans échéance (exigée) » passe à 1 et la pièce est dans l'onglet « Sans échéance » ; le badge « Échéance obligatoire » apparaît sur la catégorie. Étape 6 : "Catégorie ‹ Catégorie test guide › archivée.", badge « Archivée », la catégorie n'est plus proposée au dépôt (une catégorie n'est jamais supprimée) ; puis "Catégorie ‹ Catégorie test guide › restaurée.". Les champs « Code » et « Type de document » ne sont plus modifiables après création.
Cas invalides (ouvrir « Nouvelle catégorie », cliquer « Enregistrer ») :

| Saisie | Message attendu |
|---|---|
| Code `TG-CAT` ou `T` | Code invalide : majuscules, chiffres et _ (2 à 40 caractères). |
| Code `TG_CATEGORIE` déjà créé | Le code ‹ TG_CATEGORIE › est déjà utilisé par une catégorie. |
| Libellé vide | Le libellé est obligatoire. |
| Toutes les extensions décochées | Choisissez au moins une extension. |
| Taille maximale `abc` | Taille invalide. |
| Seuils d'alerte `30, abc` | Seuils invalides : nombres entiers de 0 à 365 séparés par des virgules. |
| Droit avec « Fin du droit » = hier | La date de fin doit être dans le futur. |

- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le secrétariat, l'économe, l'enseignant (14.18)

#### 14.16 Paramètres de l'établissement et quota
Compte : propriétaire · Où : `/v2/documents/settings` · Prérequis : 14.5.
1. Lire « Stockage utilisé » (jauge, « `<utilisé>` utilisés sur `<quota>` (`<n>` %). », compteurs « Documents », « Versions », « Archivés », « En quarantaine », et "Quota de votre abonnement : …").
2. Lire « Réglages » : « Taille maximale d'un fichier (Mo) » `15`, « Quota de stockage de l'établissement (Mo) » vide, « Seuils d'alerte d'expiration (jours) » `30, 7, 1`, « Conservation après archivage (jours) » `0`, « Conservation de la quarantaine (jours) » `30`, « Versions maximales par document » `50`. Cliquer « Enregistrer » sans rien changer.
3. Mettre « Versions maximales par document » à `2`, « Enregistrer ». Sur "Règlement intérieur test guide" (2 versions), « Nouvelle version » avec `ged-comptable-test-guide.pdf`.
4. Remettre `50`, « Enregistrer ».
Résultat attendu : « Paramètres enregistrés. » ; la jauge tient compte des fichiers déposés (quelques Ko) ; étape 3 : refus "Ce document a atteint le nombre maximal de versions (2).". Aucun réglage laissé modifié.
Cas invalides :

| Saisie | Message attendu |
|---|---|
| Taille maximale `200` ou `0` | Taille invalide (100 Mo au plus). |
| Quota `abc` | Quota invalide. |
| Seuils `30, abc` | Seuils invalides : nombres entiers de 0 à 365 séparés par des virgules. |
| Conservation après archivage `-1` ou `4000` | Durée invalide (0 à 3650). |
| Conservation de la quarantaine `0` | Durée invalide (1 à 365). |
| Versions maximales `0` ou `501` | Nombre invalide (1 à 500). |

Aucun réglage n'est enregistré tant qu'un champ est invalide.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le secrétariat (14.18)

#### 14.17 Quarantaine (lecture)
Compte : propriétaire · Où : `/v2/documents/quarantine` · Prérequis : aucun.
1. Lire le titre « Quarantaine des documents », l'avertissement « Libérer un fichier est une décision motivée, auditée et soumise à l'authentification forte : ne le faites qu'après vérification d'un faux positif. » et les onglets « En quarantaine », « Libérés », « Détruits », « Tous ».
2. Parcourir chaque onglet.
Résultat attendu : « Aucun fichier. » partout (aucun antivirus : aucun fichier n'est jamais détecté ni mis en quarantaine). Le compteur « En quarantaine » de `/v2/documents/settings` vaut 0. Avec un antivirus actif, chaque fichier retenu proposerait « Libérer » et « Détruire » avec un motif d'au moins 3 caractères : **non testable ici**.
- [ ] Cas nominal  - [ ] Droit refusé pour le secrétariat et l'enseignant (14.18)

#### 14.18 Droits, documents hors périmètre et isolation entre établissements
Comptes : voir tableau "Droits", parent, enseignant, directeur des Palmiers · Prérequis : 14.12.
1. Taper les adresses du tableau "Droits" ci-dessus pour chaque compte.
2. Secrétariat : déposer `Pièce élève Aya BAMBA test guide` ("Dossier d'inscription", élève `BAMBA Aya`, fichier `ged-image-test-guide.png`). Copier l'adresse de la fiche.
3. Parent (enfants Nadia et Salimata) puis enseignant : coller cette adresse. Taper aussi `/v2/documents/00000000-0000-0000-0000-000000000000` et `/v2/documents/abc`.
4. Directeur des Palmiers (`directeur@primaire-test.test`) : coller l'adresse d'un document du Collège (par exemple celle de `Règlement intérieur test guide`).
Résultat attendu : étape 1 : « Accès refusé » ("Vous n'avez pas les droits nécessaires pour afficher cette page."). Étape 3 : parent, enseignant et identifiant inventé donnent **la même réponse** : "Document introuvable (`<identifiant>`)." (rien ne révèle l'existence de la pièce) ; l'identifiant `abc` n'est pas un UUID : message de validation de l'API, à relever en test. Étape 4 : "Document introuvable (`<identifiant>`).", aucune donnée du Collège.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé

---

## Données créées

Documents (Collège Le Baobab) : `Règlement intérieur test guide` (2 versions) ; `Image test guide` ; `Note de service test guide` (renommé `Note de service modifiée test guide`) ; `Note Word test guide` ; `Scan sans texte test guide` ; `Attestation d'assurance test guide` ; `Assurance échue test guide` ; `Pièce comptable test guide` ; `Extrait de naissance Nadia test guide` ; `Pièce Nadia déposée par l'élève test guide` ; `Diplôme enseignant test guide` ; `Pièce élève Salimata test guide` ; `Pièce élève Aya BAMBA test guide` ; `Pièce de catégorie test guide`. Catégorie `TG_CATEGORIE` (`Catégorie test guide`, restaurée). Partages et droits de catégorie créés puis retirés. Paramètres : remis à l'état de départ (15 Mo, 30/7/1, 0, 30, 50).

## Écarts constatés

| Écran | Constat | Gravité |
|---|---|---|
| Portails parent, élève, enseignant | Aucune entrée de menu vers `/v2/documents` : le manifeste du module déclare « Mes documents » et « Documents de mes enfants », mais les menus de portail sont statiques (`apps/web/src/platform/portal/menus.ts`). Un parent ne trouve pas où déposer. L'entrée « Mes documents » de l'élève (`/v2/student/documents`) est un autre écran (bulletins, factures). | Majeur |
| Fiche d'un document Word | Le bouton « Prévisualiser la version N » est proposé puis échoue avec "La prévisualisation des documents Office n'est pas activée…" ; le message plus doux "Aucune prévisualisation pour ce type de fichier" n'apparaît que pour un type sans aperçu possible (ancien guide erroné sur ce point). | Suggestion |
| Fenêtre de dépôt d'un parent ou d'un enseignant | `canUpload` d'une catégorie ne regarde pas le type de propriétaire : des catégories du personnel peuvent être proposées au parent, des catégories d'élève à l'enseignant, et le dépôt échoue ensuite (`policy.ts`, `UploadDialog.tsx`). À confirmer à l'écran. | Mineur |
| Historique d'un document | L'auteur peut s'afficher par identifiant de connexion plutôt que par nom (déjà noté sur le secrétariat). | Mineur |
| Fenêtre « Modifier le document » | Aucun message de confirmation après « Enregistrer » : la fenêtre se ferme. | Suggestion |
| Partage | Partager un document « Personnel seulement » avec un tuteur n'avertit pas (C-04-07, non traité). | Mineur |
| Annexe des données de départ | L'annexe ne mentionne aucun document ; le seed n'en crée aucun (conforme) mais l'explorateur est vide au départ. | Suggestion |

## À vérifier en test

- Présence d'un antivirus : si un service est branché, le badge devient « Analysé » et la quarantaine peut être testée (hors de ce guide).
- Contenu de la liste de catégories de dépôt du parent, de l'élève et de l'enseignant (écart ci-dessus).
- Message de l'API pour `/v2/documents/abc` (identifiant non UUID).
- Entrées d'audit des lectures de documents confidentiels (`/v2/audit`), sans titre ni nom de fichier.
- Entrée « Consulté » dans l'historique pour un document non confidentiel (le code l'enregistre pour toute ouverture).
- Archivage : message affiché au directeur des études sur la fiche d'un document qu'il vient d'archiver et qu'il ne peut plus ouvrir.
- Prévisualisation du texte et de l'image dans le navigateur piloté (cadre PDF éventuellement bloqué).
- Délai exact de l'indexation du texte (1 à 2 minutes attendues).

## Non couvert / limites connues

- Fichier infecté, mise en quarantaine, libération et destruction ; antivirus indisponible en mode "échec fermé".
- Aperçu des documents Office (fonction `documents.office-preview` désactivée par défaut).
- Purge automatique après la durée de conservation (job d'entretien) ; alertes d'expiration (job quotidien) ; quota d'abonnement atteint.
- Reconnaissance de caractères : un PDF scanné n'est pas cherchable ; pas de recherche dans les fichiers Office ni texte.
- Partage avec une personne extérieure à l'établissement, circuit de validation d'un dépôt de parent : n'existent pas.
- Pièces déjà stockées ailleurs (photos d'élèves, justificatifs d'absence, pièces de messagerie ou d'admission) : non reprises dans la GED.
