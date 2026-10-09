[⬅ Sommaire](../GUIDE_TEST_UTILISATEUR_COMPLET.md) · [← Précédent](13b-examens-suite.md) · [Suivant →](15-documents-ged.md)

# Phase 14 — Paie d'un enseignant

L'économe configure la paie de l'enseignant TRAORE Kouadio, calcule la période "Septembre test guide", ajuste le bulletin ; le directeur arrête le montant, l'économe constate le versement ; l'enseignant consulte son bulletin ; un second cycle (octobre) montre la séparation des tâches, la contestation et la masse salariale.

Précondition : aucune donnée de paie n'est semée (listes vides). Enseignants du collège : **TRAORE Kouadio** (compte `enseignant@secondaire-test.test`, seul à se connecter), YAO Fatou et KOUAME Adjoua (fiches sans compte) ; relire leurs noms dans la liste du personnel. Dates : J = jeudi 8 octobre 2026, la période d'octobre (01/10/2026 au 31/10/2026) contient le jour du pointage. Montants en F CFA entiers, pas de règle officielle de cotisations ou d'impôt.

## Étape 254 — Lire l'état initial des écrans de paie
👤 **économe** (secondaire-test, `econome@secondaire-test.test`, MFA) · fenêtre **A** · 📂 Menu **« Bulletins de paie »** (`/v2/payroll`)

1. Se connecter en économe. Lire le titre « Périodes de paie » et la barre de section (« Périodes », « Bulletins », « Configuration », « Historique », « Rapports »).
2. Ouvrir successivement « Bulletins » (`/v2/payroll/payslips`), « Historique » (`/v2/payroll/history`), « Configuration » (`/v2/payroll/configuration`) et « Rapports » (`/v2/payroll/reports`).

