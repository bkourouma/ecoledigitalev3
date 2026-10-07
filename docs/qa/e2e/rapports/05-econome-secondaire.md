# Rapport de session 05 : Économe / Collège Le Baobab (secondaire-test)
- Compte : econome@secondaire-test.test, « Rôle actif : Économe »
- Établissement : Collège Le Baobab (démonstration), pack secondaire
- Date : 2026-10-07, vers 11:32 UTC, durée ≈ 1 h
- Navigateur : Chrome (Claude in Chrome), fenêtre étroite 894×487 px, serveur de développement

Rappel : règles de démonstration ; aucun document officiel calculé par un jeu de démonstration n'a été affiché.
Réserve de méthode : les frais SCOL-6E-QA, son barème de 150 000 XOF, le plan ECH-3X-QA et la remise FRATRIE-QA existaient déjà ; le testeur a créé des variantes « (test QA 05) » sans rien supprimer.

## Parcours exécutés
| Parcours | Résultat | Constats | Remarque |
|---|---|---|---|
| P1 Vue d'ensemble, frais, barèmes | ⚠️ | C-05-08, C-05-09 | Frais, barème, plan et remise créés ; doublon de code refusé (409) ; montant négatif refusé ; vue d'ensemble cohérente |
| P2 Facture, aperçu, émission | ⚠️ | C-05-04, C-05-07 | FAC-2026-000025 (150 000) et 000026 (135 000 avec remise 10 %) ; échéances = total ; bandeau « facture liée » faux (C-05-05) |
| P3 Encaissements | ⚠️ | C-05-01, C-05-07, C-05-15 | Virement partiel, mobile money, espèces OK ; espèces sans caisse bloquées ; montants négatif et nul refusés ; un seul POST au double-clic ; paiement supérieur au solde ACCEPTÉ |
| P4 Paiement en ligne sandbox | ⚠️ | C-05-02, C-05-10, C-05-11, C-05-12 | Trois issues conformes aux montants ; sandbox joignable seulement via « Autre fournisseur » + code libre |
| P5 Remboursement | ❌ non testé | — | Demande bloquée par le contrôle d'autorisation de la session ; page Remboursements sans bouton d'approbation (conforme) |
| P6 Financement, bourses, rapports, retards | ⚠️ | C-05-03, C-05-04 | Inscription 0014 « Active » dès le règlement ; rapports exacts |
| P7 Paie : préparation | ⚠️ | C-05-09, C-05-13, C-05-14 | Aucun bouton arrêter/annuler ; réglages refusés ; tarif horaire sans heure validée = aucun bulletin |
| P8 Comptes fournisseurs | ✅ | C-05-16 | Compte actif lisible ; `/v2/finance/providers` refusé |
| P9 Affectés de l'État | ⚠️ | C-05-06, C-05-07 | Créance 120 000 réduite à 60 000 puis soldée ; compteurs de rapprochement faux |
| P10 Frais d'inscription (reprise) | non testé | — | Dépend des sessions 06 et 11 ; vérifié sur ASSI Brice |
| P11 Verser le bulletin (reprise) | non testé | — | Aucun bulletin « arrêté » |

## Vérifications chiffrées (calcul à la main) : toutes exactes
Vue d'ensemble : 24 factures 2 150 000 facturé, 575 000 encaissé, 1 575 000 restant (26,74 %) ; après actions (26 factures) 2 435 000 / 885 000 / 1 550 000 (36,34 %), non imputé 65 000. FAC-25 : 3 × 50 000 ; FAC-26 : 150 000 − 10 % = 135 000 = 3 × 45 000, soldée par 50 000 + 30 000 + 20 000 + 35 000. KOUASSI : 350 000 versés = 285 000 imputés + 65 000 non imputés. Créance État 120 000 → 60 000 → 0. Bourse 50 % : 75 000 + 75 000. Bulletin de paie YAO Fatou : 120 000 + 5 000 − 2 000 = 123 000. Comptes fournisseurs : sandbox encaissé 100 000, en attente 20 001, échoués 2.

