# Chapitre 12. Finance et paiements

> Ce chapitre est volumineux : il est coupé en **trois fichiers** qui se suivent dans l'ordre d'exécution (les scénarios portent un numéro continu `12.1` à `12.41`).
> - `12a-finance-catalogue-factures.md` (ce fichier) : en-tête commun, frais, barèmes, plans, remises, factures (`12.1` à `12.10`).
> - `12b-finance-encaissements-recus.md` : caisse, encaissements manuels, paiement en ligne simulé, facture de reprise, paiement multiple, surpaiement, reçus (`12.11` à `12.21`).
> - `12c-finance-famille-rapprochement-pilotage.md` : famille, rapprochement, résolution manuelle, avoir, remboursement à quatre yeux, clôture de caisse, facture annulée, financement, reçu PDF, inscription conditionnée au paiement, rapports, fournisseurs, webhooks, droits, isolation, variantes (`12.22` à `12.41`), puis **Données créées**, **Écarts constatés**, **À vérifier en test**, **Non couvert / limites connues** de tout le chapitre.

Établissement de référence : **Collège Le Baobab** (`secondaire-test`). La même chaîne se rejoue à l'**École primaire Les Palmiers** et à l'**Université Horizon** (scénario `12.40`).

## Adresses (préfixe `/v2`)

L'App Router place les écrans de finance sous `apps/web/src/app/v2/finance/`. L'adresse réelle dans le navigateur est donc `http://localhost:3000/v2/finance/...` : preuve, `apps/web/next.config.js` n'a ni `basePath` ni réécriture de `/v2`, et `apps/web/middleware.ts` ne fait qu'ajouter des en-têtes de sécurité. Toutes les adresses de ce chapitre commencent par `/v2/finance`. Un accès refusé redirige vers `/unauthorized` (page « Accès refusé », hors de la coque habituelle : défaut connu, voir "Écarts constatés").

Les entrées du menu de gauche (module « Finance ») viennent du manifeste de l'API et ne sont pas dans `fr-CI.json` : elles sont citées entre guillemets droits ("Facturation", "Encaissements", "Caisse", "Frais et barèmes", "Tableau de bord financier", "Paiements en ligne", "Fournisseurs de paiement", "Paiements à rapprocher", "Webhooks en échec", "Élèves affectés par l'État"). Dans tout le chapitre, on navigue plutôt avec la **barre de sections** en haut de l'écran, dont les libellés sont ceux de `fr-CI.json` : « Vue d'ensemble », « Factures », « Encaissements », « À rapprocher », « Reçus », « Remboursements », « Caisse », « Frais et barèmes », « Remises et bourses », « Rapports », « Webhooks en échec », « Fournisseurs de paiement », « Mes finances » (chaque entrée n'apparaît que si le compte a la permission).

## Prérequis

- Application lancée en local (`pnpm dev:v2` + graine `pnpm dev:v2:seed`) ; chapitres 01 à 03 faits (connexion, MFA).
- **Fournisseur de paiement simulé proposé** : l'environnement fourni par `scripts/dev-v2/cli.mjs` pose `NEXT_PUBLIC_FINANCE_SANDBOX=1`, ce qui fait apparaître « Paiement simulé (démonstration) » dans les listes de fournisseurs (écrans économe et parent). Si le serveur web a été démarré sans cette variable, la liste ne contient que les cinq opérateurs réels (non configurés) : redémarrer le serveur web, sinon consigner un écart Majeur.
- Le **service de tâches de fond** (worker) doit tourner : il confirme l'inscription après paiement (`12.34`), fait le rapprochement et rend les PDF de reçus (`12.33`).
- Les scénarios sont **à exécuter dans l'ordre** : les montants attendus (reste dû, soldes, totaux de rapports) supposent que les scénarios précédents ont été faits. Les opérations définitives (reçus, clôture de caisse, remboursement, avoir) sont par nature non annulables.
- Deux sessions en parallèle sont utiles : une fenêtre pour l'économe, une **fenêtre privée** pour le directeur, une troisième pour le parent / l'élève. Ne jamais se déconnecter d'un autre compte que celui du scénario.

## Comptes à utiliser

Les e-mails sont ceux de l'annexe `annexe-donnees-de-depart.md`. Mots de passe et codes MFA ne sont jamais écrits : on clique sur le compte dans le panneau de la page `/v2/login`, et pour un compte MFA le bouton du panneau affiche le code du moment (usage unique, change toutes les 30 secondes).

