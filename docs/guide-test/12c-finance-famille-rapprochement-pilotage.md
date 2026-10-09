# Chapitre 12 (fin). Famille, rapprochement, remboursement, caisse, financement, pilotage, droits

> Suite de `12b-finance-encaissements-recus.md`. Scénarios `12.22` à `12.41`, puis les sections finales du chapitre : **Données créées**, **Écarts constatés**, **À vérifier en test**, **Non couvert / limites connues**.

État de la facture n°1 test guide (reste dû) : 15 000 à l'entrée de ce fichier → `12.23` 11 000 → `12.25` 8 000 → `12.27` 2 999 → `12.28` 6 999 → `12.32` 5 999.

#### 12.22 Le parent lit la situation financière de ses enfants
Compte : parent (`parent@secondaire-test.test`) · Où : barre « Mes finances » (`/v2/finance/me`) ; mêmes écrans dans le portail parent (`/v2/parent/children/<id>/finance`, chapitre 20) · Prérequis : 12.19.
1. Ouvrir `/v2/finance/me`. Lire le titre « Mes finances » et deux cartes : "DIABATE Nadia" et "DIABATE Salimata", chacune avec « Facturé », « Payé », « Reste à payer » et le bouton « Voir le détail ».
2. Cliquer « Voir le détail » sur Nadia (`/v2/finance/me/<id de Nadia>`). Lire : « Situation » (« Facturé », « Avoirs », « Payé », « Reste à payer »), « Prochaines échéances », « Factures » (chaque facture se déplie et montre ses échéances), « Paiements », « Reçus ».
3. Revenir et ouvrir la fiche de Salimata.
4. Dans le détail de Nadia, cliquer le numéro d'un reçu : page `/v2/finance/me/<id de Nadia>/receipts/<id du reçu>`.
Résultat attendu : étape 1, Nadia : Facturé 304 000 F CFA, Payé 289 000 F CFA, Reste à payer 15 000 F CFA ; Salimata : Facturé 225 000, Payé 125 000, Reste à payer 100 000 (graine). Étape 2 : « Avoirs » 0 ; « Prochaines échéances » : une ligne (facture n°1, "Tranche 3", reste dû 15 000 F CFA) ; « Factures » : inscription, scolarité, facture n°1, facture n°2 — **ni le brouillon de 12.9**, ni aucune facture de Salimata ; « Paiements » : tous les paiements de Nadia, y compris 5 001 « En attente » et 5 013 « Échoué » ; « Reçus » : un lien et un bouton « PDF » par reçu. Étape 4 : "Reçu REC-…", boutons « Retour à la scolarité », « Télécharger le PDF », « Imprimer » ; le contenu reprend « Date », « Mode de paiement », « Montant reçu », « Reste à payer après ce paiement », « Imputation du paiement ». Le parent ne voit ni identifiant interne ni facture de financeur.
Cas invalides : | Saisie | Message attendu |
|---|---|
| `/v2/finance/me/abc` (identifiant mal formé) | page introuvable (404) |
| `/v2/finance/me/00000000-0000-4000-8000-000000000000` (bon format, inconnu) | titre « Accès refusé » et « Cet apprenant n'est pas rattaché à votre compte : ses informations financières ne peuvent pas être affichées. », lien « Retour à mes finances » ; aucune donnée |
| `/v2/finance/invoices`, `/v2/finance/payments`, `/v2/finance/cash` | redirection vers `/unauthorized` : « Accès refusé » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le parent

