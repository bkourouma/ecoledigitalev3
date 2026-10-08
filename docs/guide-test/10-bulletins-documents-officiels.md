# Chapitre 10. Bulletins et documents officiels (émission, publication, PDF, vérification publique)

> Écrans couverts : `/v2/reportcards` (liste), `/v2/reportcards/<identifiant>` (fiche), `/v2/reportcards/issue` (émission), `/v2/reportcards/templates` (modèles), `/v2/reportcards/identity` (identité et réglages), `/v2/reportcards/signatories` (signataires), `/v2/reportcards/family` (famille), `/v2/verify`, `/v2/verify/<code>` et `/v2/verify/v/<code>` (vérification publique, sans connexion). Module serveur : `apps/api/src/modules/reportcards`.
>
> **URL réelles.** Le dossier `apps/web/src/app/v2/` est servi tel quel : l'adresse tapée dans le navigateur est `http://localhost:3000/v2/...` (aucun préfixe supplémentaire : ni `basePath`, ni réécriture de `/v2` dans `apps/web/next.config.js`, et `apps/web/middleware.ts` ne fait qu'ajouter des en-têtes de sécurité). La page de connexion est `http://localhost:3000/login`.

## Prérequis

- Les chapitres 08 (évaluations et notes) et 09 (règles et résultats) sont passés : le seed a publié les notes de la première période de chaque établissement puis l'a **clôturée** (résultats définitifs "figés" par le moteur de règles). Un bulletin est un instantané immuable de ces résultats clôturés : sans période clôturée, aucun bulletin définitif ne peut être émis. Les notes et moyennes affichées ici sont celles **déjà publiées et clôturées** aux chapitres 08 et 09 ; ce chapitre ne saisit et ne calcule aucune note.
- Le **worker** de fond doit tourner avec Chrome ou Chromium (il fabrique les PDF) et une clé de signature doit être configurée. Si tous les PDF restent « PDF en attente » ou passent « PDF en échec », arrêter le chapitre et prévenir l'équipe technique (ce n'est pas un défaut du guide).
- Les actions « Publier », « Réémettre », « Révoquer » et les écrans d'identité ou de signataires concernent des comptes **avec double authentification** (MFA, voir l'annexe 2) : ne jamais écrire le code dans les comptes rendus. Une fenêtre « Confirmez votre identité » (champ « Code à 6 chiffres ») peut s'ouvrir : utiliser le code du moment, puis continuer.
- Fenêtre de navigation privée disponible (vérification publique sans connexion).
- Les scénarios **10.14 à 10.16 (réémission, retrait, révocation)** sont **irréversibles** : les faire en dernier, une seule fois, sur le bulletin de TOURE Jean-Marc (secondaire) uniquement. Les bulletins de DIABATE Nadia et DIABATE Salimata servent aux chapitres des familles (parent, élève) : ne pas les modifier.

## Comptes à utiliser

| Rôle | Collège Le Baobab (`secondaire-test`) | École Les Palmiers (`primaire-test`) | Université Horizon (`superieur-test`) |
|---|---|---|---|
| Propriétaire (MFA) | `direction.generale@secondaire-test.test` | `direction.generale@primaire-test.test` | `direction.generale@superieur-test.test` |
| Directeur (MFA) | `directeur@secondaire-test.test` | `directeur@primaire-test.test` | `directeur@superieur-test.test` |
| Directeur des études (MFA) | `etudes@secondaire-test.test` | `etudes@primaire-test.test` | `etudes@superieur-test.test` |
| Secrétariat (MFA) | `secretariat@secondaire-test.test` | `secretariat@primaire-test.test` | `secretariat@superieur-test.test` |
| Responsable pédagogique (MFA) | `pedagogie@secondaire-test.test` | — | — |
| Enseignant / Instituteur | `enseignant@secondaire-test.test` | `enseignant@primaire-test.test` | — |
| Parent (tuteur n° 1, DIABATE Séka) | `parent@secondaire-test.test` | `parent@primaire-test.test` | — |
| Élève (compte de DIABATE Nadia) | `eleve@secondaire-test.test` | `eleve@primaire-test.test` | — |
| Visiteur sans connexion | fenêtre de navigation privée | idem | idem |

Mots de passe et codes MFA : voir l'annexe (jamais dans ce guide). Chaque établissement s'ouvre en cliquant sur le compte dans le panneau de droite de `/v2/login`.

## Droits

| Écran / action | Permission (garde de page) | Rôles qui l'ont (source : `apps/api/src/modules/rbac/templates/system-roles.ts`) |
|---|---|---|
| Liste et fiche d'un bulletin (`/v2/reportcards`, `/v2/reportcards/<identifiant>`), téléchargement du PDF | `reportcard.read` | Propriétaire, Directeur, Directeur des études, Secrétariat, Responsable pédagogique, Instituteur |
| Trace d'explicabilité (bouton « Afficher la trace ») | `reportcard.explain` | Propriétaire, Directeur, Directeur des études, Responsable pédagogique |
| Émettre un lot, réémettre, relancer un PDF (`/v2/reportcards/issue`) | `reportcard.generate` | Propriétaire, Directeur, Directeur des études, Secrétariat |
| Publier, retirer, publier la sélection ou le lot | `reportcard.publish` | Propriétaire, Directeur, Directeur des études (pas le Secrétariat) |
| Révoquer | `reportcard.revoke` | Propriétaire, Directeur |
| Modèles de documents (`/v2/reportcards/templates`) | `reportcard.template.manage` | Propriétaire, Directeur, Directeur des études |
| Identité et réglages (`/v2/reportcards/identity`) | `reportcard.branding.manage` | Propriétaire, Directeur |
| Signataires (`/v2/reportcards/signatories`) | `reportcard.signatory.manage` | Propriétaire, Directeur |
| Mes bulletins / bulletins de mes enfants (`/v2/reportcards/family`) | `reportcard.self.read` ou `reportcard.child.read` | Élève (siens, publiés) ; Parent (enfants liés, publiés) |
| Vérification publique (`/v2/verify...`) | aucune (page publique) | tout le monde, sans connexion |

Aucun droit sur les bulletins : Économe, Éducateur, Responsable des examens, Chargé d'admissions, Enseignant du secondaire.