| Rôle | Collège Le Baobab | École Les Palmiers | Université Horizon | MFA |
|---|---|---|---|---|
| Économe | `econome@secondaire-test.test` | `econome@primaire-test.test` | `econome@superieur-test.test` | oui |
| Directeur | `directeur@secondaire-test.test` | `directeur@primaire-test.test` | `directeur@superieur-test.test` | oui |
| Secrétariat (lecture seule) | `secretariat@secondaire-test.test` | `secretariat@primaire-test.test` | `secretariat@superieur-test.test` | oui |
| Enseignant (aucun droit finance) | `enseignant@secondaire-test.test` | `enseignant@primaire-test.test` | `enseignant@superieur-test.test` | non |
| Parent (DIABATE Séka, tuteur n° 1) | `parent@secondaire-test.test` | `parent@primaire-test.test` | `parent@superieur-test.test` | non |
| Élève (DIABATE Nadia) | `eleve@secondaire-test.test` | `eleve@primaire-test.test` | `eleve@superieur-test.test` | non |

Le propriétaire (`direction.generale@<slug>.test`) a les mêmes droits que le directeur sur la finance ; il n'est pas utilisé ici.

**Code de confirmation demandé en cours de session** (action sensible : résolution manuelle d'un paiement, rejeu d'un webhook) : la fenêtre « Confirmez votre identité » demande un « Code à 6 chiffres ». Le code du moment s'obtient comme à la connexion : ouvrir `/login` dans une fenêtre privée et utiliser le bouton du panneau de comptes qui affiche le code du directeur. Ne jamais le noter dans un rapport.

## Droits (qui peut quoi)

Source : `apps/api/src/modules/rbac/templates/system-roles.ts` et gardes de page `requirePermission` (`apps/web/src/app/v2/finance/**/page.tsx`).

| Écran | Permission exigée par la page | Économe | Directeur | Secrétariat | Enseignant | Parent / Élève |
|---|---|---|---|---|---|---|
| Vue d'ensemble | l'une de : rapports, factures, paiements, caisse, frais (lecture) | oui | oui | oui (sans chiffres) | non | non |
| Frais, barèmes, plans, remises | `finance.fee.read` (création : `finance.fee.manage`) | oui | oui | non | non | non |
| Factures (liste, fiche) | `finance.invoice.read` | oui | oui | oui (lecture) | non | non |
| Nouvelle facture | `finance.invoice.create` | oui | oui | non | non | non |
| Encaissements (liste, fiche) | `finance.payment.read` | oui | oui | oui (lecture) | non | non |
| Encaisser, paiement en ligne | `finance.payment.create` | oui | oui | non | non | non |
| À rapprocher | `finance.payment.read` (résoudre : `finance.payment.reconcile`) | lecture + vérifier | oui + résoudre | lecture | non | non |
| Reçus | `finance.receipt.read` | oui | oui | oui | non | non |
| Remboursements | `finance.payment.read` (actions : `finance.payment.refund`) | oui | oui | lecture | non | non |
| Caisse | `finance.cashregister.open` (clôture : `finance.cashregister.close`) | oui | oui | non | non | non |
| Remises et bourses | `finance.invoice.read` (modifier : `finance.fee.manage`) | oui | oui | lecture | non | non |
| Rapports | `finance.report.read` | oui | oui | non | non | non |
| Webhooks en échec | `finance.webhook.read` (rejeu : `finance.webhook.replay`) | lecture | oui + rejeu | non | non | non |
| Fournisseurs de paiement | `finance.provider.manage` | **non** | oui | non | non | non |
| Mes finances (`me`) | `finance.child.read` ou `finance.self.read` | non | non | non | non | oui |

Adresses à taper à la main qui doivent être refusées : voir le scénario `12.38` (au moins trois par rôle sans droit).

## Données de départ (graine)

Sources : `scripts/seed-v2/dataset.ts`, `scripts/seed-v2/scenario.ts` (étape 4), `scripts/seed-v2/demo/finance.ts`, `scripts/seed-v2/demo/stateassign.ts`.

