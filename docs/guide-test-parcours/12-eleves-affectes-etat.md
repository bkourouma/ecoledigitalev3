[⬅ Sommaire](../GUIDE_TEST_UTILISATEUR_COMPLET.md) · [← Précédent](11-conseil-de-classe.md) · [Suivant →](13a-examens.md)

# Phase 12 — Élèves affectés par l'État

Cette phase suit un élève affecté par l'État : le secrétariat enregistre l'acte d'affectation, la direction le vérifie (une autre personne que l'enregistrant) puis l'active, l'économe rapproche les montants de l'acte avec la facturation et suit la créance sur l'État. La famille voit le statut du dossier de son enfant, jamais les montants. Aucune passerelle vers une plateforme publique n'existe : toute la saisie est manuelle ; aucun barème ni règle officielle n'est livré (tolérance à zéro, aucun contrôle exigé).

Précondition : base de démonstration ; **N'GUESSAN Aya** (dossier complet) et **N'GUESSAN Koffi** (dossier rejeté), élèves de la graine dont l'inscription est encore "en attente" et qui ne sont liés à aucun compte de test. Le dossier de démonstration `AFF-DEMO-0001` concerne ADOU Aïcha. La vérification d'un dossier fixe le financement « Affecté par l'État » de l'inscription correspondante : **rien ne se nettoie** dans l'application. Ne pas utiliser DIABATE Nadia ni DIABATE Salimata (comptes du parent et de l'élève) sauf la variante facultative signalée. Montants en francs CFA entiers, sans décimale ni signe ; les espaces ("120 000") sont acceptés. Comptes : secrétariat, directeur, propriétaire, économe en fenêtre **A** ; parent en fenêtre **B**.

## Étape 209 — Lire la liste des dossiers d'affectation
👤 **secrétariat** (secondaire-test) · fenêtre **A** · 📂 Menu **« Affectés de l'État »** > "Élèves affectés" (`/v2/stateassign`)

Compte : `secretariat@secondaire-test.test` (MFA : le code du moment est proposé sur la page de connexion).

Attendu au départ : une ligne `AFF-DEMO-0001`, version 1, ADOU Aïcha, statut « Vérifié », 120 000 F CFA (État) et 80 000 F CFA (famille), rapprochement « Écart » *(ou « Conforme » ou « Jamais rapproché » : à relever)*.

1. Lire le titre « Élèves affectés par l'État », les onglets **« Dossiers »**, **« Rapprochement »**, **« Créances »**, **« États »** (**« Vérification »** et **« Paramètres »** absents pour ce compte) et le tableau « Dossiers d'affectation ».
2. Saisir `ZZZ` dans la zone « Référence », puis vider. Choisir « Statut » = « Actif », puis « Tous les statuts ».

✅ Avec `ZZZ` ou « Actif » : « Aucun dossier ne correspond. » et « Enregistrez l'acte d'affectation d'un élève pour ouvrir son dossier. ». Le bouton « Enregistrer un dossier » est visible.

🔒 *Test de droit* : en tant que **secrétariat**, taper `/v2/stateassign/verification` → « Accès refusé ».

☐ OK ☐ KO

---

## Étape 210 — Enregistrer le dossier AFF-TG-0001
👤 **secrétariat** (secondaire-test) · fenêtre **A** · 📂 `/v2/stateassign` > **« Enregistrer un dossier »**