**Adresses à taper à la main qui doivent être refusées** (résultat attendu : redirection vers `/unauthorized`, page « Accès refusé » avec le message "Vous n'avez pas les droits nécessaires pour afficher cette page." ; le menu n'offre d'ailleurs pas l'entrée) :

| Compte | Adresses |
|---|---|
| Parent ou Élève | `/v2/reportcards`, `/v2/reportcards/issue`, `/v2/reportcards/templates`, `/v2/reportcards/identity`, `/v2/reportcards/signatories` |
| Directeur des études | `/v2/reportcards/identity`, `/v2/reportcards/signatories` |
| Secrétariat | `/v2/reportcards/templates`, `/v2/reportcards/identity`, `/v2/reportcards/signatories`, `/v2/reportcards/family` |
| Responsable pédagogique | `/v2/reportcards/issue`, `/v2/reportcards/templates`, `/v2/reportcards/identity`, `/v2/reportcards/signatories` (constat du rapport de session 9 : `/v2/reportcards/issue` mène à `/unauthorized`) |
| Enseignant du secondaire | `/v2/reportcards`, `/v2/reportcards/family` |
| Aucun compte (non connecté) | `/v2/reportcards` : redirection vers `/login` |

## Données de départ (seed)

Source : `scripts/seed-v2/demo/reportcards.ts`, appelé par `scripts/seed-v2/demo/index.ts` pour chaque établissement.

| Établissement | Identité imprimée | Signataire | Modèle configuré | Bulletins émis |
|---|---|---|---|---|
| Collège Le Baobab | Nom officiel "Collège Le Baobab" (sans "(démonstration)"), en-tête gauche « République de Côte d'Ivoire (démonstration) », adresse "Abidjan, Côte d'Ivoire", couleur principale `#14532D` (version 1) | "Directeur Fictif", qualité "Chef d'établissement", fonction « Direction » | Bulletin, niveau Secondaire, `secondary-bulletin` (emplacement "Le Directeur" → Directeur Fictif) | Classe "6e A", période "Trimestre 1" : les 8 élèves notés (DIABATE Nadia et Salimata, BAMBA Aya et Fatou, COULIBALY Moussa et Salimata, TOURE Yao et Jean-Marc) et, d'après les rapports de session 4 et 9, un neuvième bulletin (ADOU Aïcha, admise par le module d'admissions) ; tous « Publié », « PDF prêt » |
| École primaire Les Palmiers | "École primaire Les Palmiers", mêmes mentions | "Directeur Fictif" | Bulletin, niveau Primaire, `primary-bulletin` (dernière version publiée : v2, rang et mention) | Classe "CP1 A", première période (le seed impose deux semestres : "Semestre 1", à vérifier), 8 bulletins publiés |
| Université Horizon | "Université Horizon", mêmes mentions | "Directeur Fictif" | Bulletin, niveau Supérieur, `higher-bulletin-credits` (emplacement "Le Directeur des études" → Directeur Fictif) | Classe "Licence 1 A", "Semestre 1" : relevés à crédits des 8 étudiants notés, publiés (8 ou 9 : à relever) |

- Les jeux de règles du secondaire et du primaire sont des **règles de démonstration** (`CI-SECONDARY-PLACEHOLDER`, `CI-PRIMARY-PLACEHOLDER`) : leurs PDF portent le filigrane "DÉMONSTRATION" et la mention "Règles de démonstration — document sans valeur officielle", et leur vérification publique le dit. Le supérieur utilise le jeu `CI-HIGHER-LMD` de la plateforme (source "platform") : ni filigrane ni mention de démonstration attendus (à vérifier en test, 10.13).
- Secondaire, "Trimestre 2" : notes publiées et verrouillées, période **non clôturée** (sert au scénario de blocage 10.9).
- Aucun relevé de notes cumulé n'existe (l'émission n'a pas d'écran, voir "Non couvert").

---

## Scénarios

### A. Configuration de l'établissement (direction)

#### 10.1 Identité de l'établissement et réglages des documents
Compte : Propriétaire (`direction.generale@secondaire-test.test`, MFA) · Où : menu "Bulletins" > "Identité et signataires" (`/v2/reportcards/identity`), ou rubrique « Identité et réglages » de la barre « Bulletins et documents » · Prérequis : aucun.
1. Ouvrir la page. Lire le titre « Identité de l'établissement et réglages » et la section « Identité visuelle ». Une ligne indique "Version 1 enregistrée le …" (une seule version au départ). Vérifier les valeurs du seed : « Nom officiel » = Collège Le Baobab, « En-tête gauche » = République de Côte d'Ivoire (démonstration), « Adresse » = Abidjan, Côte d'Ivoire, « Couleur principale » = `#14532D` avec une pastille verte à côté.
2. Remplir (les autres champs restent tels quels) :

   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Nom officiel | Collège Le Baobab (inchangé) | oui |
   | Téléphone | +225 27 21 00 00 00 | non |
   | Adresse électronique | contact@exemple.test | non |
   | Site internet | www.exemple.test | non |
   | Référence d'agrément | AGR-TG-0001 | non |
   | Pied de page | Document de démonstration test guide | non |
   | Logo | fichier `docs/guide-test/jeux-de-donnees/logo-test-guide.png` (bouton de sélection de fichier) | non |

3. Après le choix du logo, l'état « Téléversement… » puis « Téléversé » s'affiche à côté du champ, avec « Fichier enregistré : … » en aide. Cliquer « Enregistrer l'identité ».

Résultat attendu : message « L'identité est enregistrée (version 2). » ; la ligne devient "Version 2 enregistrée le …" ; le détail « 2 versions de l'identité » (à déplier) liste « Version 1 — Collège Le Baobab (…) » et « Version 2 — Collège Le Baobab (…) » avec le badge « En vigueur » sur la version 2 ; après rechargement de la page, les valeurs saisies sont toujours là. Les bulletins déjà émis ne changent pas (le pied de page ne figurera que sur les documents émis ou réémis après ce changement : contrôlé en 10.14).

Cas invalides :

| Saisie | Message attendu |
|---|---|
| « Nom officiel » vidé | « Ce champ est obligatoire. » sous le champ, rien n'est enregistré |
| « Couleur principale » = `vert` | "Couleur attendue au format #RRGGBB." (l'aide du champ dit « Format #RRGGBB. ») |
| « En-tête gauche » avec 9 lignes (une par ligne) | "Au plus 8 éléments." |
| « Logo » = `format-invalide-test-guide.txt` | « Format non accepté : PNG, JPEG, WebP ou GIF. » (aucun téléversement) |
| « Logo » = un PNG de plus de 2 Mo (à fabriquer : voir "Jeux de données") | « Le fichier dépasse 2 Mo. » |

4. Réglages (section « Réglages des documents », chaque case s'enregistre seule avec le message « Réglage enregistré. ») : lire « Exiger une délibération avant l'émission », « Afficher la mention sur la page publique de vérification » (décochée par défaut) et, si l'offre l'inclut, « Bloquer l'accès aux bulletins en cas d'impayé » (masquée si la fonction n'est pas dans l'offre : à vérifier).
5. Cocher « Exiger une délibération avant l'émission » ; ouvrir `/v2/reportcards/issue`, choisir "6e A" et "Trimestre 1" : un point « Bloquant » "La délibération (conseil de classe ou jury) n'a pas été tenue pour cette période." est attendu **si aucune séance n'a été tenue pour le Trimestre 1** (le seed ne tient de conseil que pour la période 2 : à vérifier). **Décocher ensuite la case** pour rétablir le réglage.

- [ ] Cas nominal (version 2 créée, valeurs persistées)  - [ ] Cas invalide (5 refus)  - [ ] Réglage enregistré puis rétabli  - [ ] Droit refusé pour Directeur des études (`/v2/reportcards/identity` → « Accès refusé »)

#### 10.2 Signataires : créer, modifier, désactiver, réactiver
Compte : Propriétaire (`direction.generale@secondaire-test.test`) · Où : `/v2/reportcards/signatories` (rubrique « Signataires ») · Prérequis : 10.1 non obligatoire.
1. Lire la liste « Signataires » : "Directeur Fictif" avec le badge « Actif », la qualité "Chef d'établissement", la fonction « Direction », « Sans limite de validité » et « aucune signature ».
2. Cliquer « Nouveau signataire » : la fenêtre « Nouveau signataire » s'ouvre. Remplir :

   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Nom complet | KONÉ Mamadou test guide | oui (2 caractères au moins) |
   | Qualité | Le Directeur | non (aide : « Par exemple : Le Directeur. ») |
   | Fonction | Chef d'établissement test guide | non |
   | Membre du personnel | (facultatif) taper "YAO" puis choisir YAO Fatou | non |
   | Valide à partir du | 2026-09-01 (sélecteur de date) | non |
   | Valide jusqu'au | (laisser vide) | non |
   | Signature (image) | fichier `docs/guide-test/jeux-de-donnees/signature-test-guide.png` | non |

3. Cliquer « Créer le signataire ».

Résultat attendu : message « Le signataire KONÉ Mamadou test guide est enregistré. » ; nouvelle ligne avec « Actif », "Le Directeur", la fonction, « Valide du … au sans fin » et « signature enregistrée » ; la valeur persiste après rechargement.

Cas invalides :

| Saisie | Message attendu |
|---|---|
| « Nom complet » vide, ou "K" | "Au moins 2 caractères." |
| « Valide jusqu'au » = 2026-08-01 (avant « Valide à partir du ») | message du serveur affiché au-dessus des boutons : "La fin de mandat précède son début." (à relever en test) |
| « Signature (image) » = `format-invalide-test-guide.txt` | « Format non accepté : PNG, JPEG, WebP ou GIF. » |

4. Sur la ligne de KONÉ Mamadou test guide : « Désactiver » → « Le signataire KONÉ Mamadou test guide est désactivé. » et badge « Inactif » ; « Activer » → « Le signataire KONÉ Mamadou test guide est activé. ».
5. « Modifier » : la fenêtre « Modifier KONÉ Mamadou test guide » propose en plus la case « Signataire actif » ; changer « Fonction » en "Chef d'établissement test guide (modifié)", « Enregistrer » → « Le signataire KONÉ Mamadou test guide est enregistré. ».

- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Désactivation/réactivation  - [ ] Droit refusé pour Directeur des études et Secrétariat (`/v2/reportcards/signatories`)

#### 10.3 Modèles de documents : lecture, aperçu, configuration versionnée
Compte : Directeur des études (`etudes@secondaire-test.test`, MFA) · Où : menu "Bulletins" > "Modèles de documents" (`/v2/reportcards/templates`) · Prérequis : 10.2 (le signataire KONÉ Mamadou test guide existe).
1. Lire « Configuration de l'établissement » : deux cartes, « Bulletin » et « Relevé de notes ». « Bulletin » affiche le badge « Secondaire », le code `secondary-bulletin` et « modèle v1, configuration v1 ». « Relevé de notes » affiche « Aucune configuration. » (pas de relevé cumulé au secondaire).
2. Lire « Modèles disponibles » : liste des modèles de la plateforme avec leur niveau et leurs "Emplacements de signature : …" (par exemple "Bulletin du secondaire (modèle générique)", emplacements "Le Directeur, Le Responsable pédagogique").
3. Sur « Bulletin », cliquer « Aperçu » : la fenêtre « Aperçu du document » affiche, dans un cadre isolé, un bulletin d'exemple ; la phrase « Aperçu avec des données d'exemple ; rien n'est émis. » est visible. Aucun vrai nom d'élève n'apparaît. Fermer.
4. Cliquer « Configurer » : fenêtre « Configurer le modèle de Bulletin », avec la phrase « La configuration est versionnée ; les documents déjà émis gardent celle de leur émission. » Renseigner :

   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Niveau d'enseignement | Secondaire | oui |
   | Modèle | Bulletin du secondaire (modèle générique) | oui |
   | Options du modèle : `showClassAverage` | cocher | non |
   | Signataires par emplacement : Le Directeur | KONÉ Mamadou test guide — Le Directeur | oui (emplacement requis) |
   | Signataires par emplacement : Le Responsable pédagogique (facultatif) | (laisser « Choisir un signataire ») | non |

5. Cliquer « Enregistrer la configuration ».

Résultat attendu : message « La configuration est enregistrée. » ; la carte « Bulletin » indique « modèle v1, configuration v2 ». Les 9 bulletins déjà émis restent associés à leur configuration d'émission (vérifié en 10.5 : `Modèle : secondary-bulletin · v1` et signataire "Directeur Fictif").

Cas invalides :

| Saisie | Message attendu |
|---|---|
| « Niveau d'enseignement » non choisi | "Choix invalide." sous le champ |
| « Niveau d'enseignement » choisi, « Modèle » non choisi | "Format invalide." sous le champ (à relever en test) |
| Emplacement requis "Le Directeur" laissé vide | message du serveur ou erreur de champ (à relever en test) |

Remarque : les options d'un modèle générique du secondaire s'affichent sous leur nom technique (`showRank`, `showClassAverage`, `showAttendance`, `showGeneralAppreciation`, `hideLateCount`, `watermark`) : voir "Écarts constatés".

- [ ] Cas nominal  - [ ] Aperçu sans donnée réelle  - [ ] Cas invalide  - [ ] Droit refusé pour Secrétariat (`/v2/reportcards/templates`)

---

### B. Liste, fiche et PDF d'un bulletin

#### 10.4 Bulletins émis : liste, filtres, états
Compte : Directeur des études (`etudes@secondaire-test.test`) · Où : menu "Bulletins" > "Bulletins — liste" (`/v2/reportcards`, rubrique « Bulletins émis») · Prérequis : seed.
1. Dans « Classe et période », choisir « Classe » = 6e A puis « Période » = Trimestre 1.
2. Lire le tableau « Bulletins émis » : colonnes « Élève », « Document », « État », « PDF », « Actions » (le titre de colonne « Sélection » est caché). Neuf lignes attendues (8 élèves notés + ADOU Aïcha : à relever), chacune avec "Version 1", « Émis le … », le badge « Publié » et le badge « PDF prêt ». Sur chaque ligne : boutons « Télécharger », « Retirer », « Réémettre » (pas « Révoquer » pour ce compte) ; la case à cocher de sélection est **désactivée** (elle ne s'active que pour un bulletin « Émis »).
3. Filtres (formulaire « Filtres ») :

   | Filtre (libellé exact) | Valeur | Résultat attendu |
   |---|---|---|
   | État | Révoqué | « Aucun bulletin. » et « Émettez les bulletins d'une classe dont la période est clôturée. » |
   | État | Publié | les 9 lignes |
   | Nature | Relevé de notes | « Aucun bulletin. » (aucun relevé cumulé) |
   | Nature | Bulletin | les 9 lignes |
   | Dernière version seulement | décochée | mêmes lignes tant qu'aucune réémission n'a eu lieu |
   | À réémettre | cochée | « Aucun bulletin. » (les résultats n'ont pas changé depuis l'émission) |

4. Remettre « État » sur « Tous les états » et la case « Dernière version seulement » cochée.

Résultat attendu : filtres cumulables ; aucune erreur technique ; état vide soigné (« Aucun bulletin. » + aide). Sans classe ni période choisies, la liste affiche tous les bulletins en vigueur de l'établissement (à relever en test). Si la liste dépasse 50 lignes, le bouton « Afficher la suite » charge la suite (non atteint avec le seed).

- [ ] Cas nominal  - [ ] États vides  - [ ] Droit refusé pour Enseignant du secondaire (`/v2/reportcards`)

#### 10.5 Fiche d'un bulletin : contenu, vérification, PDF, trace
Compte : Directeur des études (`etudes@secondaire-test.test`) · Où : `/v2/reportcards` > cliquer le nom "DIABATE Nadia" (`/v2/reportcards/<identifiant>`) · Prérequis : 10.4.
1. Lire l'en-tête : titre du document, nom de l'élève, badges « Publié » et « PDF prêt ». Aucun bandeau « Provisoire » ni « À réémettre ».
2. Section « Contenu du bulletin » : « Classe » = 6e A ; « Période » = Trimestre 1 ; « Moyenne », « Rang » (forme "3 sur 9" ou autre), « Mention », « Décision » ; « Crédits » = « — » (secondaire) ; « Délibération » = « — » ; « Règle appliquée » = `CI-SECONDARY-PLACEHOLDER · v1 (résultats v…)` ; « Modèle » = `secondary-bulletin · v1` ; ligne « Signataires : Directeur Fictif (Le Directeur). » (le signataire figé à l'émission, pas KONÉ Mamadou test guide). Comparer la moyenne et le rang avec la matrice de résultats du chapitre 09 (`/v2/results/matrix`) : ils doivent être identiques (valeurs figées de la version de résultats utilisée).
3. Section « Vérification d'authenticité » : QR code (zone « QR code du lien de vérification »), « Code de vérification » (26 caractères, lettres A à Z et chiffres 2 à 7), « Empreinte du document » (forme `abcd1234…wxyz`), lien « Ouvrir la page de vérification ». Note : « La page de vérification est publique et n'affiche ni note, ni nom, ni matricule. » **Noter le code de Nadia** (jeu de données pour 10.6 et 10.7).
4. Section « Générations du PDF » : au moins une ligne « PDF prêt » avec "1 tentative" et "N pages", « Demandée le … ».
5. Cliquer « Télécharger le PDF » : un nouvel onglet s'ouvre sur le fichier (si rien ne s'ouvre, autoriser les fenêtres contextuelles pour le site puis recommencer : l'ouverture se fait après une requête, un bloqueur peut l'intercepter). La note « Le lien de téléchargement est généré à la demande et valable 5 minutes. » est affichée sous les boutons. **Enregistrer le PDF** sur le poste (jeu de données pour 10.8).
6. Contrôler le PDF : en-tête avec le nom de l'établissement et les mentions "République de Côte d'Ivoire (démonstration)" ; couleur principale verte ; moyenne et rang identiques à l'écran ; nom du signataire "Directeur Fictif" ; QR code et code de vérification imprimés (même code que sur l'écran) ; **filigrane** "DÉMONSTRATION" en diagonale ; pied de page "Règles de démonstration — document sans valeur officielle".
7. Section « Trace d'explicabilité » (visible pour ce compte) : lire « La consultation de la trace est enregistrée dans le journal d'audit. », cliquer « Afficher la trace » : liste de lignes (code de ligne technique + règles et valeurs). Le texte brut des codes est un écart connu (voir "Écarts constatés").

Résultat attendu : toutes les valeurs de la fiche viennent du bulletin figé ; le PDF correspond à l'écran ; le code est unique.

Cas invalides :

| Saisie / action | Résultat attendu |
|---|---|
| Ouvrir `/v2/reportcards/01a11000-0000-7000-8000-000000000000` (identifiant inventé) | page d'erreur avec un message du type "Bulletin introuvable (01a11000-…)." (à relever en test ; si le serveur refuse le format de l'identifiant, noter le message) |
| Rouvrir deux fois de suite le même lien de téléchargement (copier l'adresse de l'onglet PDF puis la recoller dans un autre onglet) | le second accès est refusé (les rapports de session 12 notent un lien à usage unique ; durée de vie 5 minutes) : à vérifier en test |
| Même fiche avec le compte Secrétariat (`secretariat@secondaire-test.test`) | la section « Trace d'explicabilité » est **absente** (pas de droit `reportcard.explain`) |

- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour Parent (`/v2/reportcards/<identifiant>` → « Accès refusé »)

---

### C. Vérification publique (sans connexion)

#### 10.6 Vérifier un bulletin authentique par son code
Compte : aucun (fenêtre de navigation privée) · Où : `http://localhost:3000/v2/verify` · Prérequis : le code de Nadia noté en 10.5.
1. Dans la fenêtre privée, ouvrir `/v2/verify`. Il n'y a ni menu, ni connexion, ni nom d'utilisateur. Titre de la page : « Vérification d'un document » ; formulaire « Vérification par code » ; aide « 26 caractères imprimés sous le QR code ; les espaces et les tirets sont ignorés. »
2. Remplir « Code de vérification » avec le code de Nadia **en minuscules et avec des tirets ou espaces au milieu** (par exemple les 5 premiers caractères, un tiret, les suivants), puis cliquer « Vérifier ».
3. Lire la région « Résultat de la vérification » : badge « Authentique », titre « Document authentique », phrase du serveur "Document authentique, émis par l'établissement indiqué. Ce document a été calculé avec des règles de démonstration : il n'a aucune valeur officielle." ; lignes « Établissement » (Collège Le Baobab), « Nature du document » (Bulletin), « Intitulé », « Émis le … ».
4. Déplier « Détails techniques » : « Clé de signature », « Empreinte de la clé publique », « Empreinte du document ».
5. Lire sous la page : « Cette page n'affiche ni note, ni nom, ni matricule, ni date de naissance : elle confirme seulement l'existence et le statut du document. » Vérifier qu'**aucun** nom d'élève, aucune note, aucun matricule, aucune date de naissance n'est affiché nulle part (y compris dans le code source visible de la page).
6. Variantes d'adresse (le code est vérifié dès l'ouverture, avec le même résultat) : `/v2/verify/<code>` (forme du QR code), `/v2/verify/v/<code>` (alias imprimé par le serveur), `/v2/verify?code=<code>` (champ prérempli).
7. Avec le compte Propriétaire (autre fenêtre), cocher « Afficher la mention sur la page publique de vérification » dans `/v2/reportcards/identity` (message « Réglage enregistré. »), puis relancer la vérification en fenêtre privée : une ligne « Mention » apparaît **si** le bulletin porte une mention. Décocher ensuite la case (« Réglage enregistré. »).

Résultat attendu : statut « Authentique » mais **avertissement de démonstration** ; page sans donnée personnelle ; adresse non indexable (la page demande aux moteurs de recherche de ne pas l'indexer).

- [ ] Cas nominal  - [ ] Trois formes d'adresse  - [ ] Aucune donnée personnelle  - [ ] Mention masquée par défaut puis affichée

#### 10.7 Codes invalides, inconnus ou mal formés
Compte : aucun · Où : `/v2/verify` · Prérequis : aucun.
1. Saisir successivement dans « Code de vérification », puis « Vérifier » :

   | Saisie | Résultat attendu |
   |---|---|
   | `ABC123` | badge « Inconnu » et texte « Aucun document ne correspond à ce code. Vérifiez la saisie ; si le code est correct, le document n'est pas authentique. » |
   | `TESTGUIDEAAAAAAAAAAAAAAAAA` (26 caractères bien formés mais inexistants) | exactement la même réponse « Inconnu » |
   | une suite de 70 caractères (le champ s'arrête à 64) | la même réponse « Inconnu » |
   | `<b>x</b>` | la même réponse ; aucun HTML n'est interprété |
   | champ vide puis « Vérifier » | aucun résultat n'est affiché (pas de message d'erreur : voir "Écarts constatés") |

2. Ouvrir directement `/v2/verify/ABC123` : le résultat « Inconnu » s'affiche dès l'ouverture.
3. (Facultatif, à vérifier en test) Enchaîner plus de 30 vérifications en moins d'une minute depuis le même poste : à partir de la 31e, le message "Trop de requêtes. Réessayez dans un instant." remplace le résultat (limite de 30 requêtes par minute et par adresse IP).

Résultat attendu : un code inexistant, trop court, trop long ou mal formé reçoit la **même** réponse (aucune information sur l'existence d'un code).

- [ ] Cas nominal  - [ ] Cas invalide (5 saisies)

#### 10.8 Comparer un fichier PDF à un original
Compte : aucun · Où : `/v2/verify`, section « Comparer un fichier PDF » · Prérequis : PDF de Nadia enregistré en 10.5.
1. Lire : « Vous avez reçu un fichier : téléversez-le pour savoir s'il est identique à un document émis. Le fichier n'est pas conservé. », champ « Fichier PDF », aide « PDF de 10 Mo au plus. ».
2. Choisir le PDF de Nadia téléchargé en 10.5 : la zone affiche « Fichier identique », « Statut du document : Authentique. », le nom de l'établissement, l'intitulé et « Émis le … ».
3. Choisir `docs/guide-test/jeux-de-donnees/pdf-etranger-test-guide.pdf` : « Fichier non reconnu » avec la phrase "Ce fichier ne correspond à aucun original émis par un établissement."
4. Choisir `docs/guide-test/jeux-de-donnees/format-invalide-test-guide.txt` (choisir "Tous les fichiers" dans la fenêtre de sélection) : « Le fichier doit être au format PDF. » (rien n'est envoyé).
5. Fabriquer un fichier de plus de 10 Mo (PowerShell : `[IO.File]::WriteAllBytes("$env:TEMP\\gros-test-guide.pdf", (New-Object byte[] 10600000))`) et le choisir : « Le fichier dépasse 10 Mo. ».
6. Si possible, ouvrir le PDF de Nadia dans un éditeur de texte, modifier un caractère visible et l'enregistrer sous un autre nom : le fichier modifié donne « Fichier non reconnu » (jeu facultatif).

Résultat attendu : seul le fichier identique octet pour octet est reconnu ; un fichier modifié ou étranger ne l'est pas.

- [ ] Cas nominal  - [ ] Cas invalide (3 refus)

---

### D. Émission et publication

#### 10.9 Contrôle préalable, lot rejoué et période non clôturée
Compte : Directeur des études (`etudes@secondaire-test.test`, MFA) · Où : menu "Bulletins" > "Bulletins — émission" (`/v2/reportcards/issue`, rubrique « Émettre ») · Prérequis : seed.
1. Titre « Émettre les bulletins d'une classe ». Avant tout choix : message « Choisissez une classe et une période. »
2. Choisir « Classe » = 6e A, « Période » = Trimestre 1. Section « Contrôle préalable » : « Tout est prêt : vous pouvez générer les bulletins. » ; ligne du type « 9 inscriptions : 9 éligibles, 0 exclues. » (chiffres à relever : le rapport de session 4 notait "9 éligibles") ; « Version des résultats utilisée : 1. » (ou un autre numéro si les résultats ont été recalculés au chapitre 09). Section « Génération » : « Relancer la génération ne recrée rien : seuls les bulletins manquants sont traités. »
3. Cliquer « Générer les bulletins » (le bouton affiche « Génération… » pendant l'appel). Le seed avait créé le lot avec sa propre clé ; l'écran en crée un nouveau dont les 9 inscriptions sont reconnues comme **déjà émises** : **aucun doublon** n'est créé. Section « Avancement du lot » : badge « Terminé », barres « Bulletins émis » et « PDF générés », texte « 9 émis sur 9 — 0 exclus, 0 en échec. ». Selon le code (le compteur de PDF d'un lot ne compte que les bulletins créés par ce lot), la ligne suivante peut afficher « 0 PDF prêts sur 9 bulletins émis. » et le bouton « Relancer les PDF en échec » peut apparaître alors que tous les PDF sont prêts : consigner ce qui s'affiche (voir "Écarts constatés") ; ne pas utiliser « Publier le lot aux familles » ici.
4. Cliquer « Voir la liste des bulletins » : la liste `/v2/reportcards?classroom=…&period=…` est déjà filtrée sur la classe et la période, avec toujours **9 lignes** « Publié », « PDF prêt », "Version 1" (aucun doublon).
5. Si le bouton « PDF de la classe » est présent dans l'avancement du lot, le cliquer : le PDF combiné de la classe s'ouvre (non garanti pour un lot rejoué : à relever).
6. Retour à « Émettre », choisir « Période » = Trimestre 2 : « Au moins un point bloquant empêche l'émission. » ; une ligne avec le badge « Bloquant » : "La période n'est pas clôturée pour cette classe : les bulletins définitifs s'émettent à partir de résultats clôturés." (puis probablement "Aucune inscription n'a de résultat définitif à émettre.") ; bouton « Corriger » vers l'écran des résultats ; bouton « Générer les bulletins » **grisé**.
7. Cocher « Bulletin provisoire » (aide : « Filigrane obligatoire ; jamais publié aux familles ni vérifiable publiquement. ») : le contrôle se relance. **Ne pas générer** : un bulletin provisoire ne peut ni être supprimé ni être publié. Observer seulement si un point « Bloquant » demeure ("Aucune inscription n'a de résultat définitif à émettre." est attendu faute de résultats de la période 2 : à vérifier). Décocher.

Cas invalides :

| Saisie | Message attendu |
|---|---|
| Cocher « Réémettre les bulletins dont les résultats ont changé » (aide : « Une nouvelle version remplace l'ancienne, qui reste consultable. »), saisir « Motif de la réémission » = `abc` (aide : « 5 caractères au moins. ») et cliquer « Générer les bulletins » | « Le motif doit faire au moins 5 caractères. » sous le champ ; aucun appel envoyé |
| Trimestre 2, bouton « Générer les bulletins » | bouton inactif |
| Aucune classe choisie | seul le message « Choisissez une classe et une période. » est visible |

Résultat attendu : l'émission est idempotente (aucun doublon) ; la période non clôturée bloque l'émission définitive avec un lien de correction.

- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour Responsable pédagogique (`/v2/reportcards/issue` → « Accès refusé »)

#### 10.10 Vue des familles : parent et élève
Comptes : Parent (`parent@secondaire-test.test`) puis Élève (`eleve@secondaire-test.test`) · Où : `/v2/reportcards/family` (rubrique « Mes bulletins ») · Prérequis : seed (les bulletins de Nadia et Salimata sont publiés).
1. Compte Parent : ouvrir `/v2/reportcards/family`. Titre « Bulletins », description « Bulletins publiés de l'élève ou de vos enfants. » Deux sections, "DIABATE Nadia" et "DIABATE Salimata", chacune avec une ligne : titre du document, « Publié le … », bouton « Télécharger ».
2. Cliquer « Télécharger » pour Nadia : le PDF s'ouvre dans un nouvel onglet ; la note sous la liste dit « Chaque téléchargement est journalisé ; le lien est valable 5 minutes. » Même chose pour Salimata.
3. Compte Élève (Nadia) : même adresse : **une seule** section ("DIABATE Nadia"), jamais d'autre élève.
4. Dans la barre de rubriques « Bulletins et documents », vérifier que seule l'entrée « Mes bulletins » est proposée (ni « Émettre », ni « Modèles de documents »).

Cas invalides (adresses à taper à la main) :

| Compte | Adresse | Résultat attendu |
|---|---|---|
| Parent | `/v2/reportcards` | page « Accès refusé » |
| Parent | `/v2/reportcards/issue`, `/v2/reportcards/templates` | page « Accès refusé » |
| Élève | `/v2/reportcards/identity`, `/v2/reportcards/signatories` | page « Accès refusé » |
| Parent | `/v2/reportcards/<identifiant d'un bulletin>` (copié depuis la direction) | page « Accès refusé » (le détail est réservé à la gestion) |

Résultat attendu : le parent ne voit que les bulletins publiés de ses enfants liés ; l'élève que les siens ; un bulletin retiré, remplacé, révoqué ou provisoire n'apparaît jamais. Les pages équivalentes des portails (`/v2/student/reportcards`, `/v2/parent/children/<identifiant>/reportcards`) relèvent des chapitres des portails famille.

- [ ] Cas nominal Parent  - [ ] Cas nominal Élève  - [ ] Cas invalide  - [ ] Droit refusé (4 adresses)

---

### E. Bulletins des autres établissements

#### 10.11 Mention de démonstration (secondaire, primaire)
Compte : Directeur des études (secondaire) et fenêtre privée · Où : fiche d'un bulletin, PDF, `/v2/verify` · Prérequis : 10.5 et 10.6 faits.
1. Sur la fiche, la liste et l'émission : aucun bandeau « Règles de démonstration » n'est affiché (le bandeau existe sur d'autres modules, comme les conseils de classe ou les examens). C'est le comportement actuel : voir "Écarts constatés".
2. Dans le PDF : filigrane "DÉMONSTRATION" sur la page et pied de page "Règles de démonstration — document sans valeur officielle".
3. Sur la page publique `/v2/verify` : la phrase "Ce document a été calculé avec des règles de démonstration : il n'a aucune valeur officielle." est ajoutée au message d'un bulletin authentique.
4. Répéter 2 et 3 pour un bulletin du primaire (10.12).

Résultat attendu : la démonstration est annoncée sur le PDF et sur la vérification publique, pas sur les écrans de gestion.

- [ ] Filigrane et pied de page du PDF  - [ ] Phrase sur la vérification publique

#### 10.12 Bulletins du primaire
Compte : Directeur (`directeur@primaire-test.test`, MFA) puis Instituteur (`enseignant@primaire-test.test`) · Où : `/v2/reportcards` · Prérequis : seed primaire.
1. Directeur : choisir « Classe » = CP1 A, première période ("Semestre 1" : à vérifier). Lire 8 lignes « Publié », « PDF prêt ».
2. Ouvrir la fiche d'un élève : « Rang » (affiché par défaut au primaire), « Mention », « Modèle » = `primary-bulletin · v2`, signataire "Directeur Fictif". Télécharger le PDF : mêmes contrôles qu'en 10.5.
3. `/v2/reportcards/templates` : la carte « Bulletin » affiche le badge « Primaire », `primary-bulletin` et « modèle v2, configuration v1 ». « Configurer » : les options `showRank` ("Afficher le rang") et `showMention` ("Afficher la mention de période") portent des titres lisibles (modèle v2) ; ne rien enregistrer.
4. Vérifier le code d'un bulletin du primaire en fenêtre privée (voir 10.6) : « Authentique » + phrase de démonstration.
5. Compte Instituteur : `/v2/reportcards` s'ouvre (droit de lecture), mais **sans** case de sélection, ni « Publier », « Retirer », « Réémettre », « Révoquer » ; `/v2/reportcards/issue` et `/v2/reportcards/templates` mènent à « Accès refusé ». La liste est-elle limitée à sa classe ? (à vérifier en test).

Résultat attendu : mêmes comportements qu'au secondaire avec le gabarit du primaire.

- [ ] 8 bulletins, PDF prêts  - [ ] Vérification publique  - [ ] Instituteur en lecture seule

#### 10.13 Relevés à crédits du supérieur et modèle de relevé cumulé
Comptes : Directeur (`directeur@superieur-test.test`, MFA), Directeur des études (`etudes@superieur-test.test`) · Où : `/v2/reportcards`, `/v2/reportcards/templates` · Prérequis : seed supérieur (semestre 1 clôturé avec le jeu `CI-HIGHER-LMD`).
1. Directeur : choisir « Classe » = Licence 1 A, « Période » = Semestre 1. Lire les lignes (8 ou 9 : à relever), toutes « Publié », « PDF prêt ».
2. Ouvrir la fiche d'un étudiant : la ligne « Crédits » affiche "x / 12" (crédits acquis sur crédits du semestre) ; « Règle appliquée » = `CI-HIGHER-LMD · v1` ; « Modèle » = `higher-bulletin-credits · v1`. Comparer « Crédits » avec le registre `/v2/higher/credits` (chapitre 11) et avec la matrice des résultats (chapitre 09) : mêmes valeurs.
3. Télécharger le PDF : relevé à UE et ECUE, QR code et code ; **pas** de filigrane "DÉMONSTRATION" attendu (jeu de la plateforme : à vérifier). La vérification publique ne doit pas ajouter la phrase de démonstration (à vérifier).
4. Directeur des études, `/v2/reportcards/templates` : carte « Relevé de notes » : « Aucune configuration. ». Cliquer « Configurer », puis :

   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Niveau d'enseignement | Supérieur | oui |
   | Modèle | Relevé cumulé de crédits (modèle générique) | oui |
   | Signataires par emplacement : Le Directeur des études | Directeur Fictif | oui |

   « Enregistrer la configuration » → « La configuration est enregistrée. » et ligne « modèle v1, configuration v1 ». Cliquer « Aperçu » sur cette carte pour afficher le relevé d'exemple.

Résultat attendu : un relevé du semestre est un bulletin à crédits ; le modèle de relevé cumulé est configurable, mais aucune action ne permet de l'émettre (voir "Non couvert").

- [ ] Relevés présents, crédits cohérents  - [ ] Pas de filigrane (à confirmer)  - [ ] Modèle de relevé configuré

---

### F. Réémission, retrait et révocation (irréversibles, à faire en dernier)

Ces trois scénarios s'enchaînent sur **un seul bulletin**, celui de TOURE Jean-Marc (secondaire), qui n'est lié à aucun compte de famille : les autres chapitres ne l'utilisent pas.

#### 10.14 Réémettre un bulletin (version remplacée) puis publier la nouvelle version
Compte : Directeur des études (`etudes@secondaire-test.test`, MFA) · Où : `/v2/reportcards` (6e A, Trimestre 1) · Prérequis : 10.1, 10.2 et 10.3 faits (nouvelle identité, nouveau signataire KONÉ Mamadou test guide dans la configuration). **Action irréversible.**
1. Ne pas encore réémettre : noter, depuis la fiche de TOURE Jean-Marc, son « Code de vérification » (**ancien code**) et télécharger son PDF actuel.
2. Retour à la liste : sur la ligne "TOURE Jean-Marc", cliquer « Réémettre ». La fenêtre « Réémettre le bulletin de TOURE Jean-Marc » rappelle : « Une nouvelle version est créée ; l'ancienne reste consultable et sa vérification indique qu'elle est remplacée. »
3. Saisir « Motif » = `abc` puis « Réémettre » : « Le motif doit comporter au moins 5 caractères. » (rien n'est envoyé).
4. Saisir « Motif » = `Correction test guide` puis « Réémettre » (une confirmation d'identité peut être demandée).
5. Publier la nouvelle version : attendre « PDF prêt », puis cliquer « Publier » sur sa ligne (grisé tant que le PDF n'est pas prêt, avec l'infobulle « Le PDF n'est pas encore prêt. »). Variante : cocher la case de sélection de la ligne (active car l'état est « Émis »), puis « Publier la sélection » dans le bandeau "1 bulletin sélectionné".

Résultat attendu :
- Message « Le bulletin de TOURE Jean-Marc est réémis. » ; la ligne affiche "Version 2", l'état « Émis » (une nouvelle version n'est pas publiée automatiquement) et « PDF en attente », qui passe à « PDF prêt » après quelques secondes.
- Décocher « Dernière version seulement » : deux lignes pour cet élève ; la version 1 est « Remplacé » et n'a plus de bouton « Télécharger », « Publier » ni « Réémettre ».
- Fiche de la version 1 : "Ce bulletin a été remplacé par une version plus récente le …". Fiche de la version 2 : nouveau « Code de vérification », « Signataires : KONÉ Mamadou test guide (Le Directeur). ».
- PDF de la version 2 : pied de page "Document de démonstration test guide" et nom du nouveau signataire (le PDF de la version 1 n'a pas changé).
- `/v2/verify` : l'**ancien code** donne le badge « Remplacé », le titre « Document remplacé par une version plus récente » et "Une version plus récente de ce document a été émise le …" ; le **nouveau code** donne « Authentique ».
- Après la publication : « Le bulletin de TOURE Jean-Marc est publié. » (ou « 1 publiés, 0 déjà publiés, 0 non publiés. » avec « Publier la sélection ») et badge « Publié ».

- [ ] Cas nominal (nouvelle version, ancien code « Remplacé »)  - [ ] Cas invalide (motif trop court)  - [ ] Publication de la version 2  - [ ] Droit : Secrétariat voit « Réémettre » mais pas « Publier »

#### 10.15 Retirer un bulletin publié (version 2 de TOURE Jean-Marc)
Compte : Directeur des études (`etudes@secondaire-test.test`, MFA) · Où : `/v2/reportcards` · Prérequis : 10.14 (version 2 « Publié »).
1. Sur la version 2 de TOURE Jean-Marc, cliquer « Retirer ». Message « Le bulletin de TOURE Jean-Marc est retiré de la publication. » (une confirmation d'identité peut être demandée).
2. Lire la ligne. D'après le code (`apps/api/src/modules/reportcards/application/lifecycle.ts`), un bulletin retiré garde l'état « Publié » côté serveur (seule la date de retrait change) et l'écran ne lit pas cette date : le badge reste « Publié », le bouton « Retirer » reste affiché et aucun bouton « Publier » n'apparaît pour cette ligne. **C'est un écart probable** (voir "Écarts constatés") : consigner ce qui s'affiche réellement.
3. Cliquer une seconde fois « Retirer » : message du serveur "Ce bulletin est déjà retiré." (à relever en test).
4. Tenter de republier : la case de sélection de la ligne est désactivée (état « Publié »). Rouvrir `/v2/reportcards/issue`, choisir 6e A / Trimestre 1, « Générer les bulletins », puis, **seulement dans cette mesure**, « Publier le lot aux familles » : le message attendu est « 0 publiés, 0 déjà publiés, 0 non publiés. » (le lot rejoué n'est propriétaire d'aucun bulletin : à vérifier). La republication d'un bulletin retiré n'est donc probablement pas possible depuis l'interface.
5. Effet sur les familles : non vérifiable ici (aucun compte parent ou élève n'est lié à TOURE Jean-Marc). Le même geste sur DIABATE Salimata ferait disparaître sa section de `/v2/reportcards/family` (compte Parent), **sans retour possible par l'interface** : ne pas le faire sur la base partagée.

Résultat attendu : le retrait est enregistré (date de retrait) mais sans effet visible sur la ligne ; la republication est le point à trancher.

Cas invalide : « Retirer » sur un bulletin « Émis » ou « Remplacé » → bouton absent (il n'existe que pour l'état « Publié »).

- [ ] Cas nominal (message de retrait)  - [ ] Écart d'affichage consigné  - [ ] Cas invalide  - [ ] Droit refusé pour Secrétariat (aucun bouton « Retirer » ni « Publier »)

#### 10.16 Révoquer un bulletin (version 2 de TOURE Jean-Marc)
Compte : Directeur (`directeur@secondaire-test.test`, MFA) · Où : `/v2/reportcards` · Prérequis : 10.14. **Action définitive.**
1. Vérifier d'abord que le compte Directeur des études **n'a pas** de bouton « Révoquer ».
2. Compte Directeur : sur la version 2 de TOURE Jean-Marc, cliquer « Révoquer ». La fenêtre « Révoquer le bulletin de TOURE Jean-Marc » avertit : « Le document disparaît du portail des familles et sa vérification publique indiquera qu'il est révoqué. Cette action est définitive. »
3. Valider avec « Motif » vide ou `abc` : « Le motif doit comporter au moins 5 caractères. »
4. Saisir « Motif » = `Révocation test guide` puis « Révoquer » (une confirmation d'identité peut être demandée).

Résultat attendu : message « Le bulletin de TOURE Jean-Marc est révoqué. » ; badge « Révoqué » ; la fiche affiche "Ce bulletin a été révoqué le …" ; plus de bouton de téléchargement, de publication, de réémission ni de révocation sur la ligne. `/v2/verify` avec le code de la version 2 : badge « Révoqué », titre « Document révoqué », "Ce document a été révoqué le …" et la phrase "Document révoqué par l'établissement : il ne doit plus être considéré comme valable." Le code de la version 1 reste « Remplacé ».

- [ ] Cas nominal  - [ ] Cas invalide (motif trop court)  - [ ] Droit refusé pour Directeur des études (pas de bouton)

---

### G. Droits et qualité

#### 10.17 Récapitulatif des droits (à rejouer avec chaque compte)
Où : `/v2/reportcards` et les adresses du tableau "Droits".
1. Secrétariat : liste visible, **aucune** case de sélection, **aucun** « Publier »/« Retirer »/« Révoquer » ; « Réémettre » présent ; `/v2/reportcards/issue` s'ouvre ; la barre de rubriques n'offre que « Bulletins émis » et « Émettre ».
2. Directeur des études : peut tout sauf « Révoquer », l'identité et les signataires.
3. Responsable pédagogique : liste et fiche en lecture, « Afficher la trace » disponible, aucune action ; `/v2/reportcards/issue` → « Accès refusé ».
4. Éducateur, Économe, Responsable des examens, Chargé d'admissions : `/v2/reportcards` → « Accès refusé ».
5. Non connecté : `/v2/reportcards` → redirection vers `/login`.
6. Isolation entre établissements : avec `directeur@secondaire-test.test`, ouvrir `/v2/reportcards/` suivi de l'identifiant d'un bulletin de l'école primaire (à copier depuis `directeur@primaire-test.test`) : page d'erreur "introuvable" (comme un bulletin inexistant), jamais le contenu.

- [ ] Secrétariat  - [ ] Directeur des études  - [ ] Responsable pédagogique  - [ ] Rôles sans droit  - [ ] Isolation

#### 10.18 Qualité transversale
Où : `/v2/reportcards`, `/v2/reportcards/issue`, `/v2/verify`.
1. Chargement : à l'ouverture d'une liste, un indicateur « Chargement… » apparaît puis laisse place au tableau ou à l'état vide ; aucune page blanche.
2. Clavier : parcourir la liste avec la touche Tab (la zone du tableau reçoit le focus avec un contour visible, les boutons « Télécharger », « Publier »… se déclenchent avec Entrée/Espace, les fenêtres se ferment avec Échap).
3. Mobile (largeur 375 px) : la page publique `/v2/verify` reste utilisable sans défilement horizontal de la page ; le tableau de la liste défile à l'intérieur de sa zone.
4. Textes : aucun code technique brut dans les messages d'erreur d'un geste normal (hors écarts listés).

- [ ] Chargement  - [ ] Clavier  - [ ] Mobile

---

## Données créées

| Enregistrement | Établissement | Détail |
|---|---|---|
| Identité, version 2 | Collège Le Baobab | pied de page "Document de démonstration test guide", téléphone, e-mail, site, référence d'agrément AGR-TG-0001, logo `logo-test-guide.png` (une version d'identité ne se supprime pas) |
| Signataire "KONÉ Mamadou test guide" | Collège Le Baobab | qualité "Le Directeur", signature `signature-test-guide.png` (se désactive, ne se supprime pas) |
| Configuration de modèle « Bulletin », configuration v2 | Collège Le Baobab | option `showClassAverage`, emplacement "Le Directeur" → KONÉ Mamadou test guide |
| Configuration « Relevé de notes », v1 | Université Horizon | `transcript-credits`, emplacement "Le Directeur des études" → Directeur Fictif |
| Bulletin version 2 de TOURE Jean-Marc (publié, retiré puis révoqué) ; version 1 remplacée | Collège Le Baobab | motifs "Correction test guide" et "Révocation test guide" ; ne se supprime pas |
| Réglages de documents modifiés puis rétablis | Collège Le Baobab | "Exiger une délibération…", "Afficher la mention…" |

## Écarts constatés (lecture du code et des rapports ; à confirmer en test)

| Écran | Constat | Gravité |
|---|---|---|
| `/v2/reportcards` (« Retirer ») | Le serveur garde l'état `PUBLISHED` pour un bulletin retiré (seule `withdrawn_at` change) ; l'écran ne lit que l'état : après « Retirer », le badge reste « Publié », « Retirer » reste affiché, « Publier » n'apparaît que pour l'état « Émis » et la case de sélection reste désactivée. La republication par le lot ne touche que les bulletins créés par ce lot (filtre `batch_id`) : un bulletin retiré n'est probablement pas republiable depuis l'interface. Le test automatique simule un retour à « Émis », qui n'existe pas côté serveur. | Majeur |
| `/v2/reportcards/issue` (lot rejoué) | Rejouer « Générer les bulletins » sur une classe déjà émise par le seed crée un nouveau lot (autre clé d'idempotence) : "9 émis sur 9" mais le compteur de PDF (bulletins portant l'identifiant du lot) peut afficher 0, avec le bouton « Relancer les PDF en échec » ; « Publier le lot aux familles » n'agit sur aucun bulletin. | Mineur |
| `/v2/reportcards/templates` | Les options des modèles génériques du secondaire et du supérieur s'affichent sous leur nom technique (`showRank`, `showClassAverage`, `hideLateCount`...) : seuls les modèles v2 du primaire ont des titres lisibles. | Mineur |
| `/v2/reportcards`, fiche, émission | Aucun bandeau « Règles de démonstration » sur les écrans de gestion ; l'information n'est portée que par le PDF et la vérification publique. | Suggestion |
| `/v2/reportcards/issue` | "Tout est prêt" alors que les bulletins existent déjà (rapport de session 4, C-04-18) ; les inscriptions non émises sont désignées par les 8 premiers caractères de leur identifiant, pas par le nom de l'élève. | Suggestion / Mineur |
| `/v2/reportcards` | Un bulletin « Publié » existe pour ADOU Aïcha, sans moyenne dans les résultats (rapport de session 9, C-09-08) : à instruire. | Mineur |
| `/v2/reportcards/<identifiant>` | La trace d'explicabilité affiche des codes de ligne techniques. | Mineur |
| `/v2/verify` | Un champ vide puis « Vérifier » n'affiche aucun message ; le champ est marqué obligatoire. | Suggestion |
| `/v2/reportcards` | Aucun écran n'émet un relevé de notes cumulé (nature « Relevé de notes ») : le filtre, le modèle et l'API existent. | Mineur |
| Menu | L'entrée de menu "Identité et signataires" mène à la page « Identité et réglages » ; les signataires sont une autre rubrique de la barre. | Suggestion |

## À vérifier en test

- Nombre exact de bulletins (8 ou 9) par établissement et libellé exact de la première période du primaire.
- Message exact des erreurs serveur citées entre guillemets droits (signataire, retrait déjà fait, identifiant inventé, limite de 30 requêtes).
- Lien de téléchargement à usage unique (session 12) et durée de 5 minutes.
- Blocage par la fenêtre contextuelle du navigateur à l'ouverture du PDF.
- Présence de la case « Bloquer l'accès aux bulletins en cas d'impayé » (fonction hors offre de base).
- Absence de filigrane et de phrase de démonstration pour le supérieur.
- Comportement de la liste sans classe ni période choisies ; limitation de la liste de l'instituteur à sa classe.

## Non couvert / limites connues

- Émission du relevé cumulé (API seulement).
- Rotation et retrait des clés de signature (console plateforme, chapitre 01) ; publication des clés publiques (`http://localhost:4000/api/v1/public/keys`, hors écran).
- Documents officiels des autres modules (reçu de paiement, bulletin de paie, procès-verbaux, bilan annuel, documents d'examen) : leur vérification publique utilise la même page `/v2/verify` mais leur émission relève des chapitres finance, paie, conseils, primaire et examens.
- Gabarits : les modèles officiels ne sont pas fournis ; la création de modèles est réservée à l'opérateur de la plateforme.
- Fichier de plus de 2 Mo pour le logo : à fabriquer localement (PowerShell : `[IO.File]::WriteAllBytes("$env:TEMP\\logo-trop-lourd-test-guide.png", (New-Object byte[] 2200000))`, puis le choisir : le type est déduit de l'extension).
- Mesure de performance (100 bulletins en 120 secondes) : non vérifiable sur la démonstration.

## Jeux de données (dans `docs/guide-test/jeux-de-donnees/`)

| Fichier | Usage |
|---|---|
| `logo-test-guide.png` | logo de l'établissement (10.1) |
| `signature-test-guide.png` | signature du signataire (10.2) |
| `format-invalide-test-guide.txt` | refus de format (10.1, 10.2, 10.8) |
| `pdf-etranger-test-guide.pdf` | comparaison d'un PDF étranger (10.8) |