- Frais du modèle de pack (créés à la création de l'établissement) : "REGISTRATION" "Frais d'inscription" (catégorie « Inscription ») et "TUITION" « Scolarité » (catégorie « Scolarité »). Au supérieur : "INSC" "Frais d'inscription" et "SCOL" "Scolarité annuelle".
- Barèmes de l'année en cours (code d'année "2026-2027" pour une base créée en octobre 2026), en vigueur depuis le 1er janvier 2020, sans périmètre : inscription 25 000 F CFA et scolarité 200 000 F CFA au collège ; 15 000 et 120 000 à l'école ; 50 000 et 600 000 à l'université.
- Les 12 élèves ont une facture d'inscription émise ; les **8 premiers** (DIABATE Nadia à TOURE Jean-Marc) l'ont réglée par virement (références "VIR-DEMO-001" à "VIR-DEMO-008") et leur inscription est « Active ». Les 4 derniers (SORO Elie, SORO Aya, N'GUESSAN Koffi, N'GUESSAN Aya) ont une facture d'inscription émise **impayée** et une inscription « En attente ».
- Scolarité des 8 premiers : DIABATE Nadia, soldée par virement ("VIR-DEMO-secondaire-test-1") ; DIABATE Salimata, payée à moitié par mobile money ("MM-DEMO-secondaire-test-1"), reste dû 100 000 ; BAMBA Aya, 50 000 payés en ligne (fournisseur simulé), reste 150 000 ; BAMBA Fatou, un paiement en ligne de 20 013 **échoué**, scolarité intacte ; COULIBALY Moussa, COULIBALY Salimata, TOURE Yao, TOURE Jean-Marc : scolarité émise et impayée (200 000).
- **Rien** n'est créé au départ pour : plans d'échéancier, remises, caisses et sessions de caisse, remboursements, paiements en attente, événements webhook (vérifier : une autre session de test a pu en créer ; ne rien supprimer, le catalogue ne propose aucune suppression).
- Le seed crée aussi un dossier d'élève affecté par l'État avec facture scindée famille / État (chapitre 19) et des factures d'inscription pour les candidats admis (références "VIR-ADM-..."), non utilisés ici.
- Les chiffres de la vue d'ensemble dépendent donc de la base : **relever la synthèse de départ au scénario 12.1** et raisonner en écarts.

## Conventions de saisie

- Montants : **entiers en francs CFA**, sans virgule ni point. Les espaces sont ignorés ("54 000" = "54000").
- Les codes sont mis en **majuscules** par l'API (taper "tg-divers" crée "TG-DIVERS").
- Chaque enregistrement créé porte "test guide" dans son nom, ses codes commencent par `TG-` et ses références de paiement contiennent `TG`.
- Les dates se saisissent dans les champs "date" du navigateur ; les exemples sont écrits au format `AAAA-MM-JJ`. Date du jour du guide : 8 octobre 2026 ; remplacer par la date réelle quand elle importe.
- Les messages que l'écran compose avec un nom propre entre guillemets français (par exemple "Le frais "Frais divers test guide" a été créé.") sont recopiés ici avec des guillemets droits pour le nom ; le texte réel de l'écran a bien des guillemets français.

## La chaîne de test de la finance (réutilisée par le parcours F)