✅ « Aucune période de paie » / « Créez la première période pour calculer les bulletins. » ; « Aucun bulletin » ; « Aucun bulletin arrêté » ; « Aucune configuration » avec "Un enseignant sans configuration est écarté du calcul de la paie." ; « Aucune donnée pour ces filtres ». Aucune erreur. (Si la base a déjà servi, les listes peuvent contenir d'autres lignes.)

☐ OK ☐ KO

---

## Étape 255 — Lire les réglages de la paie (propriétaire)
👤 **propriétaire** (secondaire-test, `direction.generale@secondaire-test.test`, MFA) · fenêtre **A** · 📂 **« Bulletins de paie »** > **« Configuration »** > **« Réglages »** (`/v2/payroll/configuration/settings`)

1. Se connecter en propriétaire. Lire « Devise : XOF » et les valeurs de départ : « Seuil d'heures supplémentaires par défaut (minutes par semaine) » = `2400`, « Majoration par défaut » = `1,5`, « Séparation des tâches » décochée, « Seuil de validation par le propriétaire » vide.
2. Saisir une majoration `6`, cliquer **« Enregistrer les réglages »**.
3. Remettre `1,5`, cliquer **« Enregistrer les réglages »**.

✅ Étape 2 : "Le coefficient doit être compris entre 1 et 5." (rien n'est enregistré). Étape 3 : « Les réglages ont été enregistrés. » ; les valeurs de départ sont conservées après rechargement.

🔒 *Test de droit* : en tant qu'économe (puis directeur), taper `/v2/payroll/configuration/settings` → page « Accès refusé » (les réglages restent au propriétaire).

☐ OK ☐ KO

---

## Étape 256 — Configurer la paie de TRAORE Kouadio et de YAO Fatou
👤 **économe** (secondaire-test) · fenêtre **A** · 📂 **« Configuration »** > **« Configurations »** (`/v2/payroll/configuration`)

1. Cliquer **« Nouvelle configuration »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Enseignant | `TRAORE Kouadio` |
| Type de rémunération | « Mixte » |
| Salaire mensuel | `150000` |
| Tarif horaire par défaut | `3000` |
| Seuil d'heures supplémentaires (minutes par semaine) | `1` |
| Majoration des heures supplémentaires | `2` |
| En vigueur à partir du | `01/08/2026` |

2. Cliquer **« Enregistrer »**.
3. Créer la configuration de **YAO Fatou** : Type « Horaire », Tarif horaire par défaut `3000`, En vigueur à partir du `01/08/2026` > **« Enregistrer »**.
4. Ne pas configurer KOUAME Adjoua. Dans « Situation d'un enseignant », choisir TRAORE Kouadio puis KOUAME Adjoua.

✅ « La configuration a été enregistrée. » à chaque fois. Ligne TRAORE : Type « Mixte », « Salaire mensuel » 150 000 F CFA, « Tarif horaire par défaut » 3 000 F CFA, « Heures supplémentaires » "au-delà de 0 h 01/semaine, ×2" (le seuil de 1 minute est une valeur de test qui produira des heures supplémentaires avec deux minutes de pointage), « Validité » « Depuis le 01/08/2026 ». « Situation d'un enseignant » : « Configuration en cours » pour TRAORE ; « Aucune configuration » pour KOUAME.

⚠️ *Test d'erreur* : seconde configuration de TRAORE débutant le `01/09/2026` → "Une autre configuration de paie couvre déjà ces dates pour cet enseignant." ; Type « Salaire » sans salaire → "Une configuration salariale ou mixte exige un salaire mensuel ou annuel.".

☐ OK ☐ KO

---

## Étape 257 — Définir les tarifs horaires et les simuler
👤 **économe** (secondaire-test) · fenêtre **A** · 📂 **« Configuration »** > **« Tarifs horaires »** (`/v2/payroll/configuration/rates`)

1. Attendu : « Aucun tarif ». Cliquer **« Nouveau tarif »** : Cours "Mathématiques" (de la liste), Enseignant (tarif nominatif) vide, Tarif horaire `4000`, Valide à partir du `01/09/2026`, Notes `Tarif générique test guide` > **« Enregistrer »**.
2. Créer le tarif nominatif : même cours, Enseignant (tarif nominatif) `TRAORE Kouadio`, Tarif horaire `5000`, Valide à partir du `01/09/2026`, Notes `Tarif nominatif test guide` > **« Enregistrer »**.
3. Dans « Simulateur de tarif », cliquer **« Simuler »** pour : (a) TRAORE Kouadio + Mathématiques + aujourd'hui ; (b) YAO Fatou + Mathématiques + aujourd'hui ; (c) KOUAME Adjoua, cours vide.

✅ « Le tarif a été enregistré. » ×2. (a) « Tarif retenu : 5 000 F CFA par heure » (tarif du cours pour cet enseignant) ; (b) « Tarif retenu : 4 000 F CFA par heure » (tarif générique du cours) ; (c) « Aucun tarif applicable. Aucune configuration. ». Un simple pointage d'arrivée et de départ n'a pas de cours : il se paie au tarif par défaut de la configuration (3 000 F CFA).

⚠️ *Test d'erreur* : Tarif horaire `4000,5` → "Le montant est un entier en francs : pas de virgule ni de point.".

☐ OK ☐ KO

---

## Étape 258 — Créer la période "Septembre test guide"
👤 **économe** (secondaire-test) · fenêtre **A** · 📂 **« Périodes »** (`/v2/payroll`) > **« Nouvelle période »**

1. Cliquer **« Nouvelle période »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Nom | `Septembre test guide` |
| Du | `01/09/2026` |
| Au | `30/09/2026` |
| Année scolaire | l'année en cours (2026-2027) |
| Description | `Période de test du guide` |

2. Cliquer **« Créer la période »**.

✅ Bandeau "La période ‹ Septembre test guide › a été créée." ; la ligne affiche « Du 01/09/2026 au 30/09/2026 », « Collective », les badges « Brouillon » et « En attente de calcul » ; un avertissement indique que la période est en attente de calcul (lien « Ouvrir la période ») et le bouton « Nouvelle période » est désactivé.

⚠️ *Test d'erreur* : « Au » = `31/08/2026` avec « Du » = `01/09/2026` → "La date de fin précède la date de début.".

☐ OK ☐ KO

---

## Étape 259 — Aperçu puis calcul de la période
👤 **économe** (secondaire-test) · fenêtre **A** · 📂 clic sur le nom de la période (`/v2/payroll/periods/<identifiant>`)

1. Dans « Calcul de la paie », laisser « Origine des heures » sur « Toutes les origines » et cliquer **« Aperçu (sans enregistrer) »**.
2. Cliquer **« Lancer le calcul »**.
3. Recliquer **« Lancer le calcul »** (sans cocher « Recalculer les bulletins déjà calculés »).

✅ Étape 1 : « Aperçu : aucun bulletin n'a été créé ni modifié. » ; TRAORE Kouadio « Calculé » à 150 000 F CFA (« Salaire » 150 000, aucune ligne d'heures) ; YAO Fatou « Écarté » ("Aucune heure validée sur la période.") ; KOUAME Adjoua « Écarté » ("Aucune configuration de paie valide sur la période."). Étape 2 : « Compte rendu du calcul » avec « Calculés » 1 ; la période passe à « Active » ; « Bulletins de la période » liste TRAORE Kouadio (« Mixte », « Calculé », 150 000 F CFA) ; « Nouvelle période » est de nouveau actif. Étape 3 : TRAORE est « Écarté » avec "Déjà calculé : cochez recalculer pour le reconstruire" (aucun doublon).

⚠️ *Écart connu* : le motif d'écart s'affiche deux fois (libellé puis message de l'API).

☐ OK ☐ KO

---

## Étape 260 — Ajouter une prime et une retenue
👤 **économe** (secondaire-test) · fenêtre **A** · 📂 clic sur le nom de TRAORE Kouadio dans « Bulletins de la période » (`/v2/payroll/payslips/<identifiant>`)

1. Lire « Bulletin de TRAORE Kouadio », badge « Calculé », « Aucune ligne d'heures (bulletin de salaire). ».
2. Dans « Primes et retenues », cliquer **« Ajouter une prime ou une retenue »** :

| Champ | Valeur |
| :--- | :--- |
| Nature | « Prime » |
| Montant | `10000` |
| Libellé | `Prime d'assiduité test guide` |
| Motif | `Assiduité de septembre` |

3. Cliquer **« Ajouter »**. Ajouter ensuite : Nature « Retenue », Montant `2000`, Libellé `Avance sur salaire test guide`.

✅ « L'ajustement a été ajouté. » ; lignes "Prime — Prime d'assiduité test guide" (+ 10 000 F CFA) et "Retenue — Avance sur salaire test guide" (− 2 000 F CFA) ; « Primes » 10 000, « Retenues » 2 000, **Total = 158 000 F CFA** (150 000 + 10 000 − 2 000).

⚠️ *Test d'erreur* : Montant `1500,5` → "Le montant est un entier en francs : pas de virgule ni de point." ; retenue de `999999` → "Les retenues dépassent le montant du bulletin.".

☐ OK ☐ KO

---

## Étape 261 — L'économe ne peut ni arrêter, ni contester, ni annuler
👤 **économe** (secondaire-test) · fenêtre **A** · 📂 fiche du bulletin de TRAORE Kouadio, puis fiche de la période

1. Sur la fiche du bulletin, chercher « Arrêter le montant », « Contester », « Annuler le bulletin ».
2. Sur la fiche de la période, dans « Bulletins de la période », chercher « Arrêter la sélection (0) » et « Tout arrêter ».

✅ Ces cinq boutons sont **absents** pour l'économe ; « Verser la sélection (0) » et « Tout verser » sont présents. L'indication sur la séparation des tâches et le seuil du propriétaire reste affichée.

☐ OK ☐ KO

---

## Étape 262 — L'enseignant ne voit pas un bulletin « Calculé »
👤 **enseignant** (secondaire-test, `enseignant@secondaire-test.test`, sans MFA) · fenêtre **B** · 📂 Menu **« Mes bulletins de paie »** (`/v2/teacher/payslips`)

1. Se connecter en TRAORE Kouadio (enseignant) et ouvrir le menu.

✅ Encart "Vous voyez vos bulletins à partir de l'arrêt du montant : un brouillon calculé reste réservé à la gestion." ; « Aucun bulletin » ; « Vos bulletins apparaîtront ici dès que leur montant sera arrêté. ».

🔒 *Test de droit* : en tant qu'enseignant, taper `/v2/payroll` → page « Accès refusé ».

☐ OK ☐ KO

---

## Étape 263 — Le directeur arrête le montant du bulletin
👤 **directeur** (secondaire-test, `directeur@secondaire-test.test`, MFA) · fenêtre **A** · 📂 **« Bulletins de paie »** > **« Bulletins »** > TRAORE Kouadio

1. Se connecter en directeur. Sur la fiche du bulletin, cliquer **« Arrêter le montant »**.
2. Dans la fenêtre « Arrêter ce bulletin de paie ? » (« Le montant arrêté devient le montant à payer ; il ne pourra plus être recalculé. »), cliquer **« Arrêter le montant »**.

✅ « Le montant du bulletin est arrêté. » ; badge « Arrêté (impayé) » ; « Calculé » par l'économe et « Arrêté » par le directeur ; bloc « Bulletin arrêté » avec le filigrane "NON VERSÉ", « Intégrité vérifiée », Salaire 150 000, Primes 10 000, Retenues 2 000, Total 158 000 F CFA et une « Empreinte SHA-256 : ». Plus de bouton « Ajouter une prime ou une retenue ». Sont proposés : « Constater le versement », « Contester », « Annuler le bulletin », « Envoyer au titulaire ».

☐ OK ☐ KO

---

## Étape 264 — L'enseignant voit son bulletin arrêté
👤 **enseignant** (secondaire-test) · fenêtre **B** · 📂 **« Mes bulletins de paie »** (`/v2/teacher/payslips`)

1. Recharger la page, cliquer la date du bulletin.
2. Lire le bloc « Bulletin arrêté », puis cliquer **« Télécharger le PDF »**.

✅ Une ligne : statut « Arrêté (impayé) », « Primes » 10 000 F CFA, « Retenues » 2 000 F CFA, « Montant » 158 000 F CFA, « Versé le » « Pas encore versé ». Fiche : « Bulletin de paie », « Retour à mes bulletins », « Contester ce bulletin », badge "NON VERSÉ". Le téléchargement échoue avant le versement : "Le PDF officiel n'est disponible qu'une fois le bulletin versé ; utilisez l'aperçu imprimable en attendant.".

⚠️ *Écart connu* : le bouton « Télécharger le PDF » est proposé avant le versement alors que le PDF n'existe qu'après (erreur 409).

☐ OK ☐ KO

---

## Étape 265 — Constater le versement par virement
👤 **économe** (secondaire-test) · fenêtre **A** · 📂 fiche du bulletin de TRAORE Kouadio (« Arrêté (impayé) »)

1. Cliquer **« Constater le versement »**.
2. Saisir « Mode de versement » = « Virement bancaire » et « Référence » = `VIR-TG-001`.
3. Cliquer **« Constater le versement »** dans la fenêtre, puis **« Envoyer au titulaire »**.
4. Enseignant (fenêtre **B**) : recharger `/v2/teacher/payslips`, ouvrir le bulletin, cliquer **« Télécharger le PDF »**.

✅ « Le versement est constaté. » ; badge « Versé » ; mention "Virement bancaire · VIR-TG-001" ; les boutons « Annuler le bulletin » et « Contester » disparaissent (un bulletin versé ne s'annule pas) ; « L'envoi du bulletin à son titulaire a été demandé. » (demande enregistrée, aucun envoi réel). Enseignant : « Versé le » affiche la date, le filigrane "NON VERSÉ" disparaît, « Contester ce bulletin » n'est plus proposé, le PDF scellé se télécharge (sinon « Le document est en cours de préparation. Réessayez dans quelques instants. » *(à vérifier)*).

☐ OK ☐ KO

---

## Étape 266 — Historique et rapports
👤 **économe** (secondaire-test) · fenêtre **A** · 📂 **« Historique »** (`/v2/payroll/history`) puis **« Rapports »** (`/v2/payroll/reports`)

1. Dans « Historique », lire la ligne de TRAORE Kouadio, cliquer **« Exporter en CSV »**.
2. Dans « Rapports », lire « Bulletins par statut », changer « Origine des heures », cliquer **« Exporter en CSV »**.

✅ Historique : statut « Versé », « Arrêté » par le directeur, « Versé » par l'économe (Virement bancaire), « Montant » 158 000 F CFA ; fichier `historique-paie.csv`. Rapports : pour chaque statut, « Présences » + « Séances » + « Hors heures » = « Total » (le salaire est "hors heures") ; fichier `rapport-paie.csv`.

☐ OK ☐ KO

---

## Étape 267 — Pointer son arrivée et son départ (heures de cours d'octobre)
👤 **enseignant** (secondaire-test) · fenêtre **B** · 📂 Menu **« Mes congés et ma présence »** (`/v2/teacher/leaves`)

Précondition : la fonction "présence du personnel" est dans l'offre ; un seul pointage par jour (sinon « La présence du personnel n'est pas incluse dans votre offre. »).

1. Dans « Pointer », cliquer **« Arrivée »**.
2. Attendre **environ deux minutes** (entre 1 min 30 s et 2 min 29 s, la durée est arrondie à la minute).
3. Cliquer **« Départ »**.

✅ « Arrivée enregistrée. » puis « Départ enregistré. » ; la ligne du jour dans « Présences » affiche « Arrivée » et « Départ ». Avec D = 2 minutes et la configuration de test (seuil 1 minute, ×2) : heures = 50 + 100 × (D − 1) = **150 F CFA** ; le bulletin d'octobre vaudra 150 000 + 150 = **150 150 F CFA** (si D ≠ 2, recalculer ce montant : les chiffres des étapes suivantes changent d'autant).

☐ OK ☐ KO

---

## Étape 268 — Créer la période d'octobre et vérifier l'aperçu des présences
👤 **économe** (secondaire-test) · fenêtre **A** · 📂 **« Périodes »** (`/v2/payroll`) > **« Nouvelle période »**

1. Saisir : Nom `Octobre test guide`, Du `01/10/2026`, Au `31/10/2026`, Année scolaire = l'année en cours > **« Créer la période »**.
2. Ouvrir la fiche, choisir « Origine des heures » = « Présences seulement », cliquer **« Aperçu (sans enregistrer) »**. Ne pas lancer le calcul.

✅ TRAORE Kouadio « Calculé » : une ligne d'origine « Présences » au « Tarif par défaut de la configuration » (3 000 F CFA l'heure) ; heures normales 50 F CFA, heures supplémentaires 100 F CFA par minute après la première (150 F CFA pour D = 2).

