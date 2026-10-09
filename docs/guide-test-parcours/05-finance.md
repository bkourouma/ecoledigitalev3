[⬅ Sommaire](../GUIDE_TEST_UTILISATEUR_COMPLET.md) · [← Précédent](04-admissions.md) · [Suivant →](06-emploi-du-temps.md)

# Phase 5 — Finance : frais, facture, encaissements, reçus

Cette phase construit le catalogue de l'économe (frais, barème, plan en 3 tranches, remises), émet la **facture n°1 test guide** de 54 000 F CFA au nom de DIABATE Nadia (élève de la graine, 6e A), l'encaisse de cinq manières (virement partiel, espèces, mobile money, paiement en ligne simulé, chèque) et lit les reçus. Les remboursements, le portail famille, le rapprochement et la clôture de caisse sont repris dans une phase suivante, qui suppose l'état laissé ici.

Précondition : l'application tourne avec le fournisseur simulé (« Paiement simulé (démonstration) » apparaît dans l'écran de paiement en ligne) et le service de tâches de fond (worker). Règle du paiement simulé : montant finissant par `001` = en attente, `013` = échec, tout autre montant = réussite. Montants en F CFA entiers, sans virgule.

---

## Étape 74 — Relever la synthèse financière de départ
👤 **économe** (`econome@secondaire-test.test`, **MFA**) · fenêtre **A** · 📂 Menu **"Tableau de bord financier"** (`/v2/finance`)

