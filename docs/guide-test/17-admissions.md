# Chapitre 17. Admissions : campagnes, prospects, candidatures, décisions, offres, inscription et portail public

Ce chapitre couvre les écrans `app/v2/admissions/**` (pipeline, candidatures, nouvelle candidature, dossier, listes d'attente, prospects, campagnes, rapports, paramètres, workflow) et le portail public `app/v2/apply/[school]/**` (formulaire, suivi, réponse à une offre). Module API : `apps/api/src/modules/admissions`.

Cycle testé : campagne > prospect > candidature > pièces et entretien > décision de la direction (le chargé d'admissions traite, il ne décide pas) > offre de place > réponse de la famille > élève, inscription en attente et facture des frais d'inscription > paiement > « Inscrit ». Liste d'attente et réglages du workflow en complément.

**Adresses.** Le navigateur affiche exactement les routes de l'application, précédées de `/v2` (aucun préfixe supplémentaire : `next.config.js` et `middleware.ts` ne réécrivent pas `/v2`). Le formulaire public est à l'adresse `http://localhost:3000/v2/apply/<lien>` où `<lien>` est un code opaque de 16 à 40 caractères (lettres minuscules et chiffres) créé en 17.8.

**Convention de citation.** Les libellés entre guillemets français « … » sont ceux de l'écran (fichier `fr-CI.json`). Les noms d'étapes du workflow ("Candidature reçue", "En étude", "Admis"…), les messages venant de l'API et les valeurs à saisir sont donnés entre guillemets droits ou en code, car ce sont des données de l'établissement ou du serveur.

**Établissements.** Les trois : Collège Le Baobab (`secondaire-test`, niveau 6e), École Les Palmiers (`primaire-test`, niveau Grande Section), Université Horizon (`superieur-test`, niveau Licence 1). Les scénarios sont écrits pour le collège ; les différences des deux autres établissements sont regroupées en 17.28 et 17.29.

## Parcours conseillé

| Ordre | Compte | Scénarios |
|---|---|---|
| A | Chargé d'admissions | 17.1, 17.3, 17.4 (lecture de la graine, à faire avant tout ajout) ; 17.2 se termine après 17.12 |
| B | Directeur (MFA) | 17.5 à 17.8 (campagne, réglages, références et pièce exigée, consentement et lien public) |
| C | Chargé d'admissions | 17.9 à 17.15 (prospects, candidatures, consentement, pièces, entretien, étude et doublons) |
| D | Directeur | 17.16 (décisions) |
| E | Chargé d'admissions | 17.17 (offres) |
| F | Public (sans compte) | 17.18 (page de réponse à une offre) |
| G | Économe puis chargé | 17.19 (paiement et inscription) |
| H | Chargé puis directeur | 17.20 (liste d'attente) |
| I | Chargé / directeur / secrétariat | 17.21 à 17.25 (rapports, workflow, export et anonymisation, rattachement des pièces, dépassement de capacité) |
| J | Public et tous rôles | 17.26, 17.27 (formulaire public, droits) |
| K | Tous | 17.28 à 17.30 (autres établissements, qualité transversale) et section "Nettoyage de fin de chapitre" |

## Prérequis

- Environnement de démonstration créé par `pnpm dev:v2:seed` (scénario de base `scripts/seed-v2/scenario.ts` et prolongement `scripts/seed-v2/demo/admissions.ts`, `scripts/seed-v2/demo/primary.ts`). Aucune écriture préalable n'est nécessaire.
- Application sur `http://localhost:3000`, API sur `http://localhost:4000`. Connexion en cliquant sur le compte voulu dans le panneau de droite de `/v2/login` (jamais de mot de passe dans ce guide). Les comptes marqués MFA proposent le code du moment sur la page de connexion.
- Aucun message réel n'est envoyé (e-mail, SMS) : les notifications d'admission sont seulement mises en file.
- Un petit fichier PDF, une image et quelques fichiers invalides sont fournis dans `docs/guide-test/jeux-de-donnees/` (préfixe `17-`) :
  - `17-piece-acte-naissance-test-guide.pdf` et `17-piece-bulletin-precedent-test-guide.pdf` (PDF valides) ;
  - `17-piece-photo-identite-test-guide.png` (image valide) ;
  - `17-piece-format-refuse-test-guide.txt` (format non reconnu), `17-piece-faux-pdf-test-guide.pdf` (texte renommé en .pdf), `17-piece-vide-test-guide.pdf` (0 octet).
- Le dépôt d'une pièce suppose que le stockage de fichiers de l'API est configuré (sinon l'API répond "service indisponible" : à relever, voir "À vérifier en test").

## Comptes

| Rôle | Collège Le Baobab | École Les Palmiers | Université Horizon | MFA |
|---|---|---|---|---|
| Chargé d'admissions | `admissions@secondaire-test.test` | `admissions@primaire-test.test` | `admissions@superieur-test.test` | non |
| Directeur | `directeur@secondaire-test.test` | `directeur@primaire-test.test` | `directeur@superieur-test.test` | oui |
| Secrétariat | `secretariat@secondaire-test.test` | `secretariat@primaire-test.test` | `secretariat@superieur-test.test` | oui |
| Économe (paiement des frais, 17.19) | `econome@secondaire-test.test` | `econome@primaire-test.test` | `econome@superieur-test.test` | oui |
| Enseignant (refus attendu) | `enseignant@secondaire-test.test` | `enseignant@primaire-test.test` | `enseignant@superieur-test.test` | non |
| Parent (refus attendu) | `parent@secondaire-test.test` | `parent@primaire-test.test` | `parent@superieur-test.test` | non |

## Droits

Garde de chaque page (fichiers `apps/web/src/app/v2/admissions/**/page.tsx`) et rôles qui ont la permission (`apps/api/src/modules/rbac/templates/system-roles.ts`) :

| Écran | Permission exigée | Directeur / propriétaire | Chargé d'admissions | Secrétariat | Autres rôles |
|---|---|---|---|---|---|
| Pipeline `/v2/admissions`, liste, dossier | `admission.read` | oui | oui | oui | refusé |
| Nouvelle candidature | `admission.create` | oui | oui | oui | refusé |
| Prospects | `admission.prospect.manage` | oui | oui | oui | refusé |
| Listes d'attente | `admission.waitlist.manage` (ordre : `admission.waitlist.reorder`) | oui (ordre compris) | oui (sans l'ordre) | oui (sans l'ordre) | refusé |
| Campagnes | `admission.campaign.manage` ou `admission.read` | oui (création, ouverture) | lecture seule | lecture seule | refusé |
| Rapports | `admission.report.read` | oui | oui | oui | refusé |
| Paramètres | `admission.settings.manage` | oui | refusé | refusé | refusé |
| Workflow | `admission.workflow.manage` (publier : `admission.workflow.publish`, sensible) | oui | refusé | refusé | refusé |
| Décider, dépasser une capacité, exporter, anonymiser | `admission.decide`, `admission.capacity.override`, `admission.export`, `admission.anonymize` | oui | non | non | non |

Le refus est une redirection serveur vers `/unauthorized` : page de titre "Accès refusé" avec le texte "Vous n'avez pas les droits nécessaires pour afficher cette page." et le lien "Retour à l'accueil". Une personne non connectée est renvoyée vers `/login`.

**Adresses à taper à la main, refus attendu (page "Accès refusé", aucune donnée) :**

| Compte | Adresses |
|---|---|
| Chargé d'admissions | `/v2/admissions/settings`, `/v2/admissions/settings/workflow` |
| Enseignant | `/v2/admissions`, `/v2/admissions/applications`, `/v2/admissions/applications/new`, `/v2/admissions/reports` |
| Parent | `/v2/admissions/waitlist`, `/v2/admissions/prospects`, `/v2/admissions/campaigns` |
| Économe | `/v2/admissions/applications`, `/v2/admissions/reports` |

Le scénario 17.27 déroule ces contrôles.

## Données de départ

Source : `scripts/seed-v2/demo/admissions.ts` (appelé par `scripts/seed-v2/demo/index.ts` pour le collège et l'université, et par `scripts/seed-v2/demo/primary.ts` pour l'école). Tout passe par l'API : campagne par le propriétaire, dossiers par le chargé d'admissions, décisions par le directeur.

| Établissement | Campagne (code) | Libellé affiché dans la liste "Campagne d'admission" | Niveau | Places | Dossiers |
|---|---|---|---|---|---|
| Collège | `RENTREE-6E` | Campagne RENTREE-6E (RENTREE-6E) | 6e (code 6E) | 13 | 9 |
| École | `RENTREE-MATERNELLE` | Campagne RENTREE-MATERNELLE (RENTREE-MATERNELLE) | Grande Section (code GS) | 17 | 13 |
| Université | `RENTREE-L1` | Campagne RENTREE-L1 (RENTREE-L1) | Licence 1 (code L1) | 13 | 9 |

Dossiers du collège et de l'université (mêmes noms, dates de naissance 2014 et 2013 au collège, 2005 et 2004 à l'université), du pipeline à lire en 17.1 :

| Candidat | Étape du workflow (colonne du pipeline) | Particularité |
|---|---|---|
| Aïcha ADOU | "Inscrit" | frais d'inscription payés, inscription confirmée |
| Brice ASSI | "Inscription en attente de paiement" | élève et facture des frais créés, non réglée (si l'économe l'a réglée dans le chapitre finances, le dossier est déjà "Inscrit") |
| Chantal DAGO | "Admis" | offre émise (conditions "Offre de démonstration, réponse attendue."), réponse de la famille attendue ; le lien de réponse n'est pas récupérable (affiché une seule fois à l'émission) |
| Désiré EKRA | "En étude" | |
| Estelle FOFANA | "Candidature reçue" | statut "Déposée" |
| Fabrice GUEI | "Pièces manquantes" | |
| Grâce HIEN | "Liste d'attente" | décidée par la direction, rang non encore décidé ("À classer") |
| Hervé KRA | "Refusé" | motif "Dossier incomplet" |
| Inès LOBA | "Brouillon" | |

École Les Palmiers (13 dossiers, naissances 2020-2021) : inscrits Aïcha ADOU, Brice ASSI, Chantal DAGO, Désiré EKRA, Estelle FOFANA ; puis Fabrice GUEI "Inscription en attente de paiement", Grâce HIEN "Admis" (offre émise), Hervé KRA "En étude", Inès LOBA "Candidature reçue", Jonas MEL "Pièces manquantes", Karine NAMA "Liste d'attente", Lazare OKOU "Refusé", Martine PEHE "Brouillon".

Autres éléments posés par la graine, ou absents :

- Les tuteurs des dossiers ont un lien de parenté, une adresse `candidatN@<slug>.test` et un téléphone `+225 05 ...`. Le consentement parental (texte `v1`, mode "Saisi par le personnel") est consigné pour chaque dossier.
- Un texte de consentement `v1` est publié mais **non désigné** : l'écran Paramètres affiche l'alerte "Aucun texte de traitement des données n'est désigné : le formulaire public est fermé.".
- **Aucun lien public** n'est créé. Aucune pièce n'est exigée. Aucun prospect, aucun entretien.
- Workflow publié "Parcours d'admission standard" (code `STANDARD`) et motifs de décision livrés (voir 17.16). Politiques par défaut : capacité "Stricte : jamais au-delà des places", doublons "Signaler seulement", liste d'attente "Manuelle", validité d'une offre 14 jours, conservation des refusés vide.
- Notifications : aucune n'est réellement envoyée.

Si d'autres chapitres ou des sessions antérieures ont déjà agi sur la base (par exemple le paiement des frais de Brice ASSI par l'économe), les colonnes du pipeline diffèrent d'un dossier : on lit ce qui est affiché et on le consigne.

## Écarts constatés avant exécution (lecture du code)

Ces constats sont tirés du code ; ils sont à confirmer à l'écran et à reporter dans la section finale.

1. **Formulaire public inouvrable depuis l'interface (gravité Majeur, à confirmer).** L'API ne sert le formulaire que si le réglage `public_form_enabled` est vrai (`apps/api/src/modules/admissions/application/public-form.ts`, valeur par défaut `false` dans `1900_admissions_reference.sql`). Aucun écran ne pose ce réglage : « Créer le lien public » n'active que l'index du lien, et le texte de consentement désigné ne suffit pas. Conséquence attendue : même avec le lien créé et un texte désigné, la page `/v2/apply/<lien>` répond "Ce formulaire n'est pas disponible.". Le dépôt par la famille et le suivi par code (réservé aux dossiers déposés par ce formulaire) ne sont donc pas déroulables sans intervention technique. La page de réponse à une offre, elle, fonctionne (elle n'exige que le lien actif).
2. **"Retirer l'offre" ne libère pas la place (Majeur, à vérifier).** Le texte de la fenêtre promet "La place est libérée", mais le code ne fait que passer l'offre à "Retirée" ; le dossier reste à l'étape "Admis", qui retient une place. Seul "Retiré par la famille" (décision de la direction) ou le refus de la famille par le lien libère la place.
3. **Aucun contrôle d'âge à l'admission (Suggestion).** Seules les dates futures ou antérieures à 1950 sont refusées ("La date de naissance n'est pas plausible."). Un candidat de 40 ans en 6e est accepté ("âge d'entrée : aucun contrôle", README du module).
4. **Codes bruts affichés (Mineur).** Dossier : lien de parenté des tuteurs en code (`MOTHER`), prise en charge `PRIVATE`, origine `WALK_IN` ; rapport "Sources" : `WALK_IN` ; liste d'attente : "Aucune promotion : NOT_RANKED" ; message de consentement manquant : "le consentement parental est requis avant l'étape SUBMITTED".
5. **Messages Zod techniques (Mineur).** "Lien de parenté" ou "Niveau" laissés vides affichent "Code en majuscules, chiffres et ... (2 à 40 caractères)." et "Code de niveau invalide.".
6. **Réponse à une offre : erreur trompeuse (Mineur à Majeur, à vérifier).** Sur la page publique, toute erreur 409 ou 400 à l'acceptation (classe non désignée, sexe du candidat absent, pièces non acceptées) s'affiche "Ce lien n'est pas ou plus valide." (`PublicOfferScreen.tsx`, `publicErrorKey`).
7. **Ancien guide.** Plusieurs attendus de `docs/GUIDE_UTILISATEUR_TEST.md` (chapitre 17) étaient inexacts : « Créer le lien public » suffit à ouvrir le formulaire (faux, voir 1) ; les boutons de décision portent le nom de l'étape (exact) mais le premier de la liste d'attente ne se promeut pas tant que la direction n'a pas classé (voir 17.20) ; l'offre expirée et le suivi par code ne sont pas testables sans le formulaire ni l'échéance (voir "Non couvert").

---

## Scénarios

#### 17.1 Ouvrir les admissions et lire le pipeline
Compte : chargé d'admissions (collège) · Où : menu « Admissions » (`/v2/admissions`) · Prérequis : base neuve.
1. Se connecter avec `admissions@secondaire-test.test`. Ouvrir le menu « Admissions » (entrée du groupe Pilotage : `/v2/admissions`).
2. Vérifier le titre « Pipeline des candidatures », la barre d'onglets « Admissions » (entrées « Pipeline », « Candidatures », « Listes d'attente », « Prospects », « Campagnes », « Rapports ») et le bouton « Nouvelle candidature ». Les onglets « Paramètres » et « Workflow » sont absents.
3. Vérifier la liste « Campagne d'admission » (présélection de la campagne ouverte la plus récente) et la liste « Niveau » (option « Tous les niveaux »).
4. Parcourir les colonnes (une par étape) : chacune porte un titre, une pastille de statut et un compteur.
Résultat attendu : 12 colonnes dans l'ordre "Brouillon", "Candidature reçue", "En étude", "Pièces manquantes", "Liste d'attente", "Admis", "Inscription en attente de paiement", "Inscrit", "Refusé", "Retiré par la famille", "Offre expirée", "Dossier en double". Les neuf dossiers du tableau de départ sont répartis un par colonne (sauf les trois dernières colonnes, vides, qui affichent « Aucun dossier »). Les pastilles utilisent les libellés « Brouillon », « Déposée », « À l'étude », « Pièce manquante », « Liste d'attente », « Acceptée », « Refusée », « Inscrit ». Chaque carte affiche le nom du candidat, le numéro de dossier et le code du niveau (par exemple `6E`).
5. Choisir un autre niveau dans « Niveau » (si la liste en propose) : le tableau se filtre ; revenir à « Tous les niveaux ».
Cas invalides : sans objet (lecture). État vide : aucune campagne n'existe dans un établissement neuf (non produit par la graine) ; le texte serait « Aucune campagne d'admission » avec le bouton « Créer une campagne » réservé à la direction.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour l'enseignant (voir 17.27)

#### 17.2 Déplacer un dossier depuis le pipeline (boutons « Déplacer »)
Compte : chargé d'admissions · Où : « Admissions » (`/v2/admissions`) · Prérequis : un dossier "Candidature reçue" à vous (créé en 17.12) ; avant cela, on se limite à lire les boîtes de dialogue sans confirmer.
1. Sur la carte de Estelle FOFANA (dossier de la graine, "Candidature reçue"), cliquer « Déplacer » : la fenêtre « Déplacer Estelle FOFANA » indique « Étape actuelle : Candidature reçue. Seules les destinations prévues par le workflow sont proposées. ».
2. Constater la liste : "En étude" est un bouton ; les destinations qui exigent une décision ("Refusé", "Retiré par la famille", "Dossier en double") affichent le texte « Cette étape exige une décision formelle, enregistrée avec son motif. » et le lien « Ouvrir le dossier pour décider ». Cliquer « Annuler » sans confirmer.
3. Après 17.12, refaire le geste sur un dossier TG : choisir "En étude", cliquer « Déplacer le dossier ».
Résultat attendu : message `Dossier déplacé vers "En étude".` ; la carte passe dans la colonne "En étude" ; l'historique du dossier garde la trace.
Cas invalides : | Saisie | Message attendu |
|---|---|
| Valider sans choisir de destination | bouton « Déplacer le dossier » inactif |
| Destination avec motif obligatoire (aucune dans le modèle livré côté chargé) | « Un motif d'au moins 3 caractères est obligatoire. » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : le chargé ne voit jamais de bouton "Admis" ni "Refusé" (17.16)

#### 17.3 Liste des candidatures : filtres, recherche, pagination
Compte : chargé d'admissions · Où : « Candidatures » (`/v2/admissions/applications`).
1. Ouvrir « Candidatures » : titre « Candidatures », tableau « Liste des candidatures » (colonnes « Numéro », « Candidat », « Niveau », « Étape », « Déposée le »).
2. Filtre « Statut » : choisir « Inscrit » (un seul dossier : Aïcha ADOU, ou deux si Brice ASSI est déjà inscrit). Revenir à « Tous les statuts ».
3. Champ « Recherche » (espace réservé « Nom ou numéro ») : taper `EKRA` > un dossier ; taper `ZZZZ` > « Aucune candidature ne correspond à ces filtres. ».
4. Cocher « Délai dépassé seulement » : la liste devient vide (aucune étape du modèle livré n'a de délai cible), puis décocher.
5. Combiner le statut « Refusée » et la recherche `KRA` > Hervé KRA. Combiner « Inscrit » et `KRA` > aucun résultat.
6. Changer la taille de page (30, 50, 100) si la liste en propose.
7. Cliquer sur un numéro de dossier : le dossier s'ouvre (17.4).
Résultat attendu : les filtres réduisent la liste ; l'état vide affiche le texte du point 3.
Cas invalides : recherche de 121 caractères ou plus : saisie tronquée à 120 caractères (champ limité).
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : un parent qui tape l'adresse obtient "Accès refusé"

#### 17.4 Lire un dossier de candidature
Compte : chargé d'admissions · Où : « Candidatures » > clic sur le nom ou le numéro (`/v2/admissions/applications/<id>`).
1. Ouvrir le dossier de Brice ASSI. Lire l'en-tête : nom, sous-titre « Dossier `<numéro>` · niveau 6E », pastilles d'étape et de statut.
2. Repérer la section « Inscription » : « Inscription en attente : elle sera confirmée au règlement des frais d'inscription. » (ou « Inscription confirmée le `<date>`. » si l'économe a déjà payé). Les liens « Dossier de l'élève » et « Fiche d'inscription » n'apparaissent comme liens que si le rôle a le droit de les ouvrir (sinon texte simple).
3. Parcourir les sections : « Informations » (date et lieu de naissance, nationalité, établissement précédent, redoublant, prise en charge, origine, déposée le, dans l'étape depuis, places restantes), « Tuteurs et consentement » (consentement « Consentement valide »), « Pièces du dossier » (« Aucune pièce n'est demandée pour ce dossier. »), « Tests et entretiens » (« Aucun test ni entretien. »), « Offres de place » (« Acceptée »), « Doublons possibles » (« Aucun doublon détecté. »), « Historique » (dépliant : « Décisions formelles », « Changements d'étape »), « Données personnelles ».
4. Ouvrir ensuite le dossier de Chantal DAGO ("Admis") : la section « Offres de place » montre l'offre « En attente de réponse » avec son échéance (« Échéance : `<date>` ») et les boutons « Désigner la classe », « Accepter au nom de la famille », « Retirer l'offre » (ne pas les utiliser ici).
5. Ouvrir le dossier de Hervé KRA ("Refusé") : dans « Historique » > « Décisions formelles », voir la décision avec le motif et « Par `<nom du directeur>` ».
Résultat attendu : toutes les sections sont présentes ; pour un dossier clos, aucune action de traitement n'est proposée ; « Aucune action disponible pour vous à cette étape. » apparaît dans « Étape et décisions » quand le rôle n'a pas d'action.
Cas invalides : dossier d'un autre établissement ou identifiant inventé (`/v2/admissions/applications/00000000-0000-4000-8000-000000000000`) : la page répond comme si l'élément n'existait pas (message d'erreur lisible, aucune donnée) ; message exact à relever.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour l'économe

#### 17.5 Campagne TG-2027 : créer, fixer les capacités, ouvrir
Compte : directeur (collège, MFA) · Où : menu « Campagnes d'admission » (`/v2/admissions/campaigns`) · Prérequis : année scolaire en cours présente.
1. Ouvrir « Campagnes d'admission » : on voit `RENTREE-6E` (période, pastille « Ouverte », tableau « Capacités de la campagne Campagne RENTREE-6E » avec le niveau 6E, 13 places).
2. Cliquer « Nouvelle campagne » et remplir :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Année scolaire | l'année en cours (2026-2027) | oui |
   | Workflow publié | "Parcours d'admission standard (v1)" (la seule proposition) | oui |
   | Code | `TG-2027` | oui |
   | Libellé | `Campagne test guide 2027` | oui |
   | Ouverture | 2026-10-08 08:00 (format de la zone : `2026-10-08T08:00`) | oui |
   | Clôture | 2027-03-31 17:00 (`2027-03-31T17:00`) | oui |
3. Cliquer « Créer ». La campagne apparaît en « Brouillon » avec le texte « Aucune capacité définie. ».
4. Cliquer « Capacités » sur cette campagne : dans « Ajouter un niveau » choisir 6e puis « Ajouter » ; saisir « Places » `2` et « Limite de la liste » `5` ; « Enregistrer ». Le tableau montre 6E, 2 places, 2 libres, liste d'attente 0 / 5.
5. Cliquer « Ouvrir » (la pastille passe à « Ouverte »).
6. Avec le chargé d'admissions : ouvrir la même page : la campagne se lit, mais les boutons « Nouvelle campagne », « Ouvrir », « Clôturer » et « Capacités » sont absents.
Résultat attendu : campagne `TG-2027` ouverte, une capacité 6E de 2 places. Attention : une campagne ouverte plus récente peut devenir la campagne présélectionnée dans les écrans ; choisir toujours la campagne voulue dans « Campagne d'admission ».
Cas invalides :
| Saisie | Message attendu |
|---|---|
| « Code » vide | message du code ("Code de campagne invalide.") |
| « Code » `TG-2027` déjà pris (recréer) | `Ce code de campagne existe déjà dans l'établissement.` |
| « Clôture » avant « Ouverture » (2026-10-01 pour la clôture) | « La clôture doit suivre l'ouverture. » |
| « Libellé » vide | "Libellé obligatoire." |
| Aucun « Workflow publié » (cas non reproductible ici) | « Aucun workflow publié : publiez-en un dans la page Workflow. » |
| Capacité : « Places » `abc` | « Valeurs invalides pour le niveau 6E. » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le chargé (boutons absents)

#### 17.6 Paramètres d'admission : lecture, modification et restauration
Compte : directeur (collège) · Où : menu "Paramètres des admissions" (`/v2/admissions/settings`).
1. Lire « Paramètres d'admission » > « Politiques générales » : « Capacité » (« Stricte : jamais au-delà des places »), « Doublons » (« Signaler seulement »), « Promotion de la liste d'attente » (« Manuelle »), « Validité d'une offre (jours) » `14`, « Délai de paiement des frais (jours) » (vide), « Conservation des dossiers refusés (mois) » (vide), « Modèle de numéro de dossier », cases « Activer les listes d'attente », « Consentement parental obligatoire », bloc « Protection du formulaire public » (« Délai minimal de saisie (secondes) », « Dépôts par connexion et par 10 minutes », « Exiger un test anti-robot »).
2. Changer « Validité d'une offre (jours) » de `14` à `21` puis « Enregistrer » : message « Paramètres enregistrés. ». Recharger : la valeur `21` est conservée. Remettre `14` et enregistrer.
3. Cliquer « Initialiser les modèles » (bloc « Formulaire public », visible si la fonction "formulaire public" est incluse dans l'offre) : message « Modèles initialisés. » (opération sans effet : le workflow et les motifs existent déjà).
Résultat attendu : valeurs persistées après rechargement ; aucune perte des autres réglages.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| « Validité d'une offre (jours) » `0`, `400`, `abc` ou vide | "La valeur doit être supérieure ou égale à 1." (toute valeur hors bornes 1 à 365 est envoyée comme 0) |
| « Modèle de numéro de dossier » `ABC` (sans compteur) | `Le motif de numéro doit contenir {SEQ} (ex. {YEAR}-{SEQ:5}).` |
| « Délai de paiement des frais (jours) » `abc` | "La valeur doit être supérieure ou égale à 1." |
| « Dépôts par connexion et par 10 minutes » `0` | "La valeur doit être supérieure ou égale à 1." |
Ne pas activer « Exiger un test anti-robot » (aucun fournisseur n'est branché : le formulaire resterait fermé).
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le chargé et le secrétariat (17.27)

#### 17.7 Références de l'établissement : motifs de décision, classes de priorité, pièce à fournir
Compte : directeur (collège) · Où : `/v2/admissions/settings`, sections « Motifs de décision », « Classes de priorité », « Pièces à fournir ».
1. Section « Motifs de décision » : lire les motifs livrés (par exemple "Candidature retenue", "Dossier incomplet", "Capacité d'accueil atteinte", "Conditions d'admission non remplies", "Candidature non retenue", « Candidature retirée par la famille »). Sous « Ajouter un motif », choisir « Décision » = « Refus » (liste des natures : « Acceptation », « Refus », « Mise en liste d'attente », « Retrait », « Réexamen »), « Code » `TG_MOTIF_REFUS`, « Libellé » `Motif de refus test guide` ; « Ajouter ». Le motif apparaît avec "(TG_MOTIF_REFUS · Refus)".
2. Section « Classes de priorité » : « Ajouter une classe de priorité » avec « Code » `TG_PRIORITE`, « Libellé » `Fratrie test guide`, « Rang » `5` (de 1 à 1000) ; « Ajouter ». La ligne s'affiche "5. Fratrie test guide (TG_PRIORITE)".
3. Section « Pièces à fournir » > « Ajouter une pièce » : « Code » `TG_ACTE_NAISSANCE`, « Libellé » `Acte de naissance test guide`, « Niveau concerné » = "6e", « Prise en charge concernée » = « Toutes », case « Pièce obligatoire » cochée ; « Ajouter » : message « Pièce enregistrée. ». La ligne affiche la pastille « Obligatoire ». **Cette pièce rend l'étape "Admis" impossible tant qu'elle n'est pas acceptée pour tous les dossiers 6e : elle est désactivée en 17.16.**
4. Désactiver puis réactiver un motif ou une classe avec « Désactiver » / « Activer » (le libellé du bouton change ; ne laisser inactive que `TG_PRIORITE`).
Résultat attendu : les éléments créés persistent après rechargement ; aucun de ces éléments ne peut être supprimé (seulement désactivé).
Cas invalides :
| Saisie | Message attendu |
|---|---|
| « Code » `TG-MOTIF` (tiret) | le code est mis en majuscules par l'écran, mais le tiret est refusé : message commençant par "Code en majuscules, chiffres et" (texte exact à relever) |
| « Code » vide | même message |
| « Libellé » vide | "Libellé obligatoire." |
| « Rang » `0` ou vide | message de borne ("La valeur doit être supérieure ou égale à 1.") |
| « Code » déjà utilisé pour une classe de priorité | `Ce code de classe de priorité existe déjà.` (ou mise à jour de la ligne : la saisie d'un code existant met à jour la ligne, à relever) |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le chargé (`/v2/admissions/settings`)

#### 17.8 Textes de consentement et lien public
Compte : directeur (collège) · Où : `/v2/admissions/settings`, sections « Textes de consentement parental » et « Formulaire public ».
1. État de départ : l'alerte « Aucun texte de traitement des données n'est désigné : le formulaire public est fermé. » est affichée ; la liste montre une ligne « Traitement des données » de version `v1` (celle de la graine, non désignée ; l'écran écrit `vv1` : préfixe `v` doublé, Mineur).
2. Sous « Publier un nouveau texte » : « Nature » = « Traitement des données », « Version » `tg1`, « Texte » : `Je consens au traitement des données de ma candidature pour la seule gestion des admissions (texte de test guide).` (au moins 20 caractères), case « Désigner comme texte en vigueur » cochée ; « Publier ». Message « Texte publié. » ; la pastille « Texte en vigueur » apparaît sur la version `tg1` (affichée `vtg1`) et l'alerte disparaît.
3. Section « Formulaire public » : cliquer « Créer le lien public » : message « Lien public créé. », pastille « Lien actif », deux champs en lecture seule « Lien du formulaire » (`http://localhost:3000/v2/apply/<lien>`) et « Lien de suivi des familles » (`.../track`) avec le bouton « Copier » (message « Copié dans le presse-papiers. »). Noter le `<lien>` (il sert en 17.18 et 17.26).
4. Cliquer « Désactiver le lien » : message « Lien mis à jour. », pastille « Lien désactivé » ; puis « Activer le lien » : « Lien mis à jour. ». Ne pas utiliser « Régénérer le lien » avant 17.18 (l'ancien lien cesse de fonctionner immédiatement : message « Nouveau lien généré. »).
Résultat attendu : texte `tg1` en vigueur, lien actif. Le formulaire n'est pas ouvert pour autant (voir écart n°1 et 17.26).
Cas invalides :
| Saisie | Message attendu |
|---|---|
| « Version » vide | message commençant par "Version : lettres, chiffres" (texte exact à relever) |
| « Version » `tg 1` (espace) | même message |
| « Texte » de 10 caractères | "Le texte doit comporter au moins 20 caractères." |
| « Version » `tg1` déjà publiée | `Cette version du texte de consentement existe déjà.` ou `Cette version du texte existe déjà : publiez une nouvelle version.` (à relever) |
| Retirer la version désignée tant que le lien est actif | tant que le formulaire public est ouvert : `Ce texte est celui du formulaire public ouvert : désignez une autre version ou fermez le formulaire avant de le retirer.` (non atteignable si le formulaire n'est pas ouvert : le retrait réussit) |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le chargé

#### 17.9 Prospects : créer, contacter, convertir, perdre
Compte : chargé d'admissions · Où : menu « Prospects » (`/v2/admissions/prospects`) · Prérequis : campagne `TG-2027` ouverte (17.5).
1. Ouvrir « Prospects » : titre « Prospects », tableau « Liste des prospects » vide (« Aucun prospect. »). Filtres « Statut » (« Tous les statuts ») et « Recherche ».
2. Cliquer « Nouveau prospect » et remplir :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Prénoms | `Mariam` | oui |
   | Nom | `COULIBALY test guide` | oui |
   | Téléphone | `+225 07 48 12 34 56` | téléphone ou e-mail |
   | Adresse e-mail | `mariam.coulibaly.tg@exemple.test` | téléphone ou e-mail |
   | Niveau visé | "6e" | non |
   | Origine | « Recommandation » (choix : « Visite », « Téléphone », « Recommandation », « Réseaux sociaux », « Site web », « Événement », « Autre ») | non |
   | Notes | `Recommandée par une famille du quartier (test guide)` | non |
   Cliquer « Enregistrer » : la ligne apparaît avec la pastille « Nouveau ».
3. Cliquer « Marquer contacté » (libellé accessible « Marquer Mariam COULIBALY test guide comme contacté ») : la pastille passe à « Contacté », le bouton disparaît.
4. Cliquer « Convertir » : dans « Convertir Mariam COULIBALY test guide en candidature », choisir la campagne **Campagne test guide 2027 (TG-2027)** dans « Campagne d'admission », « Prénoms de l'enfant » `Awa`, « Date de naissance de l'enfant » `2014-06-12`, « Niveau visé » = "6e", « Lien de parenté du prospect » = "Mère" ; cliquer « Convertir ». L'écran ouvre le dossier créé : **Awa COULIBALY test guide**, étape "Brouillon", tuteur Mariam COULIBALY test guide. Retour sur « Prospects » : la ligne est « Converti » avec le lien « Ouvrir le dossier ».
5. Créer un second prospect `Seydou` / `KONÉ test guide`, téléphone `+225 05 77 21 08 33`, origine « Téléphone ». Cliquer « Perdu » : fenêtre « Prospect perdu : Seydou KONÉ test guide », « Motif » `Famille installée à Bouaké (test guide)`, bouton « Perdu » : la pastille devient « Perdu ».
6. Filtrer par « Statut » = « Perdu », puis chercher `COULIBALY`.
Résultat attendu : un dossier est créé à la conversion (sans sexe ni lieu de naissance, à compléter en 17.11) ; un prospect converti ou perdu ne propose plus « Convertir ».
Cas invalides :
| Saisie | Message attendu |
|---|---|
| « Prénoms » vide | "Libellé obligatoire." |
| ni « Téléphone » ni « Adresse e-mail » | "Un moyen de contact (téléphone ou e-mail) est obligatoire." |
| « Adresse e-mail » `mariam.coulibaly` | "Adresse e-mail invalide." |
| « Téléphone » `123` | « Au moins 6 caractères. » |
| nouveau prospect avec le même e-mail qu'un prospect actif | `Un prospect actif existe déjà avec cette adresse e-mail.` |
| Perdu avec « Motif » de 2 caractères | « Le motif doit comporter au moins 3 caractères. » |
| Convertir sans date de naissance | « Date attendue au format AAAA-MM-JJ. » |
| Convertir une seconde fois le même prospect | l'action n'est plus proposée ; côté API : `Ce prospect est déjà converti.` |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour l'enseignant (17.27)

#### 17.10 Nouvelle candidature (secrétariat ou chargé) : création et cas invalides
Compte : chargé d'admissions · Où : « Candidatures » > « Nouvelle candidature » (`/v2/admissions/applications/new`).
1. Ouvrir la page : titre « Nouvelle candidature », liste « Campagne d'admission » : **choisir "Campagne test guide 2027 (TG-2027)"** (par défaut, c'est la campagne ouverte la plus récente).
2. Remplir les blocs « Candidat », « Tuteur 1 » puis « Ajouter un tuteur » :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Prénoms | `Ibrahim` | oui |
   | Nom | `TRAORE test guide` | oui |
   | Date de naissance | `2014-09-03` | oui |
   | Lieu de naissance | `Yopougon` | non |
   | Sexe | « Masculin » (choix : « Non précisé », « Féminin », « Masculin ») | non, mais exigé pour l'inscription |
   | Établissement précédent | `École primaire Les Lauriers (test guide)` | non |
   | Niveau | "6e" | oui |
   | Mode de prise en charge | « Famille (privé) » (autres : « Affecté par l'État », « Bourse », « Prise en charge par une entreprise », « Enfant de personnel », « Autre ») | non |
   | Le candidat redouble | décoché | non |
   | Tuteur 1 : Lien de parenté | "Père" | oui |
   | Tuteur 1 : Prénoms / Nom | `Moussa` / `TRAORE test guide` | oui |
   | Tuteur 1 : Téléphone | `+225 01 40 55 66 77` | téléphone ou e-mail |
   | Tuteur 1 : Adresse e-mail | `moussa.traore.tg@exemple.test` | |
   | Tuteur 1 : Tuteur principal, Responsable financier | cochés | non |
   | Tuteur 2 : Lien de parenté / Prénoms / Nom | "Mère" / `Fanta` / `DIABATE test guide` | oui |
   | Tuteur 2 : Téléphone | `+225 05 22 33 44 55` | |
3. Cliquer « Créer la candidature ». Le dossier s'ouvre : **Ibrahim TRAORE test guide**, étape "Brouillon", deux tuteurs, mention « Consentement manquant ».
4. Créer ensuite, avec le même formulaire et un seul tuteur, les dossiers suivants (naissance, sexe, tuteur) :
   | Prénoms / Nom | Naissance | Sexe | Tuteur 1 (lien, prénoms, nom, téléphone) |
   |---|---|---|---|
   | `Kader` / `BAMBA test guide` | `2014-11-21` | Masculin | Père, `Elie`, `BAMBA test guide`, `+225 07 61 62 63 64` |
   | `Salimata` / `KONÉ test guide` | `2014-02-27` | Féminin | Mère, `Aïssata`, `KONÉ test guide`, `+225 05 31 32 33 34` |
   | `Yao` / `KOUASSI test guide` | `2013-12-09` | Masculin | Père, `Jean`, `KOUASSI test guide`, `+225 07 55 44 33 22` |
   Ces cinq dossiers (avec Awa) sont la base des scénarios suivants.
Résultat attendu : à chaque création, redirection vers le dossier ; le numéro est de la forme `AAAA-NNNNN`.
Cas invalides (dossier non créé, message sous le champ) :
| Saisie | Message attendu |
|---|---|
| « Prénoms » vide | "Libellé obligatoire." |
| « Date de naissance » vide | « Date attendue au format AAAA-MM-JJ. » |
| « Date de naissance » dans le futur (`2027-01-01`) | `La date de naissance n'est pas plausible.` |
| « Date de naissance » `1940-05-05` | `La date de naissance n'est pas plausible.` |
| « Date de naissance » `1985-05-05` (adulte de 41 ans en 6e) | **accepté** (aucun contrôle d'âge ; écart n°3, Suggestion) : ne pas conserver ce dossier (le laisser en "Brouillon" ou le refuser) |
| « Niveau » non choisi | "Code de niveau invalide." (message technique, Mineur) |
| « Lien de parenté » non choisi | message commençant par "Code en majuscules, chiffres et" (Mineur) |
| ni téléphone ni e-mail pour un tuteur | "Un moyen de contact (téléphone ou e-mail) est obligatoire pour chaque tuteur." |
| « Adresse e-mail » du tuteur `moussa.traore` (sans @) | "Adresse e-mail invalide." |
| « Mode de prise en charge » = « Affecté par l'État » sans « Référence d'affectation » | « La référence d'affectation est obligatoire pour un élève affecté par l'État. » ; avec une référence : `Les élèves affectés par l'État ne sont pas pris en charge par cet établissement.` si la fonction n'est pas incluse (non applicable au collège : à relever) |
| Recréer exactement `Ibrahim` / `TRAORE test guide` / `2014-09-03` dans la même campagne | `Une candidature vivante existe déjà pour cet enfant dans cette campagne.` (aucun dossier créé, pas de lien vers le dossier existant) |
| Deux tuteurs « Tuteur principal » cochés | "Un seul tuteur principal." (la case décoche l'autre automatiquement : à constater) |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour l'économe (`/v2/admissions/applications/new`)

#### 17.11 Modifier une candidature et conflit de modification
Compte : chargé d'admissions · Où : dossier de Awa COULIBALY test guide > bouton « Modifier la candidature ».
1. Ouvrir le dossier de Awa (créé en 17.9, sans sexe ni lieu de naissance). Cliquer « Modifier la candidature » : fenêtre de titre « Modifier la candidature » (« Dossier `<numéro>`. Seuls les champs modifiés sont envoyés. »).
2. Renseigner « Sexe » = « Féminin », « Lieu de naissance » `Abobo` ; cliquer « Enregistrer ». Message « Candidature mise à jour. » ; les champs apparaissent dans « Informations ».
3. Rouvrir la fenêtre et cliquer « Enregistrer » sans rien changer : message « Aucune modification à enregistrer. ».
4. Conflit : ouvrir le dossier de Kader BAMBA test guide dans deux onglets. Onglet 1 : « Modifier la candidature », changer « Lieu de naissance » en `Cocody`, « Enregistrer ». Onglet 2 (sans recharger) : changer « Établissement précédent » en `École Les Manguiers (test guide)`, « Enregistrer ».
Résultat attendu (4) : l'onglet 2 affiche « Le dossier a été modifié par une autre personne depuis son affichage. Rechargez la dernière version avant de ressaisir vos modifications. » avec le bouton « Recharger la dernière version » ; rien n'est écrasé ; après rechargement, `Cocody` est affiché.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| « Prénoms » vidé | "Libellé obligatoire." |
| « Date de naissance » future | `La date de naissance n'est pas plausible.` |
| « Mode de prise en charge » = « Affecté par l'État » sans référence | « La référence d'affectation est obligatoire pour une affectation de l'État. » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : le bouton est absent pour un rôle sans `admission.update`; sur un dossier clos (refusé, inscrit) il est absent pour tous

#### 17.12 Consentement parental et passage à "Candidature reçue"
Compte : chargé d'admissions · Où : dossier de Awa COULIBALY test guide > « Étape et décisions » et « Tuteurs et consentement ».
1. Dans « Étape et décisions », les boutons sont nommés d'après l'étape visée : seul "Candidature reçue" est proposé depuis "Brouillon". Cliquer "Candidature reçue".
2. Constater le refus : bandeau d'erreur `le consentement parental est requis avant l'étape SUBMITTED` (message technique du serveur, Mineur). Le dossier reste en "Brouillon".
3. Dans « Tuteurs et consentement », cliquer « Consigner un consentement » : fenêtre « Consigner un consentement parental » :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Tuteur | `Mariam COULIBALY test guide` | oui |
   | Version du texte accepté | `tg1` (version en vigueur, présélectionnée) | oui |
   | Mode de recueil | « Document papier » (autre choix : « Saisi par le personnel ») | oui |
   | Référence de la pièce justificative | `REG-TG-2026-001` | oui, 3 caractères au moins |
   Cliquer « Enregistrer le consentement ».
4. La section affiche « Consentement valide » et une ligne de la forme "Traitement des données · vtg1 · Document papier · `<date>`" (l'écran préfixe la version par `v` quand elle n'en porte pas déjà un).
5. Cliquer de nouveau "Candidature reçue" : message `Dossier passé à l'étape "Candidature reçue".` ; la pastille de statut devient « Déposée ».
6. Répéter pour les quatre autres dossiers TG (consentement papier, références `REG-TG-2026-002` à `REG-TG-2026-005`, puis "Candidature reçue").
Résultat attendu : le passage est refusé sans consentement valide, accepté avec ; l'historique ajoute "Brouillon → Candidature reçue".
Cas invalides :
| Saisie | Message attendu |
|---|---|
| « Référence de la pièce justificative » `ab` (2 caractères) | message de borne (« Au moins 3 caractères. ») |
| « Version du texte accepté » inconnue (saisie libre si aucune version n'est listée) | `Version du texte de consentement inconnue ou retirée.` |
| « Tuteur » non choisi | « Choix invalide. » |
Remarque : l'alerte rouge de l'étape 2 peut rester affichée après le succès de l'étape 5 (écart connu, Mineur, rapport de la session 06).
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : le consentement ne peut pas être consigné par un rôle sans `admission.update`

#### 17.13 Pièces du dossier : déposer, consulter, accepter, rejeter
Compte : chargé d'admissions · Où : dossier de Ibrahim TRAORE test guide, section « Pièces du dossier » · Prérequis : la pièce "Acte de naissance test guide" créée en 17.7 ; dossier à l'étape "Candidature reçue".
1. La section liste "Acte de naissance test guide (obligatoire)" avec la pastille « Manquante » ; en tête de dossier, le bandeau `Pièces manquantes : TG_ACTE_NAISSANCE.` (ou le libellé) apparaît.
2. Cliquer « Déposer » et choisir `17-piece-acte-naissance-test-guide.pdf`. La pastille passe à « À contrôler », avec « Déposée le `<date>` ».
3. Cliquer « Consulter » : le fichier s'ouvre dans un nouvel onglet (lien signé de courte durée).
4. Cliquer « Accepter » : la pastille devient « Acceptée » ; le bandeau "Pièces manquantes" disparaît.
5. Sur le dossier de Awa : « Déposer » le même fichier puis « Rejeter » : fenêtre « Rejeter la pièce : Acte de naissance test guide », « Motif du rejet » `Copie illisible (test guide)`, bouton « Rejeter » : pastille « Rejetée », texte `Rejetée : Copie illisible (test guide)`. Déposer ensuite `17-piece-bulletin-precedent-test-guide.pdf` via « Remplacer » : la pastille repasse à « À contrôler », le compteur indique "2 dépôts". « Accepter ».
6. Sur les dossiers de Kader, Salimata et Yao : ne rien déposer pour l'instant.
Résultat attendu : états successifs « Manquante », « À contrôler », « Acceptée » ou « Rejetée » ; le motif de rejet est conservé.
Cas invalides :
| Fichier ou saisie | Message attendu |
|---|---|
| `17-piece-vide-test-guide.pdf` (0 octet) | `Le fichier est vide.` |
| `17-piece-format-refuse-test-guide.txt` | message de reconnaissance du type de fichier (texte exact à relever) ou `Ce type de fichier n'est pas accepté pour cette pièce.` |
| `17-piece-faux-pdf-test-guide.pdf` (texte renommé) | même refus : le type est lu dans les octets, pas dans l'extension |
| `17-piece-photo-identite-test-guide.png` | accepté (formats PDF, JPEG, PNG, WebP) |
| Rejet avec « Motif du rejet » de 2 caractères | « Le motif doit comporter au moins 3 caractères. » |
| Stockage de fichiers non configuré | message de service indisponible (à relever ; voir "À vérifier en test") |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : « Déposer », « Accepter », « Rejeter » absents pour un rôle sans `admission.document.upload` / `admission.document.review`

#### 17.14 Planifier un test ou un entretien
Compte : chargé d'admissions · Où : dossier de Ibrahim TRAORE test guide, section « Tests et entretiens » (visible si la fonction "tests et entretiens" est incluse).
1. Cliquer « Planifier » : fenêtre « Planifier un test ou un entretien » : « Nature » = « Entretien », « Date et heure » `2026-10-15T10:00`, « Lieu » `Bureau du directeur (test guide)` ; « Planifier ». L'entretien est « Planifié ».
2. Cliquer « Renseigner » : fenêtre « Résultat du test ou de l'entretien » : « Déroulement » = « Réalisé », « Note » `14`, « Barème » `20`, « Résultat » = « Admis » (choix : « Pas de résultat », « Admis », « Non admis », « Sans objet »), « Observations » `Candidat attentif (test guide)` ; « Enregistrer ». La ligne affiche « Note : 14 / 20 » et le résultat « Admis » (ce résultat est celui de l'entretien, pas la décision d'admission).
3. Planifier un second entretien « Test » le `2026-10-16T09:00`, puis « Renseigner » avec « Déroulement » = « Annulé ».
Résultat attendu : planification, saisie du résultat, annulation. Aucune convocation n'est envoyée à la famille.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| « Date et heure » vide | « La date et l'heure sont obligatoires. » |
| « Déroulement » = « Réalisé » sans « Résultat » | `Un entretien terminé porte son résultat (réussi, échoué, sans objet).` |
| « Note » `25` pour « Barème » `20` | `La note exige une échelle et ne la dépasse pas.` |
| « Note » `abc` | « Note ou barème invalide. » |
| « Barème » `0` | « Note ou barème invalide. » |
Il n'existe pas de modification de la date ou du lieu d'un entretien planifié (seul « Renseigner ») : écart connu, Mineur.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : « Planifier » absent sans `admission.interview.manage`

#### 17.15 Passer à l'étude, pièces manquantes et détection des doublons
Compte : chargé d'admissions · Où : dossiers TG.
1. Sur les cinq dossiers TG à l'étape "Candidature reçue" : cliquer "En étude" (dans « Étape et décisions ») ; message `Dossier passé à l'étape "En étude".`.
2. Sur le dossier de Kader : cliquer "Pièces manquantes" (depuis "En étude", transition permise au chargé), puis de nouveau "En étude" pour revenir. Constater que seules ces actions de traitement sont proposées (voir 17.16 pour les décisions).
3. Dans « Doublons possibles » du dossier d'Ibrahim : cliquer « Relancer la détection » : le texte « Aucun doublon détecté. » reste affiché (les cinq dossiers TG n'ont ni même nom ni même date de naissance).
4. Facultatif (doublon avec un élève existant) : créer, dans la campagne `TG-2027`, un dossier au nom exact d'un élève de la graine (`Nadia` / `DIABATE`, naissance `2014-01-19`, tuteur de nom `DIABATE test guide`) : c'est la seule exception à la règle du suffixe, justifiée par la détection. Ouvrir ce dossier : la section « Doublons possibles » peut proposer « Élève existant » avec « Ressemblance `<score>` » et les boutons « Confirmer le doublon » / « Écarter » ; cliquer « Écarter » (statut « Écarté »). Laisser ce dossier en "Brouillon" (ne pas le décider).
Résultat attendu : étapes "En étude" et "Pièces manquantes" atteintes ; la détection ne produit aucun faux positif sur les dossiers TG. Résultat du point 4 : à vérifier en test (la détection d'un nom très proche n'est pas garantie).
Cas invalides : tentative de "Refusé" ou "Admis" par le chargé : boutons absents (17.16).
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le chargé : "Admis", "Refusé" absents

#### 17.16 Décisions de la direction : Admis, Liste d'attente, Refusé, motifs, capacité
Compte : d'abord le chargé (contrôle négatif), puis directeur (collège, MFA) · Où : dossiers TG, « Étape et décisions ».
1. Chargé d'admissions : ouvrir le dossier d'Ibrahim (étape "En étude") : seule l'action de traitement ("Pièces manquantes") est proposée. Aucun bouton "Admis", "Liste d'attente", "Refusé", "Retiré par la famille", "Dossier en double". Pas de bouton « Exporter le dossier » ni « Anonymiser » dans « Données personnelles ». Idem pour le secrétariat.
2. Directeur : ouvrir le dossier d'Ibrahim. Les boutons disponibles portent le nom de l'étape visée : "Admis", "Liste d'attente", "Refusé", "Retiré par la famille", "Dossier en double", "Pièces manquantes".
3. Cliquer "Admis" : fenêtre « Acceptation » (« Étape visée : Admis. La décision est journalisée avec son motif et ne peut plus être modifiée. ») avec « Motif » (liste des motifs d'acceptation : "Candidature retenue"), « Précisions », « Conditions de l'acceptation », et, si la capacité est atteinte, l'avertissement correspondant. Choisir "Candidature retenue", « Conditions de l'acceptation » `Remise du bulletin du trimestre en cours (test guide)`, cliquer « Enregistrer : Acceptation ». Message `Décision "Acceptation" enregistrée : dossier à l'étape "Admis".`. Ibrahim passe à "Admis" (statut « Acceptée »), places restantes 1.
4. Même décision pour Awa (pièce "Acte de naissance test guide" acceptée en 17.13). Places restantes 0.
5. Dossier de Kader (aucune pièce déposée, la pièce `TG_ACTE_NAISSANCE` est obligatoire) : cliquer "Admis", choisir "Candidature retenue", enregistrer : refus `pièces non acceptées : ` suivi du code ou du libellé de la pièce.
6. **Désactiver la pièce exigée** : se rendre dans `/v2/admissions/settings`, section « Pièces à fournir », cliquer « Désactiver » sur "Acte de naissance test guide". Revenir sur Kader et refaire "Admis" : refus de capacité `2 places occupées pour 2 (niveau 6E)` ; la fenêtre « Acceptation » affichait « Aucune place n'est disponible à ce niveau : l'acceptation sera refusée sauf dépassement autorisé. » et la case « Dépasser la capacité » (« Permission sensible : un motif d'au moins 10 caractères est obligatoire. »). Ne pas cocher (voir 17.25).
7. Kader : cliquer "Liste d'attente" : fenêtre « Mise en liste d'attente », « Motif » = "Capacité d'accueil atteinte : candidature placée en liste d'attente" ; « Enregistrer : Mise en liste d'attente ». Idem pour Salimata (liste d'attente).
8. Yao : cliquer "Refusé" sans « Motif » : "Un refus ou un retrait cite un motif codé." sous « Motif » ; choisir "Motif de refus test guide" (créé en 17.7) ; « Enregistrer : Refus ». Yao passe à "Refusé" (statut « Refusée »).
9. Ouvrir « Historique » de chaque dossier : « Décisions formelles » avec le motif et « Par `<nom du directeur>` ».
Résultat attendu : chaque décision exige un motif quand elle refuse ou retire, est journalisée avec son auteur, et ne se modifie plus. Les dossiers Ibrahim et Awa retiennent les 2 places de la campagne.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| "Refusé" sans motif | "Un refus ou un retrait cite un motif codé." |
| "Refusé" avec un motif d'une autre nature (par exemple "Candidature retenue") | la liste ne propose que les motifs de la nature ; message API : `Ce motif n'est pas un motif de type REJECT.` |
| "Admis" avec les pièces non acceptées | `pièces non acceptées : ...` |
| "Admis" capacité atteinte (politique stricte) | `2 places occupées pour 2 (niveau 6E)` |
| "Liste d'attente" au-delà de la limite de 5 | `la liste d'attente compte déjà 5 dossiers (plafond 5)` (non atteint ici) |
| Deux fenêtres ouvertes sur le même dossier, décision dans la première puis seconde | `Le dossier a été modifié par une autre personne : rechargez-le.` ou `la décision part d'une étape qui n'est plus l'étape courante du dossier` |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le chargé et le secrétariat

#### 17.17 Offres de place : émettre, classe, lien de réponse, retirer
Compte : chargé d'admissions · Où : dossiers de Awa et d'Ibrahim, section « Offres de place » · Prérequis : dossiers à "Admis" (17.16) ; lien public créé (17.8).
1. Dossier de Awa : la section affiche « Aucune offre émise. » et le bouton « Émettre une offre » (visible seulement pour un dossier "Admis" sans offre en attente).
2. Cliquer « Émettre une offre » : fenêtre « Émettre une offre de place » (« Validité par défaut : 14 jours. La place est réservée jusqu'à la réponse de la famille ou l'échéance. ») : « Classe » = la classe proposée (par exemple `6e A`) ou « À préciser plus tard » (une classe unique du niveau est alors retenue d'office), « Conditions » `Remise de l'acte de naissance original (test guide)`, « Validité en jours » (laisser vide) ; bouton « Émettre une offre ».
3. La fenêtre « Offre émise » indique l'état des notifications (« La notification est en file d'envoi. » ou « Aucune notification n'a été envoyée : transmettez le lien à la famille. ») et affiche « Lien de réponse de la famille » de la forme `http://localhost:3000/v2/apply/<lien>/offer#t=<jeton>` avec le bouton « Copier » et le texte « Ce lien n'est affiché qu'une seule fois : seule son empreinte est conservée. ». **Copier le lien et le conserver** (nommé LIEN-AWA), puis « Fermer ».
4. La section montre l'offre « En attente de réponse », « Échéance : `<date à 14 jours>` » et les boutons « Désigner la classe », « Accepter au nom de la famille », « Retirer l'offre ».
5. Dossier d'Ibrahim : « Émettre une offre » avec « Validité en jours » `3`, copier le lien (LIEN-IBRAHIM-1). Puis cliquer « Retirer l'offre » : fenêtre « Retirer l'offre » (« La place est libérée ; la famille ne pourra plus répondre. »), « Motif du retrait » `Erreur de saisie de la classe (test guide)`, bouton « Retirer l'offre » : l'offre passe à « Retirée ». Vérifier dans le dossier si « Places restantes » a changé (écart n°2 : attendu inchangé). Le dossier reste "Admis" ; émettre une seconde offre (validité `14`) et copier le lien (LIEN-IBRAHIM-2).
6. Essayer d'ouvrir LIEN-IBRAHIM-1 en 17.18 : l'offre est retirée.
Résultat attendu : l'offre est « En attente de réponse » avec son échéance ; le lien n'est montré qu'une fois.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| « Validité en jours » `0` ou `400` | message de borne ("La valeur doit être supérieure ou égale à 1.") |
| « Émettre une offre » deux fois de suite sur le même dossier | le bouton disparaît ; côté API : `Une offre est déjà en attente pour cette candidature.` |
| « Retirer l'offre » avec « Motif du retrait » de 2 caractères | « Le motif doit comporter au moins 3 caractères. » |
| « Désigner la classe » sans choix | « Choisissez une classe. » |
| Émettre une offre sans lien public créé | « Le lien public de l'établissement n'est pas encore créé : créez-le dans les paramètres pour obtenir le lien de réponse. » (le jeton est perdu : retirer l'offre et la réémettre) |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : « Émettre une offre » absent sans `admission.offer.manage`; « Accepter au nom de la famille » absent sans `admission.enroll`

#### 17.18 Portail public : réponse de la famille à une offre
Compte : aucun compte requis (la page s'ouvre aussi connecté ; pour le prouver, ouvrir le lien dans un onglet de navigation privée ou après déconnexion si c'est possible) · Où : LIEN-AWA puis LIEN-IBRAHIM-2 (`/v2/apply/<lien>/offer#t=<jeton>`).
1. Ouvrir LIEN-AWA. Titre « Proposition de place à Collège Le Baobab (démonstration) » (nom de l'établissement), « Vous pouvez accepter ou décliner cette proposition. », puis « Niveau », « Classe » (ou « Précisée par l'établissement »), « À accepter avant le » et « Conditions ».
2. Cliquer « Décliner la place » puis, dans la confirmation, « Retour » (sans confirmer). Cliquer « Accepter la place » : texte « Confirmez-vous l'acceptation de cette place ? L'établissement vous indiquera les frais d'inscription à régler. » ; cliquer « Accepter la place » pour confirmer.
3. Page « Place acceptée » avec le message `Merci : votre acceptation est enregistrée. L'établissement vous indiquera les frais d'inscription à régler pour confirmer l'inscription.`.
4. Côté chargé : dossier de Awa : offre « Acceptée », étape "Inscription en attente de paiement", section « Inscription » : « Inscription en attente : elle sera confirmée au règlement des frais d'inscription. » avec les liens « Dossier de l'élève » et « Fiche d'inscription » (selon le droit). Un élève nommé `COULIBALY TEST GUIDE Awa` (nom en capitales, affichage à relever) est créé en statut inactif, avec une inscription en attente et une facture des frais d'inscription (25 000 F CFA au collège).
5. Rouvrir LIEN-AWA : « Cette proposition a déjà été acceptée. » ; aucun deuxième élève ni deuxième facture.
6. Ouvrir LIEN-IBRAHIM-2, cliquer « Décliner la place », puis dans la confirmation « Confirmez-vous que vous déclinez cette place ? Elle sera proposée à une autre famille. » > « Décliner la place ». Page « Place déclinée » avec `Votre réponse est enregistrée. La place sera proposée à une autre famille.`. Côté chargé : le dossier d'Ibrahim est "Retiré par la famille", la place est libérée (la campagne retrouve 1 place libre).
7. Ouvrir LIEN-IBRAHIM-1 (offre retirée) : « Cette proposition a été retirée. Contactez l'établissement. ».
Résultat attendu : acceptation et refus ne se rejouent pas ; l'acceptation crée élève, inscription et facture ensemble.
Cas invalides (aucune donnée de dossier n'apparaît) :
| Adresse | Message attendu |
|---|---|
| lien tronqué (supprimer `#t=...`) | « Ce lien est incomplet. Utilisez le lien exact reçu de l'établissement. » |
| jeton inventé (modifier quelques caractères après `#t=`) | « Ce lien n'est pas ou plus valide. » |
| `<lien>` inventé (16 caractères minuscules) | « Ce lien n'est pas ou plus valide. » |
| dossier dont le sexe du candidat est absent, acceptation | l'API refuse (`Le sexe du candidat est obligatoire pour créer le dossier de l'élève.`) mais la page affiche "Ce lien n'est pas ou plus valide." (écart n°6) |
Autres cas (non reproductibles en une session) : offre expirée (« Cette proposition est arrivée à échéance. Contactez l'établissement. ») : la validité minimale est d'un jour.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit : page publique sans connexion

#### 17.19 Paiement des frais d'inscription et passage à "Inscrit"
Compte : économe (collège, MFA) puis chargé d'admissions · Où : `/v2/finance/payments/new` (écran d'encaissement, chapitre Finances), puis dossier de Awa · Prérequis : 17.18.
1. Avec `econome@secondaire-test.test`, retrouver la facture de l'élève `COULIBALY TEST GUIDE Awa` (frais d'inscription, 25 000 F CFA) et enregistrer un règlement du montant total (mode virement, référence `VIR-TG-AWA-001`). Voir le chapitre Finances pour le détail du formulaire.
2. Avec le chargé, attendre quelques secondes puis recharger le dossier de Awa : étape "Inscrit", statut « Inscrit », texte « Inscription confirmée le `<date>`. ».
3. Vérifier qu'aucun bouton ne permet de poser « Inscrit » à la main (il n'y a que des actions de retrait pour la direction).
Résultat attendu : l'inscription se confirme automatiquement après le paiement ; le délai dépend du traitement en arrière-plan (quelques secondes).
Cas invalides : règlement partiel (par exemple 10 000 F CFA) : le dossier reste "Inscription en attente de paiement" (à vérifier en test).
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : un parent ne peut pas consulter le dossier (`/v2/admissions/applications/<id>`)

#### 17.20 Liste d'attente : lecture, ordre manuel de la direction, promotion
Compte : chargé d'admissions puis directeur · Où : menu « Listes d'attente » (`/v2/admissions/waitlist`) · Prérequis : Kader et Salimata en liste d'attente (17.16) ; une place libre (17.18, point 6).
1. Chargé : ouvrir « Listes d'attente » : titre « Listes d'attente », texte « Choisissez un niveau pour afficher sa liste d'attente. ». Choisir la campagne `TG-2027` puis le niveau 6e (« Choisir un niveau »). Indication "1 place libre · Limite de la liste : 5".
2. Le tableau « Liste d'attente du niveau » (colonnes « Rang », « Candidat », « Priorité », « En attente depuis », actions) montre Kader et Salimata avec « À classer » à la place du rang et l'avis « Des dossiers n'ont pas encore de rang décidé : ils sont listés après les dossiers classés et ne sont jamais promus d'office. La direction les classe avec les boutons Monter et Descendre. ». Les boutons « Monter »/« Descendre » ne sont pas visibles pour le chargé.
3. Cliquer « Promouvoir le premier de la liste » : message `Aucune promotion : NOT_RANKED` (code brut, Mineur) ; aucune offre n'est émise.
4. Directeur : même écran. Cliquer « Monter » sur Salimata : l'ordre provisoire devient Salimata (1), Kader (2) ; les boutons « Promouvoir » se désactivent. Saisir « Motif (facultatif) » `Priorité à la fratrie (test guide)` et cliquer « Enregistrer l'ordre » : message « L'ordre de la liste d'attente est enregistré. » ; le tableau montre les rangs 1 et 2 ; le bloc « Derniers changements de rang » liste les lignes `<nom> : rang <de> vers <à> (<date>)`. Tester « Annuler les changements » sur un second déplacement non enregistré.
5. Chargé ou directeur : cliquer « Promouvoir le premier de la liste » : message « Une offre a été émise. » avec « Lien de réponse de la famille » (une seule fois). Salimata passe à "Admis" avec une offre en attente ; la place libre retombe à 0.
6. La place est maintenant reprise : cliquer « Promouvoir Kader BAMBA test guide » (bouton de la ligne) renvoie `Aucune promotion : NO_SEAT`.
Résultat attendu : l'ordre est une décision de la direction (aucun calcul à l'ancienneté) ; seule la tête d'un rang décidé est promue d'office ; désigner un dossier avec « Promouvoir `<nom>` » reste possible.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Ordre enregistré pendant qu'un autre utilisateur a changé la liste | `La liste d'attente a changé : rechargez-la avant de la réordonner.` |
| Motif de 2 caractères | "Motif d'au moins 3 caractères." |
| Promotion sans place libre | `Aucune promotion : NO_SEAT` |
| Promotion d'un dossier qui n'est plus en liste | `Aucune promotion : NOT_WAITLISTED` |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : les boutons « Monter »/« Descendre » sont absents pour le chargé

#### 17.21 Rapports de recrutement
Compte : chargé d'admissions ou directeur · Où : menu "Recrutement : tableaux de bord" (`/v2/admissions/reports`).
1. Ouvrir « Rapports d'admission » ; choisir la campagne `RENTREE-6E` : cinq blocs « Entonnoir » (« Reçues », « Traitées », « Délai moyen (h) », tableau « Statut » / « Dossiers »), « Capacités » (« Niveau », « Places », « Libres », « Retenues », « En attente »), « Délais par étape » (« Étape », « Délai cible (h) », « Dans l'étape », « En retard », « Durée moyenne (h) »), « Sources » (« Origine », « Reçues », « Inscrits »), « Motifs de refus » (« Motif », « Dossiers »).
2. Comparer l'entonnoir au pipeline : un dossier par statut, Hervé KRA en motif "Dossier incomplet" dans « Motifs de refus », ligne `WALK_IN` dans « Sources » (code brut, Mineur).
3. Choisir `TG-2027` : « Capacités » montre 6E avec 2 places, 0 libres (ou 1 selon l'avancement), 1 ou 2 retenues, liste d'attente ; « Motifs de refus » montre "Motif de refus test guide" (1) et le retrait par la famille.
4. Campagne sans dossier : tableaux vides sans erreur.
Résultat attendu : les chiffres sont cohérents avec le pipeline, à une réserve connue : "Reçues" exclut les brouillons alors que "Sources" les compte (écart du rapport de session 06, Mineur).
Cas invalides : aucun formulaire. Droit : l'économe qui tape l'adresse obtient "Accès refusé".
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour l'économe

#### 17.22 Workflow : lire, créer un brouillon, voir les défauts, supprimer
Compte : directeur (collège, MFA) · Où : menu "Parcours d'admission" (`/v2/admissions/settings/workflow`).
1. Ouvrir « Workflow d'admission » : la liste « Workflows de l'établissement » montre "Parcours d'admission standard" (v1, « Publié », 12 étapes). Dans le détail : texte « Ce workflow est gelé. Créez une nouvelle version pour le faire évoluer. », tableau « Étapes » (colonnes « Ordre », « Étape », « Statut canonique », « Règles », « Délai (h) ») avec des règles lisibles (« Étape initiale », « Exige le consentement », « Exige les pièces complètes », « Exige une décision formelle », « Crée l'inscription »), liste « Transitions » avec la permission requise (`admission.update`, `admission.decide`, `admission.enroll`), mentions « Motif obligatoire » et « Automatique ».
2. Cliquer « Nouveau workflow » : « Code » `TG_PARCOURS`, « Libellé » `Parcours test guide`, « De » = « Modèle livré » ; « Créer ». Le brouillon apparaît (v1, « Brouillon »). Aucun défaut n'est signalé (la copie du modèle est valide).
3. Dans « Étapes », décocher « Étape initiale » sur l'étape "Brouillon" puis « Enregistrer les étapes » : message « Étapes enregistrées. » et bloc « À corriger avant la publication » avec la liste des défauts (libellé exact à relever, par exemple à propos de l'étape initiale).
4. Rétablir « Étape initiale » et « Enregistrer les étapes » : le bloc disparaît. Facultatif : modifier le « Libellé » d'une étape.
5. Cliquer « Supprimer le brouillon » : fenêtre « Supprimer le brouillon » (« Seul un brouillon sans campagne peut être supprimé. ») ; confirmer. Le brouillon disparaît.
6. **Ne pas cliquer « Publier »** (acte sensible, MFA : remplacerait le parcours standard pour les nouvelles campagnes) ; « Nouvelle version » sur le parcours publié crée un brouillon v2 qu'il faut alors supprimer.
Résultat attendu : un workflow publié n'est pas modifiable ; un brouillon se modifie, se contrôle et se supprime.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| « Code » `TG-PARCOURS` (tiret) | message commençant par "Code en majuscules, chiffres et" (texte à relever) |
| « Code » vide ou « Libellé » vide | "Libellé obligatoire." pour le libellé |
| « De » = « Copie d'un workflow existant » sans « Workflow à copier » | "Le workflow à copier est obligatoire." |
| Créer deux fois le même code et la même version | `Ce code et cette version de workflow existent déjà.` |
| Étape supprimée qui laisse une étape sans issue | défaut listé dans « À corriger avant la publication » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le chargé (`/v2/admissions/settings/workflow`)

#### 17.23 Exporter puis anonymiser un dossier refusé
Compte : directeur (collège, MFA) · Où : dossier de Yao KOUASSI test guide ("Refusé"), section « Données personnelles ».
1. Cliquer « Exporter le dossier » : un fichier `dossier-<numéro>.json` est téléchargé (demander l'accord avant tout téléchargement). Aucune donnée n'est modifiée.
2. **Action irréversible.** Cliquer « Anonymiser » : fenêtre « Anonymiser le dossier » (« L'identité, les contacts et les pièces sont effacés. Les décisions et les statistiques sont conservées sans donnée personnelle. »), « Motif de l'anonymisation » `Demande de la famille (test guide)` (10 caractères au moins), bouton « Anonymiser ».
3. Le dossier affiche « Ce dossier est anonymisé. », le nom est remplacé par « Dossier anonymisé » dans la liste et le pipeline, plus aucune action n'est proposée.
Résultat attendu : identité, contacts et pièces effacés ; décisions et statistiques conservées.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| « Motif de l'anonymisation » de 5 caractères | « Le motif doit comporter au moins 10 caractères. » |
| Anonymiser le dossier de Awa (inscrit) | refus : `Seule une candidature close sans inscription s'anonymise (un dossier inscrit relève de people).` (le bouton est proposé, le refus vient de l'API) |
| Anonymiser un dossier "Admis" ou "En étude" | même refus |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : « Exporter le dossier » et « Anonymiser » absents pour le chargé et le secrétariat

#### 17.24 Rattacher les pièces acceptées au dossier de l'élève (secrétariat)
Compte : secrétariat (collège, MFA) · Où : dossier de Awa ("Inscrit"), section « Dossier permanent de l'élève ».
1. Le texte "1 pièce acceptée peut être rattachée." est affiché avec le bouton « Rattacher les pièces acceptées au dossier de l'élève ».
2. Cliquer : fenêtre « Rattacher les pièces au dossier de l'élève » ; choisir une « Catégorie de la gestion documentaire » ; cocher « Je confirme le rattachement de ces pièces au dossier de l'élève. » ; « Rattacher ».
3. Un compte rendu s'affiche : « 1 rattachée(s), 0 déjà présente(s) ignorée(s), 0 en échec. » ; relancer : la pièce est « Déjà présente ».
Résultat attendu : rattachement différé et confirmé par une personne. Si aucune catégorie n'est proposée : « Aucune catégorie d'élève ne vous autorise le dépôt. » (à relever).
Cas invalides : sans catégorie : « Choisissez une catégorie. » ; sans case cochée : « Cochez la case pour confirmer. » ; chargé d'admissions : la section est absente (pas de `admission.document.attach`).
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le chargé

#### 17.25 Dépassement de capacité (politique "Souple") : scénario facultatif de fin
Compte : directeur (collège, MFA) · Où : `/v2/admissions/settings` puis dossier de Kader BAMBA test guide ("Liste d'attente") · À faire seulement à la fin, car il change la politique de capacité.
1. Sans changer la politique : sur le dossier de Kader, cliquer "Admis" ; cocher « Dépasser la capacité » avec « Précisions » `court` (5 caractères) > "Un dépassement de capacité exige un motif d'au moins 10 caractères.". Avec un motif de 10 caractères ou plus : le refus de capacité demeure en politique « Stricte : jamais au-delà des places ».
2. Passer « Capacité » à « Souple : dépassement possible avec motif » (17.6, « Enregistrer »), refaire "Admis" avec la case cochée et « Précisions » `Fratrie de deux enfants déjà inscrits (test guide)` : la décision est enregistrée ; l'historique affiche le badge « Capacité dépassée ».
3. **Remettre « Capacité » à "Stricte"** et enregistrer.
Résultat attendu : le dépassement n'est possible qu'en politique souple, avec un motif.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : la case est absente pour un rôle sans `admission.capacity.override`

#### 17.26 Portail public : formulaire de candidature et suivi par code
Compte : aucun · Où : `/v2/apply/<lien>` et `/v2/apply/<lien>/track` · Prérequis : lien et texte de consentement créés (17.8).
1. Ouvrir `http://localhost:3000/v2/apply/<lien>`. Résultat attendu d'après le code : le message "Ce formulaire n'est pas disponible." (écart n°1 : le réglage "formulaire public ouvert" n'est posable par aucun écran). Consigner ce que l'on voit.
2. Si l'équipe technique a ouvert le formulaire (réglage `publicFormEnabled`), dérouler le dépôt : titre « Candidature à Collège Le Baobab (démonstration) » (nom de l'établissement) et phrase « Remplissez ce formulaire pour candidater. Aucun compte n'est créé ; un code de suivi vous sera remis. » ; bloc « L'enfant » (« Prénoms » `Famille`, « Nom » `PUBLICTEST test guide`, « Date de naissance » `2014-04-18`, « Lieu de naissance » `Cocody`, « Sexe », « Établissement précédent », « Niveau demandé », « Prise en charge » = « Par la famille »), bloc « Parent ou tuteur 1 » (« Lien de parenté », « Prénoms », « Nom », « Téléphone » ou « Adresse e-mail »), bloc « Consentement parental » (texte, « Version du texte : tg1 », case « J'ai lu le texte ci-dessus et j'y consens en tant que parent ou tuteur légal. »), avertissement « Ne saisissez aucune donnée de santé, de religion ni de situation financière dans ce formulaire : l'établissement vous contactera si nécessaire. » ; attendre au moins la durée du "Délai minimal de saisie" puis « Envoyer ma candidature ». Page « Candidature reçue » avec « Votre code de suivi » et « Conservez ce code : il est nécessaire pour suivre votre dossier et il ne sera plus affiché. ».
3. Ouvrir `/v2/apply/<lien>/track` : titre « Suivi de ma candidature », champ « Code de suivi » (aide « Espaces et tirets sont ignorés. »), bouton « Suivre ». Saisir `ABCDEFGH1234` : « Aucun dossier ne correspond à ce code. » ; saisir `ABC` : même message sans appel réseau ; lien « Retour au formulaire ».
4. Les dossiers créés par le personnel n'ont pas de code de suivi : ils ne peuvent pas être suivis ici. Avec un code réel (formulaire ouvert) : « État de votre dossier » avec la phase (par exemple « Candidature reçue »), « Mis à jour le `<date>` » ; si des pièces sont demandées : liste « Pièces à fournir », bouton « Déposer », texte « Formats acceptés : PDF, JPEG, PNG ou WebP. », confirmation « Pièce reçue, merci. » ; pièce refusée : « Pièce refusée : `<motif>` ».
5. Faire plusieurs dizaines de recherches de code faux : « Trop de demandes depuis votre connexion. Réessayez dans quelques minutes. » (limitation volontaire ; facultatif).
Résultat attendu : réponses neutres (aucune fuite sur l'existence d'un dossier, d'un doublon ou d'un effectif). Formulaire envoyé avec le champ leurre rempli : même réponse qu'un envoi normal (non testable à la main).
Cas invalides (si le formulaire est ouvert) :
| Saisie | Message attendu |
|---|---|
| case de consentement non cochée | « Le consentement parental est obligatoire pour envoyer la candidature. » |
| « Prise en charge » = « Élève affecté par l'État » sans « Référence d'affectation » | « La référence d'affectation est obligatoire pour un élève affecté par l'État. » |
| « Prénoms » vide | "Libellé obligatoire." |
| aucun téléphone ni e-mail | "Un moyen de contact (téléphone ou e-mail) est obligatoire pour chaque tuteur." |
| envoi plus rapide que le "Délai minimal de saisie" | « Vérifiez les informations saisies, puis réessayez. » |
| lien désactivé ou inventé | "Ce formulaire n'est pas disponible." (même message dans les deux cas) |
Lien désactivé : refaire 17.8 point 4 (« Désactiver le lien »), rouvrir la page : "Ce formulaire n'est pas disponible." ; réactiver.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit : page publique, sans connexion

#### 17.27 Droits : adresses interdites et séparation des tâches
Compte : plusieurs · Où : adresses tapées dans la barre d'adresse.
1. Connecté en **chargé d'admissions** : taper `/v2/admissions/settings`, puis `/v2/admissions/settings/workflow` : redirection vers `/unauthorized`, page "Accès refusé". `/v2/admissions/campaigns` : lisible, sans boutons de création.
2. Connecté en **enseignant** : taper `/v2/admissions`, `/v2/admissions/applications`, `/v2/admissions/applications/new`, `/v2/admissions/reports` : "Accès refusé" ; aucun élément « Admissions » dans le menu.
3. Connecté en **parent** : taper `/v2/admissions/waitlist`, `/v2/admissions/prospects`, `/v2/admissions/campaigns` : "Accès refusé".
4. Connecté en **économe** : taper `/v2/admissions/applications`, `/v2/admissions/reports` : "Accès refusé".
5. **Non connecté** : taper `/v2/admissions` : redirection vers `/login`.
6. Isolation : copier l'adresse d'un dossier du collège (`/v2/admissions/applications/<id>`), se connecter à l'université avec `admissions@superieur-test.test` et ouvrir la même adresse : le dossier est introuvable, aucune donnée du collège n'apparaît. Réponse exacte à relever.
7. Séparation des tâches : le chargé ne voit jamais "Admis", "Refusé", « Exporter le dossier », « Anonymiser », la case « Dépasser la capacité » (17.16, 17.23, 17.25).
Résultat attendu : refus sans données, jamais une page blanche.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour les rôles ci-dessus

#### 17.28 École Les Palmiers (primaire avec maternelle) : variantes
Compte : chargé d'admissions et directeur (école) · Où : mêmes écrans.
1. Lire le pipeline de la campagne `RENTREE-MATERNELLE` : 13 dossiers dont 5 inscrits (colonne "Inscrit"), Fabrice GUEI en "Inscription en attente de paiement", Grâce HIEN en "Admis" (offre émise), Hervé KRA "En étude", Inès LOBA "Candidature reçue", Jonas MEL "Pièces manquantes", Karine NAMA "Liste d'attente", Lazare OKOU "Refusé", Martine PEHE "Brouillon". La capacité de la campagne est de 17 places en Grande Section.
2. Rejouer 17.5, 17.9, 17.10 à 17.17 avec le niveau "Grande Section" et ces valeurs : campagne `TG-2027` (2 places pour GS), Awa `2021-06-12`, Ibrahim `2021-09-03`, Kader `2021-11-21`, Salimata `2021-02-27`, Yao `2020-12-09` (mêmes noms avec le suffixe "test guide"). Le montant des frais d'inscription à encaisser est de 15 000 F CFA. Le niveau visé du prospect est "Grande Section".
3. Au primaire le menu « Admissions » du chargé est identique ; la fonction « Tests et entretiens » est incluse (vérifier la section du dossier).
4. "Affecté par l'État" : si la fonction `academic.state-assigned` n'est pas incluse dans l'offre de l'école, la création est refusée avec `Les élèves affectés par l'État ne sont pas pris en charge par cet établissement.` (à relever).
Résultat attendu : les mêmes comportements qu'au collège, avec les libellés de niveau et les montants propres à l'école.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour l'enseignant de l'école

#### 17.29 Université Horizon (supérieur) : variantes
Compte : chargé d'admissions et directeur (université) · Où : mêmes écrans.
1. Lire le pipeline de la campagne `RENTREE-L1` : mêmes neuf noms qu'au collège ; niveau Licence 1 ; 13 places.
2. Rejouer les scénarios avec le niveau "Licence 1" : naissances Awa `2007-06-12`, Ibrahim `2007-09-03`, Kader `2006-11-21`, Salimata `2007-02-27`, Yao `2006-12-09` ; frais d'inscription à encaisser 50 000 F CFA ; « Programme » non demandé dans l'écran (le champ n'existe pas dans le formulaire).
3. Vérifier que la liste « Niveau » ne propose que les niveaux du supérieur (Licence 1, etc.).
Résultat attendu : mêmes comportements ; aucune donnée des deux autres établissements.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour l'enseignant de l'université

#### 17.30 Qualité transversale : états vides, chargement, erreurs, clavier
Compte : chargé d'admissions et directeur.
1. États vides : prospects (« Aucun prospect. »), liste d'attente (« Personne n'est en liste d'attente à ce niveau. »), campagnes (« Aucune campagne. »), pièces (« Aucune pièce n'est demandée pour ce dossier. »).
2. Chargement : au premier affichage de chaque écran, un indicateur de chargement précède les données ; recharger une fois avant de signaler une lenteur (mode développement).
3. Erreurs : couper l'API (ou ouvrir un dossier d'un autre établissement) : le bloc d'erreur propose « Réessayer » ; jamais d'écran blanc.
4. Clavier : au clavier seul (Tab, Maj+Tab, Entrée, Échap), parcourir le pipeline (le bouton « Déplacer » de chaque carte), ouvrir et fermer une fenêtre (Échap ferme, le focus revient au bouton qui l'a ouverte), remplir « Nouvelle candidature ». Le focus est visible, l'ordre est logique, aucun piège de focus.
5. Français : relever tout mot anglais, code brut (voir "Écarts constatés avant exécution" n°4) ou faute.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit sans objet

---

## Nettoyage de fin de chapitre

- Campagne `TG-2027` : « Clôturer » (la campagne ne se supprime pas).
- Pièce exigée `TG_ACTE_NAISSANCE` : déjà « Désactiver » en 17.16 (vérifier "Inactive").
- Classe de priorité `TG_PRIORITE` : « Désactiver ». Motif `TG_MOTIF_REFUS` : « Désactiver ».
- Texte de consentement `tg1` : le laisser désigné ou le retirer (« Retirer ») si un autre texte est désigné ; lien public : « Désactiver le lien » si le formulaire doit rester fermé.
- Paramètres : « Validité d'une offre (jours) » remis à `14`, « Capacité » à « Stricte : jamais au-delà des places ».
- Dossiers TG, prospects TG, élève `COULIBALY TEST GUIDE Awa` et sa facture : non supprimables. `pnpm demo:reset` (ou la recréation de la base de démonstration) remet tout à zéro.

## Données créées

| Enregistrement | Détail |
|---|---|
| Campagne `TG-2027` | `Campagne test guide 2027`, 6e : 2 places, liste d'attente limitée à 5 |
| Motif `TG_MOTIF_REFUS` | `Motif de refus test guide` (nature Refus) |
| Classe de priorité `TG_PRIORITE` | `Fratrie test guide`, rang 5 |
| Pièce exigée `TG_ACTE_NAISSANCE` | `Acte de naissance test guide`, obligatoire, niveau 6e (désactivée) |
| Texte de consentement `tg1` | version désignée (ou retirée à la fin) |
| Lien public | actif, code opaque à noter |
| Prospects | `Mariam COULIBALY test guide` (converti), `Seydou KONÉ test guide` (perdu) |
| Dossiers | `Awa COULIBALY test guide` (inscrit), `Ibrahim TRAORE test guide` (retiré par la famille), `Kader BAMBA test guide` (liste d'attente ou admis), `Salimata KONÉ test guide` (admis, offre), `Yao KOUASSI test guide` (refusé, anonymisé) ; dossier facultatif `Nadia DIABATE` (doublon à écarter) |
| Entretiens | un entretien réalisé, un entretien annulé sur Ibrahim |
| Élève et facture | `COULIBALY TEST GUIDE Awa`, frais d'inscription 25 000 F CFA (15 000 à l'école, 50 000 à l'université), règlement `VIR-TG-AWA-001` |
| Brouillon de workflow | `TG_PARCOURS` (supprimé) |

## Écarts constatés

À confirmer à l'écran. Gravités : Bloquant, Majeur, Mineur, Suggestion.

| Écran | Constat | Gravité |
|---|---|---|
| `/v2/apply/<lien>` et paramètres | Le réglage d'ouverture du formulaire public n'a aucune commande à l'écran (`publicFormEnabled`, défaut faux) : le formulaire reste fermé même avec lien et texte. Le suivi par code ne peut être testé positivement. | Majeur |
| Dossier > « Retirer l'offre » | Le texte promet que la place est libérée ; le dossier reste "Admis" et la retient. | Majeur (à vérifier) |
| Page de réponse à une offre | Erreurs 400 et 409 (sexe absent, classe absente, pièces) affichées comme "Ce lien n'est pas ou plus valide." ; erreur 410 (offre expirée) affichée de même. | Mineur à Majeur (à vérifier) |
| Création de candidature | Aucun contrôle d'âge ou de cohérence date de naissance / niveau. | Suggestion |
| Création de candidature | Messages Zod techniques pour "Lien de parenté" et "Niveau" vides. | Mineur |
| Dossier, rapports, liste d'attente | Codes bruts : `MOTHER`, `PRIVATE`, `WALK_IN`, `NOT_RANKED`, `NO_SEAT`, `SUBMITTED` dans un message. | Mineur |
| Doublons | Un doublon exact est refusé à la création sans lien vers le dossier existant ; les doublons proches ne sont pas toujours détectés (rapport de la session 06). | Majeur (décision métier en attente) |
| Entretiens | Pas de modification de la date ou du lieu d'un entretien planifié. | Mineur |
| Rapports | "Reçues" (hors brouillons) et "Sources" (brouillons compris) ne s'accordent pas. | Mineur |
| Liste d'attente | "Promouvoir" par ligne émet une offre pour un dossier "À classer" (contredit "jamais promus d'office" pour le bouton de tête, pas pour la ligne). | Suggestion |

## À vérifier en test

- Rien de ce chapitre n'a pu être exécuté en navigateur ; tous les attendus viennent du code et des messages. Relever en particulier : l'ordre des colonnes du pipeline, la présélection de la campagne après ouverture de `TG-2027`, le texte exact des refus techniques (consentement, pièces non acceptées, capacité).
- Dépôt de pièces : stockage de fichiers configuré ? (sinon : `port_unavailable`). Format `.txt` : message de reconnaissance exact.
- Doublon avec un élève existant (17.15 point 4) : détecté ou non.
- Délai entre le paiement et le passage à "Inscrit" ; règlement partiel.
- Libellés des niveaux dans les listes ("6e", "Grande Section", "Licence 1") et de la classe proposée à l'offre.
- Dossier d'un autre établissement ou identifiant inventé : message exact.
- Lien « Fiche d'inscription » et « Dossier de l'élève » : droits du rôle.

## Non couvert / limites connues

- **Formulaire public et suivi par code** : non déroulables sans ouvrir le réglage côté technique (écarts n°1) ; l'anti-robot (CAPTCHA) n'est pas branché.
- **Offre expirée** : nécessite d'attendre l'échéance (validité minimale d'un jour) ; l'expiration automatique (tâche planifiée) n'est pas déclenchable depuis l'interface.
- **Publication d'un workflow** (acte sensible qui remplace le parcours standard pour les nouvelles campagnes) : volontairement non exécutée.
- **Anonymisation automatique** des dossiers refusés (durée de conservation) : inactive tant que « Conservation des dossiers refusés (mois) » est vide.
- **Résultat d'examen transmis (CEPE vers l'admission en 6e)** : section "Résultat d'examen" du dossier, visible seulement si un résultat a été transmis par le module examens ; la moyenne exige `admission.exam_result.read` (aucun rôle système de test ne l'a, hors direction). Voir le chapitre Examens.
- **Convocations d'entretien** et notifications aux familles : mises en file, aucun envoi réel.
- **Capacité par programme** (supérieur) : le formulaire de capacité ne propose que les niveaux.