☐ OK ☐ KO

---

## Étape 269 — Séparation des tâches : le directeur ne peut pas arrêter ce qu'il a calculé
👤 **propriétaire**, puis **directeur**, puis **propriétaire** (secondaire-test, MFA) · fenêtre **A** · 📂 **« Réglages »**, fiche de la période d'octobre, **« Masse salariale »** (`/v2/payroll/owner`)

1. Propriétaire : dans « Réglages », cocher « Séparation des tâches », laisser « Seuil de validation par le propriétaire » vide, **« Enregistrer les réglages »**.
2. Directeur : fiche de "Octobre test guide", cliquer **« Lancer le calcul »**.
3. Directeur : fiche du bulletin de TRAORE Kouadio, cliquer **« Arrêter le montant »**, confirmer **« Arrêter le montant »**.
4. Propriétaire : « Masse salariale » > ligne "Octobre test guide" > **« Bulletins à valider »** > **« Valider »** en face de TRAORE Kouadio.

✅ Étape 2 : TRAORE « Calculé » (150 150 F CFA) ; YAO Fatou et KOUAME Adjoua « Écarté ». Étape 3 : refus "Séparation des tâches : celui qui a calculé le bulletin ne peut pas l'arrêter." ; le bulletin reste « Calculé ». Étape 4 : « Le bulletin est validé. » et le bulletin passe à « Arrêté (impayé) ».