1. Se connecter en économe (page d'accueil du rôle : `/v2/finance`).
2. Lire le titre « Finance » et le bloc « Synthèse » : huit cartes (« Facturé », « Avoirs », « Facturé net », « Encaissé », « Restant dû », « En retard », « Paiements non imputés », « Taux de recouvrement »).
3. **Noter** « Facturé », « Encaissé » et « Restant dû » : ils servent aux contrôles de fin de chapitre finance.
4. Lire « Accès rapides » (six raccourcis) et cliquer **« Factures en retard »**.

✅ Les huit cartes se remplissent sans erreur (les chiffres dépendent de la base : raisonner en écarts, l'inscription d'Awa a déjà été payée à la phase précédente). Le raccourci mène à `/v2/finance/invoices?status=OVERDUE`, le filtre « Statut » affiche « En retard » et la liste est vide : « Aucune facture ».

🔒 *Test de droit* : en tant que secrétariat (`secretariat@secondaire-test.test`, MFA), `/v2/finance` s'affiche sans cartes de synthèse ; en tant qu'enseignant, `/v2/finance` → « Accès refusé ».

☐ OK ☐ KO

---

## Étape 75 — Créer le frais TG-DIVERS
👤 **économe** · fenêtre **A** · 📂 Barre de sections **« Frais et barèmes »** (`/v2/finance/fees`)

Attendu au départ : "REGISTRATION" "Frais d'inscription" et "TUITION" « Scolarité », tous deux « Actif ».

1. Cliquer **« Nouveau frais »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Code | `TG-DIVERS` |
| Libellé | `Frais divers test guide` |
| Catégorie | « Autres » |
| Description | `Frais de démonstration du guide de test` |

2. Cliquer **« Créer »**.
3. Recommencer avec Code `TG-CANTINE`, Libellé `Frais de cantine test guide`, Catégorie « Cantine » (sans description). Ce second frais n'aura volontairement pas de barème.

✅ Message `Le frais "Frais divers test guide" a été créé.` ; la ligne "TG-DIVERS" apparaît avec « Autres » et « Actif », et reste après rechargement.

⚠️ *Test d'erreur* : Code vide → « Ce champ est obligatoire. » ; Code `TG DIVERS` (espace) → "Code de frais invalide (A-Z, 0-9, _ ou -, 40 caractères max)." ; Code `tg-divers` (déjà pris) → `Le code de frais "TG-DIVERS" existe déjà.`

🔒 *Test de droit* : en tant que secrétariat, taper `/v2/finance/fees` → « Accès refusé ».

☐ OK ☐ KO

---

## Étape 76 — Fixer le barème de TG-DIVERS (60 000 F CFA)
👤 **économe** · fenêtre **A** · 📂 **« Frais et barèmes »** > **« Barèmes »** (`/v2/finance/fees/schedules`)

1. Cliquer **« Nouveau barème »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Frais | Frais divers test guide |
| Année scolaire | `2026-2027` |
| Montant | `60000` |
| En vigueur à partir du | `2026-09-01` |
| Jusqu'au (facultatif) | (vide) |
| Plan d'échéancier par défaut | « Aucun » |

2. Cliquer **« Créer le barème »**.
3. Dans la zone **« Quel montant s'applique ? »**, choisir Frais divers test guide et l'année `2026-2027`, cliquer **« Résoudre »**.

✅ « Le barème a été créé. » ; ligne "Frais divers test guide" · 2026-2027 · « Tous les apprenants » · 60 000 F CFA · « En vigueur ». Résolution : `Montant applicable : 60 000 F CFA (année 2026-2027).` Avec "Frais de cantine test guide" : alerte "Aucun barème ne s'applique à ce frais pour ce périmètre et cette date."

⚠️ *Test d'erreur* : Montant `60 000,5` → « Le montant est un entier en francs : pas de virgule ni de point. » ; Montant `-5` → « Le montant ne peut pas être négatif. »

⚠️ *Écart connu* : aucun bouton ne met un barème hors vigueur ; ne pas créer de second barème chevauchant (il serait refusé : "Un barème actif couvre déjà ce périmètre sur cette période.").

☐ OK ☐ KO

---

## Étape 77 — Créer le plan d'échéancier en 3 tranches
👤 **économe** · fenêtre **A** · 📂 **« Frais et barèmes »** > **« Plans d'échéancier »** (`/v2/finance/fees/plans`)

Attendu au départ : « Aucun plan d'échéancier ». Si « Nouveau plan » est absent (« Les échéanciers ne sont pas inclus dans l'offre de l'établissement. »), consigner l'écart et passer à la remise : la facture n°1 se fera alors sans plan.

1. Cliquer **« Nouveau plan »**, saisir Code `TG-3T` et Libellé `Plan 3 tranches test guide`.
2. Échéance 1 : Libellé `Tranche 1`, Type de part « Pondérée », Poids `1`, « Nombre de jours après la facture » `0`.
3. **« Ajouter une échéance »** deux fois : `Tranche 2` (« Pondérée », poids `1`, 30 jours) et `Tranche 3` (« Pondérée », poids `1`, 60 jours).
4. Cliquer **« Créer le plan »**.

✅ Message `Le plan "Plan 3 tranches test guide" a été créé.` ; carte `TG-3T` avec les lignes "Tranche 1 Poids 1 · échéance à +0 j", "Tranche 2 … +30 j", "Tranche 3 … +60 j".

⚠️ *Test d'erreur* : Code `tg-3t` une seconde fois → `Le code de plan "TG-3T" existe déjà.` ; Poids `0` → "La valeur doit être supérieure ou égale à 1."

☐ OK ☐ KO

---

## Étape 78 — Créer deux remises non cumulables
👤 **économe** · fenêtre **A** · 📂 **« Frais et barèmes »** > **« Remises »** (`/v2/finance/fees/discounts`)

1. Cliquer **« Nouvelle remise »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Code | `TG-REM10` |
| Libellé | `Remise 10 % test guide` |
| Type | « Pourcentage » |
| Pourcentage | `10` |
| Cumulable avec d'autres remises | décochée |

2. Cliquer **« Créer »**. Seconde remise : Code `TG-REM5000`, Libellé `Remise 5 000 F test guide`, Type « Montant fixe », Montant `5000`, « Cumulable avec d'autres remises » décochée.

✅ Messages `La remise "Remise 10 % test guide" a été créée.` puis le même pour la seconde ; valeurs "10,00 %" et "5 000 F CFA", cumulable « Non », statut « Active ».

⚠️ *Test d'erreur* : Pourcentage `150` → « Le pourcentage doit être compris entre 0,01 et 100. » ; Code `TG-REM10` en double → `Le code de remise "TG-REM10" existe déjà.`

☐ OK ☐ KO

---

## Étape 79 — Émettre la facture n°1 test guide (DIABATE Nadia, 54 000 F CFA)
👤 **économe** · fenêtre **A** · 📂 Barre **« Factures »** > **« Nouvelle facture »** (`/v2/finance/invoices/new`)

1. Vérifier le mode « Depuis le catalogue ». Bloc « Apprenant » : Apprenant = "DIABATE Nadia", Inscription = la seule proposée (6e A), Année scolaire `2026-2027`.
2. Bloc « Frais à facturer » : Frais = Frais divers test guide, Quantité `1`.
3. Bloc « Remises et échéancier » : cocher **les deux** remises, Plan d'échéancier = "Plan 3 tranches test guide"; laisser les dates vides.
4. Constater que « Enregistrer en brouillon » et « Émettre la facture » sont désactivés (« Calculez l'aperçu pour pouvoir émettre ou enregistrer la facture. »).
5. Cliquer **« Calculer l'aperçu »**.
6. Décocher "Remise 5 000 F test guide" : le bandeau « Le formulaire a changé depuis l'aperçu : recalculez-le avant d'émettre. » apparaît ; cliquer de nouveau **« Calculer l'aperçu »**.
7. Cliquer **« Émettre la facture »**.

✅ Aperçu : « Sous-total » 60 000 F CFA, « Remises » **6 000 F CFA** (de deux remises non cumulables, seule la plus avantageuse s'applique), « Total » 54 000 F CFA ; trois échéances de 18 000 F CFA ("Tranche 1", "Tranche 2", "Tranche 3"). Après émission : écran « Facture enregistrée » (`1 facture a été enregistrée.`) et lien `FAC-2026-nnnnnn` : **noter ce numéro (facture n°1)**. Dans « Factures » : « Émise », total et reste dû 54 000 F CFA.

⚠️ *Test d'erreur* : Quantité `0` → "La valeur doit être supérieure ou égale à 1." ; Frais = Frais de cantine test guide puis « Calculer l'aperçu » → alerte "Aucun barème ne s'applique à ce frais pour ce périmètre et cette date." (aucune facture créée).

☐ OK ☐ KO

---

## Étape 80 — Lire la fiche de la facture n°1
👤 **économe** · fenêtre **A** · 📂 Barre **« Factures »** > ligne de la facture n°1 (`/v2/finance/invoices`)

1. Filtrer « Apprenant » = "DIABATE Nadia" : trois factures (inscription 25 000 « Payée », scolarité 200 000 « Payée », facture n°1) ; ouvrir la facture n°1.
2. Lire « Montants », « Lignes » et « Échéancier ».

✅ « Sous-total » 60 000, « Remises » 6 000, « Total » 54 000, « Payé » 0, « Reste dû » 54 000 F CFA ; une ligne "Frais divers test guide" (« Autres », 1, 60 000, remise 6 000, total 54 000) ; échéancier "Tranche 1", "Tranche 2", "Tranche 3" de 18 000 F CFA chacune, « À payer ». La section « Correction de la facture » propose « Émettre un avoir » et « Annuler la facture » (non utilisés dans cette phase).

☐ OK ☐ KO

---

## Étape 81 — Créer la caisse et ouvrir une session
👤 **économe** · fenêtre **A** · 📂 `/v2/finance/payments/new`, puis barre **« Caisse »** (`/v2/finance/cash`)

1. Ouvrir `/v2/finance/payments/new` : le mode « Espèces » affiche « Aucune session de caisse ouverte : un paiement en espèces doit être rattaché à votre session. » et « Vérifier et encaisser » est désactivé.
2. Cliquer **« Ouvrir une session de caisse »** (mène à `/v2/finance/cash`), puis **« Nouvelle caisse »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Code | `TG-CAISSE-1` |
| Libellé | `Caisse test guide` |

3. Cliquer **« Créer »**.
4. Sur la ligne "Caisse test guide", cliquer **« Ouvrir une session »**, saisir Fonds de caisse `10000`, cliquer **« Ouvrir la session »**.

✅ « La caisse a été créée. » puis « La session de caisse est ouverte. » ; « Ma session » : pastille « Ouverte », « Fonds de caisse » 10 000 F CFA, « Encaissé » 0, « Nombre d'encaissements » 0, boutons « Clôturer la session » (ne pas l'utiliser ici) et « Encaisser un paiement ».

⚠️ *Test d'erreur* : Fonds de caisse `-100` → « Le montant ne peut pas être négatif. » ; Code `TG CAISSE` → "Code de caisse invalide."

⚠️ *Écart connu* : avant la création, le texte « Un gestionnaire doit d'abord créer une caisse. » est trompeur : l'économe peut la créer.

☐ OK ☐ KO

---

## Étape 82 — Encaisser un virement partiel (10 000 F CFA)
👤 **économe** · fenêtre **A** · 📂 Barre **« Encaissements »** > **« Encaisser un paiement »** (`/v2/finance/payments/new`)

1. Bloc « Apprenant » : "DIABATE Nadia". La zone « Factures ouvertes » liste la facture n°1, reste dû 54 000 F CFA.
2. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Montant encaissé | `10000` |
| Mode de paiement | « Virement » |
| Référence | `VIR-TG-001` |
| Nom du payeur | `DIABATE Séka` |
| Qui paie ? | « Famille » |

3. Laisser l'imputation « Automatique ». Cliquer **« Vérifier et encaisser »**.
4. Dans « Confirmer l'encaissement », cliquer **deux fois rapidement** sur **« Confirmer l'encaissement »**.

✅ Écran « Paiement enregistré » : « Le paiement de 10 000 F CFA a été enregistré. », un reçu `REC-2026-nnnnnn` (**à noter**), « Imputé » 10 000, « Non imputé » 0, « Reste dû après paiement » **44 000 F CFA**. Un seul paiement existe (une clé d'idempotence évite le doublon) : vérifier dans « Encaissements ». Facture n°1 « Partiellement payée », tranche 1 reste 8 000.

⚠️ *Test d'erreur* : Montant `150,5` → « Le montant est un entier en francs : pas de virgule ni de point. » ; Montant `0` → « Montant invalide : chiffres uniquement, strictement positif. » ; virement sans « Référence » → `La référence du virement est requise.` (aucun paiement créé).

☐ OK ☐ KO

---

## Étape 83 — Encaisser en espèces (8 000 F CFA) sur la session de caisse
👤 **économe** · fenêtre **A** · 📂 `/v2/finance/payments/new`

1. Apprenant "DIABATE Nadia" ; Montant encaissé `8000` ; Mode de paiement « Espèces » ; Nom du payeur `DIABATE Séka` ; imputation « Automatique ».
2. **« Vérifier et encaisser »**, puis **« Confirmer l'encaissement »**.
3. Cliquer **« Fiche du paiement »**, puis **« Voir la session »**.

✅ « Reste dû après paiement » **36 000 F CFA**, tranche 1 « Payée ». La fiche affiche « Session de caisse » avec le lien « Voir la session » (fenêtre « Détail de la session »). Sur `/v2/finance/cash`, « Ma session » : « Encaissé » 8 000 F CFA, « Nombre d'encaissements » 1.

⚠️ *Test d'erreur* : sans session ouverte (cf. étape précédente) le bouton « Vérifier et encaisser » est désactivé.

☐ OK ☐ KO

---

## Étape 84 — Acompte par mobile money (6 000 F CFA), puis imputation du solde
👤 **économe** · fenêtre **A** · 📂 `/v2/finance/payments/new`, puis fiche du paiement

1. Apprenant "DIABATE Nadia" ; Montant encaissé `6000` ; Mode « Mobile money » ; Référence `MM-TG-001` ; Nom du payeur `DIABATE Séka` ; Imputation « Aucune (acompte) ». Confirmer.
2. Sur « Paiement enregistré » : « Imputé » 0, « Non imputé » 6 000 F CFA, « Reste dû après paiement » affiche « — ». Ouvrir **« Voir et imprimer le reçu »** : le reçu indique « Paiement non imputé ».
3. Ouvrir **« Fiche du paiement »**, cliquer **« Imputer le solde »**, laisser « Automatique », cliquer **« Imputer »**.
4. Rouvrir le reçu.

✅ Avant l'imputation, la facture n°1 reste à 36 000 F CFA. Après : « L'imputation a été enregistrée. » ; « Imputé » 6 000, « Non imputé » 0 ; facture n°1 reste dû **30 000 F CFA**, tranche 2 : payé 6 000, reste 12 000. Le reçu est **inchangé** (figé : toujours « Paiement non imputé »).

⚠️ *Test d'erreur* : dans « Imputer le solde », « Manuelle » sans montant → « Saisissez au moins un montant à imputer. »

☐ OK ☐ KO

---

## Étape 85 — Paiement en ligne simulé : réussite, attente, échec
👤 **économe** · fenêtre **A** · 📂 Barre **« Encaissements »** > **« Paiement en ligne »** (`/v2/finance/payments/online`, titre « Initier un paiement en ligne »)

1. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Apprenant | "DIABATE Nadia" |
| Montant | `5000` |
| Fournisseur | « Paiement simulé (démonstration) » |
| Facture visée | la facture n°1 (`FAC-2026-nnnnnn`) |
| Téléphone du payeur | `+225 07 10 20 30 40` |
| Nom du payeur | `DIABATE Séka` |
| Courriel du payeur | `parent@exemple.test` |
| Libellé | `Paiement en ligne test guide` |

2. Cliquer **« Lancer le paiement »** et observer « Suivi du paiement ».
3. Cliquer **« Nouveau paiement en ligne »**, même saisie avec Montant `5001` ; cliquer **« Vérifier maintenant »**.
4. **« Nouveau paiement en ligne »**, même saisie avec Montant `5013`.

✅ Selon les trois derniers chiffres :
- 5 000 : pastille « Confirmé » (« Paiement confirmé par le fournisseur. »), reçu émis ; facture n°1 reste dû **25 000 F CFA** (tranche 2 : reste 7 000).
- 5 001 : pastille « En attente » (« En attente de la confirmation du fournisseur. Cet écran vérifie régulièrement. »), aucun reçu, facture inchangée ; « Vérifier maintenant » ne change rien. **Ne pas ouvrir** le lien `sandbox.invalid`.
- 5 013 : pastille « Échoué » ("Paiement échoué : sandbox_declined", code technique brut), aucun reçu, facture inchangée.

Toujours : « Paiement simulé (environnement de test) : il ne peut pas être confirmé en production. »

⚠️ *Test d'erreur* : Fournisseur « Orange Money », montant 5000 → `Le fournisseur "orange_money" n'est pas configuré pour ce tenant.` (aucun paiement créé) ; Courriel du payeur `abc` → "Adresse électronique invalide."

⚠️ *Écart connu* : si « Paiement simulé (démonstration) » n'est pas proposé, le serveur web a été lancé sans `NEXT_PUBLIC_FINANCE_SANDBOX=1` : le redémarrer et consigner un écart Majeur.

☐ OK ☐ KO

---

## Étape 86 — Facture n°2 test guide : reprise de solde d'ouverture (25 000 F CFA)
👤 **économe** · fenêtre **A** · 📂 Barre **« Factures »** > **« Nouvelle facture »**, mode « Saisie libre » (`/v2/finance/invoices/new`)

1. Choisir le mode « Saisie libre ».
2. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Apprenant | "DIABATE Nadia" |
| Inscription | 6e A |
| Année scolaire | `2026-2027` |
| Catégorie (ligne) | « Autres » |
| Désignation (ligne) | `Reprise du solde d'ouverture test guide` |
| Quantité (ligne) | `1` |
| Prix unitaire (ligne) | `25000` |

3. Cliquer **« Enregistrer en brouillon »** : fiche « Facture (brouillon) », sans numéro.
4. Cliquer **« Émettre la facture »**.

✅ Message "La facture FAC-2026-nnnnnn a été émise." (**noter : facture n°2**) ; statut « Émise », total et reste dû 25 000 F CFA, une seule échéance.

⚠️ *Test d'erreur* : Prix unitaire vide → « Saisissez un montant. » ; Désignation vide → « Ce champ est obligatoire. »

☐ OK ☐ KO

---

## Étape 87 — Un virement imputé sur deux factures (20 000 F CFA)
👤 **économe** · fenêtre **A** · 📂 `/v2/finance/payments/new`

Attendu au départ : facture n°1 reste dû 25 000 (tranche 2 : 7 000 ; tranche 3 : 18 000) ; facture n°2 reste dû 25 000.

1. Apprenant "DIABATE Nadia" : « Factures ouvertes » liste les deux factures.
2. Saisir Montant encaissé `20000` ; Mode « Virement » ; Référence `VIR-TG-002` ; Nom du payeur `DIABATE Séka`.
3. Imputation « Manuelle » : déplier la facture n°1, saisir `7000` dans « Montant à imputer — Tranche 2 » ; déplier la facture n°2, saisir `13000` dans le champ de son unique échéance.
4. **« Vérifier et encaisser »**, puis **« Confirmer l'encaissement »**.

✅ « Imputé » 20 000 F CFA, « Non imputé » 0, "2 imputations enregistrée(s).", « Reste dû après paiement » **30 000 F CFA** (18 000 + 12 000). Facture n°1 reste dû **18 000** ; facture n°2 reste dû **12 000**, « Partiellement payée ».

⚠️ *Test d'erreur* : montant 20000 avec `20000` imputés sur « Montant à imputer — Tranche 3 » (reste 18 000) → "L'imputation dépasse le reste dû de l'échéance." (aucun paiement créé).

☐ OK ☐ KO

---

## Étape 88 — Paiement supérieur au solde (chèque 15 000 F CFA), puis imputation
👤 **économe** · fenêtre **A** · 📂 `/v2/finance/payments/new`, puis fiche du paiement

1. Apprenant "DIABATE Nadia" ; Montant encaissé `15000` ; Mode « Chèque » ; Référence `CHQ-TG-0001` ; Nom du payeur `DIABATE Séka`.
2. Imputation « Automatique » ; dans « Limiter à certaines factures », cocher uniquement la facture n°2 (reste dû 12 000). Confirmer (aucun avertissement de dépassement avant la confirmation : écart connu, voir le chapitre).
3. Sur la fiche du paiement, cliquer **« Imputer le solde »**, « Automatique », **« Imputer »**.

✅ Après l'étape 2 : « Imputé » 12 000, « Non imputé » **3 000 F CFA**, facture n°2 « Payée ». Après l'étape 3 : « L'imputation a été enregistrée. » ; les 3 000 F CFA vont sur la seule échéance ouverte (tranche 3 de la facture n°1) : facture n°1 reste dû **15 000 F CFA**, paiement entièrement imputé (le bouton « Imputer le solde » disparaît).

⚠️ *Test d'erreur* : chèque sans « Référence » → "Le numéro de chèque est requis."

☐ OK ☐ KO

---

## Étape 89 — Contrôler la liste des encaissements et les reçus
👤 **économe** · fenêtre **A** · 📂 Barre **« Encaissements »** (`/v2/finance/payments`), puis barre **« Reçus »** (`/v2/finance/receipts`)

1. Dans « Encaissements », filtrer « Apprenant » = "DIABATE Nadia" : **10 lignes** (2 de la graine : 25 000 et 200 000 ; puis cette phase : 10 000 `VIR-TG-001`, 8 000 espèces, 6 000 `MM-TG-001`, 5 000 / 5 001 / 5 013 « En ligne », 20 000 `VIR-TG-002`, 15 000 `CHQ-TG-0001`). « Statut » = « En attente » : une ligne (5 001) ; « Échoué » : 5 013 ; « Mode » = « Chèque » : 15 000.
2. Ouvrir la fiche du virement `VIR-TG-001` (clic sur sa date) : titre « Paiement de 10 000 F CFA », « Résumé » (« Confirmé », « Imputé » 10 000, « Non imputé » 0, « Référence » `VIR-TG-001`).
3. Ouvrir la barre « Reçus », filtrer « Apprenant » = "DIABATE Nadia", ouvrir le reçu du virement `VIR-TG-001`.
4. Cliquer **« Imprimer ou enregistrer en PDF »** (boîte d'impression du navigateur, la fermer). Ouvrir ensuite le reçu de `VIR-TG-002`.

✅ **8 reçus** (2 de la graine + 6 de cette phase : 10 000, 8 000, 6 000, 5 000, 20 000, 15 000) ; les paiements 5 001 (en attente) et 5 013 (échoué) n'ont pas de reçu. Reçu `VIR-TG-001` : « Reçu de paiement », imputation FAC-… · Tranche 1 · 10 000, « Reste dû après ce paiement » 44 000 F CFA, « Montant reçu » 10 000 F CFA, pied de page « Reçu émis automatiquement ; il ne peut pas être modifié. » ; reçu `VIR-TG-002` : deux lignes d'imputation et reste dû 30 000 F CFA. Aucun bouton « Modifier » ni « Supprimer » : une erreur se corrige par un avoir ou un remboursement, jamais en changeant le reçu.

⚠️ *Test d'erreur* : `/v2/finance/receipts/00000000-0000-4000-8000-000000000000` → "Reçu introuvable (00000000-0000-4000-8000-000000000000)."

🔒 *Test de droit* : en tant que parent (`parent@secondaire-test.test`), taper `/v2/finance/receipts` puis `/v2/finance/payments` → « Accès refusé » (le parent passe par `/v2/finance/me`). En tant que secrétariat, `/v2/finance/payments/new` et `/v2/finance/cash` → « Accès refusé ».

☐ OK ☐ KO

📚 *Pour aller plus loin* : chapitres 12a (scénarios 12.6, 12.8 à 12.9 : filtres de factures, refus API, brouillon) et 12b (scénario 12.15 : jeux invalides d'encaissement ; 12.20 : export CSV et fiches).

**Ce que la phase laisse dans l'application :**
- Frais `TG-DIVERS` "Frais divers test guide" (barème 60 000 F CFA, 2026-2027) et `TG-CANTINE` "Frais de cantine test guide" (sans barème).
- Plan `TG-3T` "Plan 3 tranches test guide" ; remises `TG-REM10` "Remise 10 % test guide" et `TG-REM5000` "Remise 5 000 F test guide" (non cumulables).
- Facture n°1 test guide (DIABATE Nadia, total 54 000, **reste dû 15 000 F CFA**, tranche 3 ouverte) ; facture n°2 test guide (reprise de solde, 25 000, « Payée »).
- Caisse `TG-CAISSE-1` "Caisse test guide" avec une **session ouverte** (fonds 10 000, 8 000 F CFA d'espèces encaissés : à clôturer dans une phase suivante).
- Paiements de Nadia : `VIR-TG-001` (10 000), espèces (8 000), `MM-TG-001` (6 000), en ligne 5 000 confirmé, 5 001 **en attente** (à rapprocher), 5 013 échoué, `VIR-TG-002` (20 000), `CHQ-TG-0001` (15 000) ; 6 reçus `REC-2026-nnnnnn` créés.
- Relevé à conserver : numéros des factures n°1 et n°2, numéro du reçu de `VIR-TG-001`, synthèse de départ (facturé, encaissé, restant dû).

---

[⬅ Sommaire](../GUIDE_TEST_UTILISATEUR_COMPLET.md) · [← Précédent](04-admissions.md) · [Suivant →](06-emploi-du-temps.md)
