# Guide de saisie des données — Pack Primaire (École Primaire Les Cocotiers)

Ce guide donne, **menu par menu et écran par écran**, les données à saisir pour remplir la base d'une école primaire neuve, et résume en **une ligne** ce que fait chaque menu. Il suit l'ordre dans lequel les données se remplissent (ce qui doit exister avant passe avant) : si vous le suivez de haut en bas, chaque écran trouve ses données.

C'est un dossier de **données**, pas un script de recette : pour chaque écran, un tableau « Champ / Valeur à saisir », puis une ligne « ✅ » qui dit ce qui doit apparaître. Les refus utiles à connaître sont signalés par « ⚠️ ».

> **Ce guide a été rédigé en lisant le code (écrans, contrats, API, libellés `fr-CI.json`) et le menu réel du propriétaire, sans rejouer chaque saisie dans le navigateur.** Si ce que vous voyez diffère d'un ✅, notez-le : c'est précisément ce que le test doit révéler. Un guide plus linéaire, avec cases OK/KO et tests de droits, existe pour l'autre école de test (Les Flamboyants) : [`guide-detaille.md`](guide-detaille.md) ; ses étapes restent valables, seuls les noms de l'école et des comptes changent.

## 1. Avant de commencer

| Élément | Valeur |
| :--- | :--- |
| Lancer l'application | `pnpm dev:v2` (API, site web et worker ; le worker produit les PDF et traite les imports) |
| Site / connexion | <http://localhost:3000/v2/login> (pas `/login` : le panneau des comptes n'y existe pas) |
| École | « École Primaire Les Cocotiers », identifiant `ecole-cocotiers`, pack **Primaire**, offre Professional. Neuve et vide. Créée par `pnpm dev:v2:new-school` avec `DEVV2_SCHOOL_NAME` et `DEVV2_SCHOOL_SLUG` (PowerShell : `$env:DEVV2_SCHOOL_NAME="École Primaire Les Cocotiers"; $env:DEVV2_SCHOOL_SLUG="ecole-cocotiers"; pnpm dev:v2:new-school`) ; la commande ne fait rien si l'école existe déjà. Le compte directeur a été ajouté par `pnpm dev:v2:add-account` avec `DEVV2_SCHOOL_SLUG=ecole-cocotiers`. Relancer `pnpm dev:v2` pour que le panneau de connexion affiche les comptes |
| Date de référence | vendredi **9 octobre 2026** ; année scolaire **2026-2027** |
| Fichiers à importer | [`jeux-de-donnees/`](jeux-de-donnees/) : matières (2 fichiers), élèves, tuteurs, et fichiers d'essai d'erreurs |
| Données | tout est fictif : noms ivoiriens inventés, e-mails en `@ecole-cocotiers.test`, téléphones `+225 07 00 00 00 NN` (jeu principal) ou `+225 05 00 00 00 NN` (nouvelles données) ; aucun e-mail, SMS ni paiement réel n'est émis |
| Règles de calcul | **règles de démonstration** (bandeau « Règles de démonstration ») : n'en tirez aucune conclusion réglementaire |

**Connexion du propriétaire** : `/v2/login` → panneau « Comptes par tenant » (attendre quelques secondes) → établissement `ecole-cocotiers` → cliquer le compte → « Se connecter » → « Afficher le code MFA » → saisir le code à 6 chiffres → « Valider ». Juste après l'ouverture d'une page, un message transitoire (« Établissement inconnu… », « non incluse dans l'offre ») peut s'afficher : attendre 3 à 4 secondes avant de juger.

## 2. Les comptes : ce qui existe, ce qui manque

Deux comptes existent : le **propriétaire** `direction.generale@ecole-cocotiers.test` et le **directeur** `directeur@ecole-cocotiers.test` (tous deux avec MFA). Le propriétaire a toutes les permissions et fait presque toute la saisie.

Les gestes qui exigent un **autre** rôle (instituteur qui saisit les compétences, parent, élève, économe, secrétariat) sont donnés avec leurs données mais sont marqués « compte à venir ». Ces comptes ne peuvent pas encore être créés : le script `add-account` ne gère que `directeur` et `responsable_pedagogique`, et les invitations par l'interface n'envoient aucun e-mail en développement. Détail et pistes dans la section « Comptes de l'école » (partie 13).

## 3. Le jeu de données

| Élément | Contenu |
| :--- | :--- |
| Année | `2026-2027`, du 07/09/2026 au 06/09/2027 ; trimestres 1 (07/09 → 05/01), 2 (06/01 → 07/05), 3 (08/05 → 06/09) |
| Classes | Grande Section A (`GS-A`, capacité 25), CP1 A (`CP1-A`, 35), CM2 A (`CM2-A`, 40) |
| Matières | Français, Mathématiques, Éveil / Sciences, Éducation physique et sportive, Langage oral |
| Personnel | KOFFI Adjoua (P0001, titulaire du CP1 A), BAMBA Séraphin (P0002, titulaire du CM2 A), ZOKORA Sylvie (P0003, titulaire de la Grande Section A) |
| Élèves (9) | Grande Section A : ADOU Aïcha, ASSI Brice, DAGO Chantal · CP1 A : KOUASSI Aya, YAO Konan Éric, TRAORE Fatoumata · CM2 A : COULIBALY Ibrahim, N'GUESSAN Kouamé, TANOH Marie-Ange |
| Tuteurs (9) | ADOU Roland, ASSI Carine, DAGO Prosper, KOUASSI Hervé, YAO Mariam, TRAORE Issouf, COULIBALY Awa, N'GUESSAN Berthe, TANOH Léon |
| Numéros d'inscription | `COCO-2026-GS-0001` … `COCO-2026-CM2-0009` |

## 4. Légende

| Signe | Sens |
| :---: | :--- |
| « … » | libellé exact de l'interface |
| `…` | valeur à saisir, code, message du serveur |
| ✅ | ce qui doit apparaître après la saisie |
| ⚠️ | refus attendu, piège, ou écart repéré dans le code (écran absent, action impossible…) |

## 5. Limites de l'application repérées en rédigeant (à connaître avant de tester)

- **Aucun écran « Matières »** : le catalogue de matières ne se remplit que par l'import « Matières et curriculum ».
- **Aucun moyen de créer un compte instituteur, parent ou élève** utilisable depuis l'interface (pas d'e-mail en développement). Le propriétaire ne peut pas saisir de compétence : il n'a pas de fiche de personnel liée.
- **Écrans sans interface** : « Calendrier de l'établissement », « Validation des séances » et « Paramètres de présence » (menus masqués) ; grille horaire ; ouverture du formulaire public d'admission ; réglage de la délibération obligatoire.
- **Pack Primaire** : l'appel est journalier (matin et après-midi au primaire) et non par séance ; le bouton « Appel du jour » de « Ma classe » échoue pour une classe du primaire (utiliser « Faire l'appel »).
- **Règle d'examen** : le pack ne lie pas la règle `CI-EXAM-PLACEHOLDER` ; il faut la lier à la main avant « Copier et figer la définition ».
- **Bulletins** : émission par classe entière seulement ; le bloc des compétences manque sur le bulletin.
- La liste complète des limites, à traiter après, est dans [`LIMITES_A_TRAITER.md`](LIMITES_A_TRAITER.md) ; les parties du guide signalent aussi les écarts à l'endroit concerné.

## 6. Carte des menus (menu du propriétaire)

Une ligne par menu. La colonne « Partie » renvoie à la partie du guide où se trouvent ses données.

| Module | Menu | En une ligne | Partie |
| :--- | :--- | :--- | :---: |
| Établissement | « Établissement » | identité de l'école, campus, abonnement et étapes de mise en service | 1 |
| Académique | « Paramètres académiques » | référentiels (périodes, niveaux, financements), politique d'inscription, numérotation, calendrier | 1 |
| Académique | « Années et périodes » | crée l'année scolaire, génère ses trimestres, l'ouvre et la rend courante | 1 |
| Académique | « Programmes et niveaux » | arbre des programmes et niveaux couverts (préscolaire, primaire) | 1 |
| Académique | « Curriculum » | matières et coefficients par niveau et programme, validation et publication | 2 |
| Académique | « Classes » | crée et active les classes de l'année | 2 |
| Académique | « Inscriptions » | inscrit un élève dans une classe et suit statut et numéro d'inscription | 4 |
| Académique | « Reconduction annuelle » | prépare l'année suivante à partir de l'année en cours (aperçu sans écriture, puis lancement) | 4 |
| Imports | « Imports Excel / CSV » | charge matières, élèves, tuteurs, personnel… depuis un fichier | 2 et 4 |
| Pack Primaire | « Pack Primaire » (paramètres, appréciations, avancement) | règle le pack et suit l'avancement des classes | 3 et 6 |
| Pack Primaire | « Conseil des maîtres » | prépare et tient le conseil des maîtres, décisions et procès-verbal | 6 |
| Pack Primaire | « Bilans annuels » | prépare, scelle et réémet les bilans annuels | 6 |
| Pack Primaire | « Archives d'année » | prépare et gèle l'archive de l'année | 6 |
| Pack Primaire | « États du primaire » | sept états en aperçu et export CSV | 6 |
| Personnes | « Élèves » | dossiers des élèves, tuteurs liés, pièces | 4 |
| Personnes | « Parents et tuteurs » | fiches des tuteurs et enfants liés | 4 |
| Personnes | « Personnel » | fiches du personnel, contrats, qualifications, charge horaire | 4 |
| Personnes | « Affectations » | affecte les enseignants aux classes (titulaire, responsable, généraliste) | 4 |
| Emploi du temps | « Emplois du temps » | grille hebdomadaire des cours, séances, générateur, export | 5 |
| Emploi du temps | « Salles et équipements » | salles de l'école et leurs équipements | 5 |
| Emploi du temps | « Remplacements » | remplace un enseignant absent sur des séances | 5 |
| Présences | « Suivi des appels » | liste et valide les appels faits | 5 |
| Présences | « Justificatifs d'absence » | examine les justificatifs d'absence des familles | 5 |
| Présences | « Présence du personnel » | pointage et congés du personnel | 5 |
| Évaluations | « Types d'évaluation » | catalogue des types (interrogation, devoir, composition) et pondérations | 7 |
| Évaluations | « Feuilles à relire » | relecture et publication des feuilles de notes | 7 |
| Évaluations | « Corrections de notes » | demandes de correction de notes après publication | 7 |
| Résultats | « Résultats de classe » | résultats calculés par classe et période | 7 |
| Résultats | « Périodes : verrouillage et clôture » | verrouille et clôture les périodes | 7 |
| Résultats | « Délibérations » | décisions de fin de période | 7 |
| Règles de calcul | « Règles de calcul » | jeux de règles (moyennes, passage) et liaisons aux programmes | 7 |
| Bulletins | « Bulletins — émission » | génère les bulletins d'une classe | 7 |
| Bulletins | « Bulletins — liste » | liste, publie et vérifie les bulletins | 7 |
| Bulletins | « Identité et signataires » | identité officielle de l'école et signataires des documents | 7 |
| Bulletins | « Modèles de documents » | modèles de bulletins et de documents | 7 |
| Finance | « Frais et barèmes » | catalogue des frais, barèmes par niveau, remises et bourses | 8 |
| Finance | « Facturation » | génère et suit les factures des élèves | 8 |
| Finance | « Encaissements » | enregistre les paiements, reçus et remboursements | 8 |
| Finance | « Paiements en ligne » | suit les paiements en ligne (fournisseur simulé) | 8 |
| Finance | « Fournisseurs de paiement » | configure les fournisseurs de paiement | 8 |
| Finance | « Paiements à rapprocher » | rapproche les paiements en attente d'une facture | 8 |
| Finance | « Webhooks en échec » | rejoue les notifications de paiement en échec | 8 |
| Finance | « Caisse » | ouvre et clôture la caisse, mouvements | 8 |
| Finance | « Tableau de bord financier » | chiffres financiers : facturé, encaissé, impayés | 8 |
| Paie | « Bulletins de paie » | périodes de paie, calcul, arrêt et paiement des bulletins | 9 |
| Paie | « Configuration de la paie » | salaires de base, retenues, règles de paie | 9 |
| Paie | « Historique des paiements » | paiements de paie effectués | 9 |
| Paie | « Rapports de paie » | états de la paie | 9 |
| Admissions | « Admissions » | pipeline des candidatures par étape | 10 |
| Admissions | « Candidatures » | liste et dossiers des candidatures | 10 |
| Admissions | « Prospects » | familles intéressées avant candidature | 10 |
| Admissions | « Listes d'attente » | classement des candidats en attente | 10 |
| Admissions | « Campagnes d'admission » | campagnes d'admission par rentrée et places | 10 |
| Admissions | « Parcours d'admission » | étapes du processus d'admission | 10 |
| Admissions | « Recrutement : tableaux de bord » | indicateurs d'admission | 10 |
| Admissions | « Paramètres des admissions » | pièces exigées, règles et modèles de messages | 10 |
| Communication | « Messages » | messagerie interne | 11 |
| Communication | « Annonces » | annonces à l'école ou à un public | 11 |
| Communication | « Modération des messages » | modère les messages signalés | 11 |
| Communication | « Paramètres de la messagerie » | audiences autorisées et règles de modération | 11 |
| Notifications | « Journal des notifications » | historique des envois | 11 |
| Notifications | « Gabarits de notification » | textes types des notifications | 11 |
| Notifications | « Règles et alertes » | déclencheurs d'alertes | 11 |
| Notifications | « Canaux d'envoi » | e-mail, SMS, WhatsApp, notification interne | 11 |
| Notifications | « Mes notifications » | préférences de notification du compte | 11 |
| Documents | « Documents » | bibliothèque de documents de l'école | 11 |
| Documents | « Documents à échéance » | documents qui expirent bientôt | 11 |
| Documents | « Catégories de documents » | catégories et types de fichiers autorisés | 11 |
| Documents | « Quarantaine des documents » | fichiers suspects isolés | 11 |
| Documents | « Paramètres des documents » | taille maximale, conservation | 11 |
| Examens | « Examens » | sessions d'examen (CEPE de démonstration) | 12 |
| Examens | « Candidats aux examens » | inscription des candidats | 12 |
| Examens | « Centres et salles » | centres d'examen et salles | 12 |
| Examens | « Examens blancs » | examens blancs et répétitions | 12 |
| Examens | « Résultats d'examen » | saisie et lecture des résultats | 12 |
| Examens | « Statistiques d'examen » | taux de réussite et répartitions | 12 |
| Examens | « Exports d'examen » | exports officiels | 12 |
| Examens | « Corrections d'examen » | corrections motivées de résultats | 12 |
| Accès | « Utilisateurs » | membres de l'école, invitations, suspensions | 13 |
| Accès | « Rôles et permissions » | rôles système et rôles personnalisés | 13 |
| Accès | « Attributions de rôles » | qui a quel rôle, pour combien de temps | 13 |
| Audit | « Journal d'audit » | trace infalsifiable des actions sensibles | 13 |
| Pilotage | « Tableau de bord » | synthèse de la direction | 13 |
| Pilotage | « Indicateurs de direction » | indicateurs détaillés | 13 |
| Pilotage | « Effectifs et présences » | effectifs et assiduité | 13 |
| Pilotage | « Admissions » (pilotage) | entonnoir d'admission pour la direction | 13 |
| Pilotage | « Vie scolaire (agrégée) » | agrégats de discipline (secondaire) | 13 |
| Pilotage | « Pédagogie » | résultats pédagogiques | 13 |
| Pilotage | « Scolarité » | facturation et recouvrement | 13 |
| Pilotage | « Trésorerie » | encaissements et trésorerie | 13 |
| Pilotage | « Masse salariale » | coût de la paie | 13 |
| Pilotage | « Charges et résultat » | charges de fonctionnement et résultat | 13 |
| Pilotage | « Comparaisons » | comparaison de périodes ou de classes | 13 |
| Pilotage | « Alertes de direction » | alertes déclenchées | 13 |
| Pilotage | « Règles d'alerte » | seuils d'alerte | 13 |
| Portails | enseignant, parent, élève | ce que chaque rôle voit et saisit | 14 |

## Sommaire

1. Établissement, paramètres, années, programmes
2. Curriculum, imports de matières, classes
3. Pack Primaire : réglages, échelles, référentiels, appréciations
4. Personnes, inscriptions, imports, affectations
5. Emploi du temps et présences
6. Pack Primaire au quotidien (compétences, conseil, bilans, archives, états)
7. Évaluations, résultats, règles, bulletins
8. Finance
9. Paie
10. Admissions
11. Communication, notifications, documents
12. Examens
13. Accès, pilotage et audit
14. Portails et actes irréversibles


---

## Partie 1 — Établissement, paramètres, années, programmes

### « Établissement » — `/v2/settings`
**En une ligne :** la fiche d'identité de l'école (profil et couleurs, campus, abonnement, étapes de mise en service).
**Compte :** propriétaire ou directeur · **Avant :** rien (l'école existe déjà, avec son pack Primaire).

**Onglet « Profil et marque »** — compléter l'identité et la marque de l'école
| Champ | Valeur à saisir |
| :--- | :--- |
| Raison sociale | `École Primaire Les Cocotiers` (déjà remplie) |
| Nom commercial | `Les Cocotiers` |
| Pays | Côte d'Ivoire (déjà choisi) |
| Personne à contacter | `Direction générale` |
| E-mail | `contact@ecole-cocotiers.test` |
| Téléphone | `+225 05 00 00 00 01` |
| Adresse | `Cocody, Abidjan (adresse fictive)` |
| Adresse du logo | `https://exemple.test/logo-cocotiers.png` (lien https obligatoire, aucun téléversement) |
| Couleur principale | `#B45309` |
| Couleur secondaire | `#166534` |
| Domaine personnalisé | (laisser vide) |
✅ « Profil enregistré. » après « Enregistrer le profil » ; l'aperçu reprend la couleur.
⚠️ Couleur `orange` → « Couleur hexadécimale attendue (ex. #1A73E8). » (« Annuler les modifications »).

**Onglet « Établissements et campus »** — ajouter un second campus (bouton « Nouveau campus » de l'établissement)
| Champ | Valeur à saisir |
| :--- | :--- |
| Nom du campus | `Annexe maternelle` |
| Code | `ANNEXE` |
| Adresse | `Cocody Riviera 3 (adresse fictive)` |
| Ville | `Abidjan` |
| Téléphone | `+225 05 00 00 00 02` |
| Statut | Actif |
✅ « Campus « Annexe maternelle » créé. » ; le campus « Campus principal » reste « Par défaut ».
⚠️ Ne pas créer de second établissement (« Nouvel établissement ») : un seul pack Primaire est prévu pour ce test.

**Onglet « Abonnement et usage »** — lecture seule : offre `PROFESSIONAL`, pack « Primaire », fonctionnalités actives, usage mesuré (0 élève au départ).

**Onglet « Mise en service »** — cocher les étapes au fil du parcours
| Étape | À quel moment | Action |
| :--- | :--- | :--- |
| « Année académique » | après la création de l'année | « Marquer comme terminée » |
| « Classes » | après la création des 3 classes | « Marquer comme terminée » |
| « Import des élèves », « Enseignants » | se cochent seules après un import réussi | — |
| « Finance » | après les frais et barèmes | « Marquer comme terminée » |
| Mise en production | **en tout dernier, jamais pendant le test** | « Passer en production » (définitif) |

---

### « Paramètres académiques » — `/v2/academic/settings`
**En une ligne :** les référentiels de l'école (types et plans de périodes, cycles et niveaux, financements, politique de confirmation des inscriptions, numérotation, calendrier des jours fériés et vacances).
**Compte :** propriétaire ou directeur · **Avant :** l'année 2026-2027 pour l'onglet « Calendrier ».

**Rubriques « Périodes », « Niveaux », « Statuts et financements »** — le pack Primaire les a déjà remplies : à lire, aucune saisie obligatoire (types « Trimestre », « Semestre », « Composition », « Module », « Session normale », « Session de rattrapage » ; plans « Trois trimestres » et « Deux semestres » ; cycles « Maternelle » et « Primaire » ; niveaux Petite Section à CM2 ; issues de fin d'année).
Saisie facultative pour essayer un formulaire (bouton « Ajouter un type » / « Ajouter un plan » / « Ajouter une issue ») :
| Formulaire | Champ | Valeur à saisir |
| :--- | :--- | :--- |
| Ajouter une issue de fin d'année | Code · Libellé · Nature | `PASSAGE_CONDITIONNEL` · `Passage sous condition` · Passage |
| Ajouter un type de période | Code · Libellé · Nature | `COMPOSITION_BLANCHE` · `Composition blanche` · Période d'enseignement |

**Rubrique « Inscriptions »** — politique de confirmation (à régler **avant** les premières inscriptions)
| Champ | Valeur à saisir |
| :--- | :--- |
| Confirmation des inscriptions | « Automatique » (valeur du pack ; plus tard essayer « Après paiement des frais d'inscription », puis « Après paiement intégral », puis revenir à « Automatique ») |
| Durée de réservation (minutes) | (vide) |
✅ « Les politiques d'inscription sont enregistrées. »

**Rubrique « Numérotation »** — numéro d'inscription et matricules (à régler **avant** la première inscription : le numéro est attribué une seule fois)
| Champ | Valeur à saisir |
| :--- | :--- |
| Motif du numéro d'inscription | `{PREFIX}-{YEAR}-{LEVEL}-{STUDENT_SEQ:4}` |
| Préfixe | `COCO` |
| Motif du matricule élève | `{SEQ:5}` (déjà rempli) |
| Motif du matricule du personnel | `P{SEQ:4}` (déjà rempli) |
✅ « La numérotation des inscriptions est enregistrée. » Numéros attendus : `COCO-2026-GS-0001`, `COCO-2026-CP1-0003`…
⚠️ Le motif `COCO-{YEAR}` est refusé : le jeton `{STUDENT_SEQ:n}` est obligatoire.

**Rubrique « Calendrier »** — jours fériés, vacances et fermetures de l'année 2026-2027 (bouton « Ajouter une date ») ; année sélectionnée = `2026-2027`
| Libellé | Nature | Premier jour | Dernier jour | Se répète chaque année | Cours suspendus |
| :--- | :--- | :--- | :--- | :---: | :---: |
| `Toussaint` | Jour férié | `01/11/2026` | (vide) | oui | oui |
| `Journée nationale de la paix` | Jour férié | `15/11/2026` | (vide) | oui | oui |
| `Vacances de la Toussaint` | Vacances | `31/10/2026` | `08/11/2026` | non | oui |
| `Journée pédagogique` | Fermeture | `20/11/2026` | (vide) | non | oui |
| `Noël` | Jour férié | `25/12/2026` | (vide) | oui | oui |
| `Vacances de Noël` | Vacances | `19/12/2026` | `03/01/2027` | non | oui |
| `Fête du Travail` | Jour férié | `01/05/2027` | (vide) | oui | oui |
✅ « « Toussaint » est enregistré. » ; la ligne apparaît dans « Calendrier de l'année 2026-2027 ». Dates indicatives pour les besoins du test, pas un calendrier officiel.

---

### « Années et périodes » — `/v2/academic/years`
**En une ligne :** crée l'année scolaire, génère ses trimestres, l'ouvre et la rend courante.
**Compte :** propriétaire ou directeur · **Avant :** rien.

**Bouton « Nouvelle année »** — l'année 2026-2027
| Champ | Valeur à saisir |
| :--- | :--- |
| Code | `2026-2027` |
| Libellé | `Année scolaire 2026-2027` |
| Début | `07/09/2026` |
| Fin | (vide : douze mois pleins, jusqu'au 06/09/2027) |
✅ « L'année Année scolaire 2026-2027 a été créée. » état « Brouillon ». Aucune suppression possible.
⚠️ Refus à connaître : code déjà pris (« Ce code d'année existe déjà dans l'établissement. »), trou entre deux années, fin avant début, chevauchement.

**Ligne de l'année > bouton « Périodes » > « Générer depuis un plan »** — les trois trimestres
| Champ | Valeur à saisir |
| :--- | :--- |
| Plan de périodes | « Trois trimestres » |
✅ « 3 périodes ont été générées. » : Trimestre 1 (07/09/2026 → 05/01/2027), Trimestre 2 (06/01 → 07/05/2027), Trimestre 3 (08/05 → 06/09/2027), état « Planifiée ».

**Boutons d'état, dans cet ordre** : année → « Ouvrir » ; année → « Définir comme courante » ; « Trimestre 1 » → « Ouvrir ».
✅ « L'année Année scolaire 2026-2027 est ouverte. » · « …est désormais l'année courante. » · « La période Trimestre 1 est ouverte. »
⚠️ Ouvrir une période avant l'année est refusé (« Ouvrez l'année avant d'ouvrir ses périodes. »). Ne pas utiliser « Clore les notes », « Clore », « Clôturer » avant la fin du parcours.

**Année suivante (pour la reconduction, plus bas)**
| Champ | Valeur à saisir |
| :--- | :--- |
| Code · Libellé · Début | `2027-2028` · `Année scolaire 2027-2028` · `07/09/2027` |

---

### « Programmes et niveaux » — `/v2/academic/programs`
**En une ligne :** l'arbre des programmes de l'école et les niveaux que chacun couvre.
**Compte :** propriétaire ou directeur · **Avant :** rien (le pack a créé `MATERNELLE` « Enseignement préscolaire » et `PRIMAIRE` « Enseignement primaire »).

**Lecture** : `MATERNELLE` couvre Petite Section, Moyenne Section, Grande Section ; `PRIMAIRE` couvre CP1, CP2, CE1, CE2, CM1, CM2. Aucune création n'est nécessaire.
Saisie facultative (bouton « Nouveau programme ») pour essayer le formulaire, à archiver ensuite :
| Champ | Valeur à saisir |
| :--- | :--- |
| Code | `ECO_VACANCES` |
| Libellé | `Soutien des vacances` |
| Niveau d'enseignement | « Primaire » |
⚠️ Le code `MATERNELLE` est refusé (« Ce code de programme existe déjà dans l'établissement. »).


---

## Partie 2 — Curriculum, imports de matières, classes

### « Curriculum » — `/v2/academic/curriculum`
**En une ligne :** l'éditeur des matières et coefficients par niveau et par programme pour une année, avec validation et publication.
**Compte :** propriétaire ou directeur · **Avant :** année 2026-2027 créée.

**Bouton « Créer une version vide »** (deux fois)
| Programme | Année |
| :--- | :--- |
| Enseignement primaire (PRIMAIRE) | Année scolaire 2026-2027 |
| Enseignement préscolaire (MATERNELLE) | Année scolaire 2026-2027 |
✅ « La version a été créée. », pastille « Brouillon ». Passer ensuite au menu « Imports Excel / CSV » (suivant) pour charger les matières, puis revenir ici.

**Après l'import — nœud à ajouter à la main** (programme préscolaire, nœud `GS` sélectionné > « Ajouter un enfant »)
| Champ | Valeur à saisir |
| :--- | :--- |
| Type de nœud | Matière |
| Code | `GS-EPS` |
| Libellé | `Éducation physique et sportive` |
| Matière | taper `physique`, choisir « Éducation physique et sportive » (`EPS`) |
| Coefficient | `1` |
✅ « Le nœud Éducation physique et sportive a été ajouté. »

**Après l'import — « Rapport de validation » puis « Publier »** (une fois par programme, **irréversible**, avec confirmation)
✅ PRIMAIRE : « Le curriculum est valide (4 avertissements). » (CP2, CE1, CE2, CM1 sans nœud) ; MATERNELLE : « Le curriculum est valide (2 avertissements). » Ensuite pastille « Publiée » : plus aucun bouton d'édition, modification seulement par amendement motivé.

---

### « Imports Excel / CSV » — `/v2/imports` (matières et curriculum)
**En une ligne :** charge des données en masse depuis un fichier CSV/Excel (élèves, tuteurs, personnel, classes, matières et curriculum, inscriptions, notes, soldes d'ouverture).
**Compte :** propriétaire ou directeur · **Avant :** les deux versions de curriculum vides créées dans « Curriculum » · **Le worker doit tourner** (`pnpm dev:v2`).

**Onglet « Nouvel import » — importeur « Matières et curriculum »** (le catalogue des matières ne peut se remplir que par cet import : aucun écran « Matières »)
| Import | Fichier (dossier `docs/guide-test-primary/jeux-de-donnees/`) | Option « Version de curriculum (brouillon) » |
| :--- | :--- | :--- |
| 1 | `03-matieres-curriculum-primaire.csv` | « Enseignement primaire — brouillon » |
| 2 | `03-matieres-curriculum-maternelle.csv` | « Enseignement préscolaire — brouillon » |
Contenu 1 : nœuds `CP1` et `CM2` (type `LEVEL`) avec `FRANC` coef 4, `MATHS` coef 4, `EVEIL` coef 2, `EPS` coef 1 chacun (10 lignes). Contenu 2 : nœud `GS` avec `LANGAGE` et `EVEIL` (3 lignes ; `GS-EPS` s'ajoute à la main au menu « Curriculum »).
Parcours de l'assistant : « Envoyer et continuer » → colonnes toutes reconnues (« Ignorer les lignes déjà présentes ») → « Enregistrer et valider le fichier » → cocher « J'ai consulté l'aperçu et les erreurs, et je confirme le lancement de l'import. » → « Lancer l'import ».
✅ Import 1 : « À créer » 10, « Avertissements » 8 (« La matière « FRANC » n'existe pas : elle sera créée à partir du libellé. »), puis « Import terminé » ; 4 matières créées. Import 2 : « À créer » 3, 1 avertissement (`LANGAGE` nouvelle).

---

### « Classes » — `/v2/academic/classrooms`
**En une ligne :** crée les classes de l'année (rattachées à un programme, un niveau et un curriculum publié), avec leur effectif et leur capacité.
**Compte :** propriétaire ou directeur · **Avant :** curriculums publiés.

**Bouton « Nouvelle classe »** — trois classes
| Champ | Grande Section A | CP1 A | CM2 A |
| :--- | :--- | :--- | :--- |
| Année | Année scolaire 2026-2027 | idem | idem |
| Programme | Enseignement préscolaire | Enseignement primaire | Enseignement primaire |
| Niveau | Grande Section | CP1 | CM2 |
| Curriculum | Version publiée 1 | Version publiée 1 | Version publiée 1 |
| Code | `GS-A` | `CP1-A` | `CM2-A` |
| Nom | `Grande Section A` | `CP1 A` | `CM2 A` |
| Nature | Classe | Classe | Classe |
| Capacité | `25` | `35` | `40` |
| Capacité bloquante | décochée | décochée | décochée |
✅ « La classe Grande Section A a été créée. » etc. : trois lignes « Brouillon », effectif `0 / 25`, `0 / 35`, `0 / 40`. Elles ne seront **activées** qu'après l'affectation des titulaires (menu « Affectations »).
⚠️ Refus : même code (« Ce code de classe existe déjà pour ce programme et ce niveau. »), même nom, code avec espace (« Code en majuscules (A-Z, 0-9, _ . -), 40 caractères max. »).


---

## Partie 3 — Pack Primaire : réglages, échelles, référentiels, appréciations

### « Pack Primaire » · onglet « Paramètres » — `/v2/primary/parametres`
**En une ligne :** règle le pack Primaire de l'école (titulaire exigé, décision du conseil, banque de phrases, conservation des archives) et gère les échelles d'appréciation et les référentiels de compétences.
**Compte :** propriétaire ou directeur (MFA pour le modèle de pack et les publications) · **Avant :** rien. Attendre 3 à 4 secondes après l'ouverture (messages de chargement transitoires).

**Section « Réglages de l'établissement »** (bouton « Enregistrer les réglages »)
| Réglage | État de départ | Valeur à saisir |
| :--- | :--- | :--- |
| Exiger un titulaire pour activer une classe | cochée | laisser cochée (c'est ce qui impose d'affecter les titulaires avant d'activer les classes) |
| Exiger la décision du conseil pour sceller un bilan | cochée | laisser cochée |
| Activer la banque d'appréciations | cochée | laisser cochée |
| Échelle d'appréciation par défaut | « Niveaux de maîtrise (échelle de démonstration) » | laisser |
| Durée de conservation des archives (années) | vide | `10` |
✅ « Réglages enregistrés. » ; la valeur `10` survit au rechargement.
⚠️ `0` ou `201` refusés (valeurs admises : entier de 1 à 200) ; vider le champ = aucune purge.

**Section « Modèle de pack »** — bouton « Appliquer le modèle de pack » puis « Appliquer le modèle »
✅ « Le modèle était déjà appliqué : rien n'a été modifié. » (le modèle a été instancié à la création de l'école : échelle `MASTERY_4`, référentiels `PRESCHOOL_DEMO` et `PRIMARY_DEMO`, 3 phrases de démonstration).

**Section « Échelles d'appréciation »** — bouton « Nouvelle échelle »
| Champ | Valeur à saisir |
| :--- | :--- |
| Code de l'échelle | `COCOTIERS_3` |
| Libellé | `Échelle des Cocotiers (3 niveaux)` |
| Code du niveau 1 / Libellé du niveau 1 | `NA` / `Non acquis` |
| Code du niveau 2 / Libellé du niveau 2 | `EA` / `En cours d'acquisition` |
| Code du niveau 3 / Libellé du niveau 3 | `AC` / `Acquis` (cocher « Attendu atteint ») |
(« Ajouter un niveau » pour le niveau 3 ; de 2 à 12 niveaux ; l'ordre de saisie fixe l'ordre, du plus faible au plus élevé.)
✅ « Échelle créée. » ; la carte n'a ni « Démonstration » ni « Verrouillée » tant qu'aucun référentiel publié ne l'utilise. Il n'existe pas de modification ni d'archivage d'échelle dans l'interface.
⚠️ Refus : code `echelle-3` ou `E` (« Code attendu : majuscules, chiffres et _ (2 à 40). »), deux niveaux de même code, code `MASTERY_4` déjà pris.

**Section « Référentiels de compétences »** — bouton « Nouveau référentiel » puis « Créer le brouillon »
| Champ | Valeur à saisir |
| :--- | :--- |
| Code du référentiel | `COCOTIERS_CE1` |
| Libellé | `Français et mathématiques CE1 (Cocotiers)` |
| Échelle d'appréciation | « Échelle des Cocotiers (3 niveaux) » |
| Niveaux de classe concernés | `CE1` (aucune classe CE1 n'existe : ce référentiel d'essai ne change la grille d'aucune des 3 classes ; ne jamais mettre `GS`, `CP1` ni `CM2`) |
✅ « Référentiel créé en brouillon. » avec « Ce qui empêche la publication : Ajoutez au moins une compétence. »

Bouton « Modifier la structure » → « Ajouter un domaine » / « Ajouter une compétence » → « Enregistrer la structure »
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
✅ « Structure enregistrée. » ; « 8 compétences ».

Bouton « Publier » (cocher « Je comprends que la publication est définitive ») — **irréversible**
✅ « Référentiel publié. » ; la pastille devient « Publié », l'échelle `COCOTIERS_3` devient « Verrouillée ». Bouton « Créer une nouvelle version » → « Version 2 créée en brouillon. » → « Modifier la structure » → ajouter `LO.3` / `Participe à un échange en respectant le tour de parole` → « Publier » : la version 1 passe à « Retiré ».
⚠️ Un brouillon sans niveau de classe (`BROUILLON_VIDE`) ne se publie pas : « Indiquez au moins un niveau d'application. » ; « Supprimer le brouillon » le retire.


### « Pack Primaire » · onglet « Appréciations » — `/v2/primary/appreciations`
**En une ligne :** la banque de phrases d'appréciation de l'école, à consulter et à composer en rédaction ; la direction l'enrichit, une phrase n'est jamais appliquée seule.
**Compte :** propriétaire, directeur ou directeur des études (gestion) ; l'instituteur lit seulement · **Avant :** échelle `COCOTIERS_3` pour proposer le niveau `AC`.

**Bouton « Nouvelle phrase »** puis « Créer la phrase » (trois phrases)
| Code | Portée | Texte de la phrase | Niveau de maîtrise | Niveau de classe |
| :--- | :--- | :--- | :--- | :--- |
| `PERIOD_N2_ENCOURAGEMENT` | Période | `Des progrès sont visibles : poursuivez vos efforts avec régularité.` | `N2` | Tous |
| `YEAR_CM2_TRAVAIL` | Année | `Année de travail sérieuse : l'élève a fourni des efforts constants.` | Tous | `CM2` |
| `COMP_LECTURE_AISANCE` | Compétence | `Lit à voix haute avec aisance et en respectant la ponctuation.` | `AC` | `CP1` |
✅ « Phrase créée. » ; pas de pastille « Démonstration ». Les phrases ne se modifient ni ne se suppriment : seulement « Désactiver » puis « Activer » (case « Afficher aussi les phrases désactivées »).

**Cadre « Ma rédaction »** : « Ajouter à ma rédaction » sur la phrase `PERIOD_N3` puis `YEAR_GENERIC`, cocher « J'ai relu et je valide ce texte », « Copier le texte validé » → « Texte copié : collez-le dans l'appréciation du bulletin. » (rien n'est enregistré ici ; l'appréciation générale s'écrit dans « Résultats de classe »).


---

## Partie 4 — Personnes, inscriptions, imports, affectations

### « Personnel » — `/v2/staff`
**En une ligne :** les fiches du personnel de l'école (identité, poste, contrats, qualifications, disponibilités, charge horaire, historique).
**Compte :** propriétaire ou directeur · **Avant :** rien.

**Onglet « Nouveau membre »** puis « Créer la fiche » — trois enseignants
| Champ | KOFFI | BAMBA | ZOKORA |
| :--- | :--- | :--- | :--- |
| Nom | `KOFFI` | `BAMBA` | `ZOKORA` |
| Prénoms | `Adjoua` | `Séraphin` | `Sylvie` |
| Sexe | Féminin | Masculin | Féminin |
| Date de naissance | `12/04/1988` | `03/09/1981` | `25/01/1990` |
| Lieu de naissance | `Abidjan` | `Abidjan` | `Abidjan` |
| Nationalité (code pays) | `CI` | `CI` | `CI` |
| Adresse e-mail | `adjoua.koffi@ecole-cocotiers.test` | `seraphin.bamba@ecole-cocotiers.test` | `sylvie.zokora@ecole-cocotiers.test` |
| Téléphone | `+225 07 00 00 00 21` | `+225 07 00 00 00 22` | `+225 07 00 00 00 23` |
| Ville | `Abidjan` | `Abidjan` | `Abidjan` |
| Catégorie | Enseignant | Enseignant | Enseignant |
| Intitulé du poste | `Institutrice titulaire` | `Instituteur titulaire` | `Institutrice de maternelle titulaire` |
| Date d'embauche | `01/09/2022` | `01/09/2015` | `01/09/2019` |
✅ « Fiche créée » : « KOFFI Adjoua — matricule P0001. » puis `P0002`, `P0003`. Les dates se tapent sans barres (`12041988`).
⚠️ Refus : e-mail sans `@` (« Adresse e-mail invalide. »), téléphone `12` (« Téléphone trop court. »), doublon d'une même personne (encadré « 1 dossier ressemble à cette personne » : il faut cocher « Ce n'est pas un doublon : créer quand même » et saisir un « Motif de la création »).
Seule la catégorie « Enseignant » reçoit une affectation de titulaire. Les autres catégories : « Éducateur », « Personnel administratif », « Direction », « Personnel d'appui ».

**Fiche d'un membre > « Modifier »** : changer « Intitulé du poste » en `Institutrice titulaire du CP1` puis remettre l'original → « La fiche a été mise à jour. ».
**Fiche > onglet « Contrats »** : voir le menu « Bulletins de paie » (module Paie) pour les contrats de rémunération.
**Fiche > « Inviter au portail »** : crée un vrai accès (rôle `enseignant`, pas `instituteur`) sans e-mail réel en développement ; à ne faire que si on veut ce compte (voir « Comptes à ajouter »).

---

### « Parents et tuteurs » — `/v2/guardians`
**En une ligne :** les fiches des tuteurs (parents ou responsables) et le nombre d'enfants qui leur sont liés.
**Compte :** propriétaire ou directeur · **Avant :** rien (les tuteurs se créent AVANT les élèves pour conserver leur téléphone).

**Bouton « Nouveau tuteur »** puis « Créer » — six tuteurs saisis à la main (les trois autres arrivent par import)
| Nom | Prénoms | Sexe | Téléphone | Ville | Profession |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `ADOU` | `Roland` | Masculin | `+225 07 00 00 00 11` | `Abidjan` | `Commerçant` |
| `ASSI` | `Carine` | Féminin | `+225 07 00 00 00 12` | `Abidjan` | `Infirmière` |
| `KOUASSI` | `Hervé` | Masculin | `+225 07 00 00 00 14` | `Abidjan` | `Comptable` |
| `YAO` | `Mariam` | Féminin | `+225 07 00 00 00 15` | `Abidjan` | `Couturière` |
| `COULIBALY` | `Awa` | Féminin | `+225 07 00 00 00 17` | `Abidjan` | `Enseignante` |
| `N'GUESSAN` | `Berthe` | Féminin | `+225 07 00 00 00 18` | `Abidjan` | `Commerçante` |
✅ « Le tuteur ADOU Roland a été créé. » ; ligne avec téléphone `+2250700000011`, 0 enfant, « Sans compte ». Après la création des élèves : 1 enfant par tuteur.
⚠️ Refus : formulaire vide (« Ce champ est obligatoire. » sous Nom et Prénoms), e-mail invalide, téléphone `12`, doublon sans motif.

---

### « Élèves » — `/v2/students`
**En une ligne :** les dossiers des élèves (identité, tuteurs, urgences, parcours, statut, pièces) et leur liste filtrable, exportable en CSV.
**Compte :** propriétaire ou directeur · **Avant :** tuteurs créés.

**Onglet « Nouvel élève »** — assistant Identité → Tuteurs → Récapitulatif (« Créer le dossier »), six élèves saisis à la main
| Nom | Prénoms | Sexe | Date de naissance | Lieu de naissance | Nationalité | Ville | Tuteur à choisir | Lien de parenté | Matricule |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `ADOU` | `Aïcha` | Féminin | `14/03/2021` | `Abidjan` | `CI` | `Abidjan` | ADOU Roland | Père | `00001` |
| `ASSI` | `Brice` | Masculin | `02/07/2021` | `Abidjan` | `CI` | `Abidjan` | ASSI Carine | Mère | `00002` |
| `KOUASSI` | `Aya` | Féminin | `09/05/2020` | `Abidjan` | `CI` | `Abidjan` | KOUASSI Hervé | Père | `00003` |
| `YAO` | `Konan Éric` | Masculin | `30/01/2020` | `Abidjan` | `CI` | `Abidjan` | YAO Mariam | Mère | `00004` |
| `COULIBALY` | `Ibrahim` | Masculin | `11/04/2015` | `Abidjan` | `CI` | `Abidjan` | COULIBALY Awa | Mère | `00005` |
| `N'GUESSAN` | `Kouamé` | Masculin | `05/12/2015` | `Abidjan` | `CI` | `Abidjan` | N'GUESSAN Berthe | Mère | `00006` |
Pour le premier élève, compléter aussi : Adresse `Cocody, Riviera (fictif)` · Lieu de résidence `Cocody`. À l'étape « Tuteurs » : « Ajouter un tuteur existant », laisser cochés « Contact principal », « Contact d'urgence », « Accès au portail parents » et cocher « Responsable financier » et « Autorité légale ».
✅ « Dossier créé » : « ADOU Aïcha — matricule 00001. » ; l'élève est « Actif » et « Non inscrit » dans la liste. Les matricules supposent cet ordre de création.
⚠️ Refus : sexe non choisi (« Le sexe est obligatoire pour un élève. »), naissance dans le futur (« Date de naissance invraisemblable. »), doublon exact ADOU Aïcha / `14/03/2021` (encadré « 1 dossier ressemble à cette personne » : motif obligatoire).

**Fiche d'un élève > onglet « Pièces » > « Déposer une pièce »**
| Champ | Valeur à saisir |
| :--- | :--- |
| Type de pièce | Acte de naissance |
| Fichier | `docs/guide-test/jeux-de-donnees/04-piece-eleve-test-guide.pdf` |
| Intitulé | `Acte de naissance d'Aïcha (fictif)` |
| Date d'émission | `20/03/2021` |
✅ « La pièce "Acte de naissance d'Aïcha (fictif)" est déposée. » (version 1, active). « Retirer » avec le motif `Pièce de test retirée` (5 caractères minimum). ⚠️ Fichier `.txt` refusé (« Format non accepté : PDF, JPEG, PNG ou WebP uniquement. »).
**Fiche > « Lier un tuteur »** : ADOU Roland est déjà lié (refus « Ce tuteur est déjà lié à cet élève. »). **Fiche > « Modifier »** : changer « Lieu de résidence » (`Plateau`) puis remettre `Cocody`. **« Changer le statut »** : ne pas l'utiliser avant la fin.

---

### « Inscriptions » — `/v2/enrollments`
**En une ligne :** inscrit un élève dans une classe de l'année et suit le statut (active, en attente, annulée) et le numéro d'inscription.
**Compte :** propriétaire ou directeur · **Avant :** classes créées, élèves et tuteurs saisis (menu « Élèves »), numérotation réglée.

**Onglet « Nouvelle inscription »** — assistant Élève → Classe → Financement → Récapitulatif (« Inscrire »)
| Élève | Classe | Mode d'inscription | Financement | N° attendu |
| :--- | :--- | :--- | :--- | :--- |
| ADOU Aïcha | `Grande Section A` | Par classe (cursus complet) | Privé | `COCO-2026-GS-0001` |
| ASSI Brice | `Grande Section A` | idem | Privé | `COCO-2026-GS-0002` |
| KOUASSI Aya | `CP1 A` | idem | Privé | `COCO-2026-CP1-0003` |
| YAO Konan Éric | `CP1 A` | idem | Privé | `COCO-2026-CP1-0004` |
| COULIBALY Ibrahim | `CM2 A` | idem | Privé | `COCO-2026-CM2-0005` |
| N'GUESSAN Kouamé | `CM2 A` | idem | Privé | `COCO-2026-CM2-0006` |
« Date d'inscription » vide (aujourd'hui) ; « Redoublement » décoché. DAGO Chantal, TRAORE Fatoumata et TANOH Marie-Ange sont inscrits par l'import des élèves (menu « Imports Excel / CSV »).
✅ « Inscription enregistrée » : « N° d'inscription : COCO-2026-GS-0001. Statut : active. »
⚠️ Politique « Après paiement intégral » (à essayer sur N'GUESSAN Kouamé en le plaçant d'abord sous cette politique) : « Statut : en attente de confirmation. » → fiche de l'inscription → « Confirmer sans paiement » avec le motif `Test : dérogation de la direction` (au moins 5 caractères) → « L'inscription est confirmée par dérogation. » Remettre ensuite « Automatique ».

---

### « Imports Excel / CSV » — élèves et tuteurs (suite)
**En une ligne :** voir plus haut ; cette fois l'import d'élèves avec leur inscription, puis de tuteurs liés par matricule d'origine.
**Compte :** propriétaire ou directeur · **Avant :** classes créées, inscriptions réglées sur « Automatique ».

| Ordre | Importeur | Fichier (`docs/guide-test-primary/jeux-de-donnees/`) | Options | Résultat attendu |
| :--- | :--- | :--- | :--- | :--- |
| 1 | « Élèves » | `01-eleves-valide-primaire.csv` | « Année scolaire des inscriptions » = `2026-2027`, « Doublons probables » = « Refuser (recommandé) », « Ignorer les lignes déjà présentes » | À créer 3 : DAGO Chantal (`GS-A`), TRAORE Fatoumata (`CP1-A`), TANOH Marie-Ange (`CM2-A`) ; matricules `00007` à `00009` |
| 2 | « Parents et tuteurs » | `02-tuteurs-valide-primaire.csv` | « Doublons probables » = « Refuser (recommandé) » | À créer 3 : DAGO Prosper, TRAORE Issouf, TANOH Léon, liés par matricule d'origine `FLA-ELV-007` à `009`, lien Père |
✅ Après l'option « Année scolaire des inscriptions » : « À créer » 3, « En erreur » 0 ; sans cette option, 3 erreurs « La colonne « Classe » exige l'option « Année scolaire des inscriptions ». ». Rapport « Import terminé », « Créées » 3. Contrôle : 9 élèves, 9 tuteurs, 9 inscriptions « Active ».
**Fichiers d'essai d'erreurs** (à ne PAS lancer, seulement lire l'aperçu) : `01-eleves-colonne-manquante-primaire.csv` (colonne « Sexe » absente), `01-eleves-erreurs-primaire.csv` (9 lignes : 1 ignorée, 8 erreurs : date `31/02/2021`, sexe vide, doublon ADOU Aïcha, classe `CE2-Z`, nom vide, naissance 2099, e-mail invalide), `02-tuteurs-erreurs-primaire.csv` (1 ignorée, 5 erreurs).
⚠️ Les imports valides écrivent définitivement : à jouer une seule fois. Maximum 5 imports « actifs » à la fois.

---

### « Affectations » — `/v2/staff/assignments`
**En une ligne :** affecte les enseignants aux classes (titulaire de classe, responsable, enseignant généraliste) pour une période de l'année.
**Compte :** propriétaire ou directeur · **Avant :** classes créées, fiches du personnel créées.

**Onglet « Par classe » > ligne « Titulaire de classe » > « Désigner »** — trois titulaires
| Classe | Enseignant | Rôle | Période | Début | Fin · Heures prévues · Note |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `Grande Section A` | `ZOKORA Sylvie` | Titulaire de classe | Toute l'année | `07/09/2026` | (vides) |
| `CP1 A` | `KOFFI Adjoua` | Titulaire de classe | Toute l'année | `07/09/2026` | (vides) |
| `CM2 A` | `BAMBA Séraphin` | Titulaire de classe | Toute l'année | `07/09/2026` | (vides) |
✅ « L'affectation est enregistrée. » avec l'avertissement « Aucun contrat actif ne couvre le début de cette affectation (la paie décide). » tant qu'aucun contrat de paie n'existe (créer les contrats avant pour ne pas le voir). Un second titulaire sur la même classe est refusé (« Cette classe a déjà un titulaire (ZOKORA Sylvie). »).
**Après l'activation des classes** (menu « Classes » > fiche de la classe > « Activer » > confirmer ; les trois sans exception) : pour que le titulaire soit responsable de toutes les matières, « Désigner » à nouveau avec Rôle « Responsable » et cocher « Enseignant généraliste (toutes les matières) ».
✅ « La classe Grande Section A est active. » ; sans titulaire : « Une classe du primaire ne s'active qu'avec un instituteur titulaire : affectez-en un d'abord. »


---

## Partie 5 — Emploi du temps et présences

**Ordre de saisie conseillé** (une entrée dépend de la précédente) : Salles et équipements, Emplois du temps (créneaux, publication, génération des séances), Présence du personnel (pointages et congé de KOFFI Adjoua), Remplacements, Faire l'appel, Suivi des appels, Justificatifs d'absence. Les sections sont écrites dans cet ordre, pas dans l'ordre du menu.

**Particularités du pack Primaire à connaître**
- Au primaire, l'appel est **journalier** (maternelle : un appel par jour ; CP1 à CM2 : matin + après-midi). Il ne se fait **jamais séance par séance** : l'emploi du temps ne sert donc pas à faire l'appel. Il sert à l'affichage (classe, enseignant, salle), aux remplacements et à l'export.
- Les entrées de menu « Calendrier de l'établissement », « Validation des séances » et « Paramètres de présence » existent dans la configuration du menu mais sont **masquées** : aucun écran (voir la dernière section).
- « Appels non faits » (onglet du module Présences) ne compte que les séances planifiées : sans objet au primaire (il affichera « Aucune séance attendue sur cette période. »).
- Plages horaires de référence de l'école (aucun écran ne permet de saisir une « grille horaire » : ces heures ne servent qu'à remplir les créneaux ci-dessous) :

| Plage | Horaire | Remarque |
| :--- | :--- | :--- |
| Matin 1 | `07:30` – `08:30` | lundi à vendredi |
| Matin 2 | `08:30` – `09:30` | lundi à vendredi |
| Récréation | `09:30` – `10:00` | aucun créneau saisi |
| Matin 3 | `10:00` – `11:00` | lundi à vendredi |
| Matin 4 | `11:00` – `12:00` | lundi à vendredi |
| Après-midi 1 | `14:30` – `15:30` | lundi, mardi, jeudi, vendredi |
| Après-midi 2 | `15:30` – `16:30` | lundi, mardi, jeudi, vendredi |
| Mercredi après-midi | libre | aucun créneau saisi |


### « Salles et équipements » — `/v2/schedule/rooms`
**En une ligne :** déclare les salles (une par classe, la cour, la salle polyvalente), leur état de service et le stock d'équipements réservables.
**Compte :** propriétaire (droit `schedule.room.manage`) · **Avant :** rien d'autre (le campus « Campus principal » existe, les types de salle sont posés par le modèle de pack).

**Écran « Salles et équipements » > bouton « Ajouter une salle »** — une salle par fenêtre « Ajouter une salle », puis « Ajouter »
Choisir d'abord « Campus » = `Campus principal` (présélectionné ; la liste « Établissement » n'apparaît que s'il y en a plusieurs).

| Code | Nom | Type de salle | Capacité | Bâtiment | Équipements fixes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `SAL-GS-A` | Salle Grande Section A | Salle de classe | `25` | Bâtiment maternelle | tableau, coin lecture |
| `SAL-CP1-A` | Salle CP1 A | Salle de classe | `35` | Bâtiment A | tableau, tables-bancs |
| `SAL-CM2-A` | Salle CM2 A | Salle de classe | `40` | Bâtiment B | tableau, vidéoprojecteur |
| `COUR` | Cour de récréation | Autre | `120` | Cour centrale | (vide) |
| `SAL-POLY` | Salle polyvalente | Autre | `150` | Bâtiment A | estrade, sonorisation |

✅ « Salle enregistrée. » à chaque ajout ; les cinq salles apparaissent sous « Salles du campus » (colonnes « Nom », « Code », « Type », « Capacité », « Bâtiment », « État » = « Disponible »). Le code est converti en majuscules.
⚠️ Si la liste « Type de salle » est vide, le modèle de pack n'a pas été instancié (le worker n'a pas tourné) : relancer `pnpm dev:v2` puis recharger. Cas d'erreur : code vide ou nom vide → « Ce champ est obligatoire. » ; capacité `0` → « La valeur doit être supérieure ou égale à 1. » ; code `SAL CP1` (espace) → « Code invalide (lettres, chiffres, . _ -). ».

**Même écran, ligne « Salle polyvalente » > bouton « Mettre hors service »** — essai de l'état de service
| Champ | Valeur à saisir |
| :--- | :--- |
| Motif (facultatif) | `Réfection du toit (test)` |

Cliquer « Confirmer » (« État de la salle modifié. »), puis « Remettre en service » et « Confirmer » pour la rendre de nouveau réservable (indispensable avant la réunion de parents plus bas).

**Section « Équipements » > bouton « Ajouter un équipement »** — stock réservable, si l'offre l'inclut
| Code | Libellé | Quantité en stock |
| :--- | :--- | :--- |
| `VIDEOPROJ-01` | Vidéoprojecteur portable | `1` |
| `BALLONS-EPS` | Ballons et cerceaux d'EPS | `20` |
| `SONO-01` | Sonorisation portative | `1` |

✅ « Équipement enregistré. » ; lignes sous « Équipements du campus » (« Nom », « Code », « Quantité », « État »). ⚠️ Si l'offre n'inclut pas la fonction : « La réservation d'équipements n'est pas incluse dans votre offre. » et aucun bouton (ne pas insister). Quantité `0` → « La valeur doit être supérieure ou égale à 1. ».
⚠️ « Occupation de la semaine » affiche « Horaires d'ouverture non renseignés » : aucun écran ne permet de saisir les horaires d'ouverture de l'école, rien à saisir ici.


### « Emplois du temps » — `/v2/schedule/timetables`
**En une ligne :** construit l'emploi du temps hebdomadaire type (créneaux par classe, jour, heures, salle et enseignant), le publie, puis en génère les séances datées.
**Compte :** propriétaire (`schedule.read`, `schedule.manage`, `schedule.publish`) · **Avant :** les trois classes publiées avec leur curriculum, les trois fiches de personnel actives, les salles ci-dessus.

**Écran « Patrons récurrents » (liste) > bouton « Nouvel emploi du temps »** — un seul emploi du temps pour les trois classes
| Champ | Valeur à saisir |
| :--- | :--- |
| Année scolaire | Année scolaire 2026-2027 (présélectionnée) |
| Nom | `Emploi du temps 2026-2027 Cocotiers` |
| Valable du | `07/09/2026` (rempli par défaut) |
| Valable jusqu'au | `06/09/2027` (rempli par défaut) |
| Premier lundi de la semaine A | (laisser vide : pas d'alternance A/B à l'école primaire) |

Cliquer « Créer » : « Emploi du temps créé en brouillon. » ; la liste (colonnes « Nom », « Validité », « Semaine A (lundi) », « Publié le », « État ») montre l'état « Brouillon ». Cliquer son nom pour ouvrir la fiche.
⚠️ Cas d'erreur : « Valable jusqu'au » antérieur à « Valable du » → « La fin de validité précède son début. ».

**Fiche du brouillon > bouton « Ajouter un créneau »** — 24 créneaux (un par ligne ; « Enregistrer » à chaque fois)
Valeurs communes : « Type » = `Cours`, « Alternance » = `Chaque semaine`, « Mode » = `Présentiel`, champs « Valable à partir du » / « Valable jusqu'au » vides. « Intitulé » = libellé court indiqué. « Cours (programme) » : choisir la matière de la classe choisie (le champ n'est actif qu'après le choix de la « Classe »). « Salle » est listée « Nom (CODE) ». « Intervenant 1 » avec « Rôle » = `Responsable`.

| # | Classe | Jour | Début | Fin | Cours (programme) | Intitulé | Salle | Intervenant 1 |
| :-: | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | CP1 A | Lundi | `07:30` | `08:30` | Français | `Français CP1 A` | Salle CP1 A (SAL-CP1-A) | KOFFI Adjoua |
| 2 | CP1 A | Lundi | `08:30` | `09:30` | Mathématiques | `Mathématiques CP1 A` | Salle CP1 A (SAL-CP1-A) | KOFFI Adjoua |
| 3 | CP1 A | Lundi | `14:30` | `15:30` | Éducation physique et sportive | `EPS CP1 A` | Cour de récréation (COUR) | KOFFI Adjoua |
| 4 | CP1 A | Mardi | `07:30` | `08:30` | Mathématiques | `Mathématiques CP1 A` | Salle CP1 A (SAL-CP1-A) | KOFFI Adjoua |
| 5 | CP1 A | Mardi | `08:30` | `09:30` | Français | `Français CP1 A` | Salle CP1 A (SAL-CP1-A) | KOFFI Adjoua |
| 6 | CP1 A | Mercredi | `07:30` | `08:30` | Français | `Français CP1 A` | Salle CP1 A (SAL-CP1-A) | KOFFI Adjoua |
| 7 | CP1 A | Jeudi | `10:00` | `11:00` | Éveil / Sciences | `Éveil CP1 A` | Salle CP1 A (SAL-CP1-A) | KOFFI Adjoua |
| 8 | CP1 A | Vendredi | `14:30` | `15:30` | Français | `Français CP1 A` | Salle CP1 A (SAL-CP1-A) | KOFFI Adjoua |
| 9 | CM2 A | Lundi | `07:30` | `08:30` | Mathématiques | `Mathématiques CM2 A` | Salle CM2 A (SAL-CM2-A) | BAMBA Séraphin |
| 10 | CM2 A | Lundi | `08:30` | `09:30` | Français | `Français CM2 A` | Salle CM2 A (SAL-CM2-A) | BAMBA Séraphin |
| 11 | CM2 A | Lundi | `14:30` | `15:30` | Éducation physique et sportive | `EPS CM2 A (moniteur sportif)` | Salle polyvalente (SAL-POLY) | (aucun : ne pas remplir « Intervenant 1 ») |
| 12 | CM2 A | Mardi | `07:30` | `08:30` | Français | `Français CM2 A` | Salle CM2 A (SAL-CM2-A) | BAMBA Séraphin |
| 13 | CM2 A | Mardi | `08:30` | `09:30` | Mathématiques | `Mathématiques CM2 A` | Salle CM2 A (SAL-CM2-A) | BAMBA Séraphin |
| 14 | CM2 A | Mercredi | `08:30` | `09:30` | Éveil / Sciences | `Éveil CM2 A` | Salle CM2 A (SAL-CM2-A) | BAMBA Séraphin |
| 15 | CM2 A | Jeudi | `10:00` | `11:00` | Mathématiques | `Mathématiques CM2 A` | Salle CM2 A (SAL-CM2-A) | BAMBA Séraphin |
| 16 | CM2 A | Vendredi | `14:30` | `15:30` | Éveil / Sciences | `Éveil CM2 A` | Salle CM2 A (SAL-CM2-A) | BAMBA Séraphin |
| 17 | Grande Section A | Lundi | `07:30` | `08:30` | Langage oral | `Langage oral GS A` | Salle Grande Section A (SAL-GS-A) | ZOKORA Sylvie |
| 18 | Grande Section A | Lundi | `08:30` | `09:30` | Éveil / Sciences | `Éveil GS A` | Salle Grande Section A (SAL-GS-A) | ZOKORA Sylvie |
| 19 | Grande Section A | Mardi | `07:30` | `08:30` | Éducation physique et sportive | `EPS GS A` | Cour de récréation (COUR) | ZOKORA Sylvie |
| 20 | Grande Section A | Mercredi | `07:30` | `08:30` | Langage oral | `Langage oral GS A` | Salle Grande Section A (SAL-GS-A) | ZOKORA Sylvie |
| 21 | Grande Section A | Jeudi | `07:30` | `08:30` | Éveil / Sciences | `Éveil GS A` | Salle Grande Section A (SAL-GS-A) | ZOKORA Sylvie |
| 22 | Grande Section A | Vendredi | `08:30` | `09:30` | Langage oral | `Langage oral GS A` | Salle Grande Section A (SAL-GS-A) | ZOKORA Sylvie |
| 23 | Grande Section A | Jeudi | `14:30` | `15:30` | Éducation physique et sportive | `EPS GS A` | Cour de récréation (COUR) | ZOKORA Sylvie |
| 24 | CP1 A | Vendredi | `10:00` | `11:00` | Éveil / Sciences | `Éveil CP1 A` | Salle CP1 A (SAL-CP1-A) | KOFFI Adjoua |

✅ « Créneau ajouté. » à chaque ligne ; les créneaux apparaissent sous « Créneaux récurrents » regroupés par jour (Lundi à Vendredi, aucun le samedi) ; « Conflits du brouillon » (bouton « Actualiser ») affiche « Aucun conflit dans ce brouillon. ». Le créneau 11 (CM2 A, EPS du lundi 14:30) n'a volontairement aucun enseignant : l'EPS y est donnée par un moniteur hors fiches, ce qui laisse BAMBA Séraphin libre pour la suppléance de KOFFI Adjoua (section « Remplacements »). Le mercredi après-midi n'a aucun créneau.
⚠️ Tous les créneaux s'affichent « Cours » si l'« Intitulé » est laissé vide (écart connu) : d'où les intitulés demandés. Cas d'erreur : classe vide pour un cours → « Une classe est obligatoire pour un cours. » ; « Fin » = « Début » → « L'heure de fin doit être postérieure à l'heure de début (pas de patron à cheval sur minuit). ». Un conflit volontaire (ex. KOFFI Adjoua aussi le lundi 07:30–08:30 sur CM2 A) est refusé avec la liste « Conflits de planification » ; ne pas utiliser « Motif du dépassement ».

**Fiche > boutons « Publier » puis « Générer les séances »** — rend l'emploi du temps officiel et crée les séances datées
Cliquer « Publier » (« Emploi du temps publié. », état « Publié », plus aucun bouton de modification). Puis « Générer les séances » :
| Champ | Valeur à saisir |
| :--- | :--- |
| Du | `05/10/2026` |
| Au | `30/10/2026` |
| Plafonner au volume horaire des cours | (décoché) |

Cliquer « Générer ». ✅ Rapport « Génération du … au … » : « Créées » = 96 environ (24 créneaux × 4 semaines, valeur exacte à relever), « Déjà existantes » 0, « En conflit » 0 ; relancer la même période donne « Créées » 0. ⚠️ Faire cette génération **avant** d'approuver le congé de KOFFI Adjoua (section « Présence du personnel »), sinon rien ne sera signalé « À remplacer ». Un seul emploi du temps publié existe par année : publier un second brouillon est refusé (« Un emploi du temps est déjà publié pour cet établissement, cette année et cette période. »).

**Autres écrans du module (onglets de la même page, sans entrée de menu)**

*« Séances » — `/v2/schedule/occurrences` > bouton « Nouvelle séance »* (réunion du mercredi après-midi libre)
| Champ | Valeur à saisir |
| :--- | :--- |
| Type | Réunion |
| Intitulé | `Réunion de rentrée des parents` |
| Classe / Cours (programme) | (vides) |
| Date | `14/10/2026` |
| Début / Fin | `15:00` / `16:30` |
| Salle | Salle polyvalente |
| Intervenant 1 / Rôle | BAMBA Séraphin / Responsable |
| Intervenant 2 / Rôle | KOFFI Adjoua / Co-intervenant |
| Intervenant 3 / Rôle | ZOKORA Sylvie / Co-intervenant |
| Notes | `Présentation du règlement intérieur` |

Cliquer « Créer la séance » : « Séance créée. » (l'aperçu indique « Aucun conflit détecté sur ce créneau. »). Elle apparaît dans la liste (colonnes « Date », « Horaire », « Intitulé », « Classe », « Salle », « Intervenants », « État » = « Prévue ») en réglant « Du » `12/10/2026` et « Au » `16/10/2026`.

*« Emploi du temps » (vue) — `/v2/schedule`* : lecture seule. « Afficher » = Classe, « Choisir une classe » = CP1 A, « Vue » = Semaine, naviguer sur « Semaine du 12/10/2026 au 18/10/2026 » : 9 séances de CP1 A (créneaux 1 à 8 et 24) ; refaire avec Enseignant = BAMBA Séraphin puis Salle = Cour de récréation. « Aujourd'hui » (`/v2/schedule/today`) est réservé à un compte relié à une fiche de personnel : le propriétaire n'a rien à y voir.

*« Générateur » — `/v2/schedule/generator` > « Nouvelle génération »* (facultatif, il ne publie rien)
| Champ | Valeur à saisir |
| :--- | :--- |
| Année scolaire | Année scolaire 2026-2027 |
| Nom de la proposition | `Proposition CP1 A semaine type` |
| Début de la journée | `07:30` |
| Fin de la journée | `11:30` |
| Durée d'une période (minutes) | `60` |
| Classe > « Ajouter toutes ses matières » | CP1 A : Français `3` séances/sem. ; Mathématiques `3` ; Éveil / Sciences `2` ; Éducation physique et sportive `1` ; 1 période chacune ; enseignant KOFFI Adjoua |
| Jours à planifier | Lun, Mar, Mer, Jeu, Ven |
| Graine | `graine-cocotiers` |
| Limite de temps (secondes) | `20` |
| Itérations d'amélioration | `5000` |

Cliquer « Lancer le calcul » : ✅ état « Proposition prête », « Séances demandées » 9, « Non placées » 0. ⚠️ Le générateur ne connaît pas la récréation (grille uniforme) ni l'après-midi de 14:30 ; ne pas « Appliquer » cette proposition sur l'emploi du temps officiel. Si une ligne parasite « CP1 » apparaît comme matière, la retirer par « Retirer ».

*« Export calendrier » — `/v2/schedule/export`* (optionnel) : « Exporter » = Classe, « Sujet de l'export » = CP1 A, « Nom du lien » = `Affichage salle des maîtres`, « Validité (jours) » = `30`, « Créer un lien d'abonnement » (« Lien créé : copiez-le maintenant. »), ne pas partager le lien, puis « Révoquer » (« Lien révoqué. »). Le téléchargement du fichier `.ics` demande l'accord de l'utilisateur.


### « Présence du personnel » — `/v2/attendance/staff`
**En une ligne :** enregistre la présence quotidienne des enseignants et instruit leurs demandes de congé (avec effet sur l'emploi du temps).
**Compte :** propriétaire (`attendance.staff.read`, `.record`, `attendance.leave.request`, `attendance.leave.decide`) · **Avant :** les trois fiches de personnel actives ; l'emploi du temps publié et ses séances générées (section précédente) pour le congé.

**Écran > bouton « Enregistrer une présence »** — une fenêtre par fiche, puis « Enregistrer »
| Membre du personnel | Jour | Statut | Note |
| :--- | :--- | :--- | :--- |
| KOFFI Adjoua | `09/10/2026` | Présent | `Arrivée à 07h20` |
| BAMBA Séraphin | `09/10/2026` | En retard | `Arrivée à 07h50` |
| ZOKORA Sylvie | `09/10/2026` | Présent | (vide) |

Laisser « Corriger un jour de congé approuvé » décochée. ✅ « Présence enregistrée. » ; sous « Présences » (colonnes « Personnel », « Date », « Statut », « Arrivée », « Départ ») les trois lignes ; « Récapitulatif » (« Jours », « Par statut », « Minutes de retard », « Jours de congé ») : 1 jour pour chacun, `LATE : 1` pour BAMBA Séraphin. Régler « Du » / « Au » sur `09/10/2026` si la période affichée par défaut ne les montre pas. ⚠️ Cas d'erreur : statut « En congé » pour ZOKORA Sylvie au `09/10/2026` → « Le statut "en congé" exige un congé approuvé couvrant ce jour. ». Les boutons « Arrivée » / « Départ » (pointage de soi-même) n'existent que sur « Ma présence », pour un compte relié à une fiche : voir « Comptes à venir ».

**Écran > bouton « Demander un congé »** — l'absence de KOFFI Adjoua du lundi 12/10/2026
| Champ | Valeur à saisir |
| :--- | :--- |
| Membre du personnel | KOFFI Adjoua |
| Type de congé | Absence autorisée |
| Premier jour | `12/10/2026` |
| Dernier jour | `12/10/2026` |
| Demi-journée le premier jour / le dernier jour | (décochées) |
| Motif | `Rendez-vous médical (test)` |

Cliquer « Envoyer la demande » : « Demande de congé envoyée. », la demande apparaît sous « Congés » (colonnes « Type », « Période », « Motif », « Statut ») à l'état « Demandé ». Puis, sur sa ligne, « Approuver » : « Congé approuvé. » (état « Approuvé ») ; une confirmation d'identité (code MFA du moment) peut être demandée, c'est un acte sensible.
✅ Quelques secondes plus tard, les séances de KOFFI Adjoua du `12/10/2026` portent « À remplacer » (traitement asynchrone). ⚠️ À ne pas utiliser ici : le type « Congé maladie » (il exige une pièce jointe, impossible à joindre depuis cet écran : « Ce type de congé exige un justificatif avant l'approbation. »). Pour voir un refus : « Demander un congé » pour ZOKORA Sylvie, Congé annuel, `19/10/2026`, motif `Test de refus`, puis « Refuser » avec « Motif du refus » = `Besoin de service (test)` → « Congé refusé. ».


### « Remplacements » — `/v2/schedule/replacements`
**En une ligne :** liste les séances dont l'intervenant est indisponible (congé approuvé, salle hors service…) et permet d'y affecter un remplaçant.
**Compte :** propriétaire (`schedule.manage`) · **Avant :** emploi du temps publié avec ses séances générées ; congé de KOFFI Adjoua du 12/10/2026 approuvé (section précédente).

**Écran > carte « EPS CP1 A » du `12/10/2026` > bouton « Remplacer »** — BAMBA Séraphin suppléant KOFFI Adjoua à l'EPS de 14:30
Régler les filtres « Du » `12/10/2026` et « Au » `12/10/2026` si besoin (par défaut : aujourd'hui + 30 jours, qui contient déjà cette date).
| Champ | Valeur à saisir |
| :--- | :--- |
| Intervenant remplacé | KOFFI Adjoua |
| Remplaçant | BAMBA Séraphin (via « Proposer des remplaçants » puis « Choisir », ou à la main) |
| Motif du remplacement | `Absence de Mme KOFFI (rendez-vous médical)` |

Cliquer « Remplacer » : ✅ « Remplacement enregistré. » ; la carte disparaît de la liste ; la séance (lundi 12/10, 14:30–15:30, Cour de récréation) porte désormais BAMBA Séraphin au rôle « Remplaçant ». Dans « Séances » (`/v2/schedule/occurrences`), le champ « Intervenants » le confirme.
⚠️ Les deux séances du matin de KOFFI Adjoua ce jour-là (07:30 et 08:30) restent « À remplacer » : BAMBA Séraphin est en classe sur ces plages (essayer de l'y affecter donne un conflit bloquant « Intervenant »), et il n'existe pas d'autre enseignant. Laisser ces cartes. La cause s'affiche en code brut (`STAFF_LEAVE`, écart connu). Cas d'erreur : « Remplaçant » vide → « Ce champ est obligatoire. » ; « Motif du remplacement » `ab` → « Le motif doit faire au moins 3 caractères. » ; remplaçant = KOFFI Adjoua → « Le remplaçant doit être une autre personne. ».


### « Faire l'appel » — `/v2/attendance/call`
**En une ligne :** ouvre l'appel journalier d'une classe (un appel par jour en maternelle, matin et après-midi au primaire) et le soumet.
**Compte :** propriétaire, qui n'est pas enseignant : il passe par le bloc « Autre classe » de la rubrique « Appel de la journée » (droit `attendance.manage`) · **Avant :** classes actives avec leurs élèves inscrits et actifs ; année et période ouvertes. Date du jour de saisie : `09/10/2026`.

**Écran > rubrique « Appel de la journée » > bloc « Autre classe »** — trois appels, puis pour chacun « Ouvrir » (« Mes séances » ramène à la liste entre deux)
| Autre classe | Date | Demi-journée | Élève à marquer « Absent » (un toucher sur sa ligne) |
| :--- | :--- | :--- | :--- |
| Grande Section A | `09/10/2026` | Journée entière | ASSI Brice |
| CP1 A | `09/10/2026` | Matin | KOUASSI Aya |
| CP1 A | `09/10/2026` | Après-midi | TRAORE Fatoumata |

Sur chaque page « Faire l'appel », tout le monde est « Présent » par défaut : ne toucher que l'élève absent, puis « Soumettre l'appel ». ✅ « Appel soumis : 1 absent, aucun retard. » (ou « Appel soumis. ») ; pastille « Appel soumis » ; « Résumé de l'appel » : Grande Section A « Présent : 2 » et « Absent : 1 », CP1 A « Présent : 2 » et « Absent : 1 ». Rouvrir CP1 A au `Matin` ouvre le **même** appel (pas de doublon).
⚠️ Refus attendus (rien n'est créé) : Grande Section A + `Matin` → « La politique d'appel de ce cycle prévoit un seul appel par jour : l'appel du matin ou de l'après-midi n'est pas autorisé. » ; CP1 A + `Journée entière` → « La politique d'appel de ce cycle demande deux appels par jour (matin et après-midi) : l'appel de la journée entière n'est pas autorisé. ». La rubrique « Aujourd'hui » du haut (séances) reste vide : pas d'appel par séance au primaire. Les boutons « Appel du matin » / « Appel de l'après-midi » / « Appel du jour » n'apparaissent que pour un instituteur titulaire (voir « Comptes à venir »).


### « Suivi des appels » — `/v2/attendance/sessions`
**En une ligne :** suit les appels ouverts, soumis et validés et permet de les valider, rouvrir ou annuler.
**Compte :** propriétaire (`attendance.read`, `attendance.validate`, `attendance.session.reopen`) · **Avant :** les trois appels du `09/10/2026` à l'état « Soumis ».

**Écran > filtres, puis bouton « Valider »** — validation des trois appels
| Champ | Valeur à saisir |
| :--- | :--- |
| Du / Au | `09/10/2026` / `09/10/2026` (par défaut : les derniers jours) |
| État | Soumis (ou « Tous ») |
| Classe | Toutes les classes |

Trois lignes (colonnes « Date », « Classe », « Type », « Pris par », « État ») : Grande Section A « Journalier », CP1 A « Journalier · Matin », CP1 A « Journalier · Après-midi ». Cocher la case de chacune puis cliquer « Valider les 3 séances sélectionnées » (ou « Valider » ligne par ligne, sans confirmation).
✅ « 3 appels validés. » (ou « Appel validé. » trois fois) ; état « Validé » ; les boutons « Valider » et « Annuler » disparaissent des lignes, « Rouvrir » reste (propriétaire seulement).
⚠️ Essai de réouverture facultatif : « Rouvrir » sur Grande Section A, « Motif » = `abc` → « Le motif doit comporter au moins 5 caractères. » ; avec `Erreur de pointage (test)` l'appel repasse à « Soumis » et il faut le « Valider » de nouveau. Le propriétaire a ici pris puis validé les mêmes appels : rien ne l'en empêche.


### « Justificatifs d'absence » — `/v2/attendance/justifications`
**En une ligne :** reçoit les justificatifs d'absence (motif, période, pièce) et permet de les accepter, rejeter ou révoquer.
**Compte :** propriétaire (dépôt `attendance.justification.submit`, décision `attendance.justification.decide`) · **Avant :** l'absence de KOUASSI Aya (CP1 A, matin du `09/10/2026`) pointée et son inscription active.

**Écran > bouton « Déposer un justificatif »** — justificatif de KOUASSI Aya
| Champ | Valeur à saisir |
| :--- | :--- |
| Élève | KOUASSI Aya (taper `KOUASSI`) |
| Premier jour d'absence | `09/10/2026` |
| Dernier jour d'absence | `09/10/2026` |
| Motif | Maladie |
| Commentaire | `Paludisme, consultation du jour (justificatif de test)` |
| Pièce jointe (facultative) | `D:\EcoleDigitaleV3\docs\guide-test\jeux-de-donnees\04-piece-eleve-test-guide.pdf` (PDF fictif de 779 octets ; 17-piece-acte-naissance-test-guide.pdf convient aussi) |

Cliquer « Déposer » : ✅ « Justificatif déposé. » ; ligne à l'état « En attente » (filtre « État » par défaut), colonne « Motif » en code brut `ILLNESS` (écart connu), « Déposé par » = « Personnel », « Pièces » = 1.
⚠️ Date future → « Un justificatif ne peut pas couvrir des dates futures. » ; « Dernier jour » avant « Premier jour » → « La fin de la fenêtre précède son début. » ; `17-piece-faux-pdf-test-guide.pdf` (faux PDF) → justificatif déposé mais « Le justificatif est déposé mais la pièce n'a pas pu être jointe : … ».

**Écran > clic sur « KOUASSI Aya » > fenêtre « Justificatif d'absence » > bouton « Accepter »** — décision
| Champ | Valeur à saisir |
| :--- | :--- |
| Note (facultative) | `Pièce reçue et conforme (test)` |

Cliquer « Ouvrir » sous « Pièces jointes » pour voir la pièce (lien temporaire, ouverture journalisée), puis « Accepter » et confirmer. ✅ « Justificatif accepté. », état « Accepté », « 1 pointage couvert » ; l'absence du matin de KOUASSI Aya passe à « Absent justifié » (visible dans « Absences » avec « Justification » = « Justifiée »). Les absences de ASSI Brice et de TRAORE Fatoumata restent « À justifier ». ⚠️ Pour tester le rejet, déposer un second justificatif pour TRAORE Fatoumata (Événement familial, `09/10/2026`, sans pièce), le « Rejeter » avec « Motif du rejet » = `Pièce manquante (test)` (« Justificatif rejeté. »).


### Écrans secondaires du module Présences (onglets, sans entrée de menu)
**En une ligne :** lecture des récapitulatifs et réglage des alertes d'assiduité.
**Compte :** propriétaire · **Avant :** appels du `09/10/2026` validés.

| Onglet — adresse | Réglages à faire / à lire |
| :--- | :--- |
| « Tableau de bord » — `/v2/attendance` | « Année scolaire » = Année scolaire 2026-2027 ; « Période » = Trimestre 1 ; « Classe » = CP1 A. Lire « Assiduité par classe » : KOUASSI Aya « Absences » = 1 dont 1 justifiée(s) (après acceptation), TRAORE Fatoumata 1 dont 0 justifiée(s), valeur « Calculé ». Bouton « Recalculer la période » : « Recalcul demandé : les récapitulatifs sont à jour. ». |
| « Absences » — `/v2/attendance/absences` | « Classe » = CP1 A, « Du »/« Au » = `09/10/2026`, « Justification » = Tous : deux lignes « Absent » (KOUASSI Aya « Justifiée », TRAORE Fatoumata « À justifier »). « Exporter en CSV » demande l'accord de l'utilisateur. |
| « Alertes » — `/v2/attendance/alerts` | Sous « Ajouter une règle » : « Code de la règle » `ABSENCES_NON_JUSTIFIEES_3`, « Indicateur » Nombre d'absences non justifiées, « Seuil » `3`, « Activer la règle dès sa création » coché, « Ajouter la règle » (« Règle ajoutée. »). Code `abs 1` → « Code attendu : majuscules, chiffres et _ (40 max). ». |
| « Appels non faits » — `/v2/attendance/compliance` | Rien à saisir : « Aucune séance attendue sur cette période. » (sans objet au primaire). |
| « Conflits de synchronisation » — `/v2/attendance/conflicts` | Rien à saisir : « Aucun conflit à arbitrer. » (ou « La synchronisation hors ligne n'est pas incluse dans votre offre. »). |


### Entrées masquées : « Calendrier de l'établissement », « Validation des séances », « Paramètres de présence »
**En une ligne :** trois entrées déclarées par les modules mais sans écran dans l'interface.
⚠️ « Calendrier de l'établissement » (`schedule.calendar.manage`), « Validation des séances » (`schedule.occurrence.validate`, validation des heures pour la paie) et « Paramètres de présence » (`attendance.settings.manage`) n'ont aucune page : le menu ne les affiche pas, l'API seule les porte. Aucune donnée à saisir : les jours fériés, vacances et fermetures ne se saisissent pas dans l'emploi du temps ; les motifs de justification, types de congé et politiques d'appel viennent du modèle de pack (non modifiables ici). Le calendrier et les jours fériés de l'année relèvent de « Paramètres académiques ».


### Comptes à venir (⚠️ impossibles tant que ces comptes n'existent pas ; données à jouer ensuite)
Aucun compte instituteur, parent ni élève n'existe : l'interface n'offre aucun moyen de relier le compte du propriétaire à une fiche de personnel (donc ni « Ma présence », ni « Mes appels » avec les boutons « Appel du matin » / « Appel de l'après-midi » / « Appel du jour », ni « Aujourd'hui »).

| Compte (relié à la fiche) | Écran | Données à saisir |
| :--- | :--- | :--- |
| Instituteur relié à KOFFI Adjoua | « Mes appels » — `/v2/teacher/attendance` | CP1 A, un jour ouvré postérieur au 09/10/2026 : « Appel du matin » (YAO Konan Éric « Absent »), « Soumettre l'appel », puis « Appel de l'après-midi » (tous présents) |
| Instituteur de maternelle relié à ZOKORA Sylvie | « Mes appels » | Grande Section A : « Appel du jour » (DAGO Chantal « Absent »), « Transmettre l'appel » |
| Instituteur relié à KOFFI Adjoua | « Ma présence » — `/v2/attendance/staff/me` | « Arrivée » puis « Départ » ; « Demander un congé » : Congé annuel, `23/10/2026`, `23/10/2026`, motif `Congé annuel (test)` |
| Parent relié à KOUASSI Hervé | « Absences de mes enfants » — `/v2/attendance/children` | KOUASSI Aya : « Déposer un justificatif », `09/10/2026` à `09/10/2026`, Maladie, même pièce que ci-dessus |
| Élève relié à KOUASSI Aya (âge 6 ans : compte peu probable) | « Mes absences » — `/v2/attendance/me` | Lecture seule du récapitulatif |
| Instituteur relié à KOFFI Adjoua | « Aujourd'hui » / « Mon emploi du temps » | Lecture des séances de CP1 A ; « Faire l'appel » par séance est refusé au primaire (« Dans votre cycle, l'appel se fait une fois par jour pour la classe, et non séance par séance. ») |


---

## Partie 6 — Pack Primaire au quotidien : compétences, conseil, bilans, archives, états

### « Ma classe » (portail instituteur) · onglet « Ma classe » du pack — `/v2/primary/classe`
**En une ligne :** le tableau de bord de la classe de l'instituteur (effectif, périodes, appel du jour, accès aux compétences et au conseil) ; la direction y voit toutes les classes.
**Compte :** instituteur (sa classe seulement) · propriétaire/directeur (les trois classes, pastille « Non titulaire ») · **Avant :** classes activées, élèves inscrits.

**Carte de la classe > période > « Marquer … prête »** (la période devient visible des familles, la saisie est gelée ; réversible)
| Champ | Valeur à saisir |
| :--- | :--- |
| Classe · Période | `CM2 A` · « Marquer Trimestre 1 prête » → confirmer « Marquer prête » |
| Motif du retrait (pour « Retirer le marquage de Trimestre 1 ») | `Marquage posé pour la recette, à retirer` (10 caractères minimum ; `court` est refusé) |
✅ « Trimestre 1 : marquée prête, les familles voient désormais les compétences et le rang provisoire. » puis « …marquage retiré… ».

**Bouton « Appel du jour »** (instituteur de maternelle seulement, un appel par jour) : marquer `ASSI Brice` absent → « Transmettre l'appel » → « Appel transmis : 1 absent. ». ⚠️ Pour une classe du primaire (matin + après-midi) ce bouton répond « Précisez la demi-journée de l'appel : matin ou après-midi. » : utiliser « Faire l'appel » dans le menu « Présences ».


### « Compétences » — `/v2/primary/competences`
**En une ligne :** la grille d'évaluation par compétences (sans note, sans moyenne) : un niveau de maîtrise par élève, par compétence et par période ; une case non saisie reste « non évaluée ».
**Compte :** instituteur titulaire (saisie et validation) · directeur (révision) · le propriétaire ne peut que lire : saisir exige une fiche de personnel liée au compte · **Avant :** classes activées, référentiel publié pour le niveau, période ouverte.

**Saisie de la période « Trimestre 1 »** (vue « Fiche élève » ou « Tableau » ; bouton « Enregistrer » puis « Valider la grille »)
| Classe (référentiel) | Élève | Compétence 1.1 | Compétence 1.2 | Compétence 2.1 |
| :--- | :--- | :--- | :--- | :--- |
| Grande Section A (maternelle, démonstration) | ADOU Aïcha | N4 Acquis avec aisance | N3 Acquis | N2 En cours d'acquisition |
| | ASSI Brice | N3 Acquis | N2 En cours d'acquisition | N3 Acquis |
| | DAGO Chantal | N2 En cours d'acquisition | N3 Acquis | (laisser non évaluée) |
| CP1 A (primaire, démonstration) : seule la compétence 1.1 | KOUASSI Aya | N3 Acquis | — | — |
| | YAO Konan Éric | N2 En cours d'acquisition | — | — |
| | TRAORE Fatoumata | (laisser non évaluée) | — | — |
| CM2 A (primaire, démonstration) : seule la compétence 1.1 | COULIBALY Ibrahim | N4 Acquis avec aisance | — | — |
| | N'GUESSAN Kouamé | N3 Acquis | — | — |
| | TANOH Marie-Ange | N3 Acquis | — | — |
Raccourci : bloc « Tous au niveau… sauf » (Niveau à appliquer = « N3 — Acquis », Portée = « Toute la classe », « Appliquer aux compétences non saisies »), puis corriger les exceptions.
✅ « Enregistré le … » ; compteur « 8 sur 9 compétences renseignées » pour la Grande Section ; une case non saisie affiche « Non évaluée » (jamais zéro). « Valider la grille » : fenêtre « Valider la grille de compétences » → « Grille validée : N compétences validées, 1 restée non évaluée. » (figé : seule une révision motivée corrige ensuite).
**Révision d'une compétence validée** (directeur ou propriétaire, authentification forte) : bouton « Réviser » sur la case de KOUASSI Aya → « Nouveau niveau » = `N4 — Acquis avec aisance` · « Motif de la révision » = `Correction après relecture du cahier de classe` (10 caractères minimum) ; refusée si la période est verrouillée. Une période « prête » refuse toute saisie (« …retirer le marquage avant de modifier la saisie. »).


### « Conseil des maîtres » — `/v2/primary/conseil`
**En une ligne :** prépare et tient le conseil des maîtres de la classe pour une période (feuille de présence, dossier par élève, propositions de l'instituteur, décisions de la direction, procès-verbal).
**Compte :** instituteur (propose), directeur/propriétaire/directeur des études (présidence, décision) · **Avant :** classe active, élèves inscrits, titulaire affecté ; la préparation peut exiger les résultats de la période.

**Cadre « Préparer un conseil »** puis « Préparer le conseil »
| Champ | Valeur à saisir |
| :--- | :--- |
| Classe | `CM2 A` |
| Période | `Trimestre 1` |
| Date de la séance (facultative) | (vide) |
✅ « Conseil préparé : un dossier par élève a été créé. » · « 3 dossiers : 3 à examiner, 0 décidés, 0 reportés. »

**Feuille de présence** (« Ajouter un participant » puis « Enregistrer la feuille de présence »)
| Participant | Rôle | Présence | Convoqué | Signature |
| :--- | :--- | :--- | :---: | :---: |
| BAMBA Séraphin (titulaire, déjà listé) | Titulaire de la classe | Présent | oui | (ne pas signer maintenant) |
| KOFFI Adjoua | Président | Présent | oui | non |
| ZOKORA Sylvie | Secrétaire | Présent | oui | non |
✅ « Feuille de présence enregistrée. » · « Aucun quorum bloquant : 3 convoqués, 3 présents. » Une présence signée est figée définitivement.

**Dossiers, un par un** (bloc « Ma proposition » puis « Enregistrer ma proposition » ; « Reporter ce dossier » / « Remettre à l'examen »)
| Élève | Proposition | Notes et observations |
| :--- | :--- | :--- |
| COULIBALY Ibrahim | Passage en classe supérieure | `Élève à l'aise en lecture et en calcul` |
| N'GUESSAN Kouamé | Passage en classe supérieure | `Progrès réguliers au deuxième semestre` |
| TANOH Marie-Ange | Passage en classe supérieure | `Travail sérieux, participation active` |
✅ « Proposition enregistrée. » (une proposition n'est pas une décision).

**Décision et procès-verbal** (direction ; **une décision confirmée est définitive**)
| Champ | Valeur à saisir |
| :--- | :--- |
| Décision retenue (si « Confirmer la proposition de la règle » est grisé : « Retenir un autre code ») | `Passage en classe supérieure` |
| Justification (20 caractères minimum) | `Décision de recette prise en séance pour un cas limite` |
| Date réelle de la séance (cadre « Procès-verbal ») | `2026-10-09` |
✅ « Décision enregistrée : Passage en classe supérieure. » ; « Procès-verbal demandé : il sera disponible dans les documents officiels. » ⚠️ Dans une école neuve, la règle peut répondre « La règle n'a produit aucune proposition pour cet élève : les résultats de la période ne sont pas calculés. » : relever le message et poursuivre.


### « Bilans annuels » — `/v2/primary/bilans`
**En une ligne :** prépare, scelle et réémet le bilan annuel de chaque élève d'une classe ; un bilan scellé est immuable.
**Compte :** directeur, propriétaire (sceller, réémettre), directeur des études (préparer) · **Avant :** inscriptions actives.

**Cadre « Année et classe »** puis « Préparer les brouillons »
| Champ | Valeur à saisir |
| :--- | :--- |
| Année | `2026-2027` |
| Classe | `CM2 A` |
✅ « Brouillons préparés : 3 créés, 0 actualisés, 0 scellés laissés intacts. » ; 3 lignes « Version 1 », « Brouillon ».
⚠️ « Sceller » est refusé en octobre : « Toutes les périodes de l'année ne sont pas clôturées. », « La décision du conseil des maîtres n'est pas confirmée. » (points à corriger listés). Le scellement et « Réémettre » (motif de 10 caractères minimum, par ex. `Correction de la décision de passage`) sont **irréversibles** : fin de parcours seulement.


### « Archives d'année » — `/v2/primary/archives`
**En une ligne :** prépare l'archive d'une année, contrôle son manifeste puis la gèle (gel logique, irréversible pour toute l'école).
**Compte :** directeur, propriétaire (geler), directeur des études (préparer) · **Avant :** bilans préparés.

| Champ | Valeur à saisir |
| :--- | :--- |
| Année | `2026-2027` |
✅ « Archive préparée. » · « Archive : En préparation » · « 0 bilans scellés sur 3 » · liste « Ce qui empêche le gel : » (année non clôturée, bilans non scellés, inscriptions sans bilan).
⚠️ Ne jamais cliquer « Geler l'archive » pendant la recette (le bouton n'apparaît d'ailleurs qu'à l'état « Prête à geler »).


### « États du primaire » — `/v2/primary/etats`
**En une ligne :** produit les sept états du primaire en aperçu tableau et en export CSV (liste de classe, effectifs, registre d'appel, redoublants, couverture des compétences, dossier du conseil, avancement).
**Compte :** directeur, propriétaire, directeur des études, secrétariat · **Avant :** classes et élèves ; les états d'appel exigent des appels faits.

**Liste « Rapport » > « Afficher l'aperçu » / « Exporter en CSV »**
| Rapport | Paramètres à saisir |
| :--- | :--- |
| Liste de classe | Classe = `Grande Section A` |
| Effectifs par niveau et par classe | Année = Année en cours |
| Registre d'appel mensuel | Classe = `CP1 A` · Mois = `2026-10` |
| Redoublants | (aucun) |
| Couverture des compétences | Classe = `CM2 A` · Période = `Trimestre 1` |
| Dossier du conseil des maîtres | Conseil = celui de la CM2 A |
| Avancement des classes | Année = Année en cours |
✅ Liste de classe : `ADOU Aïcha`, `ASSI Brice`, `DAGO Chantal` ; effectifs : 3 lignes (GS, CP1, CM2) à 3 élèves ; registre du CP1 A : colonnes `09 matin`, `09 après-midi` ; export `attendance-register.csv`.


### « Pack Primaire » · onglet « Avancement » — `/v2/primary/direction`
**En une ligne :** le feu tricolore de la direction : pour chaque classe et chaque période, combien de compétences sont saisies, validées et combien de bilans sont scellés.
**Compte :** directeur, propriétaire, directeur des études, secrétariat (lecture) · **Avant :** année ouverte, classes et inscriptions.
Aucune saisie : lire le tableau « Avancement par classe et par période » (colonnes « Classe », « Période », « État », « Élèves », « Saisies », « Validées », « Bilans scellés »). Règle : rouge = rien de saisi, vert = tout saisi et validé, orange = le reste. Liste « Année » = « Année en cours ». Valeurs attendues après les saisies de la section « Compétences » : Grande Section A « 8 sur 9 » / « 8 sur 9 » (orange), CP1 A « 2 sur 3 », CM2 A « 3 sur 3 » selon les validations.


### « Bulletin et compétences de mon enfant » (portail parent) — `/v2/primary/mon-enfant`
**En une ligne :** la famille voit, pour chacun de ses enfants, les compteurs de compétences des périodes « prêtes » ou validées et les bilans annuels publiés ; l'élève voit les siens.
**Compte :** parent (tuteur lié à un compte) ou élève · **Avant :** période marquée « prête » ou grille validée.
Aucune saisie. Parent de KOUASSI Aya (si le compte `KOUASSI Hervé` est créé avec « Accès au portail parents ») : choisir l'enfant dans « Enfant » ; attendu : pour la période « prête », un tableau de compteurs par domaine et niveau (N3 = 1), jamais de moyenne ni le détail des autres élèves ; « Aucun bilan annuel publié pour le moment. ». Le propriétaire voit « Aucun enfant n'est lié à votre compte. ».


---

## Partie 7 — Évaluations, résultats, règles de calcul, bulletins

Périmètre : groupes de menus « Évaluations », « Résultats », « Règles de calcul » et « Bulletins ». Tous sont **inclus** dans l'offre (pack PRIMARY, plan Professional) : les fonctions utiles sont présentes (`results.deliberation`, `results.public-visibility`, `rules.variants`, `rules.simulation`, `reportcard.public-verification`). Ne sont **pas** dans l'offre primaire : la session de rattrapage (`assess.session2`), l'éditeur d'expressions (`rules.expression-editor`), le relevé de notes cumulé (`reportcard.transcript`) et l'onglet « Rattrapage » des résultats (supérieur) : les ignorer.

**Comment lire ce fragment.** Les dates se tapent sans barres (`18092026` pour `18/09/2026`). Deux comptes sont nécessaires : le **propriétaire** crée les évaluations, saisit et soumet les notes ; le **directeur** relit, approuve et publie (séparation des tâches « quatre yeux » : celui qui soumet ne peut pas relire, approuver ni publier ; sensible = MFA, une fenêtre « Confirmez votre identité » peut s'ouvrir). Aucun compte instituteur n'existe : la création côté enseignant (« Mes évaluations ») est donnée en 🕓.

**Grande Section.** La Grande Section A n'a **aucune note** : pas d'évaluation à créer (évaluation par compétences, contrat `competency-period@1`, saisie dans le menu « Pack Primaire » > « Compétences »). Dans les écrans ci-dessous elle n'apparaît que pour les périodes, les délibérations et les bulletins, sans moyenne ni rang.

**Ordre de remplissage conseillé :** Types d'évaluation → Règles de calcul (lecture et liaisons) → Mes évaluations (création, saisie, soumission) → Feuilles à relire (relecture, approbation, publication) → Corrections de notes → Résultats de classe (lecture) → Délibérations → Identité et signataires → Modèles de documents → Périodes (verrouillage puis clôture, **en toute fin**) → Bulletins — émission → Bulletins — liste → simulation de la variante de règles.


### « Types d'évaluation » — `/v2/assessments/types`
**En une ligne :** définit les natures de contrôle (interrogation, devoir, composition…), leur barème et coefficient par défaut et leur groupe d'agrégation lu par les règles de calcul.
**Compte :** propriétaire (ou directeur) · **Avant :** rien (le pack a posé 9 types « Modèle » : « Interrogation », « Devoir », « Composition », « Examen blanc », « Projet », « Oral », « Travaux pratiques », « Autre », « Moyenne saisie »)

**Écran « Types d'évaluation » > bouton « Modifier » (ligne du type)** — régler le barème et la pondération par défaut du primaire
| Type (ligne) | Barème par défaut | Coefficient par défaut | Autres champs |
| :--- | :--- | :--- | :--- |
| « Interrogation » (`INTERROGATION`) | `10` | `1` | inchangés (groupe `CONTINUOUS`, « Publication manuelle ») |
| « Devoir » (`DEVOIR`) | `20` | `2` | inchangés (groupe `CONTINUOUS`) |
| « Composition » (`COMPOSITION`) | `20` | `3` | inchangés (groupe `EXAM`) |
✅ « Le type Interrogation est enregistré. » (idem pour les deux autres) ; la colonne « Barème » affiche « /10 », « /20 », « /20 » et « Coef. » `1`, `2`, `3`.
⚠️ Le code et, pour un type déjà utilisé, le groupe d'agrégation ne se modifient pas ; les décimales (virgule) sont refusées dans ces champs : taper le point si besoin (`12.5`).

**Écran « Types d'évaluation » > bouton « Nouveau type »** — créer le type « Contrôle continu » (fenêtre « Créer un type d'évaluation »)
| Champ (libellé exact) | Valeur à saisir |
| :--- | :--- |
| Code | `CONTROLE_CONTINU` |
| Libellé | `Contrôle continu` |
| Groupe d'agrégation | `CONTINUOUS` |
| Barème par défaut | `10` |
| Coefficient par défaut | `1` |
| Mode de publication | « Publication manuelle » |
| Visible des élèves et des parents | cochée |
| Autorise la session de rattrapage | décochée |
✅ « Le type Contrôle continu est enregistré. » ; ligne `CONTROLE_CONTINU`, « /10 », badge « Actif » (sans badge « Modèle »).
⚠️ Refus : code `controle continu` → « Code attendu : majuscules, chiffres et _ (2 à 32 caractères). » ; code vide ou libellé vide → « Ce champ est obligatoire. » ; barème `10,5` → « Valeur décimale attendue (3 décimales au plus). » ; même code une seconde fois → « Le code « CONTROLE_CONTINU » est déjà utilisé par un type d'évaluation. ».

**Rubrique « Réglages de la saisie »** — ne rien modifier : les deux cases « Le relecteur doit être une autre personne que le saisissant » et « L'approbateur doit être une autre personne que le relecteur » restent cochées, « Décimales autorisées » reste à `2` (c'est ce qui impose la séparation propriétaire / directeur ci-dessous).


### « Règles de calcul » — `/v2/rules` (liaisons : `/v2/rules/bindings`)
**En une ligne :** affiche les jeux de règles qui calculent moyennes, rangs et mentions, les relie au primaire et à la maternelle, et permet d'en adapter les paramètres par une variante d'établissement.
**Compte :** propriétaire (ou directeur) · **Avant :** rien pour la lecture ; **les liaisons doivent exister avant la première publication de notes** (sinon le calcul est refusé : « Aucun jeu de règles actif pour cette classe et cette période : liez un jeu de règles (liaison manquante) avant de calculer. »)

**Écran « Catalogue des jeux de règles »** — lire (rien à saisir sauf la recherche)
| Champ (libellé exact) | Valeur à saisir |
| :--- | :--- |
| Rechercher un jeu de règles | `Primaire` |
| Origine | « National » |
✅ Une carte « Primaire — jeu de démonstration (fictif) » (code `CI-PRIMARY-PLACEHOLDER`, badges « National » et « Lecture seule ») avec trois versions « Publiée » : **Version 1** (contrat `coef-period@1`), **Version 2** (`competency-period@1`, maternelle), **Version 3** (`coef-period@1`, ajoute les mentions de période). Filtre « Établissement » : « Aucun jeu de règles. » tant qu'aucune variante n'existe. Recherche `zzz` : « Aucun jeu de règles. ».
⚠️ Ce sont des **règles de démonstration** (noms terminés par « (fictif) ») : aucun barème officiel ivoirien du primaire n'est livré ; aucun bandeau ne le rappelle sur cet écran (la mention figure sur les PDF).

**Écran « Version 3 » > bouton « Ouvrir »** — valider et tester la règle de moyenne (onglet « Règles »)
| Action | Règle | « Variables (JSON) » à saisir | Résultat attendu |
| :--- | :--- | :--- | :--- |
| « Valider la version » | — | — | « La version est valide : toutes les expressions compilent et respectent le contrat. » |
| « Tester » | `moyenne_matiere` | `{"notes":[{"note":"8","bareme":"10","poids":"1","type":"CONTINUOUS"},{"note":"7.5","bareme":"10","poids":"1","type":"CONTINUOUS"}]}` | Valeur `15.5` (KOUASSI Aya en Français) |
| « Tester » | `moyenne_matiere` | `{"notes":[{"note":"15","bareme":"20","poids":"2","type":"CONTINUOUS"},{"note":"14","bareme":"20","poids":"3","type":"EXAM"}]}` | Valeur `14.4` (KOUASSI Aya en Mathématiques) |
| « Tester » | `moyenne_periode` | `{"matieres":[{"score":"15.5","coef":"4"},{"score":"14.4","coef":"4"},{"score":null,"coef":"2"},{"score":null,"coef":"1"}]}` | Valeur `14.95` : Éveil et EPS sans note sont ignorés (jamais comptés zéro) |
| « Tester » | `mention_periode` | `{"moyenne":"14.95"}` puis `{"moyenne":null}` | `GOOD` puis `PENDING` |
✅ La fenêtre « Tester la règle … » affiche « Valeur : … » et la « Trace d'évaluation ». Variables `abc` → « Saisissez un objet JSON valide. ».
⚠️ Pas de mention officielle : seuils de départ de la règle `mention_periode` (fictifs) : Passable 10, Assez bien 12, Bien 14, Très bien 16, Excellent 18.

**Écran « Liaisons aux programmes » (`/v2/rules/bindings`)** — vérifier, et ajouter seulement si absentes (bouton « Ajouter une liaison »)
| Champ (libellé exact) | Liaison 1 | Liaison 2 |
| :--- | :--- | :--- |
| Contrat de calcul | `Matières à coefficients — N périodes pondérées (coef-period@1)` | `Évaluation par compétences (maternelle) (competency-period@1)` |
| Jeu de règles | `Primaire — jeu de démonstration (fictif) (CI-PRIMARY-PLACEHOLDER)` | `Primaire — jeu de démonstration (fictif) (CI-PRIMARY-PLACEHOLDER)` |
| Périmètre | « Un niveau » | « Un niveau » |
| Code du niveau | `PRIMARY` | `PRESCHOOL` |
| En vigueur à partir du | `01/09/2026` | `01/09/2026` |
| Jusqu'au (inclus) | (vide) | (vide) |
✅ Normalement déjà posées à la création de l'école : lignes « Niveau : PRIMARY » et « Niveau : PRESCHOOL », badge « En vigueur » ; ajout : « La liaison est créée. ». Les autres contrats (`coef-semester@1`, `credit-semester@1`…) affichent « Aucune liaison pour ce contrat. » : normal.
⚠️ Refus : « Un niveau » sans code → « Saisissez le code du niveau. » ; deux liaisons qui se recoupent → « Une liaison du même périmètre couvre déjà tout ou partie de cette période. ».

**Écran « Version 3 » > « Créer une variante »** — à jouer **après la publication des notes** (la simulation rejoue les notes publiées)
| Champ (libellé exact) | Valeur à saisir |
| :--- | :--- |
| Nom de la variante | `Variante Cocotiers — seuil Bien à 15` |
| Date d'effet | `07/09/2027` |
| Fin d'effet | (vide) |
| Notes | `Essai de recette : seuil de la mention Bien relevé` |
✅ « La variante est créée en brouillon. » puis « Ouvrir la variante » : badge « Établissement », état « Brouillon ». Onglet « Règles » > `mention_periode` > tableau « Paramètres » : « Valeur de bien » = `15` puis « Enregistrer les paramètres » → « Modification enregistrée. » (autres valeurs inchangées : `actif` 1, `passable` 10, `assez_bien` 12, `tres_bien` 16, `excellent` 18). Bornes : `25` → « Au plus 20. », `-1` → « Au moins 0. », `abc` → « Saisissez un nombre. ».
Onglet « Simulation » > « Données à rejouer » (bouton « Ajouter » après chaque ligne, puis « Lancer la simulation ») :
| Classe | Période |
| :--- | :--- |
| `CP1 A` | `Trimestre 1` |
| `CM2 A` | `Trimestre 1` |
✅ « Rapport de simulation » : 6 cas rejoués ; seule la règle `mention_periode` change, pour **2 élèves** (KOUASSI Aya 14,95 et COULIBALY Ibrahim 14,23 passent de Bien à Assez bien) ; moyennes et rangs inchangés (valeurs à vérifier en test). Barre de gouvernance : « Marquer comme simulée » puis « Proposer à l'approbation » (cocher « Je confirme avoir pris connaissance de l'impact sur les décisions » si demandé) puis « Retirer la proposition ». Une variante non approuvée n'est jamais appliquée : aucun résultat ne change.
⚠️ « Approuvée » et « Publiée » sont réservées à l'opérateur de la plateforme : impossible depuis l'école. Simuler la version nationale elle-même : « Aucune version de référence à comparer… ».


### « Mes évaluations » — `/v2/teacher/assessments` (côté direction : `/v2/assessments`, `/v2/assessments/new`)
**En une ligne :** crée les évaluations d'une classe, y saisit les notes (nombre, ABS, ABJ, DISP, NN) et fait avancer la feuille dans le circuit de validation.
**Compte :** propriétaire (création, saisie, soumission). L'instituteur n'existe pas : voir 🕓. · **Avant :** classes `CP1 A` et `CM2 A` actives avec leur titulaire, types réglés, liaisons de règles, **affectation « Enseignant généraliste (toutes les matières) »** de KOFFI Adjoua (CP1 A) et BAMBA Séraphin (CM2 A) dans « Affectations »

Le menu d'administration n'a pas d'entrée « Évaluations » : ouvrir « Feuilles à relire » puis l'onglet « Évaluations » / « Nouvelle évaluation » de la barre « Évaluations et notes », ou taper `/v2/assessments/new`.

**Écran « Nouvelle évaluation » > bouton « Créer l'évaluation »** — une ligne du tableau = une évaluation (Période = `Trimestre 1`, case « Créer pour plusieurs classes à la fois » **décochée**)
| N° | Intitulé | Type d'évaluation | Date de l'évaluation | Barème (sur) | Coefficient | Classe | Cours | Enseignant |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | `Interrogation de lecture n°1` | Interrogation | `18/09/2026` | `10` | `1` | CP1 A | Français | KOFFI Adjoua |
| 2 | `Contrôle continu de lecture` | Contrôle continu | `05/10/2026` | `10` | `1` | CP1 A | Français | KOFFI Adjoua |
| 3 | `Devoir de calcul n°1` | Devoir | `25/09/2026` | `20` | `2` | CP1 A | Mathématiques | KOFFI Adjoua |
| 4 | `Composition de rentrée en calcul` | Composition | `08/10/2026` | `20` | `3` | CP1 A | Mathématiques | KOFFI Adjoua |
| 5 | `Interrogation de grammaire n°1` | Interrogation | `17/09/2026` | `10` | `1` | CM2 A | Français | BAMBA Séraphin |
| 6 | `Devoir de rédaction n°1` | Devoir | `30/09/2026` | `20` | `2` | CM2 A | Français | BAMBA Séraphin |
| 7 | `Contrôle continu de numération` | Contrôle continu | `22/09/2026` | `10` | `1` | CM2 A | Mathématiques | BAMBA Séraphin |
| 8 | `Composition de rentrée en mathématiques` | Composition | `09/10/2026` | `20` | `3` | CM2 A | Mathématiques | BAMBA Séraphin |
Dans « Enseignant », taper le nom de famille et choisir la proposition. Barème et coefficient peuvent rester vides : ils reprennent ceux du type réglé plus haut (mêmes valeurs).
✅ Écran « Évaluation créée » : « 1 évaluation créée. » avec « Saisir les notes » et « Créer une autre évaluation » ; badge « Brouillon ». Fiche : « Barème » `10`, « Coefficient » `1`… (selon la ligne), « Session 1 ».
⚠️ Refus : formulaire vide → « Choix invalide. » / « Ce champ est obligatoire. » / « Date attendue au format AAAA-MM-JJ. » ; barème `12,5` avec virgule → « Valeur décimale attendue (3 décimales au plus). » (ce champ n'accepte que le point) ; barème `0` → « Le barème doit être strictement positif. » ; « Enseignant » vide → « Indiquez l'enseignant de l'évaluation. » ; enseignant sans affectation généraliste → « L'enseignant n'est pas affecté à cette matière dans cette classe. ».
⚠️ **La création « pour plusieurs classes à la fois » échoue pour la direction** (la case n'offre pas de champ « Enseignant » ; même message « Indiquez l'enseignant de l'évaluation. ») : elle ne marche que pour un instituteur de ses propres classes. Ne pas l'utiliser ici.
⚠️ Aucune évaluation pour `Grande Section A` : elle est évaluée par compétences.

**Écran « Feuille de notes » (`/v2/assessments/<id>/grades`, bouton « Saisir les notes »)** — colonne « Note (sur N) », ordre alphabétique des élèves ; Entrée passe à l'élève suivant, puis « Enregistrer » (ou Ctrl + S), puis « Soumettre la feuille »
| Évaluation | KOUASSI Aya | TRAORE Fatoumata | YAO Konan Éric |
| :--- | :--- | :--- | :--- |
| 1 (sur 10) | `8` | `6,5` | `9` |
| 2 (sur 10) | `7,5` | `ABJ` | `5,5` |
| 3 (sur 20) | `15` | `12` | `17,5` |
| 4 (sur 20) | `14` | `11,5` | `16` |

| Évaluation | COULIBALY Ibrahim | N'GUESSAN Kouamé | TANOH Marie-Ange |
| :--- | :--- | :--- | :--- |
| 5 (sur 10) | `7` | `5` | `9` |
| 6 (sur 20) | `13` | `10,5` | `16` |
| 7 (sur 10) | `8,5` | `ABS` | `9,5` |
| 8 (sur 20) | `14,5` | `9` | `17` |
Cas particuliers : dans l'évaluation 2, `ABJ` pour TRAORE Fatoumata = **absent justifié**, avec en « Commentaire » `Absente le jour du contrôle (certificat remis)` ; dans l'évaluation 7, `ABS` pour N'GUESSAN Kouamé = absent non justifié. Une absence n'est **jamais un zéro** : elle est ignorée du calcul.
✅ Indicateur « 3 sur 3 élèves notés » (évaluations 2 et 7 : « 2 sur 3 élèves notés » avec « 1 absent ») ; « Enregistré à `<heure>` — 3 créée(s), 0 modifiée(s), 0 inchangée(s). » ; après « Soumettre la feuille » : « La feuille de notes est soumise. », état « Soumise », cellules en lecture seule.
⚠️ Refus (rien n'est enregistré tant qu'une ligne est invalide) : `21` sur une feuille sur 20 → « La note dépasse le barème (20,000). » ; `abc` ou `-3` → « Saisissez un nombre (par exemple 12,5) ou un code : ABS, ABJ, DISP, NN. » ; `12,255` → « Au plus 2 décimale(s). » ; soumettre une feuille entièrement vide → « Une évaluation sans aucune note ne peut pas être soumise. ».
🕓 À jouer quand les comptes instituteurs existeront : KOFFI Adjoua (CP1 A) et BAMBA Séraphin (CM2 A) créent les mêmes évaluations eux-mêmes sur `/v2/teacher/assessments/new` (même tableau, **sans** champ « Enseignant »), saisissent et soumettent ; leur liste « Mes évaluations » (colonnes « Évaluation », « Classe », « Matière », « Type », « Date », « État ») ne montre que leur classe. Rôle « Enseignant » (et non « Instituteur ») attribué par l'invitation : voir le fragment Personnel.


### « Feuilles à relire » — `/v2/assessments?status=SUBMITTED`
**En une ligne :** liste les feuilles soumises et permet à la direction de les relire, les approuver puis les publier aux familles.
**Compte :** **directeur** (jamais le propriétaire qui a soumis) · **Avant :** les 8 feuilles soumises par le propriétaire

**Écran « Évaluations » (filtre « État » = « Soumise ») > fiche > barre « Circuit de validation »** — pour **chacune des 8 évaluations**, dans cet ordre
| Étape | Bouton | Fenêtre / saisie | Message attendu | État obtenu |
| :--- | :--- | :--- | :--- | :--- |
| 1 | « Marquer comme relue » | — | « La feuille de notes est relue. » | « Relue » |
| 2 | « Approuver » | fenêtre « Approuver cette feuille de notes ? » > « Approuver la feuille » | « La feuille de notes est approuvée. » | « Approuvée » |
| 3 | « Publier les notes » | fenêtre « Publier les notes ? » > « Publier les notes » | « Les notes sont publiées. » | « Publiée » |
✅ Fiche : « Historique du circuit de validation » avec les étapes « Brouillon → Soumise », « Soumise → Relue », « Relue → Approuvée », « Approuvée → Publiée ». Feuille en lecture seule : « Notes publiées : elles ne se modifient plus. Utilisez « Corriger » pour demander une correction motivée. ». Le calcul des résultats suit 10 à 30 secondes après chaque publication (worker actif).
⚠️ Essai de refus à faire une fois : avec le **propriétaire**, cliquer « Marquer comme relue » sur une feuille qu'il a lui-même soumise → « La personne qui a soumis la feuille ne peut pas la relire, l'approuver ni la publier. ». Essai facultatif de retour : sur l'évaluation 7 « Soumise », directeur > « Renvoyer en brouillon » > « Commentaire » = `Barème à vérifier (essai de recette)` (5 caractères au moins) → « La feuille est renvoyée en brouillon. » ; le propriétaire corrige si besoin et la soumet de nouveau.
⚠️ L'approbation du même compte qui a relu est acceptée (le contrôle porte sur celui qui a soumis).


### « Corrections de notes » — `/v2/assessments/revisions`
**En une ligne :** gère les demandes de correction d'une note déjà publiée, motivées puis approuvées ou rejetées par une autre personne.
**Compte :** propriétaire (demande) puis directeur (décision) · **Avant :** évaluations publiées ; **période non encore verrouillée**

**Feuille de notes publiée (`/v2/assessments/<id>/grades`) > bouton « Corriger » (ligne de l'élève)** — par le propriétaire
| Évaluation | Élève | « Valeur publiée » | Nouvelle valeur | Motif de la correction |
| :--- | :--- | :--- | :--- | :--- |
| 6 `Devoir de rédaction n°1` (CM2 A) | N'GUESSAN Kouamé | 10,5 | `12` | `Erreur d'addition des points de l'exercice 3, vérifiée sur la copie (recette)` |
| 8 `Composition de rentrée en mathématiques` (CM2 A) | COULIBALY Ibrahim | 14,5 | `18` | `Demande volontairement discutable pour tester le rejet (recette)` |
Bouton « Envoyer la demande ». ✅ « La demande de correction est envoyée pour approbation. » ; sur `/v2/assessments/revisions` (filtre « État » = « Demandée » par défaut) deux cartes « Demandée », sans bouton d'approbation pour le propriétaire.

**Écran « Corrections de notes » — par le directeur**
| Demande | Bouton | Fenêtre | Saisie |
| :--- | :--- | :--- | :--- |
| N'GUESSAN Kouamé `10,5 → 12` | « Approuver » | « Approuver la correction de N'GUESSAN Kouamé » | « Commentaire (facultatif) » = `Copie revérifiée par la direction` |
| COULIBALY Ibrahim `14,5 → 18` | « Rejeter » | « Rejeter la correction de COULIBALY Ibrahim » | « Motif du rejet » = `Copie non retrouvée, correction injustifiée (recette)` |
✅ « Correction approuvée et appliquée. » (choisir « Tous les états » pour retrouver la carte : « Approuvée » puis « Appliquée ») ; « La demande de correction est rejetée. » (carte « Rejetée »). Sur la feuille, la note de N'GUESSAN Kouamé passe à `12` (bouton « Historique » : « Valeur actuelle : 12 », liste « Corrections » avec `10,5 → 12`) ; celle de COULIBALY Ibrahim reste `14,5`. Les résultats se recalculent (voir « Résultats de classe »).
⚠️ Refus : « Nouvelle valeur » vide → « Indiquez la nouvelle valeur. » ; `25` ou `abc` → « Valeur invalide : une note entre 0 et 20, ou un code d'état. » ; motif de 4 caractères → « Le motif doit faire au moins 10 caractères. » ; même valeur que la note publiée → « La nouvelle valeur est identique à la valeur publiée. » ; deuxième demande sur une note déjà en attente → « Une demande de correction est déjà en cours pour cette note. » ; rejet avec 2 caractères → « Le motif doit comporter au moins 5 caractères. ».
⚠️ **À faire avant le verrouillage de la période** : après « Verrouiller les notes », une correction approuvée attend la levée du verrou (« Correction approuvée ; elle sera appliquée à la levée du verrou de période. »).


### « Résultats de classe » — `/v2/results` (onglet « Résultats de classe » : `/v2/results/matrix`)
**En une ligne :** montre les moyennes, rangs et mentions calculés par les règles pour chaque élève d'une classe et d'une période (jamais saisis à la main).
**Compte :** propriétaire ou directeur · **Avant :** notes publiées (au moins une évaluation par matière)

**Écran « Résultats de la classe » (`/v2/results/matrix`)**
| Champ (libellé exact) | Valeur à saisir |
| :--- | :--- |
| Classe | `CP1 A`, puis `CM2 A`, puis `Grande Section A` |
| Période | `Trimestre 1` |
| Ordre d'affichage | « Par nom » puis « Par rang » |
| Afficher le détail par cours | cochée |
✅ Valeurs attendues après publication des 8 feuilles et **après** l'approbation de la correction de N'GUESSAN Kouamé (état « Provisoire » ; message « Des résultats sont provisoires : ils deviennent officiels à la clôture de la période. ») ; règle affichée `CI-PRIMARY-PLACEHOLDER` (version 3 attendue), mentions suffixées « (fictif) » :
| Classe | Élève | Français | Mathématiques | Moyenne | Rang | Mention |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| CP1 A | YAO Konan Éric | 14,5 | 16,6 | 15,55 | 1 sur 3 | Bien (fictif) |
| CP1 A | KOUASSI Aya | 15,5 | 14,4 | 14,95 | 2 sur 3 | Bien (fictif) |
| CP1 A | TRAORE Fatoumata | 13 (la note ABJ est ignorée) | 11,7 | 12,35 | 3 sur 3 | Assez bien (fictif) |
| CM2 A | TANOH Marie-Ange | 16,67 | 17,5 | 17,08 | 1 sur 3 | Très bien (fictif) |
| CM2 A | COULIBALY Ibrahim | 13,33 | 15,13 | 14,23 | 2 sur 3 | Bien (fictif) |
| CM2 A | N'GUESSAN Kouamé | 11,33 | 9 (ABS ignoré) | 10,17 | 3 sur 3 | Passable (fictif) |
Moyenne de période = moyenne des matières notées pondérée par le coefficient du curriculum (Français 4, Mathématiques 4) : Éveil et EPS, sans note, sont ignorés (colonnes « — »). Avant la correction, N'GUESSAN Kouamé avait 10,33 en Français, 9,67 de moyenne et la mention « Insuffisant (fictif) ». Survol de la moyenne : « Valeur exacte : … ». Bouton « Pourquoi ? » (« Pourquoi ce résultat ? ») sur COULIBALY Ibrahim : trace `moyenne_periode` = `wavg(matieres.score, matieres.coef)`. Colonnes « Crédits » et « Décision » : « — » (aucune décision au Trimestre 1).
Pour `Grande Section A` : trois élèves (ADOU Aïcha, ASSI Brice, DAGO Chantal) avec « — » en moyenne, rang, mention et décision (évaluation par compétences, jamais de moyenne ni de rang).
⚠️ Les deux entrées de menu « Résultats de classe » et « Périodes : verrouillage et clôture » ouvrent la **même** page `/v2/results` (état de la période) ; la matrice s'ouvre par l'onglet « Résultats de classe » ou le lien « Résultats de la classe ».
⚠️ Avant la première publication, ou si le calcul n'a pas tourné : « État de la période introuvable (…) » ou « Aucun résultat pour cette période : les notes doivent être publiées puis le calcul exécuté. » ; « Relancer le calcul » (page Périodes) force le recalcul.

**Onglet « Surcharges » (`/v2/results/overrides`)** — essai sans effet : demander puis rejeter
| Champ (libellé exact) | Valeur à saisir |
| :--- | :--- |
| Classe / Période | `CM2 A` / `Trimestre 1` |
| Élève | COULIBALY Ibrahim |
| Niveau | « Période » |
| Cours | (vide) |
| Règle ciblée | `moyenne_periode` |
| Nature | « Valeur imposée » |
| Valeur imposée | `15` |
| Justification | `Essai de recette : valeur imposée à rejeter par la direction` |
✅ Propriétaire : « La demande de surcharge est enregistrée ; elle doit être approuvée par une autre personne. » ; directeur : « Rejeter » avec « Motif du rejet » = `Pas de justification suffisante (recette)` → « La surcharge est rejetée. » ; les moyennes ne changent pas. Refus : justification de 10 caractères → « Le motif doit faire au moins 20 caractères. » ; niveau « Matière » sans « Cours » → « Indiquez le nœud du curriculum visé par la surcharge. ».
⚠️ L'onglet « Rattrapage » est propre au supérieur : l'ignorer.


### « Délibérations » — `/v2/results/decisions`
**En une ligne :** planifie les séances de conseil, enregistre les appréciations de période et, en fin d'année, confirme les décisions de passage proposées par les règles.
**Compte :** directeur (ou propriétaire) · **Avant :** notes publiées (l'état de la période existe), personnel saisi

**Onglet « Délibérations » > bouton « Planifier une délibération »** — une séance par classe et par période (fenêtre « Planifier une délibération », puis « Planifier »)
| Classe / Période | Nature | Date de la séance | Participant 1 / Rôle 1 | Participant 2 / Rôle 2 | Participant 3 / Rôle 3 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `CP1 A` / `Trimestre 1` | « Conseil de classe » | `09/10/2026` | KOFFI Adjoua / `Présidente` | BAMBA Séraphin / `Membre` | ZOKORA Sylvie / `Membre` |
| `CM2 A` / `Trimestre 1` | « Conseil de classe » | `09/10/2026` | BAMBA Séraphin / `Président` | KOFFI Adjoua / `Membre` | ZOKORA Sylvie / `Membre` |
| `Grande Section A` / `Trimestre 1` | « Conseil de classe » | `09/10/2026` | ZOKORA Sylvie / `Présidente` | KOFFI Adjoua / `Membre` | BAMBA Séraphin / `Membre` |
(« Ajouter un participant » pour les lignes 2 et 3.) Puis, sur chaque séance, bouton « Marquer comme tenue ».
✅ « La délibération est planifiée. » (badge « Planifiée ») puis « La séance est marquée comme tenue. » (badge « Tenue »). Séance **tenue** obligatoire pour clôturer la période (voir ci-dessous).
⚠️ Le libellé de nature est « Conseil de classe » ou « Jury » : au primaire, choisir « Conseil de classe » (équivalent du conseil des maîtres, qui réutilise ces séances). Si le « Conseil des maîtres » (menu « Pack Primaire ») a déjà ouvert la séance de la classe, la marquer tenue ici sans en créer une seconde.

**Onglet « Appréciations » > « Rédiger une appréciation »** — une appréciation générale de période par élève (bouton « Enregistrer l'appréciation »)
| Classe / Période | Élève | Auteur | Appréciation (1 000 caractères au plus) |
| :--- | :--- | :--- | :--- |
| `CP1 A` / `Trimestre 1` | KOUASSI Aya | « Enseignant » | `Aya lit avec aisance et progresse bien en calcul mental.` |
| `CP1 A` / `Trimestre 1` | TRAORE Fatoumata | « Enseignant » | `Fatoumata a manqué un contrôle (absence justifiée) ; les bases en lecture sont à consolider.` |
| `CP1 A` / `Trimestre 1` | YAO Konan Éric | « Conseil de classe » | `Très bon début d'année : Éric est sérieux et régulier.` |
| `CM2 A` / `Trimestre 1` | COULIBALY Ibrahim | « Direction » | `Résultats solides ; veiller à la qualité de la rédaction.` |
| `CM2 A` / `Trimestre 1` | N'GUESSAN Kouamé | « Conseil de classe » | `Des progrès sont attendus en mathématiques ; la présence aux contrôles est indispensable.` |
| `CM2 A` / `Trimestre 1` | TANOH Marie-Ange | « Enseignant » | `Excellent trimestre, félicitations.` |
✅ « L'appréciation est enregistrée. » et ligne « `<élève>` · `<auteur>` » avec la date de mise à jour ; elle sera imprimée comme appréciation générale du bulletin. Appréciation vide → « Ce champ est obligatoire. ».

**Onglet « Décisions »** — rien à saisir
✅ « Aucune décision. » / « Les décisions sont proposées à la clôture du calcul de la période. » au Trimestre 1 : avec le contrat `coef-period@1` la décision de passage (`PROMOTED`, `REPEAT`, `COUNCIL_REVIEW`, `PENDING`) n'est proposée qu'à la **dernière** période (Trimestre 3) ; à ce moment « Confirmer » (ou « Retenir une autre décision » avec un motif de 20 caractères au moins) s'applique. La règle ne confirme jamais d'elle-même `COUNCIL_REVIEW` : le conseil tranche.
⚠️ Pas de séries ni d'orientation au primaire. Maternelle : la décision de fin d'année ne vient que des compteurs de compétences (Trimestre 3).


### « Identité et signataires » — `/v2/reportcards/identity` (signataires : `/v2/reportcards/signatories`)
**En une ligne :** renseigne le nom, les mentions, la couleur et le logo imprimés sur les bulletins, les réglages des documents et les personnes qui signent.
**Compte :** propriétaire ou directeur (MFA) · **Avant :** personnel saisi (pour lier les signataires)

**Écran « Identité de l'établissement et réglages » > « Identité visuelle » > bouton « Enregistrer l'identité »**
| Champ (libellé exact) | Valeur à saisir |
| :--- | :--- |
| Nom officiel | `École Primaire Les Cocotiers` |
| Nom court | `EP Les Cocotiers` |
| En-tête gauche (une ligne par texte, 8 au plus) | `République de Côte d'Ivoire (démonstration)` ⏎ `Ministère de l'Éducation nationale (démonstration)` |
| En-tête droit | `Année scolaire 2026-2027` |
| Adresse | `Cocody, Abidjan (adresse fictive)` |
| Référence d'agrément | `AGR-COCO-0001` |
| Téléphone | `+225 05 00 00 00 80` |
| Adresse électronique | `contact@ecole-cocotiers.test` |
| Site internet | `www.ecole-cocotiers.test` |
| Pied de page | `École Primaire Les Cocotiers — Cocody, Abidjan — document de démonstration` |
| Couleur principale | `#C2410C` |
| Couleur secondaire | `#14532D` |
| Logo | fichier `docs/guide-test/jeux-de-donnees/logo-test-guide.png` (facultatif ; nécessite le stockage de fichiers) |
| Emblème | (vide) |
✅ « L'identité est enregistrée (version 1). » ; ligne « Version 1 enregistrée le … ». Avant cet enregistrement l'écran dit « Aucune identité n'est encore renseignée : les bulletins ne pourront pas être émis. ».
⚠️ Refus : « Nom officiel » vide → « Ce champ est obligatoire. » ; couleur `orange` → « Couleur attendue au format #RRGGBB. » ; 9 lignes en en-tête → « Au plus 8 éléments. » ; logo `.txt` → « Format non accepté : PNG, JPEG, WebP ou GIF. ».

**Rubrique « Réglages des documents »** (chaque case s'enregistre seule : « Réglage enregistré. »)
| Réglage (libellé exact) | Valeur |
| :--- | :--- |
| Exiger une délibération avant l'émission | décochée (la clôture de la période exige déjà une séance tenue) |
| Afficher la mention sur la page publique de vérification | décochée (mention d'un mineur) |
« Bloquer l'accès aux bulletins en cas d'impayé » n'est pas dans l'offre : la case est absente.

**Écran « Signataires » > bouton « Nouveau signataire »** (puis « Créer le signataire »)
| Nom complet | Qualité | Fonction | Membre du personnel | Valide à partir du | Valide jusqu'au | Signature (image) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `ESSOH Théodore` | `Le Directeur` | `Directeur de l'École Primaire Les Cocotiers` | (vide : pas de fiche) | `07/09/2026` | (vide) | `docs/guide-test/jeux-de-donnees/signature-test-guide.png` (facultatif) |
| `KOFFI Adjoua` | `L'Institutrice titulaire du CP1 A` | `Institutrice titulaire` | KOFFI Adjoua | `07/09/2026` | (vide) | (vide) |
| `BAMBA Séraphin` | `L'Instituteur titulaire du CM2 A` | `Instituteur titulaire` | BAMBA Séraphin | `07/09/2026` | (vide) | (vide) |
| `ZOKORA Sylvie` | `L'Institutrice titulaire de la Grande Section A` | `Institutrice de maternelle titulaire` | ZOKORA Sylvie | `07/09/2026` | (vide) | (vide) |
✅ « Le signataire ESSOH Théodore est enregistré. » ; ligne « Actif », « Valide du … au sans fin ». « Désactiver » → « Le signataire … est désactivé. » (badge « Inactif »), « Activer » pour revenir. Refus : « Nom complet » `K` → « Au moins 2 caractères. » ; « Valide jusqu'au » antérieur au début → « La fin de mandat précède son début. ».
⚠️ `ESSOH Théodore` est un nom fictif de directeur (le compte `directeur@…` n'a pas de fiche de personnel). Le modèle de bulletin n'offre que deux emplacements, « Le Directeur » (obligatoire) et « Le Responsable pédagogique » (facultatif) : les trois titulaires créés ici ne signent pas le bulletin (écart : aucun emplacement « Titulaire »).


### « Modèles de documents » — `/v2/reportcards/templates`
**En une ligne :** choisit le modèle de bulletin, ses options d'affichage et les signataires de chaque emplacement ; la configuration est versionnée.
**Compte :** propriétaire ou directeur · **Avant :** identité et signataire « ESSOH Théodore » créés

**Carte « Bulletin » > bouton « Configurer » (fenêtre « Configurer le modèle de Bulletin ») > « Enregistrer la configuration »**
| Champ (libellé exact) | Valeur à saisir |
| :--- | :--- |
| Niveau d'enseignement | « Primaire » |
| Modèle | « Bulletin du primaire et de la maternelle — avec compétences, rang et mention (modèle générique) » (clé `report-primary`) |
| Options du modèle : « Afficher le rang » | cochée (rang de compétition ; jamais de rang à la maternelle) |
| Options du modèle : « Afficher la mention de période » | cochée |
| Options du modèle : `showClassAverage` | décochée |
| Options du modèle : `showAttendance` | cochée |
| Options du modèle : `showGeneralAppreciation` | cochée |
| Options du modèle : `hideLateCount` | décochée |
| Options du modèle : `watermark` | (vide) |
| Signataires par emplacement : « Le Directeur » | `ESSOH Théodore — Le Directeur` |
| Signataires par emplacement : « Le Responsable pédagogique » (facultatif) | « Choisir un signataire » (laissé vide) |
✅ « La configuration est enregistrée. » ; carte « Bulletin » : badge « Primaire », « modèle v2, configuration v1 ». Bouton « Aperçu » : fenêtre « Aperçu du document » avec « Aperçu avec des données d'exemple ; rien n'est émis. ». Section « Modèles disponibles » : quatre modèles du primaire (`primary-bulletin` et `report-primary`, versions 1 et 2).
⚠️ Un seul réglage « Primaire » sert aux trois classes (maternelle comprise). Alternative sans bloc compétences : « Bulletin du primaire (modèle générique) — rang et mention ». Carte « Relevé de notes » : « Aucune configuration. » — ne rien faire (relevé cumulé hors offre).
⚠️ **Écart repéré dans le code** : aucun module ne fournit les compétences au bulletin (le champ `competencies` du contexte d'impression n'est jamais alimenté) : la rubrique « Compétences » restera vraisemblablement absente, y compris sur le bulletin de la Grande Section (à vérifier sur le PDF).


### « Périodes : verrouillage et clôture » — `/v2/results`
**En une ligne :** fait passer une classe et une période par les étapes verrouillage des notes, délibération et clôture, qui rend les résultats officiels et définitifs.
**Compte :** directeur (verrouiller, délibérer, clôturer, rouvrir) ; le propriétaire a les mêmes droits · **Avant :** toutes les feuilles publiées, corrections faites, séance de délibération **tenue**

⚠️ **À faire en toute fin de parcours.** Le verrouillage interdit toute saisie, publication ou création d'évaluation dans la période ; la clôture fige les résultats (seule la réouverture motivée, « Rouvrir la période », les rend modifiables, avec une version 2). Les bulletins définitifs exigent cette clôture. Ne l'exécuter qu'une fois toutes les saisies, corrections et appréciations du Trimestre 1 terminées.

**Écran « Périodes : verrouillage, délibération et clôture » — séquence identique pour les trois classes**
| Classe | Période | 1. « Verrouiller les notes » (fenêtre « Verrouiller les notes ») | 2. « Enregistrer la délibération » | 3. « Clôturer la période » |
| :--- | :--- | :--- | :--- | :--- |
| `CP1 A` | `Trimestre 1` | bouton « Verrouiller », case « Verrouiller malgré les évaluations non publiées » **décochée** | case « Confirmer d'un coup les décisions proposées par les règles » décochée | bouton « Clôturer » |
| `CM2 A` | `Trimestre 1` | idem | idem | idem |
| `Grande Section A` | `Trimestre 1` | idem (aucune évaluation à publier) | idem | idem |
✅ Avant l'action : « État de la période » `Ouverte`, « Règle appliquée » `CI-PRIMARY-PLACEHOLDER · v3` (GS : `· v2`), « Résultats de la classe » : « Inscriptions » 3, « Provisoires » 3. Étape 1 : « Les notes de la période sont verrouillées. » (« Notes verrouillées ») ; fenêtre d'avertissement tant qu'une feuille n'est pas publiée. Étape 2 : « La délibération est enregistrée. » (« Délibérée »). Étape 3 : « Période clôturée : 3 résultats figés (version 1), aucune exclusion. » ; état « Clôturée », section « Clôtures » : « Version 1 — 3 résultats figés le `<date>` » avec « Empreinte de clôture » ; résultats « Définitif » dans « Résultats de classe » (mêmes valeurs que le tableau ci-dessus).
⚠️ Refus attendus : verrouiller avec une feuille « Brouillon » ou « Soumise » → « Des évaluations de cette classe et de cette période ne sont pas publiées : publiez-les ou forcez le verrouillage avec un motif. » (case « Verrouiller malgré les évaluations non publiées » + « Motif du verrouillage forcé » de 10 caractères au moins, sinon « Le motif doit faire au moins 10 caractères. ») ; clôturer sans séance tenue : bouton « Clôturer la période » grisé avec « L'établissement exige une délibération avant la clôture. » (réglage par défaut d'une école neuve ; s'il est actif sans cela, la délibération est facultative) ; « Enregistrer la délibération » sans séance « Tenue » → « Une séance de délibération tenue (conseil ou jury) est requise. » ; après clôture, plus de bouton « Relancer le calcul » ni de surcharge possible (« La période est clôturée : rouvrez-la pour surcharger un résultat. »).
⚠️ Le Trimestre 2 et le Trimestre 3 restent ouverts : ne pas y toucher. Réouverture (non jouée) : bouton « Rouvrir la période », « Nature de la réouverture » = « Correction (toutes les notes redeviennent modifiables) », « Motif de la réouverture » de 10 caractères au moins.
⚠️ La Grande Section A n'a pas de notes : si « État de la période introuvable (…) » s'affiche, laisser d'abord les inscriptions déclencher le calcul (quelques secondes, worker actif) ou cliquer « Relancer le calcul ».


### « Bulletins — émission » — `/v2/reportcards/issue`
**En une ligne :** génère d'un coup les bulletins d'une classe à partir des résultats clôturés d'une période, avec contrôle préalable et PDF signés.
**Compte :** directeur ou propriétaire (le secrétariat peut aussi émettre) · **Avant :** période clôturée, identité, signataire « ESSOH Théodore », modèle configuré · **Le worker doit tourner avec Chrome ou Chromium**, une clé de signature et le domaine de vérification doivent être configurés (sinon points « Bloquant » : « Aucune clé de signature n'est configurée sur le serveur. » ou « Le domaine public de vérification des documents n'est pas configuré. » : défaut technique, prévenir l'équipe)

**Écran « Émettre les bulletins d'une classe » > « Contrôle préalable » puis « Générer les bulletins »**
| Classe | Période | Bulletin provisoire | Réémettre les bulletins dont les résultats ont changé |
| :--- | :--- | :--- | :--- |
| `CP1 A` | `Trimestre 1` | décochée | décochée |
| `CM2 A` | `Trimestre 1` | décochée | décochée |
| `Grande Section A` | `Trimestre 1` | décochée | décochée |
✅ Contrôle : « Tout est prêt : vous pouvez générer les bulletins. », « 3 inscriptions : 3 éligibles, 0 exclues. », « Version des résultats utilisée : 1. ». Après le clic : « Avancement du lot » badge « Terminé », « 3 émis sur 3 — 0 exclus, 0 en échec. », barre « PDF générés » (« 3 PDF prêts sur 3 bulletins émis. »), boutons « Publier le lot aux familles », « PDF de la classe » et « Voir la liste des bulletins ». Relancer « Générer les bulletins » ne crée aucun doublon.
⚠️ **L'écran n'émet que par classe entière** : l'émission « pour un seul élève » est impossible depuis l'interface (l'API accepte une liste d'inscriptions, pas l'écran). Pour traiter un élève seul, utiliser « Publier » sur sa ligne dans « Bulletins — liste ».
⚠️ Essais de refus à faire **avant** la clôture : `CP1 A` / `Trimestre 2` → « Au moins un point bloquant empêche l'émission. », « La période n'est pas clôturée pour cette classe : les bulletins définitifs s'émettent à partir de résultats clôturés. », bouton « Générer les bulletins » grisé. Cocher « Réémettre… » avec « Motif de la réémission » = `abc` → « Le motif doit faire au moins 5 caractères. ». Ne **pas** générer de « Bulletin provisoire » (il ne peut ni être supprimé ni publié).
⚠️ Grande Section A : le bulletin est émis sans moyenne ni rang ; le contenu (rubrique compétences absente, voir « Modèles de documents ») est à relever sur le PDF.


### « Bulletins — liste » — `/v2/reportcards`
**En une ligne :** liste les bulletins émis avec leur état, leur PDF et leur publication aux familles, et permet de les télécharger, publier, retirer, réémettre ou révoquer.
**Compte :** directeur ou propriétaire · **Avant :** bulletins émis

**Écran « Bulletins émis » > formulaires « Classe et période » et « Filtres »**
| Champ (libellé exact) | Valeur à saisir |
| :--- | :--- |
| Classe | `CP1 A` |
| Période | `Trimestre 1` |
| État | « Émis » puis « Tous les états » |
| Nature | « Bulletin » |
| Dernière version seulement | cochée |
| À réémettre | décochée |
✅ Trois lignes (KOUASSI Aya, TRAORE Fatoumata, YAO Konan Éric), « Version 1 », badge « Émis », « PDF prêt », boutons « Télécharger », « Publier », « Réémettre » (et « Révoquer » pour le directeur). Filtre « Nature » = « Relevé de notes » : « Aucun bulletin. » (« Émettez les bulletins d'une classe dont la période est clôturée. »).

**Publication, ligne par ligne puis par sélection** (le bouton « Publier » reste grisé, « Le PDF n'est pas encore prêt. », tant que le PDF n'est pas prêt)
| Classe | Action | Élève(s) | Message attendu |
| :--- | :--- | :--- | :--- |
| `CP1 A` | bouton « Publier » sur la ligne | YAO Konan Éric (un seul élève) | « Le bulletin de YAO Konan Éric est publié. » (badge « Publié ») |
| `CP1 A` | cocher la case de sélection puis « Publier la sélection » | KOUASSI Aya et TRAORE Fatoumata | « 2 publiés, 0 déjà publiés, 0 non publiés. » |
| `CM2 A` | « Publier le lot aux familles » (écran « Bulletins — émission ») | les 3 élèves | « 3 publiés, 0 déjà publiés, 0 non publiés. » |
| `Grande Section A` | laisser « Émis » (ne pas publier) | — | — |

**Fiche d'un bulletin** (clic sur le nom ; ex. TANOH Marie-Ange, CM2 A)
✅ « Contenu du bulletin » : « Classe » CM2 A, « Période » Trimestre 1, « Moyenne » 17,08, « Rang » 1 sur 3, « Mention » Très bien, « Décision » « — », « Délibération » « Séance du 09/10/2026 », « Règle appliquée » `CI-PRIMARY-PLACEHOLDER · v3 (résultats v1)`, « Modèle » `report-primary · v2`, « Signataires : ESSOH Théodore (Le Directeur). » ; « Vérification d'authenticité » : QR code, « Code de vérification » (26 caractères) ; bouton « Télécharger le PDF » (lien valable 5 minutes) : filigrane « DÉMONSTRATION » et pied de page « Règles de démonstration — document sans valeur officielle », appréciation générale de la ligne « Appréciations » ci-dessus. Section « Trace d'explicabilité » > « Afficher la trace » (réservée au propriétaire et au directeur).
Pour comparer : CP1 A, YAO Konan Éric 15,55 (1 sur 3, Bien), KOUASSI Aya 14,95 (2 sur 3, Bien), TRAORE Fatoumata 12,35 (3 sur 3, Assez bien) ; CM2 A, COULIBALY Ibrahim 14,23 (2 sur 3, Bien), N'GUESSAN Kouamé 10,17 (3 sur 3, Passable).
⚠️ Non joués ici car irréversibles : « Retirer », « Réémettre » (nouvelle version, ancien code « Remplacé »), « Révoquer » (propriétaire / directeur, motif de 5 caractères au moins). La vérification publique (`/v2/verify`, sans connexion) confirme « Authentique » avec la phrase de démonstration ; elle ne dévoile ni nom ni note.
🕓 Parent et élève : à jouer quand leurs comptes existeront, `/v2/reportcards/family` ne montre que les bulletins « Publié » (donc YAO, KOUASSI, TRAORE et les trois élèves du CM2 A, pas la Grande Section A).


---

## Partie 8 — Finance

**Avant de commencer.** Comptes : tout se fait avec le **propriétaire** `direction.generale@ecole-cocotiers.test` (il a tous les droits finance : barèmes, factures, encaissements, caisse, remboursements, rapprochement). Le **directeur** `directeur@ecole-cocotiers.test` (seconde fenêtre privée, MFA) sert uniquement à approuver les remboursements (règle des quatre yeux : le demandeur ne peut pas approuver sa propre demande). ⚠️ Aucun compte économe ni secrétariat n'existe : les droits « lecture seule » de ces rôles ne sont pas testables ici.
Prérequis techniques : le **service de tâches de fond (worker)** doit tourner (confirmation de l'inscription après paiement, PDF des reçus, rapprochement) ; le fournisseur « Paiement simulé (démonstration) » n'apparaît dans les écrans de paiement en ligne que si le serveur web a été lancé avec `NEXT_PUBLIC_FINANCE_SANDBOX=1` (posé par défaut par `pnpm dev:v2` / `scripts/dev-v2/cli.mjs` ; sans lui, seuls les 5 opérateurs réels non configurés sont proposés).
Pack Primaire et offre Professional : les 9 menus Finance sont visibles (paiement en ligne et échéanciers inclus). « Élèves affectés par l'État » est **absent** du menu (fonction réservée au pack Secondaire) et le financement « Affecté par l'État » est désactivé : sans objet pour le primaire. Aucun module cantine/transport dédié : ce sont de simples frais du catalogue.
Dates : champs « date » du navigateur, saisies `JJ/MM/AAAA` (navigateur en français). Montants : entiers en FCFA, sans virgule (les espaces sont ignorés). Barre de sections de l'écran Finance : « Vue d'ensemble », « Factures », « Encaissements », « À rapprocher », « Reçus », « Remboursements », « Caisse », « Frais et barèmes », « Remises et bourses », « Rapports », « Webhooks en échec », « Fournisseurs de paiement » (« Mes finances » n'apparaît que pour un parent/élève).


### « Frais et barèmes » — `/v2/finance/fees`
**En une ligne :** Définit le catalogue de ce qui peut être facturé (inscription, scolarité, cantine, transport…), le montant par niveau et année (barèmes), les plans d'échéancier et les remises.
**Compte :** propriétaire · **Avant :** année `2026-2027` et niveaux `GS`, `CP1`, `CM2` existants (déjà faits)

Quatre onglets de la sous-barre « Catalogue des frais » : « Frais », « Barèmes », « Plans d'échéancier », « Remises ». Faire dans cet ordre.

**Onglet « Frais » — créer le catalogue (bouton « Nouveau frais », fenêtre « Nouveau frais », puis « Créer »)**
Au départ la liste contient (modèle du pack Primaire, sans montant) : `REGISTRATION` « Frais d'inscription » (Inscription) et `TUITION` « Scolarité » (Scolarité). ⚠️ Si la liste est vide (worker absent à la création de l'école), créer ces deux lignes avec exactement ces codes et catégories : le reste du guide en dépend. Créer ensuite :
| Code | Libellé | Catégorie | Description |
| :--- | :--- | :--- | :--- |
| `CANTINE` | `Cantine scolaire` | « Cantine » | `Repas de midi, prix par trimestre` |
| `TRANSPORT` | `Transport scolaire` | « Transport » | `Ramassage Cocody, prix par trimestre` |
| `FOURNITURES` | `Kit de fournitures scolaires` | « Autres » | `Cahiers, stylos, ardoise` |
| `TENUE` | `Tenue scolaire (2 jeux)` | « Uniforme » | `Tenue de l'école` |
✅ Message « Le frais « Cantine scolaire » a été créé. », ligne avec statut « Actif ». Filtre « Catégorie » = « Cantine » : une ligne ; cocher « Frais actifs seulement ».
⚠️ Essais de refus : Code `tg divers` (espace) → « Code de frais invalide (A-Z, 0-9, _ ou -, 40 caractères max). » ; Code `cantine` une seconde fois → `Le code de frais "CANTINE" existe déjà.` ; Libellé vide → « Ce champ est obligatoire. ». Option : sur la ligne `TENUE`, « Désactiver » puis « Activer ».

**Onglet « Plans d'échéancier » — plan en trois trimestres (bouton « Nouveau plan », fenêtre « Nouveau plan d'échéancier », puis « Créer le plan »)**
Code `TRIM3`, Libellé `Trois trimestres`. Trois échéances (bouton « Ajouter une échéance » pour les 2e et 3e) :
| Libellé de l'échéance | Type de part | Poids | Échéance | Date |
| :--- | :--- | :--- | :--- | :--- |
| `Trimestre 1` | « Pondérée » | `1` | « Date précise » | `31/10/2026` |
| `Trimestre 2` | « Pondérée » | `1` | « Date précise » | `15/01/2027` |
| `Trimestre 3` | « Pondérée » | `1` | « Date précise » | `15/05/2027` |
✅ Message « Le plan « Trois trimestres » a été créé. » ; carte avec « Poids 1 · échéance le 31/10/2026 » etc. ⚠️ Si la page affiche « Les échéanciers ne sont pas inclus dans l'offre de l'établissement. » et pas de « Nouveau plan », noter l'écart (la fonction est pourtant du socle commun) et facturer sans plan. Refus : Code `TRIM3` une seconde fois → `Le code de plan "TRIM3" existe déjà.` ; poids `0` → « La valeur doit être supérieure ou égale à 1. ». Aucune suppression ni désactivation de plan dans l'interface.

**Onglet « Barèmes » — les montants (bouton « Nouveau barème », fenêtre « Nouveau barème », puis « Créer le barème »)**
Pour toutes les lignes : « Année scolaire » = « Année scolaire 2026-2027 », « En vigueur à partir du » = `01/09/2026`, « Jusqu'au (facultatif) » vide, « Niveau (clé) » = le code du niveau tapé tel quel en MAJUSCULES (le champ propose la liste des niveaux), « Filière (clé) » et « Type d'apprenant (clé) » vides, « Établissement » et « Campus » = « Tous ».
| Frais | Niveau (clé) | Montant | Plan d'échéancier par défaut |
| :--- | :--- | :--- | :--- |
| Frais d'inscription | `GS` | `20000` | « Aucun » |
| Frais d'inscription | `CP1` | `25000` | « Aucun » |
| Frais d'inscription | `CM2` | `30000` | « Aucun » |
| Scolarité (annuelle) | `GS` | `180000` | Trois trimestres |
| Scolarité (annuelle) | `CP1` | `240000` | Trois trimestres |
| Scolarité (annuelle) | `CM2` | `300000` | Trois trimestres |
| Cantine scolaire (par trimestre) | (vide) | `30000` | « Aucun » |
| Transport scolaire (par trimestre) | (vide) | `25000` | « Aucun » |
| Kit de fournitures scolaires | (vide) | `12000` | « Aucun » |
| Tenue scolaire (2 jeux) | (vide) | `18000` | « Aucun » |
✅ Message « Le barème a été créé. », ligne « Niveau CP1 », « En vigueur », « Depuis le 1 sept. 2026 ». Zone « Quel montant s'applique ? » : Frais = Scolarité, Année scolaire = 2026-2027, Niveau (clé) = `CP1`, « Résoudre » → « Montant applicable : 240 000 F CFA (année 2026-2027). ».
⚠️ Refus : Montant `-5` → « Le montant ne peut pas être négatif. » ; `240 000,5` → « Le montant est un entier en francs : pas de virgule ni de point. » ; second barème « Scolarité » `CP1` même année sans fin → « Un barème actif couvre déjà ce périmètre sur cette période. ». Aucun bouton pour désactiver un barème (non nettoyable). Sans « Niveau (clé) » dans le périmètre et sans inscription choisie à la facturation, un barème scopé par niveau n'est pas trouvé : toujours choisir l'inscription à la facture.

**Onglet « Remises » — remise fratrie et remise de paiement anticipé (bouton « Nouvelle remise », fenêtre « Nouvelle remise », puis « Créer »)**
| Code | Libellé | Type | Pourcentage / Montant | Plafond (facultatif) | Catégories concernées | Cumulable avec d'autres remises |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `REM-FRATRIE` | `Remise fratrie 10 %` | « Pourcentage » | `10` | (vide) | « Scolarité » | décochée |
| `REM-ANTICIPE` | `Remise paiement anticipé 6 000 F` | « Montant fixe » | `6000` | (vide) | (aucune = toutes) | décochée |
✅ Messages « La remise « Remise fratrie 10 % » a été créée. » ; valeurs « 10,00 % » et « 6 000 F CFA », « Cumulable » = « Non ». ⚠️ Aucun des 9 élèves n'a de frère ou sœur dans l'école (tuteurs tous distincts) : `REM-FRATRIE` est créée pour le catalogue mais ne s'applique à aucune facture ici ; `REM-ANTICIPE` sera appliquée dans « Facturation ». Refus : Pourcentage `150` → « Le pourcentage doit être compris entre 0,01 et 100. ».


### « Facturation » — `/v2/finance/invoices`
**En une ligne :** Émet les factures des familles à partir du catalogue (aperçu calculé avant émission, remises, échéancier) ou en saisie libre, et permet les avoirs et annulations.
**Compte :** propriétaire · **Avant :** section « Frais et barèmes » complète ; les 9 élèves inscrits et actifs ; « Remises et bourses » (bourse TANOH) faite avant la facture de scolarité de TANOH

**Écran « Nouvelle facture » (bouton « Nouvelle facture », mode « Depuis le catalogue ») — facture d'inscription, 9 élèves**
Une facture par élève ; ne contient QUE les frais d'inscription (la confirmation d'une inscription suit le paiement d'une facture qui porte des frais d'inscription ; ne pas les mélanger avec la scolarité). Pour chaque ligne : « Apprenant » = le nom ci-dessous (recherche), « Inscription » = **l'inscription de l'élève (obligatoire ici : elle donne le niveau pour le barème)**, « Année scolaire » = « Année scolaire 2026-2027 », « Frais » = Frais d'inscription, « Quantité » = `1`, remises et plan vides, puis « Calculer l'aperçu » puis « Émettre la facture ».
| Apprenant | Inscription (N°) | Total attendu | « Échéance de la facture » |
| :--- | :--- | :--- | :--- |
| ADOU Aïcha | `COCO-2026-GS-0001` | 20 000 F CFA | (vide) |
| ASSI Brice | `COCO-2026-GS-0002` | 20 000 F CFA | (vide) |
| DAGO Chantal | `COCO-2026-GS-0007` | 20 000 F CFA | `30/09/2026` |
| KOUASSI Aya | `COCO-2026-CP1-0003` | 25 000 F CFA | (vide) |
| YAO Konan Éric | `COCO-2026-CP1-0004` | 25 000 F CFA | (vide) |
| TRAORE Fatoumata | `COCO-2026-CP1-0008` | 25 000 F CFA | `30/09/2026` |
| COULIBALY Ibrahim | `COCO-2026-CM2-0005` | 30 000 F CFA | (vide) |
| N'GUESSAN Kouamé | `COCO-2026-CM2-0006` | 30 000 F CFA | (vide) |
| TANOH Marie-Ange | `COCO-2026-CM2-0009` | 30 000 F CFA | `30/09/2026` |
✅ L'aperçu affiche le sous-total, « Paiement en une fois, échéance … » ; après « Émettre la facture » : écran « Facture enregistrée » (« 1 facture a été enregistrée. ») avec le numéro `FAC-2026-nnnnnn` (pastille « Famille »). Dans la liste, statut « Émise ». Les trois échéances au `30/09/2026` (déjà passées) sont acceptées sans avertissement ; elles passeront « En retard » au prochain passage de la tâche de nuit (alimente les « En retard » et la « Balance âgée » du tableau de bord).
⚠️ Refus : Inscription laissée à « Aucune » avec un barème par niveau → « Aucun barème ne s'applique à ce frais pour ce périmètre et cette date. » ; Quantité `0` → « La valeur doit être supérieure ou égale à 1. ».

**Écran « Nouvelle facture » — facture de scolarité et services, 9 élèves (plan « Trois trimestres »)**
Mêmes réglages (Apprenant, Inscription, Année). Dans « Frais à facturer » : un bloc par frais (« Ajouter un frais » pour les suivants), « Désignation (facultatif) » vide. Dans « Remises et échéancier » : cocher la remise indiquée, « Plan d'échéancier » = « Trois trimestres », « Date de départ du plan » vide. « Calculer l'aperçu » puis « Émettre la facture ».
| Apprenant | Frais (quantité) | Remise à cocher | Total attendu | Trois tranches de |
| :--- | :--- | :--- | :--- | :--- |
| ADOU Aïcha | Scolarité (1), Cantine scolaire (3), Kit de fournitures scolaires (1) | aucune | 282 000 | 94 000 |
| ASSI Brice | Scolarité (1), Tenue scolaire (2 jeux) (1) | aucune | 198 000 | 66 000 |
| DAGO Chantal | Scolarité (1), Kit de fournitures scolaires (1) | aucune | 192 000 | 64 000 |
| KOUASSI Aya | Scolarité (1), Cantine scolaire (3), Kit de fournitures scolaires (1) | Remise paiement anticipé 6 000 F | 336 000 (342 000 − 6 000) | 112 000 |
| YAO Konan Éric | Scolarité (1), Transport scolaire (3) | aucune | 315 000 | 105 000 |
| TRAORE Fatoumata | Scolarité (1) | aucune | 240 000 | 80 000 |
| COULIBALY Ibrahim | Scolarité (1), Cantine scolaire (3), Kit de fournitures scolaires (1) | aucune | 402 000 | 134 000 |
| N'GUESSAN Kouamé | Scolarité (1), Transport scolaire (3), Kit de fournitures scolaires (1) | Remise paiement anticipé 6 000 F | 381 000 (387 000 − 6 000) | 127 000 |
| TANOH Marie-Ange | Scolarité (1), Kit de fournitures scolaires (1) | aucune (bourse de la section « Remises et bourses ») | 162 000 part famille + 150 000 part financeur | 54 000 (part famille) |
✅ Aperçu : trois lignes « Trimestre 1/2/3 » dont la somme égale le total ; fiche de la facture : statut « Émise », « Reste dû » = total, échéances « À payer » (`31/10/2026`, `15/01/2027`, `15/05/2027`). Pour TANOH : message « 2 factures ont été enregistrées (part de la famille et part du financeur). », pastilles « Famille » et « Financeur » ; relever le détail des tranches de la part du financeur.
⚠️ Avec « Remise paiement anticipé » et « Remise fratrie » toutes deux cochées, une seule s'appliquerait (non cumulables : la plus avantageuse). Une échéance passée est acceptée sans alerte (écart connu).

**Écran « Nouvelle facture » — mode « Saisie libre » : brouillon puis émission**
| Champ | Valeur à saisir |
| :--- | :--- |
| Apprenant | `COULIBALY Ibrahim` |
| Inscription | `COCO-2026-CM2-0005` |
| Année scolaire | « Année scolaire 2026-2027 » |
| Catégorie (ligne) | « Activités » |
| Désignation (ligne) | `Sortie pédagogique : Parc national du Banco (fictive)` |
| Quantité (ligne) | `1` |
| Prix unitaire (ligne) | `3000` |
Cliquer « Enregistrer en brouillon » puis, sur la fiche (titre « Facture (brouillon) », sans numéro), « Émettre la facture ». ✅ Message « La facture FAC-2026-nnnnnn a été émise. », total 3 000 F CFA, une seule échéance. ⚠️ Refus : Prix unitaire `-1` → « Le montant ne peut pas être négatif. ».

**Écran « Remises et bourses » (onglet « Remises et bourses », `/v2/finance/funding`) — bourse pour TANOH Marie-Ange**
À faire AVANT la facture de scolarité de TANOH. Choisir l'apprenant `TANOH Marie-Ange` ; lire « Type de financement » = « Privé (famille) » (ne pas le changer : la bourse s'applique quand même). Bouton « Nouvelle bourse » (fenêtre « Nouvelle bourse ou prise en charge »), puis « Créer la bourse » :
| Champ | Valeur à saisir |
| :--- | :--- |
| Type de financeur | « Fondation » |
| Nom du financeur | `Fondation Espoir Cocody` |
| Référence | `BOURSE-COCO-001` |
| Année scolaire | « Année scolaire 2026-2027 » |
| Couverture | « Pourcentage » |
| Pourcentage couvert | `50` |
| Plafond (facultatif) / Priorité | (vides) |
| Catégories couvertes | cocher « Scolarité » seulement (sinon la facture d'inscription serait aussi scindée) |
✅ Message « La bourse a été créée. », ligne « Fondation Espoir Cocody », `50,00 %`, « Active ». Après la facture de scolarité de TANOH, « Répartition des factures » liste « Part de la famille » et « Part Fondation Espoir Cocody ». ⚠️ « État » comme type de financeur est refusé (offre sans « Élèves affectés par l'État »). Refus : Pourcentage `0` ou `150` → « Le pourcentage doit être compris entre 0,01 et 100. ».

**Fiche d'une facture — corrections (à faire APRÈS la section « Encaissements »)**
| Cas | Facture | Action et valeurs |
| :--- | :--- | :--- |
| Avoir | Scolarité de ADOU Aïcha | « Émettre un avoir » : Montant de l'avoir `6000`, Motif `Geste commercial de la direction (fictif)`, « Émettre l'avoir » |
| Annulation motivée | Facture de **TRAORE Fatoumata** : créer d'abord une facture « Depuis le catalogue » avec Frais « Tenue scolaire (2 jeux) » ×1 (18 000, inscription `COCO-2026-CP1-0008`), l'émettre, puis l'ouvrir | « Annuler la facture », Motif de l'annulation `Facture émise par erreur : tenue déjà fournie par la famille`, « Annuler la facture » |
| Refus d'annulation | Scolarité de KOUASSI Aya (payée) | « Annuler la facture », motif `Tentative de test` |
✅ Avoir : « L'avoir AV-2026-nnnnnn a été émis. », « Avoirs » 6 000, « Reste dû » 6 000 de moins. Annulation : « La facture a été annulée. », statut « Annulée », bandeau « Cette facture est annulée. Motif : … », numéro conservé ; elle ne compte plus dans « Facturé ». Refus : « Une facture encaissée ne s'annule pas : remboursez puis émettez un avoir. » ; motif `abc` → « Le motif doit comporter au moins 5 caractères. » ; avoir supérieur au reste dû → « L'avoir dépasse le reste dû de la facture. ».


### « Caisse » — `/v2/finance/cash`
**En une ligne :** Gère les caisses et les sessions de caisse (fonds de caisse, encaissements en espèces, clôture avec comptage et écart).
**Compte :** propriétaire · **Avant :** section « Frais et barèmes » faite (sert à créer la caisse) ; ouvrir la session AVANT les encaissements en espèces

**Bouton « Nouvelle caisse » (fenêtre « Nouvelle caisse », puis « Créer ») — créer la caisse**
| Champ (libellé exact) | Valeur à saisir |
| :--- | :--- |
| Code | `CAISSE-PRINC` |
| Libellé | `Caisse principale Cocotiers` |
| Campus | « Tous les campus » (champ présent seulement si l'école a des campus) |
✅ « La caisse a été créée. » ; ligne dans « Caisses ». Au départ « Caisses » indique « Aucune caisse » et « Un gestionnaire doit d'abord créer une caisse. » (texte trompeur : le propriétaire peut créer la caisse). Refus : Code `CAISSE PRINC` → « Code de caisse invalide. » ; Code ou Libellé vide → « Ce champ est obligatoire. ».

**Bouton « Ouvrir une session » (fenêtre « Ouvrir une session de caisse », puis « Ouvrir la session ») — session n° 1**
| Champ | Valeur à saisir |
| :--- | :--- |
| Fonds de caisse | `20000` |
✅ « La session de caisse est ouverte. » ; « Ma session » : pastille « Ouverte », « Fonds de caisse » 20 000 F CFA, « Encaissé » 0. Tant qu'aucune session n'est ouverte, « Encaisser un paiement » en « Espèces » affiche « Aucune session de caisse ouverte : un paiement en espèces doit être rattaché à votre session. » et le bouton est bloqué. ⚠️ Fonds `-100` → « Le montant ne peut pas être négatif. ».

**Bouton « Clôturer la session » (à faire APRÈS les encaissements en espèces de la section « Encaissements ») — clôture n° 1 avec écart**
Après les trois encaissements en espèces (20 000 + 10 000 + 30 000 = 60 000), « Encaissé » = 60 000 et le montant attendu = 80 000.
| Champ (fenêtre « Clôturer la session ») | Valeur à saisir |
| :--- | :--- |
| Montant compté en caisse | `79500` |
| Observation | `Écart de 500 F : monnaie rendue en trop à un parent (fictif)` |
✅ « La session est clôturée. » ; « Résultat de la clôture » : « Montant attendu » 80 000 F CFA, « Montant compté » 79 500 F CFA, « Écart : il manque 500 F CFA en caisse. ». La clôture est définitive. ⚠️ Essayer d'abord sans Observation → refus « Écart de caisse de -500 XOF : une justification est obligatoire. » ; compté `-1` → « Le montant ne peut pas être négatif. ».
**Session n° 2 (sans écart)** : « Ouvrir une session », Fonds de caisse `5000`, puis « Clôturer la session », Montant compté en caisse `5000`, Observation vide → « Aucun écart : la caisse est juste. ». Historique : « Historique des sessions » (colonnes « Ouverte le », « Caisse », « Statut », « Attendu », « Compté », « Écart »), « Détails » sur chaque ligne.


### « Encaissements » — `/v2/finance/payments`
**En une ligne :** Enregistre les paiements reçus (espèces, chèque, virement, mobile money…), les impute aux échéances et émet un reçu numéroté ; donne aussi accès aux reçus et aux remboursements.
**Compte :** propriétaire (seconde fenêtre : directeur pour approuver les remboursements) · **Avant :** factures d'inscription et de scolarité émises ; session de caisse n° 1 ouverte

**Écran « Encaisser un paiement » (bouton « Encaisser un paiement », `/v2/finance/payments/new`) — encaissements manuels**
Pour chaque ligne : « Apprenant » = le nom, « Montant encaissé », « Mode de paiement », « Référence », « Nom du payeur », « Qui paie ? » = « Famille », bloc « Imputation du paiement » = « Automatique » sauf mention, puis « Vérifier et encaisser » puis « Confirmer l'encaissement ». Faire dans l'ordre ; relever chaque numéro de reçu `REC-2026-nnnnnn`.
| N° | Apprenant (facture visée) | Montant encaissé | Mode de paiement | Référence | Nom du payeur | Reste dû attendu après paiement |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | ADOU Aïcha (inscription) | `20000` | « Espèces » | (vide) | `ADOU Roland` | 0 (complet) |
| 2 | ASSI Brice (inscription) | `10000` | « Espèces » | (vide) | `ASSI Carine` | 10 000 (partiel) |
| 3 | N'GUESSAN Kouamé (inscription) | `30000` | « Espèces » | (vide) | `N'GUESSAN Berthe` | 0 |
| 4 | KOUASSI Aya (inscription) | `25000` | « Mobile money » | `MM-COCO-0001` | `KOUASSI Hervé` | 0 |
| 5 | YAO Konan Éric (inscription) | `25000` | « Virement » | `VIR-COCO-0001` | `YAO Mariam` | 0 |
| 6 | COULIBALY Ibrahim (inscription) | `30000` | « Chèque » | `CHQ-0001452` | `COULIBALY Awa` | 0 |
| 7 | ADOU Aïcha (scolarité) | `100000` | « Virement » | `VIR-COCO-0002` | `ADOU Roland` | 182 000 (partiel : tranche 1 soldée, 6 000 sur la tranche 2) |
| 8 | KOUASSI Aya (scolarité) | `336000` | « Virement » | `VIR-COCO-0003` | `KOUASSI Hervé` | 0 (facture « Payée ») |
| 9 | COULIBALY Ibrahim (scolarité) | `134000` | « Mobile money » | `MM-COCO-0002` | `COULIBALY Awa` | 268 000 |
| 10 | YAO Konan Éric (scolarité) | `105000` | « Chèque » | `CHQ-0001453` | `YAO Mariam` | 210 000 |
✅ Écran « Paiement enregistré » : « Le paiement de 20 000 F CFA a été enregistré. », lien « Reçu » `REC-2026-nnnnnn`, « Imputé », « Non imputé » 0, « Reste dû après paiement » (voir colonne). Les paiements 1 à 3 sont rattachés à la session de caisse (lien « Voir la session » sur la fiche du paiement). Les factures passent « Partiellement payée » ou « Payée ».
⚠️ Refus à essayer sur un montant `1000` : Mode « Virement » ou « Chèque » sans Référence → « La référence du virement est requise. » / « Le numéro de chèque est requis. » ; Montant `150,5` → « Le montant est un entier en francs : pas de virgule ni de point. » ; Montant vide → « Saisissez un montant. » ; une Référence réutilisée est acceptée sans alerte (écart connu).

**Écran « Encaisser un paiement » — acompte sans imputation puis imputation**
| Champ | Valeur à saisir |
| :--- | :--- |
| Apprenant | `ASSI Brice` |
| Montant encaissé | `50000` |
| Mode de paiement | « Mobile money » |
| Référence | `MM-COCO-0003` |
| Nom du payeur | `ASSI Carine` |
| Imputation du paiement | « Aucune (acompte) » |
✅ « Non imputé » 50 000 F CFA, « Reste dû après paiement » affiché « — ». Ouvrir « Fiche du paiement » (clic sur la date dans la liste), bouton « Imputer le solde », fenêtre « Imputer le solde du paiement », « Automatique », « Imputer » → « L'imputation a été enregistrée. », « Non imputé » 0 ; facture de scolarité d'ASSI : reste dû 148 000. Le reçu reste figé (« Paiement non imputé »).

**Écran « Encaisser un paiement » — paiement du financeur (bourse de TANOH)**
À faire après l'émission des deux factures de TANOH : ouvrir la facture « Financeur », copier l'identifiant dans le bandeau « Part prise en charge par le financeur … ».
| Champ | Valeur à saisir |
| :--- | :--- |
| Apprenant | `TANOH Marie-Ange` |
| Montant encaissé | `50000` |
| Mode de paiement | « Virement » |
| Référence | `VIR-FONDATION-0001` |
| Nom du payeur | `Fondation Espoir Cocody` |
| Qui paie ? | « Financeur » |
| Référence du financeur | l'identifiant copié (UUID de la bourse) |
✅ « Imputé » 50 000 sur la facture du financeur (tranche 1 payée) ; la part de la famille reste inchangée. ⚠️ Référence du financeur vide → « Un paiement de financeur indique la prise en charge concernée (payerRef). » (message technique ; défaut connu).

**Liste « Encaissements » (`/v2/finance/payments`)** — filtres « Apprenant », « Statut », « Mode », « Du », « Au » ; bouton « Exporter en CSV » (fichier `encaissements.csv`). Rien à saisir : filtrer par exemple « Mode » = « Chèque » (2 lignes), « Apprenant » = `ADOU Aïcha` (2 lignes).

**Onglet « Reçus » (`/v2/finance/receipts`)** — lecture : un reçu par paiement confirmé (colonnes « Numéro », « Date », « Apprenant », « Mode », « Montant »), filtre « Apprenant ». Ouvrir le reçu du paiement n° 7 : « Reste dû après ce paiement » 182 000 F CFA ; « Imprimer ou enregistrer en PDF » ouvre la boîte d'impression. Aucun bouton de modification ni de suppression (reçu immuable).

**Onglet « Remboursements » (`/v2/finance/refunds`) — règle des quatre yeux**
| N° | Demandeur → approbateur | Paiement (fiche, bouton « Demander un remboursement ») | Montant à rembourser | Motif | Décision |
| :--- | :--- | :--- | :--- | :--- | :--- |
| R1 | propriétaire → **directeur** | virement `VIR-COCO-0002` (ADOU, 100 000) | `10000` | `Erreur de saisie du virement (fictif)` | « Approuver » avec « Exécuter immédiatement » coché |
| R2 | propriétaire → **directeur** | virement `VIR-COCO-0001` (YAO, 25 000) | `5000` | `Demande de test à refuser` | « Refuser », Motif du refus `Refus du test` |
| R3 | propriétaire → **directeur** | paiement en ligne de 50 000 (voir « Paiements en ligne ») | `5000` | `Doublon signalé par la famille (fictif)` | « Approuver » (« Exécuter immédiatement » coché), puis « Confirmer un remboursement manuel » : Référence de la preuve `REMB-COCO-001`, Note vide |
✅ Demande : « La demande de remboursement a été enregistrée ; une autre personne doit l'approuver. », statut « Demandé ». R1 : « Le remboursement est approuvé et exécuté. » ; fiche du virement : « Remboursé » 10 000, reste dû de la scolarité d'ADOU 192 000. R2 : « Le remboursement est refusé. ». R3 : message « Les remboursements de paiements en ligne se font à la main chez le fournisseur… », statut « Approuvé », puis « Le remboursement manuel est enregistré. », statut « Exécuté ».
⚠️ Si le propriétaire clique « Approuver » sur sa propre demande → « Le demandeur ne peut pas approuver son propre remboursement. » ; montant `11000` sur un virement de 10 000 → « Le remboursement dépasse le montant remboursable. » ; motif `abc` → « Au moins 5 caractères. » ; référence de preuve `ab` → « Saisissez la référence de la preuve (3 caractères au moins). ».


### « Paiements en ligne » — `/v2/finance/payments/online`
**En une ligne :** Lance un paiement mobile money ou carte auprès d'un fournisseur (ici le fournisseur simulé) et suit son statut jusqu'à la confirmation.
**Compte :** propriétaire · **Avant :** facture de scolarité de N'GUESSAN Kouamé émise ; `NEXT_PUBLIC_FINANCE_SANDBOX=1` (sinon « Paiement simulé (démonstration) » est absent de la liste « Fournisseur »)

**Bouton « Paiement en ligne » depuis « Encaissements » (titre « Initier un paiement en ligne ») — trois paiements, un par issue**
Règle du fournisseur simulé sur les trois derniers chiffres du montant : se termine par `001` = en attente, `013` = échoue, tout autre montant réussit. Pour chaque ligne cliquer « Lancer le paiement » ; entre deux lignes « Nouveau paiement en ligne ».
| Champ (libellé exact) | Paiement 1 (réussit) | Paiement 2 (en attente) | Paiement 3 (échoue) |
| :--- | :--- | :--- | :--- |
| Apprenant | `N'GUESSAN Kouamé` | `N'GUESSAN Kouamé` | `N'GUESSAN Kouamé` |
| Montant | `50000` | `20001` | `20013` |
| Fournisseur | « Paiement simulé (démonstration) » | idem | idem |
| Facture visée | la facture de scolarité (381 000) | idem | idem |
| Téléphone du payeur | `+225 05 00 00 00 41` | idem | idem |
| Nom du payeur | `N'GUESSAN Berthe` | idem | idem |
| Courriel du payeur | `berthe.nguessan@exemple.test` | idem | idem |
| Libellé | `Scolarité T1 en ligne` | `Scolarité test attente` | `Scolarité test échec` |
✅ « Paiement lancé » puis « Suivi du paiement » : paiement 1 pastille « Confirmé » (« Paiement confirmé par le fournisseur. »), reçu émis, reste dû de la scolarité 331 000 ; paiement 2 « En attente » (« En attente de la confirmation du fournisseur. Cet écran vérifie régulièrement. », bouton « Vérifier maintenant » sans effet, ne pas ouvrir le lien « Ouvrir la page de paiement » qui pointe vers `sandbox.invalid`) ; paiement 3 « Échoué » (« Paiement échoué : sandbox_declined »), aucune facture modifiée. Message permanent « Paiement simulé (environnement de test) : il ne peut pas être confirmé en production. ».
⚠️ Refus : Montant `0` → « Montant invalide : chiffres uniquement, strictement positif. » ; Fournisseur « Orange Money » → `Le fournisseur "orange_money" n'est pas configuré pour ce tenant.` (aucun paiement créé) ; Courriel `abc` → « Adresse électronique invalide. ».


### « Fournisseurs de paiement » — `/v2/finance/providers`
**En une ligne :** Permet à la direction de configurer, tester, activer ou désactiver les opérateurs de paiement en ligne (Orange Money, MTN MoMo, Wave, CinetPay, TrésorPay) et de faire tourner les clés de chiffrement.
**Compte :** propriétaire (MFA) · **Avant :** rien

**Écran de lecture — aucune donnée à saisir**
| Champ | Valeur à saisir |
| :--- | :--- |
| (tous les champs d'identifiants) | **ne rien saisir** |
✅ « Environnement : Développement » ; 5 cartes, pastille « Désactivé » ou « Configuration incomplète », « Aucun compte disponible pour ce fournisseur : les paiements en ligne sont impossibles. » ; champs secrets « Non renseigné » ; « Tester la connexion » et « Activer » désactivés (« Activation impossible tant que la configuration est incomplète. »). Le fournisseur simulé n'a pas de carte ici : il ne se configure pas (il est fourni par `NEXT_PUBLIC_FINANCE_SANDBOX=1` côté web).
⚠️ Ne pas enregistrer d'identifiants, même factices : « Tester la connexion » appelle le vrai opérateur et échouerait, et le coffre des secrets peut être indisponible (« Le coffre des secrets n'est pas configuré… »). Écran réservé à la direction : l'économe en serait refusé (compte inexistant, non testable).


### « Paiements à rapprocher » — `/v2/finance/payments/pending`
**En une ligne :** Liste les paiements en ligne restés « en attente » (notification perdue) pour que la direction les conclue ou les marque échoués avec motif et preuve.
**Compte :** propriétaire (MFA récente) · **Avant :** le paiement en ligne de 20 001 F CFA ci-dessus (état « Pas encore contrôlé »)

**Ligne du paiement 20 001 — bouton « Vérifier maintenant » puis « Résoudre à la main » (fenêtre « Résoudre un paiement à la main »)**
| Champ (libellé exact) | Valeur à saisir |
| :--- | :--- |
| Ce qui s'est réellement passé | « L'argent est arrivé : confirmer le paiement (reçu et imputation) » |
| Motif | `Paiement vérifié sur le relevé du fournisseur (fictif)` (10 caractères au moins) |
| Preuve | `RELEVE-COCO-001` (3 à 120 caractères) |
Cliquer « Résoudre le paiement » ; si « Confirmez votre identité » s'ouvre, saisir le « Code à 6 chiffres » du moment (bouton du panneau de comptes de `/v2/login`) puis « Confirmer et continuer ».
✅ « Vérifier maintenant » : `Le fournisseur répond toujours "en attente".` (état du fournisseur simulé gardé en mémoire de l'API ; perdu après un redémarrage) ; puis « La résolution est enregistrée et appliquée. », la ligne disparaît, le paiement 20 001 devient « Confirmé » avec reçu, reste dû de la scolarité de N'GUESSAN Kouamé 310 999 F CFA (381 000 − 50 000 − 20 001) ; il passera à 315 999 après le remboursement manuel R3 de 5 000. La section « Demandes ouvertes (ancien circuit) » affiche « Aucune demande en attente ».
⚠️ Refus : Motif `court` → « Le motif doit faire au moins 10 caractères. » ; Preuve `ab` → « Saisissez la preuve (3 caractères au moins). » ; code `000000` → « Code invalide… ». Pour tester l'autre issue, créer un second paiement en ligne de `15001` (même élève) et choisir « L'argent n'est pas arrivé : marquer le paiement échoué », Motif `Aucun argent reçu selon le relevé (fictif)`, Preuve `RELEVE-COCO-002` : paiement « Échoué », sans reçu. Filtre « Rapprochement » : « Tous », « À rapprocher (action humaine) », « Vérification automatique en cours » (la ligne y passe après environ 15 minutes si on n'agit pas).


### « Webhooks en échec » — `/v2/finance/webhooks`
**En une ligne :** Liste les notifications authentiques des opérateurs de paiement que le système n'a pas pu appliquer, et permet à la direction de les rejouer.
**Compte :** propriétaire (rejeu : MFA) · **Avant :** rien
⚠️ Impossible de produire un événement en échec depuis l'interface : seuls les opérateurs réels (Orange Money, MTN MoMo, Wave, CinetPay, TrésorPay), jamais configurés, envoient des webhooks signés vers l'API ; le fournisseur simulé n'en émet pas dans ce parcours. Donc aucun rejeu n'est testable (« Rejouer », « Rejouer l'événement » restent invisibles).

**Écran de lecture — filtres à essayer**
| Champ (libellé exact) | Valeur à saisir |
| :--- | :--- |
| Statut | « En échec » (défaut), puis « Traité », « Ignoré », « Reçu » |
| Fournisseur | « Tous les fournisseurs » puis `Orange Money` |
| Paiement (identifiant) | `abc` |
✅ État vide : « Aucun webhook en échec » et « Toutes les notifications reçues ont été appliquées ou ignorées. » ; autres statuts : « Aucun événement pour ce filtre » ; identifiant `abc` : « Identifiant de paiement invalide. ». Encadré permanent : « Le contenu brut des notifications, les en-têtes et les signatures ne sont jamais affichés. ».


### « Tableau de bord financier » — `/v2/finance/reports`
**En une ligne :** Synthèse en lecture seule de ce qui est facturé, encaissé, restant dû et en retard, par classe, par élève, par ancienneté et par fournisseur de paiement en ligne (le titre de l'écran est « Rapports financiers »).
**Compte :** propriétaire · **Avant :** toutes les sections précédentes et le test AMANI Prisca ci-dessous (les chiffres l'incluent)

**Filtres (rien d'obligatoire)**
| Champ (libellé exact) | Valeur à saisir |
| :--- | :--- |
| Année scolaire | « Année scolaire 2026-2027 » |
| Situation au | vide (aujourd'hui), puis `01/09/2026` (doit donner 0 facturé), puis vider |
| Groupe (classe) | vide (clé interne, ne pas remplir) |
| Évolution : Du / Au / Période | `01/10/2026` / `31/10/2026` / « Jour » |
✅ « Synthèse » (8 cartes). Ordre de grandeur attendu après TOUTES les saisies de ce groupe, à vérifier à l'euro près selon ce qui a réellement été exécuté : « Facturé » 2 911 000 F CFA ; « Avoirs » 6 000 ; « Facturé net » 2 905 000 ; « Encaissé » 995 001 (net des remboursements : 165 000 d'inscription + 830 001 de scolarité, hors paiement de 15 001 échoué) ; « Restant dû » 1 909 999 ; « Paiements non imputés » 0 ; les factures d'inscription au `30/09/2026` (DAGO, TRAORE, TANOH) passent « En retard » après le passage de la tâche de nuit. « Créances par classe » : `GS-A`, `CP1-A`, `CM2-A` ; « Créances par apprenant » avec la case « Apprenants avec un restant dû seulement » ; « Balance âgée » (de « Non échu » à « Plus de 90 jours ») ; « Évolution » ; « Comptes fournisseurs » : ligne `sandbox` avec « Encaissé » 70 001, « Échoués » (20 013, +15 001 si fait). Bouton « Exporter en CSV » sur chaque bloc.
⚠️ « Du » postérieur à « Au » → « La date de début doit précéder la date de fin. ». Les écrans `Vue d'ensemble` (`/v2/finance`, 8 cartes + 6 accès rapides) donnent la même synthèse.


### Test de l'inscription « Après paiement des frais d'inscription » (élève fictif AMANI Prisca)
**En une ligne :** Vérifie qu'une inscription reste « En attente » tant que la facture des frais d'inscription n'est pas soldée, puis devient « Active » par le seul paiement.
**Compte :** propriétaire · **Avant :** barèmes « Frais d'inscription » faits (des frais d'inscription sont donc désormais dus ; sans barème, la politique confirmait l'inscription tout de suite, comme à l'étape 61 du guide Primaire), toutes les sections Finance ci-dessus, caisse sans importance (paiements en mobile money)

**Étape A — « Paramètres académiques » (`/v2/academic/settings`), onglet « Inscriptions »**
Choisir « Après paiement des frais d'inscription » puis « Enregistrer » → « Les politiques d'inscription sont enregistrées. ».

**Étape B — « Inscriptions » > « Nouvelle inscription » (`/v2/enrollments/new`), type de dossier « Nouvel élève »**
| Champ (libellé exact) | Valeur à saisir |
| :--- | :--- |
| Nom | `AMANI` |
| Prénoms | `Prisca` |
| Sexe | « Féminin » |
| Date de naissance | `19/02/2020` |
| Lieu de naissance | `Abidjan` |
| Nationalité (code pays) | `CI` |
| Année | « Année scolaire 2026-2027 » |
| Classe | `CP1 A` |
| Mode d'inscription | « Par classe (cursus complet) » |
| Type de financement | « Privé » |
Puis « Inscrire ». ✅ « N° d'inscription : COCO-2026-CP1-0010 (à relever). Statut : en attente de confirmation. » ; fiche : « Politique de confirmation : confirmée au paiement des frais d'inscription. », « L'inscription attend sa confirmation, selon la politique ci-dessus. ». ⚠️ Aucune facture n'est créée automatiquement à l'inscription : c'est l'étape C. Aucun tuteur n'est lié (à ajouter si besoin depuis la fiche élève).

**Étape C — « Facturation » > « Nouvelle facture » (mode « Depuis le catalogue »)**
| Champ | Valeur à saisir |
| :--- | :--- |
| Apprenant | `AMANI Prisca` |
| Inscription | `COCO-2026-CP1-0010` (obligatoire : c'est le lien qui permet la confirmation) |
| Année scolaire | « Année scolaire 2026-2027 » |
| Frais / Quantité | Frais d'inscription / `1` (rien d'autre sur cette facture) |
Aperçu : 25 000 F CFA ; « Émettre la facture ».

**Étape D — « Encaissements » > « Encaisser un paiement » (deux paiements, mobile money)**
| Apprenant | Montant encaissé | Mode de paiement | Référence | Nom du payeur | Résultat attendu |
| :--- | :--- | :--- | :--- | :--- | :--- |
| AMANI Prisca | `10000` | « Mobile money » | `MM-COCO-0004` | `AMANI Joël` | facture « Partiellement payée » (reste 15 000) ; inscription **toujours** « En attente » |
| AMANI Prisca | `15000` | « Mobile money » | `MM-COCO-0005` | `AMANI Joël` | facture « Payée » ; inscription « Active » après 1 à 2 minutes |
✅ Rafraîchir la fiche d'inscription (« Inscriptions » > « Liste des inscriptions ») : statut « Active » et « Confirmée le … ». Après 5 minutes sans changement : le worker ne tourne pas (écart bloquant). Contrôle de la dérogation : sur une inscription restée « En attente », le bouton « Confirmer sans paiement » (motif d'au moins 5 caractères) existe, mais ne pas l'utiliser ici.
**Étape E — remettre la politique** : « Paramètres académiques » > « Inscriptions » > « Automatique » > « Enregistrer ».


### « Scolarité de mes enfants » (espace famille) — `/v2/finance/me`
**En une ligne :** Permet à un parent de lire la situation financière de ses enfants (facturé, payé, reste à payer, échéances, reçus) et de payer en ligne.
**Compte :** parent ⚠️ aucun compte parent n'existe dans cette école (à tester après invitation d'un tuteur avec « Accès au portail parents ») · **Avant :** factures et encaissements ci-dessus
Données à contrôler une fois `ADOU Roland` connecté : carte `ADOU Aïcha` : « Facturé » 302 000, « Avoirs » 6 000, « Payé » 110 000 (20 000 + 90 000 net du remboursement de 10 000), « Reste à payer » 186 000 ; carte pour `KOUASSI Hervé` / `KOUASSI Aya` : « Facturé » 361 000, « Payé » 361 000, « Reste à payer » 0. Pour « Payer en ligne » (fenêtre « Payer en ligne ») : Facture à payer = la scolarité, Montant `20000`, Moyen de paiement « Paiement simulé (démonstration) », Numéro de téléphone `+225 05 00 00 00 42` ; `20001` reste en attente, `20013` échoue ; un montant supérieur au reste dû → « Le montant dépasse le reste dû de la facture. ».


---

## Partie 9 — Paie

> **À savoir avant de commencer.** Le module de paie de l'école Cocotiers (pack Primaire, fonction `payroll.core`) ne contient NI règles de cotisation, NI rubriques de salaire, NI « jour de paie », NI devise modifiable : la devise est fixée à XOF (affichée « Devise : XOF » dans les réglages), un bulletin = un salaire (prorata des jours ouvrés lundi-vendredi) + des heures éventuelles + des **primes et retenues saisies à la main** sur chaque bulletin. Les « cotisations fictives » du jeu de données sont donc saisies comme **retenues** libellées. Le « jour de paie » est la date à laquelle on clique « Constater le versement » (non saisissable).
> **Origine des heures au Primaire :** seules les présences du personnel (pointage « Arrivée » / « Départ » d'un compte enseignant) peuvent produire des heures ; il n'y a pas de séances validées. Les 3 enseignants n'ont pas de compte : on paie donc **au salaire**, sans heures.
> **Comptes :** le propriétaire `direction.generale@ecole-cocotiers.test` et le directeur `directeur@ecole-cocotiers.test` détiennent tous deux la paie (le rôle « Économe » n'existe pas dans l'école). Seul le **propriétaire** règle la séparation des tâches et le seuil ; seul le **propriétaire** arrête un bulletin au-dessus du seuil. Ces droits sont « sensibles » : si la fenêtre « Confirmez votre identité » s'affiche, saisir le code à 6 chiffres du moment dans « Code à 6 chiffres », puis « Confirmer et continuer ».
> **Ordre :** contrats (fiche de personnel) → « Configuration de la paie » → « Bulletins de paie » → « Historique des paiements » → « Rapports de paie » → « Masse salariale ».

### Contrats des 3 enseignants (fiche de personnel) — `/v2/staff/<identifiant>`
**En une ligne :** enregistre le contrat de travail (type, dates, volume horaire) de chaque membre du personnel ; il ne porte ni salaire ni tarif, la rémunération relève de « Configuration de la paie ».
**Compte :** propriétaire ou directeur (droit sensible `staff.contract.manage`, MFA) · **Avant :** les 3 fiches du personnel P0001, P0002, P0003.

**Fiche d'un membre, onglet « Contrats », bouton « Ajouter un contrat »** — un contrat en cours par enseignant
| Champ (libellé exact) | KOFFI Adjoua (P0001) | BAMBA Séraphin (P0002) | ZOKORA Sylvie (P0003) |
| :--- | :--- | :--- | :--- |
| Type de contrat | « Contrat à durée indéterminée » (`CDI`) | « Contrat à durée indéterminée » (`CDI`) | « Contrat à durée déterminée » (`CDD`) |
| Statut initial | « En cours » | « En cours » | « En cours » |
| Début | `01/09/2022` | `01/09/2015` | `01/09/2019` |
| Fin | (vide) | (vide) | `31/08/2027` |
| Volume horaire contractuel | `24` | `24` | `20` |
| Unité | « Par semaine » | « Par semaine » | « Par semaine » |
| Note | `Contrat fictif de test` | `Contrat fictif de test` | `Contrat fictif de test, CDD renouvelable` |
✅ « Le contrat a été ajouté. » ; la ligne affiche le type, la période (« durée indéterminée » pour KOFFI et BAMBA), « 24 h / semaine » et le statut « En cours » ; l'onglet « Charge horaire » lit ensuite 24 h (20 h pour ZOKORA) de volume contractuel.
⚠️ Lien avec les affectations (guide Primaire, « Affectations ») : tant qu'**aucun contrat « En cours » ne couvre la date de début de l'affectation** (`07/09/2026`), l'écran affiche « Aucun contrat actif ne couvre le début de cette affectation (la paie décide). » : c'est un avertissement, l'affectation est enregistrée quand même. **Créer les contrats AVANT les affectations de titulaires fait disparaître l'avertissement ; les créer APRÈS permet de le constater d'abord** (puis de vérifier qu'il n'apparaît plus sur les affectations suivantes).
⚠️ Un second contrat du même type qui chevauche le premier est refusé : « Un contrat du même type couvre déjà cette période. »

### « Configuration de la paie » — `/v2/payroll/configuration`
**En une ligne :** définit, pour chaque enseignant, comment il est payé (salaire, horaire ou mixte, avec dates d'effet), plus les tarifs horaires par cours et les réglages généraux de la paie.
**Compte :** propriétaire (réglages) ; directeur ou propriétaire (configurations et tarifs) · **Avant :** les 3 fiches du personnel (les contrats ci-dessus ne sont pas exigés par le calcul, mais restent cohérents avec lui).

**Onglet « Réglages » (`/v2/payroll/configuration/settings`, propriétaire seulement)** — séparation des tâches et seuil du propriétaire
| Champ (libellé exact) | Valeur à saisir |
| :--- | :--- |
| Devise : XOF | (lecture seule, rien à saisir) |
| Seuil d'heures supplémentaires par défaut (minutes par semaine) | `2400` (valeur de départ, « Soit 40 h par semaine. ») |
| Majoration par défaut | `1,5` (valeur de départ) |
| Séparation des tâches | cochée |
| Seuil de validation par le propriétaire | `200000` |
Cliquer « Enregistrer les réglages ».
✅ « Les réglages ont été enregistrés. » ; après rechargement les valeurs sont restituées.
⚠️ Effet : la personne qui lance le calcul d'un bulletin ne peut plus l'arrêter, et tout bulletin dont le total est **supérieur ou égal à 200 000 F CFA** (ici BAMBA) ne peut être arrêté que par le **propriétaire**. Conséquence pratique à deux comptes : **le directeur lance le calcul, le propriétaire arrête les montants** (si le propriétaire lançait le calcul, il ne pourrait pas arrêter, et le directeur ne pourrait pas arrêter les bulletins au-dessus du seuil : blocage). Refus de saisie : seuil `0` « Saisissez un nombre entier de minutes supérieur à 0. » ; majoration `6` « Le coefficient doit être compris entre 1 et 5. » ; seuil de validation `-5000` « Le montant ne peut pas être négatif. »

**Onglet « Configurations », bouton « Nouvelle configuration »** — un salaire par enseignant (« Enregistrer » après chaque ligne)
| Champ (libellé exact) | KOFFI Adjoua | BAMBA Séraphin | ZOKORA Sylvie |
| :--- | :--- | :--- | :--- |
| Enseignant | `KOFFI Adjoua` (taper puis choisir) | `BAMBA Séraphin` | `ZOKORA Sylvie` |
| Type de rémunération | « Salaire » | « Salaire » | « Mixte » |
| Salaire mensuel | `185000` | `240000` | `160000` |
| Salaire annuel | (vide) | (vide) | (vide) |
| Tarif horaire par défaut | (vide) | (vide) | `2500` |
| Seuil d'heures supplémentaires (minutes par semaine) | (vide) | (vide) | (vide) |
| Majoration des heures supplémentaires | (vide) | (vide) | (vide) |
| En vigueur à partir du | `01/09/2026` | `01/09/2026` | `01/09/2026` |
| Jusqu'au (facultatif) | (vide) | (vide) | (vide) |
✅ « La configuration a été enregistrée. » à chaque ligne ; la liste affiche « Salaire mensuel » 185 000 / 240 000 / 160 000 F CFA, « Validité » « Depuis le 01/09/2026 ». Dans « Situation d'un enseignant », choisir `KOFFI Adjoua` : « Configuration en cours ».
⚠️ Un enseignant sans configuration est « Écarté » du calcul (« Aucune configuration de paie valide sur la période. »). Une seconde configuration qui chevauche la première est refusée : « Une autre configuration de paie couvre déjà ces dates pour cet enseignant. » Un salaire `0` : « Montant invalide : chiffres uniquement, strictement positif. »

**Onglet « Tarifs horaires », bouton « Nouveau tarif »** — facultatif au Primaire (un tarif de cours ne sert qu'à des heures de séances, absentes de ce pack)
| Champ (libellé exact) | Valeur à saisir |
| :--- | :--- |
| Cours | dans le groupe « Enseignement primaire — Année scolaire 2026-2027 », l'entrée de `MATHS` « Mathématiques » (CM2) |
| Enseignant (tarif nominatif) | (vide : tarif générique) |
| Tarif horaire | `2000` |
| Valide à partir du | `07/09/2026` |
| Jusqu'au (facultatif) | (vide) |
| Notes | `Tarif générique de test, Mathématiques CM2` |
✅ « Le tarif a été enregistré. » ; la ligne porte le badge « Générique ». Dans « Simulateur de tarif » : `ZOKORA Sylvie`, cours vide, « À la date du » `09/10/2026`, « Simuler » : « Tarif retenu : 2 500 F CFA par heure — Tarif par défaut de la configuration. Configuration en cours. »

### « Bulletins de paie » — `/v2/payroll` (onglets « Périodes », « Bulletins »)
**En une ligne :** crée une période de paie, calcule les bulletins des enseignants, permet d'ajouter primes et retenues, d'arrêter le montant (contrôle à deux personnes) puis de constater le versement.
**Compte :** directeur (création, calcul, ajustements, versement) puis propriétaire (arrêt des montants) · **Avant :** « Configuration de la paie » (3 configurations) ; les réglages ci-dessus pour jouer le contrôle à deux personnes.

**Onglet « Périodes », bouton « Nouvelle période »** — la paie d'octobre 2026 (mois complet : 22 jours ouvrés, aucun prorata)
| Champ (libellé exact) | Valeur à saisir |
| :--- | :--- |
| Nom | `Paie octobre 2026` |
| Du | `01/10/2026` |
| Au | `31/10/2026` |
| Année scolaire | « Année scolaire 2026-2027 » (liste « Choisir une année… ») |
| Description | `Paie des 3 enseignants, octobre 2026` |
| Enseignants ciblés | (vide : période collective) |
Cliquer « Créer la période ».
✅ « La période « Paie octobre 2026 » a été créée. » ; la ligne affiche « Du 01/10/2026 au 31/10/2026 », « Collective », « Brouillon » et « En attente de calcul » ; tant qu'elle n'est pas calculée ou clôturée, « Nouvelle période » est désactivé.
⚠️ « Au » avant « Du » : « La date de fin précède la date de début. »

**Fiche de la période (clic sur le nom), zone « Calcul de la paie »** — aperçu puis calcul, par le directeur
| Champ / bouton (libellé exact) | Valeur à saisir |
| :--- | :--- |
| Origine des heures | « Toutes les origines » |
| Recalculer les bulletins déjà calculés | décochée |
| Limiter à certains membres du personnel | (vide) |
Cliquer d'abord « Aperçu (sans enregistrer) », puis « Lancer le calcul ».
✅ Aperçu : « Aperçu : aucun bulletin n'a été créé ni modifié. » ; calcul : « Compte rendu du calcul » avec « Calculés » 3 ; « Bulletins de la période » liste KOFFI Adjoua 185 000, BAMBA Séraphin 240 000, ZOKORA Sylvie 160 000 F CFA, type « Salaire » / « Salaire » / « Mixte », statut « Calculé », sans ligne d'heures (« Aucune ligne d'heures (bulletin de salaire). ») ; la période devient « Active ». Un second « Lancer le calcul » écarte les 3 lignes : « Déjà calculé : cochez « recalculer » pour le reconstruire. »

**Fiche d'un bulletin « Calculé » (clic sur le nom), bloc « Primes et retenues », bouton « Ajouter une prime ou une retenue »** — retenues « cotisation » fictives et primes
| Enseignant | Nature | Montant | Libellé | Motif |
| :--- | :--- | :--- | :--- | :--- |
| KOFFI Adjoua | « Retenue » | `5550` | `Cotisation de prévoyance fictive 3 %` | `Taux fictif de test` |
| KOFFI Adjoua | « Prime » | `10000` | `Prime d'assiduité octobre` | `Assiduité` |
| BAMBA Séraphin | « Retenue » | `7200` | `Cotisation de prévoyance fictive 3 %` | `Taux fictif de test` |
| BAMBA Séraphin | « Prime » | `15000` | `Prime de classe d'examen CM2` | `Classe de CM2` |
| ZOKORA Sylvie | « Retenue » | `4800` | `Cotisation de prévoyance fictive 3 %` | `Taux fictif de test` |
Cliquer « Ajouter » à chaque ligne.
✅ « L'ajustement a été ajouté. » ; totaux affichés : KOFFI **189 450 F CFA** (185 000 − 5 550 + 10 000), BAMBA **247 800 F CFA** (240 000 − 7 200 + 15 000), ZOKORA **155 200 F CFA** (160 000 − 4 800).
⚠️ Refus : montant `1500,5` « Le montant est un entier en francs : pas de virgule ni de point. » ; libellé vide « Ce champ est obligatoire. » ; une retenue supérieure au bulletin « Les retenues dépassent le montant du bulletin. » Primes et retenues ne s'ajoutent que sur un bulletin « Calculé ».

**Arrêt du montant : essai du directeur puis arrêt par le propriétaire** (quatre yeux)
| Acteur | Action | Résultat attendu |
| :--- | :--- | :--- |
| Directeur | fiche de KOFFI Adjoua, « Arrêter le montant », confirmer « Arrêter le montant » | **refusé** : « Séparation des tâches : celui qui a calculé le bulletin ne peut pas l'arrêter. » ; le bulletin reste « Calculé » |
| Propriétaire | même fiche (ou fiche de la période), « Arrêter le montant », confirmer | « Le montant du bulletin est arrêté. » ; badge « Arrêté (impayé) » ; « Calculé » par le directeur, « Arrêté » par le propriétaire ; bloc « Bulletin arrêté » avec filigrane « NON VERSÉ » et « Intégrité vérifiée » |
| Propriétaire | fiche de la période, « Tout arrêter », confirmer « Arrêter » | « Opération d'arrêt terminée. » ; « 2 bulletins arrêtés · 0 inchangé(s) · 0 refusé(s). » (BAMBA, au-dessus du seuil de 200 000, n'est arrêtable que par lui) |
⚠️ Le propriétaire ne peut arrêter que ce qu'il n'a pas lui-même calculé : d'où le calcul par le directeur. Sans la case « Séparation des tâches », un seul compte pourrait calculer, arrêter et verser. Après arrêt, plus de primes ni retenues : « Seul un bulletin « calculé » accepte des primes ou retenues. » Si le directeur essaie d'arrêter BAMBA alors que la séparation est décochée : « Ce montant dépasse le seuil : seul le propriétaire peut arrêter ce bulletin. »

**Fiche d'un bulletin « Arrêté (impayé) », bouton « Constater le versement »** — le virement ou l'espèce (directeur ou propriétaire)
| Enseignant | Mode de versement | Référence |
| :--- | :--- | :--- |
| KOFFI Adjoua | « Virement bancaire » | `VIR-COCO-2610-001` |
| BAMBA Séraphin | « Espèces » | (vide) |
| ZOKORA Sylvie | (ne pas verser tout de suite : laisser « Arrêté (impayé) » pour lire l'historique et les rapports, puis « Mobile money » + `MM-COCO-2610-003`) | |
Cliquer « Constater le versement » dans la fenêtre (rappel « Vous constatez le versement de 189 450 F CFA. » pour KOFFI).
✅ « Le versement est constaté. » ; badge « Versé » ; « Versé » « par `<nom>`, le `<date>` · Virement bancaire · VIR-COCO-2610-001 » ; le bouton « Annuler le bulletin » disparaît (un bulletin versé ne s'annule pas). Versement par lot possible depuis la fiche de la période : cocher la ligne, « Verser la sélection (1) » ou « Tout verser » : « Opération de versement terminée. »
⚠️ « Envoyer au titulaire » enregistre seulement une demande (« L'envoi du bulletin à son titulaire a été demandé. ») : aucun compte enseignant n'existe, aucun envoi réel.

**Onglet « Bulletins » (`/v2/payroll/payslips`)** — liste de tous les bulletins avec filtres
| Filtre (libellé exact) | Valeur à saisir |
| :--- | :--- |
| Enseignant | `BAMBA Séraphin` (puis vider) |
| Période | « Paie octobre 2026 » |
| Statut | « Versé », puis « Arrêté (impayé) », puis « Tous les statuts » |
✅ La liste montre 3 lignes pour la période (colonnes « Enseignant », « Période », « Type », « Statut », « Montant », « Calculé le »).

**Clôture de la période (fin de cycle, facultatif)** — fiche de la période, « Clôturer la période » (« Une période clôturée n'accepte plus de nouveau calcul. »), confirmer « Clôturer » : « Le statut de la période a été mis à jour. », badge « Clôturée ». À faire après le versement de ZOKORA.

### « Historique des paiements » — `/v2/payroll/history`
**En une ligne :** liste les bulletins dont le montant est arrêté ou versé (qui a arrêté, qui a versé, comment), avec export CSV.
**Compte :** directeur ou propriétaire · **Avant :** au moins un bulletin arrêté dans « Bulletins de paie ».

**Écran / filtres et bouton « Exporter en CSV »** — lecture et export
| Champ (libellé exact) | Valeur à saisir |
| :--- | :--- |
| Année scolaire | « Année scolaire 2026-2027 » |
| Période | « Paie octobre 2026 » |
| Enseignant | `KOFFI Adjoua` (puis vider) |
✅ KOFFI : « Versé », colonne « Arrêté » « `<date>`, par `<propriétaire>` », colonne « Versé » « `<date>`, par `<directeur>` (Virement bancaire) », « Montant » 189 450 F CFA ; BAMBA « Versé » (Espèces) 247 800 F CFA ; ZOKORA « Arrêté (impayé) » 155 200 F CFA. Le fichier `historique-paie.csv` est téléchargé (ouvrir dans un tableur, accents lisibles) ; pendant l'export le bouton affiche « Export en cours… ».

### « Rapports de paie » — `/v2/payroll/reports`
**En une ligne :** totalise les bulletins par statut et par origine des heures (présences, séances, hors heures) avec filtres et export CSV.
**Compte :** directeur ou propriétaire · **Avant :** bulletins calculés.

**Écran / filtres et bouton « Exporter en CSV »** — lecture et export
| Champ (libellé exact) | Valeur à saisir |
| :--- | :--- |
| Année scolaire | « Année scolaire 2026-2027 » |
| Période | « Paie octobre 2026 » |
| Origine des heures | « Toutes les origines » (puis « Présences seulement ») |
| Du / Au | `01/10/2026` / `31/10/2026` |
| Enseignant | (vide) |
✅ Tableau « Bulletins par statut » : « Versé » 2 bulletins (437 250 F CFA), « Arrêté (impayé) » 1 bulletin (155 200 F CFA) ; colonnes « Présences » et « Séances » à 0, tout le montant en « Hors heures » (c'est du salaire) ; pour chaque statut « Présences » + « Séances » + « Hors heures » = « Total ». Fichier `rapport-paie.csv` à l'export. Si ZOKORA a été versée entre-temps : « Versé » 3 bulletins, 592 450 F CFA.
⚠️ Au Primaire l'origine « Séances seulement » n'est pas proposée (fonction réservée aux packs Supérieur et Virtuel).

### « Masse salariale » (portail propriétaire, paie) — `/v2/payroll/owner`
**En une ligne :** montre au propriétaire le total de la paie par période et par statut, et lui permet de valider (arrêter) les bulletins calculés en attente.
**Compte :** propriétaire (le directeur voit l'écran mais ne peut pas arrêter au-dessus du seuil) · **Avant :** bulletins calculés dans « Bulletins de paie » ; fonction `payroll.owner-validation` incluse au pack Primaire.

**Écran / bouton « Bulletins à valider » de la ligne « Paie octobre 2026 »** — lecture et validation d'un bulletin « Calculé »
| Champ / bouton (libellé exact) | Valeur à saisir |
| :--- | :--- |
| Bulletins à valider (période « Paie octobre 2026 ») | cliquer pour déplier (à jouer AVANT l'arrêt dans « Bulletins de paie » : alternative à « Arrêter le montant ») |
| Valider (en face de BAMBA Séraphin) | cliquer |
✅ Indication « Valider arrête le montant du bulletin, comme sur l'écran du gestionnaire (même action). » ; message « Le bulletin est validé. » ; le bulletin passe à « Arrêté (impayé) ». Totaux lus : « Masse salariale comptée » 592 450 F CFA et « 3 bulletins comptés (hors annulés et contestés). » ; par statut : « Versé », « Arrêté (impayé) » et la ligne « Compté » ; « À part — annulés : 0 F CFA (0) · contestés : 0 F CFA (0). »
⚠️ Deux entrées portent le libellé « Masse salariale » dans le portail propriétaire : celle-ci (validation, `/v2/payroll/owner`) et la suivante (pilotage, `/v2/owner/paie`).

### « Masse salariale » (portail propriétaire, pilotage) — `/v2/owner/paie`
**En une ligne :** tableau de bord en lecture seule de la masse salariale par période de paie et par statut, exportable.
**Compte :** propriétaire (droit sensible `analytics.payroll.read`, MFA, chaque consultation est enregistrée) · **Avant :** au moins une période de paie calculée.

**Écran / filtre** — lecture
| Champ (libellé exact) | Valeur à saisir |
| :--- | :--- |
| Année scolaire | « Année scolaire 2026-2027 » |
✅ « Masse comptée » 592 450 F CFA (« 3 bulletin(s) calculés, arrêtés ou payés »), « Périodes de paie » 1 ; tableau « Masse salariale par période de paie » : ligne « Paie octobre 2026 », « Du 01/10/2026 au 31/10/2026 », « Bulletins » 3, « Par statut » Payé / Arrêté, « Annulés » 0, « Contestés » 0 ; bouton « Exporter (CSV) ». La validation d'une paie ne se fait pas ici.

### « Mes rémunérations » (portail enseignant) — `/v2/payroll/my` (ou `/v2/teacher/payslips`)
**En une ligne :** l'enseignant lit ses propres bulletins une fois le montant arrêté, télécharge le PDF après versement et peut contester un bulletin non versé.
**Compte :** enseignant ayant un compte lié à sa fiche (KOFFI, BAMBA ou ZOKORA) · **Avant :** bulletin « Arrêté (impayé) » ou « Versé ».
⚠️ **Non saisissable avec les comptes actuels** : les 3 enseignants n'ont pas de compte portail (il faudrait les inviter depuis leur fiche, « Inviter au portail », puis activer le compte) ; le propriétaire et le directeur n'ont pas de fiche de personnel et obtiendraient « Votre compte n'est lié à aucun membre du personnel ». Donnée attendue si le compte existait : pour KOFFI Adjoua, une ligne « Versé » de 189 450 F CFA (primes 10 000, retenues 5 550, virement `VIR-COCO-2610-001`) ; un bulletin « Calculé » n'est jamais visible du titulaire.


---

## Partie 10 — Admissions

**Fil conducteur.** On prépare la rentrée avec le jeu de dossiers ci-dessous (tous fictifs, distincts des 9 élèves) ; l'ordre de saisie est celui des sections : réglages, parcours, campagnes, prospects, dossiers, pipeline, liste d'attente, rapports.

| Dossier | Niveau (campagne) | Origine | Destin dans le jeu de test |
| :--- | :--- | :--- | :--- |
| AMANI Prisca (F, 17/08/2020) | CP1 (campagne CP1 et CM2) | saisie directe | admise, offre acceptée par le lien public, élève inscrit |
| DIOMANDE Salif (M, 04/06/2015) | CM2 (campagne CP1 et CM2) | saisie directe | admis, offre acceptée « au nom de la famille », élève inscrit |
| KOUADIO Elie (M, 09/02/2021) | Grande Section (campagne GS) | prospect KOUADIO Rosalie | admis, la famille décline l'offre : la place est libérée |
| SORO Nina (F, 21/05/2021) | Grande Section (campagne GS) | prospect SORO Awa | liste d'attente, puis promue sur la place libérée (offre en attente) |
| BROU Maëlle (F, 30/11/2021) — **5e dossier facultatif** | Grande Section (campagne GS) | saisie directe | liste d'attente avant Nina, puis refusée (sert à classer la liste et aux rapports) |

Repères communs : les dates se saisissent avec le sélecteur du navigateur (`jj/mm/aaaa`, et `jj/mm/aaaa hh:mm` pour les heures). Téléphones `+225 05 00 00 00 NN` ; e-mails `@exemple.test`. Pièces à déposer : `D:\EcoleDigitaleV3\docs\guide-test\jeux-de-donnees\17-piece-acte-naissance-test-guide.pdf`, `17-piece-photo-identite-test-guide.png`, `17-piece-bulletin-precedent-test-guide.pdf` (même dossier).

**Particularités du pack Primaire.** Les huit menus sont visibles au plan Professional. L'option « Affecté par l'État » du mode de prise en charge existe dans les listes mais n'est incluse que dans le pack Secondaire : ne pas la choisir. La section « Résultat d'examen » (CEPE vers la 6e) d'un dossier n'a pas de sens ici et reste absente. Il n'existe aucun réglage « frais de dossier » dans les admissions : seuls les frais d'inscription (module Finance, catégorie REGISTRATION) sont facturés à l'acceptation d'une offre ; l'école neuve n'en a pas (voir « Candidatures », point J).


### « Paramètres des admissions » — `/v2/admissions/settings`
**En une ligne :** fixe les règles de l'école (capacité, doublons, validité d'une offre, numérotation des dossiers), les textes de consentement, les pièces à fournir, les motifs de décision, les classes de priorité et le lien public.
**Compte :** propriétaire `direction.generale@ecole-cocotiers.test` (ou directeur, MFA) · **Avant :** rien. École neuve : le worker a créé les réglages par défaut, le parcours « Parcours d'admission standard » et les motifs usuels ; si l'écran Parcours est vide, cliquer d'abord « Initialiser les modèles » (bloc « Formulaire public », message « Modèles initialisés. »).

**Bloc « Politiques générales »** — règles d'admission de l'école
| Champ (libellé exact) | Valeur à saisir |
| :--- | :--- |
| Capacité | « Stricte : jamais au-delà des places » (valeur par défaut, ne pas changer) |
| Doublons | « Signaler seulement » (par défaut) |
| Promotion de la liste d'attente | « Manuelle » (par défaut) |
| Validité d'une offre (jours) | `10` |
| Délai de paiement des frais (jours) | `15` |
| Conservation des dossiers refusés (mois) | `12` |
| Modèle de numéro de dossier | `ADM-{YEAR}-{SEQ:4}` (à enregistrer **avant** le premier dossier) |
| Activer les listes d'attente | coché |
| Consentement parental obligatoire | coché |
| Délai minimal de saisie (secondes) | `5` |
| Dépôts par connexion et par 10 minutes | `5` |
| Exiger un test anti-robot | décoché (aucun fournisseur branché) |
✅ Cliquer « Enregistrer » : « Paramètres enregistrés. ». Les dossiers auront des numéros `ADM-2026-0001`, `ADM-2026-0002`…
⚠️ Erreurs à essayer : modèle `ABC` → `Le motif de numéro doit contenir {SEQ} (ex. {YEAR}-{SEQ:5}).` ; « Validité d'une offre (jours) » à `0` → « La valeur doit être supérieure ou égale à 1. ».

**Bloc « Textes de consentement parental » → « Publier un nouveau texte »** — texte que les parents acceptent (obligatoire pour sortir du brouillon)
| Champ (libellé exact) | Valeur à saisir |
| :--- | :--- |
| Nature | « Traitement des données » |
| Version | `1.0` |
| Texte | `Je soussigné(e), parent ou tuteur légal, consens au traitement des données personnelles de mon enfant par l'École Primaire Les Cocotiers, pour la seule gestion de sa candidature et de son inscription.` |
| Désigner comme texte en vigueur | coché |
✅ « Texte publié. » ; la ligne « Traitement des données · v1.0 » porte la pastille « Texte en vigueur » et l'alerte « Aucun texte de traitement des données n'est désigné : le formulaire public est fermé. » disparaît.
⚠️ Sans ce texte, la saisie du consentement dans un dossier est refusée (`Version du texte de consentement inconnue ou retirée.`). Une version déjà publiée ne se republie pas : `Cette version du texte existe déjà : publiez une nouvelle version.`

**Bloc « Pièces à fournir » → « Ajouter une pièce »** — documents demandés aux familles (un enregistrement par ligne)
| Code | Libellé | Niveau concerné | Prise en charge concernée | Pièce obligatoire |
| :--- | :--- | :--- | :--- | :--- |
| `ACTE_NAISSANCE` | `Acte de naissance (copie)` | « Tous les niveaux » | « Toutes » | coché |
| `PHOTO_IDENTITE` | `Photo d'identité récente` | « Tous les niveaux » | « Toutes » | coché |
| `BULLETIN_PRECEDENT_CM2` | `Bulletin de l'année précédente (CM1)` | « CM2 » | « Toutes » | coché |
| `BULLETIN_PRECEDENT_CP1` | `Bulletin de fin de Grande Section` | « CP1 » | « Toutes » | décoché (facultative) |
✅ « Pièce enregistrée. » ; chaque ligne s'affiche « Libellé (CODE · niveau) » avec la pastille « Obligatoire » ou « Facultative ». Les pièces obligatoires bloqueront l'étape « Admis » tant qu'elles ne sont pas acceptées dans le dossier. Le code se met en majuscules ; un tiret est refusé (`Code en majuscules, chiffres et « _ » (2 à 40 caractères).`).

**Bloc « Motifs de décision » → « Ajouter un motif »** — motifs proposés lors d'un refus ou d'une mise en liste d'attente (les motifs livrés « Candidature retenue », « Dossier incomplet », « Capacité d'accueil atteinte »… existent déjà)
| Décision | Code | Libellé |
| :--- | :--- | :--- |
| « Refus » | `COCO_NON_JOIGNABLE` | `Famille non joignable après la mise en liste d'attente` |
| « Mise en liste d'attente » | `COCO_EFFECTIF_COMPLET` | `Effectif complet à la rentrée : dossier placé en liste d'attente` |
✅ Chaque motif apparaît « (CODE · nature) ». Un motif ne se supprime pas, il se désactive (« Désactiver » / « Activer »).

**Bloc « Classes de priorité » → « Ajouter une classe de priorité »** — ordre de passage informatif en liste d'attente
| Code | Libellé | Rang |
| :--- | :--- | :--- |
| `FRATRIE` | `Frère ou sœur déjà élève de l'école` | `1` |
| `PERSONNEL` | `Enfant d'un membre du personnel` | `2` |
✅ Lignes « 1. Frère ou sœur déjà élève de l'école (FRATRIE) » et « 2. … (PERSONNEL) ». Rang entre 1 et 1000.
⚠️ **Écart repéré :** aucun écran (saisie d'un dossier ni « Modifier la candidature ») ne permet d'affecter une classe de priorité à un dossier ; la colonne « Priorité » de la liste d'attente reste donc « — ».

**Bloc « Formulaire public » → « Créer le lien public »** — adresse partageable avec les familles
| Action | Résultat |
| :--- | :--- |
| Cliquer « Créer le lien public » | « Lien public créé. », pastille « Lien actif », champs « Lien du formulaire » (`http://localhost:3000/v2/apply/<lien>`) et « Lien de suivi des familles » (`…/track`), bouton « Copier » |
✅ Le `<lien>` (code opaque en minuscules/chiffres) est indispensable plus tard : l'offre d'admission se répond par `http://localhost:3000/v2/apply/<lien>/offer#t=<jeton>`. Ne pas utiliser « Régénérer le lien » (l'ancien lien cesse aussitôt de fonctionner).
⚠️ **Écart repéré :** le formulaire public lui-même ne peut pas être ouvert depuis l'interface (le réglage d'ouverture `publicFormEnabled` n'a aucune commande à l'écran) ; la page `/v2/apply/<lien>` répond « Ce formulaire n'est pas disponible. » même avec lien et texte désigné. La page de réponse à une offre, elle, fonctionne. Le bloc n'apparaît que si la fonction « Formulaire public » est incluse dans l'offre.


### « Parcours d'admission » — `/v2/admissions/settings/workflow`
**En une ligne :** définit les étapes qu'un dossier traverse (dossier reçu, examen, entretien, décision…) et qui peut passer de l'une à l'autre.
**Compte :** propriétaire (ou directeur) · **Avant :** « Paramètres des admissions » (le parcours standard publié existe ; cliquer « Initialiser les modèles » sinon).

**Lecture** — l'écran « Workflow d'admission » liste « Parcours d'admission standard » (`STANDARD`, v1, « Publié », 12 étapes), gelé (« Ce workflow est gelé. Créez une nouvelle version pour le faire évoluer. »).

**Bouton « Nouveau workflow »** — copie du modèle pour l'adapter au primaire
| Champ (libellé exact) | Valeur à saisir |
| :--- | :--- |
| Code | `PARCOURS_PRIMAIRE` |
| Libellé | `Parcours d'admission primaire Cocotiers` |
| De | « Modèle livré » |
✅ « Créer » : brouillon v1, pastille « Brouillon », sans défaut signalé.

**Bloc « Étapes » du brouillon** — renommer deux étapes, ajouter l'entretien, exiger l'entretien avant « Admis » (puis « Enregistrer les étapes » : « Étapes enregistrées. »)
| Étape (code actuel) | Libellé | Statut canonique | Délai cible (heures) | Cases à cocher |
| :--- | :--- | :--- | :--- | :--- |
| `SUBMITTED` | `Dossier reçu` | « Déposée » | `72` | inchangées |
| `UNDER_REVIEW` | `Examen du dossier` | « À l'étude » | vide | inchangées |
| `ACCEPTED` | `Admis` (inchangé) | « Acceptée » | vide | ajouter « Exige l'entretien réalisé » (les cases « Retient une place », « Exige les pièces complètes », « Exige une décision formelle » restent cochées) |
| **nouvelle** via « Ajouter une étape » : Code `INTERVIEW` | `Entretien / test de niveau` | « À l'étude » | `120` | aucune ; Clôture « Aucune » ; Modèle de notification vide |
✅ Cliquer « Monter » sur la nouvelle étape **9 fois** pour la placer juste après « Examen du dossier » (rang 4). Les transitions existantes des étapes conservées sont gardées.

**Bloc « Transitions »** — via « Ajouter une transition » (puis « Enregistrer les transitions » : « Transitions enregistrées. »)
| De | Vers | Permission requise | Motif obligatoire | Automatique |
| :--- | :--- | :--- | :--- | :--- |
| Examen du dossier | Entretien / test de niveau | `admission.update` | décoché | décoché |
| Entretien / test de niveau | Pièces manquantes | `admission.update` | décoché | décoché |
| Entretien / test de niveau | Admis | `admission.decide` | décoché | décoché |
| Entretien / test de niveau | Liste d'attente | `admission.decide` | décoché | décoché |
| Entretien / test de niveau | Refusé | `admission.decide` | coché | décoché |
| Entretien / test de niveau | Retiré par la famille | `admission.decide` | décoché | décoché |
✅ Le bloc « À corriger avant la publication » ne doit plus apparaître. Cliquer « Publier » (acte sensible : un code MFA peut être redemandé) : « Workflow publié. » ; le parcours standard v1 est archivé, le nouveau est « Publié », 13 étapes, gelé.
⚠️ Publier **avant** de créer les campagnes : une campagne se rattache à un parcours publié et n'en change plus. Une étape sans issue ou inatteignable est signalée (`Étape(s) sans issue : …`). Un workflow publié ne se modifie pas (« Nouvelle version »).


### « Campagnes d'admission » — `/v2/admissions/campaigns`
**En une ligne :** regroupe les candidatures d'une rentrée, avec le parcours utilisé, la période d'ouverture et le nombre de places par niveau.
**Compte :** propriétaire (ou directeur) · **Avant :** année 2026-2027 (existante), parcours publié (section précédente).

**Bouton « Nouvelle campagne »** — une campagne par ligne
| Champ (libellé exact) | Campagne 1 | Campagne 2 |
| :--- | :--- | :--- |
| Année scolaire | « Année scolaire 2026-2027 » | « Année scolaire 2026-2027 » |
| Workflow publié | « Parcours d'admission primaire Cocotiers (v1) » | idem |
| Code | `RENTREE-2026-CP1-CM2` | `RENTREE-2026-GS` |
| Libellé | `Rentrée 2026-2027 - CP1 et CM2` | `Rentrée 2026-2027 - Grande Section` |
| Ouverture | `01/10/2026 08:00` | `01/10/2026 08:00` |
| Clôture | `30/11/2026 17:00` | `30/11/2026 17:00` |
✅ « Créer » : chaque campagne s'affiche « Brouillon » avec « Aucune capacité définie. ».

**Bouton « Capacités »** (sur chaque campagne) — places par niveau : « Ajouter un niveau » puis « Ajouter », saisir, « Enregistrer »
| Campagne | Niveau (liste) | Places | Limite de la liste |
| :--- | :--- | :--- | :--- |
| `RENTREE-2026-CP1-CM2` | CP1 | `2` | `5` |
| `RENTREE-2026-CP1-CM2` | CM2 | `2` | `5` |
| `RENTREE-2026-GS` | Grande Section | `1` | `3` |
✅ Le tableau « Capacités de la campagne … » affiche `CP1` 2 places / 2 libres / liste 0 / 5, `CM2` idem, `GS` 1 place / 1 libre / liste 0 / 3. Puis cliquer « Ouvrir » sur chaque campagne : pastille « Ouverte ».
⚠️ « Clôture » avant « Ouverture » : « La clôture doit suivre l'ouverture. » ; code déjà pris : `Ce code de campagne existe déjà dans l'établissement.` Une campagne ne se supprime pas (seulement « Clôturer »). Dans tous les autres écrans, choisir la bonne campagne dans la liste « Campagne d'admission » (elle présélectionne la première ouverte).


### « Prospects » — `/v2/admissions/prospects`
**En une ligne :** garde la trace des premiers contacts avec les familles avant tout dossier, puis les convertit en candidatures.
**Compte :** propriétaire (ou directeur) · **Avant :** campagne GS ouverte.

**Bouton « Nouveau prospect »** — un enregistrement par ligne
| Prénoms | Nom | Téléphone | Adresse e-mail | Niveau visé | Origine | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `Rosalie` | `KOUADIO` | `+225 05 00 00 00 34` | `rosalie.kouadio@exemple.test` | Grande Section | « Recommandation » | `Visite de l'école le 05/10/2026, souhaite une place en Grande Section` |
| `Awa` | `SORO` | `+225 05 00 00 00 35` | `awa.soro@exemple.test` | Grande Section | « Téléphone » | `Appel reçu au secrétariat le 06/10/2026` |
| *(facultatif)* `Judicaël` | `TAPE` | `+225 05 00 00 00 37` | vide | CM2 | « Réseaux sociaux » | `Question sur les horaires` |
✅ « Enregistrer » : les lignes apparaissent avec la pastille « Nouveau ». Le prénom, le nom et au moins un moyen de contact sont obligatoires.

**Bouton « Marquer contacté »** (ligne KOUADIO Rosalie) — la pastille devient « Contacté ».

**Bouton « Convertir »** — crée le dossier de l'enfant avec le prospect comme tuteur principal (le nom de l'enfant est celui du prospect)
| Champ (libellé exact) | KOUADIO Rosalie | SORO Awa |
| :--- | :--- | :--- |
| Campagne d'admission | Rentrée 2026-2027 - Grande Section (RENTREE-2026-GS) | idem |
| Prénoms de l'enfant | `Elie` | `Nina` |
| Date de naissance de l'enfant | `09/02/2021` | `21/05/2021` |
| Niveau visé | Grande Section | Grande Section |
| Lien de parenté du prospect | « Mère » | « Mère » |
✅ L'écran ouvre le dossier créé (étape « Brouillon ») ; la ligne du prospect devient « Converti » avec le lien « Ouvrir le dossier ». Les dossiers n'ont ni sexe ni lieu de naissance : voir « Candidatures », point B.

**Bouton « Perdu »** (facultatif, ligne TAPE Judicaël) : fenêtre « Prospect perdu : Judicaël TAPE », « Motif » `Famille installée à Yamoussoukro` → pastille « Perdu » ; le prospect ne propose plus « Convertir ».
⚠️ Refus attendus : ni téléphone ni e-mail → « Un moyen de contact (téléphone ou e-mail) est obligatoire. » ; même e-mail qu'un prospect actif → `Un prospect actif existe déjà avec cette adresse e-mail.`


### « Candidatures » — `/v2/admissions/applications`
**En une ligne :** liste tous les dossiers de candidature et donne accès à chacun (saisie, consentement, pièces, entretiens, décisions, offres, inscription).
**Compte :** propriétaire (ou directeur ; seule la direction peut décider « Admis », « Liste d'attente », « Refusé ») · **Avant :** paramètres, parcours publié, campagnes ouvertes, prospects convertis.

**A. Bouton « Nouvelle candidature »** (`/v2/admissions/applications/new`) — saisie directe d'un dossier ; choisir d'abord la campagne dans « Campagne d'admission »
| Champ (libellé exact) | AMANI Prisca | DIOMANDE Salif | BROU Maëlle (facultatif) |
| :--- | :--- | :--- | :--- |
| Campagne d'admission | …CP1 et CM2 (RENTREE-2026-CP1-CM2) | …CP1 et CM2 | …Grande Section (RENTREE-2026-GS) |
| Prénoms | `Prisca` | `Salif` | `Maëlle` |
| Nom | `AMANI` | `DIOMANDE` | `BROU` |
| Date de naissance | `17/08/2020` | `04/06/2015` | `30/11/2021` |
| Lieu de naissance | `Cocody` | `Abobo` | `Marcory` |
| Sexe | « Féminin » | « Masculin » | « Féminin » |
| Établissement précédent | `Jardin d'enfants Les Papillons` | `École primaire publique Les Cocotiers (Abobo)` | vide |
| Niveau | CP1 | CM2 | Grande Section |
| Mode de prise en charge | « Famille (privé) » | « Famille (privé) » | « Famille (privé) » |
| Le candidat redouble | décoché | décoché | décoché |
| Tuteur 1 : Lien de parenté | « Père » | « Mère » | « Père » |
| Tuteur 1 : Prénoms / Nom | `Gilbert` / `AMANI` | `Mariétou` / `DIOMANDE` | `Kévin` / `BROU` |
| Tuteur 1 : Téléphone | `+225 05 00 00 00 31` | `+225 05 00 00 00 33` | `+225 05 00 00 00 36` |
| Tuteur 1 : Adresse e-mail | `gilbert.amani@exemple.test` | `marietou.diomande@exemple.test` | vide |
| Tuteur principal / Responsable financier | cochés | cochés | cochés |
| Tuteur 2 (« Ajouter un tuteur ») | « Mère », `Odette` / `AMANI`, `+225 05 00 00 00 32` | aucun | aucun |
✅ « Créer la candidature » : redirection vers le dossier (étape « Brouillon », « Consentement manquant »), sous-titre « Dossier `ADM-2026-000N` · niveau CP1 ».
⚠️ Refus à essayer : date de naissance future → `La date de naissance n'est pas plausible.` ; ni téléphone ni e-mail → « Un moyen de contact (téléphone ou e-mail) est obligatoire pour chaque tuteur. » ; même enfant deux fois dans la campagne → `Une candidature vivante existe déjà pour cet enfant dans cette campagne.` ; « Niveau » ou « Lien de parenté » non choisi → message technique (« Code de niveau invalide. »). Aucun contrôle d'âge par niveau n'existe (un enfant de 40 ans en CP1 serait accepté).

**B. Compléter les dossiers issus des prospects** — dans le dossier, bouton « Modifier la candidature » (seuls les champs modifiés sont envoyés)
| Dossier | Sexe | Lieu de naissance |
| :--- | :--- | :--- |
| KOUADIO Elie | « Masculin » | `Marcory` |
| SORO Nina | « Féminin » | `Treichville` |
✅ « Candidature mise à jour. » ; sans le sexe, l'acceptation de l'offre est plus tard refusée (`Le sexe du candidat est obligatoire pour créer le dossier de l'élève.`).

**C. Consentement parental** — dans « Tuteurs et consentement », « Consigner un consentement » (à faire pour les 5 dossiers, sans lequel « Dossier reçu » est refusé)
| Dossier | Tuteur | Version du texte accepté | Mode de recueil | Référence de la pièce justificative |
| :--- | :--- | :--- | :--- | :--- |
| AMANI Prisca | Gilbert AMANI | `1.0` | « Document papier » | `REG-ADM-2026-001` |
| DIOMANDE Salif | Mariétou DIOMANDE | `1.0` | « Document papier » | `REG-ADM-2026-002` |
| KOUADIO Elie | Rosalie KOUADIO | `1.0` | « Saisi par le personnel » | `APPEL-2026-10-09-01` |
| SORO Nina | Awa SORO | `1.0` | « Saisi par le personnel » | `APPEL-2026-10-09-02` |
| BROU Maëlle | Kévin BROU | `1.0` | « Document papier » | `REG-ADM-2026-003` |
✅ « Enregistrer le consentement » : pastille « Consentement valide » et ligne « Traitement des données · v1.0 · … ». Avant cela, « Dossier reçu » donne `le consentement parental est requis avant l'étape SUBMITTED` (message technique).

**D. Pièces du dossier** — section « Pièces du dossier » : « Déposer » le fichier, puis « Accepter » (stockage de fichiers requis, sinon « service indisponible »)
| Dossier | Pièce | Fichier à choisir | Suite |
| :--- | :--- | :--- | :--- |
| AMANI Prisca | Acte de naissance (copie) | `17-piece-acte-naissance-test-guide.pdf` | « Accepter » |
| AMANI Prisca | Photo d'identité récente | `17-piece-photo-identite-test-guide.png` | « Accepter » |
| DIOMANDE Salif | Acte de naissance (copie) | `17-piece-acte-naissance-test-guide.pdf` | « Accepter » |
| DIOMANDE Salif | Photo d'identité récente | `17-piece-photo-identite-test-guide.png` | « Accepter » |
| DIOMANDE Salif | Bulletin de l'année précédente (CM1) | `17-piece-bulletin-precedent-test-guide.pdf` | « Rejeter » avec « Motif du rejet » `Copie illisible`, puis « Remplacer » par le même fichier et « Accepter » |
| KOUADIO Elie | Acte de naissance (copie) | `17-piece-acte-naissance-test-guide.pdf` | « Accepter » ; **ne pas déposer la photo tout de suite** |
| SORO Nina | Acte + Photo | mêmes fichiers | « Accepter » les deux (sans eux, la promotion sur place libérée échoue) |
✅ Pastilles « Manquante » → « À contrôler » → « Acceptée » (ou « Rejetée » avec `Rejetée : Copie illisible`) ; la bannière « Pièces manquantes : … » disparaît quand tout est accepté. BROU Maëlle : aucune pièce (elle ne sera jamais admise).
⚠️ Fichiers refusés à essayer : `17-piece-vide-test-guide.pdf` → `Le fichier est vide.` ; `17-piece-format-refuse-test-guide.txt` et `17-piece-faux-pdf-test-guide.pdf` → type de fichier refusé.

**E. Avancer les dossiers** — bloc « Étape et décisions » : les boutons portent le nom de l'étape visée
| Dossier | Boutons à cliquer, dans l'ordre |
| :--- | :--- |
| AMANI Prisca, DIOMANDE Salif | « Dossier reçu » → « Examen du dossier » → « Entretien / test de niveau » (après la saisie de l'entretien, point F, pour l'étape « Admis ») |
| KOUADIO Elie | « Dossier reçu » → « Examen du dossier » → « Pièces manquantes » (la photo manque) ; déposer puis « Accepter » la photo (point D) ; → « Examen du dossier » → « Entretien / test de niveau » |
| SORO Nina | « Dossier reçu » → « Examen du dossier » → « Entretien / test de niveau » |
| BROU Maëlle | « Dossier reçu » ici ; « Examen du dossier » et « Entretien / test de niveau » depuis le pipeline (menu « Admissions », bouton « Déplacer ») |
✅ Messages `Dossier passé à l'étape « Dossier reçu ».`, etc. ; la pastille de statut passe à « Déposée » puis « À l'étude ».

**F. Tests et entretiens** — section « Tests et entretiens », « Planifier » puis « Renseigner » (visible parce que la fonction « Tests et entretiens » est incluse)
| Dossier | Nature | Date et heure | Lieu | Déroulement | Note / Barème | Résultat | Observations |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| AMANI Prisca | « Entretien » | `12/10/2026 09:00` | `Bureau de la direction` | « Réalisé » | `15` / `20` | « Admis » | `Enfant à l'aise à l'oral, début de lecture` |
| DIOMANDE Salif | « Test » | `12/10/2026 10:00` | `Salle CM2 A` | « Réalisé » | `13` / `20` | « Admis » | `Test de niveau en français et en mathématiques` |
| KOUADIO Elie | « Entretien » | `12/10/2026 11:00` | `Bureau de la direction` | « Réalisé » | vide | « Admis » | `Autonome, bon langage` |
| SORO Nina | « Entretien » | `13/10/2026 09:00` | `Bureau de la direction` | « Réalisé » | vide | « Admis » | `Rencontre avec la mère` |
✅ Ligne « Planifié » puis, après « Renseigner » + « Enregistrer », « Réalisé », « Note : 15 / 20 », résultat « Admis » (c'est le résultat de l'entretien, pas la décision d'admission). Sans entretien « Réalisé », « Admis » est refusé : `un test ou un entretien terminé est requis avant l'étape ACCEPTED`.
⚠️ « Réalisé » sans « Résultat » → `Un entretien terminé porte son résultat (réussi, échoué, sans objet).` ; « Note » `25` pour « Barème » `20` → `La note exige une échelle et ne la dépasse pas.`

**G. Décisions de la direction** — sur le dossier, clic sur le bouton de l'étape ; la fenêtre porte le nom de la décision
| Ordre | Dossier | Bouton | Motif | Précisions / Conditions |
| :--- | :--- | :--- | :--- | :--- |
| 1 | AMANI Prisca | « Admis » (fenêtre « Acceptation ») | « Candidature retenue » | Conditions : `Remise de l'acte de naissance original à la rentrée` |
| 2 | DIOMANDE Salif | « Admis » | « Candidature retenue » | Conditions : `Remise du bulletin du trimestre en cours` |
| 3 | KOUADIO Elie | « Admis » | « Candidature retenue » | vide (il occupe l'unique place de Grande Section) |
| 4 | BROU Maëlle (**avant Nina**) | « Liste d'attente » (fenêtre « Mise en liste d'attente ») | « Effectif complet à la rentrée : dossier placé en liste d'attente » | vide |
| 5 | SORO Nina | « Liste d'attente » | « Effectif complet à la rentrée : dossier placé en liste d'attente » | vide |
✅ `Décision « Acceptation » enregistrée : dossier à l'étape « Admis ».` ; « Historique » > « Décisions formelles » garde le motif et « Par … » ; Prisca, Salif, Elie passent à « Acceptée », Nina et Maëlle à « Liste d'attente ». Pas de ligne « Refusé » ici : elle viendra plus bas (Maëlle).
⚠️ Refus à essayer : « Admis » sans pièce acceptée → `pièces non acceptées : …` ; « Admis » sur la Grande Section quand la place est prise → `1 places occupées pour 1 (niveau GS)` (la fenêtre affiche « Aucune place n'est disponible à ce niveau : l'acceptation sera refusée sauf dépassement autorisé. ») ; « Refusé » sans motif → « Un refus ou un retrait cite un motif codé. ».

**H. Offres de place** — section « Offres de place », bouton « Émettre une offre » (visible pour un dossier « Admis »)
| Dossier | Classe | Conditions | Validité en jours |
| :--- | :--- | :--- | :--- |
| AMANI Prisca | « À préciser plus tard » (la classe unique `CP1 A` est retenue d'office) ou « CP1 A » | `Remise de l'acte de naissance original` | vide (10 jours par défaut) |
| DIOMANDE Salif | « À préciser plus tard » ou « CM2 A » | `Remise du bulletin du trimestre en cours` | vide |
| KOUADIO Elie | « À préciser plus tard » ou « Grande Section A » | vide | vide |
✅ La fenêtre « Offre émise » affiche « Lien de réponse de la famille » (`http://localhost:3000/v2/apply/<lien>/offer#t=<jeton>`), à copier **tout de suite** (« Ce lien n'est affiché qu'une seule fois : seule son empreinte est conservée. »). Noter LIEN-PRISCA et LIEN-ELIE. Aucun message n'est envoyé aux familles (« La notification est en file d'envoi. » ou « Aucune notification n'a été envoyée : transmettez le lien à la famille. »). L'offre est « En attente de réponse », « Échéance : `<date à 10 jours>` ».
⚠️ « Retirer l'offre » (« Motif du retrait » ≥ 3 caractères) passe l'offre à « Retirée » mais le dossier reste « Admis » et garde sa place malgré le texte « La place est libérée » (écart repéré) : ne pas l'utiliser pour libérer une place.

**I. Réponse des familles** (aucun compte requis ; ouvrir le lien dans une fenêtre de navigation privée)
| Dossier | Action | Saisie |
| :--- | :--- | :--- |
| AMANI Prisca | Ouvrir LIEN-PRISCA : « Proposition de place à École Primaire Les Cocotiers » ; « Accepter la place » puis confirmer « Accepter la place » | page « Place acceptée » |
| KOUADIO Elie | Ouvrir LIEN-ELIE ; « Décliner la place » puis confirmer | page « Place déclinée » |
| DIOMANDE Salif | Dans son dossier, « Accepter au nom de la famille » (fenêtre « Accepter au nom de la famille ») | Tuteur qui accepte : Mariétou DIOMANDE ; Référence de la pièce justificative : `APPEL-2026-10-13-07 (accord téléphonique)` ; bouton « Enregistrer l'acceptation » |
✅ Prisca et Salif : offre « Acceptée », étape « Inscription en attente de paiement ». Elie : offre « Déclinée », dossier « Retiré par la famille », la campagne retrouve 1 place libre en Grande Section. Un lien déjà utilisé affiche « Cette proposition a déjà été acceptée. » (rien n'est recréé).
⚠️ Les erreurs d'acceptation (sexe absent, pièces non acceptées, classe non désignée) s'affichent côté famille « Ce lien n'est pas ou plus valide. » : c'est un écart repéré, pas une expiration.

**J. Conversion en élève (ce que crée l'acceptation de l'offre)** — en une seule opération, pour Prisca puis Salif :
| Élément créé | Contenu attendu |
| :--- | :--- |
| Élève | fiche inactive à la création (`AMANI Prisca`), matricule suivant `00010` puis `00011` (à vérifier), tuteurs créés et liés (Gilbert et Odette AMANI ; Mariétou DIOMANDE) |
| Inscription | dans la classe de l'offre (`CP1 A`, `CM2 A`), financement « Privé » ; numéro attendu `COCO-2026-CP1-0010` et `COCO-2026-CM2-0011` (motif d'école, à vérifier) |
| Facture des frais d'inscription | **aucune** : l'école n'a aucun barème de frais d'inscription ; l'inscription est donc confirmée sans paiement |
✅ Section « Inscription » du dossier : d'abord « Inscription en attente : elle sera confirmée au règlement des frais d'inscription. », puis, quelques secondes plus tard (traitement par le worker, qui doit tourner), « Inscription confirmée le `<date>`. », étape « Inscrit », statut « Inscrit », élève actif. Liens « Dossier de l'élève » et « Fiche d'inscription ». Aucun bouton ne permet de poser « Inscrit » à la main.
⚠️ Si un frais de catégorie Inscription a été créé dans Finance, une facture est émise et l'inscription reste en attente jusqu'au règlement (politique « Après paiement des frais d'inscription ») ; avec la politique « Automatique » (défaut du pack), elle est confirmée tout de suite. Les élèves créés ne figurent pas dans la liste des 9 élèves du jeu commun : ils s'ajoutent aux effectifs de `CP1 A` et `CM2 A`.

**K. Après l'inscription** (dossier de Prisca)
| Section | Action | Saisie |
| :--- | :--- | :--- |
| « Dossier permanent de l'élève » | « Rattacher les pièces acceptées au dossier de l'élève » | Catégorie de la gestion documentaire : la première catégorie d'élève proposée ; case « Je confirme le rattachement de ces pièces au dossier de l'élève. » cochée ; « Rattacher » |
| « Données personnelles » (facultatif, **irréversible**, plus tard : dossier de BROU Maëlle une fois « Refusé ») | « Exporter le dossier » (télécharge `dossier-<numéro>.json`) puis « Anonymiser » | Motif de l'anonymisation : `Demande de la famille (jeu de test)` (≥ 10 caractères) |
✅ « 2 rattachée(s), 0 déjà présente(s) ignorée(s), 0 en échec. » (si aucune catégorie : « Aucune catégorie d'élève ne vous autorise le dépôt. »). Anonymisation : « Ce dossier est anonymisé. », nom remplacé par « Dossier anonymisé » ; refusée pour un dossier inscrit ou admis.

**L. Filtres de la liste** (écran « Candidatures ») : « Statut » = « Liste d'attente », « Recherche » = `BROU`, « Délai dépassé seulement » coché (liste vide), puis « Statut » = « Inscrit » (deux dossiers). Titres des colonnes : « Numéro », « Candidat », « Niveau », « Étape », « Déposée le ». État vide : « Aucune candidature ne correspond à ces filtres. ».


### « Admissions » — `/v2/admissions`
**En une ligne :** tableau en colonnes (une par étape du parcours) où l'on voit où en est chaque dossier et où on peut le déplacer.
**Compte :** propriétaire (ou directeur) · **Avant :** campagnes et dossiers créés.

**Lecture** — « Pipeline des candidatures » : choisir la campagne dans « Campagne d'admission » puis éventuellement un « Niveau » (« Tous les niveaux »).
| Campagne | Colonnes attendues (13) | Cartes attendues en fin de jeu |
| :--- | :--- | :--- |
| Rentrée 2026-2027 - CP1 et CM2 | Brouillon, Dossier reçu, Examen du dossier, Entretien / test de niveau, Pièces manquantes, Liste d'attente, Admis, Inscription en attente de paiement, Inscrit, Refusé, Retiré par la famille, Offre expirée, Dossier en double | « Inscrit » : AMANI Prisca, DIOMANDE Salif |
| Rentrée 2026-2027 - Grande Section | idem | « Retiré par la famille » : KOUADIO Elie ; « Admis » : SORO Nina ; « Refusé » : BROU Maëlle |
✅ Chaque carte porte nom, numéro de dossier, niveau et un bouton « Déplacer ».

**Bouton « Déplacer »** — à utiliser pour BROU Maëlle (point E de « Candidatures »)
| Étape actuelle | Destination à choisir | Bouton de confirmation |
| :--- | :--- | :--- |
| Dossier reçu | Examen du dossier | « Déplacer le dossier » |
| Examen du dossier | Entretien / test de niveau | « Déplacer le dossier » |
✅ `Dossier déplacé vers « Examen du dossier ».` ; fenêtre « Déplacer BROU Maëlle » (« Étape actuelle : … »). Les destinations qui exigent une décision (« Admis », « Liste d'attente », « Refusé »…) affichent « Cette étape exige une décision formelle, enregistrée avec son motif. » et le lien « Ouvrir le dossier pour décider ».


### « Listes d'attente » — `/v2/admissions/waitlist`
**En une ligne :** montre les dossiers en liste d'attente d'un niveau, permet à la direction de les classer et de proposer une place libérée.
**Compte :** propriétaire (ou directeur : seule la direction classe) · **Avant :** SORO Nina et BROU Maëlle en « Liste d'attente » (Maëlle d'abord), KOUADIO Elie ayant décliné son offre (une place libre en Grande Section). Paramètre « Activer les listes d'attente » coché.

**Sélection** — « Campagne d'admission » = `Rentrée 2026-2027 - Grande Section` ; « Choisir un niveau » = Grande Section. Indication « 1 place libre · Limite de la liste : 3 ».
✅ Tableau « Liste d'attente du niveau » (colonnes « Rang », « Candidat », « Priorité », « En attente depuis ») avec BROU Maëlle puis SORO Nina, rang « À classer », et l'avis « Des dossiers n'ont pas encore de rang décidé : ils sont listés après les dossiers classés et ne sont jamais promus d'office. La direction les classe avec les boutons Monter et Descendre. ».

**Classer la liste** (décision de la direction)
| Geste | Saisie |
| :--- | :--- |
| « Monter SORO Nina d'un rang » (bouton « Monter » de la ligne Nina) | ordre provisoire : Nina 1, Maëlle 2 |
| Motif (facultatif) | `Frère aîné de Nina déjà élève de l'école (décision de la direction)` |
| « Enregistrer l'ordre » | |
✅ « L'ordre de la liste d'attente est enregistré. » ; rangs 1 et 2 ; bloc « Derniers changements de rang » avec les lignes « SORO Nina : rang — vers 1 (`<date>`) ». « Annuler les changements » abandonne un déplacement non enregistré.
⚠️ Avec un seul dossier en liste, « Monter » et « Descendre » sont inactifs : le classement n'est possible qu'à partir de deux dossiers (d'où le 5e dossier facultatif). Avant le classement, « Promouvoir le premier de la liste » répond « Aucune promotion : NOT_RANKED » (code brut).

**Promotion de la place libérée**
| Geste | Résultat |
| :--- | :--- |
| « Promouvoir le premier de la liste » | « Une offre a été émise. » avec « Lien de réponse de la famille » (copier, affiché une fois) |
✅ SORO Nina passe à « Admis » (offre « En attente de réponse »), la place libre retombe à 0. À partir de là, « Promouvoir BROU Maëlle » renvoie « Aucune promotion : NO_SEAT ». Nina n'est promue que si ses pièces sont acceptées et son entretien « Réalisé » (sinon l'erreur technique `pièces non acceptées` ou `interview_missing` s'affiche).
**Suite dans « Candidatures »** : ouvrir le dossier de BROU Maëlle (« Liste d'attente »), bouton « Refusé », « Motif » = « Famille non joignable après la mise en liste d'attente », « Précisions » `Trois appels sans réponse` → « Enregistrer : Refus » : dossier « Refusé ». (Facultatif : ouvrir le lien de Nina et « Accepter la place » pour une 3e inscription, en classe `Grande Section A`.)


### « Recrutement : tableaux de bord » — `/v2/admissions/reports`
**En une ligne :** résume une campagne en cinq tableaux : entonnoir par statut, capacités, délais par étape, sources et motifs de refus.
**Compte :** propriétaire (ou directeur) · **Avant :** dossiers traités, de préférence après tout le parcours ci-dessus.

**Lecture** — « Rapports d'admission » ; choisir la campagne dans « Campagne d'admission », puis comparer :
| Campagne | Bloc | Valeurs attendues (à comparer au pipeline) |
| :--- | :--- | :--- |
| Rentrée 2026-2027 - CP1 et CM2 | « Entonnoir » (« Reçues », « Traitées », « Délai moyen (h) », tableau « Statut » / « Dossiers ») | 2 dossiers reçus ; statut « Inscrit » : 2 |
| idem | « Capacités » (« Niveau », « Places », « Libres », « Retenues », « En attente ») | `CP1` 2 places, 1 libre, 1 retenue ; `CM2` 2 places, 1 libre, 1 retenue |
| idem | « Délais par étape » (« Étape », « Délai cible (h) », « Dans l'étape », « En retard », « Durée moyenne (h) ») | « Dossier reçu » cible `72`, « Entretien / test de niveau » cible `120` |
| idem | « Sources » (« Origine », « Reçues », « Inscrits ») | une ligne `WALK_IN` (code brut) : 2 reçues, 2 inscrits |
| Rentrée 2026-2027 - Grande Section | « Capacités » | `GS` 1 place, 0 libre, 1 retenue (Nina), 0 en attente (Maëlle refusée) |
| idem | « Motifs de refus » (« Motif », « Dossiers ») | « Famille non joignable après la mise en liste d'attente » : 1 ; « Candidature retirée par la famille » : 1 |
| idem | « Sources » | `REFERRAL` (Elie), `PHONE` (Nina), `WALK_IN` (Maëlle) (codes bruts) |
✅ Les tableaux sont cohérents avec le pipeline ; une campagne sans dossier affiche des tableaux vides sans erreur. Écart connu : « Reçues » exclut les brouillons alors que « Sources » les compte.


### Formulaire public d'inscription — `/v2/apply/<lien>`
**En une ligne :** page publique (sans compte) où une famille dépose un dossier ; suivi par code sur `/v2/apply/<lien>/track` ; réponse à une offre sur `/v2/apply/<lien>/offer#t=<jeton>`.
**Compte :** aucun (page publique) · **Avant :** lien public créé dans « Paramètres des admissions » (point « Formulaire public »).

| Adresse | Données à saisir | Résultat |
| :--- | :--- | :--- |
| `http://localhost:3000/v2/apply/<lien>` | aucune | ⚠️ « Ce formulaire n'est pas disponible. » : l'ouverture du formulaire n'est posable depuis aucun écran (écart repéré) |
| `http://localhost:3000/v2/apply/<lien>/track` | « Code de suivi » `ABCDEFGH1234` | « Aucun dossier ne correspond à ce code. » (les dossiers saisis par le personnel n'ont pas de code de suivi) |
| `http://localhost:3000/v2/apply/<lien>/offer#t=<jeton>` | lien copié à l'émission d'une offre | voir « Candidatures », point I : « Place acceptée » ou « Place déclinée » |
Si le formulaire est ouvert par l'équipe technique, données de dépôt : enfant `Famille` / `TESTPUBLIC`, `18/04/2021`, Grande Section, parent « Mère », `Test` / `TESTPUBLIC`, `+225 05 00 00 00 38`, case « J'ai lu le texte ci-dessus et j'y consens en tant que parent ou tuteur légal. » cochée, attente de plus de 5 secondes, puis « Envoyer ma candidature » → page « Candidature reçue » avec « Votre code de suivi ».


---

## Partie 11 — Communication, notifications, documents

**Avant de commencer.** Le worker doit tourner (publication des annonces programmées, remise des notifications toutes les ~15 s, lecture du texte des PDF toutes les minutes). Tous les menus de ces trois groupes sont visibles du propriétaire dans le pack Primaire : aucun n'est masqué par une `feature` (les manifestes `messaging`, `notifications` et `documents` n'en déclarent aucune sur leurs menus). Compte utilisé partout : propriétaire `direction.generale@ecole-cocotiers.test` (MFA), sauf mention du directeur `directeur@ecole-cocotiers.test`.

**Limite structurante de l'école neuve.** Aucun tuteur, enseignant ni élève n'a de compte de connexion (seuls le propriétaire et le directeur existent). Or la messagerie, les annonces et les notifications « Application » ne s'adressent qu'à des **comptes** : une conversation « direction vers un tuteur » ou « titulaire vers parents » ne peut pas être créée depuis l'interface tant que ces comptes n'existent pas. Les données prévues sont données quand même, et l'équivalent réalisable avec les deux comptes existants (propriétaire et directeur) est indiqué à chaque fois. Les tuteurs n'ont qu'un téléphone (aucun e-mail) : leurs envois par e-mail sont « Non envoyé : aucune coordonnée ».

**Aucun message réel ne part.** En développement (`pnpm dev:v2`), l'API est lancée avec `NOTIFICATIONS_SIMULATE=1` et le SMS Orange en `sandbox` : les remises e-mail, SMS, WhatsApp et push sont consignées « Simulé » (jamais envoyées). Seule la notification « Application » est réellement remise (cloche du destinataire).


### « Paramètres de la messagerie » — `/v2/messages/settings`
**En une ligne :** Fixe les règles d'usage de la messagerie de l'école : élèves, contacts de l'administration, pièces jointes, plafonds d'envoi et textes des messages automatiques d'absence.
**Compte :** propriétaire (ou directeur) · **Avant :** rien

**Formulaire « Paramètres de la messagerie »** — politique élèves, pièces jointes, plafonds
| Champ (libellé exact) | Valeur à saisir |
| :--- | :--- |
| Messagerie des élèves | « Désactivée : les élèves n'écrivent pas » (élèves de 4 à 11 ans) |
| Rôles des contacts de l'administration | `directeur, secretariat, owner` (clés de rôle séparées par des virgules ; `owner` permet au directeur d'écrire à la direction générale) |
| Autoriser les pièces jointes | coché |
| Taille maximale (Mo) | `3` |
| Cases PDF / JPEG / PNG / WebP | PDF, JPEG, PNG cochés ; WebP décoché |
| Messages par heure et par utilisateur | `60` |
| Nouvelles conversations par jour et par utilisateur | `20` |
| Participants d'un message de groupe | `50` |
| Destinataires d'une diffusion ou d'une annonce | `500` |
| Longueur maximale d'un message (caractères) | `2000` |
| Pièces jointes par message | `3` |
| Conservation des notifications lues (jours) | `60` |
| Parents : écrire aux enseignants de l'année précédente pendant (jours, 0 = fermé) | `30` |

Cliquer « Enregistrer les paramètres ».
✅ « Paramètres enregistrés. » ; après rechargement les valeurs sont conservées.
⚠️ Refus attendus : Taille maximale `100` ou `abc` → « La taille maximale doit être comprise entre 0,001 et 25 Mo. » ; Participants d'un groupe `600` avec Destinataires d'une diffusion `500` → « Le plafond d'un groupe ne peut pas dépasser celui d'une diffusion. ».

**Zone « Messages automatiques »** — texte du message d'absence envoyé aux familles
| Carte / champ (libellé exact) | Valeur à saisir |
| :--- | :--- |
| Carte « Absence d'un élève » : Envoyer ce message automatiquement | coché |
| Titre | `Absence de {{studentName}} à l'école` |
| Texte | `{{studentName}} était absent(e) le {{date}}. Merci d'en indiquer le motif au secrétariat de l'École Primaire Les Cocotiers.` |
| Carte « Retard d'un élève » : Envoyer ce message automatiquement | laisser décoché (désactivé par défaut) |

Cliquer « Enregistrer ce message » sur la carte « Absence d'un élève ».
✅ « Message enregistré. » et pastille « Personnalisé ». Variables acceptées : `{{studentName}} {{date}}` (aide sous « Texte »).
⚠️ Le message d'absence n'est déposé que dans la boîte d'un tuteur **ayant un compte** : sans compte parent, il n'apparaît nulle part.


### « Messages » — `/v2/messages`
**En une ligne :** Boîte de messagerie interne (conversations directes, de groupe ou diffusion) avec dossiers, favoris, archives, signalement et recherche.
**Compte :** propriétaire (puis directeur pour répondre et signaler) · **Avant :** « Paramètres de la messagerie » ; classes **activées** (pour la diffusion)

**Bouton « Nouveau message »** (`/v2/messages/new`) — les deux conversations du jeu de données
| Champ (libellé exact) | Conversation 1 : direction vers l'administration (réalisable) | Conversation 2 : diffusion à la classe CP1 A (refus attendu) |
| :--- | :--- | :--- |
| Type de message | « Message de groupe » | « Diffusion » |
| Destinataires | cocher « Écrire aussi à l'administration » (ajoute le directeur) | bloc « Classes » : « Choisir une classe » = `CP1 A`, cocher « Parents et tuteurs » seulement, « Ajouter la classe » |
| Objet | `Préparation de la réunion de rentrée du samedi 17 octobre 2026` | `Réunion de classe du CP1 A` |
| Priorité | « Normale » | « Élevée » |
| Message | `Bonjour, merci de vérifier la salle polyvalente et la liste des parents attendus pour la réunion de rentrée du samedi 17 octobre 2026 à 18h00. (test)` | `Chers parents du CP1 A, la réunion de classe aura lieu le jeudi 22 octobre 2026 à 17h30. KOFFI Adjoua, titulaire. (test)` |
| Autoriser les réponses des participants | coché | sans objet |
| Joindre un fichier | `docs/guide-test/jeux-de-donnees/ch15-piece-jointe-test-guide.pdf` (673 octets) | aucun |

Cliquer « Envoyer ».
✅ Conv. 1 : la page de la conversation s'ouvre (`/v2/messages/<id>`), bulle « Vous » à droite, badge « Groupe de 2 » dans « Envoyés ». Se connecter ensuite en directeur : la conversation est en gras dans « Boîte de réception » ; répondre dans « Votre réponse » : `Bien reçu, la salle est réservée. (test)` puis « Envoyer ».
⚠️ Conv. 2 : refusée avec « Aucun destinataire joignable pour cette sélection. » (aucun tuteur de CP1 A n'a de compte). Elle ne passera qu'après l'invitation d'un compte tuteur (fiche tuteur) ; elle serait alors envoyée par KOFFI Adjoua, titulaire, dont le compte est également à créer.
⚠️ Variante « direction vers un tuteur » (impossible aujourd'hui, donnée prête) : Type « Message direct », Rechercher une personne `ADOU` puis choisir ADOU Roland, À propos de l'enfant `ADOU Aïcha`, Objet `Bienvenue à l'École Primaire Les Cocotiers`, Message `Bonjour M. ADOU, bienvenue ! Aïcha est inscrite en Grande Section A. (test)`. Tant qu'il est « Sans compte », la recherche répond « Aucune personne autorisée ne correspond à cette recherche. ». La recherche ne propose que des personnes liées à un compte de portail : ni le directeur ni le propriétaire ne sont proposés (le directeur n'est joignable que par « Écrire aussi à l'administration »).
⚠️ Refus de saisie : « Choisissez au moins un destinataire. » (rien de coché) ; « Un message de groupe ou de diffusion a un objet. » (Objet vide) ; « Ce champ est obligatoire. » (Message vide).

**Barre de la messagerie (onglets « Messages », « Annonces », « Notifications », « Modération », « Paramètres »)** — relire les dossiers
| Dossier / filtre | Valeur à saisir | Résultat |
| :--- | :--- | :--- |
| « Envoyés » | (ouvrir) | la conversation 1 avec « Groupe de 2 » |
| Recherche « Objet et personnes » | `réunion` | la conversation 1 |
| Recherche « Texte des messages » | `salle polyvalente` (2 caractères au moins) | extrait du message |
| Dans la conversation, « Favori » puis « Archiver » | (cliquer) | visible dans « Favoris » puis « Archivés » ; « Désarchiver » la remet dans la boîte |

**Onglet « Notifications »** (`/v2/messages/notifications`) — cloche et préférences de messagerie
| Champ (libellé exact) | Valeur à saisir |
| :--- | :--- |
| Annonces : Notifications dans l'application | coché |
| Annonces : E-mail | coché |
| Messages : Notification sur le téléphone | décoché |
| Ne pas me notifier avant le | (vide) |

Cliquer « Enregistrer mes préférences ».
✅ « Vos préférences sont enregistrées. » ; la cloche affiche le nombre de notifications non lues (réponse du directeur) et « Tout marquer comme lu » le ramène à zéro.


### « Annonces » — `/v2/announcements`
**En une ligne :** Publie des informations officielles ciblées (école, classe, rôle) avec accusé de réception, programmation, expiration et suivi des lectures.
**Compte :** propriétaire (puis directeur pour l'accusé) · **Avant :** classes activées ; rôle `directeur` existant

**Bouton « Nouvelle annonce »** (`/v2/announcements/new`) — les trois annonces du jeu de données
| Champ (libellé exact) | Annonce 1 : réunion de rentrée | Annonce 2 : sortie pédagogique CM2 A | Annonce 3 : congés de la Toussaint |
| :--- | :--- | :--- | :--- |
| Titre | `Réunion de rentrée des parents d'élèves : samedi 17 octobre 2026 à 18h00` | `Sortie pédagogique du CM2 A : jeudi 22 octobre 2026` | `Congés de la Toussaint : du 31 octobre au 8 novembre 2026` |
| Contenu | `Tous les parents sont invités à la réunion de rentrée, le samedi 17 octobre 2026 à 18h00, dans la salle polyvalente de l'École Primaire Les Cocotiers. Merci de confirmer votre présence.` | `Les élèves du CM2 A visitent le jardin botanique de Bingerville le jeudi 22 octobre 2026 (départ 8h00, retour 15h30). Prévoir une tenue de sport, une gourde et un pique-nique. Autorisation écrite à rendre avant le 20 octobre.` | `L'école sera fermée du samedi 31 octobre au dimanche 8 novembre 2026. Reprise des cours le lundi 9 novembre 2026 à 7h30.` |
| Type de cible | « Tout l'établissement » puis « Ajouter la cible » ; puis « Rôle » = `directeur` et « Ajouter la cible » | « Classe » = `CM2 A` puis « Ajouter la cible » ; puis « Rôle » = `directeur` et « Ajouter la cible » | « Tout l'établissement » puis « Ajouter la cible » |
| Personnes visées | « Parents et tuteurs » et « Personnel » (décocher « Élèves ») | « Élèves » et « Parents et tuteurs » | « Élèves », « Parents et tuteurs » et « Personnel » |
| Priorité | « Élevée » | « Normale » | « Normale » |
| Publier le | (vide : publication immédiate) | `12/10/2026 08:00` | (vide) |
| Expire le | `17/10/2026 23:59` | `22/10/2026 18:00` | `09/11/2026 07:30` |
| Demander un accusé de réception | coché | coché | décoché |
| Épingler en tête de liste | coché | décoché | décoché |
| Action finale | « Compter les destinataires » puis « Publier » | « Compter les destinataires » puis « Programmer la publication » (le bouton change quand « Publier le » est dans le futur) | « Enregistrer le brouillon » (ne pas publier) |

✅ Annonce 1 : « 1 destinataire(s) » au comptage ; la fiche s'ouvre avec le statut « Publiée » et « L'annonce est publiée. » ; bloc « Gestion de l'annonce » : Destinataires 1, Lus 0, Accusés 0. Annonce 2 : statut « Programmée » (elle passe à « Publiée » le 12/10/2026 à 08:00 si le worker tourne). Annonce 3 : statut « Brouillon », boutons « Modifier », « Publier maintenant » et « Supprimer le brouillon ».
✅ Accusé : se connecter en directeur, « Annonces », ouvrir l'annonce 1 (badge « Accusé à donner »), cliquer « J'ai pris connaissance » : « Merci : votre accusé de réception est enregistré. » (irréversible). Revenir en propriétaire : « Accusés » = 1 ; filtre « Afficher » = « Accusés » liste le directeur (colonnes « Personne », « Reçue le », « Lue le », « Accusé le »).
⚠️ Piège : une annonce est refusée à la publication si personne ne peut la recevoir (« Aucun destinataire joignable pour ce ciblage. »). L'école étant vide de comptes, « Tout l'établissement » ou « Classe » seuls ne suffisent pas : d'où la cible supplémentaire « Rôle » = `directeur` (le seul compte joignable). Sans elle, seule l'annonce 3 (brouillon) est enregistrable. Quand les comptes tuteurs existeront, retirer cette cible des nouvelles annonces.
⚠️ Les cibles de type classe ou rôle s'affichent sur la fiche par un identifiant partiel (« Classe (01a110ee…) ») et l'auteur par son identifiant de connexion (`direction.generale`) : écart connu, pas une erreur de saisie.
⚠️ Refus de saisie : « Ce champ est obligatoire. » (Titre ou Contenu vide) ; « Choisissez au moins une cible. » ; « Choisissez au moins une audience. » ; « L'expiration doit suivre la publication. » (Expire le avant Publier le). Annonce publiée : le contenu ne change plus (« Une annonce publiée ne change plus de contenu : seuls l'expiration et l'épinglage sont modifiables. Retirez-la et publiez-en une nouvelle. ») ; retrait : « Retirer l'annonce », motif `Annonce publiée par erreur (test)` (3 caractères au moins).
✅ Journal : l'annonce 1 est de priorité « Élevée » : la règle livrée « Annonce importante : relayer par e-mail et push » crée, dans « Journal des notifications », deux lignes (E-mail et Notification push) pour le directeur, à l'état « Simulé » (voir ce menu).


### « Modération des messages » — `/v2/messages/moderation`
**En une ligne :** Traite les messages signalés par les participants, gère les restrictions d'envoi et permet la lecture motivée et tracée de n'importe quelle conversation.
**Compte :** propriétaire (code MFA demandé : « Confirmez votre identité ») · **Avant :** la conversation 1 de « Messages »

**Signalement par le directeur** (compte directeur, conversation de « Messages » de la propriétaire)
| Champ (libellé exact) | Valeur à saisir |
| :--- | :--- |
| Message à modérer (nouveau groupe créé par le propriétaire, objet `Message à signaler (test de modération)`) | `Ceci est un faux message abusif, écrit uniquement pour tester la modération. (test)` |
| Bouton « Signaler » sous ce message | cliquer |
| Motif | « Harcèlement ou propos injurieux » |
| Précisions | `Signalement de contrôle, aucun fait réel. (test)` |

Cliquer « Signaler ».
✅ « Merci : votre signalement a été transmis à la modération. ». Un message ne peut pas être signalé par son propre auteur : le message est donc écrit par le propriétaire et signalé par le directeur.

**Onglet « Signalements »** (propriétaire)
| Champ (libellé exact) | Valeur à saisir |
| :--- | :--- |
| Signalements à traiter seulement | coché |
| Ligne « À traiter » : bouton « Examiner » | cliquer (fenêtre « Examen d'un signalement », lecture tracée) |
| Décision | « Rejeter le signalement » puis, pour un second signalement, « Sanctionner » |
| Retirer le message | coché (Sanctionner) |
| Restreindre l'envoi de l'auteur | **décoché** : l'auteur serait le propriétaire lui-même |
| Motif de la décision | `Message de test retiré par la direction` (3 caractères au moins) |

Cliquer « Confirmer la décision ».
✅ « Décision enregistrée. » ; le signalement passe à « Sanctionné » (ou « Rejeté ») ; dans le fil, le message devient « Message retiré par la modération ». Refus : motif vide → « Le motif de la décision est obligatoire (3 caractères au moins). » ; Sanctionner sans rien cocher → « Précisez l'action : retirer le message et/ou restreindre l'auteur. ».
⚠️ Ne pas cocher « Restreindre l'envoi de l'auteur » : l'auteur du message signalé est le propriétaire, et la décision le bloquerait lui-même (« Votre envoi de messages est temporairement restreint par l'établissement. »). L'onglet « Restrictions » reste donc vide (« Aucune restriction en cours. ») ; il ne se testera qu'avec un message d'un futur compte parent ou enseignant, avec la durée « 1 jour » puis « Lever la restriction ».

**Onglet « Supervision »**
| Champ (libellé exact) | Valeur à saisir |
| :--- | :--- |
| Rechercher par objet ou par personne | `Préparation` |
| Bouton « Lire avec un motif » puis Motif de la consultation | `Contrôle de la procédure de modération (test)` (3 caractères au moins) |

Cliquer « Lire la conversation ».
✅ Contenu en lecture seule (« Lecture seule : les messages retirés restent visibles pour la supervision. ») et une entrée de lecture dans le journal d'audit ; motif de 1 ou 2 caractères → « Le motif doit comporter au moins 3 caractères. ».


### « Canaux d'envoi » — `/v2/notifications/channels`
**En une ligne :** Montre l'état de chaque canal (Application, E-mail, SMS, WhatsApp, push), permet d'envoyer un essai et fixe plafonds, heures calmes, consentement et nouvelles tentatives.
**Compte :** propriétaire · **Avant :** rien

**Bloc « État des canaux »** (lecture)
✅ Une carte par canal. « Application » : « Opérationnel ». En développement un bandeau « Mode simulation actif : aucun message n'est réellement envoyé. Ce mode est réservé au développement. » s'affiche ; E-mail, WhatsApp et Notification push sont « Non configuré » ou « Opérationnel » selon le mode simulation (aucun fournisseur réel branché) ; le SMS Orange est en `sandbox`.
**Bouton « Envoyer un essai »** sur la carte « Application » (le message d'essai part au propriétaire) puis, si le bouton est actif, sur les cartes simulées.
✅ « Essai en file : 1 message(s), 0 ignoré(s). Consultez le journal des envois. » ; ligne d'origine « Essai » dans le journal, « Application » remise, les autres « Simulé ».

**Formulaire « Réglages de l'établissement »**
| Champ (libellé exact) | Valeur à saisir |
| :--- | :--- |
| Canaux activés | cocher « Application », « E-mail », « SMS », « WhatsApp » ; décocher « Notification push » (pas de clés VAPID) |
| Nom de l'expéditeur | `École Primaire Les Cocotiers` |
| Adresse de réponse | `secretariat@ecole-cocotiers.test` |
| Fuseau horaire | `Africa/Abidjan` |
| Indicatif téléphonique par défaut | `225` |
| Heures calmes : Ne pas envoyer de SMS, WhatsApp ni notification push la nuit | coché ; « Début » `20:00` ; « Fin » `06:00` |
| Plafond Application | (vide) |
| Plafond E-mail | `300` |
| Plafond SMS | `200` |
| Plafond WhatsApp | `200` |
| Plafond Notification push | (vide) |
| Messages par destinataire et par jour | `5` |
| Consentement Application / E-mail / SMS | « Implicite » |
| Consentement WhatsApp | « Sur accord » |
| Les messages urgents peuvent être envoyés même après un retrait de consentement | coché |
| Tentatives d'envoi | `3` |
| Conservation du journal (jours) | `180` |
| Mention légale des e-mails | `École Primaire Les Cocotiers, Cocody, Abidjan. Message de démonstration.` |

Cliquer « Enregistrer les réglages ».
✅ « Réglages enregistrés. ».
⚠️ Refus : indicatif `22a5` → « L'indicatif doit comporter de 1 à 4 chiffres. » ; heure vide → « Les heures doivent être au format HH:MM. » ; adresse `pas-un-mail` → « L'adresse de réponse n'est pas valide. » ; plafond `-5` → « Un plafond doit être un nombre entier positif. » ; messages par destinataire `0` → « Le plafond par destinataire doit être compris entre 1 et 500. » ; tentatives `11` → « Le nombre de tentatives doit être compris entre 1 et 10. » ; conservation `3` → « La conservation doit être comprise entre 7 et 3650 jours. ».


### « Gabarits de notification » — `/v2/notifications/templates`
**En une ligne :** Définit le texte de chaque message automatique par canal (e-mail, SMS, application…), avec variables, aperçu et versions successives.
**Compte :** propriétaire · **Avant :** « Canaux d'envoi » (pour savoir quels canaux sont utilisables)

**Liste « Message » + onglets de canal (E-mail, SMS) + « Publier une nouvelle version »** — quatre gabarits
| Message (liste) | Canal | Objet | Texte du message | Note de version |
| :--- | :--- | :--- | :--- | :--- |
| « Absence d'un élève » (variables `{{studentName}}*` `{{date}}*`) | E-mail | `Absence de {{studentName}} à l'école` | `Bonjour, {{studentName}} était absent(e) le {{date}}. Merci de nous en indiquer le motif. Cordialement, {{schoolName}}` | `Version Cocotiers` |
| « Absence d'un élève » | SMS | (aucun champ Objet) | `{{schoolName}} : {{studentName}} était absent(e) le {{date}}. Merci d'en informer l'école.` | `Version Cocotiers SMS` |
| « Facture émise » (`{{studentName}}*` `{{invoiceNumber}}*` `{{amount}}*` `{{dueDate}}*`) | SMS | (aucun) | `{{schoolName}} : facture {{invoiceNumber}} de {{amount}} pour {{studentName}}, à régler avant le {{dueDate}}.` | `Version Cocotiers SMS` |
| « Annonce » (`{{title}}*` `{{summary}}`) | E-mail | `{{title}}` | `Bonjour, {{title}}. {{summary}} Cordialement, {{schoolName}}` | `Version Cocotiers` |
| « Bulletin publié » (`{{studentName}}*`) | E-mail | `Bulletin de {{studentName}} disponible` | `Bonjour, le bulletin de {{studentName}} est disponible dans votre espace : {{appUrl}}. Cordialement, {{schoolName}}` | `Version Cocotiers` |

Pour chaque ligne : sélectionner le « Message », l'onglet du canal, saisir, cliquer « Aperçu » (cadre « Aperçu avec des valeurs d'exemple » ; pour le SMS « Estimation : n segment(s) SMS. »), puis « Publier une nouvelle version ».
✅ « Version 1 publiée et activée. » (badge « Version 1 de l'établissement », section « Versions » : « Active »). `{{schoolName}}` et `{{appUrl}}` sont fournies par la plateforme (non listées parmi les boutons de variables). « Désactiver ce gabarit » → « Gabarit désactivé. » puis « Activer ce gabarit » ; « Revenir au gabarit livré » → « Gabarit livré rétabli. ».
⚠️ Refus : « Le texte du message est obligatoire. » ; « L'objet est obligatoire pour ce canal. » (e-mail sans Objet) ; variable inconnue `{{zzz}}` → « La variable « zzz » n'existe pas pour ce gabarit. » ; accolade non fermée `{{date` → « Gabarit (corps) : Balise mal formée… ». Chaque publication crée une version immuable.
⚠️ « Annonce de réunion » = le gabarit « Annonce » ; « Bulletin disponible » = le gabarit « Bulletin publié » (le catalogue n'a pas d'autres noms).


### « Règles et alertes » — `/v2/notifications/rules`
**En une ligne :** Décide qui est prévenu, par quel canal et avec quel gabarit pour chaque événement, relance d'impayés et alerte, avec leurs seuils.
**Compte :** propriétaire · **Avant :** « Gabarits de notification »

**Bouton « Modifier » d'une règle livrée** (fenêtre « Modifier la règle ») — règles à régler
| Règle (liste) | Règle active | Gabarit du message | Qui est prévenu | Canaux | Stratégie d'envoi | Seuils |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| « Absence d'un élève : prévenir les parents » | coché | « Absence d'un élève » | « Parents et tuteurs de l'élève », « Responsables financiers d'abord » coché, « Prévenir l'élève si aucun tuteur n'est joignable » décoché | SMS seulement (décocher « Notification push », « WhatsApp », « E-mail ») | « Premier canal joignable » | (aucun) |
| « Seuil d'absences atteint : alerter les parents » | coché | « Seuil d'absences atteint » | « Parents et tuteurs de l'élève » | SMS | « Premier canal joignable » | Valeur minimale de l'indicateur `3` |
| « Facture émise : prévenir la famille » | coché | « Facture émise » | « Parents et tuteurs de l'élève », « Responsables financiers d'abord » coché | « Application », « SMS » (décocher « E-mail » et « Notification push ») | « Tous les canaux choisis » | (aucun) |
| « Bulletin publié : prévenir les parents » | coché | « Bulletin publié » | « Parents et tuteurs de l'élève » | « Application », « SMS » | « Tous les canaux choisis » | (aucun) |
| « Relances d'impayés (J+7, J+21, J+45) » | coché | « Relance d'impayé » | (inchangé) | « SMS », « WhatsApp » | « Premier canal joignable » | Paliers de relance (jours de retard) `10, 30, 60` |

Cliquer « Enregistrer la règle » à chaque ligne.
✅ « Règle enregistrée. » ; badge « Modifiée » ; la règle d'absence affiche « Canaux : SMS (Premier canal joignable) ». « Rétablir la règle livrée » → « Règle livrée rétablie. ».
⚠️ La demande « envoyer un SMS au tuteur principal à la première absence » correspond à la 1re ligne : la règle d'absence se déclenche à **chaque** absence enregistrée. L'écran n'offre pas de cible « contact principal » : « Responsables financiers d'abord » est le seul filtre (à défaut de responsable financier lié, tous les tuteurs sont prévenus). L'écran ne permet pas de créer une règle : on modifie les règles livrées.
⚠️ Refus : Paliers `20, 10` → « Les paliers doivent être strictement croissants. » ; `abc` ou sept paliers → « Indiquez un à six paliers, en nombres entiers de jours. » ; aucun canal → « Choisissez au moins un canal. ».
⚠️ L'envoi réel de ces règles exige des **tuteurs liés à un élève** (créés) et une absence saisie au menu des appels ; les tuteurs n'ont qu'un téléphone, donc seul le SMS aboutit (« Simulé »).


### « Journal des notifications » — `/v2/notifications`
**En une ligne :** Liste chaque envoi (application, e-mail, SMS, WhatsApp, push) avec statut, canal, gabarit et origine, sans conserver le contenu des messages.
**Compte :** propriétaire · **Avant :** une annonce « Élevée » publiée ou un envoi manuel (ci-dessous)

**Onglet « Envoyer »** (`/v2/notifications/send`, titre « Envoyer un message ») — trois envois manuels
| Champ (libellé exact) | Envoi 1 : convocation | Envoi 2 : annonce de réunion | Envoi 3 : avis urgent |
| :--- | :--- | :--- | :--- |
| Type de message | « Convocation » | « Annonce » | « Avis urgent » |
| Choisir par | « Élèves (leurs parents et tuteurs) » | « Classes » | « Rôles du personnel » |
| Destinataires | Ajouter un élève = `KOUASSI Aya` (puce sous « Élèves choisis ») ; « Responsables financiers d'abord » décoché | Ajouter une classe = `CM2 A` ; cocher « Parents et tuteurs » seulement | Rôles = `directeur` |
| Canaux | « SMS » | « SMS » | « Application » |
| Stratégie d'envoi | « Tous les canaux choisis » | « Tous les canaux choisis » | « Tous les canaux choisis » |
| Contenu | Objet de la convocation `Entretien avec la direction` ; Date `20/10/2026` ; Heure `08:30` ; Lieu `Bureau du directeur` ; Précision `Merci de vous munir du carnet de correspondance.` ; Élève concerné (vide) | Titre de l'annonce `Réunion de rentrée des parents le samedi 17 octobre 2026 à 18h00` ; Résumé `Salle polyvalente, présence souhaitée.` | Objet `Exercice d'évacuation (test)` ; Message `Exercice fictif : ne pas tenir compte de cet avis. (test)` |
| Message urgent (visible propriétaire et directeur seulement) | décoché | décoché | coché |
| Bouton | « Vérifier avant l'envoi » puis « Envoyer maintenant » | idem | idem |

✅ « Message mis en file : n destinataire(s), n envoi(s), n ignoré(s). » (fenêtre « Confirmer l'envoi » avant). Envoi 1 : 1 destinataire (KOUASSI Hervé, téléphone `+225 07 00 00 00 14`) ; envoi 3 : le directeur reçoit l'alerte dans sa cloche (réelle).
⚠️ Les cases « E-mail » et « WhatsApp » peuvent être grisées « indisponible » (canal non configuré) : n'envoyer que par les canaux cochables. L'envoi 2 compte les tuteurs de CM2 A **avec téléphone** : N'GUESSAN Berthe, COULIBALY Awa, TANOH Léon. Refus : « Choisissez au moins un canal. » ; « Choisissez au moins un élève. » ; « Choisissez au moins une classe. » ; « Renseignez « Date ». ».

**Page « Journal des envois »** (lecture et filtres)
| Champ (libellé exact) | Valeur à saisir |
| :--- | :--- |
| Période des statistiques | « 1 j » puis « 7 j » puis « 30 j » |
| Canal | « SMS » puis « E-mail » |
| Statut | « Simulé » |
| Catégorie | « Annonces » |
| Du / Au | `09/10/2026` / `09/10/2026` |

✅ Lignes attendues : annonce 1 (origine « Événement », gabarit `announcement (version 0)`) : E-mail « Simulé » et Notification push « Non envoyé : aucun appareil abonné. » (ou « Simulé ») pour le directeur ; convocation : SMS « Simulé », origine « Envoi manuel », gabarit `convocation (version 0)` ; avis urgent : badge « Urgent », « Application » remise. Les adresses et numéros sont masqués, aucun contenu n'est conservé. Un e-mail vers un tuteur sans adresse donne « Non envoyé : aucune coordonnée. ». « Voir plus » charge la suite.
⚠️ Sans aucun envoi : « Aucun envoi pour le moment » ; filtres sans résultat : « Aucun envoi ne correspond ». Aucun statut « Envoyé » ne doit apparaître : aucun fournisseur réel n'est branché.


### « Mes notifications » — `/v2/account/notifications`
**En une ligne :** Chaque utilisateur règle les canaux et catégories par lesquels l'école peut le prévenir, ses heures calmes et ses appareils push.
**Compte :** propriétaire · **Avant :** « Canaux d'envoi »

**Blocs « Canaux et catégories » et « Heures calmes »**
| Champ (libellé exact) | Valeur à saisir |
| :--- | :--- |
| Recevoir des messages par E-mail | coché (« Activé ») |
| Recevoir des messages par SMS | coché ; catégories cochées : Présences, Finances, Annonces, Urgences |
| Recevoir des messages par WhatsApp | décoché (« Désactivé ») |
| Utiliser les heures calmes de l'établissement | décoché |
| Activer mes heures calmes | coché ; « Début » `21:00` ; « Fin » `06:00` |

Cliquer « Enregistrer les heures calmes ».
✅ « Préférence enregistrée. » à chaque case ; « Heures calmes enregistrées. ». Bloc « Appareils pour les notifications push » : « Les notifications push ne sont pas encore activées pour cet établissement. » (ne pas activer). Heure vide → « Les heures doivent être au format HH:MM. ».
⚠️ Le directeur voit le même écran avec les mêmes champs ; le lien public `/v2/notifications/unsubscribe` sans paramètre affiche « Ce lien n'est pas valide. Utilisez le lien reçu dans le message. » (aucun lien valide n'est fourni en développement).


### « Paramètres des documents » — `/v2/documents/settings`
**En une ligne :** Fixe la taille maximale des fichiers, le quota de stockage, les seuils d'alerte d'échéance et les durées de conservation, et affiche le stockage utilisé et l'index de texte des PDF.
**Compte :** propriétaire · **Avant :** rien

**Formulaire « Réglages »**
| Champ (libellé exact) | Valeur à saisir |
| :--- | :--- |
| Taille maximale d'un fichier (Mo) | `10` |
| Quota de stockage de l'établissement (Mo) | (vide : quota de l'abonnement) |
| Seuils d'alerte d'expiration (jours) | `60, 30, 7, 1` |
| Conservation après archivage (jours) | `1825` (5 ans ; `0` = jamais purgé) |
| Conservation de la quarantaine (jours) | `30` |
| Versions maximales par document | `20` |

Cliquer « Enregistrer ».
✅ « Paramètres enregistrés. » ; le bloc « Stockage utilisé » indique « … utilisés sur … (n %). » avec les compteurs « Documents », « Versions », « Archivés », « En quarantaine ».
⚠️ « Types autorisés » n'existe pas ici : les extensions acceptées se règlent **par catégorie** (menu « Catégories de documents »). Refus : Taille `200` ou `0` → « Taille invalide (100 Mo au plus). » ; Seuils `30, abc` → « Seuils invalides : nombres entiers de 0 à 365 séparés par des virgules. » ; Conservation `4000` → « Durée invalide (0 à 3650). » ; Quarantaine `0` → « Durée invalide (1 à 365). » ; Versions `0` → « Nombre invalide (1 à 500). ». Ne pas descendre « Versions maximales » à `2` hors test.
**Bloc « Index du texte des PDF »** (après les dépôts) : lire « En attente », « Cherchables », « Sans texte (scans) », « Illisibles » ; « Relancer les échecs » → « 0 PDF remis en file de lecture. ».


### « Catégories de documents » — `/v2/documents/categories`
**En une ligne :** Définit les types de pièces (niveau de confidentialité, extensions acceptées, échéance obligatoire, qui peut lire ou déposer, conservation).
**Compte :** propriétaire · **Avant :** « Paramètres des documents »

**Bouton « Nouvelle catégorie »** — les cinq catégories du jeu de données (17 catégories de départ existent déjà, dont « Règlement intérieur et chartes », « Dossier médical » et « Assurances » ; celles-ci s'ajoutent)
| Champ (libellé exact) | Actes d'état civil | Contrats du personnel | Projet d'établissement | Règlement intérieur | Carnet de santé |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Code | `ACTES_ETAT_CIVIL` | `CONTRATS_PERSONNEL` | `PROJET_ETABLISSEMENT` | `REGLEMENT_INTERIEUR` | `CARNET_SANTE` |
| Type de document | « Dossier d'élève » | « Dossier du personnel » | « Établissement » | « Établissement » | « Dossier d'élève » |
| Libellé | `Actes d'état civil` | `Contrats du personnel` | `Projet d'établissement` | `Règlement intérieur` | `Carnet de santé` |
| Description | `Extraits de naissance et jugements supplétifs` | `Contrats et avenants des enseignants` | `Projet d'établissement 2026-2030` | `Règlement intérieur de l'école et chartes` | `Carnets de santé et de vaccination des élèves` |
| Niveau de confidentialité | « Restreint (secrétariat, études, économat) » | « Confidentiel (direction) » | « Interne (tout le personnel) » | « Interne (tout le personnel) » | « Confidentiel (direction) » |
| Extensions acceptées | `pdf`, `jpg`, `jpeg`, `png` | `pdf`, `docx` | `pdf`, `docx`, `odt` | `pdf`, `docx`, `txt` | `pdf`, `jpg`, `jpeg`, `png` |
| Taille maximale (Mo) | (vide) | (vide) | `10` | (vide) | `5` |
| La personne concernée peut lire | coché | coché | décoché | décoché | décoché |
| Les tuteurs liés peuvent lire | coché | décoché | décoché | décoché | coché |
| La personne concernée ou son tuteur peut déposer | coché | décoché | décoché | décoché | coché |
| Date d'expiration obligatoire | décoché | décoché | décoché | décoché | décoché |
| Seuils d'alerte (jours) | (vide) | (vide) | (vide) | (vide) | (vide) |
| Conservation après archivage (jours) | (vide) | (vide) | (vide) | (vide) | (vide) |

Cliquer « Enregistrer » pour chaque catégorie.
✅ La catégorie apparaît dans son groupe (« Dossier d'élève », « Dossier du personnel », « Établissement ») avec son code en police fixe, ses badges (« Confidentiel », « Lisible par les tuteurs », « Dépôt par la personne concernée ») et « aucun document ». Les champs « Code » et « Type de document » ne sont plus modifiables ensuite ; une catégorie ne se supprime pas, elle s'archive (« Archiver » puis « Restaurer »).
⚠️ Refus : Code `TG-CAT` ou `T` → « Code invalide : majuscules, chiffres et _ (2 à 40 caractères). » ; code déjà pris → « Le code « ACTES_ETAT_CIVIL » est déjà utilisé par une catégorie. » ; Libellé vide → « Le libellé est obligatoire. » ; aucune extension → « Choisissez au moins une extension. » ; Taille `abc` → « Taille invalide. » ; Seuils `30, abc` → « Seuils invalides : nombres entiers de 0 à 365 séparés par des virgules. ».
⚠️ Bouton « Droits par personne » : la recherche (« Rechercher une personne… ») ne trouve que des personnes avec un compte ; aucune n'existe encore (ni enseignant ni tuteur) : impossible à jouer aujourd'hui. Donnée prévue : Personne `KOFFI Adjoua`, Droit accordé « Lecture », Fin du droit (vide).


### « Documents » — `/v2/documents`
**En une ligne :** Explorateur des pièces de l'école (dossiers d'élèves, du personnel, de l'établissement) avec dépôt, versions, aperçu, recherche, confidentialité, partage et archivage.
**Compte :** propriétaire · **Avant :** « Catégories de documents » ; élèves et fiches du personnel créés

Fichiers : dossier `docs/guide-test/jeux-de-donnees/` (le contenu des PDF cite le « Collège Le Baobab » : c'est un texte fictif sans importance).

**Bouton « Déposer un document »** — les dépôts du jeu de données
| Titre | Catégorie | Concerne (Élève concerné / Membre du personnel concerné) | Fichier | Date d'expiration | Étiquettes | Visibilité |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `Règlement intérieur 2026-2027` | « Règlement intérieur » | (établissement) | `ged-document-test-guide-v1.pdf` | (vide) | `règlement, 2026-2027` | « Selon la catégorie » |
| `Note de service de rentrée` | « Règlement intérieur » | (établissement) | `ged-note-de-service-test-guide.txt` | (vide) | `note, rentrée` | « Selon la catégorie » |
| `Projet d'établissement 2026-2030` | « Projet d'établissement » | (établissement) | `ged-note-word-test-guide.docx` | (vide) | `projet` | « Selon la catégorie » |
| `Attestation d'assurance scolaire 2026` | « Assurances » | (établissement) | `ged-image-test-guide.png` | `31/12/2026` | `assurance` | « Selon la catégorie » |
| `Acte de naissance ADOU Aïcha` | « Actes d'état civil » | `ADOU Aïcha` | `ged-image-test-guide.png` | (vide) | `état civil` | « Selon la catégorie » |
| `Carnet de santé KOUASSI Aya` | « Carnet de santé » | `KOUASSI Aya` | `ged-image-test-guide.png` | (vide) | `santé, vaccins` | « Selon la catégorie » |
| `Scan carnet de santé ASSI Brice` | « Carnet de santé » | `ASSI Brice` | `ged-page-sans-texte-test-guide.pdf` | (vide) | `scan` | « Personnel seulement » |
| `Contrat de travail KOFFI Adjoua` | « Contrats du personnel » | `KOFFI Adjoua` | `ged-comptable-test-guide.pdf` | (vide) | `contrat` | « Selon la catégorie » |
| `Visite médicale BAMBA Séraphin` | « Habilitations et autorisations » | `BAMBA Séraphin` | `ged-image-test-guide.png` | `30/10/2026` | `visite médicale` | « Selon la catégorie » |
| `Visite médicale ZOKORA Sylvie (échue)` | « Habilitations et autorisations » | `ZOKORA Sylvie` | `ged-image-test-guide.png` | `30/09/2026` | `visite médicale` | « Selon la catégorie » |

Cliquer « Déposer » pour chaque ligne (la zone de dépôt est un bouton qui ouvre le sélecteur de fichiers ; Description facultative).
✅ La fiche `/v2/documents/<id>` s'ouvre : « Version 1 · version actuelle », badge « Non analysé » (aucun antivirus), « Empreinte SHA-256 », historique « Document déposé ». Un PDF passe de « Texte en cours de lecture » à « Texte cherchable » en 1 à 2 minutes ; `ged-page-sans-texte-test-guide.pdf` reste « Sans texte » (avis : « Ce PDF ne contient pas de texte (probablement un scan) : il n'est pas cherchable par son contenu. Il n'y a pas de reconnaissance de caractères. »). Le Word n'a pas d'aperçu (« La prévisualisation des documents Office n'est pas activée : téléchargez le fichier. »).
⚠️ Refus au dépôt : sans fichier « Choisissez un fichier. » ; sans catégorie « Choisissez une catégorie. » ; « Assurances » sans date → « La date d'expiration est obligatoire pour cette catégorie. » ; « Actes d'état civil » sans élève → « Indiquez la personne concernée. » ; `ged-fichier-vide-test-guide.pdf` → « Le fichier « ged-fichier-vide-test-guide.pdf » est vide. » ; `ged-note-word-test-guide.docx` dans « Actes d'état civil » → « Le fichier « ged-note-word-test-guide.docx » n'a pas un format accepté (pdf, jpg, jpeg, png). » ; `ged-facture.exe.pdf` → « Nom de fichier refusé (extension intermédiaire dangereuse). » ; `ged-image-test-guide.png` redéposé pour ADOU Aïcha dans la même catégorie → « Ce fichier existe déjà dans cette catégorie pour cette personne. ».

**Fichier suspect** (voir aussi « Quarantaine des documents ») — déposer `17-piece-faux-pdf-test-guide.pdf` (texte renommé en .pdf) dans « Actes d'état civil » pour `ADOU Aïcha`, Titre `Pièce suspecte (test)`.
✅ Refusé : « Le contenu du fichier ne correspond pas à l'extension « .pdf » (contenu réel : texte). » Le type est lu sur les octets, jamais sur l'extension ni sur le type déclaré par le navigateur. Aucun document n'est créé.

**Version 2 d'un document** — fiche de `Règlement intérieur 2026-2027` > « Nouvelle version »
| Champ (libellé exact) | Valeur à saisir |
| :--- | :--- |
| Nouveau fichier | `ged-document-test-guide-v2.pdf` |
| Note de version | `Mise à jour après le conseil d'école` |
| Nouvelle date d'expiration | (vide) |

Cliquer « Déposer la version ».
✅ Section « 2 versions » : « Version 2 · version actuelle » et « Version 1 » ; « Télécharger la version 1 » / « Télécharger la version 2 » fonctionnent ; historique « Nouvelle version déposée ». Même fichier de nouveau → « Ce fichier est identique à la version actuelle. » ; sans fichier → « Choisissez un fichier. ».

**Recherche** — page « Recherche dans les PDF » (`/v2/documents/search`), après 2 minutes
| Champ (libellé exact) | Valeur à saisir | Résultat |
| :--- | :--- | :--- |
| Mots recherchés | `palmierversion2deux` | `Règlement intérieur 2026-2027` avec extrait surligné (texte de la version 2) |
| Mots recherchés | `baobabcertif2026` | « Aucun document ne contient ces mots. » (texte de la version 1 effacé par la version 2) |
| Mots recherchés | `caissecompta2026` | `Contrat de travail KOFFI Adjoua` (propriétaire seulement : pièce confidentielle) |
| Mots recherchés | `b` | « Saisissez au moins 2 caractères. » |
Explorateur, champ « Rechercher » : `Aïcha` (titre / personne), `santé` (étiquette), `ged-image` (nom de fichier) ; filtres « Catégorie », « Type de document », « Concerne » = « Élève », « Échéance » = « Échues ».

**Confidentialité et visibilité** — fiche de `Scan carnet de santé ASSI Brice` > « Modifier »
| Champ (libellé exact) | Valeur à saisir |
| :--- | :--- |
| Titre | `Scan carnet de santé ASSI Brice` |
| Étiquettes | `scan, santé` |
| Visibilité | « Privé » (réservé au déposant et à la gestion) puis revenir à « Selon la catégorie » |

Cliquer « Enregistrer ».
✅ Badge « Privé » puis retour ; historique « Informations modifiées ». Le niveau « Confidentiel » (`Carnet de santé KOUASSI Aya`, `Contrat de travail KOFFI Adjoua`) n'est lisible que par le propriétaire et le directeur ; un futur compte secrétariat ne les verrait pas.
⚠️ Bouton « Partager » (section « Partages », champ « Partager avec ») : la recherche ne trouve que des personnes avec un compte ; seul le propriétaire et le directeur existent et ne sont pas proposés (ce ne sont pas des personnes de l'école). Impossible aujourd'hui. Donnée prévue : Partager avec `KOFFI Adjoua`, Droit accordé « Lecture », Fin du partage (vide), Note `Pour information`.

**Archivage** — fiche de `Note de service de rentrée` > « Archiver »
| Champ (libellé exact) | Valeur à saisir |
| :--- | :--- |
| Motif de l'archivage | `Remplacée par le règlement 2026-2027` (3 caractères au moins) |

✅ « Document archivé : il n'apparaît plus dans les listes. » ; filtre « État » = « Archivés » puis « Restaurer » → « Document restauré. ». Motif `ab` → « Le motif doit comporter au moins 3 caractères. ».


### « Documents à échéance » — `/v2/documents/expirations`
**En une ligne :** Liste les pièces qui arrivent à échéance, celles déjà échues et celles sans date alors que leur catégorie l'exige.
**Compte :** propriétaire · **Avant :** les dépôts datés de « Documents »

**Écran « Échéances des documents »**
| Champ (libellé exact) | Valeur à saisir |
| :--- | :--- |
| Horizon | `30 jours` (départ) puis `90 jours` |

✅ Horizon 30 jours : « À échoir sous 30 jours » = 1 (`Visite médicale BAMBA Séraphin`, « Expire dans 21 jours ») et « Échus » = 1 (`Visite médicale ZOKORA Sylvie (échue)`, « Échu le 30/09/2026 ») ; onglet « Sans échéance » : « Aucun document sans échéance exigée. ». Horizon 90 jours : « À échoir sous 90 jours » = 2, `Attestation d'assurance scolaire 2026` (31/12/2026, « Expire dans 83 jours ») apparaît. Dans l'explorateur, le filtre « Échéance » = « À échoir bientôt », « Échues », « Avec une échéance » ou « Échéance manquante » donne les mêmes pièces.
⚠️ Les alertes à 60, 30, 7 et 1 jours (seuils des paramètres) sont émises par un job quotidien : rien à constater à l'écran le jour même. Une date passée est acceptée au dépôt.


### « Quarantaine des documents » — `/v2/documents/quarantine`
**En une ligne :** Garde les fichiers détectés comme malveillants à l'analyse antivirus, que la direction peut libérer ou détruire avec un motif.
**Compte :** propriétaire · **Avant :** rien

**Onglets « En quarantaine », « Libérés », « Détruits », « Tous »**
✅ « Aucun fichier. » dans chaque onglet ; le compteur « En quarantaine » des paramètres vaut 0.
⚠️ **Impossible à alimenter** depuis l'interface : aucun antivirus n'est branché (`DOCUMENTS_SCANNER` absent), donc aucun fichier n'est jamais mis en quarantaine, et les dépôts portent « Non analysé ». Le fichier `17-piece-faux-pdf-test-guide.pdf` n'est pas un virus : il est **refusé au dépôt** (type réel « texte ») et n'apparaît donc pas ici. Ne jamais créer de fichier EICAR. Avec un antivirus actif, chaque fichier retenu proposerait « Libérer » (Motif de la décision `Faux positif vérifié`, MFA exigée) et « Détruire » (motif `Fichier infecté confirmé`, 3 caractères au moins).


---

## Partie 12 — Examens

**Avertissement.** Aucune règle d'examen officielle n'est livrée : le type « CEPE » du pack Primaire, ses épreuves `EP1` à `EP3`, leurs coefficients, la pièce exigée et la règle de calcul `CI-EXAM-PLACEHOLDER` sont des **données fictives de démonstration** (bandeau « Règles de démonstration » et filigrane sur les PDF). Les moyennes, seuils et admissions ci-dessous sont inventés pour tester ; ne jamais les présenter comme officiels. Pour un examen officiel, l'application n'invente jamais l'admission : elle enregistre ce que l'autorité communique.

**Fil conducteur (jeu de test).** Une session officielle « CEPE 2027 (démonstration) » pour les trois élèves de CM2 A, et une session d'examen blanc « Composition blanche CM2 — février 2027 » qui la prépare.

| Élève (CM2 A) | N° de candidat attendu (session officielle) | Place attendue | Notes EP1 /20 · EP2 /20 · EP3 /10 | Résultat communiqué | Destin du test |
| :--- | :--- | :--- | :--- | :--- | :--- |
| COULIBALY Ibrahim | `CEPE2027-00001` | Salle 1, place 1 | `14` · `13` · `7` | Admis, moyenne `13,5`, rang `1` | reste admis |
| N'GUESSAN Kouamé | `CEPE2027-00002` | Salle 1, place 2 | `9` · `8` · `5` | Refusé, moyenne `8,75`, rang `2` | corrigé en Admis `10,25` (EP2 `8` devient `11`) |
| TANOH Marie-Ange | `CEPE2027-00003` | Salle 2, place 1 puis place 2 | Absent aux trois épreuves | Absent | reste absente |

**Ce qui se joue quand.** Aucune date saisie dans ce groupe n'est comparée à la date du jour (vérifié : ni l'API ni la base ne contrôlent « Début des épreuves » ; seuls l'ordre des états de la session et leurs gardes comptent). **Tout le parcours est donc jouable dès le 09/10/2026**, y compris les dates de juin 2027 et de février 2027 : elles sont fictives. Seules dépendances externes : les 3 actes de naissance dans « Documents » (pièce exigée du CEPE) et, pour l'examen blanc, 2 évaluations « Examen blanc » **publiées** (circuit du groupe Évaluations ; aucune clôture de période n'est exigée par les examens). **Irréversibles, à faire en dernier** : « Passer à : Résultats publiés » (le test en dépend pour les statistiques finales et les attestations) et « Passer à : Archivée » (ne pas le faire).

**Ordre conseillé.** (1) « Examens » : pack CEPE, liaison de la règle, 2 sessions. (2) « Centres et salles ». (3) Évaluations blanches + « Documents » (hors groupe). (4) Session blanche complète (« Examens », « Candidats aux examens », « Examens blancs »). (5) Session officielle : figer, ouvrir, « Candidats aux examens » (pièces, éligibilité, inscription), « Centres et salles » (onglet Répartition), clore, « Exports d'examen » (convocations). (6) « Examens » : Épreuves en cours ; « Résultats d'examen » (notes, résultats) ; Résultats saisis ; « Statistiques d'examen » ; publier ; « Exports d'examen » (attestation, relevés) ; « Corrections d'examen » ; ré-émission ; statistiques finales.

**Particularités du pack Primaire.** Les 8 menus du propriétaire sont visibles (plan Professional : fonctions `examinations.core`, `.mock` et `.exports` incluses). Il n'existe **aucun compte « Responsable des examens »** : le propriétaire et le directeur (droits `*`, MFA) font tout ; la **règle des quatre yeux** (corrections) et la publication se jouent avec ces deux comptes. Il n'existe pas d'écran « délibération » dans ce module : le résultat d'un examen officiel est saisi tel que l'autorité le communique (le conseil de classe est un autre groupe). Les onglets « Répartition », « Imports » et « Types d'examens » ne sont pas des menus de la barre latérale : on y accède par la barre d'onglets du module « Examens », ils sont traités dans les sections ci-dessous.


### « Examens » — `/v2/examinations`
**En une ligne :** liste les sessions d'examen (officielles et blanches), charge le type d'examen du pack (CEPE) et fait avancer chaque session d'état en état (figer la définition, ouvrir, clore, démarrer, publier).
**Compte :** propriétaire `direction.generale@ecole-cocotiers.test` (MFA) ; la publication est faite par la direction (propriétaire ou directeur, MFA récente) · **Avant :** classe CM2 A et ses 3 élèves inscrits.

**Onglet « Types d'examens » (`/v2/examinations/types`), bouton « Charger le pack du primaire (fictif) »** — crée le type CEPE de démonstration
| Champ | Valeur à saisir |
| :--- | :--- |
| (aucun champ) | cliquer une seule fois le bouton ; un second clic ne duplique rien |
✅ « Pack chargé : 1 type(s) créé(s), 0 déjà présent(s). » puis carte `CEPE — CEPE (données fictives de démonstration)` (pastilles « Démonstration » et « Actif »). Via « Afficher le détail » : niveau d'enseignement `PRIMARY`, modèle du numéro `{TYPE}{YEAR}-{SEQ:5}`, filières « Aucune filière. », épreuves `EP1` « Épreuve 1 (fictive) » coefficient 1 barème 20, `EP2` « Épreuve 2 (fictive) » coefficient 2 barème 20, `EP3` « Épreuve 3 (fictive) » coefficient 1 barème 10, pièce « Acte de naissance (pièce fictive) » (obligatoire), case « Transmettre le résultat et la moyenne aux admissions » cochée. Le pack crée aussi 2 formats d'export et 1 format d'import fictifs (voir « Exports d'examen » et « Résultats d'examen »).
⚠️ Les noms des épreuves ne sont pas modifiables ici et ne correspondent pas à des matières ; pour la lecture, on peut imaginer EP1 = Français, EP2 = Mathématiques, EP3 = Éveil. Aucun écran pour ajouter une pièce, une filière à un candidat ou un format (API seulement). La transmission aux admissions ne concerne que l'admission en 6e : sans objet dans une école primaire seule, laisser cochée.

**Écran « Liaisons aux programmes » du menu « Règles de calcul » (`/v2/rules/bindings`), bouton « Ajouter une liaison »** — lie la règle de démonstration des examens (à faire AVANT de créer les sessions)
| Champ (libellé exact) | Valeur à saisir |
| :--- | :--- |
| Contrat de calcul | `Examens nationaux (exam-national@1)` |
| Jeu de règles | `Examens nationaux — jeu de démonstration (fictif) (CI-EXAM-PLACEHOLDER)` |
| Périmètre | « Tout l'établissement » |
| En vigueur à partir du | `07/09/2026` |
| Jusqu'au (inclus) | (vide) |
✅ « La liaison est créée. » Sans cette liaison les sessions se créent quand même (pas de règle épinglée) : l'éligibilité se saisit alors « à la main », le taux de réussite reste « — » et le calcul de l'examen blanc est refusé.
⚠️ Le pack Primaire ne pose pas cette liaison d'office (seul le Secondaire la reçoit). Une session épingle la règle à sa création ou, au plus tard, à « Copier et figer la définition » ; une liaison faite après coûte une nouvelle session. En production, la liaison d'un jeu fictif exige un accusé que l'écran ne propose pas.

**Bouton « Nouvelle session »** — crée la session officielle puis la session blanche (dans cet ordre)
| Champ (libellé exact) | Session officielle | Session blanche |
| :--- | :--- | :--- |
| Type d'examen | `CEPE — CEPE (données fictives de démonstration)` | `CEPE — CEPE (données fictives de démonstration)` |
| Nature | « Officiel » | « Examen blanc » |
| Session officielle préparée | (champ absent) | `CEPE 2027 (démonstration)` |
| Code | `CEPE-2027` | `CEPE-BLANC-2027` |
| Libellé | `CEPE 2027 (démonstration)` | `Composition blanche CM2 — février 2027` |
| Année de la session | `2027` | `2027` |
| Début des épreuves | `14/06/2027` | `15/02/2027` |
✅ À « Créer la session » l'application ouvre le détail de la session (état « Planifiée », avancement 0 %, bandeau « Règles de démonstration »). Dans la liste : colonnes Session / Examen `CEPE 2027` / Nature / État / Avancement / Début des épreuves / Données « Démonstration ». Seul « Début des épreuves » se saisit à la création : les dates d'ouverture et de clôture des inscriptions et de fin des épreuves restent « — ».
⚠️ Codes en doublon : « Ce code de session existe déjà pour cet établissement. » Code avec espace ou minuscules refusé (« Format invalide. »).

**Détail d'une session (`/v2/examinations/sessions/<id>`), boutons d'état** — fait avancer la session ; chaque bouton n'apparaît que si l'étape est possible
| Session | Bouton | Quand | Effet attendu |
| :--- | :--- | :--- | :--- |
| les deux | « Copier et figer la définition » | tout de suite (état « Planifiée ») | « Définition copiée : 3 épreuve(s). » ; tableau « Épreuves » `EP1`, `EP2`, `EP3` |
| les deux | « Passer à : Inscriptions ouvertes » | après le gel | « La session est maintenant : Inscriptions ouvertes. » (17 %) |
| les deux | « Passer à : Inscriptions closes » | après l'inscription des 3 candidats (et la répartition pour l'officielle) | état « Inscriptions closes » (33 %) |
| les deux | « Passer à : Épreuves en cours » | après les convocations (officielle) ou avant la liaison des évaluations (blanche) | état « Épreuves en cours » (50 %) ; la répartition est figée |
| officielle | « Passer à : Résultats saisis » | après les 3 résultats | état « Résultats saisis » (67 %) |
| officielle | « Passer à : Résultats publiés » (rouge) | après les statistiques | fenêtre « Publier les résultats » (« Les résultats de 3 candidat(s) deviennent visibles des familles. … »), bouton « Publier » ; état « Résultats publiés » (83 %), « Publiés » 3 |
✅ Les liens « Écrans de la session » ouvrent chaque écran déjà filtré sur la session ; la session blanche propose « Examen blanc » et pas « Imports ».
⚠️ Avant les 3 résultats, « Passer à : Résultats publiés » est grisé avec « 1 candidat(s) inscrit(s) sans résultat… ». Une session blanche ne se publie pas : la laisser « Épreuves en cours ». Ne pas utiliser « Passer à : Archivée » (irréversible, et plus aucune correction). Un compte sans droit de publication reçoit « La publication des résultats exige la permission « exam.result.publish ». » (non applicable au propriétaire et au directeur).


### « Centres et salles » — `/v2/examinations/centers`
**En une ligne :** déclare le centre d'examen et ses salles avec leur capacité, puis (onglet « Répartition ») place chaque candidat inscrit à une salle et un numéro de place.
**Compte :** propriétaire ou directeur · **Avant :** pour le centre, rien ; pour la « Répartition », la session officielle avec ses 3 candidats inscrits (voir « Candidats aux examens ») et l'état « Inscriptions ouvertes » ou « Inscriptions closes ».

**Bouton « Nouveau centre »** — le centre de l'école
| Champ (libellé exact) | Valeur à saisir |
| :--- | :--- |
| Code | `CTR-COCO` |
| Nom | `Centre de l'école Les Cocotiers` |
| Nature | « Centre propre » |
| Code attribué par l'autorité | (vide) |
| Localité | `Cocody, Abidjan` |
✅ Carte `CTR-COCO — Centre de l'école Les Cocotiers` (pastilles « Centre propre », « Actif »), texte « Aucune salle. ».

**Bouton « Ajouter une salle »** (deux fois) — les salles
| Code | Libellé | Capacité (places) |
| :--- | :--- | :--- |
| `S1` | `Salle 1 — CM2` | `2` |
| `S2` | `Salle 2 — CM2` | `2` |
✅ Tableau des salles (Code / Libellé / Capacité / État « Active »). Capacité totale 4 pour 3 candidats. Optionnel : « Désactiver » puis « Activer » sur `S2` (pastille « Inactive » puis « Active »).
⚠️ Capacité `0` : « La valeur doit être supérieure ou égale à 1. » ; code de centre en doublon : « Ce code de centre existe déjà. »

**Onglet « Répartition » (`/v2/examinations/assignments`), session `CEPE 2027 (démonstration)`** — enregistre les centres de la session, répartit, ajuste une place
| Champ / bouton | Valeur à saisir |
| :--- | :--- |
| Centres de la session | cocher `CTR-COCO — Centre de l'école Les Cocotiers`, puis « Enregistrer les centres » |
| « Tout replacer » | décochée |
| Bouton | « Répartir automatiquement » |
| Ligne `CEPE2027-00003` (TANOH Marie-Ange), bouton « Changer » : Salle / Numéro de place | `Centre de l'école Les Cocotiers — S2` / `2` |
✅ « Centres de la session enregistrés. », « Synthèse de la répartition » : Inscrits 3, Capacité 4. Après la répartition : « 3 candidat(s) placé(s), 0 déjà placé(s). » et tableau « Places attribuées » : `CEPE2027-00001` COULIBALY Ibrahim S1 place 1 ; `CEPE2027-00002` N'GUESSAN Kouamé S1 place 2 ; `CEPE2027-00003` TANOH Marie-Ange S2 place 1, puis place 2 après « Changer ».
⚠️ La répartition est « tout ou rien » (« Capacité insuffisante… » si moins de places que de candidats) et se fige à « Épreuves en cours » (« La répartition est figée à ce stade de la session. »). Faire « Changer » avant d'émettre les convocations, sinon les révoquer et les ré-émettre.


### « Candidats aux examens » — `/v2/examinations/candidates`
**En une ligne :** constitue la liste des candidats d'une session à partir d'une classe, vérifie leurs pièces et leur éligibilité, puis les inscrit (attribution du numéro de candidat).
**Compte :** propriétaire ou directeur · **Avant :** session ouverte (« Inscriptions ouvertes ») ; pour la session officielle, les 3 actes de naissance ci-dessous dans « Documents ».

**Écran « Documents », bouton « Déposer un document » (3 fois, hors groupe)** — la pièce exigée du CEPE doit être un document rattaché à l'élève
| Document concernant | Élève concerné | Titre | Fichier |
| :--- | :--- | :--- | :--- |
| « Un élève » | COULIBALY Ibrahim | `Acte de naissance — COULIBALY Ibrahim` | un petit PDF ou PNG fictif, ex. `acte-naissance-demo.pdf` |
| « Un élève » | N'GUESSAN Kouamé | `Acte de naissance — N'GUESSAN Kouamé` | idem |
| « Un élève » | TANOH Marie-Ange | `Acte de naissance — TANOH Marie-Ange` | idem |
✅ Chaque document apparaît dans l'explorateur. ⚠️ Le sélecteur de l'écran des examens ne permet pas de déposer un nouveau document : ils doivent exister avant. Catégorie au choix (ex. celle des pièces d'état civil si elle existe).

**Bloc « Ajouter les élèves d'une classe »** — sessions `CEPE 2027 (démonstration)` puis `Composition blanche CM2 — février 2027` (liste « Session d'examen » : chaque option s'écrit `<libellé> — CEPE 2027 (<nature>, <état>)`)
| Champ (libellé exact) | Valeur à saisir |
| :--- | :--- |
| Classe | `CM2 A` |
✅ « 3 candidat(s) ajouté(s), 0 déjà présent(s). » Colonnes du tableau : Candidat / Numéro « — » / Filière / Inscription « Brouillon » / Éligibilité « Non évaluée » / Pièces « 1 pièce(s) manquante(s) » / Issue « En attente ». Un second clic : « 0 candidat(s) ajouté(s), 3 déjà présent(s). »

**Fiche candidat (clic sur le nom), session officielle, dans l'ordre COULIBALY Ibrahim, N'GUESSAN Kouamé, TANOH Marie-Ange** — pièce, éligibilité, inscription, identifiants
| Candidat | Section « Pièces du dossier » : « Joindre un document » > Document | Puis | « Évaluer par la règle » | « Inscrire le candidat » | Type d'identifiant / Valeur |
| :--- | :--- | :--- | :--- | :--- | :--- |
| COULIBALY Ibrahim | `Acte de naissance — COULIBALY Ibrahim` (« Choisir un document », « Joindre ») | « Accepter » | « Éligible » | « Candidat inscrit, numéro CEPE2027-00001. » | `CEPE_CODE` / `CEPE-COCO-0001`, puis `OFFICIAL_NUMBER` / `OFF-COCO-0001` |
| N'GUESSAN Kouamé | `Acte de naissance — N'GUESSAN Kouamé` | « Accepter » | « Éligible » | « Candidat inscrit, numéro CEPE2027-00002. » | `CEPE_CODE` / `CEPE-COCO-0002`, puis `OFFICIAL_NUMBER` / `OFF-COCO-0002` |
| TANOH Marie-Ange | `Acte de naissance — TANOH Marie-Ange` | « Accepter » | « Éligible » | « Candidat inscrit, numéro CEPE2027-00003. » | `CEPE_CODE` / `CEPE-COCO-0003`, puis `OFFICIAL_NUMBER` / `OFF-COCO-0003` |
✅ La pièce passe de « Manquante » à « Déposée » puis « Acceptée » ; pastilles « Inscrit » et « Éligible » ; section « Identifiants officiels » : `CEPE_CODE : CEPE-COCO-0001 (MANUAL)` ; « Numéro officiel » de l'état civil `OFF-COCO-0001`. Le détail de session passe à Candidats 3, Éligibles 3, Inscrits 3. Raccourci possible après avoir accepté les 3 pièces : « Évaluer l'éligibilité de tous » (« 3 candidat(s) évalué(s) par la règle. »).
⚠️ Ordre impératif : pièce acceptée AVANT l'évaluation (sinon « À examiner », motif `DOCUMENTS_MISSING` affiché brut) et AVANT l'inscription (« pièces non acceptées : … »). Les numéros suivent l'ordre d'inscription (compteur propre à la session, sans trou) : inscrire dans l'ordre du tableau ; en lot, cocher dans cet ordre puis « Inscrire la sélection (3) ». Sans règle liée : « Évaluer par la règle » est refusé (« Aucune version de la règle d'éligibilité n'est épinglée à cette session… ») ; utiliser alors « Saisir à la main » > Résultat « Éligible », Motifs (vide) > « Enregistrer » (refusé si une règle est liée : « Une règle d'éligibilité est épinglée… »). « Accorder une dérogation » n'apparaît que pour un candidat « Non éligible » ou « À examiner » (motif de 10 caractères au moins) : non joué ici. Aucune inscription possible après « Inscriptions closes » (« les inscriptions ne sont pas ouvertes (session REGISTRATION_CLOSED) »). Si un acte de naissance manque (document absent ou d'un autre élève) : « Le document désigné est introuvable ou n'appartient pas à cet élève. »

**Session blanche `Composition blanche CM2 — février 2027`** — inscription sans pièce ni éligibilité
| Action | Valeur |
| :--- | :--- |
| « Ajouter les élèves » | Classe `CM2 A` |
| « Sélectionner la page » puis « Inscrire la sélection (3) » | les 3 lignes |
✅ « 3 candidat(s) inscrit(s). » Numéros `CEPE2027-00001` à `00003` dans cette session (compteur indépendant de la session officielle ; l'ordre dépend du tri de la liste, à relever).
⚠️ Le bloc « Candidat libre (sans dossier élève) » existe pour les sessions officielles (« Saisir un candidat libre », « Importer un fichier CSV ») : non utilisé ici, l'école n'ayant aucun candidat libre dans le jeu de test.


### « Examens blancs » — `/v2/examinations/mock`
**En une ligne :** relie chaque épreuve d'une session blanche à une évaluation publiée de la classe, reprend leurs notes et calcule moyenne, issue et rang par la règle (jamais un résultat officiel).
**Compte :** propriétaire ou directeur · **Avant :** la règle de démonstration liée (voir « Examens »), la session blanche à l'état « Épreuves en cours » avec ses 3 candidats inscrits, et les 2 évaluations ci-dessous **publiées**.

**Écran « Évaluations » (menu du groupe Évaluations), « Nouvelle évaluation » puis feuille de notes** — les compositions blanches de CM2 A (deux évaluations)
| Champ (libellé exact) | Évaluation 1 | Évaluation 2 |
| :--- | :--- | :--- |
| Type d'évaluation | « Examen blanc » (masqué aux élèves) | « Examen blanc » |
| Intitulé | `Composition blanche CM2 — Français (février 2027)` | `Composition blanche CM2 — Mathématiques (février 2027)` |
| Date de l'évaluation | `15/02/2027` | `16/02/2027` |
| Barème (sur) | `20` | `20` |
| Coefficient | `1` | `1` |
| Classe | `CM2 A` | `CM2 A` |
| Cours | `FRANC` (Français) | `MATHS` (Mathématiques) |
| Période | « Trimestre 2 » | « Trimestre 2 » |
| Enseignant | `BAMBA Séraphin` | `BAMBA Séraphin` |
Notes à saisir, puis circuit jusqu'à « Publier les notes » (seules les notes publiées sont reprises) :
| Élève | Français /20 | Mathématiques /20 |
| :--- | :--- | :--- |
| COULIBALY Ibrahim | `14` | `12` |
| N'GUESSAN Kouamé | `9` | `7` |
| TANOH Marie-Ange | état « Absent non justifié » | état « Absent non justifié » |
⚠️ Le barème doit être `20` pour EP1 et EP2 (sinon « Le barème de l'évaluation (…) diffère de celui de l'épreuve (…) : aucune conversion silencieuse. »). Si l'évaluation refuse une date ou une période futures, la saisir dans le « Trimestre 1 » avec la date du jour : le test des examens n'y change rien. Une évaluation d'un autre type est refusée (« Seule une évaluation de type « examen blanc » (non visible des élèves) se lie à une épreuve d'examen blanc. »).

**Bloc « Lier une évaluation »** — session `Composition blanche CM2 — février 2027` (liste « Session d'examen » : seules les sessions blanches sont proposées)
| Épreuve | Classe | Évaluation |
| :--- | :--- | :--- |
| `EP1 — Épreuve 1 (fictive)` | `CM2 A` | `Composition blanche CM2 — Français (février 2027) — 15/02/2027 (/20)` |
| `EP2 — Épreuve 2 (fictive)` | `CM2 A` | `Composition blanche CM2 — Mathématiques (février 2027) — 16/02/2027 (/20)` |
✅ Deux lignes « Évaluations liées » (« Épreuve 1 (fictive) ← évaluation xxxxxxxx »). `EP3` reste non liée (ignorée du calcul, sans effet sur l'issue). Une évaluation n'alimente qu'une épreuve (« Cette évaluation alimente déjà une épreuve. »).

**Bloc « Calcul »** — reprise des notes puis calcul
| Bouton | Résultat attendu |
| :--- | :--- |
| « Reprendre les notes des évaluations » | « 6 note(s) reprise(s), 0 inchangée(s), 0 sans candidat. » (relancé : « 0 note(s) reprise(s), 6 inchangée(s), 0 sans candidat. ») |
| « Calculer par la règle » | « 3 résultat(s) calculé(s), 0 déjà publié(s) ignoré(s). », « Règle CI-EXAM-PLACEHOLDER, version `<identifiant>`. » et l'avis « Le calcul a utilisé des règles de démonstration. » |
✅ Dans « Résultats d'examen » (session blanche), origine « Calculé par règle (examen blanc) » : COULIBALY Ibrahim moyenne `12,667` (= (14×1 + 12×2) / 3, EP3 ignorée) « Admis » rang 1 ; N'GUESSAN Kouamé `7,667` « Refusé » rang 2 ; TANOH Marie-Ange « Absent » sans moyenne (valeurs de démonstration, seuil fictif 10, arrondi à relever). Statistiques de la session blanche : voir « Statistiques d'examen ».
⚠️ Sans règle liée : « Aucune version de la règle de calcul n'est épinglée à cette session : le calcul d'un examen blanc est impossible. » Avant « Épreuves en cours » : « Le calcul exige une session en cours ou à résultats saisis… ». On ne saisit pas de résultat à la main sur une session blanche (« Les résultats d'un examen blanc sont calculés par la règle, jamais saisis. ») et elle ne donne aucun document officiel.


### « Résultats d'examen » — `/v2/examinations/results`
**En une ligne :** saisit les notes de chaque épreuve et les résultats (admis, refusé, absent…) communiqués par l'autorité, puis permet de publier un résultat ; la publication de toute la session se fait depuis « Examens ».
**Compte :** propriétaire ou directeur (le directeur pour appliquer un import) · **Avant :** session officielle `CEPE 2027 (démonstration)` à l'état « Épreuves en cours » (convocations émises), 3 candidats inscrits.

**Onglet « Notes par épreuve »** — grille candidat × épreuve (`EP1 /20`, `EP2 /20`, `EP3 /10`)
| Candidat | `EP1` | `EP2` | `EP3` |
| :--- | :--- | :--- | :--- |
| COULIBALY Ibrahim | `14` | `13` | `7` |
| N'GUESSAN Kouamé | `9` | `8` | `5` |
| TANOH Marie-Ange | état « Absent » | état « Absent » | état « Absent » |
✅ Bouton « Enregistrer les notes modifiées (9) » puis « 9 note(s) enregistrée(s), 0 inchangée(s). » ; les valeurs persistent. La fiche de COULIBALY Ibrahim montre `14 / 20`, `13 / 20`, `7 / 10` avec l'origine « Saisie à la main ».
⚠️ Note supérieure au barème refusée (« la note 21 dépasse le barème… » dans « Lignes refusées »). Hors « Épreuves en cours » ou « Résultats saisis », le rapport répond « 0 note(s) enregistrée(s) » avec « la saisie des notes n'est ouverte que session en cours ou résultats saisis ». Après la clôture des notes, une note ne change que par « Corrections d'examen ».

**Onglet « Résultats », bloc « Saisir un résultat »** (trois fois, un enregistrement à la fois) — résultat communiqué par l'autorité, saisi tel quel
| Candidat | Résultat | Moyenne | Rang | Mention |
| :--- | :--- | :--- | :--- | :--- |
| COULIBALY Ibrahim (CEPE2027-00001) | « Admis » | `13,5` | `1` | `AB` |
| N'GUESSAN Kouamé (CEPE2027-00002) | « Refusé » | `8,75` | `2` | (vide) |
| TANOH Marie-Ange (CEPE2027-00003) | « Absent » | (vide) | (vide) | (vide) |
✅ À chaque envoi « 1 résultat(s) enregistré(s). » ; tableau « Résultats des candidats » : 3 lignes, origine « Saisi à la main », publication « Non publié » ; le détail de session affiche « Avec résultat » 3 et permet « Passer à : Résultats saisis ». Les valeurs saisies ne sont pas recalculées à partir des notes (ce sont celles de l'« autorité »). Le code de mention `AB` est un code fictif (2 caractères majuscules au moins).
⚠️ « Absent » avec une moyenne : « Un absent, exclu ou ajourné n'a ni moyenne, ni rang, ni mention. » Moyenne `abc` : « Format invalide. » Aucun candidat choisi : « Choix invalide. »

**Onglet « Imports » (`/v2/examinations/imports`) — variante à la place de la saisie manuelle des résultats** — dépôt d'un fichier de l'autorité (fictif)
Fichier à créer (texte UTF-8, séparateur `;`, nommé `resultats-cepe-2027-demo.csv`) :
```
NUMERO;DECISION;MOYENNE
CEPE2027-00001;ADMIS;13,50
CEPE2027-00002;AJOURNE;8,75
CEPE2027-00003;ABSENT;
```
| Champ (libellé exact) | Valeur à saisir |
| :--- | :--- |
| Contenu du fichier | « Résultats » |
| Format du fichier | `Résultats de l'autorité (format fictif) (v1) — démonstration` |
| Fichier | `resultats-cepe-2027-demo.csv` (zone de dépôt, formats csv, txt, xlsx, 5 Mio au plus) |
✅ Lot « Déposé », « Analyser le fichier » : état « Analysé », « 3 ligne(s) : 3 valide(s), 0 en erreur. » ; puis « Appliquer l'import » par la direction, session « Épreuves en cours » : « Import appliqué. » ; les 3 résultats s'affichent avec l'origine « Importé de l'autorité » (sans rang ni mention). Redéposer le même fichier : « Ce fichier a déjà été importé pour cette session. »
⚠️ Choisir l'une ou l'autre voie (saisie ou import) pour les résultats. Les numéros du fichier doivent être les numéros réels. Un en-tête sans `DECISION` est rejeté. Aucun format d'import de notes ni de numéros officiels n'est livré (seul « Résultats » existe).

**Publication (depuis « Examens » ou ligne par ligne)** — rend les résultats visibles
| Action | Où | Valeur |
| :--- | :--- | :--- |
| « Passer à : Résultats saisis » | détail de session | après les 3 résultats |
| « Passer à : Résultats publiés » > « Publier » | détail de session | après « Statistiques d'examen » |
| (variante) bouton « Publier » d'une ligne | onglet « Résultats » | une ligne à la fois |
✅ Publication : « La session est maintenant : Résultats publiés. » ; « Publiés » 3 ; les lignes passent à « Publié ». Ressaisir un résultat publié : « Ce résultat est publié : sa correction passe par une révision approuvée par une autre personne. »
⚠️ Irréversible. La publication d'un résultat d'élève transmet « admis / non admis » et la moyenne aux admissions (case cochée sur le type CEPE) ; sans objet pour cette école. Une seconde vérification MFA peut être demandée : valider avec le code du moment.


### « Statistiques d'examen » — `/v2/examinations/statistics`
**En une ligne :** affiche les effectifs (inscrits, présents, admis, refusés, absents…) et le taux de réussite d'une session, regroupés au choix et comparables à l'examen blanc.
**Compte :** propriétaire ou directeur · **Avant :** résultats saisis (session officielle) ; la règle liée pour le taux.

**Écran, session `CEPE 2027 (démonstration)`** — valeurs attendues (« Regrouper » = « Ensemble », puis « Par sexe », « Par niveau »)
| Moment | Groupe | Inscrits | Présents | Admis | Refusés | Absents | Exclus | Différés | Taux |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Résultats saisis | Ensemble | 3 | 2 | 1 | 1 | 1 | 0 | 0 | 50 % |
| Résultats saisis | « Garçons » | 2 | 2 | 1 | 1 | 0 | 0 | 0 | 50 % |
| Résultats saisis | « Filles » | 1 | 0 | 0 | 0 | 1 | 0 | 0 | — |
| Après correction de Kouamé | Ensemble | 3 | 2 | 2 | 0 | 1 | 0 | 0 | 100 % |
Présents = admis + refusés + exclus + différés (un absent n'est pas présent) ; taux = admis / présents (règle de démonstration, forme exacte du pourcentage à relever).
**Session blanche `Composition blanche CM2 — février 2027`** : Ensemble 3 inscrits, 2 présents, 1 admis, 1 refusé, 1 absent, taux 50 %.
| Champ (libellé exact) | Valeur à saisir |
| :--- | :--- |
| Regrouper | « Ensemble », « Par sexe », « Par niveau » (essayer les trois ; « Par établissement » et « Par filière » donnent un seul groupe) |
| Comparer avec | « L'examen blanc » (session officielle seulement) |
✅ Avec « L'examen blanc », un second tableau « Comparaison : Examen blanc… » reprend les chiffres de la session blanche (3 inscrits, 1 admis, 1 refusé, 1 absent). « L'année précédente » n'affiche aucun tableau (pas d'édition antérieure).
⚠️ Sans règle liée : alerte « Le taux n'est pas disponible : aucune règle n'est épinglée à la session. » et Taux « — » partout. Libellés exacts de « Par niveau » à relever (probablement `CM2`).


### « Exports d'examen » — `/v2/examinations/exports`
**En une ligne :** produit les fichiers officiels paramétrables (liste des candidats, résultats) et émet les documents scellés (convocation, attestation de réussite, relevé de notes).
**Compte :** propriétaire ou directeur · **Avant :** session officielle ; convocations après « Répartition » et clôture des inscriptions, attestations et relevés après publication.

**Section « Documents », liste « Document » + « Émettre pour tous les candidats concernés »** — dans l'ordre chronologique de la session
| Moment | Document | Résultat attendu |
| :--- | :--- | :--- |
| Session « Inscriptions closes », 3 candidats placés | « Convocation » | « 3 document(s) émis, 0 ignoré(s). » ; 3 lignes `Convocation v1 — CEPE2027-0000N` « Émis » |
| Relancer le même lot | « Convocation » | « 0 document(s) émis, 3 ignoré(s). » (« Un document valide existe déjà. ») |
| Après publication | « Attestation de réussite » | « 1 document(s) émis, 0 ignoré(s). » ; lignes refusées pour N'GUESSAN Kouamé et TANOH Marie-Ange : « L'attestation de réussite exige un résultat ADMIS publié. (examinations.attestation_requires_admission) » |
| Après publication | « Relevé de notes » | « 3 document(s) émis, 0 ignoré(s). » |
| Après la correction de Kouamé | « Attestation de réussite » | « 1 document(s) émis, 1 ignoré(s). » (Kouamé, désormais admis) ; ligne refusée pour Marie-Ange |
| Après la correction de Kouamé | « Relevé de notes » | « 1 document(s) émis, 2 ignoré(s). » ; `Relevé de notes v2 — CEPE2027-00002` |
✅ « Télécharger » ouvre le PDF `CONVOCATION-CEPE2027-00001.pdf` (nom, centre, salle, place, date des épreuves `14/06/2027`, filigrane « Données et règles de démonstration (fictives) : aucune valeur officielle. »). Après la correction de Kouamé, `Relevé de notes v1 — CEPE2027-00002` passe à « Révoqué » avec le motif « Résultat corrigé par révision approuvée (demande xxxxxxxx). »
**Bouton « Révoquer » (facultatif)** sur une convocation :
| Champ (libellé exact) | Valeur à saisir |
| :--- | :--- |
| Motif de la révocation | `Convocation émise avant le changement de table (démonstration).` (10 caractères au moins) |
✅ La ligne passe à « Révoqué » avec le motif ; ré-émettre : « 1 document(s) émis, 2 ignoré(s). » (version 2).
⚠️ Les attestations et relevés exigent un résultat publié ; émission d'un document sur une session blanche impossible (« Un examen blanc ne donne lieu à aucun document officiel. »). Si le service de documents officiels n'a pas ses gabarits : refus « Le service « documents officiels d'examen » n'est pas disponible » (à signaler).

**Section « Exports », liste « Format d'export » + « Lancer l'export »** — deux formats fictifs du pack (session officielle, après résultats saisis)
| Format d'export | Colonnes de l'en-tête | Lignes attendues |
| :--- | :--- | :--- |
| `Liste des candidats (format fictif) (CSV, v1) — démonstration` | `NUMERO;NOM;PRENOMS;NAISSANCE;LIEU_NAISSANCE;SEXE;CODE_CEPE` | `CEPE2027-00001;COULIBALY;Ibrahim;11/04/2015;…;M;CEPE-COCO-0001` (nom en majuscules, date jj/mm/aaaa, sexe `F` ou `M`) ; 3 lignes |
| `Résultats (format fictif) (CSV, v1) — démonstration` | `NUMERO;NUMERO_OFFICIEL;DECISION;MOYENNE;EP1;EP2;EP3` | `CEPE2027-00001;OFF-COCO-0001;ADMITTED;13,5;14;13;7` ; `…-00002;…;FAILED;8,75;9;8;5` ; `…-00003;…;ABSENT;;;;` |
✅ Une ligne `LISTE_CANDIDATS_FICTIF v1` (ou `RESULTATS_FICTIF v1`) apparaît dans « Exports réalisés » : état « Terminé », « 3 ligne(s) », empreinte SHA-256, bouton « Télécharger » ; « Actualiser la liste » relit la liste. Aucune cellule commençant par `=`, `+`, `-` ou `@` n'est exécutable (neutralisation de formule).
⚠️ Le téléchargement exige le stockage d'objets branché (à vérifier). Le format « statistiques » (champ « Regroupement des statistiques ») n'est pas livré, ni XLSX/JSON.


### « Corrections d'examen » — `/v2/examinations/corrections`
**En une ligne :** reçoit les demandes de correction d'une note ou d'un résultat déjà arrêté, avec un motif, et les fait approuver ou rejeter par une AUTRE personne (règle des quatre yeux).
**Compte :** le propriétaire `direction.generale@` demande, le directeur `directeur@` approuve ou rejette (puis l'inverse si l'on veut) · **Avant :** résultats publiés (session « Résultats publiés ») pour la correction d'un résultat ; une note existante pour la correction d'une note.

**Bloc « Nouvelle demande de correction »** (propriétaire, dans cet ordre), puis « Envoyer la demande »
| Champ (libellé exact) | Demande 1 : une note | Demande 2 : un résultat | Demande 3 : un résultat (à rejeter) |
| :--- | :--- | :--- | :--- |
| Objet de la correction | « Une note » | « Un résultat » | « Un résultat » |
| Candidat | `N'GUESSAN Kouamé` | (champ absent) | (champ absent) |
| Épreuve | `EP2 — Épreuve 2 (fictive)` | (champ absent) | (champ absent) |
| État proposé | « Saisie » | (champ absent) | (champ absent) |
| Note proposée | `11` | (champ absent) | (champ absent) |
| Résultat concerné | (champ absent) | `N'GUESSAN Kouamé — Refusé` | `COULIBALY Ibrahim — Admis` |
| Résultat proposé | (champ absent) | « Admis » | « Admis » |
| Moyenne proposée | (champ absent) | `10,25` | `14` |
| Motif | `Erreur de report de la note de l'épreuve 2 constatée à la relecture des copies (démonstration).` | `Moyenne recalculée après correction de la note de l'épreuve 2, vérifiée au procès-verbal fictif.` | `Demande d'essai : moyenne contestée sans pièce justificative.` |
✅ « Demande envoyée : une autre personne doit l'approuver. » ; carte « Note — CEPE2027-00002 » (ou « Résultat — … ») avec pastille « En attente », « Valeur actuelle » et « Valeur proposée » ; pas de bouton « Approuver » pour le demandeur. Le propriétaire n'a aucun bouton de décision sur ses propres demandes.

**Décisions (directeur, carte de la demande)**
| Demande | Action | Champ | Valeur à saisir |
| :--- | :--- | :--- | :--- |
| 1 (note) | « Approuver » | (aucun) | (aucun) |
| 2 (résultat) | « Approuver » | (aucun) | (aucun) |
| 3 (résultat) | « Rejeter » > fenêtre « Rejeter la demande » | Motif du rejet | `Moyenne conforme au procès-verbal.` |
✅ Demande 1 : filtre « Approuvées », EP2 de Kouamé = `11` (grille « Notes par épreuve »). Demande 2 : résultat de Kouamé « Admis », moyenne `10,25`, toujours « Publié » ; `Relevé de notes v1` de Kouamé révoqué (voir « Exports d'examen »). Demande 3 : filtre « Rejetées », « Décision : Moyenne conforme au procès-verbal. », résultat de Ibrahim inchangé (`13,5`). Ordre : demande 1 avant la demande 2.
⚠️ Refus attendus : le demandeur qui clique « Approuver » sur sa propre demande reçoit « Une révision est approuvée par une autre personne que celle qui l'a demandée. » ; une seconde demande sur la même cible en attente : « Une demande de révision est déjà en attente pour cette cible. » ; valeur identique : « La valeur proposée est identique à la valeur actuelle. » ; motif de moins de 10 caractères : « Au moins 10 caractères. » ; correction d'un résultat non publié : « Un résultat non publié se saisit directement : aucune révision nécessaire. » ; modifier directement une note après la clôture des notes : « une note saisie après clôture ne se corrige que par une révision approuvée ». Les valeurs « actuelle » et « proposée » peuvent s'afficher avec des clés techniques (`toCode`, `toAverage`, `toScore`) : écart de présentation connu.


### « Examens de mes enfants » — `/v2/examinations/family`
**En une ligne :** montre au parent (menu « Mon examen » pour l'élève) l'inscription, la place, l'issue publiée et les documents d'examen de son enfant, sans note ni moyenne.
**Compte :** un compte parent (tuteur) lié à l'élève · **Avant :** session officielle avec convocations et résultats publiés.
✅ Pour COULIBALY Awa (mère de COULIBALY Ibrahim), si un compte parent existe : carte « COULIBALY Ibrahim — CEPE (données fictives de démonstration) 2027 », numéro `CEPE2027-00001`, début des épreuves `14/06/2027`, place `Centre de l'école Les Cocotiers, salle S1, place 1`, « Résultat : Admis », documents « Convocation », « Attestation de réussite », « Relevé de notes » avec « Télécharger ». Aucune note ni moyenne n'est affichée ; la session blanche n'y figure pas.
⚠️ Aucun compte parent ni élève n'existe dans l'école neuve : écran non jouable tant que les comptes de tuteurs ne sont pas créés (groupe des portails). Le menu est hors du menu du propriétaire.


---

## Partie 13 — Accès, pilotage et audit

Ordre conseillé de saisie : A. comptes et accès, puis B. Pilotage (les écrans de lecture se lisent mieux une fois élèves, classes, appels, factures saisis dans les autres fragments), puis C. Journal d'audit (il garde la trace de tout ce qui précède). Les routes réelles sont les `/v2/...` ; les `href` `/admin/...` du fichier de navigation sont d'anciens chemins. Compte utilisé partout sauf mention : **propriétaire** `direction.generale@ecole-cocotiers.test` (MFA : « Afficher le code MFA » sur `/v2/login`). Pendant le chargement d'un écran, un message transitoire « non inclus dans l'offre » peut s'afficher quelques secondes : c'est normal.


**A. Comptes, utilisateurs, rôles, attributions**

### Comptes de l'école : ce qui existe et ce que l'interface permet d'ajouter

| Rôle | E-mail | État | Comment l'obtenir |
| :--- | :--- | :--- | :--- |
| Propriétaire | `direction.generale@ecole-cocotiers.test` | existe (MFA) | `pnpm dev:v2:new-school` |
| Directeur | `directeur@ecole-cocotiers.test` | existe (MFA) | `pnpm dev:v2:add-account` (rôle par défaut `directeur`) |
| Responsable pédagogique | `pedagogie@ecole-cocotiers.test` | à créer | PowerShell : `$env:DEVV2_ACCOUNT_ROLE="responsable_pedagogique"; pnpm dev:v2:add-account` (bash : `DEVV2_ACCOUNT_ROLE=responsable_pedagogique pnpm dev:v2:add-account`) |
| Instituteur, Secrétariat, Économe, Parent, Élève, Directeur des études | aucun | impossibles à connecter | voir ⚠️ ci-dessous |

⚠️ `scripts/dev-v2/add-account.ts` ne connaît que deux rôles (`directeur`, `responsable_pedagogique`) : tout autre `DEVV2_ACCOUNT_ROLE` est refusé (« Rôle non pris en charge »). Le compte créé est invité, activé, enrôlé en MFA (le secret est écrit dans `.dev-v2/credentials.json`, le panneau « Comptes par tenant » de `/v2/login` l'affiche) ; relancer la commande pour un compte déjà présent ne fait rien. Le responsable pédagogique n'a AUCUNE permission `analytics.*` : il ne voit pas le menu Pilotage, il sert seulement aux contrôles de droits.
⚠️ Depuis l'interface, une invitation (écran « Utilisateurs », ou bouton « Inviter au portail » des fiches Personnel, Élève, Tuteur) crée l'accès et attribue le rôle, mais **aucun e-mail n'est envoyé en développement** (pas de SMTP : le serveur journalise « invitation NON envoyée » sans le jeton). La personne n'a donc jamais de mot de passe et ne peut pas se connecter ; « Mot de passe oublié » ne change rien (même absence d'envoi). Seuls le propriétaire, le directeur et (via la commande) le responsable pédagogique sont utilisables. Pour jouer les parcours instituteur, secrétariat, économe, parent, élève, il faut soit étendre la table `ROLES` de `add-account.ts` (rôles système `instituteur`, `secretariat`, `econome`, `parent`, `eleve`), soit brancher un SMTP local (variables `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, `V2_APP_BASE_URL=http://localhost:3000`) : non vérifié. Tant que ce n'est pas fait, tout geste « avec le compte X » du guide est différé.
⚠️ Un compte instituteur devra aussi être relié à une fiche de Personnel pour saisir des compétences (« Un compte sans fiche de personnel ne saisit pas d'évaluation »).

### « Utilisateurs » — `/v2/admin/members`
**En une ligne :** liste les personnes qui ont accès à l'école et permet d'en inviter, de suspendre un accès, de fermer des sessions ou de réinitialiser une MFA.
**Compte :** propriétaire (le directeur voit la même liste) · **Avant :** rien (2 lignes au départ : propriétaire et directeur).

**Écran « Membres de l'établissement » — formulaire « Adresse e-mail à inviter »** : inviter les comptes de test
| Adresse e-mail à inviter | Rôle (liste « Rôle ») | Rôles système attribués automatiquement | Usage dans le guide |
| :--- | :--- | :--- | :--- |
| `prisca.kouadio@ecole-cocotiers.test` | « Enseignant » | Enseignant | future secrétaire-comptable : on lui ajoute le rôle personnalisé plus bas |
| `invite.parent@exemple.test` | « Parent » | Parent | test d'attribution et de suspension |
| `invite.eleve@exemple.test` | « Élève / étudiant » | Élève | idem |
| `invite.admin@ecole-cocotiers.test` | « Administrateur » | Directeur + Secrétariat + Économe | contrôle de l'anti-escalade et du journal |
Les rôles proposés sont seulement ces quatre ; « Instituteur », « Secrétariat » seul, « Économe » seul n'y figurent pas (les ajouter ensuite dans « Attributions de rôles »).
✅ Bouton « Inviter » puis message « Invitation envoyée. La personne définit son mot de passe depuis le lien reçu par e-mail. » (le lien n'existe pas : voir ⚠️ ci-dessus) ; la personne apparaît aussitôt avec le statut « Actif » et ses rôles entre virgules (par exemple `teacher`).
⚠️ Refus et pièges : « Inviter » reste inactif si l'adresse est vide ; `pas-un-email` donne « Une erreur est survenue. Réessayez. » ; réinviter `directeur@ecole-cocotiers.test` donne le même message générique (la page ne dit pas que la personne est déjà membre). Si le message devient « Invitation envoyée, mais les droits n'ont pas pu être attribués automatiquement : attribuez le rôle depuis la gestion des rôles. », attribuer le rôle à la main (écran « Attributions de rôles »).

**Boutons de ligne** : « Suspendre » (sur `invite.parent@exemple.test` : « Accès de invite.parent@exemple.test suspendu. », statut « Suspendu »), puis « Rétablir » (« Accès de invite.parent@exemple.test rétabli. »), « Révoquer les sessions » (« 0 session(s) révoquée(s). » : personne n'est connectée), « Réinitialiser la MFA » (n'apparaît que si « · 2 étapes » est affiché).
⚠️ Ne PAS suspendre ni réinitialiser la MFA du propriétaire ni du directeur : « Suspendre » sur sa propre ligne est refusé (« Action non autorisée. »), et réinitialiser la MFA d'un compte de départ rendrait le code automatique du panneau inutilisable.

### « Rôles et permissions » — `/v2/access/roles`
**En une ligne :** catalogue des rôles de l'école (rôles système verrouillés et rôles personnalisés) avec leurs permissions ; seul le propriétaire peut en créer, cloner, modifier ou supprimer.
**Compte :** propriétaire avec session MFA (le directeur lit seulement) · **Avant :** rien.

**Bouton « Cloner » (ligne « Secrétariat »)** — fenêtre « Cloner le rôle »
| Champ (libellé exact) | Valeur à saisir |
| :--- | :--- |
| Libellé du nouveau rôle | `Secrétariat de l'école (copie)` |
| Clé technique | `secretariat_ecole` |
| Description | `Copie du rôle Secrétariat pour l'école Les Cocotiers` |
✅ « Créer le clone » : message « Rôle « Secrétariat de l'école (copie) » créé. », ouverture du nouveau rôle (type « Personnalisé », même nombre de permissions que « Secrétariat », texte « Ce rôle est un clone d'un autre rôle. »).
⚠️ Refus : libellé vide « obligatoire » ; clé `Secretariat-Ecole` refusée (minuscules, chiffres et « _ » seulement) ; `secretariat_ecole` une seconde fois : « Un rôle utilise déjà cette clé. Choisissez-en une autre. » ; clé `owner` : refus « réservée à un modèle système ». Une fiche de rôle système (ex. « Instituteur ») affiche « Rôle système verrouillé » et aucun bouton d'enregistrement.

**Bouton « Nouveau rôle »** (`/v2/access/roles/new`) : le rôle métier de l'école
| Champ (libellé exact) | Valeur à saisir |
| :--- | :--- |
| Libellé | `Secrétaire-comptable de l'école` |
| Clé technique | `secretaire_comptable` |
| Description | `Dossiers élèves en lecture, facturation, encaissements et caisse ; aucune annulation ni remboursement` |
Dans la grille « Permissions du rôle », saisir la clé dans « Rechercher une permission » (la recherche porte sur la clé, le libellé et la description) et cocher exactement ces 20 permissions (le décompte final doit dire « 20 permissions sélectionnées »)
| Clé | Libellé affiché |
| :--- | :--- |
| `tenancy.institution.read` | Consulter l'organisation et les établissements |
| `academic.classroom.read` | Consulter les classes et les offres |
| `student.list` | Lister les élèves |
| `student.read` | Consulter la fiche d'un élève |
| `guardian.read` | Consulter les tuteurs et leurs liens |
| `enrollment.read` | Consulter les inscriptions |
| `finance.fee.read` | Consulter le catalogue de frais, les barèmes et les remises |
| `finance.invoice.read` | Consulter les factures, les échéanciers et les relevés d'apprenants |
| `finance.invoice.create` | Créer et émettre des factures, générer des échéanciers |
| `finance.payment.read` | Consulter les paiements et les remboursements |
| `finance.payment.create` | Enregistrer un paiement, initier un paiement en ligne, imputer un paiement |
| `finance.receipt.read` | Consulter et réimprimer les reçus |
| `finance.cashregister.open` | Ouvrir une session de caisse et encaisser des espèces |
| `finance.cashregister.close` | Clôturer une session de caisse (comptage et écart) |
| `finance.report.read` | Consulter les tableaux de bord et rapports financiers |
| `documents.read` | Lire les documents de niveau interne (règlement, programmes, circulaires) |
| `documents.upload` | Déposer des documents et de nouvelles versions |
| `messaging.read` | Lire sa boîte de messagerie, ses annonces et ses notifications (personnel) |
| `messaging.send` | Écrire au personnel, aux élèves et tuteurs de ses classes, à l'administration |
| `notifications.own.manage` | Gérer mes préférences de notification et mes appareils (personnel) |
✅ « Créer le rôle » : « Rôle « Secrétaire-comptable de l'école » créé. », arrivée sur la fiche (« Clé : secretaire_comptable », type « Personnalisé », « Non attribué »). Aucune des 20 ne porte l'étiquette « Sensible · MFA » (à confirmer à l'écran) ; volontairement exclues : `finance.invoice.cancel` (avoirs), `finance.payment.refund` (remboursement, sensible), `finance.payment.reconcile`, `finance.provider.manage`.
**Fiche du rôle, modification** : cocher en plus `finance.invoice.cancel` (« Annuler une facture ou émettre un avoir ») : « 1 permission ajoutée », « Enregistrer les modifications » : « Rôle enregistré. » ; la décocher : « 1 permission retirée » puis « Enregistrer les modifications ». Changer la Description en `Dossiers élèves en lecture, facturation, encaissements et caisse (version 2)`.
⚠️ Refus : « Libellé » vide : « Le libellé est obligatoire. » ; clé `Secrétaire Comptable` : texte « Minuscules, chiffres et « _ » uniquement (2 à 63 caractères, commence par une lettre). » ; recherche `zzz` : « Aucune permission ne correspond à cette recherche. » ; supprimer le rôle tant qu'il est attribué : « Ce rôle est encore attribué à des utilisateurs. Retirez d'abord ses attributions. » ; le directeur n'a ni « Nouveau rôle » ni « Cloner » (s'il tape `/v2/access/roles/new`, la page s'ouvre mais l'enregistrement est refusé par le serveur). Anti-escalade : le propriétaire détient tout, donc rien ne lui est refusé ici.

### « Attributions de rôles » — `/v2/access/assignments`
**En une ligne :** donne ou retire un rôle à un utilisateur, sur tout l'établissement, un établissement ou un campus, avec une période de validité facultative.
**Compte :** propriétaire ou directeur (`rbac.assignment.manage`) · **Avant :** utilisateurs invités et rôle « Secrétaire-comptable de l'école » créés ci-dessus.

**Bloc « Nouvelle attribution »**
| Utilisateur | Rôle | Périmètre | Valide à partir du | Valide jusqu'au |
| :--- | :--- | :--- | :--- | :--- |
| `prisca.kouadio@ecole-cocotiers.test` | Secrétaire-comptable de l'école | « Tout l'établissement » | vide | vide |
| `directeur@ecole-cocotiers.test` | Secrétariat de l'école (copie) | « Tout l'établissement » | `09/10/2026 00:00` | `31/12/2026 23:59` |
| `invite.admin@ecole-cocotiers.test` | Instituteur (second rôle, pour tester le cumul) | « Tout l’établissement » | vide | vide |
(les champs de date sont des sélecteurs « date et heure » ; le menu « Utilisateur » liste les adresses e-mail des membres)
✅ « Attribuer le rôle » : « Rôle attribué. » et une ligne « Active » (colonnes « Utilisateur », « Rôle », « Périmètre », « Validité » = « Sans limite » ou « du 09/10/2026 au 31/12/2026 », « Statut »). Les filtres « Filtrer par utilisateur » et « Filtrer par rôle » (valeur « Tous ») isolent les lignes ; filtrer le rôle sur « Propriétaire » montre une seule ligne, `direction.generale@ecole-cocotiers.test`, « Sans limite », « Active ».
**Crayon « Modifier la validité de l'attribution de … »** (fenêtre « Modifier la validité ») : sur la deuxième ligne, mettre « Valide jusqu'au » = `30/11/2026 23:59`, « Enregistrer » : « Validité mise à jour. » ; vider les deux champs pour retirer la limite.
**Icône « Révoquer l'attribution de … »** (fenêtre « Révoquer cette attribution ? ») : révoquer les lignes 2 et 3, bouton « Révoquer » : « Attribution révoquée. ». Révoquer ensuite la ligne « Enseignant » de `prisca.kouadio@…` (le rôle « Secrétaire-comptable » reste son seul rôle), puis seulement supprimer au besoin les rôles personnalisés inutiles.
⚠️ Refus à provoquer : rien choisi : « Choisissez un utilisateur. » et « Choisissez un rôle. » ; « Valide jusqu'au » avant « Valide à partir du » : « La fin de validité doit suivre le début. » ; « Valide jusqu'au » = `08/10/2026 00:00` : refus du serveur (fin déjà passée) ; **garde-fou du dernier propriétaire** : filtrer sur « Propriétaire », « Révoquer l'attribution de Propriétaire » sur la ligne `direction.generale@…` puis « Révoquer » : « Action refusée : l'établissement doit toujours conserver au moins un propriétaire. », rien n'est révoqué (même refus si on lui met une fin de validité immédiate). **Anti-escalade** : seul un compte qui ne détient pas toutes les permissions d'un rôle se voit refuser son attribution ; le propriétaire et le directeur (droit `*`) ne peuvent pas la tester ici (il faudrait un compte à droits réduits : voir ⚠️ de la section Comptes). Une étape peut demander « Confirmez votre identité » (code MFA du moment, un code ne sert qu'une fois : attendre le suivant).


**B. Pilotage de la direction (14 menus de lecture)**

Tous gardés par la fonction `analytics.direction` (incluse dans le pack Primaire et le plan Professional) ; la nav montre les 13 écrans du module Pilotage et un 14e, « Masse salariale » du module Paie. Chiffres attendus avec le jeu commun, **une fois les 9 élèves inscrits** (inscriptions « Active » : 3 en Grande Section A, 3 en CP1 A, 3 en CM2 A). Après toute saisie dans un autre menu, les tableaux se rafraîchissent par le worker (30 secondes à 2 minutes) : recharger la page, lire la ligne « Données au … » et au besoin demander « Reconstruire depuis les sources » (voir l'annexe Fraîcheur). Une valeur impossible à calculer s'affiche « Non mesuré », jamais zéro.

### « Tableau de bord » — `/v2/direction`
**En une ligne :** page d'accueil de la direction : effectifs, présence du jour, résultats, personnel, scolarité et créances en cartes.
**Compte :** propriétaire ou directeur · **Avant :** élèves et inscriptions (menus Élèves, Inscriptions) ; appels (Présences) ; factures et paiements (Finance) pour le bloc financier.
**Données à saisir ici :** aucune. Seul le filtre « Année scolaire » (valeur « Année en cours », ne pas changer ; une seule année existe).
✅ « Élèves en scolarité » = `9` (détail « 9 inscription(s) au total · 3 classe(s) ») ; « Présence aujourd'hui » : « Non mesuré » tant qu'aucun appel du 09/10/2026 n'est soumis, sinon présents/pointages de ce jour (ex. un seul appel GS-A avec ASSI Brice absent : 2 présents sur 3, soit environ 67 %) ; « Moyenne générale » et « Taux de validation » : « Non mesuré » (le primaire est évalué par compétences, aucun résultat chiffré clôturé) ; « Enseignants et personnel présents » : « Non mesuré » sans pointage du personnel ; bloc « Scolarité et créances » : « Scolarité recouvrée », « Encaissé », « Créances (restant dû) » à zéro/« Non mesuré » tant que Facturation et Encaissements sont vides, sinon recoupés avec ces menus. Liens « Aller plus loin » : Effectifs et présences, Pédagogie, Scolarité, Trésorerie, Masse salariale, Charges et résultat.
⚠️ Menu peu significatif côté résultats pour le primaire (cartes « Moyenne générale » et « Taux de validation ») : « Non mesuré » est le comportement attendu.

### « Indicateurs de direction » — `/v2/analytics`
**En une ligne :** vue d'ensemble transverse en huit blocs (effectifs, assiduité, résultats par période, recouvrement, admissions, vie scolaire, alertes, charge de paie), sans aucune donnée nominative.
**Compte :** propriétaire ou directeur · **Avant :** mêmes sources que le tableau de bord.
**Données à saisir :** aucune ; cliquer « Afficher la masse salariale » dans « Charge de paie » (lecture sensible et auditée, code MFA du moment si « Confirmez votre identité » apparaît).
✅ « Effectifs et inscriptions » : « Élèves en scolarité » `9`, « Inscriptions créées » `9`, « dont 0 annulée(s) » ; « Assiduité » : « Non mesuré » sans appel ; « Résultats par période » : « Aucune période n'a encore de résultats clôturés. » ; « Admissions » : zéro/« Non mesuré » sans campagne ; « Vie scolaire (agrégée) » : comptages à zéro ou « Non mesuré » ; « Alertes de direction » : compteurs « Alertes ouvertes » etc. (voir plus bas) ; « Charge de paie » : « Aucune période de paie. » tant que le menu Paie est vide.

### « Effectifs et présences » — `/v2/direction/effectifs`
**En une ligne :** répartition des inscriptions (sexe, niveau, financement, statut), effectifs par classe, admissions confirmées et assiduité sur une fenêtre de dates.
**Compte :** propriétaire ou directeur · **Avant :** inscriptions des 9 élèves ; appels pour la présence.
**Fenêtre « Fenêtre d'observation » (bloc « Présences et assiduité »)**
| Champ (libellé exact) | Valeur à saisir |
| :--- | :--- |
| Du | `07/09/2026` |
| Au | `09/10/2026` |
(vides = les 30 derniers jours ; essai invalide : « Du » `09/10/2026` et « Au » `07/09/2026` → aucune donnée ou erreur de l'API)
✅ Cartes : « Élèves en scolarité » `9` ("9 inscription(s) tous statuts confondus"), « Redoublants » `0`, « Part de redoublants » `0 %`. « Répartition des inscriptions » : « Par sexe » Garçons `4`, Filles `5` ; « Par niveau » Grande Section `3`, CP1 `3`, CM2 `3` ; « Par type de financement » « Famille » `9` (c'est le libellé d'analytics pour le financement « Privé » saisi à l'inscription) ; « Par statut d'inscription » « Active » `9` ; chaque ligne affiche « Inscriptions » puis « Dont en scolarité ». Tableau « Effectifs par classe » : Grande Section A `3` (Filles 2, Garçons 1), CP1 A `3` (2 / 1), CM2 A `3` (1 / 2). « Admissions et inscriptions confirmées » : « Inscriptions créées » `9`, « Inscriptions confirmées » et « Taux de confirmation » attendus `9` et `100 %` (à vérifier : la politique « Automatique » met le statut « Active »), « Inscriptions par origine » : « Saisie manuelle » `6`, « Import » `3` ; graphique « Inscriptions créées par mois » : 9 en octobre 2026 si toutes saisies le 09/10/2026. « Présences et assiduité » : « Taux de présence » = présents/pointages du 07/09 au 09/10 ; sans appel : « Aucun appel soumis sur ce périmètre. » ; « Présence du personnel par jour » : « La présence du personnel n'est pas mesurée sur cette fenêtre. ».
✅ Bouton « Exporter (CSV) » (propriétaire/directeur) : fichiers `analytics-enrollment-by-classroom.csv` et `analytics-attendance-by-classroom.csv`, séparateur `;`, sans nom d'élève, chaque export laisse une entrée dans le Journal d'audit.

### « Admissions » — `/v2/analytics/admissions`
**En une ligne :** entonnoir des candidatures par statut et par étape, campagne par campagne, en comptages sans nom de candidat.
**Compte :** propriétaire ou directeur · **Avant :** une campagne et des dossiers dans les menus « Campagnes d'admission » et « Candidatures » (autre fragment) ; les 9 élèves du jeu commun ont été créés à la main ou importés, pas par admission.
**Données à saisir ici :** aucune.
✅ Sans campagne : « Aucune campagne d'admission lue pour ce périmètre. ». Avec une campagne et des dossiers : cartes « Dossiers déposés », « Acceptés (dont inscrits) », « Inscrits », « Taux d'acceptation », « Taux d'inscription », « Places offertes » (« n place(s) restante(s) »), répartition « Par statut » (« Brouillon », « Déposé », « En étude », « Pièce manquante », « Accepté », « Refusé », « Liste d'attente », « Inscrit ») recoupée avec la liste des candidatures. Le compte peut être celui du directeur ou, une fois créé, du chargé d'admissions.

### « Vie scolaire (agrégée) » — `/v2/analytics/vie-scolaire`
**En une ligne :** quatre comptages (incidents ouverts, mesures à valider, exclusions en cours, convocations à tenir), sans nom ni motif.
**Compte :** propriétaire ou directeur · **Avant :** le module Vie scolaire (hors pack Primaire).
**Données à saisir ici :** aucune.
⚠️ Le module « Vie scolaire » n'est pas dans le pack Primaire (menus absents) : les quatre cartes « Incidents ouverts », « Mesures à valider », « Exclusions en cours », « Convocations à tenir » restent à `0` ou « Non mesuré », sans erreur. Menu peu pertinent pour cette école ; inutile d'y créer des règles d'alerte.

### « Pédagogie » — `/v2/owner/pedagogie`
**En une ligne :** résultats clôturés par période (moyennes, validation, décisions, distribution) et charge d'enseignement par enseignant.
**Compte :** propriétaire ou directeur · **Avant :** résultats clôturés (menu « Périodes : verrouillage et clôture »), affectations des enseignants (menu « Affectations »).
**Filtres** : « Année scolaire » = « Année en cours », « Période » = « Dernière période clôturée », « Classe » = « Toutes les classes » ; essai : « Classe » = `CP1 A`.
✅ Sans résultat clôturé : « Aucun résultat clôturé pour ce périmètre. » (cartes « Moyenne générale », « Taux de validation », « Résultats clôturés », « Classes clôturées » à « Non mesuré » ; bandeau « Règles de démonstration » si une période est clôturée) ; « Résultats par matière et unité » : « Aucune matière mesurée. ». Bloc « Charge d'enseignement » : si les 3 affectations d'enseignement existent (KOFFI Adjoua, BAMBA Séraphin, ZOKORA Sylvie), `3 enseignant(s)` et leurs « Heures prévues » ; sinon « Aucune affectation d'enseignement pour cette année. ».
⚠️ Le primaire évalue par compétences (menu « Compétences » du Pack Primaire), non repris dans ce tableau : ce menu n'a d'intérêt que pour la charge d'enseignement.

### « Scolarité » — `/v2/owner/scolarite`
**En une ligne :** facturé, encaissé, restant dû et taux de recouvrement de la scolarité, par classe et par apprenant.
**Compte :** propriétaire ou directeur · **Avant :** « Frais et barèmes », « Facturation », « Encaissements » (fragments Finance).
**Filtres et regroupement** : « Regrouper par » = « Classe » puis « Apprenant » ; case « Seulement les restes dus » cochée puis décochée.
✅ Sans facture : « Aucune facture sur ce périmètre. » ; avec factures : « Facturé » (« n facture(s) »), « Avoirs », « Encaissé », « Restant dû », « En retard », « Paiements non imputés » égaux aux totaux de « Facturation » et « Encaissements » ; « Taux de recouvrement » = encaissé / facturé net, avec état « Bon » (80 % et plus), « À surveiller » (60 % et plus) ou « Critique ». Le regroupement « Apprenant » affiche les noms des 9 élèves (donnée nominative).
✅ « Exporter (CSV) » : `analytics-receivables-by-classroom.csv` / `analytics-receivables-by-learner.csv`.

### « Trésorerie » — `/v2/owner/tresorerie`
**En une ligne :** encaissements nets des remboursements, créances âgées par ancienneté et écarts des sessions de caisse.
**Compte :** propriétaire ou directeur · **Avant :** « Encaissements », « Caisse » (sessions ouvertes et clôturées).
**Bloc « Encaissements »**
| Champ (libellé exact) | Valeur à saisir |
| :--- | :--- |
| Du | `07/09/2026` |
| Au | `09/10/2026` |
| Regroupement | « Par semaine » (essayer aussi « Par jour », « Par mois ») |
✅ « Encaissé », « Remboursé », « Net » (= encaissé − remboursé), « Paiements » ; « Créances âgées » : « Non échu », « 1 à 30 jours », « 31 à 60 jours », « 61 à 90 jours », « Plus de 90 jours » (sans facture : « Aucune créance âgée. ») ; « Écarts de caisse » : « Aucune session de caisse. » tant que « Caisse » n'a pas ouvert/clôturé de session, sinon « Sessions clôturées », « Sessions avec écart », « Écart net » ; fenêtre sans encaissement : « Aucune donnée sur ce périmètre. ».

### « Masse salariale » (Pilotage) — `/v2/owner/paie`
**En une ligne :** masse salariale par période de paie (bulletins calculés, arrêtés, payés ; annulés et contestés à part), donnée sensible lue sous MFA et journalisée.
**Compte :** propriétaire ou directeur avec session MFA · **Avant :** une période de paie préparée et calculée dans « Bulletins de paie » / « Configuration de la paie » (fragment Paie).
**Données à saisir ici :** aucune ; si « Confirmez votre identité » s'affiche, saisir le code MFA du moment (un code déjà utilisé est refusé : « Code invalide. Vérifiez l'heure de votre téléphone, puis attendez le prochain code. »).
✅ Sans période : « Aucune période de paie. » ; avec : « Masse comptée » (« n bulletin(s) calculés, arrêtés ou payés »), « Périodes de paie » et le tableau « Masse salariale par période de paie » (colonnes « Période », « Masse comptée », « Bulletins », « Par statut » = « Calculé », « Arrêté », « Payé », « Contesté », « Annulé »). Chaque consultation laisse une entrée `analytics.payroll.read` dans le Journal d'audit.

### « Masse salariale » (validation propriétaire) — `/v2/payroll/owner` (ancien lien `/owner/masse-salariale`)
**En une ligne :** même total par période, avec en plus la liste des bulletins « calculés » que le propriétaire peut valider (arrêter) au-delà du seuil.
**Compte :** propriétaire · **Avant :** bulletins de paie calculés (fragment Paie).
**Données à saisir ici :** aucune ; bouton « Bulletins à valider » puis « Valider » sur un bulletin (« Le bulletin est validé. »), sinon « Aucun bulletin calculé à valider. ».
✅ Total « Masse salariale comptée » (« n bulletin(s) compté(s) (hors annulés et contestés) ») ; sans période : « Aucune période ». Fonction `payroll.owner-validation` incluse dans le pack.

### « Charges et résultat » — `/v2/owner/charges`
**En une ligne :** devait présenter charges d'exploitation, compte de résultat et marges ; aujourd'hui il annonce seulement que ce module de charges n'existe pas.
**Compte :** propriétaire ou directeur · **Avant :** rien.
**Écran :** aucun formulaire. Message d'avertissement « Module de charges absent » suivi du message de l'API, puis la liste « Ce qui n'est pas mesuré » : « Charges d'exploitation par famille et par établissement », « Compte de résultat (produits moins charges) », « Marge par filière ou par classe », « Rétention et coût par élève ». Aucun montant à zéro n'est inventé.
⚠️ **Impossible depuis l'interface** : l'application ne propose aucune saisie de charges de fonctionnement (ni ce menu, ni un autre : pas de module de comptabilité). À titre de donnée de réserve, pour le jour où ce module existera, charges mensuelles type de l'école, octobre 2026 (FCFA) :
| Charge | Montant |
| :--- | :--- |
| Électricité (CIE) | `85000` |
| Eau (SODECI) | `18000` |
| Fournitures de classe et papeterie | `60000` |
| Internet et téléphone | `35000` |
| Entretien et nettoyage | `40000` |
| Loyer des locaux | `450000` |
Total `688000` FCFA. La masse salariale et les encaissements, eux, se lisent déjà dans « Masse salariale » et « Trésorerie ».

### « Comparaisons » — `/v2/analytics/comparaisons`
**En une ligne :** compare un indicateur (effectifs, assiduité, résultats, recouvrement) entre deux années, deux périodes ou deux fenêtres de dates, avec écart et variation.
**Compte :** propriétaire ou directeur · **Avant :** données des menus sources ; une seule année existe, donc les comparaisons entre années sont des auto-comparaisons.
**Formulaire « Choix de la comparaison »** : une comparaison par ligne (choisir d'abord la liste « Indicateur »)
| Indicateur | Référence | Comparée | Résultat attendu |
| :--- | :--- | :--- | :--- |
| « Effectifs » | « Année de référence » = 2026-2027 | « Année comparée » = 2026-2027 | « Élèves en scolarité » `9` / `9`, écart nul ; « Inscriptions (tous statuts) » `9` / `9` |
| « Assiduité » | « Référence : du » `07/09/2026`, « Référence : au » `08/10/2026` | « Comparée : du » `09/10/2026`, « Comparée : au » `09/10/2026` | « Non mesuré » côté référence (aucun appel avant le 09/10), taux du jour côté comparé, écart « Non mesuré » |
| « Résultats » | « Période de référence » = 2026-2027 — Trimestre 1 | « Période comparée » = 2026-2027 — Trimestre 2 | « Non mesuré » des deux côtés (aucun résultat clôturé) |
| « Recouvrement » | « Année de référence » = 2026-2027 | « Année comparée » = 2026-2027 | écart nul ; variation « — » si la référence est nulle |
✅ Tableau « Comparaison » (colonnes « Indicateur », « Référence », « Comparée », « Écart », « Variation ») et note « L'écart est « comparée moins référence »… ». Avant tout choix : « Choisissez les deux côtés de la comparaison pour l'afficher. ».
⚠️ Dates inversées (« Référence : du » `08/10/2026`, « Référence : au » `07/09/2026`) : le tableau ne s'affiche pas.

### « Règles d'alerte » — `/v2/analytics/alertes/regles`
**En une ligne :** définit, pour chaque indicateur, les deux seuils (attention, critique), les rôles prévenus et la fréquence maximale des rappels.
**Compte :** propriétaire ou directeur (création et modification : `analytics.alerts.manage`) · **Avant :** rien ; la liste part vide (« Aucune règle d'alerte n'est configurée. »), le worker doit tourner (évaluation toutes les 15 minutes).
**Bouton « Nouvelle règle »** (formulaire « Nouvelle règle d'alerte ») : une ligne par règle
| Nom de la règle | Indicateur surveillé | Seuil d'attention | Seuil critique | Fenêtre (jours) | Fréquence des rappels | Rôles prévenus | Règle active |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `Absences élevées (présence sous 85 %)` | « Taux de présence des élèves » | `85` | `70` | `30` | « Au plus un rappel par semaine » | « Directeur », « Propriétaire » | cochée |
| `Impayés échus élevés` | « Montant des impayés échus » | `100000` | `500000` | (absent) | « Au plus un rappel par jour » | « Directeur » | cochée |
| `Recouvrement de la scolarité bas` | « Taux de recouvrement de la scolarité » | `60` | `30` | (absent) | « Au plus un rappel par jour » | « Directeur », « Propriétaire » | cochée |
| `Effectif minimal Cocotiers` | « Effectif en scolarité » | `10` | `5` | (absent) | « Au plus un rappel par jour » | « Directeur », « Propriétaire » | cochée |
| `Écart de caisse à surveiller` | « Écart de caisse cumulé (valeur absolue) » | `5000` | `20000` | `30` | « Au plus un rappel par semaine » | « Directeur » | cochée |
« Autres rôles (clés séparées par des virgules) » reste vide ; les listes « Établissement » et « Campus » n'apparaissent pas (un seul établissement, un seul campus). Cliquer « Enregistrer la règle » après chaque ligne.
✅ « Règle enregistrée. » ; la ligne affiche par exemple « Attention : sous 85 % », « Critique : sous 70 % », les destinataires, la fréquence, le badge « Active » et « Pas encore évaluée » (jusqu'à 15 minutes, puis « Dans les seuils », « Attention », « Critique », « Non mesuré » ou « Source indisponible ou périmée »). Unités saisies : pourcentage (`85` ou `87,5`) pour un taux, montant entier en francs CFA pour un montant, nombre entier pour un effectif.
⚠️ Pas de règle « taux d'absence > 15 % » ni « impayés de plus de 30 jours » : l'application n'offre que « Taux de présence des élèves » (absence supérieure à 15 % = présence sous 85 %) et « Montant des impayés échus » (impayés échus tout âge confondu, aucun seuil d'ancienneté). Les indicateurs « Taux de validation de la dernière période clôturée », « Incidents de vie scolaire ouverts » et « Mesures de vie scolaire en attente de validation » restent « Non mesuré » dans cette école (ni moyennes ni vie scolaire) : ne pas les créer. Libellé de rôle de la liste : « Responsable des admissions » (ailleurs « Chargé des admissions »).
**Saisies invalides** (aucune règle créée) : nom `ab` : « Le nom doit comporter de 3 à 120 caractères. » ; aucun indicateur : « Choisissez un indicateur. » ; « Taux de présence des élèves », attention `120` : « Un taux est compris entre 0 et 100 %. » ; attention `85`, critique `90` : « Le seuil critique doit être inférieur ou égal au seuil d'attention. » ; « Montant des impayés échus », attention `500000`, critique `100000` : « Le seuil critique doit être supérieur ou égal au seuil d'attention. » ; aucun seuil : « Renseignez au moins un seuil (attention ou critique). » ; seuil `abc` : « Saisissez un nombre valide. » ; fenêtre `0` : « La fenêtre est un nombre de jours entre 1 et 365. » ; tous les rôles décochés ou « Autres rôles » = `Directeur Général` : « Choisissez de 1 à 8 rôles valides. ».
**Bouton « Modifier »** (formulaire « Modifier la règle d'alerte », l'indicateur est grisé) sur `Effectif minimal Cocotiers` : « Seuil d'attention » = `9` (seuil strict : 9 élèves ne passent pas sous 9) puis `10` ; à la fin, décocher « Règle active » pour les règles qu'on ne veut plus voir évaluer (« Désactiver une règle résout son alerte en cours »).

### « Alertes de direction » — `/v2/analytics/alertes`
**En une ligne :** liste les seuils franchis (alertes ouvertes, accusées de réception, résolues) et permet d'accuser réception.
**Compte :** propriétaire ou directeur (`analytics.alerts.acknowledge`) · **Avant :** les règles ci-dessus, au moins un passage de l'évaluation (15 minutes), élèves inscrits.
**Données à lire / saisir**
| Étape | Valeur |
| :--- | :--- |
| Alerte attendue (après ≤ 15 min) | `Effectif minimal Cocotiers` : gravité « Attention », indicateur « Effectif en scolarité », valeur `9`, « sous le seuil de 10 », état « Ouverte » |
| Bouton « Détails » | « Ouverte le », « Dernière constatation », « Données au », « Valeur constatée », « Seuil franchi » ; tableau « Notifications émises pour cette alerte » (motif « Ouverture », rôles « Directeur, Propriétaire ») |
| Bouton « Accuser réception » (panneau « Accuser réception : Effectif minimal Cocotiers ») : champ « Note (facultative) » | `Effectif de la rentrée suivi par la direction (test Cocotiers)` |
| Filtres « État », « Gravité », « Indicateur » | « Ouverte »/« Accusée de réception »/« Résolue » ; « Attention »/« Critique » ; « Effectif en scolarité » |
✅ « Accusé de réception enregistré. » puis état « Accusée de réception » avec la note ; les cartes « Ouvertes », « Accusées de réception », « Résolues » se mettent à jour. Résolution : régler le « Seuil d'attention » de la règle sur `9`, attendre un passage : l'alerte devient « Résolue » (« Résolue le », « Valeur au retour à la normale ») ; le remettre à `10` ouvre une nouvelle alerte. Les autres règles restent « Non mesuré » ou « Dans les seuils » tant que facturation, caisse et appels sont vides : « Aucune alerte pour ces filtres. » est alors correct. Les notifications arrivent dans « Messages » (cloche) du Directeur et du Propriétaire, en canal « Simulé ». Note limitée à 500 caractères, sans donnée d'élève.

### Annexe : Fraîcheur des données — `/v2/owner/fraicheur` (hors menu, accessible par adresse)
**En une ligne :** état de la lecture des sources de pilotage, reconstruction à la demande et seuils d'affichage.
**Compte :** propriétaire ou directeur · **Avant :** rien.
**Section « Seuils de lecture et fraîcheur »** (valeurs de la plateforme par défaut : 80, 60, 85, 70 et 24 ; ne changer que pour l'essai puis rétablir)
| Champ (libellé exact) | Valeur à saisir |
| :--- | :--- |
| Recouvrement : « Bon » à partir de (%) | `80` |
| Recouvrement : « À surveiller » à partir de (%) | `60` |
| Présence : « Bon » à partir de (%) | `85` |
| Présence : « À surveiller » à partir de (%) | `70` |
| Donnée "ancienne" au-delà de (heures) | `24` |
✅ Bouton « Reconstruire depuis les sources » : « La reconstruction est en file : elle sera exécutée par le worker. » ; « Enregistrer les réglages » : « Les réglages sont enregistrés. ». Essais invalides : « À surveiller » `70` avec « Bon » `50` : « Le seuil À surveiller ne peut pas dépasser le seuil Bon. » ; présence `150` : « Saisissez un pourcentage entre 0 et 100 (deux décimales au plus). » ; heures `500` ou `0` : « Saisissez un nombre entier d'heures entre 1 et 168. ». Ces réglages ne changent aucun chiffre, seulement l'étiquette d'état et la mention de péremption.


**C. Journal d'audit**

### « Journal d'audit » — `/v2/audit` (fiche d'une entrée : `/v2/audit/<identifiant>`)
**En une ligne :** historique infalsifiable, chaîné par empreintes, de toutes les actions sensibles de l'école, avec filtres, vérification d'intégrité et export CSV.
**Compte :** propriétaire ou directeur (`audit.read` ; export : `audit.export`, sensible, MFA) · **Avant :** avoir fait des saisies ailleurs (le journal se remplit au fil de l'eau, quelques secondes de latence pour les événements traités par le worker).

**Formulaire « Filtrer le journal »** : filtres à essayer, un par ligne
| Action | Entité | Gravité (cases) | Du | Au | Ce qu'on doit retrouver |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `role.*` | vide | « Avertissement » | vide | vide | `role.changed` (entité `role`) : clonage, création, ajout/retrait de permission du rôle « Secrétaire-comptable de l'école » |
| `assignment.*` | vide | « Avertissement » | vide | vide | `assignment.changed` (entité `role_assignment`) : attributions, validité modifiée, révocations |
| `membership.*` | vide | toutes | vide | vide | accès créés par « Utilisateurs » ; suspension et rétablissement de `invite.parent@exemple.test` |
| `session.*` | vide | « Notable » | vide | vide | `session.revoked` : « Révoquer les sessions » |
| `login.failed` | vide | « Notable » | vide | vide | échecs de connexion (acteur de type « Système ») |
| `mfa.*`, `password.*` | vide | toutes | vide | vide | enrôlements MFA et mots de passe définis à la création des comptes |
| `people.*` | vide | toutes | vide | vide | `people.student.created`, `people.guardian.created`, `people.staff.created`, liens tuteurs (menus Élèves, Parents et tuteurs, Personnel, Imports) |
| `primary_school.*` | vide | toutes | vide | vide | `primary_school.settings.updated`, `primary_school.template.applied`, `primary_school.period.marked_ready`, référentiels et phrases (menus Pack Primaire) |
| `academic.*` | vide | toutes | vide | vide | `academic.template.applied`, `academic.curriculum.published`, `academic.enrollment.override`, `academic.year.rollover` (menus Académique) |
| `finance.*` | vide | toutes | vide | vide | `finance.fee.created`, `finance.invoice.issued`, `finance.payment.completed`, `finance.cash_session.opened` |
| `analytics.*` | vide | toutes | vide | vide | `analytics.alert_rule.create`, `analytics.alert_rule.update`, `analytics.alert.acknowledge`, `analytics.export.download`, `analytics.payroll.read`, `analytics.settings.update` |
| `imports.*`, `attendance.*`, `documents.*`, `messaging.*`, `notifications.*`, `payroll.*` | vide | toutes | vide | vide | traces des menus du même nom (par exemple `attendance.settings.updated`, `imports.job.create`) |
| vide | `role` | toutes | `09/10/2026 00:00` | `09/10/2026 23:59` | seulement les entrées sur des rôles, ce jour |
Cases de gravité : « Information », « Notable », « Avertissement », « Critique » ; boutons « Appliquer les filtres » et « Réinitialiser ». Les actions réellement consignées dépendent des saisies faites ; une saisie sans trace attendue (ex. connexion réussie, simple consultation sans export) n'apparaît pas : la connexion réussie n'est jamais tracée.
✅ Tableau « Entrées du journal d'audit » : colonnes « Date », « Gravité », « Action », « Entité », « Acteur » (identifiant précédé de « Utilisateur »), « Changements » ("1 champ") ; compteur « n entrées chargées » et « Charger plus d'entrées ». Ouvrir une entrée `role.changed` (lien « Voir le détail de l'entrée role.changed ») : « Informations générales » (« Survenue le », « Numéro de séquence », « Acteur », « Adresse IP »), « Changements champ par champ » (« Ajouté », « Retiré », « Modifié » ; colonnes « Avant » et « Après »), « Empreinte » (« Algorithme », « Empreinte », « Empreinte précédente »), les valeurs sensibles en « Valeur masquée ».

**Bloc « Intégrité de la chaîne »**
| Champ (libellé exact) | Valeur à saisir |
| :--- | :--- |
| Portée de la vérification | « Toute la chaîne » (puis « Période des filtres appliqués » après avoir rempli « Du »/« Au ») |
✅ Bouton « Vérifier la chaîne » : « Chaîne intègre » et « n entrées vérifiées (séquences a à b). Aucune anomalie. » (point de départ « début de la chaîne ») ; le bouton devient « Vérifier à nouveau ».

**Bouton « Exporter en CSV »**
| Champ (libellé exact) | Valeur à saisir |
| :--- | :--- |
| Du | `02/10/2026 00:00` |
| Au | `09/10/2026 23:59` |
✅ Fichier `audit-2026-10-09.csv` téléchargé et message « Export terminé : n lignes dans audit-….csv. » ; l'export est lui-même consigné (nouvelle entrée `audit_log.exported`, gravité élevée). Plafonds : 31 jours et 10 000 lignes. Le téléchargement est à faire par une personne (accord du navigateur).
⚠️ Saisies invalides : « Acteur (identifiant) » = `abc` : « Saisissez un identifiant UUID valide. » ; « Entité » = `Role Changed` : « Minuscules, chiffres et « _ » uniquement. » ; « Action » = `Role Changed` : « Format attendu : entité.verbe ou entité.* (minuscules). » ; « Du » après « Au » : « La fin de période doit suivre le début. » ; export sans dates : « L'export exige une période : renseignez les deux dates. » ; export du `01/09/2026` au `09/10/2026` : « La période d'export est limitée à 31 jours. » ; action `role.zzz` : « Aucune entrée ne correspond à ces filtres. » ; adresse `/v2/audit/11111111-1111-4111-8111-111111111111` : « Cette entrée n'existe pas ou n'appartient pas à votre établissement. ». Aucune entrée n'est modifiable ni supprimable. Un profil qui lit sans pouvoir exporter verrait « Exporter en CSV » inactif : indisponible ici faute de compte à droits réduits.


---

## Partie 14 — Portails (enseignant, parent, élève) et actes irréversibles

Les menus ci-dessous n'apparaissent qu'avec un compte instituteur, parent ou élève : ils ne se remplissent pas avec les données du propriétaire. Les données à y saisir sont celles déjà définies dans les sections précédentes ; ce tableau dit seulement ce que fait chaque menu et ce que chaque compte y fait pour la première fois. Les comptes se créent dans « Utilisateurs » (section « Pilotage, accès et audit ») ou avec `pnpm dev:v2:add-account` (rôles `directeur` et `responsable_pedagogique` uniquement).

### Portail enseignant et instituteur (14 menus)
| Menu (portail) | Route | En une ligne | Données à saisir avec ce compte |
| :--- | :--- | :--- | :--- |
| « Aujourd'hui » | `/v2/teacher` | les séances du jour et l'état de l'appel | rien (lecture) |
| « Mes classes » | `/v2/teacher/classes` | les classes où l'enseignant est affecté, avec élèves et gestes rapides | rien (lecture) |
| « Mon emploi du temps » | `/v2/teacher/schedule` | la semaine de cours de l'enseignant | rien (lecture) |
| « Mes rémunérations » | `/v2/teacher/payslips` | ses bulletins de paie arrêtés et versés | contestation éventuelle d'un bulletin (motif libre) |
| « Faire l'appel » | `/v2/teacher/attendance` | l'appel du jour de sa classe (matin et après-midi au primaire) | KOFFI Adjoua : CP1 A, matin KOUASSI Aya absente, après-midi tous présents ; ZOKORA Sylvie : Grande Section A, ASSI Brice absent |
| « Ma classe » | `/v2/primary/classe` | le tableau de bord de la classe du pack Primaire | marquer une période « prête » (motif de retrait de 10 caractères minimum) |
| « Compétences » | `/v2/primary/competences` | la grille de compétences sans note | les niveaux du tableau « Compétences » (section Pack Primaire) |
| « Appréciations » | `/v2/primary/appreciations` | la banque de phrases (lecture seule pour l'instituteur) | composer un texte avec « Ajouter à ma rédaction » |
| « Conseil des maîtres » | `/v2/primary/conseil` | prépare le conseil et propose une décision par élève | propositions du tableau « Dossiers, un par un » |
| « Mes évaluations » | `/v2/teacher/assessments` | crée les évaluations et saisit les notes | évaluations et notes (section « Évaluations ») |
| « Messages », « Annonces » | `/v2/messages`, `/v2/announcements` | lit et écrit les messages et annonces | voir la section « Communication » |
| « Mes notifications » | `/v2/account/notifications` | choisit les canaux et sujets de ses notifications | cocher / décocher les canaux |
| « Mes documents » | `/v2/documents` | ses documents personnels déposés par l'école | rien (lecture) |

### Portail parent (15 menus)
| Menu | Route | En une ligne | Données à saisir |
| :--- | :--- | :--- | :--- |
| « Mes enfants » | `/v2/parent` | la liste des enfants liés au compte | rien |
| « Inscriptions de mon enfant » | `/v2/parent/children/[id]` | l'inscription de l'enfant dans sa classe | rien |
| « Emploi du temps de mes enfants » | `/v2/parent/children/[id]/schedule` | la semaine de cours de l'enfant | rien |
| « Absences de mes enfants » | `/v2/parent/children/[id]/attendance` | absences et retards, dépôt d'un justificatif | justificatif : motif `Rendez-vous médical`, dates du jour, pièce `04-piece-eleve-test-guide.pdf` |
| « Bulletin et compétences de mon enfant » | `/v2/primary/mon-enfant` | compteurs de compétences et bilan annuel | rien |
| « Bulletins de mes enfants », « Notes de mes enfants », « Résultats de mes enfants » | `/v2/parent/children/[id]/reportcards` et `/results` | bulletins publiés et résultats de la période | rien |
| « Scolarité de mes enfants » | `/v2/parent/children/[id]/finance` | factures, échéances, paiements, reçus | paiement en ligne simulé (montant libre ne finissant ni par `001` ni par `013`) |
| « Examens de mes enfants » | `/v2/examinations/family` | convocations et résultats d'examens | rien |
| « Messages », « Annonces », « Mes notifications », « Documents de mes enfants » | `/v2/messages`, `/v2/announcements`, `/v2/account/notifications`, `/v2/documents` | communications de l'école et documents de l'enfant | répondre à un message |
| « Parcours de mon enfant » | `/parent/higher` | réservé à l'enseignement supérieur | — (hors pack Primaire) |

### Portail élève (14 menus)
| Menu | Route | En une ligne | Données à saisir |
| :--- | :--- | :--- | :--- |
| « Mon dossier », « Mes inscriptions » | `/v2/student`, `/v2/student/me` | sa fiche, sa classe et ses coordonnées | « Mettre à jour mes coordonnées » (téléphone, adresse) |
| « Emploi du temps » | `/v2/student/schedule` | sa semaine de cours | rien |
| « Mes absences » | `/v2/student/attendance` | ses absences et justificatifs | justificatif comme pour le parent |
| « Mes bulletins », « Mes notes », « Mes résultats » | `/v2/student/reportcards`, `/v2/student/results` | bulletins et résultats publiés | rien |
| « Ma scolarité » | `/v2/student/finance` | ses factures et paiements | paiement simulé |
| « Mon examen », « Mon parcours » | `/v2/examinations/family`, `/student/higher` | convocation d'examen ; parcours (supérieur, hors pack) | rien |
| « Messages », « Annonces », « Mes notifications », « Mes documents » | `/v2/messages`, `/v2/announcements`, `/v2/account/notifications`, `/v2/documents` | communications et documents | rien |
Le menu « Bulletin et compétences de mon enfant » du pack devient « Mon bilan et mes compétences » pour l'élève.


### Actes irréversibles : à jouer une seule fois, à la toute fin
**En une ligne :** les gestes qui ne se défont pas ; les placer après tous les autres remplissages et ne les faire qu'avec le propriétaire.
| Ordre | Menu | Action | Donnée à saisir | Pourquoi en dernier |
| :--- | :--- | :--- | :--- | :--- |
| 1 | « Années et périodes » | « Clore les notes » puis « Clore » sur Trimestre 1 | (confirmation) | verrouille les notes et les compétences du trimestre |
| 2 | « Conseil des maîtres » | cocher « Signature de BAMBA Séraphin » (présent) puis « Enregistrer la feuille de présence » | (case de signature) | une présence signée est figée |
| 3 | « Bilans annuels » | « Sceller » un bilan « Prêt à sceller » | (confirmation) | le bilan devient immuable ; exige les périodes closes, le résultat d'année et la décision du conseil |
| 4 | « Bilans annuels » | « Réémettre » le bilan scellé | Motif : `Correction de la décision de passage (recette)` | remplace la version scellée par une nouvelle version à sceller |
| 5 | « Archives d'année » | « Geler l'archive » | (confirmation) | gel logique de l'année pour toute l'école ; inatteignable tant que l'année n'est pas close |
| 6 | « Établissement » > « Mise en service » | « Passer en production » | (confirmation) | définitif, ferme la mise en service |
En octobre, 3 et 5 sont refusés par le système (périodes non closes) : c'est normal. Aucun de ces actes ne se défait : ils ne se rejouent pas sur la même école.