⚠️ *Écart connu* : si « Masse salariale » est absente de l'offre ("La masse salariale et la validation par le propriétaire ne sont pas incluses dans l'offre de l'établissement."), le noter et passer à l'étape suivante.

☐ OK ☐ KO

---

## Étape 270 — L'enseignant conteste son bulletin, le directeur l'annule
👤 **enseignant**, puis **directeur** (secondaire-test) · fenêtres **B** puis **A** · 📂 `/v2/teacher/payslips/<identifiant>` puis fiche du bulletin d'octobre

1. Enseignant : ouvrir le bulletin d'octobre (« Arrêté (impayé) »), cliquer **« Contester ce bulletin »**, saisir « Motif de la contestation » `Heures de pointage à vérifier test guide`, cliquer **« Envoyer la contestation »**.
2. Directeur : sur le bulletin d'octobre, cliquer **« Annuler le bulletin »**, saisir « Motif de l'annulation » `Contestation acceptée test guide`, confirmer **« Annuler le bulletin »**.
3. Enseignant : recharger `/v2/teacher/payslips`.

✅ Étape 1 : « Votre contestation a été transmise à la gestion de la paie. » ; statut « Contesté » ; "Ce bulletin est contesté : la gestion de la paie l'examine.". Étape 2 : « Le bulletin est annulé. » ; statut « Annulé », plus aucun bouton d'action. Étape 3 : seul le bulletin de septembre (« Versé ») est visible ; le bulletin annulé n'apparaît plus.