## Constats
### C-05-01 : Un paiement supérieur au solde est accepté — Majeur
`/v2/finance/payments/new`, FAC-2026-000025 (solde 150 000), virement de 200 000 : enregistré, 150 000 imputés, 50 000 « non imputés », reçu REC-2026-000013, sans avertissement ; la boîte de confirmation n'affiche ni payeur ni solde. POST /finance/payments → 201. Attendu (selon la session) : refus, ou acompte explicite annoncé avant confirmation.

### C-05-02 : Fournisseurs en ligne proposés mais non configurés ; sandbox introuvable — Majeur
`/v2/finance/payments/online` : « orange_money » par défaut → « Le fournisseur "orange_money" n'est pas configuré pour ce tenant. » (code brut), 409. La liste ne propose pas sandbox ; seul « Autre fournisseur » + code libre `sandbox` passe (201). Attendu : liste limitée aux fournisseurs configurés, message lisible.

### C-05-03 : Paiement d'un financeur : « Référence du financeur » inutilisable sans UUID — Majeur
« Qui paie ? = Financeur » : 400 « Un paiement de financeur indique la prise en charge concernée (payerRef). » ; le champ attend un identifiant interne, visible seulement dans le bandeau de la facture du financeur. Attendu : liste des prises en charge de l'élève.

### C-05-04 : Deux notions de « financement » non synchronisées — Majeur (règle métier à préciser)
Inscription 0014 passée « Bourse » : l'écran de financement indique « Privé (famille) » et « Aucune bourse », l'aperçu de facture 0 F de bourse ; la prise en charge n'existe qu'après « Nouvelle bourse » (50 % → 75 000 + 75 000). Libellés « Boursier » / « Bourse » incohérents.

### C-05-05 : Bandeau « une facture liée existe pour la part du financeur » affiché à tort — Majeur
FAC-2026-000025 et 000022 (sans financeur) affichent le bandeau alors qu'aucune facture liée n'existe (une seule facture de type Financeur : FAC-2026-000024).

### C-05-06 : Rapprochement des affectations : compteurs à 0 alors qu'un dossier est en « Écart » — Majeur
`/v2/stateassign/reconciliation` : « Jamais rapproché 0 / Conforme 0 / Écart 0 » alors que le tableau liste AFF-DEMO-0001 en « Écart » (écart famille 25 000), avant et après le versement de l'État. À contrôler : l'écart famille reste inchangé après le versement.

### C-05-07 : Identifiants à la place des noms (renvoi C-02-05) — Mineur
`/v2/finance/payments/new?learnerId=…` (champ Apprenant et boîte de confirmation), `/v2/finance/payments/{id}`, bandeau de la facture du financeur. Le reçu imprimable affiche les noms.

### C-05-08 : Fil d'Ariane « Détail » sur des pages de liste ou de création — Mineur
`/fees/schedules`, `/fees/plans`, `/fees/discounts`, `/invoices/new`, `/imports/new`, `/payroll/payslips/{id}`, `/payroll/periods/{id}` ; le maillon « Finance » mène à `/v2/finance/invoices`, pas à la vue d'ensemble.

### C-05-09 : Codes techniques bruts affichés (renvoi C-02-03) — Mineur
« sandbox_declined », CALCULATED/ADJUSTED, PENDING → ACTIVE, PRIVATE → SCHOLARSHIP, CLASS, bloc « famille / Famille » en double, « Droits manquants : student.create / guardian.manage / staff.create », « Niveau (clé) », « Filière (clé) ».

### C-05-10 : Actions sans retour visible — Mineur
« Vérifier maintenant » (POST …/verify → 200) : aucun message, statut inchangé ; « Générer un échéancier » : aucun effet ni message alors que l'échéancier existe déjà.

### C-05-11 : Mention « simulé » absente des listes ; pas de liste des paiements en ligne — Mineur
Colonne Mode « En ligne » sans « simulé » dans `/v2/finance/payments` et `/payments/pending` ; le menu « Paiements en ligne » ouvre le formulaire d'initiation, pas une liste.

### C-05-12 : Lien « Ouvrir la page de paiement » vers `https://sandbox.invalid/pay/…` — Suggestion
Non ouvert ; aucun appel sortant constaté. Attendu : page locale de simulation.

