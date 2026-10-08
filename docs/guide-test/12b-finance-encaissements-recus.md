# Chapitre 12 (suite). Caisse, encaissements, paiement en ligne simulé, reçus

> Suite de `12a-finance-catalogue-factures.md` (en-tête commun : prérequis, comptes, droits, données de départ, conventions, chaîne de test). Scénarios `12.11` à `12.21`, à exécuter dans l'ordre : chaque montant attendu suppose les précédents faits. La facture n°1 test guide (54 000 F CFA, 3 tranches de 18 000) est celle de DIABATE Nadia créée en `12.7`.

État de la facture n°1 au fil des scénarios (reste dû) : 54 000 → `12.12` 44 000 → `12.13` 36 000 → `12.14` 30 000 → `12.16` 25 000 → `12.18` 18 000 → `12.19` 15 000.

#### 12.11 Caisse : constater l'absence de session, créer la caisse, ouvrir une session
Compte : économe · Où : `/v2/finance/payments/new` puis barre de sections « Caisse » (`/v2/finance/cash`) · Prérequis : aucune session ouverte pour ce compte.
1. Ouvrir `/v2/finance/payments/new`. Le mode par défaut est « Espèces » : l'avertissement « Aucune session de caisse ouverte : un paiement en espèces doit être rattaché à votre session. » s'affiche avec le lien « Ouvrir une session de caisse », et le bouton « Vérifier et encaisser » est désactivé.
2. Cliquer « Ouvrir une session de caisse » (mène à `/v2/finance/cash`). Lire : « Ma session » (« Aucune session ouverte. Choisissez une caisse pour commencer à encaisser des espèces. »), « Caisses » (« Aucune caisse » et « Un gestionnaire doit d'abord créer une caisse. » : ce texte est trompeur pour l'économe, qui peut créer une caisse, voir "Écarts"), « Historique des sessions » (« Aucune session »).
3. Cliquer « Nouvelle caisse » (en haut) : fenêtre « Nouvelle caisse ».
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Code | TG-CAISSE-1 | oui |
   | Libellé | Caisse test guide | oui |
   | Campus | « Tous les campus » (champ présent seulement si l'établissement a des campus) | non |
4. « Créer ».
5. Sur la ligne "Caisse test guide", cliquer « Ouvrir une session » : fenêtre « Ouvrir une session de caisse » (« Indiquez le fonds de caisse remis au caissier. »). Fonds de caisse = 10000 (aide : « 0 si la caisse démarre à vide. »). « Ouvrir la session ».
Résultat attendu : message « La caisse a été créée. » puis « La session de caisse est ouverte. » ; « Ma session » affiche le nom de la caisse avec la pastille « Ouverte », « Ouverte le », « Fonds de caisse » 10 000 F CFA, « Encaissé » 0, « Remboursé » 0, « Nombre d'encaissements » 0, la consigne « À la clôture, comptez l'argent en caisse avant de saisir le montant : l'attendu et l'écart sont calculés par le système. » et les boutons « Clôturer la session » et « Encaisser un paiement ». Retour sur `/v2/finance/payments/new` : l'avertissement a disparu.
Cas invalides : | Saisie | Message attendu |
|---|---|
| Code ou Libellé vide, « Créer » | « Ce champ est obligatoire. » |
| Code `TG CAISSE` | "Code de caisse invalide." |
| Code `tg-caisse-1` une seconde fois | `Le code de caisse "TG-CAISSE-1" existe déjà.` |
| Fonds de caisse `-100` | « Le montant ne peut pas être négatif. » |
| Fonds de caisse vide | « Saisissez un montant. » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le secrétariat (`/v2/finance/cash` : « Accès refusé »)

#### 12.12 Virement partiel (paiement n°1) et double clic
Compte : économe · Où : barre « Encaissements » > « Encaisser un paiement » (`/v2/finance/payments/new`) · Prérequis : 12.7.
1. Bloc « Apprenant » : choisir "DIABATE Nadia". La zone « Factures ouvertes » liste la facture n°1 avec « Reste dû 54 000 F CFA » (le brouillon de 12.9 n'y figure pas).
2. Bloc « Paiement » :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Montant encaissé | 10000 | oui |
   | Mode de paiement | « Virement » | oui |
   | Référence | VIR-TG-001 | oui pour un virement (exigé par l'API) |
   | Nom du payeur | DIABATE Séka | non (figure sur le reçu) |
   | Qui paie ? | « Famille » | non |
3. Bloc « Imputation du paiement » : laisser « Automatique » (« Ordre d'imputation » = « Ordre par défaut de l'établissement », aucune facture cochée).
4. Cliquer « Vérifier et encaisser » : la fenêtre « Confirmer l'encaissement » rappelle Apprenant, Montant (10 000 F CFA), Mode (« Virement »), Imputation (« Automatique »). Cliquer **deux fois rapidement** sur « Confirmer l'encaissement ».
Résultat attendu : écran « Paiement enregistré » avec « Le paiement de 10 000 F CFA a été enregistré. », « Reçu » (lien `REC-2026-nnnnnn`, **à noter**), « Imputé » 10 000 F CFA, « Non imputé » 0, « Reste dû après paiement » 44 000 F CFA, "1 imputation enregistrée(s)." et les boutons « Voir et imprimer le reçu », « Fiche du paiement », « Nouvel encaissement ». **Un seul** paiement est créé (une seule requête part, une clé d'idempotence l'accompagne) : vérifier dans « Encaissements » qu'il n'y a qu'une ligne de 10 000 F CFA "VIR-TG-001". La facture n°1 est « Partiellement payée » (payé 10 000, reste dû 44 000) ; la tranche 1 est « Partiellement payée » (reste 8 000).
Cas invalides : voir `12.15`.
- [ ] Cas nominal  - [ ] Cas invalide (12.15)  - [ ] Droit refusé pour le secrétariat (`/v2/finance/payments/new` : « Accès refusé »)

#### 12.13 Encaissement en espèces rattaché à la session de caisse (paiement n°2)
Compte : économe · Où : `/v2/finance/payments/new` · Prérequis : 12.11 (session ouverte), 12.12.
1. Apprenant "DIABATE Nadia" ; Montant encaissé 8000 ; Mode de paiement « Espèces » ; Référence vide ; Nom du payeur DIABATE Séka ; imputation « Automatique ». « Vérifier et encaisser », « Confirmer l'encaissement ».
2. Cliquer « Fiche du paiement ».
3. Cliquer « Voir la session » (lien dans « Session de caisse »).
Résultat attendu : « Reste dû après paiement » 36 000 F CFA, tranche 1 soldée (« Payée »). La fiche affiche « Session de caisse » avec le lien « Voir la session » qui ouvre `/v2/finance/cash?session=<id>` et la fenêtre « Détail de la session ». Sur `/v2/finance/cash`, « Ma session » : « Encaissé » 8 000 F CFA, « Nombre d'encaissements » 1.
- [ ] Cas nominal  - [ ] Cas invalide (sans session, voir 12.11)  - [ ] Droit refusé pour le secrétariat

#### 12.14 Acompte par mobile money, puis imputation du solde (paiement n°3)
Compte : économe · Où : `/v2/finance/payments/new` puis fiche du paiement · Prérequis : 12.13.
1. Apprenant "DIABATE Nadia" ; Montant encaissé 6000 ; Mode « Mobile money » ; Référence MM-TG-001 ; Nom du payeur DIABATE Séka ; Imputation « Aucune (acompte) » (aide : « Le paiement est enregistré sans être imputé ; il pourra l'être plus tard depuis sa fiche. »). Confirmer.
2. Sur l'écran « Paiement enregistré » : lire « Imputé » 0 et « Non imputé » 6 000 F CFA ; « Reste dû après paiement » affiche « — ». Ouvrir « Voir et imprimer le reçu » : le reçu indique « Paiement non imputé » et « Non imputé » 6 000 F CFA, sans ligne « Reste dû après ce paiement ».
3. Ouvrir « Fiche du paiement » : « Non imputé » 6 000 F CFA ; cliquer « Imputer le solde » (section « Imputations »). Fenêtre « Imputer le solde du paiement » (« Répartit la part non imputée sur les échéances ouvertes. ») : laisser « Automatique », cliquer « Imputer ».
4. Rouvrir le reçu.
Résultat attendu : à l'étape 2 la facture n°1 reste à 36 000 F CFA. Étape 3 : message « L'imputation a été enregistrée. » ; « Imputé » 6 000, « Non imputé » 0, une ligne dans « Imputations du paiement » ; facture n°1 : reste dû 30 000 F CFA, tranche 2 : payé 6 000, reste 12 000. Étape 4 : le reçu est **inchangé** (il est figé : toujours « Paiement non imputé »).
Cas invalides : | Saisie | Message attendu |
|---|---|
| Dans « Imputer le solde » : « Manuelle » sans aucun montant | « Saisissez au moins un montant à imputer. » |
| Bouton « Imputer le solde » sur un paiement entièrement imputé | absent (il n'apparaît que s'il reste du non imputé) |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le secrétariat

#### 12.15 Encaissements : jeux invalides
Compte : économe · Où : `/v2/finance/payments/new`, apprenant "DIABATE Nadia" · Prérequis : 12.14. Aucun de ces essais ne doit créer de paiement : contrôler à la fin que la liste « Encaissements » n'a pas bougé.
Cas invalides : | Saisie | Message attendu |
|---|---|
| Montant `150,5` | « Le montant est un entier en francs : pas de virgule ni de point. » (sous le champ, dès la frappe) |
| Montant `-5` | « Le montant ne peut pas être négatif. » |
| Montant `0` ou `abc` | « Montant invalide : chiffres uniquement, strictement positif. » |
| Montant vide, « Vérifier et encaisser » | « Saisissez un montant. » |
| Montant de 16 chiffres (`1000000000000000`) | « Montant trop élevé. » |
| Montant 1000, mode « Virement », Référence vide, confirmer | dans la fenêtre : "La référence du virement est requise." (suivi de « Vous pouvez réessayer : la même demande est renvoyée, sans risque de doublon. ») ; « Revenir au formulaire » |
| Montant 1000, mode « Chèque », Référence vide | "Le numéro de chèque est requis." |
| Montant 1000, mode « Mobile money », Qui paie ? « Financeur », Référence du financeur vide | "Un paiement de financeur indique la prise en charge concernée (payerRef)." (message technique, voir "Écarts") |
| Montant 20000, imputation « Manuelle », 20000 saisis sur « Montant à imputer — Tranche 3 » (reste 18 000) | "L'imputation dépasse le reste dû de l'échéance." |
| Montant 5000, imputation « Manuelle », 12000 sur « Montant à imputer — Tranche 2 » (reste 12 000) | "Les imputations dépassent la part non imputée du paiement." |
| Imputation « Manuelle », aucun montant saisi | « Saisissez au moins un montant à imputer. » |
Pour l'imputation manuelle, déplier la ligne "Facture FAC-2026-nnnnnn — reste dû 30 000 F CFA" : chaque échéance ouverte propose un champ « Montant à imputer — Tranche N ».
Optionnel (idempotence sur panne réseau) : dans les outils du navigateur, passer "Hors ligne", cliquer « Confirmer l'encaissement » d'un paiement valide de 1000 en espèces : l'erreur réseau s'affiche avec "Vous pouvez réessayer…". **Ne pas confirmer en ligne** : fermer la fenêtre, repasser « En ligne » et abandonner (sinon un paiement de 1 000 F CFA serait créé et décalerait tous les montants suivants). Le message « Ce paiement avait déjà été enregistré : aucun doublon n'a été créé. » n'apparaît que si le serveur a reçu la première requête dont la réponse s'est perdue : non reproductible à la main, à vérifier en test.
- [ ] Cas nominal (non applicable)  - [ ] Cas invalide  - [ ] Droit refusé pour le secrétariat

#### 12.16 Paiement en ligne simulé côté économe : réussite, attente, échec
Compte : économe · Où : « Encaissements » > « Paiement en ligne » (`/v2/finance/payments/online`, titre « Initier un paiement en ligne ») · Prérequis : 12.14 ; fournisseur simulé proposé (voir en-tête de 12a).
1. Remplir :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Apprenant | "DIABATE Nadia" | oui |
   | Montant | 5000 | oui |
   | Fournisseur | « Paiement simulé (démonstration) » (présélectionné) | oui |
   | Facture visée | la facture n°1 (FAC-2026-nnnnnn) | non |
   | Téléphone du payeur | +225 07 10 20 30 40 | non |
   | Nom du payeur | DIABATE Séka | non |
   | Courriel du payeur | parent@exemple.test | non |
   | Libellé | Paiement en ligne test guide | non |
2. « Lancer le paiement ». Observer « Paiement lancé » et « Suivi du paiement ».
3. « Nouveau paiement en ligne » : même saisie avec Montant 5001. Cliquer « Vérifier maintenant ».
4. « Nouveau paiement en ligne » : Montant 5013.
5. Ouvrir « Retour aux encaissements » et filtrer sur "DIABATE Nadia".
Résultat attendu : règle de la simulation (trois derniers chiffres du montant) : 5 000 réussit, 5 001 reste en attente, 5 013 échoue.
| Montant | Suivi du paiement | Effet |
|---|---|---|
| 5 000 | pastille « Confirmé » : « Paiement confirmé par le fournisseur. » ; instructions "Paiement simulé accepté." | reçu émis ; facture n°1 : reste dû 25 000 F CFA (tranche 2 : reste 7 000) |
| 5 001 | pastille « En attente » : « En attente de la confirmation du fournisseur. Cet écran vérifie régulièrement. » ; bouton « Ouvrir la page de paiement » (lien `https://sandbox.invalid/...` : **ne pas l'ouvrir**) | aucun reçu, facture inchangée ; « Vérifier maintenant » ne produit aucun message et le statut reste « En attente » |
| 5 013 | pastille « Échoué » : "Paiement échoué : sandbox_declined" (code technique brut) | aucun reçu, facture inchangée |
Toujours : « Paiement simulé (environnement de test) : il ne peut pas être confirmé en production. » Dans « Encaissements » : trois lignes « En ligne » (« Confirmé », « En attente », « Échoué ») sans mention "simulé" dans la liste (la mention est sur la fiche de chaque paiement). Les montants `1 001` (attente) et `1 013` (échec) suivent la même règle (facultatif : ils ne modifient aucune facture).
Cas invalides : | Saisie | Message attendu |
|---|---|
| Montant `0` | « Montant invalide : chiffres uniquement, strictement positif. » |
| Fournisseur « Orange Money », montant 5000 | `Le fournisseur "orange_money" n'est pas configuré pour ce tenant.` (code brut ; aucun paiement créé) |
| « Autre fournisseur » + Code du fournisseur `moov_money` | `Fournisseur de paiement inconnu : "moov_money".` |
| « Autre fournisseur » + code `Orange Money` (majuscule, espace) | "Format invalide." (aide : « Minuscules, chiffres et _ (par exemple moov_money). ») |
| Courriel du payeur `abc` | "Adresse électronique invalide." |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le secrétariat (`/v2/finance/payments/online` : « Accès refusé »)

#### 12.17 Facture de reprise de solde d'ouverture (saisie libre) : la facture n°2 test guide
Compte : économe · Où : « Factures » > « Nouvelle facture », mode « Saisie libre » (`/v2/finance/invoices/new`) · Prérequis : 12.16.
1. Choisir le mode « Saisie libre » (aide : « Lignes et montants saisis à la main ; la facture est enregistrée en brouillon puis relue avant émission. »).
2. Remplir :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Apprenant | "DIABATE Nadia" | oui |
   | Inscription | la 6e A | non |
   | Année scolaire | 2026-2027 | non |
   | Catégorie (ligne) | « Autres » | oui |
   | Désignation (ligne) | Reprise du solde d'ouverture test guide | oui |
   | Quantité (ligne) | 1 | non |
   | Prix unitaire (ligne) | 25000 | oui |
3. « Enregistrer en brouillon » : on arrive sur la fiche, titre « Facture (brouillon) ».
4. Cliquer « Émettre la facture ».
Résultat attendu : étape 3, aucun numéro, statut « Brouillon ». Étape 4 : message "La facture FAC-2026-nnnnnn a été émise." (**noter** : facture n°2) ; statut « Émise », total 25 000 F CFA, une seule échéance, reste dû 25 000 F CFA. Cette facture représente une dette reprise d'un exercice précédent. Le même résultat en masse (factures et avoirs de reprise, MFA exigée au lancement, l'économe prépare seulement) relève de l'import "Soldes financiers d'ouverture" du chapitre sur les imports.
Cas invalides : | Saisie | Message attendu |
|---|---|
| Prix unitaire `-1` | « Le montant ne peut pas être négatif. » |
| Prix unitaire vide | « Saisissez un montant. » |
| Désignation vide | « Ce champ est obligatoire. » |
| Quantité `0` | "La valeur doit être supérieure ou égale à 1." |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le secrétariat

#### 12.18 Paiement multiple : un virement imputé sur deux factures (paiement n°4)
Compte : économe · Où : `/v2/finance/payments/new` · Prérequis : 12.16, 12.17. Situation : facture n°1 reste dû 25 000 (tranche 2 : 7 000 ; tranche 3 : 18 000) ; facture n°2 reste dû 25 000.
1. Apprenant "DIABATE Nadia" : « Factures ouvertes » liste les deux factures.
2. Montant encaissé 20000 ; Mode « Virement » ; Référence VIR-TG-002 ; Nom du payeur DIABATE Séka.
3. Imputation « Manuelle ». Déplier la facture n°1 : saisir 7000 dans « Montant à imputer — Tranche 2 ». Déplier la facture n°2 : saisir 13000 dans le champ de son unique échéance.
4. « Vérifier et encaisser » (la ligne « Imputation » indique « Manuelle »), « Confirmer l'encaissement ».
Résultat attendu : « Imputé » 20 000 F CFA, « Non imputé » 0, "2 imputations enregistrée(s).", « Reste dû après paiement » **30 000 F CFA** (somme des restes des deux factures touchées : 18 000 + 12 000). Facture n°1 : reste dû 18 000 F CFA ; facture n°2 : reste dû 12 000 F CFA, « Partiellement payée ». La fiche du paiement liste deux imputations ; le reçu en liste deux lignes (Facture, Échéance, Montant).
- [ ] Cas nominal  - [ ] Cas invalide (12.15)  - [ ] Droit refusé pour le secrétariat

#### 12.19 Paiement supérieur au solde (acompte), puis imputation sur une autre facture (paiement n°5)
Compte : économe · Où : `/v2/finance/payments/new`, puis fiche du paiement · Prérequis : 12.18.
1. Apprenant "DIABATE Nadia" ; Montant encaissé 15000 (la facture n°2 n'a plus que 12 000 à payer) ; Mode « Chèque » ; Référence CHQ-TG-0001 ; Nom du payeur DIABATE Séka.
2. Imputation « Automatique » ; dans « Limiter à certaines factures », cocher uniquement la facture n°2 ("Facture FAC-… — reste dû 12 000 F CFA").
3. Confirmer. Aucun avertissement de dépassement n'est affiché avant la confirmation (la fenêtre ne montre ni solde ni reste : voir "Écarts").
4. Fiche du paiement : « Imputer le solde » > « Automatique » > « Imputer ».
Résultat attendu : étape 3 : « Imputé » 12 000, « Non imputé » **3 000** F CFA, « Reste dû après paiement » 0 ; la facture n°2 est « Payée ». C'est le comportement actuel : le trop-perçu devient un acompte non imputé (décision métier à confirmer, voir « À vérifier »). Étape 4 : « L'imputation a été enregistrée. » ; les 3 000 F CFA vont sur la seule échéance ouverte (tranche 3 de la facture n°1) : reste dû de la facture n°1 **15 000 F CFA**, paiement entièrement imputé.
Cas invalides : | Saisie | Message attendu |
|---|---|
| Rouvrir « Imputer le solde » sur ce paiement | le bouton n'existe plus (tout est imputé) |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le secrétariat

#### 12.20 Liste des encaissements et fiche d'un paiement
Compte : économe · Où : barre « Encaissements » (`/v2/finance/payments`) · Prérequis : 12.19.
1. Lire la liste (légende « Liste des paiements », colonnes « Date », « Apprenant », « Mode », « Statut », « Montant », « Non imputé », « Référence ») et les filtres « Apprenant », « Statut », « Mode », « Du », « Au ».
2. Filtre « Apprenant » = "DIABATE Nadia". Compter **10 lignes** : 2 de la graine (25 000 inscription, 200 000 scolarité) et 8 de ce chapitre : 10 000 (VIR-TG-001), 8 000 (espèces), 6 000 (MM-TG-001), 5 000, 5 001 et 5 013 (« En ligne »), 20 000 (VIR-TG-002), 15 000 (CHQ-TG-0001).
3. « Statut » = « En attente » : 1 ligne (5 001). « Statut » = « Échoué » : 5 013. « Mode » = « Chèque » : 15 000.
4. Remplir « Du » et « Au » avec la date du jour : les paiements du jour seuls.
5. Cliquer « Exporter en CSV » (un fichier `encaissements.csv` est téléchargé ; il contient les lignes de la page affichée avec les colonnes Date, Apprenant, Mode, Statut, Montant, Imputé, Non imputé, Remboursé, Référence).
6. Ouvrir la fiche du virement "VIR-TG-001" (clic sur sa date).
7. Ouvrir la fiche du paiement 5 001, puis celle du paiement 5 013.
Résultat attendu : étape 6 : titre « Paiement de 10 000 F CFA », sous-titre "DIABATE Nadia · Virement", bouton "Reçu REC-…" ; « Résumé » avec la pastille « Confirmé », « Montant » 10 000, « Imputé » 10 000, « Non imputé » 0, « Remboursé » 0, « Reçu le », « Payeur » DIABATE Séka, « Référence » VIR-TG-001 ; « Imputations » (« Facture » en identifiant court, « Imputé », « Repris », « Net ») ; « Remboursements » : « Aucun remboursement » et le bouton « Demander un remboursement ». Étape 7 : le paiement 5 001 affiche « Paiement simulé (environnement de test). », le suivi et « En attente » ; le 5 013 affiche "Paiement échoué : sandbox_declined".
Cas invalides : | Saisie | Message attendu |
|---|---|
| Filtre sans résultat (« Statut » = « Remboursé » avant `12.28`) | « Aucun paiement » et « Modifiez les filtres ou enregistrez un encaissement. » |
| `/v2/finance/payments/00000000-0000-4000-8000-000000000000` | "Paiement introuvable (00000000-0000-4000-8000-000000000000)." |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour l'enseignant (`/v2/finance/payments` : « Accès refusé »)

#### 12.21 Reçus : liste, fiche imprimable, immuabilité
Compte : économe · Où : barre « Reçus » (`/v2/finance/receipts`) · Prérequis : 12.19.
1. Lire la liste (légende « Liste des reçus », colonnes « Numéro », « Date », « Apprenant », « Mode », « Montant »). Filtre « Apprenant » = "DIABATE Nadia" : **8 reçus** (2 de la graine, 6 de ce chapitre : les paiements 10 000, 8 000, 6 000, 5 000, 20 000 et 15 000). Le 5 001 (en attente) et le 5 013 (échoué) n'ont pas de reçu.
2. Ouvrir le reçu du virement "VIR-TG-001". Lire : titre "Reçu REC-2026-nnnnnn", boutons « Retour aux reçus » et « Imprimer ou enregistrer en PDF » ; document « Reçu de paiement » : nom de l'établissement, numéro, « Date », « Apprenant », « Payeur » (DIABATE Séka, Famille), « Mode de paiement » ("Virement · VIR-TG-001"), tableau « Imputations du paiement » (« Facture », « Échéance », « Montant » : FAC-… · Tranche 1 · 10 000), « Reste dû après ce paiement » 44 000 F CFA, « Montant reçu » 10 000 F CFA, pied de page « Reçu émis automatiquement ; il ne peut pas être modifié. »
3. Cliquer « Imprimer ou enregistrer en PDF » (boîte d'impression ; la navigation disparaît à l'impression). Fermer.
4. Ouvrir le reçu du virement "VIR-TG-002" : deux lignes d'imputation et « Reste dû après ce paiement » 30 000 F CFA.
5. Chercher un bouton de modification ou de suppression.
Résultat attendu : numéros consécutifs sans trou parmi les reçus du jour ; aucun bouton « Modifier » ni « Supprimer » ; une erreur se corrige par un avoir (`12.25`) ou un remboursement (`12.28`), jamais en changeant le reçu. Le PDF scellé et sa vérification publique sont au scénario `12.33` (côté famille).
Cas invalides : | Saisie | Message attendu |
|---|---|
| `/v2/finance/receipts/00000000-0000-4000-8000-000000000000` | "Reçu introuvable (00000000-0000-4000-8000-000000000000)." |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le parent (`/v2/finance/receipts` : « Accès refusé » ; le parent passe par `/v2/finance/me`)
