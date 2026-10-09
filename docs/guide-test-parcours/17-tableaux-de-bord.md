[⬅ Sommaire](../GUIDE_TEST_UTILISATEUR_COMPLET.md) · [← Précédent](16b-messagerie-suite.md) · [Suivant →](18-portails-paiement.md)

# Phase 17 — Tableaux de bord et alertes

Objectif : vérifier que les chiffres du pilotage de direction recoupent les modules sources (inscriptions, présences, admissions, vie scolaire, résultats, finance), qu'une valeur non mesurée s'affiche « Non mesuré » (jamais un zéro inventé), puis créer une règle d'alerte, la voir se déclencher, l'accuser et la résoudre.

Précondition : le worker tourne (il rafraîchit les tableaux toutes les 30 secondes et **évalue les règles d'alerte toutes les 15 minutes**). Les valeurs de la graine (base neuve) sont citées à titre de repère ; les phases précédentes les ont modifiées (élèves créés, admissions, paiements) : toujours **recouper avec la liste du module source**, ne pas comparer à un nombre figé. Les résultats reposent sur un jeu de règles de démonstration : aucun chiffre pédagogique n'est officiel.

---

## Étape 315 — Lire le tableau de bord de la direction
👤 **propriétaire** (secondaire-test, `direction.generale@secondaire-test.test`, MFA) · fenêtre **A** · 📂 Menu **« Modules »** > **« Pilotage »** > **« Tableau de bord de la direction »** (`/v2/direction`)

1. Lire la ligne de fraîcheur « Données au … » et le bandeau « Règles de démonstration ».
2. Relever dans le tableau suivant les valeurs des cartes **« Élèves en scolarité »** (et son détail "n inscription(s) au total"), **« Présence aujourd'hui »**, **« Moyenne générale »**, **« Taux de validation »**, **« Enseignants et personnel présents »**.
3. Descendre à « Scolarité et créances » : relever **« Scolarité recouvrée »**, **« Encaissé »**, **« Créances (restant dû) »**.
4. Se reconnecter avec `directeur@secondaire-test.test` (MFA) et comparer.

| Carte | Valeur relevée |
| :--- | :--- |
| Élèves en scolarité (N) | |
| Encaissé (E0) | |
| Créances (R0) | |

✅ Les cartes sont renseignées ; une valeur non calculable (aucun appel validé aujourd'hui, aucun pointage du personnel) affiche « Non mesuré », jamais un zéro. Repère graine : 9 élèves en scolarité, détail "14 inscription(s) au total" ; ajouter les élèves inscrits depuis (par exemple KOUASSI Aïcha test guide). Moyenne et taux de validation portent sur la dernière période clôturée (période 1). Le directeur voit exactement les mêmes blocs, y compris le bloc financier.

⚠️ *Écart connu* : pendant le chargement des droits, un message "non inclus dans l'offre" peut s'afficher un instant (défaut connu, sans suite).

☐ OK ☐ KO

---

## Étape 316 — Créer la règle d'alerte "Effectif minimal"
👤 **propriétaire** · fenêtre **A** · 📂 Menu **« Pilotage »** > **« Règles d'alerte »** > **« Nouvelle règle »** (`/v2/analytics/alertes/regles`)

À faire tôt : l'évaluation prend jusqu'à 15 minutes ; poursuivre avec les étapes suivantes pendant l'attente.

1. Lire la liste : trois règles de la graine ("Créances en retard élevées", "Taux de recouvrement bas", "Taux de présence bas"). Cliquer **« Nouvelle règle »**.
2. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Nom de la règle | `Effectif minimal test guide` |
| Indicateur surveillé | « Effectif en scolarité » |
| Seuil d'attention | `1000` |
| Seuil critique | (vide) |
| Fréquence des rappels | « Au plus un rappel par jour » |
| Rôles prévenus | cocher « Directeur » et « Propriétaire » |
| Règle active | cochée |

3. Cliquer **« Enregistrer la règle »**.

✅ « Règle enregistrée. » ; la ligne apparaît avec "Attention : sous 1 000", destinataires "Directeur, Propriétaire", « Active », « Pas encore évaluée ». Les trois règles de la graine n'ont pas le Propriétaire pour destinataire.

⚠️ *Test d'erreur* : nom `ab` → « Le nom doit comporter de 3 à 120 caractères. » ; indicateur « Taux de présence des élèves », attention `85`, critique `90` → « Le seuil critique doit être inférieur ou égal au seuil d'attention. » ; aucun seuil → « Renseignez au moins un seuil (attention ou critique). ». Aucune règle n'est ajoutée par ces essais.

☐ OK ☐ KO

---

## Étape 317 — Recouper les effectifs avec les inscriptions
👤 **propriétaire** · fenêtre **A** · 📂 **« Pilotage »** > **« Effectifs et présences »** (`/v2/direction/effectifs`), puis `/v2/enrollments`

1. Lire « Élèves en scolarité », le détail "n inscription(s) tous statuts confondus", puis « Effectifs par classe » : pour `6E-A`, les colonnes « En scolarité », « Filles », « Garçons », « Inscriptions ».
2. Ouvrir la liste « Inscriptions » (`/v2/enrollments`, année en cours) : compter les lignes en « Active » (puis « Terminée »), puis toutes statuts confondus ; filtrer « Classe » = `6E-A`.
3. Revenir lire « Répartition des inscriptions » (« Par sexe », « Par niveau », « Par type de financement », « Par statut d'inscription »).

✅ « Élèves en scolarité » = nombre d'inscriptions « Active » + « Terminée » ; le total tous statuts = nombre de lignes de la liste sans filtre ; la somme des colonnes « En scolarité » de toutes les classes = « Élèves en scolarité » ; « Filles » + « Garçons » = « En scolarité » pour chaque classe ; chaque répartition totalise le nombre d'**inscriptions**. Un écart doit s'expliquer par le statut d'une inscription (par exemple « En attente »).

⚠️ *Test d'erreur* : filtre de classe sans élève → « Aucune inscription sur ce périmètre. ».

☐ OK ☐ KO

---

## Étape 318 — Recouper les présences
👤 **propriétaire** · fenêtre **A** · 📂 **« Effectifs et présences »** > bloc « Présences et assiduité »

1. Laisser la fenêtre par défaut (30 derniers jours) ou saisir « Du » = `08/09/2026`, « Au » = `08/10/2026`.
2. Lire « Taux de présence » (détail "n présents sur n pointages, du … au …"), « Absences », « Retards », « Séances d'appel » et le tableau « Présence par classe ».

✅ Le taux = présents ÷ pointages affichés dans le détail ; il recoupe les séances d'appel validées au module Présences. Sans appel validé sur la fenêtre : « Aucun appel soumis sur ce périmètre. ». La présence du personnel non mesurée affiche "La présence du personnel n'est pas mesurée sur cette fenêtre.".

⚠️ *Écart connu* : étiquettes de date abrégées dans les graphiques ("10-25", "2026-") : défaut connu, sans suite.

☐ OK ☐ KO

---

## Étape 319 — Recouper l'entonnoir d'admission
👤 **propriétaire** · fenêtre **A** · 📂 **« Pilotage »** > **« Admissions »** (`/v2/analytics/admissions`), puis `/v2/admissions`

1. Lire la note sur le comptage par statut actuel, puis les cartes « Dossiers déposés », « Acceptés (dont inscrits) », « Inscrits », « Taux d'acceptation », « Taux d'inscription », « Places offertes ».
2. Lire « Par statut » (« Brouillon », « Déposé », « En étude », « Pièce manquante », « Accepté », « Refusé », « Liste d'attente », « Inscrit ») et « Campagnes » (`RENTREE-6E`).
3. Ouvrir la liste des candidatures (`/v2/admissions`) et compter par statut.

✅ Chaque statut recoupe le module Admissions ; aucun candidat n'est nommé. Repère graine : 8 déposés (9 dossiers brouillon compris), 3 acceptés dont inscrits, 1 inscrit, 13 places ; ajouter les candidatures créées à la phase Admissions (par exemple Awa COULIBALY test guide).

☐ OK ☐ KO

---

## Étape 320 — Recouper la vie scolaire agrégée
👤 **propriétaire** · fenêtre **A** · 📂 **« Pilotage »** > **« Vie scolaire (agrégée) »** (`/v2/analytics/vie-scolaire`), puis `/v2/schoollife`

1. Lire la note "Comptages uniquement : aucun élève n'est nommé, aucun motif n'est lu…", puis les cartes « Incidents ouverts », « Mesures à valider », « Exclusions en cours », « Convocations à tenir ».
2. Comparer avec le module Vie scolaire (`/v2/schoollife`) : incidents ouverts et mesures proposées.

✅ Les comptages recoupent le module source ; aucun nom, aucun motif. Repère graine : « Mesures à valider » = 1 (l'exclusion proposée), « Exclusions en cours » = 0 (les exclusions commencent demain), « Incidents ouverts » = 2 (à confirmer selon l'état des incidents).

☐ OK ☐ KO

---

## Étape 321 — Recouper la pédagogie
👤 **propriétaire** · fenêtre **A** · 📂 **« Pilotage »** > **« Pédagogie »** (`/v2/owner/pedagogie`), puis `/v2/results`

1. Lire les cartes « Moyenne générale », « Taux de validation », « Résultats clôturés », « Classes clôturées » et le tableau « Résultats par classe » (colonnes « Classe », « Niveau », « Résultats », « Moyenne », « Validation »).
2. Dans « Période », choisir la période 1, puis la période 2 (non clôturée), puis « Classe » = `6E-A`.
3. Comparer la moyenne et le nombre de résultats de `6E-A` avec le module Résultats (`/v2/results`).

✅ Valeurs recoupées avec le module Résultats ; période 2 non clôturée : "Aucun résultat clôturé pour ce périmètre." (jamais un zéro à la place de « Non mesuré »). Les moyennes issues de règles de démonstration sont étiquetées comme telles.

☐ OK ☐ KO

---

## Étape 322 — Recouper la scolarité avec la finance
👤 **propriétaire** · fenêtre **A** · 📂 **« Pilotage »** > **« Scolarité »** (`/v2/owner/scolarite`), puis `/v2/finance/invoices`

1. Lire « Taux de recouvrement », « Facturé », « Avoirs », « Encaissé », « Restant dû », « En retard », « Paiements non imputés ».
2. Dans « Créances », « Regrouper par » = « Classe » puis « Apprenant ».
3. Dans les factures (`/v2/finance/invoices`, année en cours), additionner « Total », « Payé » et « Reste dû ».
4. **Noter** « Encaissé » (E1), « Avoirs » (A1) et « Restant dû » (R1) pour la phase *Portails parent, élève, enseignant ; paiement et remboursement*.

✅ « Facturé » − « Avoirs » = base du taux ; « Encaissé » = somme des paiements imputés ; « Restant dû » = somme des « Reste dû » des factures ; taux = encaissé ÷ facturé net, affiché avec son état (« Bon », « À surveiller », « Critique » selon 80 % / 60 %) — « Critique » probable sur la base de démonstration. Un écart s'explique par des avoirs ou des paiements non imputés.

☐ OK ☐ KO

---

## Étape 323 — Lire la trésorerie
👤 **propriétaire** · fenêtre **A** · 📂 **« Pilotage »** > **« Trésorerie »** (`/v2/owner/tresorerie`)

1. Dans « Encaissements », laisser « Du » / « Au » vides et tester « Regroupement » = « Par jour », « Par semaine », « Par mois ». Lire « Encaissé », « Remboursé », « Net », « Paiements ».
2. Lire « Créances âgées » (« Non échu », « 1 à 30 jours », « 31 à 60 jours », « 61 à 90 jours », « Plus de 90 jours ») et « Écarts de caisse ».
3. Comparer « Encaissé » avec `/v2/finance/payments` (sans les paiements refusés ou en attente).

✅ « Net » = « Encaissé » − « Remboursé » ; les paiements réussis sont comptés, les paiements refusés ou en attente non ; « Écarts de caisse » : "Aucune session de caisse." tant qu'aucune session n'a été clôturée (les sessions de la phase Finance apparaissent sinon).

☐ OK ☐ KO

---

## Étape 324 — Hub des indicateurs, masse salariale et charges
👤 **propriétaire** (code MFA si « Confirmez votre identité » apparaît) · fenêtre **A** · 📂 **« Pilotage »** > **« Indicateurs de direction »** (`/v2/analytics`), **« Masse salariale »** (`/v2/owner/paie`), **« Charges et résultat »** (`/v2/owner/charges`)

1. Hub : parcourir les huit blocs (« Effectifs et inscriptions », « Assiduité », « Résultats par période », « Recouvrement et impayés », « Admissions », « Vie scolaire (agrégée) », « Alertes de direction », « Charge de paie »). Dans « Charge de paie », cliquer **« Afficher la masse salariale »**.
2. Ouvrir « Masse salariale » et lire le tableau « Masse salariale par période de paie ».
3. Ouvrir « Charges et résultat ».

✅ Hub : chaque bloc porte sa fraîcheur, aucune donnée nominative. Masse salariale : donnée sensible (lecture auditée) ; sans période de paie « Aucune période de paie. », sinon les montants recoupent le module Paie. Charges : titre d'avertissement "Module de charges absent" et la liste « Ce qui n'est pas mesuré » ; **aucun montant à zéro inventé**.

⚠️ *Test d'erreur* : code MFA incorrect → "Code invalide. Vérifiez l'heure de votre téléphone, puis attendez le prochain code.".

☐ OK ☐ KO

---

## Étape 325 — Exporter en CSV
👤 **propriétaire**, puis **directeur des études** · fenêtre **A** · 📂 **« Effectifs et présences »** et **« Scolarité »**

1. Propriétaire : sur `/v2/direction/effectifs`, cliquer **« Exporter (CSV) »** dans « Répartition des inscriptions » (`analytics-enrollment-by-classroom.csv`) ; sur `/v2/owner/scolarite`, exporter « Créances » en regroupement « Apprenant » (`analytics-receivables-by-learner.csv`).
2. Ouvrir les fichiers dans un tableur, puis `/v2/audit` pour chercher les exports.
3. Directeur des études : ouvrir `/v2/owner/pedagogie` et chercher « Exporter (CSV) ».

✅ Fichiers séparés par des points-virgules, accents lisibles, première ligne d'en-têtes ; l'export d'effectifs ne contient aucun nom d'élève, **l'export des créances par apprenant en contient** (donnée nominative à manipuler avec précaution) ; chaque export est tracé dans le journal d'audit ; le directeur des études n'a **aucun** bouton d'export.

☐ OK ☐ KO

---

## Étape 326 — Fraîcheur des données et reconstruction
👤 **propriétaire** · fenêtre **A** · 📂 **« Pilotage »** > **« Fraîcheur des données »** (`/v2/owner/fraicheur`)

Noter la valeur d'origine du champ "Donnée ancienne au-delà de (heures)" (24).

1. Lire la file "En file : n · en échec : n · source indisponible : n" et le tableau « État de la lecture des sources » (états « À jour », « Échec », « Source indisponible »).
2. Cliquer **« Reconstruire depuis les sources »**, puis recharger après une minute.
3. Dans « Seuils de lecture et fraîcheur », mettre "Donnée ancienne au-delà de (heures)" à `1`, **« Enregistrer les réglages »**, ouvrir `/v2/direction` et lire la barre de fraîcheur ; puis remettre `24` et enregistrer.

✅ « La reconstruction est en file : elle sera exécutée par le worker. » ; la « Dernière lecture réussie » avance ; « Les réglages sont enregistrés. ». Avec 1 heure, la mention "Ces données datent de plus longtemps que le délai de fraîcheur de l'établissement : elles ne sont peut-être plus à jour." peut apparaître ; **ces réglages ne changent aucun chiffre**. Réglage remis à 24 en fin d'étape.

⚠️ *Test d'erreur* : `500` ou `0` → « Saisissez un nombre entier d'heures entre 1 et 168. ».

☐ OK ☐ KO

---

## Étape 327 — Comparer deux périodes
👤 **propriétaire** · fenêtre **A** · 📂 **« Pilotage »** > **« Comparaisons »** (`/v2/analytics/comparaisons`)

1. Avant tout choix : "Choisissez les deux côtés de la comparaison pour l'afficher.".
2. « Indicateur » = « Résultats » : « Période de référence » = période 1, « Période comparée » = période 2.
3. « Indicateur » = « Assiduité » : référence du `01/09/2026` au `15/09/2026`, comparée du `16/09/2026` au `08/10/2026`.

✅ Tableau "Comparaison" (« Indicateur », « Référence », « Comparée », « Écart », « Variation ») ; un côté sans mesure affiche « Non mesuré » et non zéro ; variation « — » quand la référence est nulle.

☐ OK ☐ KO

---

## Étape 328 — Alerte déclenchée : détails et accusé de réception
👤 **propriétaire** · fenêtre **A** · 📂 **« Pilotage »** > **« Alertes de direction »** (`/v2/analytics/alertes`)

Précondition : 15 minutes au plus se sont écoulées depuis l'étape *Créer la règle d'alerte "Effectif minimal"*. Sinon, recharger plus tard.

1. Lire les cartes « Ouvertes », « Accusées de réception », « Résolues ». Repérer la ligne `Effectif minimal test guide` : gravité « Attention », valeur N, "sous le seuil de 1 000", état « Ouverte ».
2. Cliquer **« Détails »** : « Ouverte le », « Dernière constatation », « Valeur constatée », « Seuil franchi », tableau "Notifications émises pour cette alerte" (« Motif » = « Ouverture »).
3. Cliquer **« Accuser réception »**, saisir la note `Alerte vue lors du test guide`, puis **« Confirmer l'accusé de réception »**.
4. Ouvrir aussi les alertes issues de la graine (par exemple "Taux de recouvrement bas", ouverte dès le premier passage sur une base de démonstration).

✅ « Accusé de réception enregistré. » puis état « Accusée de réception » avec la note ; la valeur de la ligne est égale à N relevé à la première étape. Filtres « Tous les états », « Toutes les gravités », « Tous les indicateurs » combinables ; « Aucune alerte pour ces filtres. » si rien ne correspond.

☐ OK ☐ KO

---

## Étape 329 — Seuil strict et résolution de l'alerte
👤 **propriétaire**, puis **directeur** · fenêtre **A** · 📂 **« Règles d'alerte »** (`/v2/analytics/alertes/regles`) puis **« Alertes de direction »**

1. **« Modifier »** la règle `Effectif minimal test guide`, mettre « Seuil d'attention » à `N` (la valeur exacte de l'effectif relevée), **« Enregistrer la règle »**. Attendre un passage (15 minutes), recharger les alertes.
2. Remettre « Seuil d'attention » à `N+1`, enregistrer, attendre un passage.
3. Directeur : ouvrir la cloche de la section Communication (ou le fil « EcoleDigitale — alertes ») ; propriétaire : même vérification.
4. Fin d'étape : **« Modifier »** la règle, décocher « Règle active », **« Enregistrer la règle »** ; après un passage, l'alerte est « Résolue ».

✅ Franchissement **strict** : avec le seuil `N` l'alerte passe à « Résolue » (« Résolue le », « Valeur au retour à la normale ») ; avec `N+1` une nouvelle alerte s'ouvre. Directeur et propriétaire (rôles cochés) reçoivent une notification, sans nom d'élève. Désactiver une règle résout son alerte ; l'accusé de réception d'un épisode n'empêche pas la résolution.

☐ OK ☐ KO

---

## Étape 330 — Directeur des études : les alertes de son domaine
👤 **directeur des études** (`etudes@secondaire-test.test`, MFA) · fenêtre **A** · 📂 **« Pilotage »** > **« Alertes de direction »**

1. Ouvrir le menu « Pilotage » : seules « Pédagogie », « Admissions », « Vie scolaire (agrégée) », « Alertes de direction », « Règles d'alerte » sont proposées.
2. Ouvrir « Alertes de direction » : seules les alertes de son domaine (présence, validation, vie scolaire) sont listées ; si une est « Ouverte », cliquer **« Accuser réception »**.
3. Ouvrir « Règles d'alerte ».

✅ Aucune alerte financière ni d'effectif ; l'accusé est possible ; pas de bouton « Nouvelle règle » ni « Modifier ».

☐ OK ☐ KO

---

## Étape 331 — Contrôler les droits sur le pilotage
👤 **directeur des études**, **économe**, **chargé d'admissions**, **secrétariat**, **enseignant**, **parent** · fenêtre **A** (gestion) et **B** · 📂 adresses tapées à la main

| Compte | Adresses à taper | Attendu |
| :--- | :--- | :--- |
| Directeur des études | `/v2/direction`, `/v2/analytics`, `/v2/owner/scolarite`, `/v2/owner/paie`, `/v2/owner/fraicheur` | « Accès refusé » |
| Économe (`econome@secondaire-test.test`, MFA) | `/v2/direction`, `/v2/owner/pedagogie`, `/v2/owner/paie`, `/v2/analytics/vie-scolaire` | « Accès refusé » ; `/v2/owner/scolarite` et `/v2/owner/tresorerie` s'ouvrent, sans export |
| Chargé d'admissions | `/v2/direction`, `/v2/owner/scolarite`, `/v2/analytics/alertes` | « Accès refusé » ; `/v2/analytics/admissions` s'ouvre |
| Secrétariat, enseignant, parent | `/v2/direction`, `/v2/analytics/alertes`, `/v2/owner/paie` | « Accès refusé », pas de module « Pilotage » |
| Déconnecté | `/v2/direction` | redirection vers `/login` |

✅ Toute page refusée affiche « Accès refusé » sans donnée avant la redirection ; `/v2/owner` redirige vers `/v2/direction`.

📚 *Pour aller plus loin* : chapitre 16, scénarios 16.16 (les chiffres suivent un paiement), 16.22 (règle à fenêtre glissante sur le taux de présence), 16.28 (isolation et supérieur).

**Ce que la phase laisse dans l'application :** règle d'alerte `Effectif minimal test guide` (désactivée en fin d'étape) ; alertes issues de cette règle (ouverte, accusée avec la note `Alerte vue lors du test guide`, résolue) ; réglage "Donnée ancienne" remis à 24 heures ; fichiers CSV `analytics-*.csv` téléchargés sur le poste ; relevés E0/R0 (tableau de bord) et E1/A1/R1 (Scolarité) à reprendre à la phase suivante.

---

[⬅ Sommaire](../GUIDE_TEST_UTILISATEUR_COMPLET.md) · [← Précédent](16b-messagerie-suite.md) · [Suivant →](18-portails-paiement.md)
