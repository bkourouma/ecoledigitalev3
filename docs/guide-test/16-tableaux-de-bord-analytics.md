# Chapitre 16 : Tableaux de bord de direction, analytics et alertes

Ce chapitre vérifie le pilotage de la direction : tableau de bord, effectifs et présences, hub d'indicateurs, admissions et vie scolaire agrégées, pédagogie, scolarité, trésorerie, masse salariale, charges, comparaisons, fraîcheur des données, exports CSV, **règles d'alerte** (création, seuil, déclenchement, accusé de réception, résolution) et ce que chaque rôle voit. Le principe à vérifier partout : **les chiffres des tableaux de bord doivent recouper les modules sources** (effectifs = élèves inscrits, recouvrement = factures et paiements), une valeur non mesurée s'affiche « Non mesuré » (jamais un zéro inventé), et chaque écran dit de quand datent ses données.

> **Adresses.** Application sur `http://localhost:3000`, API sur `http://localhost:4000`. Les écrans sont sous `apps/web/src/app/v2/{direction,analytics,owner}/` et **aucun préfixe supplémentaire** n'est ajouté (`next.config.js`, middleware) : les adresses `/v2/...` ci-dessous sont celles du navigateur. L'adresse `/v2/owner` seule redirige vers `/v2/direction`.
> **Accès refusé.** Les gardes de page redirigent vers `/unauthorized` : page « Accès refusé » (texte "Vous n'avez pas les droits nécessaires pour afficher cette page."). Un utilisateur non connecté va vers `/login`.
> **Typographie.** Un libellé entre guillemets français est copié de `fr-CI.json` ; les libellés de données, les messages d'erreur de l'API et les citations de texte libre sont entre guillemets droits.

## Prérequis

- Établissement principal : **Collège Le Baobab** (`secondaire-test`) ; contrôles complémentaires sur École primaire Les Palmiers et Université Horizon (16.28).
- Le **worker** tourne : il met à jour les tableaux (demandes de rafraîchissement traitées toutes les 30 secondes, reconstruction nocturne à 03:10) et **évalue les règles d'alerte toutes les 15 minutes**. Sans lui, les scénarios 16.16 et 16.20 à 16.23 ne se terminent pas.
- Les offres de l'établissement incluent la fonctionnalité de pilotage (`analytics.direction`) ; la page « Masse salariale » exige aussi `analytics.payroll-insights` (à vérifier, 16.12). Pendant le chargement des droits, l'écran peut afficher un instant un message "n'est pas inclus dans l'offre" (défaut connu, voir Écarts).
- Ordre conseillé : 16.1 à 16.15 (lecture), 16.16 (donnée vivante), 16.17 à 16.23 (alertes, avec attente de 15 minutes), 16.24 à 16.28 (droits et isolation) pendant les attentes.
- Les résultats du seed reposent sur un jeu de règles de **démonstration** : aucun chiffre pédagogique n'est officiel, aucune conclusion réglementaire n'en découle.

## Comptes