#### 12.23 Le parent paie en ligne avec le fournisseur simulé
Compte : parent · Où : détail de Nadia, bouton « Payer en ligne » · Prérequis : 12.22 ; fournisseur simulé proposé (en-tête de 12a).
1. Cliquer « Payer en ligne » (visible seulement s'il reste une facture à payer). Fenêtre « Payer en ligne » (« Le paiement est initié auprès de votre opérateur ; confirmez-le sur votre téléphone. Le montant ne peut pas dépasser le reste dû de la facture. »).
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Facture à payer | la facture n°1 (option "FAC-… — reste 15 000 F CFA") | oui |
   | Montant (F CFA) | 4000 (prérempli avec 15000) | oui |
   | Moyen de paiement | « Paiement simulé (démonstration) » (présélectionné ; aide : « Paiement simulé : aucun argent réel n'est débité. Un montant se terminant par 001 reste en attente, un montant se terminant par 013 échoue, tout autre montant réussit. ») | oui |
   | Numéro de téléphone du payeur | +225 07 10 20 30 40 | non |
2. « Payer ». Observer « Suivi du paiement ». **Noter** le numéro du nouveau reçu (REC du parent, 4 000).
3. Recommencer avec 2001, puis avec 2013.
Résultat attendu : 4 000 → pastille « Confirmé » et « Paiement confirmé. Votre reçu est disponible ci-dessous. » ; « Reste à payer » 11 000 F CFA ; nouveau reçu dans « Reçus » ; bouton « Fermer ». 2 001 → « En attente de confirmation par l'opérateur. Cette page se met à jour toute seule. » avec « Vérifier maintenant » ; reste à payer inchangé. 2 013 → pastille « Échoué » : "Le paiement a échoué : sandbox_declined". Le paiement en attente reste jusqu'à la résolution du directeur (`12.27`).
Cas invalides : | Saisie | Message attendu |
|---|---|
| Montant `20000` (reste dû 11 000) | "Le montant dépasse le reste dû de la facture." |
| Montant `0` | « Montant invalide : chiffres uniquement, strictement positif. » |
| Montant vide | « Saisissez un montant. » |
| Montant `1,5` | « Le montant est un entier en francs : pas de virgule ni de point. » |
| Moyen de paiement « Orange Money » | `Le fournisseur "orange_money" n'est pas configuré pour ce tenant.` (aucune facture modifiée) |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé (un compte sans `finance.child.pay` ne voit pas « Payer en ligne »)

#### 12.24 L'élève voit et règle sa propre scolarité
Compte : élève (`eleve@secondaire-test.test`, DIABATE Nadia) · Où : `/v2/finance/me` (aussi `/v2/student/finance`) · Prérequis : 12.23.
1. Ouvrir `/v2/finance/me` : **une seule** carte, "DIABATE Nadia", « Reste à payer » 11 000 F CFA.
2. « Voir le détail » puis « Payer en ligne » : facture n°1, Montant 3013, moyen simulé, « Payer ».
3. Se reconnecter en parent et rouvrir le détail de Nadia (copier au passage l'adresse de la carte de Salimata, `/v2/finance/me/<id de Salimata>`).
4. Revenir en élève et coller l'adresse de Salimata.
Résultat attendu : étape 2, « Échoué » : "Le paiement a échoué : sandbox_declined" ; aucun reçu ni changement de solde. Étape 3 : le parent voit aussi ce paiement de 3 013 « Échoué » (paiement de l'élève, à la charge de la famille). Étape 4 : écran « Accès refusé » avec « Cet apprenant n'est pas rattaché à votre compte : ses informations financières ne peuvent pas être affichées. ».
Cas invalides : | Saisie | Message attendu |
|---|---|
| Élève : reçu de Salimata (`/v2/finance/me/<id de Nadia>/receipts/<id d'un reçu de Salimata>`) | "Ressource introuvable." (404 uniforme) |
| Élève : `/v2/finance/invoices` | `/unauthorized` : « Accès refusé » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour l'élève

#### 12.25 Avoir sur la facture n°1 et refus d'annuler une facture encaissée
Compte : économe · Où : fiche de la facture n°1 (`/v2/finance/invoices/<id>`), section « Correction de la facture » · Prérequis : 12.23 (reste dû 11 000).
1. Cliquer « Émettre un avoir » : fenêtre « Émettre un avoir » ("L'avoir porte sur le reste dû (actuellement 11 000 F CFA).").
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Montant de l'avoir | 3000 | oui |
   | Motif | Geste commercial test guide (aide : « Au moins 5 caractères. ») | oui |
2. « Émettre l'avoir ». **Noter** le numéro d'avoir.
3. Cliquer « Annuler la facture », saisir le motif "Tentative de test guide" et valider.
Résultat attendu : étape 2, message "L'avoir AV-2026-nnnnnn a été émis." ; « Avoirs » 3 000 F CFA, « Reste dû » 8 000 F CFA, statut « Partiellement payée » ; l'échéance restante (tranche 3) baisse de 3 000. Étape 3 : refus "Une facture encaissée ne s'annule pas : remboursez puis émettez un avoir." (la facture n'est pas modifiée).
Cas invalides : | Saisie | Message attendu |
|---|---|
| Montant `12000` (> reste dû 11 000 avant l'avoir) | "L'avoir dépasse le reste dû de la facture." |
| Montant `0` | « Montant invalide : chiffres uniquement, strictement positif. » |
| Montant vide | « Saisissez un montant. » |
| Motif `abc` | « Au moins 5 caractères. » |
| Avoir sur la facture n°2 (soldée, reste dû 0) | "Un avoir s'émet sur une facture émise ayant un reste dû." |
| Annulation avec motif vide ou `abc` | « Le motif doit comporter au moins 5 caractères. » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le secrétariat (pas de section « Correction de la facture »)

#### 12.26 Paiements à rapprocher : lecture côté économe
Compte : économe · Où : barre « À rapprocher » (`/v2/finance/payments/pending`) · Prérequis : 12.16 et 12.23 (deux paiements en attente : 5 001 et 2 001).
1. Lire le titre « Paiements à rapprocher », l'encadré « Une seule personne habilitée tranche. Chaque résolution exige une vérification MFA récente, un motif et une preuve ; elle s'applique aussitôt et est journalisée (état avant et après, auteur, motif). », le filtre « Rapprochement » (« Tous », « À rapprocher (action humaine) », « Vérification automatique en cours ») et le tableau (« Reçu le », « Fournisseur », « Montant », « Rapprochement », « Prochaine vérification »).
2. Repérer les lignes 5 001 et 2 001 (fournisseur `sandbox`), état « Pas encore contrôlé ». Plus de 15 minutes après leur création, le travail de fond les a interrogées : « Vérification en cours » avec "1 vérification" ou plus.
3. Cliquer « Vérifier maintenant » sur la ligne 5 001.
4. Lire la section « Demandes ouvertes (ancien circuit) ».
Résultat attendu : étape 3, message `Le fournisseur répond toujours "en attente".` (le fournisseur simulé garde son état en mémoire du serveur et ne règle jamais seul). L'économe n'a **pas** le bouton « Résoudre à la main ». Étape 4 : « Aucune demande en attente ». Le tableau vide affiche « Aucun paiement à rapprocher » et « Les paiements en ligne en attente apparaissent ici ; ceux qui aboutissent disparaissent seuls. »
- [ ] Cas nominal  - [ ] Cas invalide (si le serveur a redémarré, « Vérifier maintenant » renvoie une erreur : état simulé perdu, voir "Non couvert")  - [ ] Droit refusé pour l'enseignant

#### 12.27 Résolution manuelle d'un paiement bloqué par le directeur (une seule personne, code récent)
Compte : directeur (fenêtre privée, MFA) · Où : « À rapprocher » (`/v2/finance/payments/pending`) · Prérequis : 12.26.
1. Sur la ligne 5 001, cliquer « Résoudre à la main ». Fenêtre « Résoudre un paiement à la main » :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Ce qui s'est réellement passé | « L'argent est arrivé : confirmer le paiement (reçu et imputation) » | oui |
   | Motif | Paiement vérifié sur le relevé de test guide (10 caractères au moins) | oui |
   | Preuve | RELEVE-TG-001 (3 à 120 caractères) | oui |
2. « Résoudre le paiement ». Si la fenêtre « Confirmez votre identité » s'ouvre, saisir le « Code à 6 chiffres » du moment (voir en-tête de 12a) puis « Confirmer et continuer » : la résolution est alors rejouée automatiquement.
3. Sur la ligne 2 001 : « Résoudre à la main », « L'argent n'est pas arrivé : marquer le paiement échoué », Motif "Aucun argent reçu selon le relevé de test guide", Preuve RELEVE-TG-002.
4. Ouvrir « Encaissements » (`/v2/finance/payments`) et la facture n°1.
Résultat attendu : message « La résolution est enregistrée et appliquée. » ; les deux lignes quittent la liste. Le paiement 5 001 est « Confirmé » avec un reçu, imputé à la facture n°1 : reste dû **2 999 F CFA**. Le paiement 2 001 est « Échoué », sans reçu, facture inchangée. La résolution est inscrite au journal d'audit (événement sensible, motif, preuve, état avant et après).
Cas invalides : | Saisie | Message attendu |
|---|---|
| Motif `court` | « Le motif doit faire au moins 10 caractères. » |
| Preuve `ab` | « Saisissez la preuve (3 caractères au moins). » |
| Code `000000` dans « Confirmez votre identité » | « Code invalide. Vérifiez l'heure de votre téléphone, puis attendez le prochain code. » ; rien n'est modifié |
| Annuler la fenêtre de confirmation | aucune résolution appliquée, le paiement reste dans la liste |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour l'économe (bouton absent)

#### 12.28 Remboursement à quatre yeux : le demandeur n'approuve pas
Comptes : économe (demande), directeur (approbation) · Où : fiche d'un paiement puis barre « Remboursements » (`/v2/finance/refunds`) · Prérequis : 12.27 (facture n°1 reste dû 2 999).
1. Économe : `/v2/finance/payments`, ouvrir la fiche du virement "VIR-TG-001" (10 000 F CFA). Dans « Remboursements », cliquer « Demander un remboursement » (fenêtre du même nom : « Le montant remboursé ne peut pas dépasser ce qui reste du paiement. ») :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Montant à rembourser | 3000 | oui |
   | Motif | Erreur de saisie lors du test guide (aide : « Au moins 5 caractères. ») | oui |
   La fenêtre rappelle : « Un remboursement exige l'approbation d'une autre personne : vous ne pouvez pas approuver votre propre demande. » Cliquer « Envoyer la demande ».
2. Économe : barre « Remboursements ». Lire « Règle des quatre yeux : la personne qui demande un remboursement ne peut pas l'approuver. » et le tableau (« Demandé le », « Paiement », « Montant », « Motif », « Statut »). La ligne 3 000 est « Demandé ». Cliquer « Approuver » (fenêtre « Approuver le remboursement » : "Vous approuvez un remboursement de 3 000 F CFA.", case « Exécuter immédiatement » cochée) puis « Approuver ».
3. Directeur (fenêtre privée) : `/v2/finance/refunds`, même ligne, « Approuver », case cochée, « Approuver ».
4. Économe : refaire une demande de 2000 sur "VIR-TG-001", motif "Demande de test guide à refuser". Directeur : « Refuser » (fenêtre « Refuser le remboursement » : « Le refus est définitif et le motif est conservé. »), « Motif du refus » = "Refus de test guide", bouton « Refuser ».
5. Variante paiement en ligne (remboursement manuel imposé) : économe, fiche du paiement en ligne de 5 000, demande de 1000 (motif "Remboursement en ligne de test guide"). Directeur : « Approuver » avec « Exécuter immédiatement » cochée.
6. Directeur ou économe : sur la ligne « Approuvé », cliquer « Confirmer un remboursement manuel » (si le bouton manque après un rechargement, cliquer d'abord « Exécuter » : l'API répond qu'il faut le faire à la main et le bouton apparaît). Fenêtre « Confirmer un remboursement fait à la main » : « Référence de la preuve » = REMB-TG-001, « Note (facultatif) » vide, « Confirmer le remboursement ».
Résultat attendu : étape 1, message « La demande de remboursement a été enregistrée ; une autre personne doit l'approuver. » et statut « Demandé ». Étape 2 : l'API refuse, la fenêtre affiche "Le demandeur ne peut pas approuver son propre remboursement." et la ligne reste « Demandé ». Étape 3 : « Le remboursement est approuvé et exécuté. », statut « Exécuté » ; fiche du virement : « Remboursé » 3 000 F CFA, « Imputé » 7 000 (colonne « Repris » 3 000 F CFA, « Net » 7 000), paiement toujours « Confirmé » ; facture n°1 : reste dû **5 999 F CFA** ; le reçu du virement est inchangé (« Reste dû après ce paiement » 44 000 F CFA). Étape 4 : « Le remboursement est refusé. », statut « Refusé » (définitif). Étape 5 : message « Les remboursements de paiements en ligne se font à la main chez le fournisseur (réglage par défaut de l'établissement) : effectuez-le sur le portail du fournisseur puis confirmez-le ici avec sa référence de preuve. », statut « Approuvé ». Étape 6 : « Le remboursement manuel est enregistré. », statut « Exécuté » ; paiement de 5 000 : « Remboursé » 1 000 F CFA ; facture n°1 : reste dû **6 999 F CFA**.
Cas invalides : | Saisie | Message attendu |
|---|---|
| Demande de `11000` sur le virement de 10 000 (avant tout remboursement) | "Le remboursement dépasse le montant remboursable." |
| Montant `0` | « Montant invalide : chiffres uniquement, strictement positif. » |
| Motif `abc` | « Au moins 5 caractères. » |
| Refus avec motif vide ou `abc` | « Le motif doit comporter au moins 5 caractères. » |
| Référence de preuve `ab` | « Saisissez la référence de la preuve (3 caractères au moins). » |
| Paiement échoué (5 013) ou en attente | pas de bouton « Demander un remboursement » (seulement pour un paiement confirmé) |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le secrétariat (lecture de la liste, aucun bouton d'action)

#### 12.29 Clôture de caisse : sans écart, puis avec écart justifié
Compte : économe · Où : barre « Caisse » (`/v2/finance/cash`) · Prérequis : 12.13 (session ouverte avec 8 000 F CFA d'espèces). **La clôture est définitive.**
1. Dans « Ma session » : « Encaissé » 8 000 F CFA, « Nombre d'encaissements » 1. Cliquer « Clôturer la session ». Fenêtre « Clôturer la session » (« Saisissez le montant réellement compté. La clôture est définitive. »). Essayer d'abord les saisies invalides ci-dessous.
2. Saisir « Montant compté en caisse » = 18000 (fonds de caisse compris), « Observation » vide, « Clôturer ».
3. Ouvrir « Détails » dans « Historique des sessions ».
4. Ouvrir une nouvelle session (« Ouvrir une session », fonds 5000), puis « Clôturer la session » avec « Montant compté en caisse » = 4000 et « Observation » vide. Lire l'erreur. Puis saisir l'observation "Écart de test guide : 1 000 F manquants" et valider.
5. Retourner sur `/v2/finance/payments/new` (mode « Espèces »).
Résultat attendu : étape 2, message « La session est clôturée. » et bloc « Résultat de la clôture » : « Fonds de caisse » 10 000 F CFA, « Mouvements » "8 000 F CFA encaissés, 0 F CFA remboursés (1 paiement)", « Montant attendu » 18 000 F CFA, « Montant compté » 18 000 F CFA, « Aucun écart : la caisse est juste. » La session apparaît « Clôturée » dans « Historique des sessions » (colonnes « Ouverte le », « Caisse », « Statut », « Attendu », « Compté », « Écart »). Étape 4 : sans observation, refus sous « Observation » : "Écart de caisse de -1000 XOF : une justification est obligatoire." ; avec observation : « Montant attendu » 5 000 F CFA, « Montant compté » 4 000 F CFA, « Écart : il manque 1 000 F CFA en caisse. » et la ligne "Observation : Écart de test guide : 1 000 F manquants". Étape 5 : l'avertissement « Aucune session de caisse ouverte : un paiement en espèces doit être rattaché à votre session. » est revenu.
Cas invalides : | Saisie | Message attendu |
|---|---|
| Montant compté `-1` | « Le montant ne peut pas être négatif. » |
| Montant compté vide | « Saisissez un montant. » |
| Montant compté `18 000,5` | « Le montant est un entier en francs : pas de virgule ni de point. » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le secrétariat

#### 12.30 Facture avec échéance passée, échéancier généré puis annulation (facture n°3 test guide)
Compte : économe · Où : `/v2/finance/invoices/new` puis fiche · Prérequis : 12.4.
1. Mode « Depuis le catalogue » ; Apprenant "COULIBALY Moussa" ; Inscription 6e A ; Frais divers test guide ×1 ; aucune remise ni plan ; « Échéance de la facture » = 2026-09-15 (date passée). « Calculer l'aperçu » puis « Émettre la facture ». **Noter** le numéro (facture n°3).
2. Ouvrir la facture n°3 : lire le statut.
3. Cliquer « Générer un échéancier » (fenêtre du même nom : "Répartit le total de la facture selon un plan ; le découpage au franc près est fait par l'API.") : « Plan d'échéancier » = Plan 3 tranches test guide, « Date de départ » vide (aide : « Par défaut : la date du jour. »), « Générer ».
4. Cliquer « Annuler la facture » (fenêtre « Annuler la facture » : « L'annulation est définitive et tracée. »). Valider d'abord avec « Motif de l'annulation » vide, puis avec "Facture créée par erreur lors du test guide".
5. Dans la liste des factures : « Statut » = « Annulée ».
Résultat attendu : étape 1 : l'échéance passée est acceptée sans avertissement. Étape 2 : statut « Émise » (le passage en « En retard » est fait par la tâche quotidienne de nuit : à vérifier en test). Étape 3 : message « L'échéancier a été généré. » ; trois échéances de 20 000 F CFA (somme = 60 000). Étape 4 : sans motif, « Le motif doit comporter au moins 5 caractères. » ; avec motif, message « La facture a été annulée. », statut « Annulée », bandeau "Cette facture est annulée. Motif : Facture créée par erreur lors du test guide", numéro conservé, plus de section « Correction de la facture » ni de bouton « Encaisser » ni « Générer un échéancier ». Étape 5 : la facture annulée est listée ; elle ne compte plus dans « Facturé ».
Cas invalides : | Saisie | Message attendu |
|---|---|
| « Générer un échéancier » sans choisir de plan | rien n'est envoyé (le bouton « Générer » ne fait rien tant qu'aucun plan n'est choisi) |
| « Générer un échéancier » sur la facture n°1 (déjà encaissée) | "L'échéancier d'une facture encaissée ou créditée ne peut plus être remplacé." |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le secrétariat

#### 12.31 Financement et bourse : part du financeur, facture liée, paiement du financeur
Compte : économe · Où : barre « Remises et bourses » (`/v2/finance/funding`) · Prérequis : 12.2 (barème du frais divers) ; collège (la part « État » n'est pas utilisée ici).
1. Choisir l'apprenant "SORO Aya". Lire « Type de financement » (« Financement » : « Privé (famille) »), « Bourses et prises en charge » (« Aucune bourse » et « Ajoutez une prise en charge (État, entreprise, fondation…) pour que sa part soit facturée séparément. »), « Répartition des factures » (la facture d'inscription, « Part de la famille »).
2. Cliquer « Modifier » : fenêtre « Type de financement » (« Appliqué aux prochaines factures de l'apprenant. »), « Financement » = « Boursier », « Enregistrer ».
3. `/v2/finance/invoices/new` : apprenant "SORO Aya", « Année scolaire » 2026-2027, Frais divers test guide, « Calculer l'aperçu ».
4. Retour sur « Remises et bourses » > "SORO Aya" > « Nouvelle bourse » (fenêtre « Nouvelle bourse ou prise en charge ») :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Type de financeur | « Fondation » | oui |
   | Nom du financeur | Fondation Test Guide | oui |
   | Référence | BOURSE-TG-001 | non |
   | Année scolaire | 2026-2027 | oui |
   | Couverture | « Pourcentage » | oui |
   | Pourcentage couvert | 20 | oui |
   | Plafond (facultatif) | (vide) | non |
   | Priorité | (vide) | non |
   | Catégories couvertes | aucune case (= toutes) | non |
   « Créer la bourse ».
5. Refaire l'aperçu de l'étape 3 puis « Émettre la facture ».
6. Ouvrir chaque facture créée (liens du résultat). Sur la part du financeur, **copier** l'identifiant affiché dans le bandeau.
7. `/v2/finance/payments/new` : apprenant "SORO Aya", Montant 12000, Mode « Virement », Référence VIR-TG-FIN-001, Nom du payeur Fondation Test Guide, Qui paie ? « Financeur », « Référence du financeur » = l'identifiant copié, imputation « Automatique ». Confirmer.
8. Retour sur « Remises et bourses » : « Suspendre » puis « Réactiver ». Puis nettoyage : « Modifier » > « Privé (famille) » > « Enregistrer », et « Terminer ».
Résultat attendu : étape 2 : message « Le type de financement a été enregistré. » Étape 3 : alerte "Apprenant boursier sans bourse active pour cette année." Étape 4 : message « La bourse a été créée. » ; ligne "Fondation Test Guide" (Fondation), 2026-2027, 20,00 %, « Toutes », « Active ». Étape 5 : l'aperçu montre **deux factures** : part de la famille 48 000 F CFA et part du financeur 12 000 F CFA ; message `2 factures ont été enregistrées (part de la famille et part du financeur).` avec les pastilles « Famille » et « Financeur » (ces deux factures sont la facture n°4 test guide). Étape 6 : bandeau de la part du financeur `Part prise en charge par le financeur "<identifiant de la bourse>" : payable séparément de la part de la famille.` (l'identifiant s'affiche au lieu du nom : défaut connu) ; bandeau de la part famille « Part de la famille : une facture liée existe pour la part du financeur. » Étape 7 : « Imputé » 12 000 F CFA, la part du financeur est « Payée », la part de la famille reste à 48 000 F CFA. Étape 8 : messages « La bourse est suspendue. », « La bourse est de nouveau active. », « La bourse est terminée. » ; « Répartition des factures » liste trois factures avec « Part de la famille » et "Part Fondation Test Guide".
Cas invalides : | Saisie | Message attendu |
|---|---|
| Pourcentage couvert `0` ou `150` | « Le pourcentage doit être compris entre 0,01 et 100. » |
| Pourcentage couvert vide | « Saisissez un pourcentage. » |
| Couverture « Montant fixe », montant `0` | « Montant invalide : chiffres uniquement, strictement positif. » |
| Nom du financeur vide, ou Année scolaire non choisie | « Ce champ est obligatoire. » |
| Étape 7 avec « Référence du financeur » vide | "Un paiement de financeur indique la prise en charge concernée (payerRef)." |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le secrétariat (lecture seule : pas de « Modifier » ni « Nouvelle bourse »)

#### 12.32 Référence de paiement déjà utilisée
Compte : économe · Où : `/v2/finance/payments/new` · Prérequis : 12.14, 12.31.
1. Apprenant "DIABATE Nadia" ; Montant encaissé 1000 ; Mode « Mobile money » ; Référence MM-TG-001 (déjà utilisée en 12.14) ; imputation « Automatique ». Confirmer.
Résultat attendu : le paiement est **accepté** sans alerte de doublon (comportement actuel, voir "Écarts") ; « Reste dû après paiement » 5 999 F CFA ; la facture n°1 est à reste dû 5 999 F CFA. Seule une répétition de la même clé technique (double clic, panne réseau) est neutralisée, pas une référence répétée.
- [ ] Cas nominal  - [ ] Cas invalide (aucun refus attendu)  - [ ] Droit refusé pour le secrétariat

#### 12.33 Reçu en PDF scellé et vérification publique
Compte : parent, puis visiteur sans compte · Où : reçu du parent (`/v2/finance/me/<id de Nadia>/receipts/<id>`) puis page publique `/v2/verify` · Prérequis : 12.23, service de rendu (worker) démarré.
1. Ouvrir le reçu de 4 000 F CFA payé par le parent. Cliquer « Télécharger le PDF ».
2. Si le message « Le document est en cours de préparation. Réessayez dans quelques instants. » s'affiche, patienter puis recliquer.
3. Ouvrir le fichier `recu-REC-2026-nnnnnn.pdf` : lire le numéro de reçu, le montant et, sous le QR code, le **code de vérification** (26 caractères).
4. Ouvrir `/v2/verify` (sans compte, fenêtre privée) : page « Vérification d'un document ». « Code de vérification » = le code lu, « Vérifier ».
5. Refaire avec un code inventé (par exemple `AAAAAAAAAAAAAAAAAAAAAAAAAA`).
6. Dans la même page, section « Comparer un fichier PDF » : téléverser le PDF téléchargé.
Résultat attendu : étape 1 : un fichier PDF est enregistré (nom `recu-REC-2026-nnnnnn.pdf`) ; la première demande peut répondre "en préparation". Étape 4 : pastille « Authentique », « Document authentique », « Nature du document » = « Reçu de paiement », « Intitulé » = le numéro du reçu seul, « Établissement », « Émis le » ; aucune donnée personnelle (la page le rappelle : « Cette page n'affiche ni note, ni nom, ni matricule, ni date de naissance : elle confirme seulement l'existence et le statut du document. »). Étape 5 : pastille « Inconnu » : « Aucun document ne correspond à ce code. Vérifiez la saisie ; si le code est correct, le document n'est pas authentique. » Étape 6 : « Fichier identique » (statut du document « Authentique »).
Cas invalides : | Saisie | Message attendu |
|---|---|
| Fichier non PDF dans « Comparer un fichier PDF » | « Le fichier doit être au format PDF. » |
| Fichier PDF de plus de 10 Mo | « Le fichier dépasse 10 Mo. » |
| Un PDF quelconque (pas un reçu) | « Fichier non reconnu » |
| Reçu d'un autre enfant (élève, adresse de reçu de Salimata) | "Ressource introuvable." |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé (le PDF n'est servi qu'avec le jeton du bon parent ou élève)
Remarque : sur l'écran de gestion, le reçu n'offre que l'impression du navigateur (`12.21`) ; le PDF scellé passe par la famille. Le QR imprimé encode `<base>/v/<code>` : en développement la base est `http://localhost:3000`, adresse sans écran (voir "Écarts"), d'où la saisie manuelle du code sur `/v2/verify`.

#### 12.34 L'inscription est confirmée par le paiement des frais d'inscription
Comptes : secrétariat (lecture), économe (encaissement) · Où : `/v2/enrollments` puis `/v2/finance/payments/new` · Prérequis : graine intacte pour SORO Elie (facture d'inscription 25 000 émise, inscription « En attente »). Si Elie est déjà « Active » (autre chapitre), prendre SORO Aya, N'GUESSAN Koffi ou N'GUESSAN Aya.
1. Secrétariat : `/v2/enrollments` : l'inscription de "SORO Elie" (6e A) est « En attente » ; celle de "DIABATE Nadia" est « Active ».
2. Économe : dans « Factures », vérifier que la facture d'inscription de SORO Elie est « Émise », 25 000 F CFA.
3. Économe : `/v2/finance/payments/new`, "SORO Elie", Montant 10000, « Virement », Référence VIR-TG-INSC-1, imputation « Automatique ».
4. Secrétariat : rafraîchir `/v2/enrollments`.
5. Économe : même apprenant, Montant 15000 (au primaire 5000, au supérieur 40000), « Virement », Référence VIR-TG-INSC-2.
6. Attendre une à deux minutes (la confirmation est faite par le travail de fond), rafraîchir `/v2/enrollments`.
Résultat attendu : étape 3 : facture « Partiellement payée ». Étape 4 : inscription **toujours** « En attente ». Étape 6 : facture « Payée » et inscription « Active ». Seule la facture contenant des frais d'inscription confirme l'inscription visée (et elle seule). Après 5 minutes sans changement, noter un écart Bloquant (travail de fond non exécuté).
- [ ] Cas nominal  - [ ] Cas invalide (paiement partiel : aucune confirmation)  - [ ] Droit refusé pour le secrétariat (il ne peut pas encaisser : `/v2/finance/payments/new` « Accès refusé »)

#### 12.35 Rapports financiers : lecture et contrôle des écarts
Compte : économe (puis directeur) · Où : barre « Rapports » (`/v2/finance/reports`) · Prérequis : 12.1 (relevé de départ), 12.34 faits dans l'ordre.
1. Lire « Rapports financiers » et les filtres « Année scolaire », « Situation au », « Groupe (classe) ».
2. Relire la « Synthèse » et comparer au relevé de 12.1 (en supposant qu'aucun autre chapitre n'a touché à la finance entre-temps).
3. Parcourir les ancres « Créances par classe » (la 6e A y figure), « Créances par apprenant » (case « Apprenants avec un restant dû seulement » : DIABATE Nadia, 5 999 F CFA ; SORO Aya, 48 000 F CFA), « Balance âgée » (tranches « Non échu » à « Plus de 90 jours »), « Évolution » (Du, Au, « Période » : « Jour », « Semaine », « Mois »), « Comptes fournisseurs » (« Paiements en ligne par compte fournisseur »).
4. Dans « Situation au », saisir une date passée avant tous les tests, puis la vider.
5. Cliquer un « Exporter en CSV » (un fichier est téléchargé).
Résultat attendu (écarts par rapport au relevé de 12.1, toutes les étapes 12.7 à 12.34 faites) : « Facturé » **+139 000** F CFA (54 000 + 25 000 + 48 000 + 12 000 ; la facture annulée et le brouillon n'y sont pas) ; « Avoirs » **+3 000** ; « Encaissé » **+107 001** (7 000 + 8 000 + 6 000 + 4 000 + 5 001 + 20 000 + 15 000 + 4 000 + 1 000 + 12 000 = 82 001, montants nets des remboursements, plus 25 000 d'inscription de SORO Elie du scénario 12.34) ; « Restant dû » **+28 999** (= 139 000 − 3 000 − 107 001 ; soit facture n°1 5 999 + part famille de la facture n°4 48 000, moins les 25 000 de l'inscription de SORO Elie qui étaient dus au départ). « Paiements non imputés » : +0. Dans « Comptes fournisseurs » : ligne du fournisseur `sandbox` ; les paiements confirmés, en attente, à rapprocher et échoués doivent refléter 12.16, 12.23, 12.24, 12.27 (valeurs exactes à relever en test).
Cas invalides : | Saisie | Message attendu |
|---|---|
| « Évolution » : « Du » postérieur à « Au » | « La date de début doit précéder la date de fin. » |
| « Évolution » sans encaissement sur la période | « Aucun encaissement sur la période » |
| `/v2/finance/reports` en secrétariat ou en parent | `/unauthorized` : « Accès refusé » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le secrétariat

#### 12.36 Fournisseurs de paiement (lecture, directeur)
Compte : directeur (MFA) · Où : barre « Fournisseurs de paiement » (`/v2/finance/providers`) · Prérequis : aucun. **Ne saisir aucun identifiant réel, n'activer aucun fournisseur.**
1. Ouvrir la page. Lire « Fournisseurs de paiement », l'avertissement sur le chiffrement des identifiants, "Environnement : Développement", puis une carte par opérateur (Orange Money, MTN MoMo, Wave, CinetPay, TrésorPay) avec une pastille d'état (« Désactivé », « Actif » ou « Configuration incomplète »), le mode et la ligne de compte (par exemple « Aucun compte disponible pour ce fournisseur : les paiements en ligne sont impossibles. »).
2. Repérer, sur une carte incomplète, que « Tester la connexion » est désactivé, que « Activer » est désactivé (« Activation impossible tant que la configuration est incomplète. ») et la liste « Champs manquants : ... ».
3. Constater que les champs secrets s'affichent « Non renseigné » et sont toujours vides.
4. En économe, ouvrir `/v2/finance/providers`.
Résultat attendu : aucun fournisseur « Actif » dans la graine ; aucun secret affiché. Étape 4 : `/unauthorized` « Accès refusé » (la page exige `finance.provider.manage`, réservée à la direction) ; l'entrée « Fournisseurs de paiement » n'est pas dans la barre de l'économe.
- [ ] Cas nominal  - [ ] Cas invalide (néant)  - [ ] Droit refusé pour l'économe

#### 12.37 Webhooks en échec : lecture et rejeu
Comptes : économe (lecture), directeur (rejeu) · Où : barre « Webhooks en échec » (`/v2/finance/webhooks`) · Prérequis : aucun.
1. Ouvrir la page : titre « Webhooks en échec », encadré « Le contenu brut des notifications, les en-têtes et les signatures ne sont jamais affichés. », filtres « Statut » (« En échec » par défaut), « Fournisseur », « Paiement (identifiant) ».
2. Lire l'état vide : « Aucun webhook en échec » et « Toutes les notifications reçues ont été appliquées ou ignorées. »
3. Changer « Statut » en « Traité », « Ignoré », « Reçu » : « Aucun événement pour ce filtre ».
4. Saisir dans « Paiement (identifiant) » la valeur `abc`.
Résultat attendu : la démonstration n'envoie aucune notification d'opérateur : toutes les listes sont vides et le rejeu (« Rejouer », puis « Rejouer l'événement » avec la case de confirmation) ne peut pas être exercé ; il n'apparaîtrait de toute façon que pour la direction sur une ligne « En échec ». Étape 4 : « Identifiant de paiement invalide. »
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le secrétariat (`/v2/finance/webhooks` : « Accès refusé »)

#### 12.38 Contrôle des droits par adresse tapée à la main
Un refus de page redirige vers `/unauthorized` (titre « Accès refusé », texte "Vous n'avez pas les droits nécessaires pour afficher cette page.", lien de retour à l'accueil) sans aucune donnée. Un identifiant d'un autre établissement ou inexistant donne un bloc d'erreur "… introuvable (...)." Vérifier chaque ligne.
| Compte | Adresses à taper | Résultat attendu |
|---|---|---|
| Enseignant | `/v2/finance`, `/v2/finance/invoices`, `/v2/finance/payments`, `/v2/finance/me` | « Accès refusé » (aucune entrée « Finance » dans son menu) |
| Secrétariat | `/v2/finance/payments/new`, `/v2/finance/invoices/new`, `/v2/finance/reports`, `/v2/finance/fees`, `/v2/finance/cash` | « Accès refusé ». Les listes factures, paiements, reçus, remboursements, à rapprocher et remises et bourses s'ouvrent en lecture, **sans** bouton « Nouvelle facture », « Encaisser un paiement », « Demander un remboursement », « Résoudre à la main », « Nouvelle bourse » |
| Économe | `/v2/finance/providers` | « Accès refusé ». Sur « À rapprocher » : pas de « Résoudre à la main » ; sur « Webhooks en échec » : pas de « Rejouer » |
| Parent | `/v2/finance/invoices`, `/v2/finance/payments`, `/v2/finance/cash`, `/v2/finance/me/abc`, `/v2/finance/me/<id d'un élève hors famille>` | trois premières : « Accès refusé » ; `abc` : page introuvable ; la dernière : écran « Accès refusé » avec « Retour à mes finances » |
| Élève | `/v2/finance/reports`, `/v2/finance/me/<id de Salimata>` | « Accès refusé » ; écran « Accès refusé » avec le message de rattachement |
Cas invalides : le comportement attendu est celui du tableau ; toute donnée visible malgré le refus est un écart Bloquant.
- [ ] Cas nominal (rôles autorisés)  - [ ] Cas invalide  - [ ] Droit refusé pour chaque rôle du tableau

#### 12.39 Isolation entre établissements
Comptes : économe du Collège puis économe de l'École Les Palmiers · Où : adresses copiées · Prérequis : 12.12, 12.21.
1. Dans la session de l'économe du Collège, copier la fin des adresses : fiche de la facture n°1 (`/v2/finance/invoices/<id>`), fiche du paiement "VIR-TG-001" (`/v2/finance/payments/<id>`), reçu du même paiement (`/v2/finance/receipts/<id>`).
2. Se connecter en économe de l'École Les Palmiers (`econome@primaire-test.test`) et ouvrir les trois adresses collées.
3. Ouvrir `/v2/finance/invoices` : aucune facture "test guide" du Collège.
Résultat attendu : "Facture introuvable (`<id>`).", "Paiement introuvable (`<id>`).", "Reçu introuvable (`<id>`)." avec le bouton « Réessayer » ; aucune donnée du Collège n'apparaît dans les listes de l'école. Le catalogue de frais "TG-DIVERS" n'existe pas à l'école tant qu'on ne l'y crée pas.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé (un compte d'un autre établissement n'a aucun accès)

#### 12.40 Mêmes écrans dans les deux autres établissements
Comptes : économe et directeur de l'École Les Palmiers (`primaire-test`) et de l'Université Horizon (`superieur-test`) · Prérequis : 12.1 à 12.39 au Collège.
1. Rejouer la chaîne de test (en-tête de 12a) dans chaque établissement : mêmes codes `TG-...` et mêmes noms, mêmes montants (les noms sont uniques par établissement).
2. Contrôler les différences :
| Point | École Les Palmiers | Université Horizon |
|---|---|---|
| Inscription / scolarité (barèmes de la graine) | 15 000 / 120 000 F CFA | 50 000 / 600 000 F CFA |
| Codes des frais de la graine | "REGISTRATION", "TUITION" | "INSC", "SCOL" |
| Solde de l'inscription d'Elie (12.34) | 10 000 puis 5 000 | 10 000 puis 40 000 |
| Financement « Affecté par l'État » et bourse de type « État » | désactivés (« L'affectation par l'État n'est pas incluse dans l'offre de l'établissement. ») | idem |
| Reste dû de Salimata DIABATE | 60 000 F CFA (moitié de 120 000) | 300 000 F CFA |
Résultat attendu : tous les écrans se comportent à l'identique ; seuls les montants de la graine et les fonctions de l'offre diffèrent.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour l'enseignant de chaque établissement

#### 12.41 Qualité transversale : états, clavier, petits écrans
Compte : économe · Où : tous les écrans du chapitre.
1. **États vides et chargement** : liste filtrée sans résultat (« Aucun paiement », « Aucune facture », « Aucun reçu », « Aucun remboursement », « Aucune remise »), message de chargement bref puis tableau.
2. **Clavier** : sur `/v2/finance/payments/new`, parcourir au clavier (Tab / Maj+Tab) : focus visible, ordre logique ; ouvrir la fenêtre « Confirmer l'encaissement » : le focus reste dans la fenêtre, **Échap** la ferme et ramène au formulaire (le focus ne revient pas toujours au bouton d'origine : Suggestion connue).
3. **Petit écran** : réduire la fenêtre à environ 375 px : les tableaux masquent des colonnes secondaires, les boutons restent atteignables, aucun défilement horizontal de page.
4. **Français** : aucun mot anglais ni code brut dans les écrans, hors les écarts listés (codes `sandbox`, `sandbox_declined`, `payerRef`, identifiants courts).
Résultat attendu : conforme aux points ci-dessus ; consigner chaque écart avec écran et gravité.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé (sans objet)

---

## Données créées

(Aucune suppression n'est possible dans l'interface pour les barèmes, plans, remises, paiements, reçus, factures émises, avoirs et sessions de caisse : voir `_annexe-fragments/12-finance.md`.)

| Enregistrement | Nom / code | Établissement |
|---|---|---|
| Frais | `TG-DIVERS` "Frais divers test guide" ; `TG-CANTINE` "Frais de cantine test guide" | chaque établissement rejoué |
| Barème | `TG-DIVERS`, 2026-2027, 60 000 F CFA | idem |
| Plans | `TG-3T` "Plan 3 tranches test guide" ; `TG-FIXE` "Plan acompte test guide" | idem |
| Remises | `TG-REM10` ; `TG-REM5000` | idem |
| Caisse et sessions | `TG-CAISSE-1` "Caisse test guide" ; deux sessions clôturées | idem |
| Factures | n°1 (DIABATE Nadia, 54 000) ; n°2 reprise de solde (25 000) ; brouillon de 12.9 ; n°3 annulée (COULIBALY Moussa) ; n°4 famille 48 000 + part du financeur 12 000 (SORO Aya) | Collège |
| Paiements | "VIR-TG-001", espèces 8 000, "MM-TG-001", en ligne 5 000 / 5 001 / 5 013, "VIR-TG-002", "CHQ-TG-0001", parent 4 000 / 2 001 / 2 013, élève 3 013, doublon "MM-TG-001" 1 000, financeur "VIR-TG-FIN-001", inscription de SORO Elie "VIR-TG-INSC-1" et "VIR-TG-INSC-2" | Collège |
| Reçus, avoir, remboursements | un reçu par paiement confirmé ; un avoir de 3 000 ; remboursements de 3 000 (exécuté), 2 000 (refusé), 1 000 en ligne (manuel, "REMB-TG-001") | Collège |
| Résolutions | preuves "RELEVE-TG-001" et "RELEVE-TG-002" | Collège |
| Financement | bourse "Fondation Test Guide" (terminée), type de SORO Aya remis à « Privé (famille) » | Collège |
| Effet de bord | inscription de SORO Elie passée « Active » | Collège |

## Écarts constatés

| Écran | Constat | Gravité |
|---|---|---|
| `/v2/finance/payments/new` | Un paiement supérieur au solde est accepté et devient un acompte "non imputé" ; la fenêtre de confirmation n'affiche ni solde ni reste (QA C-05-01, décision métier en attente) | Majeur |
| `/v2/finance/payments/online`, détail parent | La liste des fournisseurs propose cinq opérateurs réels non configurés ; le refus affiche un message avec le code brut `orange_money` (QA C-05-02) ; le fournisseur simulé n'apparaît qu'avec `NEXT_PUBLIC_FINANCE_SANDBOX=1` | Majeur |
| Reçu PDF (famille) | Le QR encode `<REPORTCARDS_VERIFICATION_BASE_URL>/v/<code>` ; en développement la base est `http://localhost:3000`, et seule la route `/v2/verify/v/<code>` existe : l'adresse du QR n'aboutit à aucun écran (scan impossible en local) | Majeur |
| `/v2/finance/payments/new` | « Référence du financeur » attend un identifiant interne (UUID), visible seulement dans le bandeau de la facture du financeur, qui affiche l'identifiant au lieu du nom (QA C-05-03) | Mineur |
| `/v2/finance/payments/new?learnerId=`, fiche paiement, liste des remboursements, bandeau financeur | Identifiants courts ou complets à la place des noms (QA C-05-07) | Mineur |
| Suivi des paiements en ligne | Codes bruts `sandbox_declined`, colonne « Fournisseur » = `sandbox`, message "Un paiement de financeur indique la prise en charge concernée (payerRef)." (QA C-05-09) | Mineur |
| Suivi d'un paiement en ligne | « Vérifier maintenant » ne produit aucun message (le statut reste « En attente ») ; sur « À rapprocher » un message existe (QA C-05-10) | Mineur |
| Listes d'encaissements, reçus famille | Aucune mention "simulé" dans les listes ni sur le reçu de la famille (QA C-05-11, C-12-02) | Mineur |
| Facture, paiement | Une échéance de facture dans le passé est acceptée sans avertissement ; aucun avertissement de doublon de référence (QA C-05-18) | Mineur |
| Accès refusé | Page `/unauthorized` hors de la coque (menu absent) et appels 403 répétés (QA C-05-16) | Mineur |
| Catalogue | Aucun bouton pour mettre un barème, un plan ou une remise hors vigueur : les données de test ne se nettoient pas | Mineur |
| `/v2/finance/funding` | Le bouton « Réactiver » reste proposé sur une bourse « Terminée » | Mineur |
| `/v2/finance/invoices/abc` | Identifiant mal formé : bloc d'erreur technique au lieu d'une page introuvable (contrairement à `/v2/finance/me/abc`) | Suggestion |
| Lien « Ouvrir la page de paiement » | Pointe vers `https://sandbox.invalid/...` (QA C-05-12) | Suggestion |
| Textes d'aide | "Remboursements : Approuver ou exécuter les demandes." (accueil), « Un gestionnaire doit d'abord créer une caisse. » (caisse), "Rejouez-les..." (webhooks) contredisent les droits réels de l'économe (QA C-05-15) | Suggestion |

## À vérifier en test

- Message exact de l'API à « Calculer l'aperçu » sans apprenant ni frais ("Choix invalide." attendu), identifiant de facture mal formé.
- Statut d'une facture émise avec une échéance passée (« Émise » ou « En retard ») avant le passage de la tâche de nuit.
- Que le message « Ce paiement avait déjà été enregistré : aucun doublon n'a été créé. » apparaisse sur une réponse perdue.
- Le montant du « Comptes fournisseurs » (compte, encaissé, échoués) après les scénarios, et le compte actif (établissement ou plateforme).
- Si la fenêtre « Confirmez votre identité » est demandée à la résolution manuelle après une connexion MFA récente.
- Si le PDF d'un reçu se lit (texte compressé) et le contenu du code de vérification imprimé.
- Si « Réactiver » est refusé par l'API sur une bourse terminée.
- Date exacte affichée (format "1 sept. 2026" ou autre) selon la langue du navigateur.

## Non couvert / limites connues

- Rapprochement automatique à l'issue des 12 tentatives (plus de 30 heures) et signalement « À rapprocher (action humaine) » : non testables dans une séance. Le fournisseur simulé garde son état en mémoire de l'API ; après un redémarrage, « Vérifier maintenant » échoue pour un paiement en attente (d'où la résolution manuelle).
- Webhooks réels (signature, rejeu) : aucun événement n'existe en démonstration ; le rejeu n'est pas exercé.
- Fournisseurs réels (Orange Money, MTN MoMo, Wave, CinetPay, TrésorPay) : jamais configurés ; aucun vrai paiement. Aucun reversement des fonds partagés (limite assumée).
- Cumul de financements (bourse + État + famille) : aucun écran de base de calcul `TOTAL`, non couvert.
- Idempotence par clé à partir de l'interface : seul le double clic est reproductible ; "même clé, demande différente" (409) n'est pas atteignable sans outil d'API.
- Exports CSV serveur (`/exports/...`) : non reliés à l'interface ; seuls les exports côté écran sont testés.
- Élèves affectés par l'État (facture scindée, créance) : chapitre 19. Imports de soldes d'ouverture : chapitre sur les imports. Paie : chapitre 13.
- Relances d'impayés : aucun écran ni envoi dans la finance.
- Propriétaire : mêmes droits que le directeur, non rejoué.