1. Cliquer sur **« Enregistrer un dossier »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Élève | `N'GUESSAN Aya` (taper `GUESSAN`, puis choisir) |
| Inscription | l'unique inscription proposée |
| Référence d'affectation | `AFF-TG-0001` |
| Date de l'acte | `01/09/2026` |
| Autorité émettrice | `Autorité fictive test guide` |
| Part de l'État (montant déclaré) | `120 000` |
| Part de la famille (montant déclaré) | `75 000` (volontairement erroné, corrigé à l'étape suivante) |
| Notes | `Dossier test guide` |

2. Cliquer sur **« Enregistrer le dossier »**.

✅ La fiche s'ouvre : « Dossier AFF-TG-0001 (version 1) », statut « Enregistré », montants 120 000 F CFA et 75 000 F CFA, phrase « Dossier non vérifié : l'inscription ne porte pas encore sa référence d'affectation. ». Le secrétariat voit « Corriger » et **aucun bouton « Vérifier le dossier »**.

⚠️ *Test d'erreur* : aucune inscription choisie → « Choisissez l'inscription concernée. » ; référence vide → « La référence d'affectation est obligatoire. » ; part de l'État `12,5` → « Saisissez un nombre entier de francs (sans décimale ni signe). » ; référence `AFF-DEMO-0001` → "Cette référence d'affectation est déjà portée par un autre dossier de l'établissement pour cette année."

⚠️ *Écart connu* : la liste « Inscription » affiche des codes bruts (numéro · `PENDING` · `PRIVATE`, E-19c-3).

☐ OK ☐ KO

---

## Étape 211 — Corriger le dossier avant vérification
👤 **secrétariat** (secondaire-test) · fenêtre **A** · 📂 fiche de `AFF-TG-0001` > **« Corriger »**

1. Cliquer sur **« Corriger »** (fenêtre « Corriger le dossier (avant vérification) »).
2. Mettre « Part de la famille (montant déclaré) » à `80 000` et vider « Référence d'affectation », puis **« Enregistrer »** (refus).
3. Remettre la référence `AFF-TG-0001` et **« Enregistrer »**.

✅ Référence vide refusée avec « La référence d'affectation est obligatoire. » ; ensuite « Dossier corrigé. », la fiche affiche 80 000 F CFA pour la famille. Après la vérification, « Corriger » disparaîtra : le fond est figé (le changement passera par un avenant).

☐ OK ☐ KO

---

## Étape 212 — Quatre yeux et rejet : le dossier AFF-TG-0002
👤 **directeur** (secondaire-test) · fenêtre **A** · 📂 `/v2/stateassign` > **« Enregistrer un dossier »**

Compte : `directeur@secondaire-test.test` (MFA).

1. Enregistrer un dossier pour **N'GUESSAN Koffi** : référence `AFF-TG-0002`, part de l'État `120 000`, part de la famille `80 000`, notes `Dossier test guide à rejeter`.
2. Sur la fiche, cliquer sur **« Vérifier le dossier »**, lire « Vous ne pouvez pas vérifier un dossier que vous avez vous-même enregistré (sauf réglage de l'établissement). », puis cliquer sur **« Vérifier »**.
3. Cliquer sur **« Rejeter »**, saisir `No` puis valider (refus), puis `Rejet test guide : acte non conforme` et cliquer sur **« Rejeter le dossier »**.
4. Enregistrer de nouveau la référence `AFF-TG-0002` pour N'GUESSAN Koffi, puis la rejeter de la même façon.

✅ Étape 2 : "La vérification doit venir d'une autre personne que celle qui a enregistré le dossier." ; le dossier reste « Enregistré ». Étape 3 : `No` refusé avec « Le motif doit comporter au moins 5 caractères. » ; ensuite « Dossier rejeté. », statut « Rejeté », ligne « Motif de rejet ». Étape 4 : la référence est de nouveau disponible (« Le rejet est motivé et définitif pour cette version ; la référence redevient disponible. ») : l'enregistrement est accepté. Les dossiers rejetés n'apparaissent dans la liste qu'avec la case « Inclure les versions remplacées et les dossiers rejetés ».

☐ OK ☐ KO

---

## Étape 213 — Vérifier le dossier AFF-TG-0001
👤 **directeur** (secondaire-test) · fenêtre **A** · 📂 Menu **« Affectés de l'État »** > **« Vérification des affectations »** (`/v2/stateassign/verification`)

1. Lire « Par défaut, vous ne pouvez pas vérifier un dossier que vous avez enregistré vous-même : une deuxième personne est exigée. Aucune vérification n'est jamais automatique. ».
2. Dans « Afficher », garder « À vérifier » : la liste contient `AFF-TG-0001` (le dossier rejeté `AFF-TG-0002` n'y figure plus).
3. Cliquer sur **« Examiner »**, puis **« Vérifier le dossier »**, saisir la note `Vérification test guide` et cliquer sur **« Vérifier »**.
4. Dans « Afficher », choisir « Vérifiés, à activer ».

✅ « Dossier vérifié : la référence d'affectation est portée sur l'inscription. », statut « Vérifié », phrase "L'inscription porte la référence d'affectation de ce dossier" avec `AFF-TG-0001`. Le dossier figure dans « Vérifiés, à activer ». Si le rattachement à l'inscription "en attente" est refusé, un message "L'inscription n'a pas pu être rattachée à l'affectation : …" s'affiche : le relever *(à vérifier)*.

☐ OK ☐ KO

---

## Étape 214 — Activer, suspendre, reprendre
👤 **directeur** (secondaire-test) · fenêtre **A** · 📂 fiche de `AFF-TG-0001`

1. Cliquer sur **« Activer »** : la fenêtre « Activer ce dossier d'affectation ? » s'ouvre. Cliquer sur **« Annuler »**, recommencer, puis confirmer par **« Activer le dossier »**.
2. Cliquer sur **« Suspendre »**, saisir `No` puis valider (refus), puis `Suspension test guide : pièce manquante` et cliquer sur **« Suspendre »**.
3. Cliquer sur **« Reprendre »**.

✅ « Dossier activé. », statut « Actif ». Étape 2 : `No` refusé avec « Le motif doit comporter au moins 5 caractères. » ; ensuite « Dossier suspendu. », statut « Suspendu », ligne « Motif de suspension ». Étape 3 : « Dossier repris. » (sans confirmation), statut « Actif ». L'historique ajoute chaque changement de statut. Le dossier doit être « Actif » pour la suite.

⚠️ *Écart connu* : la confirmation d'activation annonce l'ouverture du suivi de la créance, mais l'activation ne crée ni facture scindée ni échéance (E-19c-2).

🔒 *Test de droit* : le **secrétariat** et l'**économe** n'ont pas le bouton « Activer ».

☐ OK ☐ KO

---

## Étape 215 — Rapprocher l'acte avec la facturation
👤 **économe** (secondaire-test) · fenêtre **A** · 📂 Menu **« Affectés de l'État »** > **« Rapprochement des affectations »** (`/v2/stateassign/reconciliation`)

Compte : `econome@secondaire-test.test` (MFA).

1. Lire « L'écart est facturé moins déclaré. Le statut Conforme ou Écart est calculé avec la tolérance de l'établissement (zéro par défaut) : il ne se saisit pas. » et les trois compteurs (« Jamais rapproché », « Conforme », « Écart »).
2. Sur la ligne de `AFF-DEMO-0001`, cliquer sur **« Rapprocher »**.
3. Afficher « Jamais rapproché », repérer `AFF-TG-0001` et cliquer sur **« Rapprocher »**.
4. Ouvrir la fiche de `AFF-TG-0001` et cliquer sur **« Rapprocher avec la facturation »**.

✅ Étape 2 : « Dossier AFF-DEMO-0001 rapproché. » ; écart attendu de 25 000 F CFA côté famille (écart État 0) *(à vérifier)*. Étape 3 : `AFF-TG-0001` n'a ni facture scindée ni facture de scolarité : part de l'État facturée à 0, écart de − 120 000 F CFA, statut « Écart » *(valeurs à relever)*. Étape 4 : « Rapprochement fait : un écart subsiste entre l'acte et la facturation. ». Rapprocher deux fois donne le même état. « Contrôles à faire et anomalies » : « Aucun contrôle à faire. » tant qu'aucun contrôle n'est planifié.

⚠️ *Écart connu* : l'écart famille de 25 000 F CFA sur `AFF-DEMO-0001` vient des frais d'inscription inclus dans le montant rapproché (donnée de démonstration non cohérente avec l'acte, E-19c-4).

🔒 *Test de droit* : en tant qu'**économe**, taper `/v2/stateassign/verification` ou `/v2/stateassign/settings` → « Accès refusé ».

☐ OK ☐ KO

---

## Étape 216 — Planifier la créance sur l'État
👤 **économe** (secondaire-test) · fenêtre **A** · 📂 fiche de `AFF-TG-0001` > « Créances sur l'État »

1. Lire « Aucune échéance planifiée. » et « Planifiez les versements attendus de l'État. Leur total ne peut pas dépasser la part de l'État déclarée. ».
2. Cliquer sur **« Planifier une échéance »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Libellé | `Versement test guide 1` |
| Date d'échéance | `07/11/2026` (J+30) |
| Montant attendu | `70 000` |

   Cliquer sur **« Planifier »**.
3. Planifier une seconde échéance : `Versement test guide 2`, `07/12/2026` (J+60), `50 000`.
4. Tenter une troisième : `Versement test guide 3`, `06/01/2027` (J+90), `10 000`.

✅ Étape 2 : la ligne "1. Versement test guide 1", 70 000 F CFA attendus, 0 reçu, « À recevoir » ; résumé « Attendu » 70 000 F CFA, « Reste à recevoir » 70 000 F CFA, « Non planifié » 50 000 F CFA. Étape 3 : attendu 120 000 F CFA. Étape 4 : refus du serveur (message commençant par "les échéances" et mentionnant le montant déclaré à la charge de l'État) : le total ne peut pas dépasser 120 000 F CFA.

⚠️ *Test d'erreur* : libellé vide → « Le libellé est obligatoire. » ; montant `0` ou `1,5` → « Saisissez un nombre entier de francs, supérieur à zéro. » ; date vide → « Date invalide (AAAA-MM-JJ). »

🔒 *Test de droit* : le **secrétariat** n'a aucun bouton « Planifier une échéance ».

☐ OK ☐ KO

---

## Étape 217 — Suivre les créances de l'établissement
👤 **économe** (secondaire-test) · fenêtre **A** · 📂 Menu **« Affectés de l'État »** > **« Créances sur l'État »** (`/v2/stateassign/receivables`)

1. Lire **« Ancienneté des créances »** (« Attendu », « Reçu », « Reste à recevoir », « En retard ») et le tableau « Reste à recevoir par tranche de retard » (« Non échu », « 1 à 30 jours de retard », … « Plus de 90 jours de retard »).
2. Lire le tableau « Échéances des créances sur l'État » ; cocher « Seulement les échéances en retard ».

✅ Toutes les échéances sont listées : celle de la graine (« Versement unique de l'État (démonstration) », 120 000 F CFA attendus, 0 reçu, « À recevoir ») et les deux échéances test guide ; « Attendu » est leur somme ; « En retard » vaut 0. Le filtre "en retard" donne « Aucune échéance ne correspond. » et « Les échéances se planifient sur la fiche de chaque dossier. ».

⚠️ *Écart connu* : le **versement de l'État** se saisit comme un paiement d'un financeur dans le module Finance ; le champ « Référence du financeur » attend l'identifiant de la prise en charge (visible dans le bandeau de la facture du financeur), **pas** la référence `AFF-DEMO-0001` (E-19c-1). Le passage de l'échéance à « Partiellement reçu » ou « Reçu » est à vérifier avec la phase Finance. Le reversement des fonds partagés n'est pas modélisé.

☐ OK ☐ KO

---

## Étape 218 — Planifier et réaliser des contrôles
👤 **économe** (secondaire-test) · fenêtre **A** · 📂 fiche de `AFF-TG-0001` > « Contrôles »

1. Lire « Aucun contrôle. » et « Aucun contrôle n'est exigé par défaut : l'établissement choisit les natures et le rythme dans ses paramètres. ».
2. Cliquer sur **« Planifier un contrôle »** : Nature du contrôle = `Identité`, Date d'échéance = `23/10/2026`, **« Planifier »**. Puis **« Réaliser »** : Résultat = `Conforme`, **« Consigner le résultat »**.
3. Planifier `Pièces` (`23/10/2026`) ; **« Réaliser »** : Résultat = `Anomalie`, Constat vide puis `No` (refus), puis `Constat test guide : pièce illisible`, **« Consigner le résultat »**.
4. Sur l'anomalie, cliquer sur **« Résoudre »**, saisir `Résolution test guide : pièce fournie` et valider par **« Résoudre l'anomalie »**.

✅ Le contrôle apparaît « À faire », puis « Conforme ». Constat vide ou trop court refusé avec « Un constat de 5 caractères minimum est requis pour une anomalie. » ; ensuite statut « Anomalie » avec le constat, puis « Résolution : … ». Un contrôle n'est jamais réalisé automatiquement : l'application planifie, une personne réalise.

⚠️ *Test d'erreur* : planifier de nouveau « Identité » avec la même date → "Ce contrôle existe déjà pour cette nature et cette période." ; « Présence » sans période → « Choisissez la période à contrôler. »

☐ OK ☐ KO

---

## Étape 219 — Avenant : une nouvelle version à faire vérifier
👤 **directeur** (secondaire-test) · fenêtre **A** · 📂 fiche de `AFF-TG-0001` > **« Amender »**

1. Cliquer sur **« Amender »** (fenêtre « Avenant : version 2 »). Valider sans rien saisir (refus).
2. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Motif de l'avenant | `Avenant test guide : part de la famille corrigée` |
| Date d'effet | `08/10/2026` (J) |
| Nouvelle référence | *(vide)* |
| Part de la famille (nouveau montant déclaré) | `85 000` |

3. Cliquer sur **« Créer l'avenant »**, lire **« Versions et historique »**.
4. Sur la version 2, essayer **« Vérifier le dossier »** avec le directeur.

✅ Formulaire vide refusé avec « Un motif de 5 caractères minimum est requis. » et « Date invalide (AAAA-MM-JJ). » ; ensuite « Avenant créé : la nouvelle version attend sa vérification. ». La fiche s'ouvre en version 2 « Enregistré » ; la version 1 est « Remplacé ». Étape 4 : "La vérification doit venir d'une autre personne que celle qui a enregistré le dossier." (l'amendeur est l'enregistrant de la version 2).

⚠️ *Test d'erreur* : part de la famille `85,5` → « Saisissez un nombre entier de francs (sans décimale ni signe). » ; avenant sans aucun changement → "L'avenant ne change ni la référence, ni l'autorité, ni la date, ni les montants."

🔒 *Test de droit* : le **secrétariat** n'a pas le bouton « Amender ».

☐ OK ☐ KO

---

## Étape 220 — Le propriétaire vérifie l'avenant, le directeur l'active
👤 **propriétaire** (secondaire-test) · fenêtre **A** · 📂 `/v2/stateassign/verification`

Compte : `direction.generale@secondaire-test.test` (MFA), deuxième personne de direction.

1. Ouvrir **« Vérification des affectations »**, cliquer sur **« Examiner »** pour la version 2 de `AFF-TG-0001`, **« Vérifier le dossier »**, **« Vérifier »**.
2. Se connecter en **directeur**, ouvrir la fiche de `AFF-TG-0001` (version 2) et cliquer sur **« Activer »**, puis **« Activer le dossier »**.

✅ « Dossier vérifié : la référence d'affectation est portée sur l'inscription. » puis « Dossier activé. », la version 2 est « Actif » (part de la famille 85 000 F CFA). Quatre yeux respecté : deux personnes de direction différentes.

☐ OK ☐ KO

---

## Étape 221 — Lire les états et exporter en CSV
👤 **économe** (secondaire-test) · fenêtre **A** · 📂 Menu **« Affectés de l'État »** > **« États des affectations »** (`/v2/stateassign/reports`)

1. Lire « Situation au … », « Dossiers par statut », « Total déclaré — État », « Total déclaré — familles », « Créances sur l'État » (« Attendu », « Reçu », « Reste à recevoir », « En retard »), « Suivi » (« Contrôles à faire », « Contrôles en retard », « Anomalies », « Jamais rapproché », « Conforme », « Écart »).
2. Section « Exports » : « Jeu de données » = « Dossiers d'affectation », « Format » = « Format neutre (toutes les colonnes) », cliquer sur **« Télécharger le CSV »**. Recommencer avec « Créances sur l'État » puis « Contrôles ».
3. Lire la section « Passerelle vers la plateforme publique ».

✅ Compteurs cohérents avec la base *(relever les valeurs)*. « Fichier téléchargé : N ligne(s). » (N ≥ 1) et un fichier `.csv` à ouvrir dans un tableur, montants en entiers de francs. Étape 3 : « Aucune passerelle n'est configurée : la saisie et l'import sont manuels, aucun échange externe n'a lieu. ».

🔒 *Test de droit* : se connecter en **secrétariat** et ouvrir la même page : les états sont lisibles mais la section « Exports » est absente.

☐ OK ☐ KO

---

## Étape 222 — La famille ne voit aucun dossier qui ne la concerne pas
👤 **parent** (secondaire-test) · fenêtre **B** · 📂 Menu du portail parent **« Affectation de mon enfant »** (`/v2/stateassign/family`)

Compte : `parent@secondaire-test.test` (DIABATE Séka, sans MFA).

1. Lire « Le statut du dossier d'affectation par l'État de chacun de vos enfants. » et la liste « Enfants ».

✅ Deux blocs, "DIABATE Nadia" et "DIABATE Salimata", chacun avec « Aucun dossier d'affectation pour cet enfant. ». Le parent ne voit ni le dossier d'ADOU Aïcha ni ceux de N'GUESSAN Aya et Koffi.

🔒 *Test de droit* : en tant que **parent**, taper `/v2/stateassign`, `/v2/stateassign/receivables`, `/v2/stateassign/reports` puis `/v2/stateassign/settings` → « Accès refusé » (chacune).

☐ OK ☐ KO

---

## Étape 223 — Variante facultative : la famille voit le statut, jamais les montants
👤 **secrétariat** (secondaire-test) · fenêtre **A** · 📂 `/v2/stateassign`, puis **directeur** (vérification), puis **parent**

**À réserver à une base dédiée : cette variante change le financement d'une inscription du compte parent de démonstration (impact sur les phases Finance et Portails). Sinon, noter l'étape "non exécutée".**

1. Secrétariat : **« Enregistrer un dossier »** pour **DIABATE Salimata** : référence `AFF-TG-0003`, part de l'État `120 000`, part de la famille `80 000`.
2. Directeur : sur `/v2/stateassign/verification`, **« Examiner »**, **« Vérifier le dossier »**, **« Vérifier »**.
3. Parent : rouvrir **« Affectation de mon enfant »**, enfant Salimata.

✅ Avant la vérification : « Le dossier est en attente de vérification par l'établissement. ». Après : le bloc de Salimata affiche le « Statut » (« Vérifié »), la « Référence » et la « Date de l'acte », et « Le dossier a été vérifié par l'établissement. ». **Aucun montant** (ni part de l'État, ni part de la famille, ni écart, ni échéance, ni contrôle) n'est visible.

☐ OK ☐ KO

---

## Étape 224 — ⚠️ Irréversible : terminer le dossier AFF-TG-0001
👤 **directeur** (secondaire-test) · fenêtre **A** · 📂 fiche de `AFF-TG-0001` (version 2)

**La fin d'un dossier ne se défait pas.**

1. Cliquer sur **« Terminer »** (« La fin d'un dossier est datée et motivée ; elle ne se défait pas. »). Valider sans rien saisir (refus), puis `No` comme motif avec une date (refus), puis la date `08/10/2026` et `Fin test guide : essai terminé`.

✅ Champs vides : « Date invalide (AAAA-MM-JJ). » et « Un motif de 5 caractères minimum est requis. » ; `No` refusé avec « Le motif doit comporter au moins 5 caractères. » ; ensuite « Dossier terminé. », statut « Terminé », « Date de fin » et « Motif de fin » affichés ; plus aucun acte possible, sauf « Rapprocher avec la facturation ».

🔒 *Test de droit* : l'**économe** n'a aucun bouton « Terminer ».

📚 *Pour aller plus loin* : chapitre 19c, scénarios 19.55 (fiche de démonstration), 19.62 (modifier ou annuler une échéance), 19.63 (versement de l'État), 19.65 (pièces), 19.67 (transfert), 19.69 (paramètres et formats d'export), 19.71 et 19.72 (droits, qualité).

☐ OK ☐ KO

---

**Ce que la phase laisse dans l'application :**
- Dossier `AFF-TG-0001` (N'GUESSAN Aya) : version 1 « Remplacé », version 2 « Terminé » ; inscription passée en financement « Affecté par l'État ». Échéances "Versement test guide 1" (70 000 F CFA) et "Versement test guide 2" (50 000 F CFA) ; contrôles Identité (conforme) et Pièces (anomalie résolue).
- Dossier `AFF-TG-0002` (N'GUESSAN Koffi) : deux enregistrements, tous deux « Rejeté ».
- `AFF-DEMO-0001` (ADOU Aïcha) rapproché, toujours « Vérifié » (non activé).
- Variante (si exécutée) : dossier `AFF-TG-0003` (DIABATE Salimata) « Vérifié ».

---

[⬅ Sommaire](../GUIDE_TEST_UTILISATEUR_COMPLET.md) · [← Précédent](11-conseil-de-classe.md) · [Suivant →](13a-examens.md)