| Étape | Enregistrement | Nom stable |
|---|---|---|
| 1 | Frais | code `TG-DIVERS`, libellé "Frais divers test guide", catégorie « Autres », barème 60 000 F CFA pour 2026-2027 |
| 2 | Plan d'échéancier | `TG-3T` "Plan 3 tranches test guide" (3 × 18 000 sur 54 000) |
| 3 | Remises | `TG-REM10` "Remise 10 % test guide" ; `TG-REM5000` "Remise 5 000 F test guide" |
| 4 | Facture | **Facture n°1 test guide** au nom de DIABATE Nadia (élève du seed, 6e A) : 60 000 − 6 000 = 54 000 F CFA en 3 tranches |
| 5 | Paiements de la facture n°1 | virement "VIR-TG-001" (10 000), espèces (8 000), mobile money "MM-TG-001" (6 000), en ligne simulés (5 000 ; 5 001 en attente ; 5 013 échoué), parent (4 000 ; 2 001 ; 2 013) |
| 6 | Reçus | un reçu `REC-2026-nnnnnn` par paiement confirmé |
| 7 | Avoir | 3 000 F CFA sur la facture n°1 |
| 8 | Remboursement | 3 000 F CFA du virement "VIR-TG-001", demandé par l'économe, approuvé par le directeur |
| 9 | Autres factures | **Facture n°2 test guide** (reprise de solde d'ouverture, DIABATE Nadia, 25 000) ; **Facture n°3 test guide** (COULIBALY Moussa, annulée) ; **Facture n°4 test guide** (SORO Aya, avec bourse) |
| 10 | Caisse | `TG-CAISSE-1` "Caisse test guide" |

**Relevé à compléter en cours de test** (les numéros sont attribués par le système) :

| Repère | Où le lire | Valeur à noter |
|---|---|---|
| Numéro de la facture n°1 | liste des factures | FAC-2026-............ |
| Numéro de la facture n°2 | liste des factures | FAC-2026-............ |
| Reçu du virement "VIR-TG-001" | liste des reçus | REC-2026-............ |
| Reçu du paiement du parent (4 000) | liste des reçus | REC-2026-............ |
| Numéro de l'avoir | message après émission | AV-2026-............ |
| Synthèse de départ (12.1) | vue d'ensemble | facturé ......... · encaissé ......... · restant dû ......... |

---

#### 12.1 Lire la synthèse de départ et les accès rapides
Compte : économe (Collège Le Baobab) · Où : barre de sections « Finance » > « Vue d'ensemble » (`/v2/finance`) · Prérequis : aucun.
1. Se connecter en économe (code MFA du panneau de `/v2/login`). La page d'accueil du rôle est `/v2/finance`.
2. Lire le titre « Finance » et sa description. Lire le bloc « Synthèse » : huit cartes « Facturé », « Avoirs », « Facturé net », « Encaissé », « Restant dû », « En retard », « Paiements non imputés », « Taux de recouvrement » (le taux s'affiche « Sans objet » s'il n'y a rien à recouvrer).
3. **Noter** « Facturé », « Encaissé », « Restant dû » dans le relevé de l'en-tête (ils servent au scénario 12.35).
4. Lire « Accès rapides » : six raccourcis nommés « Encaisser un paiement », « Émettre une facture », « Caisse », « Rapports », « Factures en retard », « Remboursements ».
5. Cliquer « Factures en retard » : l'adresse devient `/v2/finance/invoices?status=OVERDUE` et le filtre « Statut » affiche « En retard ».
Résultat attendu : les huit cartes se remplissent sans message d'erreur ; la carte « En retard » porte une mention du nombre de factures en retard ; la liste filtrée est vide (« Aucune facture » et « Modifiez les filtres ou émettez une nouvelle facture. ») tant qu'aucune échéance n'est dépassée.
Cas invalides : | Saisie | Message attendu |
|---|---|
| Se connecter en secrétariat et ouvrir `/v2/finance` | page affichée avec le titre, sans cartes de synthèse (le droit de lire les rapports manque) ; seul le raccourci « Factures en retard » est proposé |
| Se connecter en enseignant et ouvrir `/v2/finance` | redirection vers `/unauthorized` : « Accès refusé » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour l'enseignant

---

#### 12.2 Lire le catalogue, créer deux frais, désactiver et réactiver
Compte : économe · Où : barre de sections « Frais et barèmes » (`/v2/finance/fees`), puis la sous-barre « Catalogue des frais » > « Frais » · Prérequis : 12.1.
1. Lire la liste (légende « Catalogue des frais », colonnes « Code », « Libellé », « Catégorie », « Statut »). Au départ : "REGISTRATION" "Frais d'inscription" (« Inscription », « Actif ») et "TUITION" « Scolarité » (« Scolarité », « Actif »).
2. Filtrer : « Catégorie » = « Cantine » donne « Aucun frais » (et « Créez les frais de l'établissement, puis leurs barèmes. ») ; revenir à « Toutes les catégories » ; cocher « Frais actifs seulement » puis décocher.
3. Cliquer « Nouveau frais » : la fenêtre « Nouveau frais » s'ouvre. Remplir :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Code | TG-DIVERS | oui |
   | Libellé | Frais divers test guide | oui |
   | Catégorie | « Autres » | oui |
   | Description | Frais de démonstration du guide de test | non |
4. Cliquer « Créer ».
5. Recommencer avec Code "TG-CANTINE", Libellé "Frais de cantine test guide", Catégorie « Cantine » (pas de description).
6. Sur la ligne "TG-CANTINE", cliquer « Désactiver », puis « Activer ».
Résultat attendu : à l'étape 4, la fenêtre se ferme, le message `Le frais "Frais divers test guide" a été créé.` s'affiche, la ligne "TG-DIVERS" apparaît avec « Autres » et « Actif » et reste là après rechargement de la page. À l'étape 6 : `Le frais "Frais de cantine test guide" est désactivé.` puis statut « Inactif » (la ligne disparaît si « Frais actifs seulement » est cochée) ; `Le frais "Frais de cantine test guide" est actif.` après « Activer ». Le champ « Code » du formulaire a pour aide « Court et unique (par exemple SCOL-6E). ».
Cas invalides : | Saisie | Message attendu |
|---|---|
| Code vide, puis « Créer » | « Ce champ est obligatoire. » sous « Code » |
| Libellé vide | « Ce champ est obligatoire. » sous « Libellé » |
| Code `TG DIVERS` (avec espace) | "Code de frais invalide (A-Z, 0-9, _ ou -, 40 caractères max)." sous « Code » |
| Code `tg-divers` (même code que le frais créé, en minuscules) | dans la fenêtre : `Le code de frais "TG-DIVERS" existe déjà.` (l'API met le code en majuscules) |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le secrétariat (`/v2/finance/fees` : « Accès refusé », pas d'entrée « Frais et barèmes » dans sa barre)

---

#### 12.3 Créer le barème du frais divers, résoudre un montant, jeux invalides
Compte : économe · Où : « Frais et barèmes » > « Barèmes » (`/v2/finance/fees/schedules`) · Prérequis : 12.2.
1. Lire la liste (légende « Barèmes de frais », colonnes « Frais », « Année », « Périmètre », « Montant », « Validité », « Statut ») et les filtres « Frais », « Année scolaire », « Barèmes en vigueur seulement » (coché). Au départ : une ligne par frais d'inscription et de scolarité, périmètre « Tous les apprenants », « En vigueur », montants 25 000 F CFA et 200 000 F CFA (collège).
2. Cliquer « Nouveau barème » (fenêtre « Nouveau barème », avec la phrase « Le montant est un entier en francs. L'API refuse un chevauchement ambigu. ») et remplir :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Frais | Frais divers test guide (liste « Choisir un frais… ») | oui |
   | Année scolaire | 2026-2027 | oui |
   | Montant | 60000 | oui |
   | En vigueur à partir du | 2026-09-01 | oui |
   | Jusqu'au (facultatif) | (vide) | non |
   | Périmètre du barème : Établissement, Campus, Niveau (clé), Filière (clé), Type d'apprenant (clé) | (laisser vides : « Tous ») | non |
   | Plan d'échéancier par défaut | « Aucun » | non |
3. Cliquer « Créer le barème ».
4. Dans la zone « Quel montant s'applique ? » : Frais = Frais divers test guide, Année scolaire = 2026-2027, laisser les autres champs, cliquer « Résoudre ».
5. Refaire avec Frais = Frais de cantine test guide.
Résultat attendu : étape 3, message « Le barème a été créé. » et ligne "Frais divers test guide" · 2026-2027 · « Tous les apprenants » · 60 000 F CFA · "Depuis le" 1 sept. 2026 · « En vigueur » ; étape 4, `Montant applicable : 60 000 F CFA (année 2026-2027).` ; étape 5, une alerte "Aucun barème ne s'applique à ce frais pour ce périmètre et cette date." (le frais de cantine n'a pas de barème : il ne pourra pas être facturé depuis le catalogue, voir 12.8).
Cas invalides : | Saisie | Message attendu |
|---|---|
| Montant `-5` | « Le montant ne peut pas être négatif. » |
| Montant `60 000,5` | « Le montant est un entier en francs : pas de virgule ni de point. » |
| Montant vide | « Saisissez un montant. » |
| Frais non choisi, ou Année scolaire non choisie, ou date de début vide | « Ce champ est obligatoire. » sous le champ concerné |
| Fin `2026-08-31` avec début `2026-09-01` | "La date de fin d'effet précède la date de début." sous « Jusqu'au (facultatif) » |
| Deuxième barème pour le même frais et la même année, début `2026-09-15`, sans fin (chevauche le premier, qui n'a pas de fin) | dans la fenêtre : "Un barème actif couvre déjà ce périmètre sur cette période." |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le secrétariat
_Source : `Catalog.tsx`, `fee-schedule.ts` (chevauchement, dates), `money.ts`. Aucun bouton ne permet de mettre un barème hors vigueur : le barème créé ici est durable._

---

#### 12.4 Créer le plan en trois tranches et un plan à montant fixe
Compte : économe · Où : « Frais et barèmes » > « Plans d'échéancier » (`/v2/finance/fees/plans`) · Prérequis : 12.2.
1. Lire la page. Au départ : « Aucun plan d'échéancier ». Si la phrase « Les échéanciers ne sont pas inclus dans l'offre de l'établissement. » s'affiche et que « Nouveau plan » est absent, noter l'écart (fonction de l'abonnement) et passer à 12.5 ; la facture n°1 se fera alors sans plan.
2. Cliquer « Nouveau plan » (fenêtre « Nouveau plan d'échéancier ») :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Code | TG-3T | oui |
   | Libellé | Plan 3 tranches test guide | oui |
   | Échéance 1 : Libellé de l'échéance | Tranche 1 | oui |
   | Échéance 1 : Type de part / Poids | « Pondérée » / 1 | oui |
   | Échéance 1 : Échéance / Jours | « Nombre de jours après la facture » / 0 | oui |
   | Échéance 2 (après « Ajouter une échéance ») | Libellé "Tranche 2", « Pondérée », poids 1, « Nombre de jours après la facture », jours 30 | oui |
   | Échéance 3 (après « Ajouter une échéance ») | Libellé "Tranche 3", « Pondérée », poids 1, « Nombre de jours après la facture », jours 60 | oui |
3. Cliquer « Créer le plan ».
4. Créer un second plan : Code "TG-FIXE", Libellé "Plan acompte test guide", Échéance 1 "Acompte" de type « Montant fixe » = 70000, « Nombre de jours après la facture » 0 ; Échéance 2 "Solde", « Pondérée » 1, 30 jours. Il sert à 12.8.
Résultat attendu : message `Le plan "Plan 3 tranches test guide" a été créé.` ; une carte apparaît avec le titre du plan, le code `TG-3T` et trois lignes "Tranche 1 Poids 1 · échéance à +0 j", "Tranche 2 Poids 1 · échéance à +30 j", "Tranche 3 Poids 1 · échéance à +60 j". Le découpage exact au franc près est fait plus tard, à l'émission d'une facture.
Cas invalides : | Saisie | Message attendu |
|---|---|
| Code vide | « Ce champ est obligatoire. » |
| Code `TG 3T` (espace) | "Code de plan invalide." |
| Code `tg-3t` une deuxième fois | `Le code de plan "TG-3T" existe déjà.` |
| Libellé d'échéance vide | « Ce champ est obligatoire. » |
| Part « Montant fixe » vide | « Saisissez un montant. » |
| Poids `0` | "La valeur doit être supérieure ou égale à 1." |
| Type « Date précise » sans date | "Date attendue au format AAAA-MM-JJ." |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le secrétariat
_Source : `Catalog.tsx` (formulaire), `catalog.ts` (code), `installments.ts`, `validation.ts` (messages de formulaire). Pas de suppression ni de désactivation d'un plan dans l'interface._

---

#### 12.5 Créer deux remises non cumulables
Compte : économe · Où : « Frais et barèmes » > « Remises » (`/v2/finance/fees/discounts`) · Prérequis : 12.2.
1. Lire la page (colonnes « Code », « Libellé », « Valeur », « Plafond », « Catégories », « Cumulable », « Statut »). Au départ : « Aucune remise ».
2. Cliquer « Nouvelle remise » (fenêtre « Nouvelle remise ») :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Code | TG-REM10 | oui |
   | Libellé | Remise 10 % test guide | oui |
   | Type | « Pourcentage » | oui |
   | Pourcentage | 10 | oui |
   | Plafond (facultatif) | (vide) | non |
   | Catégories concernées | (aucune case cochée = toutes) | non |
   | Cumulable avec d'autres remises | décochée | non |
3. « Créer ». Puis une seconde remise : Code "TG-REM5000", Libellé "Remise 5 000 F test guide", Type « Montant fixe », Montant 5000, case « Cumulable avec d'autres remises » décochée.
Résultat attendu : messages `La remise "Remise 10 % test guide" a été créée.` puis la seconde ; lignes avec valeurs "10,00 %" et "5 000 F CFA", catégories « Toutes », cumulable « Non », statut « Active ».
Cas invalides : | Saisie | Message attendu |
|---|---|
| Pourcentage vide | « Saisissez un pourcentage. » |
| Pourcentage `abc` ou `10.555` | « Pourcentage invalide (par exemple 10 ou 12,5). » |
| Pourcentage `0` ou `150` | « Le pourcentage doit être compris entre 0,01 et 100. » |
| Type « Montant fixe », Montant vide | « Saisissez un montant. » |
| Montant `-100` | « Le montant ne peut pas être négatif. » |
| Code `TG-REM10` une deuxième fois | `Le code de remise "TG-REM10" existe déjà.` |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le secrétariat
_Source : `Catalog.tsx`, `money.ts` (`parsePercentToBps`), `discount.ts`. Règle des remises non cumulables : seule la plus avantageuse s'applique (vérifiée en 12.7)._

---

#### 12.6 Lire la liste des factures et filtrer
Compte : économe · Où : « Factures » (`/v2/finance/invoices`) · Prérequis : 12.1.
1. Lire la liste (légende « Liste des factures », colonnes « Numéro », « Apprenant », « Année », « Payeur », « Statut », « Total », « Payé », « Reste dû », « Échéance ») et les filtres « Apprenant », « Statut », « Payeur », « Année scolaire ».
2. Filtre « Apprenant » : taper "DIABATE" et choisir la ligne "DIABATE Nadia" (la ligne indique matricule et classe). Lire : deux factures, inscription 25 000 F CFA et scolarité 200 000 F CFA, toutes deux « Payée », « Reste dû » 0 F CFA.
3. Changer pour "DIABATE Salimata" : la scolarité est « Partiellement payée », « Payé » 100 000 F CFA, « Reste dû » 100 000 F CFA.
4. Changer pour "COULIBALY Moussa" : scolarité « Émise », « Reste dû » 200 000 F CFA. Puis "SORO Elie" : une seule facture d'inscription « Émise », 25 000 F CFA.
5. Retirer l'apprenant (croix du champ) et choisir « Payeur » = « Financeur » : la liste ne montre que les parts de financeurs (par exemple la part de l'État du dossier d'élève affecté, chapitre 19).
Résultat attendu : les montants correspondent aux "Données de départ" ; chaque ligne est un lien vers la fiche (`/v2/finance/invoices/<id>`) ; la pagination est de 25 lignes. Les noms sont des identifiants courts si le compte n'a pas le droit de lire les élèves (pas le cas de l'économe).
Cas invalides : | Saisie | Message attendu |
|---|---|
| Filtre sans résultat (« Statut » = « Annulée » avant tout test) | « Aucune facture » et « Modifiez les filtres ou émettez une nouvelle facture. » |
| Ouvrir `/v2/finance/invoices` en parent | redirection vers `/unauthorized` : « Accès refusé » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le parent

---

#### 12.7 Créer, calculer l'aperçu puis émettre la facture n°1 test guide
Compte : économe · Où : « Factures » > bouton « Nouvelle facture » (`/v2/finance/invoices/new`) · Prérequis : 12.2 à 12.5.
1. Vérifier le mode « Depuis le catalogue » (aide : « Les montants viennent des barèmes ; remises, bourses et part de l'État sont appliquées par l'API. »).
2. Dans le bloc « Apprenant », remplir :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Apprenant | "DIABATE Nadia" | oui |
   | Inscription | la seule inscription proposée (6e A) | non |
   | Année scolaire | 2026-2027 | non (déduite de l'inscription) |
3. Bloc « Frais à facturer » : Frais = Frais divers test guide ; Quantité = 1 ; Désignation (facultatif) = vide.
4. Bloc « Remises et échéancier » : cocher **les deux** remises "Remise 10 % test guide (10,00 %)" et "Remise 5 000 F test guide (5 000 F CFA)" ; « Plan d'échéancier » = "Plan 3 tranches test guide" ; laisser « Échéance de la facture » et « Date de départ du plan » vides ; laisser « Ne pas appliquer le financement de l'apprenant » décochée.
5. Avant de calculer, constater que « Enregistrer en brouillon » et « Émettre la facture » sont désactivés et que la phrase « Calculez l'aperçu pour pouvoir émettre ou enregistrer la facture. » est affichée.
6. Cliquer « Calculer l'aperçu ». Lire « Aperçu avant émission » : « Sous-total » 60 000 F CFA, « Remises » **6 000 F CFA** (et non 11 000 : de deux remises non cumulables seule la plus avantageuse s'applique), « Bourses et prises en charge » 0, « Total » 54 000 F CFA ; trois échéances "Tranche 1", "Tranche 2", "Tranche 3" de 18 000 F CFA, dates = jour de l'émission, +30 jours, +60 jours.
7. Décocher "Remise 5 000 F test guide" : le bandeau « Le formulaire a changé depuis l'aperçu : recalculez-le avant d'émettre. » apparaît et les boutons se désactivent. Cliquer de nouveau « Calculer l'aperçu » : mêmes montants.
8. Cliquer « Émettre la facture ».
Résultat attendu : écran « Facture enregistrée » avec `1 facture a été enregistrée.` et, dans « Factures créées », un lien au numéro `FAC-2026-nnnnnn` (pastille « Famille »). **Noter ce numéro** (facture n°1). Aucun enregistrement n'existe avant l'émission (le brouillon n'est créé que si on clique « Enregistrer en brouillon »). Rien n'est ajouté si l'on quitte la page avant l'étape 8. Le bouton « Retour aux factures » ramène à la liste où la facture est « Émise », total 54 000 F CFA, reste dû 54 000 F CFA.
Cas invalides : | Saisie | Message attendu |
|---|---|
| Aucun apprenant choisi puis « Calculer l'aperçu » | "Choix invalide." sous « Apprenant » (message à relever en test) |
| Frais non choisi dans la ligne | "Choix invalide." sous « Frais » (message à relever en test) |
| Quantité `0` | "La valeur doit être supérieure ou égale à 1." |
| Aucune année ni inscription (choisir un apprenant, laisser « Inscription » à « Aucune » et « Année scolaire » à « Choisir… ») | "Année scolaire requise (ou inscription)." sous « Année scolaire » |
| Double clic rapide sur « Émettre la facture » | une seule facture est créée (une clé d'idempotence est envoyée avec la demande) |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le secrétariat (`/v2/finance/invoices/new` : « Accès refusé »)
_Source : `InvoiceForm.tsx`, `discount.ts` (cumul), `invoices.ts` (année requise), `idempotency.ts`._

---

#### 12.8 Facture refusée par l'API : frais sans barème, plan incompatible, échéance passée
Compte : économe · Où : `/v2/finance/invoices/new` · Prérequis : 12.7.
1. Apprenant "DIABATE Nadia", Inscription 6e A, Frais = Frais de cantine test guide (actif, **sans barème**), « Calculer l'aperçu ».
2. Remplacer par Frais divers test guide, « Plan d'échéancier » = "Plan acompte test guide", « Calculer l'aperçu ».
3. Remplacer le plan par « Aucun (paiement en une fois) » et fixer « Échéance de la facture » à une date **passée** (`2026-09-15`), « Calculer l'aperçu », puis **ne pas émettre** (fermer par « Annuler »).
4. Ouvrir `/v2/finance/invoices` : aucune facture n'a été ajoutée par ces essais.
Résultat attendu : étape 1, alerte "Aucun barème ne s'applique à ce frais pour ce périmètre et cette date." ; étape 2, alerte "Les montants fixes du plan dépassent le total à échelonner." (acompte 70 000 > total 60 000) ; étape 3, l'aperçu s'affiche sans refus : « Paiement en une fois, échéance » avec la date du 15 sept. 2026. **Une échéance dans le passé est acceptée** par l'écran et par l'API ; la facture passerait « En retard » au prochain passage de la tâche quotidienne de nuit (voir "Écarts" : aucun avertissement).
Cas invalides : | Saisie | Message attendu |
|---|---|
| Date de départ du plan sans plan choisi | le champ « Date de départ du plan » est désactivé |
| Cocher « Ne pas appliquer le financement de l'apprenant » pour un élève sans bourse | aucun effet (l'aperçu est identique) |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le secrétariat

#### 12.9 Enregistrer une facture en brouillon (catalogue)
Compte : économe · Où : `/v2/finance/invoices/new` · Prérequis : 12.7 faite.
1. Apprenant "DIABATE Nadia", Frais divers test guide, aucune remise, aucun plan, « Calculer l'aperçu » (total 60 000 F CFA).
2. Cliquer « Enregistrer en brouillon ».
3. Dans « Factures créées », ouvrir le lien « Brouillon ».
4. Sur la fiche (titre « Facture (brouillon) »), constater : pas de numéro, pas de section « Correction de la facture », pas de bouton « Encaisser ». **Ne pas émettre** : la facture reste un brouillon (elle ne compte pas dans les chiffres et n'est pas encaissable). Elle reste en l'état (non supprimable, voir "Données créées").
Résultat attendu : écran « Facture enregistrée » avec `1 facture a été enregistrée.` ; la liste affiche la ligne avec le libellé « Brouillon » à la place du numéro et le statut « Brouillon ». Le bouton « Émettre la facture » existe sur la fiche du brouillon (pour qui a le droit de créer des factures).
- [ ] Cas nominal  - [ ] Cas invalide (non applicable)  - [ ] Droit refusé pour le secrétariat

---

#### 12.10 Lire la fiche de la facture n°1 test guide
Compte : économe · Où : « Factures » > ligne de la facture n°1 (`/v2/finance/invoices/<id de la facture n°1>`) · Prérequis : 12.7.
1. Lire l'en-tête : titre = numéro de la facture ; sous-titre "DIABATE Nadia · année 2026-2027" ; boutons « Retour aux factures », « Imprimer », « Encaisser ».
2. Lire « Montants » avec les pastilles « Émise » et « Famille » : « Sous-total » 60 000 F CFA, « Remises » 6 000 F CFA, « Bourses et prises en charge » 0, « Total » 54 000 F CFA, « Payé » 0, « Avoirs » 0, « Reste dû » 54 000 F CFA, « Échéance de la facture » (date de la dernière tranche).
3. Lire « Lignes » (colonnes « Désignation », « Catégorie », « Qté », « Prix unitaire », « Remise », « Bourse », « Total ») : une ligne, "Frais divers test guide", « Autres », 1, 60 000 F CFA, 6 000 F CFA, 0, 54 000 F CFA.
4. Lire « Échéancier » (colonnes « N° », « Échéance », « Date limite », « Montant », « Payé », « Reste dû », « Statut ») : "Tranche 1" 18 000 F CFA, "Tranche 2", "Tranche 3", toutes « À payer ».
5. Lire « Correction de la facture » : la phrase « Un avoir réduit définitivement le reste dû. Pour annuler une somme déjà encaissée, remboursez d'abord le paiement. » et les boutons « Émettre un avoir » et « Annuler la facture ».
6. Cliquer « Imprimer » : la boîte d'impression du navigateur s'ouvre ; la fermer.
Résultat attendu : la somme des trois tranches égale exactement le total (54 000 F CFA) ; aucun bandeau "facture liée" (pas de financeur : correctif QA C-05-05) ; le bouton « Encaisser » mène à `/v2/finance/payments/new?learnerId=<id de Nadia>` (le champ Apprenant s'y affiche d'abord avec un identifiant court : défaut connu, voir "Écarts").
Cas invalides : | Saisie | Message attendu |
|---|---|
| Ouvrir `/v2/finance/invoices/00000000-0000-4000-8000-000000000000` | bloc d'erreur "Facture introuvable (00000000-0000-4000-8000-000000000000)." avec le bouton « Réessayer » |
| Ouvrir `/v2/finance/invoices/abc` | bloc d'erreur (identifiant mal formé, refus de validation) : message à relever en test |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le parent