### C-05-13 : Message dupliqué et accord à corriger — Mineur
« Aucune heure validée sur la période. » deux fois par enseignant ; « 2 imputations enregistrée(s) ».

### C-05-14 : Tarif horaire sans heures validées : aucun bulletin possible — Mineur (donnée de démonstration)
TRAORE Kouadio (horaire 3 000 XOF) écarté ; bulletin obtenu avec une configuration au salaire pour YAO Fatou (120 000). La liste « Enseignant » propose aussi PRESIDENT Conseil et SECRETAIRE Conseil.

### C-05-15 : Libellés qui contredisent le droit réel du rôle — Suggestion
`/v2/finance` (« Remboursements : Approuver ou exécuter… »), `/v2/finance/webhooks` (« Rejouez-les… »), `/v2/finance/cash` (« Un gestionnaire doit d'abord créer une caisse » alors que « Nouvelle caisse » est offert à l'économe).

### C-05-16 : Pages d'accès refusé : ancienne mise en page et appels 403 répétés (renvoi C-03-09) — Mineur
6 adresses refusées (`/finance/providers`, `/payroll/configuration/settings`, `/students/new`, `/enrollments/new`, `/assessments`, `/examinations`) ; l'ancienne mise en page émet des GET en boucle vers `/api/v1/notifications-inbox/unread-count`, `/notifications-inbox?limit=20` et `/admin/access/me/menus`, tous en 403.

### C-05-17 : Performances et bruit en développement — Suggestion
`/v2/finance/invoices` : un GET /people/students/{id} par ligne (14 appels pour 25 lignes) ; 3 297 messages de journal de console en une session (traces « X-Tenant Debug »), aucune erreur.

### C-05-18 : Même référence de virement acceptée deux fois — Suggestion
VIR-TEST-QA-001 utilisée par deux paiements distincts sans alerte de doublon.

### C-05-19 : Menu plus large que prévu ; focus non restitué — Suggestion
Menu avec Académique, Personnes, Affectés de l'État, Notifications, Établissement ; le dialogue piège le focus et se ferme avec Échap mais le focus ne revient pas au bouton d'origine ; l'en-tête tronque le nom en fenêtre étroite.

Renvois : C-03-06 (message « échéanciers non inclus » au premier chargement de `/v2/finance/fees/plans`), C-02-05, C-03-09.

## Isolation entre établissements
Aucune donnée d'un autre établissement observée. Identifiants relevés (à tester depuis primaire-test ou superieur-test) :
- Établissement 01a110ee-38e8-70f1-a9cc-ee13ec053aee ; tenant 01a110ee-38d6-7449-a580-3ea406680dde
- Factures : FAC-25 = 01a1162b-0bd4-747f-b2f1-8bf64a20d59d ; FAC-26 = 01a1162f-7e03-76fe-bda4-1c205d1a8df3 ; FAC-22 = 01a110ee-e4df-76b1-a167-2f3a43b0f688 ; FAC-24 = 01a110ef-6e4e-73c2-be72-bc57c19c5bad
- Paiements : 200 000 = 01a1162d-73eb-74ae-a766-d9dce9fad409 ; 50 000 = 01a11631-69ac-727d-b7d2-4095b79dd412 ; en ligne 50 000 = 01a11637-8c78-706a-946a-b765f8b5c2cb ; en attente = 01a11638-21c7-705d-a3d8-192497e19ac0 ; échoué = 01a11638-6c9e-7542-83b1-c85683ebe109
- Reçu REC-13 = 01a1162d-7524-7367-bc7f-63f2bdc4021d ; élèves KOUASSI = 01a111a2-7263-72b4-ac85-3e2178fe0df0, ASSI = 01a110ee-e3f5-7233-8a65-5ea3736f9b7e ; inscription 0014 = 01a110ee-e49b-7469-9e08-4ceb818a9b7a ; période de paie = 01a11644-4688-771d-8a23-a9430258ea2c ; bulletin YAO = 01a11646-202f-767f-be71-d15a7ca9e5c1

