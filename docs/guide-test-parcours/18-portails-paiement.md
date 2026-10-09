[⬅ Sommaire](../GUIDE_TEST_UTILISATEUR_COMPLET.md) · [← Précédent](17-tableaux-de-bord.md) · [Suivant →](19-securite-isolation.md)

# Phase 18 — Portails parent, élève, enseignant ; paiement et remboursement

Objectif : vérifier ce que voit chaque famille et chaque enseignant (le parent ne voit que ses enfants, l'élève que lui-même, l'enseignant que ses classes), payer en ligne en mode simulé, puis traiter côté gestion l'avoir, la résolution manuelle d'un paiement bloqué, le remboursement à quatre yeux, la clôture de caisse et les rapports.

Précondition : le serveur web a été démarré avec `NEXT_PUBLIC_FINANCE_SANDBOX=1` (valeur par défaut de `pnpm dev:v2`), sinon l'option « Paiement simulé (démonstration) » n'est pas proposée. Les phases Finance ont créé la **facture n°1 test guide** de DIABATE Nadia (reste dû R_F au moins 4 000 F CFA), le virement `VIR-TG-001` (10 000 F CFA), une session de caisse ouverte avec un encaissement en espèces de 8 000 F CFA, et le fournisseur simulé est proposé. Montants de repère (graine) : Nadia est soldée de sa scolarité (225 000 payés), Salimata a payé 125 000 et **reste 100 000 F CFA**.

---

## Étape 332 — Le parent voit ses deux enfants
👤 **parent** (DIABATE Séka, secondaire-test, `parent@secondaire-test.test`, sans MFA) · fenêtre **B** · 📂 `/v2/parent` (page « Mes enfants »)