Mots de passe et codes MFA : jamais dans ce guide (voir l'annexe).

| Rôle | E-mail | MFA | Rôle dans ce chapitre |
|---|---|---|---|
| Propriétaire | `direction.generale@secondaire-test.test` | oui | Tout le pilotage, règles d'alerte, exports, fraîcheur |
| Directeur | `directeur@secondaire-test.test` | oui | Mêmes droits ; destinataire des alertes de la graine |
| Directeur des études | `etudes@secondaire-test.test` | oui | Pédagogie, présence, admissions, vie scolaire, alertes (accusé) |
| Économe | `econome@secondaire-test.test` | oui | Scolarité, trésorerie, alertes financières |
| Chargé d'admissions | `admissions@secondaire-test.test` | non | Entonnoir d'admission seulement |
| Secrétariat | `secretariat@secondaire-test.test` | oui | Aucun pilotage (contrôle de droit) |
| Enseignant | `enseignant@secondaire-test.test` | non | Aucun pilotage |
| Parent | `parent@secondaire-test.test` | non | Aucun pilotage |

## Droits (qui voit quel tableau)

Source : `apps/api/src/modules/rbac/templates/system-roles.ts`, `apps/api/src/modules/analytics/manifest.ts`, gardes `requirePermission` des pages.

| Écran (adresse) | Permission | Propriétaire / Directeur | Directeur des études | Économe | Chargé d'admissions |
|---|---|---|---|---|---|
| `/v2/direction` (Tableau de bord de la direction) | `analytics.read` | oui | non | non | non |
| `/v2/direction/effectifs` | `analytics.read` (+ présence : `analytics.attendance.read`) | oui | non | non | non |
| `/v2/analytics` (Indicateurs de direction) | `analytics.read` | oui | non | non | non |
| `/v2/analytics/comparaisons` | `analytics.read` | oui | non | non | non |
| `/v2/owner/fraicheur` | `analytics.read` | oui (reconstruction et réglages : propriétaire / directeur) | non | non | non |
| `/v2/owner/pedagogie` | `analytics.pedagogy.read` | oui | oui | non | non |
| `/v2/owner/scolarite` | `analytics.finance.read` | oui | non | oui | non |
| `/v2/owner/tresorerie` | `analytics.treasury.read` | oui | non | oui | non |
| `/v2/owner/paie` | `analytics.payroll.read` (sensible, MFA) | oui | non | non | non |
| `/v2/owner/charges` | `analytics.charges.read` | oui | non | non | non |
| `/v2/analytics/admissions` | `analytics.admissions.read` | oui | oui | non | oui |
| `/v2/analytics/vie-scolaire` | `analytics.schoollife.read` | oui | oui | non | non |
| `/v2/analytics/alertes` | `analytics.alerts.read` (+ droit de données de chaque indicateur) | oui | oui (alertes de son domaine) | oui (alertes financières) | non |
| `/v2/analytics/alertes/regles` | `analytics.alerts.read` (créer / modifier : `analytics.alerts.manage`) | oui, avec création | lecture seule | lecture seule | non |
| Boutons « Exporter (CSV) » | `analytics.export` | oui | non | non | non |

Les autres rôles (Secrétariat, Enseignant, Éducateur, Responsable des examens, Parent, Élève) n'ont aucune permission `analytics.*`.

**Adresses à taper à la main qui doivent être refusées** (page « Accès refusé ») :

| Rôle | Adresses refusées |
|---|---|
| Directeur des études | `/v2/direction`, `/v2/analytics`, `/v2/analytics/comparaisons`, `/v2/owner/scolarite`, `/v2/owner/tresorerie`, `/v2/owner/paie`, `/v2/owner/charges`, `/v2/owner/fraicheur` |
| Économe | `/v2/direction`, `/v2/owner/pedagogie`, `/v2/owner/paie`, `/v2/analytics/comparaisons`, `/v2/analytics/admissions`, `/v2/analytics/vie-scolaire` |
| Chargé d'admissions | `/v2/direction`, `/v2/owner/scolarite`, `/v2/analytics/alertes`, `/v2/analytics/vie-scolaire` |
| Secrétariat, Enseignant, Parent, Élève | `/v2/direction`, `/v2/analytics`, `/v2/analytics/alertes`, `/v2/owner/fraicheur`, `/v2/owner/paie` |

## Données de départ

Sources : `scripts/seed-v2/demo/comms.ts` (règles d'alerte, reconstruction), `admissions.ts`, `schoollife.ts`, `finance.ts`, `results.ts`, `scripts/seed-v2/dataset.ts`.

- **Effectifs (secondaire, base neuve)** : 12 élèves de départ dont 8 ont réglé l'inscription, plus l'élève inscrit par l'admission et un élève en attente de paiement. Valeurs relevées à la recette (rapport 02) : **9 élèves en scolarité**, **14 inscriptions** tous statuts, classe `6E-A` : 9 en scolarité (6 filles, 3 garçons). Toute inscription ajoutée ou confirmée par un autre chapitre modifie ces nombres : recouper avec la liste, ne pas comparer à un nombre figé.
- **Résultats** : période 1 clôturée avec les règles de démonstration ; période 2 notes publiées et verrouillées, non clôturée.
- **Finances** : scolarité de 200 000 F CFA ; un élève soldé par virement, un partiel (moitié) par mobile money, un paiement en ligne simulé de 50 000 F CFA réussi, un refusé (20 013) ; les autres factures impayées. Le taux de recouvrement est donc bas.
- **Admissions (campagne `RENTREE-6E`)** : 9 dossiers (1 inscrit, 1 accepté en attente de paiement d'inscription, 1 accepté avec offre émise, 1 en étude, 1 déposé, 1 pièces manquantes, 1 liste d'attente, 1 refusé, 1 brouillon) pour **13 places**. Attendu d'après le seed : 8 dossiers déposés (9 brouillon compris), 3 acceptés dont inscrits, 1 inscrit.
- **Vie scolaire (secondaire seulement)** : 2 incidents, 3 mesures (1 avertissement validé, 1 exclusion **proposée** en attente de validation, 1 exclusion validée dont l'effet est en attente d'un acte humain) ; les exclusions commencent demain : « Exclusions en cours » = 0 aujourd'hui.
- **Paie** : aucune période préparée au départ : « Aucune période de paie. » (sauf autre chapitre).
- **Règles d'alerte (3, créées pour chaque établissement)** :

| Nom | Indicateur | Attention | Critique | Fenêtre | Destinataires | Rappels |
|---|---|---|---|---|---|---|
| Créances en retard élevées | Montant des impayés échus | au-dessus de 100 000 F CFA | au-dessus de 500 000 F CFA | | Directeur, Économe | au plus un par jour |
| Taux de recouvrement bas | Taux de recouvrement de la scolarité | sous 60 % | sous 30 % | | Directeur, Économe | au plus un par jour |
| Taux de présence bas | Taux de présence des élèves | sous 90 % | sous 80 % | 30 jours | Directeur, Directeur des études | au plus un par jour |

  Le Propriétaire n'est destinataire d'aucune de ces règles. Aucun seuil n'est une règle officielle.
- **Réglages d'affichage** (valeurs par défaut de la plateforme, `display-thresholds.ts`) : recouvrement « Bon » à partir de 80 %, « À surveiller » à partir de 60 % ; présence « Bon » 85 %, « À surveiller » 70 % ; donnée ancienne au-delà de 24 heures.

## Scénarios : tableau de bord et effectifs

#### 16.1 Tableau de bord de la direction
Compte : Propriétaire puis Directeur · Où : menu « Modules » > « Pilotage » > « Tableau de bord de la direction » (`/v2/direction`) · Prérequis : seed intact.
1. Se connecter avec `direction.generale@secondaire-test.test` (code MFA). Ouvrir « Tableau de bord de la direction » (description "L'essentiel de l'établissement : effectifs, présence, résultats, enseignants, scolarité et créances."). La barre d'onglets « Pilotage » propose les écrans autorisés.
2. Lire la ligne de fraîcheur « Données au … » et, si le bandeau « Règles de démonstration » est affiché, son texte.
3. Lire les cartes : « Élèves en scolarité », « Présence aujourd'hui », « Moyenne générale », « Taux de validation », « Enseignants et personnel présents », avec leur détail (par exemple "9 inscription(s) au total"…).
4. Descendre à « Scolarité et créances » : « Scolarité recouvrée », « Encaissé », « Créances (restant dû) ».
5. Descendre à « Aller plus loin » : ouvrir « Effectifs et présences », revenir, ouvrir « Charges et résultat ».
6. Refaire avec `directeur@secondaire-test.test`.
Résultat attendu : les cartes sont renseignées ; une valeur non calculable affiche « Non mesuré » (par exemple « Présence aujourd'hui » si aucun appel n'a été validé aujourd'hui, ou « Enseignants et personnel présents » sans pointage), jamais un zéro ; « Élèves en scolarité » vaut 9 sur une base neuve avec le détail "14 inscription(s) au total · 1 classe(s)" (nombre de classes selon le seed) ; la moyenne et le taux de validation portent sur la dernière période clôturée (période 1) et le bandeau de démonstration est présent ; le Directeur voit exactement les mêmes blocs que le Propriétaire, y compris le bloc financier.
Cas invalides : | Saisie | Message attendu |
|---|---|
| Choisir une « Année scolaire » sans donnée | Cartes en « Non mesuré » ou à zéro mesuré avec la mention de fraîcheur ; aucune erreur |
| Établissement sans l'offre de pilotage | "Le pilotage de la direction n'est pas inclus dans l'offre de votre établissement." (non testable dans le seed) |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : Directeur des études sur `/v2/direction` arrive sur « Accès refusé »

#### 16.2 Cohérence des effectifs avec les inscriptions
Compte : Propriétaire · Où : `/v2/direction/effectifs` puis `/v2/enrollments` · Prérequis : 16.1.
1. Ouvrir « Effectifs et présences » : relever « Élèves en scolarité » et le détail "n inscription(s) tous statuts confondus".
2. Ouvrir la liste « Inscriptions » (`/v2/enrollments`), année en cours : filtrer « Statut » = « Active » (puis « Terminée ») et compter les lignes ; compter aussi la liste sans filtre de statut.
3. Dans « Effectifs par classe », relever pour `6E-A` les colonnes « En scolarité », « Filles », « Garçons », « Inscriptions ».
4. Comparer aux élèves de la classe dans la liste des inscriptions (filtre « Classe » = `6E-A`).
Résultat attendu : « Élèves en scolarité » = nombre d'inscriptions « Active » + « Terminée » de l'année ; le total tous statuts = nombre de lignes de la liste sans filtre ; la somme des colonnes « En scolarité » de toutes les classes = « Élèves en scolarité » ; « Filles » + « Garçons » = « En scolarité » pour chaque classe ; chaque répartition (« Par sexe », « Par niveau », « Par type de financement », « Par statut d'inscription ») totalise le nombre d'**inscriptions** (14 sur base neuve), avec deux nombres par ligne (« Inscriptions » puis « Dont en scolarité »). Un écart doit s'expliquer par le statut des inscriptions. Rapport 02, C-02-01 : ces deux nombres collés se lisent "86" pour 8 et 6 au lecteur d'écran ; contrôler la lisibilité.
Cas invalides : | Saisie | Message attendu |
|---|---|
| Filtre de classe sans élève | « Aucune inscription sur ce périmètre. » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : Économe sur `/v2/direction/effectifs` arrive sur « Accès refusé »

#### 16.3 Effectifs et présences : répartitions, admissions et fenêtre de présence
Compte : Propriétaire · Où : `/v2/direction/effectifs` · Prérequis : 16.2.
1. Lire les trois cartes « Élèves en scolarité », « Redoublants », « Part de redoublants » et le bloc « Répartition des inscriptions » : « Par sexe » (« Garçons », « Filles »), « Par niveau », « Par type de financement » (« Famille », « Affecté par l'État »…), « Par statut d'inscription » (« En attente », « Active »…). « Par campus » n'apparaît que s'il y a plusieurs campus.
2. Lire « Admissions et inscriptions confirmées » : « Inscriptions créées », « Inscriptions confirmées », « Inscriptions annulées », « Taux de confirmation », puis les graphiques « Inscriptions créées par mois » et « Inscriptions par origine » (« Admission », « Saisie manuelle »…). Cliquer « Afficher les données en tableau » sous un graphique.
3. Dans « Présences et assiduité » (réservé à `analytics.attendance.read`), saisir une fenêtre : champ « Du » = il y a 30 jours, « Au » = aujourd'hui, puis la vider (valeur par défaut : les 30 derniers jours).
4. Lire « Taux de présence » (avec le détail "n présents sur n pointages, du … au …"), « Absences », « Retards », « Séances d'appel », « Taux de présence par jour », « Présence du personnel par jour » et le tableau « Présence par classe ».
Résultat attendu : le nombre d'inscriptions créées (hors annulées) recoupe la liste des inscriptions ; « Taux de confirmation » = confirmées / créées ; sans appel validé sur la fenêtre, « Aucun appel soumis sur ce périmètre. » ; la présence du personnel non mesurée affiche "La présence du personnel n'est pas mesurée sur cette fenêtre." ; le taux de présence recoupe le module Présences (rapport 11 : 90 % recompté). Les étiquettes de date des graphiques sont courtes ("10-25", "2026-") : défaut connu, voir Écarts.
Cas invalides : | Saisie | Message attendu |
|---|---|
| « Du » postérieur à « Au » | Aucune donnée ou erreur de l'API (message à relever en test) |
| Fenêtre future | « Aucun appel soumis sur ce périmètre. » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : Directeur des études ne voit pas cet écran

#### 16.4 Exports CSV (effectifs, présence, résultats, créances)
Compte : Propriétaire puis Directeur des études · Où : boutons « Exporter (CSV) » des écrans · Prérequis : 16.3. Les téléchargements peuvent demander l'accord du navigateur.
1. Sur `/v2/direction/effectifs`, cliquer « Exporter (CSV) » dans « Répartition des inscriptions » : le bouton passe à « Export en cours… » puis un fichier `analytics-enrollment-by-classroom.csv` est téléchargé. L'ouvrir dans un tableur.
2. Cliquer « Exporter (CSV) » dans « Présences et assiduité » : `analytics-attendance-by-classroom.csv`.
3. Sur `/v2/owner/pedagogie`, exporter « Résultats par classe » (`analytics-results-by-classroom.csv`) ; sur `/v2/owner/scolarite`, exporter « Créances » en regroupement « Classe » puis « Apprenant » (`analytics-receivables-by-classroom.csv` puis `analytics-receivables-by-learner.csv`).
4. Ouvrir le journal d'audit (`/v2/audit`) et chercher les exports.
5. Directeur des études : ouvrir `/v2/owner/pedagogie` et chercher « Exporter (CSV) ».
Résultat attendu : fichiers séparés par des points-virgules, accents lisibles (BOM UTF-8), première ligne d'en-têtes (par exemple "Classe;Niveau;Inscrits (tous statuts);Effectif en scolarité;Garçons;Filles") ; les exports d'effectifs et de présence ne contiennent aucun nom d'élève ; **l'export des créances par apprenant contient les noms des élèves** (colonne "Apprenant") : donnée nominative à traiter avec précaution ; toute cellule texte commençant par `=`, `+`, `-` ou `@` est préfixée d'une apostrophe ; chaque export est tracé dans le journal d'audit ; le Directeur des études n'a **aucun** bouton d'export.
Cas invalides : | Saisie | Message attendu |
|---|---|
| Échec réseau pendant l'export | "L'export a échoué. Réessayez." |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : aucun bouton « Exporter (CSV) » pour le Directeur des études et l'Économe

#### 16.5 Filtres de périmètre et années
Compte : Propriétaire · Où : `/v2/direction`, `/v2/owner/pedagogie`, `/v2/owner/scolarite` · Prérequis : 16.1.
1. Sur le tableau de bord, repérer le formulaire « Filtres du périmètre » : le sélecteur « Année scolaire » (valeur « Année en cours »). Les sélecteurs « Établissement » et « Campus » n'apparaissent que s'il y en a plusieurs : ils sont **absents** sur le secondaire de démonstration.
2. Changer l'« Année scolaire » pour une autre année si elle existe, relever les cartes, revenir à « Année en cours ».
3. Sur « Pédagogie », choisir successivement « Période » (valeur par défaut « Dernière période clôturée ») = période 1, puis période 2 (non clôturée), puis « Classe » = `6E-A`.
Résultat attendu : les valeurs changent avec le périmètre ; période 2 non clôturée : "Aucun résultat clôturé pour ce périmètre." ; le choix d'une période sans résultat n'affiche jamais zéro à la place de « Non mesuré ».
Cas invalides : | Saisie | Message attendu |
|---|---|
| Période sans résultats clôturés | "Aucun résultat clôturé pour ce périmètre." |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : sans objet

## Scénarios : indicateurs thématiques

#### 16.6 Hub des indicateurs de direction
Compte : Propriétaire · Où : « Pilotage » > « Indicateurs de direction » (`/v2/analytics`) · Prérequis : 16.1.
1. Ouvrir « Indicateurs de direction » (description "Vue transverse de l'établissement : …aucune donnée nominative.").
2. Parcourir les blocs : « Effectifs et inscriptions », « Assiduité », « Résultats par période », « Recouvrement et impayés », « Admissions », « Vie scolaire (agrégée) », « Alertes de direction », « Charge de paie ». Cliquer un lien « Voir les effectifs », « Voir la présence », « Voir la pédagogie », « Voir la scolarité », « Voir l'entonnoir », « Voir le détail », « Voir les alertes ».
3. Dans « Résultats par période », lire la colonne « Règles » (« Démonstration » pour la période clôturée).
4. Dans « Charge de paie », lire "Donnée sensible : la lecture exige l'authentification forte et est consignée dans le journal d'audit." et cliquer « Afficher la masse salariale ».
Résultat attendu : huit blocs pour le Propriétaire ; chaque bloc porte sa ligne de fraîcheur ; la période clôturée est « Démonstration » et les périodes sans résultat « Non mesuré » ; la masse salariale n'est **lue** qu'après le clic (si une fenêtre « Confirmez votre identité » apparaît, saisir le code du moment) ; aucun nom de personne dans ce hub.
Cas invalides : | Saisie | Message attendu |
|---|---|
| Aucune période clôturée | « Aucune période n'a encore de résultats clôturés. » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : `/v2/analytics` refusé au Directeur des études et à l'Économe

#### 16.7 Admissions : entonnoir et cohérence avec le module Admissions
Compte : Propriétaire (ou Chargé d'admissions) · Où : « Pilotage » > « Admissions » (`/v2/analytics/admissions`) puis `/v2/admissions` · Prérequis : seed intact.
1. Ouvrir « Entonnoir d'admission ». Lire la note "Répartition à ce jour : chaque dossier est compté dans son statut actuel (ce n'est pas un historique de passages). Aucun candidat n'est affiché ici."
2. Lire les cartes : « Dossiers déposés », « Acceptés (dont inscrits) », « Inscrits », « Taux d'acceptation », « Taux d'inscription », « Places offertes » ("n place(s) restante(s)").
3. Lire « Par statut » : « Brouillon », « Déposé », « En étude », « Pièce manquante », « Accepté », « Refusé », « Liste d'attente », « Inscrit ».
4. Lire « Campagnes » : campagne `RENTREE-6E` et le tableau « Étape » / « Statut » / « Dossiers ».
5. Comparer avec la liste des candidatures (`/v2/admissions`) : compter par statut.
Résultat attendu (seed neuf) : 8 déposés (le détail dit 9 dossiers brouillon compris), 3 acceptés dont inscrits, 1 inscrit, 13 places ; chaque statut recoupe le module Admissions ; aucun candidat nommé. Sur l'Université Horizon, la campagne est `RENTREE-L1`. Un campus ou une année sans campagne : « Aucune campagne d'admission lue pour ce périmètre. »
Cas invalides : | Saisie | Message attendu |
|---|---|
| Année sans campagne | « Aucune campagne d'admission lue pour ce périmètre. » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : Économe sur `/v2/analytics/admissions` arrive sur « Accès refusé »

#### 16.8 Vie scolaire agrégée
Compte : Propriétaire (ou Directeur des études) · Où : « Pilotage » > « Vie scolaire (agrégée) » (`/v2/analytics/vie-scolaire`) puis `/v2/schoollife` · Prérequis : seed intact.
1. Ouvrir « Vie scolaire agrégée » : lire "Comptages uniquement : aucun élève n'est nommé, aucun motif n'est lu, et les éléments restreints ou confidentiels ne sont jamais comptés ici."
2. Lire les quatre cartes : « Incidents ouverts » ("déclarés ou en cours d'examen"), « Mesures à valider » ("proposées, en attente de décision"), « Exclusions en cours », « Convocations à tenir ».
3. Comparer avec le module Vie scolaire (`/v2/schoollife`) : incidents ouverts, mesures proposées.
Résultat attendu (secondaire, seed neuf) : « Mesures à valider » = 1 (l'exclusion proposée) ; « Incidents ouverts » = 2 (à confirmer : dépend de l'état des incidents liés aux mesures) ; « Exclusions en cours » = 0 (les exclusions commencent demain) ; « Convocations à tenir » = 0. Aucun nom, aucun motif. Sur le primaire (aucune vie scolaire alimentée) : comptages à zéro ou « Non mesuré ».
Cas invalides : | Saisie | Message attendu |
|---|---|
| Établissement sans donnée de vie scolaire | Cartes à zéro ou « Non mesuré », sans erreur |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : Économe sur `/v2/analytics/vie-scolaire` arrive sur « Accès refusé »

#### 16.9 Pédagogie
Compte : Propriétaire · Où : « Pilotage » > « Pédagogie » (`/v2/owner/pedagogie`) · Prérequis : période 1 clôturée (seed).
1. Lire le bandeau « Règles de démonstration » et les cartes : « Moyenne générale » ("Plus basse : … · plus haute : …"), « Taux de validation », « Résultats clôturés », « Classes clôturées ».
2. Lire « Distribution des moyennes » (note : "Ce n'est pas un seuil de réussite."), « Moyenne par période de l'année », « Résultats par classe » (colonnes « Classe », « Niveau », « Résultats », « Moyenne », « Validation », « Plus basse – plus haute »), « Résultats par matière et unité » (graphique « Matières avec le plus faible taux de validation » et tableau), « Décisions » (« Décisions de la période », « Décisions de fin d'année »), « Charge d'enseignement » (« Enseignant », « Heures prévues », « Classes »).
3. Comparer la moyenne de `6E-A` et le nombre de résultats avec le module Résultats.
Résultat attendu : valeurs recoupées avec le module Résultats ; les résultats issus de règles de démonstration sont étiquetés (« règles de démonstration » dans la moyenne par période) ; "Aucune matière mesurée." / "Aucune affectation d'enseignement pour cette année." quand rien n'existe ; le Directeur des études voit les mêmes blocs, sans bouton d'export.
Cas invalides : | Saisie | Message attendu |
|---|---|
| Classe sans résultat clôturé | "Aucun résultat clôturé pour ce périmètre." |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : Économe sur `/v2/owner/pedagogie` arrive sur « Accès refusé »

#### 16.10 Scolarité : recouvrement cohérent avec la Finance
Compte : Propriétaire (ou Économe) · Où : « Pilotage » > « Scolarité » (`/v2/owner/scolarite`) puis `/v2/finance/invoices` · Prérequis : seed intact.
1. Lire les cartes : « Taux de recouvrement » ("Situation au …"), « Facturé » ("n facture(s)"), « Avoirs », « Encaissé », « Restant dû », « En retard », « Paiements non imputés » ("Avances et trop-perçus").
2. Lire le graphique « Taux de recouvrement par classe ».
3. Dans « Créances », choisir « Regrouper par » = « Classe » puis « Apprenant » ; cocher puis décocher « Seulement les restes dus » ; lire les colonnes « Facturé », « Encaissé », « Reste dû », « En retard », « Recouvrement » et « Plus ancienne échéance en retard ».
4. Dans « Factures » (`/v2/finance/invoices`), additionner les colonnes « Total », « Payé » et « Reste dû » (année en cours).
Résultat attendu : « Facturé » − « Avoirs » = base du taux ; « Encaissé » = somme des paiements imputés ; « Restant dû » = somme de « Reste dû » des factures ; le taux = encaissé / facturé net, affiché avec son état (« Bon », « À surveiller », « Critique » selon 80 % / 60 %) ; sur la base de démonstration le taux est bas (« Critique » probable). Un écart doit s'expliquer par des avoirs ou des paiements non imputés. L'économe voit la même page sans bouton d'export. Le libellé "Avances et trop-perçus" sans valeur était un défaut (rapport 02, C-02-12) : la carte est maintenant « Paiements non imputés ».
Cas invalides : | Saisie | Message attendu |
|---|---|
| Regroupement sans reste dû | « Aucune créance sur ce périmètre. » |
| Année sans facture | « Aucune facture sur ce périmètre. » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : Directeur des études sur `/v2/owner/scolarite` arrive sur « Accès refusé »

#### 16.11 Trésorerie : encaissements, créances âgées, écarts de caisse
Compte : Propriétaire (ou Économe) · Où : « Pilotage » > « Trésorerie » (`/v2/owner/tresorerie`) · Prérequis : seed intact.
1. Dans « Encaissements » : laisser « Du » / « Au » vides (12 derniers mois), tester « Regroupement » = « Par jour », « Par semaine », « Par mois ». Lire « Encaissé », « Remboursé », « Net », « Paiements ».
2. Dans « Créances âgées », lire le graphique par ancienneté (« Non échu », « 1 à 30 jours », « 31 à 60 jours », « 61 à 90 jours », « Plus de 90 jours ») et le tableau « Principaux débiteurs par ancienneté ».
3. Dans « Écarts de caisse », lire « Sessions clôturées », « Sessions avec écart », « Écart net », « Écart cumulé (en valeur absolue) » et le tableau (« Encore ouverte », « Attendu », « Compté », « Écart »).
4. Comparer « Encaissé » avec les paiements de `/v2/finance/payments` (hors paiement refusé ou en attente).
Résultat attendu : « Net » = « Encaissé » − « Remboursé » ; les paiements réussis du seed (virement, mobile money, paiement en ligne simulé réussi, frais d'inscription) sont comptés, le paiement refusé (20 013 F CFA) ne l'est pas ; "Aucune session de caisse." tant qu'aucune caisse n'a été ouverte. Les étiquettes de date des axes sont abrégées (défaut connu).
Cas invalides : | Saisie | Message attendu |
|---|---|
| Aucune créance âgée | « Aucune créance âgée. » |
| Fenêtre sans encaissement | « Aucune donnée sur ce périmètre. » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : Directeur des études sur `/v2/owner/tresorerie` arrive sur « Accès refusé »

#### 16.12 Masse salariale (donnée sensible, MFA, lecture auditée)
Compte : Propriétaire ou Directeur · Où : « Pilotage » > « Masse salariale » (`/v2/owner/paie`) · Prérequis : MFA active ; une période de paie préparée par le chapitre Paie pour voir des montants.
1. Ouvrir « Masse salariale ». Si la fenêtre « Confirmez votre identité » apparaît, saisir le code du moment (un code déjà utilisé est refusé ; attendre le suivant).
2. Lire "Données sensibles : l'authentification forte est exigée et chaque consultation est enregistrée." et la définition des bulletins comptés (calculés, arrêtés, payés ; annulés et contestés à part).
3. Lire « Masse comptée » ("n bulletin(s) calculés, arrêtés ou payés"), « Périodes de paie » et le tableau « Masse salariale par période de paie » (colonnes « Période », « Masse comptée », « Bulletins », « Par statut », « Annulés », « Contestés »).
4. Ouvrir `/v2/audit` et chercher la lecture.
Résultat attendu : sans période : « Aucune période de paie. » ; sinon les montants recoupent le module Paie (statuts « Calculé », « Arrêté », « Payé », « Contesté », « Annulé ») ; la lecture est consignée. Si l'offre n'inclut pas `analytics.payroll-insights`, l'écran dit que le pilotage n'est pas inclus : le noter (à vérifier). Le Directeur des études et l'Économe n'ont pas cet écran.
Cas invalides : | Saisie | Message attendu |
|---|---|
| Code MFA incorrect dans la fenêtre | "Code invalide. Vérifiez l'heure de votre téléphone, puis attendez le prochain code." |
| Code MFA déjà utilisé | refusé (même message) : attendre le code suivant |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : Économe sur `/v2/owner/paie` arrive sur « Accès refusé »

#### 16.13 Charges et résultat : module absent
Compte : Propriétaire · Où : « Pilotage » > « Charges et résultat » (`/v2/owner/charges`) · Prérequis : aucun.
1. Ouvrir l'écran.
2. Lire le message d'avertissement et la liste « Ce qui n'est pas mesuré ».
Résultat attendu : "Module de charges absent" (titre d'avertissement) suivi du message de l'API, puis les quatre lignes : "Charges d'exploitation par famille et par établissement", "Compte de résultat (produits moins charges)", "Marge par filière ou par classe", "Rétention et coût par élève" ; **aucun montant à zéro inventé**.
Cas invalides : | Saisie | Message attendu |
|---|---|
| Directeur des études / Économe tapant l'adresse | Page « Accès refusé » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : seuls Propriétaire et Directeur ouvrent la page

#### 16.14 Comparaisons
Compte : Propriétaire · Où : « Pilotage » > « Comparaisons » (`/v2/analytics/comparaisons`) · Prérequis : au moins une année scolaire.
1. Ouvrir « Comparaisons » ("Comparer un indicateur entre deux années, deux périodes ou deux fenêtres de dates."). Avant tout choix : "Choisissez les deux côtés de la comparaison pour l'afficher."
2. « Indicateur » = « Effectifs » : « Année de référence » et « Année comparée » = la même année. Lire le tableau "Comparaison" (colonnes « Indicateur », « Référence », « Comparée », « Écart », « Variation »).
3. « Indicateur » = « Assiduité » : remplir « Référence : du » / « Référence : au » (par exemple du 1er au 15 septembre) puis « Comparée : du » / « Comparée : au » (du 16 septembre à aujourd'hui).
4. « Indicateur » = « Résultats » : « Période de référence » = période 1, « Période comparée » = période 2.
5. « Indicateur » = « Recouvrement » : choisir une année de chaque côté.
Résultat attendu : écart nul pour une année comparée à elle-même ; "L'écart est comparée moins référence…" (note affichée sous le tableau) ; un côté sans mesure affiche « Non mesuré » et non zéro ; la variation n'est pas calculée (« — ») quand la référence est nulle ; le bandeau de démonstration accompagne les résultats.
Cas invalides : | Saisie | Message attendu |
|---|---|
| Dates de référence inversées (début après fin) | La comparaison ne s'affiche pas (les deux côtés ne sont pas valides) |
| Un seul côté choisi | "Choisissez les deux côtés de la comparaison pour l'afficher." |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : Directeur des études et Économe sur `/v2/analytics/comparaisons` arrivent sur « Accès refusé »

#### 16.15 Fraîcheur des données, reconstruction et seuils de lecture
Compte : Propriétaire · Où : onglet « Fraîcheur des données » (`/v2/owner/fraicheur`) · Prérequis : aucun. **Noter les valeurs d'origine des réglages.**
1. Ouvrir l'écran (titre « Fraîcheur des données de pilotage »). Lire la file "En file : n · en échec : n · source indisponible : n" et le tableau « État de la lecture des sources » (colonnes « Source », « Périmètre », « Dernière lecture réussie », « État », « Lignes ») : sources « Inscriptions », « Résultats », « Présences des élèves », « Facturation et créances », « Encaissements », « Admissions (entonnoir) », « Vie scolaire (comptages) »… ; états « À jour », « Échec », « Source indisponible ».
2. Cliquer « Reconstruire depuis les sources », puis une seconde fois aussitôt.
3. Recharger après une minute : la date de « Dernière lecture réussie » a avancé.
4. Dans « Seuils de lecture et fraîcheur » (valeurs par défaut : "Valeurs par défaut de la plateforme (aucun réglage propre à l'établissement)."), remplir :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Recouvrement : « Bon » à partir de (%) | `80` | oui |
   | Recouvrement : « À surveiller » à partir de (%) | `60` | oui |
   | Présence : « Bon » à partir de (%) | `85` | oui |
   | Présence : « À surveiller » à partir de (%) | `70` | oui |
   | Donnée "ancienne" au-delà de (heures) | `1` | oui |
5. Cliquer « Enregistrer les réglages », ouvrir `/v2/direction` et lire la barre de fraîcheur ; puis remettre `24` heures et enregistrer.
Résultat attendu : « La reconstruction est en file : elle sera exécutée par le worker. » ; le second clic donne « Une reconstruction est déjà en file. » si le worker n'a pas fini (sinon un second message "en file") ; « Les réglages sont enregistrés. » ; avec 1 heure et des données de plus d'une heure, la mention "Ces données datent de plus longtemps que le délai de fraîcheur de l'établissement : elles ne sont peut-être plus à jour." apparaît sur les écrans ; **ces réglages ne changent aucun chiffre**, seulement l'état affiché (« Bon », « À surveiller », « Critique ») et la péremption. Au retour de 24 h, l'avertissement disparaît.
Cas invalides : | Saisie | Message attendu |
|---|---|
| Champ "Recouvrement : À surveiller à partir de (%)" = `70` avec le champ "Bon" = `50` | "Le seuil À surveiller ne peut pas dépasser le seuil Bon." (le texte réel entoure les deux noms de guillemets français ; affiché sous le champ "À surveiller") |
| Champ "Présence : Bon à partir de (%)" = `150` | « Saisissez un pourcentage entre 0 et 100 (deux décimales au plus). » |
| Donnée ancienne = `500` | « Saisissez un nombre entier d'heures entre 1 et 168. » |
| Donnée ancienne = `0` ou `abc` | « Saisissez un nombre entier d'heures entre 1 et 168. » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : Directeur des études et Économe sur `/v2/owner/fraicheur` arrivent sur « Accès refusé »

#### 16.16 Les chiffres suivent les modules sources (donnée vivante)
Compte : Économe et Propriétaire · Où : `/v2/finance/payments/new` puis `/v2/owner/scolarite` · Prérequis : une facture impayée d'un élève de départ (par exemple un élève sans paiement : COULIBALY Moussa) ; le worker tourne.
1. Propriétaire : relever sur « Scolarité » : « Encaissé », « Restant dû », « Taux de recouvrement » et la date « Données au … » de `/v2/direction`.
2. Économe : enregistrer un paiement de `10000` F CFA sur cette facture (voir le chapitre Finance pour le formulaire d'encaissement).
3. Attendre une à deux minutes, recharger « Scolarité » et `/v2/direction`.
4. Même contrôle pour l'effectif : confirmer une inscription « En attente » (chapitre Inscriptions) et relire « Élèves en scolarité ».
Résultat attendu : « Encaissé » augmente de 10 000 F CFA, « Restant dû » diminue du même montant, le taux est recalculé, la date « Données au » avance ; « Élèves en scolarité » augmente de 1 après confirmation. Au-delà de deux minutes sans changement : noter l'écart (worker arrêté ou rafraîchissement bloqué, voir 16.15).
Cas invalides : | Saisie | Message attendu |
|---|---|
| Paiement se terminant par `013` (refusé par le fournisseur simulé) | Aucun changement des chiffres du tableau de bord |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : sans objet

## Scénarios : règles d'alerte et alertes

#### 16.17 Règles d'alerte de la graine
Compte : Propriétaire · Où : « Pilotage » > « Règles d'alerte » (`/v2/analytics/alertes/regles`) · Prérequis : seed intact.
1. Ouvrir « Règles d'alerte » (description "Pour chaque indicateur : deux seuils, un périmètre, les rôles prévenus et la fréquence maximale des rappels."). Lire la note sur la livraison des alertes.
2. Vérifier les trois règles du tableau « Règles d'alerte de l'établissement » : nom et indicateur, « Attention : sous 60 % » / « Critique : sous 30 % » (format exact du pourcentage à relever), destinataires, fréquence « Au plus un rappel par jour », badge « Active », colonne « Dernière évaluation ».
3. Si une règle affiche « Pas encore évaluée », attendre jusqu'à 15 minutes puis recharger.
Résultat attendu : les trois règles de la graine avec les seuils du tableau "Données de départ" ; après un passage de la tâche, « Dernière évaluation » indique « Dans les seuils », « Attention », « Critique », « Non mesuré » ou « Source indisponible ou périmée » (jamais évalué sur une donnée périmée) suivi de la date ; le Propriétaire n'est pas destinataire.
Cas invalides : | Saisie | Message attendu |
|---|---|
| Établissement sans règle | « Aucune règle d'alerte n'est configurée. » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : Directeur des études et Économe voient la liste sans « Nouvelle règle » ni « Modifier »

#### 16.18 Créer une règle d'alerte (effectif minimal)
Compte : Propriétaire · Où : « Règles d'alerte » > « Nouvelle règle » · Prérequis : 16.1 (relever la valeur N de « Élèves en scolarité »).
1. Cliquer « Nouvelle règle » (formulaire « Nouvelle règle d'alerte »).
2. Remplir :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Nom de la règle | `Effectif minimal test guide` | oui (3 à 120 caractères) |
   | Indicateur surveillé | « Effectif en scolarité » (aide : "L'alerte se déclenche quand la valeur passe sous le seuil.") | oui |
   | Seuil d'attention | `1000` (nombre entier) | oui, si pas de seuil critique |
   | Seuil critique | vide (facultatif ; plus grave que l'attention, donc inférieur ou égal) | non |
   | Fréquence des rappels | « Au plus un rappel par jour » | oui |
   | Rôles prévenus | cocher « Directeur » ; cocher aussi « Propriétaire » | oui (1 à 8) |
   | Autres rôles (clés séparées par des virgules) | vide | non |
   | Règle active | cochée | non |
3. Cliquer « Enregistrer la règle ».
4. Retrouver la ligne dans le tableau : "Attention : sous 1 000", destinataires "Directeur, Propriétaire", « Active », « Pas encore évaluée ».
Résultat attendu : « Règle enregistrée. » ; la ligne apparaît ; les champs de fenêtre ne sont pas proposés (indicateur du jour) ; sur un indicateur à fenêtre (« Taux de présence des élèves ») le champ « Fenêtre (jours) » apparaît avec la valeur par défaut 30 ; l'aide d'unité dit "Nombre entier." pour un effectif, "En pourcentage (ex. 85 ou 87,5)." pour un taux et "Montant entier en francs CFA (ex. 500000)." pour un montant.
Cas invalides : (voir 16.19)
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : Directeur des études et Économe n'ont pas le bouton « Nouvelle règle »

#### 16.19 Règles d'alerte : saisies invalides
Compte : Propriétaire · Où : « Nouvelle règle » · Prérequis : 16.18. Aucune règle n'est créée par ces essais.
1. Pour chaque ligne du tableau, ouvrir « Nouvelle règle », saisir, cliquer « Enregistrer la règle ».
Cas invalides : | Saisie | Message attendu |
|---|---|
| Nom `ab` (2 caractères) | « Le nom doit comporter de 3 à 120 caractères. » |
| Aucun indicateur choisi | « Choisissez un indicateur. » |
| « Taux de présence des élèves », attention `120` | « Un taux est compris entre 0 et 100 %. » |
| « Taux de présence des élèves », attention `85`, critique `90` | « Le seuil critique doit être inférieur ou égal au seuil d'attention. » |
| « Montant des impayés échus », attention `500000`, critique `100000` | « Le seuil critique doit être supérieur ou égal au seuil d'attention. » |
| Aucun seuil renseigné | « Renseignez au moins un seuil (attention ou critique). » |
| Seuil `abc` | « Saisissez un nombre valide. » |
| « Taux de présence des élèves », « Fenêtre (jours) » = `0` | « La fenêtre est un nombre de jours entre 1 et 365. » |
| Tous les rôles décochés | « Choisissez de 1 à 8 rôles valides. » |
| Autres rôles : `Directeur Général` (majuscules, espace) | « Choisissez de 1 à 8 rôles valides. » |
Résultat attendu : chaque message sous le champ concerné ; aucune règle ajoutée au tableau.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : sans objet

#### 16.20 Alerte déclenchée, détails et accusé de réception
Compte : Propriétaire · Où : « Pilotage » > « Alertes de direction » (`/v2/analytics/alertes`) · Prérequis : 16.18 ; attendre jusqu'à 15 minutes (passage de la tâche) puis recharger.
1. Ouvrir « Alertes de direction » (description "Seuils franchis par les indicateurs de l'établissement. Actives d'abord ; l'historique reste consultable."). Lire les trois cartes « Ouvertes », « Accusées de réception », « Résolues ».
2. Repérer la ligne de la règle `Effectif minimal test guide` : gravité « Attention », indicateur "Effectif en scolarité", valeur (par exemple 9) et "sous le seuil de 1 000", état « Ouverte », date « Ouverte le », colonne « Notifications ».
3. Cliquer « Détails » : lire « Ouverte le », « Dernière constatation », « Données au », « Valeur constatée », « Seuil franchi » et le tableau "Notifications émises pour cette alerte" (colonnes « Émise le », « Motif » = « Ouverture », « Gravité », « Valeur », « Rôles destinataires »).
4. Cliquer « Accuser réception » : le panneau "Accuser réception : Effectif minimal test guide" s'ouvre. Saisir la note `Alerte vue lors du test guide` (aucune donnée d'élève) puis « Confirmer l'accusé de réception ».
5. Filtrer par « État », « Gravité » et « Indicateur » (filtres « Tous les états », « Toutes les gravités », « Tous les indicateurs »).
6. Ouvrir aussi les alertes des règles de la graine : à la recette, l'alerte "Taux de recouvrement bas" était ouverte (taux bas).
Résultat attendu : l'alerte apparaît après un passage de l'évaluation (au plus 15 minutes) ; « Accusé de réception enregistré. » puis état « Accusée de réception » (le bouton disparaît ; les rappels s'arrêtent tant que la gravité reste la même) avec la note dans « Note d'accusé de réception » ; le panneau de détail se rouvre avec « Accusée de réception le ». Les filtres combinent leurs critères. Une liste vide « Aucune alerte pour ces filtres. » est correcte si aucun seuil n'est franchi.
Cas invalides : | Saisie | Message attendu |
|---|---|
| Note de plus de 500 caractères | Saisie plafonnée à 500 caractères |
| Filtres sans correspondance | « Aucune alerte pour ces filtres. » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : Chargé d'admissions sur `/v2/analytics/alertes` arrive sur « Accès refusé »

#### 16.21 Seuil strict : une valeur égale au seuil ne déclenche pas ; résolution de l'alerte
Compte : Propriétaire puis Directeur · Où : `/v2/analytics/alertes/regles` puis `/v2/analytics/alertes` · Prérequis : 16.20 (alerte ouverte ou accusée) ; N = « Élèves en scolarité » relevé en 16.1.
1. « Règles d'alerte » : cliquer « Modifier » sur `Effectif minimal test guide` (formulaire « Modifier la règle d'alerte » ; l'indicateur est grisé), mettre « Seuil d'attention » à `N` (la valeur exacte de l'effectif, par exemple `9`), « Enregistrer la règle ».
2. Attendre un passage (15 minutes), recharger « Alertes de direction » : l'alerte passe à « Résolue » avec « Résolue le » et « Valeur au retour à la normale ».
3. Remettre le seuil à `N+1` (par exemple `10`), enregistrer, attendre un passage : une nouvelle alerte s'ouvre (la valeur N est strictement inférieure à N+1).
4. Directeur (code MFA) : ouvrir « Messages » > cloche ou le fil « EcoleDigitale — alertes » : une notification de l'alerte est arrivée (rôle « Directeur »). Propriétaire (rôle coché aussi) : même vérification. Journal des envois (`/v2/notifications`, catégorie « Alertes ») : ligne d'origine « Alerte », gabarit "analytics_alert (version 0)".
5. Fin de scénario : « Modifier » la règle, décocher « Règle active », « Enregistrer la règle » ; après un passage l'alerte est « Résolue » (désactiver une règle résout son alerte en cours).
Résultat attendu : franchissement **strict** (égalité = pas d'alerte) ; une règle désactivée résout son alerte ; l'accusé de réception d'un épisode n'empêche pas la résolution ; les notifications respectent préférences, consentements et heures calmes des destinataires et restent « Simulé » pour les canaux externes ; aucun nom d'élève dans le message. Un échec "template_error" sur `analytics_alert` était un défaut corrigé (rapport 02, C-02-02).
Cas invalides : | Saisie | Message attendu |
|---|---|
| Modifier simultanément la même règle dans deux onglets | Conflit de version : message de l'API à relever en test (champ `rowVersion`) |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : sans objet

#### 16.22 Règle à fenêtre glissante (taux de présence) et périmètre
Compte : Propriétaire · Où : `/v2/analytics/alertes/regles` · Prérequis : 16.19. Désactiver la règle en fin de scénario.
1. « Nouvelle règle » :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Nom de la règle | `Absences élevées test guide` | oui |
   | Indicateur surveillé | « Taux de présence des élèves » | oui |
   | Seuil d'attention | `85` | non |
   | Seuil critique | `70` | non |
   | Fenêtre (jours) | `30` | oui pour cet indicateur |
   | Fréquence des rappels | « Au plus un rappel par semaine » | oui |
   | Rôles prévenus | « Directeur des études » | oui |
2. « Enregistrer la règle » ; la ligne affiche « Attention : sous 85 % », « Critique : sous 70 % ».
3. Attendre un passage : « Dernière évaluation » donne « Dans les seuils », « Attention », « Critique » ou « Non mesuré » ("Aucun appel soumis") selon les appels de la fenêtre.
4. Si l'établissement compte plusieurs établissements ou campus, vérifier la présence des listes « Établissement » et « Campus » (et l'obligation d'un campus pour la facturation : « Choisissez un campus : la facturation est suivie par campus. »). Sur le secondaire de démonstration ces listes sont absentes.
5. Fin : « Modifier » > décocher « Règle active » > « Enregistrer la règle ».
Résultat attendu : « Règle enregistrée. » ; un indicateur non mesuré (aucun appel) donne « Non mesuré » et **aucune alerte** ; il n'existe pas d'indicateur "taux d'absence" (seul « Taux de présence des élèves »), voir Écarts.
Cas invalides : | Saisie | Message attendu |
|---|---|
| Seuil critique `90` avec attention `85` | « Le seuil critique doit être inférieur ou égal au seuil d'attention. » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : sans objet

#### 16.23 Directeur des études : accuser réception d'une alerte de son domaine
Compte : Directeur des études · Où : `/v2/analytics/alertes` puis `/v2/analytics/alertes/regles` · Prérequis : une alerte de présence, de validation ou de vie scolaire ouverte (sinon créer la règle de 16.22 avec le Propriétaire et attendre).
1. Se connecter avec `etudes@secondaire-test.test` (MFA). « Alertes de direction » : seules les alertes de son domaine (présence, validation, vie scolaire) sont listées ; les alertes financières et d'effectif n'y sont pas.
2. Si une alerte est « Ouverte », « Accuser réception » avec une note facultative.
3. « Règles d'alerte » : consulter sans bouton « Nouvelle règle » ni « Modifier ».
Résultat attendu : filtrage par droit de données ; accusé possible ; configuration impossible. Une règle hors de son domaine (créances) n'apparaît pas dans sa liste.
Cas invalides : | Saisie | Message attendu |
|---|---|
| Alerte financière tapée par identifiant | Alerte introuvable (même réponse pour une alerte hors périmètre) |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : création de règle impossible

## Scénarios : droits et isolation

#### 16.24 Directeur des études : ce qu'il voit et ne voit pas
Compte : Directeur des études · Où : menu « Pilotage » · Prérequis : aucun.
1. Se connecter avec `etudes@secondaire-test.test` (MFA). Ouvrir le sélecteur « Modules » > « Pilotage » : seules « Pédagogie », « Admissions », « Vie scolaire (agrégée) », « Alertes de direction », « Règles d'alerte » sont proposées.
2. Ouvrir successivement `/v2/owner/pedagogie`, `/v2/analytics/admissions`, `/v2/analytics/vie-scolaire`, `/v2/analytics/alertes`, `/v2/analytics/alertes/regles` : contrôle de lecture, aucun bouton « Exporter (CSV) ».
3. Taper `/v2/direction`, `/v2/analytics`, `/v2/analytics/comparaisons`, `/v2/owner/scolarite`, `/v2/owner/tresorerie`, `/v2/owner/paie`, `/v2/owner/charges`, `/v2/owner/fraicheur`, `/v2/direction/effectifs`, et `/v2/owner` (qui redirige vers `/v2/direction`).
Résultat attendu : aucune donnée financière visible ; toutes les adresses de l'étape 3 arrivent sur « Accès refusé » ; la barre « Pilotage » ne montre que les écrans autorisés.
Cas invalides : | Saisie | Message attendu |
|---|---|
| `/v2/owner` | Redirection vers `/v2/direction` puis « Accès refusé » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : neuf adresses de l'étape 3

#### 16.25 Économe : finances oui, le reste non
Compte : Économe · Où : menu « Pilotage » · Prérequis : aucun.
1. Se connecter avec `econome@secondaire-test.test` (MFA). « Pilotage » : « Scolarité », « Trésorerie », « Alertes de direction », « Règles d'alerte ».
2. Ouvrir `/v2/owner/scolarite` et `/v2/owner/tresorerie` : lecture, pas d'export.
3. `/v2/analytics/alertes` : seules les alertes financières (recouvrement, impayés, écart de caisse) ; « Accuser réception » possible.
4. Taper `/v2/direction`, `/v2/owner/pedagogie`, `/v2/owner/paie`, `/v2/analytics/comparaisons`, `/v2/analytics/admissions`, `/v2/analytics/vie-scolaire`.
Résultat attendu : les six adresses de l'étape 4 arrivent sur « Accès refusé » ; l'Économe ne voit pas l'alerte de présence ni de validation.
Cas invalides : | Saisie | Message attendu |
|---|---|
| Règle d'alerte sur « Taux de présence » créée par l'Économe | Impossible : pas de bouton « Nouvelle règle » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : six adresses de l'étape 4

#### 16.26 Chargé d'admissions : entonnoir seulement
Compte : Chargé d'admissions · Où : `/v2/analytics/admissions` · Prérequis : aucun.
1. Se connecter avec `admissions@secondaire-test.test`. Ouvrir `/v2/analytics/admissions` : l'entonnoir est lisible, sans bouton d'export.
2. Taper `/v2/direction`, `/v2/owner/scolarite`, `/v2/analytics/alertes`, `/v2/analytics/vie-scolaire`, `/v2/owner/pedagogie`.
Résultat attendu : seule la page d'entonnoir répond ; les cinq autres adresses arrivent sur « Accès refusé » ; l'entonnoir ne nomme aucun candidat. (À vérifier : le menu « Pilotage » est-il proposé à ce rôle ?)
Cas invalides : | Saisie | Message attendu |
|---|---|
| Adresses de l'étape 2 | « Accès refusé » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : cinq adresses

#### 16.27 Autres rôles : aucun pilotage
Compte : Secrétariat, Enseignant, Parent, Élève · Où : barre d'adresse · Prérequis : une session par compte.
1. Pour chaque compte, taper `/v2/direction`, `/v2/analytics`, `/v2/analytics/alertes`, `/v2/owner/fraicheur`, `/v2/owner/paie`.
2. Vérifier que le sélecteur « Modules » ne propose pas « Pilotage ».
Résultat attendu : « Accès refusé » sur chaque adresse, sans donnée affichée avant la redirection ; pas de module « Pilotage ».
Cas invalides : | Saisie | Message attendu |
|---|---|
| Déconnecté, `/v2/direction` | Redirection vers `/login` |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : vingt adresses (4 comptes × 5)

#### 16.28 Isolation entre établissements, états vides et supérieur
Compte : Propriétaire du primaire, du supérieur · Où : `/v2/direction`, `/v2/analytics/vie-scolaire`, `/v2/analytics/admissions` · Prérequis : seed intact.
1. Se connecter sur École primaire Les Palmiers avec `direction.generale@primaire-test.test` (MFA) : relever « Élèves en scolarité » ; ouvrir « Vie scolaire (agrégée) » et « Admissions ».
2. Se connecter sur Université Horizon avec `direction.generale@superieur-test.test` : relever l'effectif, ouvrir « Admissions » (campagne `RENTREE-L1`) et « Pédagogie » (unités d'enseignement et éléments constitutifs, niveaux « Unité d'enseignement », « Élément constitutif »).
3. Avec la session d'un établissement, essayer d'ouvrir l'autre via son adresse propre.
Résultat attendu : les chiffres sont propres à chaque établissement ; la vie scolaire du primaire est vide (zéro ou « Non mesuré ») ; l'entonnoir du primaire ne concerne que la maternelle ; les règles d'alerte sont propres à chaque établissement (les trois règles de la graine existent dans chacun) ; une session ne donne jamais accès à un autre établissement.
Cas invalides : | Saisie | Message attendu |
|---|---|
| Session du secondaire sur l'adresse du primaire | Redirection vers la connexion ou refus, aucune donnée croisée |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : accès croisé impossible

## Données créées

(Reprises dans `_annexe-fragments/16-tableaux-de-bord.md`.)

| Enregistrement | Type | Scénario | Établissement |
|---|---|---|---|
| Règle d'alerte "Effectif minimal test guide" (désactivée en fin de test) | Règle d'alerte | 16.18, 16.21 | Collège Le Baobab |
| Règle d'alerte "Absences élevées test guide" (désactivée en fin de test) | Règle d'alerte | 16.22 | Collège Le Baobab |
| Alertes issues de ces règles (ouvertes, accusée, résolues) avec la note "Alerte vue lors du test guide" | Alertes | 16.20, 16.21 | Collège Le Baobab |
| Paiement de 10 000 F CFA sur une facture de départ | Paiement | 16.16 | Collège Le Baobab |
| Réglages d'affichage modifiés puis rétablis | Réglage | 16.15 | Collège Le Baobab |
| Fichiers CSV téléchargés (`analytics-*.csv`) | Fichiers locaux | 16.4 | poste de test |

## Écarts constatés

| Écran | Constat | Gravité |
|---|---|---|
| `/v2/direction/effectifs` | Rapport 02, C-02-01 : les deux nombres de chaque ligne de répartition sont collés et se lisent "86" pour 8 et 6 ; verdict "à faire" (séparer les valeurs). Non reconfirmé par lecture du code. | Mineur |
| `/v2/owner/fraicheur` | Rapport 02, C-02-10 : message "Aucune donnée n'a encore été calculée pour cet écran." au-dessus d'un tableau de sources « À jour » ; colonne « Périmètre » en clés techniques (`*`, dates, identifiants). Confirmé : le code affiche `scopeKey` tel quel. | Mineur |
| Graphiques d'effectifs et de trésorerie | Étiquettes de date abrégées ou tronquées ("10-25", "2026-") au lieu de "oct. 2025" (rapport 02, C-02-13). Confirmé : `d.day.slice(5)` et `m.month` bruts. | Mineur |
| Toutes les pages de pilotage | Pendant le chargement des droits et de l'offre, message "non inclus dans l'offre" affiché un instant (rapport 02, C-02-03, "à planifier"). | Mineur |
| `/v2/analytics/alertes/regles` | Libellé de rôle « Responsable des admissions » différent de « Chargé des admissions » utilisé partout ailleurs (rapport 02, C-02-14). Confirmé dans `fr-CI.json`. | Mineur |
| `/v2/analytics/alertes/regles` | Aucun indicateur "taux d'absence" : seul « Taux de présence des élèves » ; l'aide d'un seuil ne précise pas qu'il s'agit de présence (C-02-14). | Suggestion |
| `/v2/owner/scolarite` | La page « Scolarité » (regroupement « Apprenant ») et l'export `analytics-receivables-by-learner.csv` contiennent des noms d'élèves alors que le hub annonce "aucune donnée nominative". À documenter et réserver aux rôles autorisés. | Suggestion |
| Seed d'alertes | Les règles de la graine sont créées sans seuil officiel et sans destinataire Propriétaire ; l'alerte "Taux de recouvrement bas" s'ouvre dès le premier passage sur une base de démonstration (taux bas). | Suggestion |
| `/v2/analytics` | Le hub exige `analytics.read` : le Directeur des études et l'Économe n'ont pas de vue d'ensemble malgré leurs droits partiels (décision de spec 025 §9.4, à arbitrer). | Suggestion |

## À vérifier en test

- Format exact des pourcentages et montants ("60 %" ou "60,00 %", espaces avant "F CFA").
- 16.1 : détail du nombre de classes, cartes « Non mesuré » le jour du test.
- 16.7 : « Places offertes » restantes (le seed annonce 13 places) ; statut exact du dossier "accepté en attente de paiement" (« Accepté »).
- 16.8 : nombre exact d'« Incidents ouverts » selon l'état des incidents liés aux mesures.
- 16.11 : paiements en ligne simulés comptés ou non selon leur état final.
- 16.12 : l'offre inclut-elle `analytics.payroll-insights` ? fenêtre MFA présente ou non.
- 16.15 : second clic de reconstruction ("Une reconstruction est déjà en file.") dépend de la vitesse du worker.
- 16.20 : délai réel jusqu'à la première alerte (jusqu'à 15 minutes) et nombre d'alertes issues de la graine selon les données.
- 16.26 : le menu « Pilotage » est-il proposé au Chargé d'admissions ?

## Non couvert / limites connues

- **Campus multiples** : les sélecteurs « Établissement » et « Campus » et la règle "campus obligatoire pour la facturation" ne sont visibles qu'avec plusieurs établissements scolaires ou campus ; non couverts par le seed.
- **Années multiples** : comparaisons entre deux années réelles non couvertes (une seule année en démonstration).
- **Reconstruction nocturne** (03:10) et péremption à 24 h réelles : non attendues ; simulées par le réglage d'une heure (16.15).
- **Alertes d'autres indicateurs** (recouvrement, impayés, validation, écart de caisse, incidents et mesures de vie scolaire) : dépendent des données ; seuls l'effectif (16.18) et la présence (16.22) sont provoqués. Le taux de validation issu de règles de démonstration n'est jamais évalué (« Non mesuré »).
- **Mails d'alerte réels** : jamais envoyés ; vérification du statut « Simulé » seulement.
- **Droit de lecture hors périmètre campus** (utilisateur limité à un campus) : non couvert.