⚠️ *Test d'erreur* : motif de 1 ou 2 caractères → "Le motif doit comporter au moins 3 caractères.".

☐ OK ☐ KO

---

## Étape 271 — Recalculer octobre, seuil du propriétaire, versement (⚠️ Irréversible)
👤 **économe**, **propriétaire**, **directeur** (secondaire-test, MFA pour les trois) · fenêtre **A** · 📂 fiche de la période "Octobre test guide"

1. Économe : cliquer **« Lancer le calcul »** (sans recalculer) : un nouveau bulletin de TRAORE Kouadio est « Calculé » (150 150 F CFA).
2. Propriétaire : dans « Réglages », « Seuil de validation par le propriétaire » = `100000`, **« Enregistrer les réglages »**.
3. Directeur : bulletin « Calculé » > **« Arrêter le montant »** > confirmer.
4. Propriétaire : « Masse salariale » > "Octobre test guide" > **« Bulletins à valider »** > **« Valider »**.
5. Économe : sur la fiche de la période, cocher la ligne de TRAORE Kouadio, cliquer **« Verser la sélection (1) »**, Mode de versement « Mobile money », Référence `TG-MM-001`, **« Constater le versement »**.
6. Propriétaire : dans « Réglages », vider le seuil, décocher « Séparation des tâches », **« Enregistrer les réglages »** (retour à l'état de départ).

✅ Étape 3 : refus "Ce montant dépasse le seuil : seul le propriétaire peut arrêter ce bulletin.". Étape 4 : « Le bulletin est validé. ». Étape 5 : « Opération de versement terminée. » et « 1 bulletin versé · 0 inchangé(s) · 0 refusé(s). » ; statut « Versé » avec « Mobile money » et `TG-MM-001`. Si le bulletin n'est pas recréé à l'étape 1, le consigner *(à vérifier)*.

☐ OK ☐ KO

---

## Étape 272 — Lire la masse salariale
👤 **propriétaire** (secondaire-test) · fenêtre **A** · 📂 Menu **« Masse salariale »** (`/v2/payroll/owner`)

1. Lire « Masse salariale comptée » et la note de comptage.
2. Pour "Septembre test guide" et "Octobre test guide", lire les montants par statut et la ligne « Compté ».
3. Lire la ligne "À part — annulés : …" d'octobre.

✅ **308 150 F CFA** comptés ("2 bulletins comptés (hors annulés et contestés).") : septembre « Versé » 158 000 F CFA (1), octobre « Versé » 150 150 F CFA (1) ; « À part — annulés : 150 150 F CFA (1) · contestés : 0 F CFA (0). » (pour D = 2).

☐ OK ☐ KO

---

📚 *Pour aller plus loin* : chapitre 13, scénarios 13.18 à 13.21 (une heure et un jour de salaire ne se paient qu'une fois, clôture et archivage d'une période, « Mes bulletins » du salarié, droits et isolation entre établissements).

**Ce que la phase laisse dans l'application :**
- Configurations de paie : TRAORE Kouadio (Mixte, 150 000 F CFA mensuel, 3 000 F CFA l'heure, seuil 1 minute, ×2, depuis le 01/08/2026) ; YAO Fatou (Horaire, 3 000 F CFA, depuis le 01/08/2026).
- Tarifs : générique "Mathématiques" 4 000 F CFA (`Tarif générique test guide`) ; nominatif TRAORE Kouadio 5 000 F CFA (`Tarif nominatif test guide`).
- Périodes `Septembre test guide` (active) et `Octobre test guide`.
- Bulletins : septembre TRAORE Kouadio 158 000 F CFA (versé, `VIR-TG-001`) ; octobre TRAORE Kouadio 150 150 F CFA (un bulletin annulé, un versé `TG-MM-001`).
- Ajustements `Prime d'assiduité test guide` (10 000 F CFA) et `Avance sur salaire test guide` (2 000 F CFA).
- Un pointage « Arrivée »/« Départ » de TRAORE Kouadio du 8 octobre 2026.
- Réglages de la paie remis à l'état de départ.

---

[⬅ Sommaire](../GUIDE_TEST_UTILISATEUR_COMPLET.md) · [← Précédent](13b-examens-suite.md) · [Suivant →](15-documents-ged.md)