1. Se connecter ; constater l'atterrissage sur `/v2/parent`, titre « Mes enfants ».
2. Lire les blocs : un par enfant (nom, classe, badge d'état, bouton **« Ouvrir »**) et les quatre cartes (« Dernière moyenne publiée », « Absences », « Scolarité restante », « Prochaines séances »).
3. Cliquer **« Mon compte »** : lire « Rôle actif » = "Parent". Fermer avec Échap. Lire le menu latéral.

✅ **Exactement deux blocs** : "DIABATE Nadia" et "DIABATE Salimata", classe "6e A", aucun autre nom. Repères graine : moyenne de Nadia 13,20, rang 2 sur 8 ; « Scolarité restante » de Salimata 100 000 F CFA. Le menu contient « Mes enfants », « Vie scolaire », « Messages », « Annonces », « Paramètres du compte » ; aucune entrée de finance, de structure ou d'administration.

☐ OK ☐ KO

---

## Étape 333 — Tableau de bord d'un enfant et sélecteur « Enfant »
👤 **parent** · fenêtre **B** · 📂 **« Mes enfants »** > **« Ouvrir »** (`/v2/parent/children/<id Nadia>`)

1. Cliquer **« Ouvrir »** sur le bloc de Nadia.
2. Lire la liste « Enfant » ("DIABATE Nadia — 6e A", "DIABATE Salimata — 6e A") et la rangée « Sections de l'enfant » : « Tableau de bord », « Résultats », « Bulletins », « Absences », « Emploi du temps », « Évaluations à venir », « Scolarité », « Documents », « Dossier et contacts ».
3. Cliquer l'onglet « Résultats », puis choisir "DIABATE Salimata — 6e A" dans « Enfant ».

✅ L'adresse devient `/v2/parent/children/<id Salimata>/results` (la **section est conservée**) et le titre "Résultats de DIABATE Salimata".

☐ OK ☐ KO

---

## Étape 334 — Résultats et bulletins de Nadia
👤 **parent** · fenêtre **B** · 📂 **« Résultats »** puis **« Bulletins »** de Nadia (`/v2/parent/children/<id Nadia>/results`)

1. Onglet « Résultats » : lire « Résultats officiels » (« Moyenne », « Rang » au format "2 sur 8", « Mention »), déplier « Détail par matière (n) », puis « Notes des évaluations » (notes publiées du type "16 / 20").
2. Onglet « Bulletins » : cliquer **« Télécharger le PDF »**, puis **« Vérifier l'authenticité »** : un QR code et un « Code de vérification » de 26 caractères s'affichent. Cliquer **« Ouvrir la page de vérification »**.
3. Ouvrir l'onglet de Salimata : le code de Nadia n'apparaît pas.

✅ Seules des évaluations **publiées** apparaissent (aucun brouillon) ; le rang est « N sur M » sans nom de camarade. Le PDF se télécharge ; la page publique annonce « Document authentique » et rappelle « Cette page n'affiche ni note, ni nom, ni matricule, ni date de naissance : elle confirme seulement l'existence et le statut du document. ».

⚠️ *Écart connu* : pas de bandeau « Règles de démonstration » côté famille ; un libellé de décision peut s'afficher en code brut.

☐ OK ☐ KO

---

## Étape 335 — Déposer un justificatif d'absence
👤 **parent** · fenêtre **B** · 📂 **« Absences »** de Nadia (`/v2/parent/children/<id Nadia>/attendance`)

1. Lire le « Récapitulatif » et la section « Justificatifs déposés ».
2. Cliquer **« Déposer un justificatif »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Premier jour d'absence | `07/10/2026` |
| Dernier jour d'absence | `07/10/2026` |
| Motif | « Maladie » |
| Commentaire | `Rendez-vous médical test guide` |
| Pièce jointe | (vide) |

3. Cliquer **« Déposer »**, puis sur la carte créée **« Retirer ce justificatif »**.

✅ « Justificatif déposé. » ; la carte porte le badge « En attente » et le commentaire ; au retrait « Justificatif retiré. » (la carte passe à « Retiré », à vérifier). Une absence réelle de Nadia, s'il en existe, porte « À justifier » et un bouton « Justifier ».

⚠️ *Test d'erreur* : dernier jour `05/10/2026` avec premier jour `07/10/2026` → "La fin de la fenêtre précède son début." ; dernier jour dans le futur → "Un justificatif ne peut pas couvrir des dates futures.".

⚠️ *Écart connu* : "Motif : ILLNESS" (code brut) et "Élève : …" avec un identifiant au lieu du nom.

☐ OK ☐ KO

---

## Étape 336 — Emploi du temps, évaluations à venir et documents
👤 **parent** · fenêtre **B** · 📂 **« Emploi du temps »**, **« Évaluations à venir »**, **« Documents »** de Nadia

1. « Emploi du temps » : lire "Emploi du temps de DIABATE Nadia", utiliser **« Semaine précédente »**, **« Aujourd'hui »**, **« Semaine suivante »**, puis **« Vue jour »**.
2. « Évaluations à venir » : lire le titre et la note.
3. « Documents » : repérer les sections « Bulletins » (« Télécharger ») et « Reçus de paiement » (« PDF »), et chercher un bouton de dépôt.

✅ Une séance de 08:00 à 10:00 du lundi au jeudi (Français, Mathématiques, Anglais, Histoire-Géographie) jusqu'à J+14 ; au-delà « Aucune séance cette semaine. ». « Aucune évaluation planifiée. » tant qu'aucun examen n'est planifié. **Aucun** bouton de dépôt dans « Documents » (lecture seule).

☐ OK ☐ KO

---

## Étape 337 — Contact d'urgence : ajout par le secrétariat, correction par le parent
👤 **secrétariat**, **parent**, puis **secrétariat** · fenêtres **A** et **B** · 📂 `/v2/students` > fiche de DIABATE Nadia > onglet « Urgences » ; parent : « Dossier et contacts » (`/v2/parent/children/<id Nadia>/emergency`)

1. Parent : ouvrir « Dossier et contacts » : « Responsables » (DIABATE Séka, badge « Contact principal »), « Aucun contact d'urgence. » ; aucun bouton d'ajout.
2. Secrétariat : fiche de Nadia, onglet « Urgences », **« Ajouter un contact »** :

| Champ | Valeur |
| :--- | :--- |
| Nom du contact | `KONÉ Ibrahim test guide` |
| Lien avec l'élève | `Oncle` |
| Téléphone | `+225 07 08 09 10 11` |
| Priorité | `0` |

   Valider : « Le contact a été ajouté. ».
3. Parent : recharger, cliquer **« Modifier »** sur le contact, mettre « Téléphone » = `+225 05 11 22 33 44`, « Adresse e-mail » = `ibrahim.kone@exemple.test`, **« Enregistrer »**.
4. Secrétariat : recharger l'onglet « Urgences », puis cliquer **« Retirer »** pour nettoyer.

✅ « Contact mis à jour. » ; le secrétariat voit le nouveau numéro ; le parent ne peut ni ajouter, ni retirer, ni changer le lien. Retrait : « Le contact a été retiré. ».

⚠️ *Test d'erreur* : téléphone `12` → "Téléphone trop court." ; e-mail `ibrahim.kone` → "Adresse e-mail invalide.".

☐ OK ☐ KO

---

## Étape 338 — Lire la scolarité de Nadia (soldée) et de Salimata (reste dû)
👤 **parent** · fenêtre **B** · 📂 **« Scolarité »** de chaque enfant (`/v2/parent/children/<id>/finance`), ou `/v2/finance/me`

1. Nadia : lire « Situation » (« Facturé », « Avoirs », « Payé », « Reste à payer »), « Prochaines échéances », « Factures », « Paiements », « Reçus ».
2. Salimata (liste « Enfant ») : mêmes sections. Cliquer une facture pour déplier son échéancier.

✅ Nadia : **facture n°1 test guide** de la phase Finance visible (échéance "Tranche 3"), « Reste à payer » = R_F (15 000 F CFA en référence), le brouillon de la phase Finance **absent**, ses paiements dont 5 001 « En attente » et 5 013 « Échoué » si l'économe les a créés. Salimata : Payé 125 000 F CFA, Reste à payer 100 000 F CFA, une échéance à payer et le bouton **« Payer en ligne »**. Montants écrits "100 000 F CFA". Le reçu de Salimata n'apparaît jamais chez Nadia.

☐ OK ☐ KO

---

## Étape 339 — Payer en ligne en mode simulé (5 000, 5 001, 5 013)
👤 **parent** · fenêtre **B** · 📂 **« Scolarité »** de Salimata > **« Payer en ligne »**

⚠️ Les paiements créés ne se suppriment pas depuis l'interface.

1. Cliquer **« Payer en ligne »** (fenêtre « Payer en ligne »). Saisir pour le **premier paiement (réussite)** :

| Champ | Valeur |
| :--- | :--- |
| Facture à payer | la facture de scolarité ("… — reste 100 000 F CFA") |
| Montant (F CFA) | `5000` |
| Moyen de paiement | « Paiement simulé (démonstration) » |
| Numéro de téléphone du payeur | `+225 05 00 00 00 20` |

2. Cliquer **« Payer »**, observer « Suivi du paiement », puis **« Fermer »**. Recharger : relire « Situation », « Paiements », « Reçus ».
3. **Deuxième paiement (attente)** : même saisie avec `5001`. Cliquer **« Vérifier maintenant »**, attendre une dizaine de secondes.
4. **Troisième paiement (échec)** : recharger, refaire avec `5013`, **« Fermer »**.

✅ `5000` : badge « Confirmé », « Paiement confirmé. Votre reçu est disponible ci-dessous. » ; Payé 130 000 F CFA, Reste à payer 95 000 F CFA ; un nouveau reçu (**noter son numéro REC-…**). `5001` : « En attente » et « En attente de confirmation par l'opérateur. Cette page se met à jour toute seule. », qui **reste** après « Vérifier maintenant » (pas de bouton « Fermer » : recharger pour quitter). `5013` : badge « Échoué » et "Le paiement a échoué :" suivi d'un motif. Les paiements en attente ou échoués ne modifient pas le reste à payer. L'onglet de Nadia n'est pas modifié.

⚠️ *Test d'erreur* : montant vide → « Saisissez un montant. » ; `12,5` → « Le montant est un entier en francs : pas de virgule ni de point. » ; `500000` → "Le montant dépasse le reste dû de la facture.".

⚠️ *Écart connu* : l'aide du moyen de paiement rappelle les règles : montant en 001 en attente, montant en 013 refusé. Un autre moyen comme « Orange Money » est refusé avec un code brut (fournisseur non configuré).

☐ OK ☐ KO

---

## Étape 340 — Reçu : détail, PDF et vérification publique
👤 **parent**, puis **visiteur sans compte** · fenêtre **B** · 📂 reçu du paiement de 5 000 (`/v2/parent/children/<id Salimata>/finance/receipts/<id reçu>`), puis `/v2/verify`

1. Cliquer sur le numéro du reçu : lire « Retour à la scolarité », **« Télécharger le PDF »**, **« Imprimer »** et le document « Reçu de paiement » (« Date », « Mode de paiement » = "En ligne", « Montant reçu », « Reste à payer après ce paiement », « Imputation du paiement »).
2. Télécharger le PDF (`recu-REC-…pdf`) ; si « Le document est en cours de préparation. Réessayez dans quelques instants. » s'affiche, patienter. Lire dans le PDF le **code de vérification** (26 caractères) sous le QR.
3. Dans une fenêtre privée sans session, ouvrir `/v2/verify` (page « Vérification d'un document »), saisir le code, **« Vérifier »** ; refaire avec `AAAAAAAAAAAAAAAAAAAAAAAAAA`.

✅ Montant reçu 5 000 F CFA. Page publique : « Authentique », « Nature du document » = « Reçu de paiement », aucune donnée personnelle. Code inventé : « Inconnu » et « Aucun document ne correspond à ce code. Vérifiez la saisie ; si le code est correct, le document n'est pas authentique. ».

⚠️ *Écart connu* : le QR imprimé encode une adresse sans écran en local : saisir le code à la main sur `/v2/verify`.

☐ OK ☐ KO

---

## Étape 341 — Isolation de la famille
👤 **parent** · fenêtre **B** · 📂 adresses tapées à la main

Précondition : relever l'identifiant d'un élève d'une autre famille (en secrétariat : `/v2/students`, ligne de BAMBA Aya, code après `/v2/students/`) et d'un reçu de Salimata.

1. Taper `/v2/parent/children/<id Aya BAMBA>` puis ses sous-pages `/results`, `/finance`, `/documents`.
2. Taper `/v2/parent/children/<id Nadia>/finance/receipts/<id reçu de Salimata>`.
3. Taper `/v2/teacher`, `/v2/student`, `/v2/students`, `/v2/finance`, `/v2/attendance`, `/v2/direction`.

✅ Étape 1 : avertissement « Cet enfant n'est pas rattaché à votre compte (ou le lien a pris fin). Aucune information ne peut être affichée. » et bouton « Retour à mes enfants » ; ni nom, ni note, ni facture. Étape 2 : « Ressource introuvable. » sans contenu du reçu. Étape 3 : « Accès refusé » pour chaque adresse.

☐ OK ☐ KO

---

## Étape 342 — L'élève voit uniquement son dossier
👤 **élève** (DIABATE Nadia, `eleve@secondaire-test.test`, sans MFA) · fenêtre **B** · 📂 `/v2/student` (menu « Mon dossier »)

1. Se connecter : lire le titre (nom de l'élève), les cartes, la liste « Mes inscriptions » et le menu (« Mon dossier », « Mes résultats », « Mes bulletins », « Mon emploi du temps », « Mes absences », « Ma scolarité », « Mes documents »…).
2. Ouvrir « Mes résultats » et comparer moyenne, rang et notes avec ce que le parent voit pour Nadia.
3. Ouvrir « Mes documents » et chercher un bouton de dépôt.

✅ La fiche est celle de **DIABATE Nadia** (6e A) ; mêmes valeurs que dans le portail parent ; aucune liste « Enfant », aucun nom ni note de camarade ; rang de la forme "N sur M". Aucun dépôt dans « Mes documents ». Taper `/v2/parent` ou `/v2/teacher` → « Accès refusé ».

☐ OK ☐ KO

---

## Étape 343 — L'élève règle sa scolarité et ne voit pas sa sœur
👤 **élève** · fenêtre **B** · 📂 **« Ma scolarité »** (`/v2/student/finance`)

1. Lire « Situation » ; cliquer **« Payer en ligne »**, facture n°1 test guide, « Montant (F CFA) » `3013`, moyen simulé, **« Payer »**.
2. Parent : rouvrir « Scolarité » de Nadia et copier l'adresse de l'onglet de Salimata (`/v2/finance/me/<id Salimata>`).
3. Élève : coller `/v2/finance/me/<id Salimata>`, puis `/v2/students/<id Salimata>`, `/v2/finance/invoices`.

✅ `3013` : badge « Échoué », "Le paiement a échoué : sandbox_declined" ; aucun reçu ni changement de solde ; le parent voit aussi ce paiement « Échoué ». Adresse de Salimata : « Accès refusé » avec « Cet apprenant n'est pas rattaché à votre compte : ses informations financières ne peuvent pas être affichées. ». `/v2/students/<id Salimata>` et `/v2/finance/invoices` : « Accès refusé ».

☐ OK ☐ KO

---

## Étape 344 — L'enseignant voit ses séances et ses classes seulement
👤 **enseignant** (TRAORE Kouadio, `enseignant@secondaire-test.test`, sans MFA) · fenêtre **B** · 📂 `/v2/teacher` (menu « Aujourd'hui »), puis **« Mes classes »** (`/v2/teacher/classes`)

1. Se connecter : lire « Aujourd'hui » (compteurs « Séances » et « Appels à faire »), les boutons « Faire l'appel » / « Voir l'appel » et « Saisir les notes ». Un jeudi (J), les séances de la 6e A sont affichées ; un jour sans séance « Aucune séance aujourd'hui. ».
2. Ouvrir **« Mes classes »** : une seule carte, la 6e A (`6E-A`), badge « Responsable ». Cliquer **« Élèves »** : tableau « Élèves de 6e A ».
3. Taper `/v2/parent`, `/v2/student`, `/v2/finance`, `/v2/direction`, `/v2/payroll`.

✅ **Une seule classe** (6e A) avec au moins DIABATE Nadia, DIABATE Salimata, BAMBA Aya… ; le menu ne comporte aucune entrée de finance, de structure ou de paramètres. Les cinq adresses de l'étape 3 donnent « Accès refusé ». Chaque élève liste son statut (« Actif »).

⚠️ *Écart connu* : le bouton « Faire l'appel » est absent au collège (appel par séance).

☐ OK ☐ KO

---

## Étape 345 — Émettre un avoir ; refus d'annuler une facture encaissée
👤 **économe** (secondaire-test, `econome@secondaire-test.test`, MFA) · fenêtre **A** · 📂 Menu **« Finance »** > **« Factures »** > fiche de la facture n°1 test guide (`/v2/finance/invoices/<id>`), section « Correction de la facture »

**Noter** le « Reste dû » avant (R_F) et le montant « Avoirs » (A_F).

1. Cliquer **« Émettre un avoir »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Montant de l'avoir | `3000` |
| Motif | `Geste commercial test guide` |

2. Cliquer **« Émettre l'avoir »** et **noter le numéro d'avoir**.
3. Cliquer **« Annuler la facture »**, saisir le motif `Tentative de test guide` et valider.

✅ "L'avoir AV-2026-nnnnnn a été émis." ; « Avoirs » +3 000 F CFA, « Reste dû » = R_F − 3 000, statut « Partiellement payée ». Refus : "Une facture encaissée ne s'annule pas : remboursez puis émettez un avoir." (facture inchangée).

⚠️ *Test d'erreur* : avoir de montant supérieur au reste dû → "L'avoir dépasse le reste dû de la facture." ; motif `abc` → « Au moins 5 caractères. ».

☐ OK ☐ KO

---

## Étape 346 — Lire les paiements à rapprocher (économe)
👤 **économe** · fenêtre **A** · 📂 Menu **« Finance »** > **« À rapprocher »** (`/v2/finance/payments/pending`)

1. Lire l'encadré « Une seule personne habilitée tranche. Chaque résolution exige une vérification MFA récente, un motif et une preuve ; elle s'applique aussitôt et est journalisée (état avant et après, auteur, motif). » et le tableau (« Reçu le », « Fournisseur », « Montant », « Rapprochement », « Prochaine vérification »).
2. Repérer la ligne 5 001 de Salimata (fournisseur `sandbox`, créée à l'étape *Payer en ligne en mode simulé*), état « Pas encore contrôlé ». Cliquer **« Vérifier maintenant »** sur cette ligne.
3. Constater l'absence de bouton « Résoudre à la main ».

✅ Message `Le fournisseur répond toujours "en attente".` (le fournisseur simulé ne règle jamais seul) ; l'économe n'a **pas** « Résoudre à la main ». Si d'autres paiements 5 001 de la phase Finance sont aussi listés, distinguer par l'heure « Reçu le ».

☐ OK ☐ KO

---

## Étape 347 — Résoudre à la main un paiement bloqué (directeur)
👤 **directeur** (MFA) · fenêtre **A** · 📂 **« Finance »** > **« À rapprocher »** (`/v2/finance/payments/pending`)

1. Sur la ligne 5 001 de Salimata, cliquer **« Résoudre à la main »** (fenêtre « Résoudre un paiement à la main »). Saisir :

| Champ | Valeur |
| :--- | :--- |
| Ce qui s'est réellement passé | « L'argent est arrivé : confirmer le paiement (reçu et imputation) » |
| Motif | `Paiement vérifié sur le relevé de test guide` |
| Preuve | `RELEVE-TG-001` |

2. Cliquer **« Résoudre le paiement »** ; si « Confirmez votre identité » s'ouvre, saisir le code du moment puis **« Confirmer et continuer »**.
3. Ouvrir « Encaissements » (`/v2/finance/payments`) et la scolarité de Salimata.

✅ « La résolution est enregistrée et appliquée. » ; la ligne quitte la liste ; le paiement de 5 001 est « Confirmé » avec un reçu, imputé à la facture de Salimata : Payé 135 001 F CFA, Reste à payer 89 999 F CFA (soit 95 000 − 5 001). La résolution est inscrite au journal d'audit.

⚠️ *Test d'erreur* : motif `court` → « Le motif doit faire au moins 10 caractères. » ; preuve `ab` → « Saisissez la preuve (3 caractères au moins). » ; code `000000` → « Code invalide. Vérifiez l'heure de votre téléphone, puis attendez le prochain code. » (rien n'est modifié).

☐ OK ☐ KO

---

## Étape 348 — Remboursement à quatre yeux
👤 **économe** (demande), **directeur** (approbation) · fenêtres **A** (économe) et **A** après reconnexion · 📂 fiche du paiement `VIR-TG-001` (`/v2/finance/payments`) puis **« Remboursements »** (`/v2/finance/refunds`)

1. Économe : ouvrir la fiche du virement `VIR-TG-001` (10 000 F CFA), cliquer **« Demander un remboursement »** :

| Champ | Valeur |
| :--- | :--- |
| Montant à rembourser | `3000` |
| Motif | `Erreur de saisie lors du test guide` |

   Cliquer **« Envoyer la demande »**.
2. Économe : **« Remboursements »**, ligne 3 000 « Demandé », cliquer **« Approuver »** puis **« Approuver »** dans la fenêtre.
3. Directeur : **« Remboursements »**, même ligne, **« Approuver »** (case « Exécuter immédiatement » cochée), **« Approuver »**.
4. Économe : demande de `2000` sur `VIR-TG-001`, motif `Demande de test guide à refuser`. Directeur : **« Refuser »**, « Motif du refus » `Refus de test guide`, **« Refuser »**.

✅ « La demande de remboursement a été enregistrée ; une autre personne doit l'approuver. » ; statut « Demandé ». Étape 2 : refus "Le demandeur ne peut pas approuver son propre remboursement." et la ligne reste « Demandé ». Étape 3 : « Le remboursement est approuvé et exécuté. », statut « Exécuté » ; fiche du virement : « Remboursé » 3 000 F CFA, « Net » 7 000 ; la facture n°1 test guide revient à un reste dû de R_F − 3 000 + 3 000 = R_F (avoir et remboursement se compensent sur le reste dû). Étape 4 : « Le remboursement est refusé. », statut « Refusé » (définitif).

⚠️ *Test d'erreur* : demande de `11000` sur le virement de 10 000 → "Le remboursement dépasse le montant remboursable." ; paiement échoué ou en attente → pas de bouton « Demander un remboursement ».

☐ OK ☐ KO

---

## Étape 349 — Rapports financiers
👤 **économe** · fenêtre **A** · 📂 Menu **« Finance »** > **« Rapports »** (`/v2/finance/reports`)

1. Lire « Rapports financiers » et les filtres « Année scolaire », « Situation au », « Groupe (classe) ».
2. Relire la « Synthèse » et parcourir « Créances par classe » (la 6e A y figure), « Créances par apprenant » (case « Apprenants avec un restant dû seulement ») et « Balance âgée ».
3. Cliquer un **« Exporter en CSV »**.
4. Pour « Évolution » : « Du » postérieur à « Au ».

✅ Les montants recoupent les factures et paiements ; le CSV se télécharge. Erreur : « La date de début doit précéder la date de fin. » ; période sans encaissement : « Aucun encaissement sur la période ». En secrétariat ou parent, `/v2/finance/reports` donne « Accès refusé ».

☐ OK ☐ KO

---

## Étape 350 — Les tableaux de bord suivent la finance
👤 **propriétaire** · fenêtre **A** · 📂 **« Pilotage »** > **« Scolarité »** (`/v2/owner/scolarite`)

Précondition : une à deux minutes après les étapes de paiement et de remboursement (le rafraîchissement est fait par le worker). Reprendre les relevés E1, A1 et R1 de la phase *Tableaux de bord et alertes*.

1. Recharger « Scolarité » et relire « Encaissé », « Avoirs », « Restant dû ».
2. Recharger `/v2/direction` et relire « Données au … ».

✅ Par rapport aux relevés (si aucune autre opération financière n'a eu lieu entre-temps) : « Encaissé » = E1 + 5 000 + 5 001 − 3 000 ; « Avoirs » = A1 + 3 000 ; « Restant dû » = R1 − 10 001. La date « Données au » avance. Au-delà de deux minutes sans changement : noter l'écart (worker arrêté). *(Chiffres à vérifier en test.)*

⚠️ *Écart connu* : un paiement en ligne `5013` ou `3013` (refusé) ne change aucun chiffre.

☐ OK ☐ KO

---

## Étape 351 — ⚠️ Clôturer la session de caisse
👤 **économe** · fenêtre **A** · 📂 Menu **« Finance »** > **« Caisse »** (`/v2/finance/cash`)

⚠️ Irréversible : la clôture est définitive.

Précondition : la session de caisse de la phase Finance est ouverte (fonds de caisse 10 000 F CFA, un encaissement en espèces de 8 000 F CFA).

1. Dans « Ma session » : « Encaissé » 8 000 F CFA, « Nombre d'encaissements » 1. Cliquer **« Clôturer la session »** (fenêtre « Clôturer la session » : « Saisissez le montant réellement compté. La clôture est définitive. »).
2. Saisir « Montant compté en caisse » = `18000` (fonds compris), « Observation » vide, **« Clôturer »**.
3. Ouvrir **« Détails »** dans « Historique des sessions ».
4. Ouvrir une nouvelle session (**« Ouvrir une session »**, fonds `5000`), puis **« Clôturer la session »** avec « Montant compté en caisse » `4000` sans observation ; puis avec l'observation `Écart de test guide : 1 000 F manquants`.

✅ « La session est clôturée. » ; « Montant attendu » 18 000, « Montant compté » 18 000 F CFA, « Aucun écart : la caisse est juste. ». Session « Clôturée » dans « Historique des sessions ». Nouvelle session : sans observation, refus "Écart de caisse de -1000 XOF : une justification est obligatoire." ; avec observation : « Écart : il manque 1 000 F CFA en caisse. ». Les écarts apparaissent ensuite dans « Écarts de caisse » de `/v2/owner/tresorerie`.

⚠️ *Test d'erreur* : montant compté `-1` → « Le montant ne peut pas être négatif. » ; vide → « Saisissez un montant. ».

📚 *Pour aller plus loin* : chapitre 21, scénarios 21.9 à 21.14, 21.19 à 21.22 ; chapitre 12c, scénarios 12.22 à 12.24, 12.26 à 12.29, 12.33 à 12.35 et 12.38 (droits par adresse).

**Ce que la phase laisse dans l'application :** paiements en ligne simulés de DIABATE Salimata : 5 000 F CFA (confirmé, avec reçu), 5 001 F CFA (confirmé après résolution `RELEVE-TG-001`), 5 013 F CFA (échoué) — reste dû de Salimata : 89 999 F CFA ; paiement échoué de 3 013 F CFA de l'élève Nadia ; avoir de 3 000 F CFA sur la facture n°1 test guide ; remboursements de 3 000 F CFA (exécuté) et 2 000 F CFA (refusé) sur `VIR-TG-001` ; deux sessions de caisse clôturées (dont une avec écart justifié de 1 000 F CFA) ; justificatif d'absence retiré ; contact d'urgence `KONÉ Ibrahim test guide` retiré.

---

[⬅ Sommaire](../GUIDE_TEST_UTILISATEUR_COMPLET.md) · [← Précédent](17-tableaux-de-bord.md) · [Suivant →](19-securite-isolation.md)