## Heures pour le journal d'audit (UTC)
11:43 virement 200 000 (REC-13) ; 11:48 virement 50 000 (REC-14) ; 11:49 mobile money 30 000 (REC-15) ; 11:50 ouverture de caisse (fonds 10 000) ; 11:52 espèces 20 000 (REC-16) ; 11:55 en ligne 50 000 confirmé et 20 001 en attente ; 11:56 en ligne 20 013 échoué ; 12:00 financement de l'inscription 0014 ; 12:04 espèces 25 000 (REC-18), inscription 0014 « Active » ; 12:10 période de paie activée et calcul ; 12:11 prime 5 000 puis retenue 2 000 ; 12:15–12:17 versements de l'État 60 000 (REC-19) et 60 000 (REC-20). Aucun remboursement envoyé.

## Données créées (fictives)
Frais SCOL-6E-QA05 ; barème 150 000 XOF ; plan ECH-3X-QA05 (3 parts) ; remise FRATRIE-QA05 10 % ; factures FAC-25 (soldée) et FAC-26 (soldée) ; paiements 200 000, 50 000, 30 000, 20 000 ; paiements en ligne sandbox 50 000 / 20 001 / 20 013 ; caisse CAISSE-QA05 (session ouverte, fonds 10 000, attendu en espèces 55 000, toujours ouverte) ; espèces 25 000 pour ASSI Brice (REC-18) ; financement de l'inscription 0014 → Bourse ; bourse Fondation Exemple 50 % ; versements État 60 000 + 60 000 sur FAC-24 ; configurations de paie TRAORE (3 000 XOF/h) et YAO Fatou (120 000) ; période « Paie septembre 2026 (test QA 05) » ; bulletin YAO Fatou 123 000 (Calculé).

## Points non testés
Demande de remboursement (bloquée par le contrôle d'autorisation de la session, rien envoyé) ; clôture de caisse (irréversible) ; résolution manuelle d'un paiement bloqué (aucun paiement à rapprocher par action humaine) ; exécution d'un import ; tarif horaire du guide inconnu (3 000 XOF choisi) ; P10 et P11 ; ouverture du lien de paiement ; second compte et fenêtre privée.

## Décisions attendues du propriétaire
1. Remboursement test : autoriser l'envoi, ou le faire depuis un autre rôle ? 2. Clôture de la caisse CAISSE-QA05 (attendu 55 000 XOF) ? 3. Surpaiement : refus voulu ou acompte voulu ? 4. Fournisseur sandbox dans la liste ? 5. Une inscription « Bourse » doit-elle créer la prise en charge ? 6. Tarif horaire de démonstration et heures validées pour la paie ? 7. Doublons de frais, barème, plan et remise (préexistants et créés) ?

## Traitement par le développeur (2026-10-07)
| Constat | Verdict | Action |
|---|---|---|
| C-05-05 | **Défaut réel corrigé.** Toute facture porte un identifiant de groupe ; le bandeau s'affichait donc pour toutes. | `Invoices.tsx` : bandeau seulement pour une facture de financeur ou un financement non privé. Tests finance web verts (130). |
| C-05-06 | **Défaut réel corrigé.** Les compteurs ne comptaient que les dossiers actifs ou suspendus, le tableau tous les dossiers sauf rejetés/remplacés. | `stateassign/infrastructure/reports-repository.ts` : même périmètre. Tests stateassign verts (123). À re-tester sur AFF-DEMO-0001 (attendu : Écart 1). La question de l'écart famille inchangé après versement de l'État reste à instruire. |
| C-05-01 | Comportement actuel = acompte « non imputé » ; décision métier requise (question 3). | À arbitrer ; au minimum afficher payeur, solde et part non imputée dans la confirmation. |
| C-05-02 | Défaut réel, non corrigé : l'économe n'a pas le droit de lire la liste des fournisseurs et l'écran propose cinq noms en dur. | À faire : endpoint de lecture des fournisseurs actifs pour l'encaissement en ligne. |
| C-05-03, C-05-04 | Défauts d'ergonomie / règle métier. | À cadrer (sélecteur de prise en charge ; lien financement / bourse). |
| C-05-07 à C-05-19 | Confirmés (Mineur / Suggestion). | À planifier. |
