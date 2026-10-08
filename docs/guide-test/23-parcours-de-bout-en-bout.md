# Chapitre 23. Parcours de bout en bout

Ce chapitre **enchaîne** les scénarios des chapitres 01 à 22 et 24 en dix parcours qui suivent la vie réelle d'une école. Il ne répète pas les formulaires : chaque étape renvoie au scénario détaillé (champs, valeurs à saisir, cas invalides) du chapitre concerné. Ici on vérifie surtout que **la donnée créée à une étape est bien reprise à la suivante**, avec le bon compte et dans le bon ordre.

> Aucune de ces étapes n'a été jouée dans le navigateur au moment de la rédaction : les attendus viennent des chapitres de référence, eux-mêmes tirés du code, de `fr-CI.json` et du seed. Tout attendu marqué "à vérifier en test" dans un chapitre le reste ici.

## Règles du chapitre

- Les comptes sont ceux de l'[annexe des données de départ](annexe-donnees-de-depart.md) (clic dans le panneau de `/v2/login`, code MFA pré-rempli). Aucun mot de passe ni code MFA n'est écrit dans ce guide.
- **Ordre recommandé de réalisation** : A, D, E en parallèle (trois établissements indépendants), puis F, G, H, B, C, I, J. Les parcours qui modifient durablement des données (clôture, publication, révocation, versement) sont à jouer **une seule fois** et **en dernier** dans leur établissement.
- Une case `[ ]` par étape. Une étape est validée quand le "Résultat attendu" du scénario cité est observé.
- Quand un scénario renvoie à un autre chapitre, la valeur de l'objet créé (nom "… test guide", code `TG-…`) est celle de ce chapitre : ne pas la renommer.
- **Capacité de la 6e A** : les imports du chapitre 05 ajoutent 23 élèves aux 12 de la graine (35 sur 40 places) ; ne pas exécuter l'import de démonstration de 15 lignes en plus.
- Les jeux de règles de calcul sont des règles de **démonstration** : aucune conclusion réglementaire.

---

## Parcours A. Rentrée d'un élève du secondaire : de l'admission au bulletin et au paiement

**Établissement** : Collège Le Baobab (`secondaire-test`). **Fil rouge** : le dossier "Awa COULIBALY test guide" (admission → inscription → paiement) et, pour la partie notes/bulletin, l'élève de la graine DIABATE Nadia (la nouvelle élève n'a pas de notes en cours d'année : on suit donc Nadia pour les notes et le bulletin).

| # | Compte | Étape | Scénario | Résultat attendu à reprendre |
|---|---|---|---|---|
| A1 | Directeur des études ou chargé d'admissions | Ouvrir la campagne `TG-2027` | 17.5 | Campagne ouverte, capacités fixées |
| A2 | Secrétariat ou chargé d'admissions | Saisir la candidature "Awa COULIBALY test guide" (+ consentement, pièces) | 17.10, 17.12, 17.13 | Dossier « Candidature reçue » avec pièces |
| A3 | Chargé d'admissions | Planifier l'entretien, passer à l'étude | 17.14, 17.15 | Dossier à l'étude |
| A4 | Directeur | Décider « Admis » (la décision n'appartient pas au chargé) | 17.16, 17.27 | Dossier « Admis » |
| A5 | Chargé d'admissions | Émettre l'offre ; la famille répond sur le portail public | 17.17, 17.18 | Lien de réponse valide ; dossier accepté |
| A6 | Économe | Encaisser les frais d'inscription (25 000 F CFA) : référence `VIR-TG-AWA-001` | 17.19, 12.34 | Dossier « Inscrit » ; inscription confirmée par le paiement |
| A7 | Secrétariat | Vérifier la fiche élève créée, rattacher les pièces | 17.24, 4.6, 4.10 | Élève `COULIBALY TEST GUIDE Awa` avec son tuteur |
| A8 | Directeur des études | Lire l'emploi du temps de la 6e A, créer les séances "test guide" | 7.1, 7.7 | Séances du jour visibles |
| A9 | Enseignant (`enseignant@`) | Faire l'appel d'une séance et le soumettre | 6.2 | Appel soumis |
| A10 | Éducateur | Valider l'appel | 6.5 | Appel validé |
| A11 | Enseignant | Créer l'évaluation "Devoir n°1 Mathématiques test guide", saisir et soumettre | 8.5, 8.7, 8.9 | Feuille soumise |
| A12 | Responsable pédagogique | Relire et approuver | 8.10, 8.12 | Feuille approuvée |
| A13 | Directeur des études | Publier les notes (irréversible), puis lire la matrice | 8.13, 9.8 | Notes publiées ; moyennes de la matrice cohérentes |
| A14 | Directeur des études | Expliquer une moyenne, calculer, délibérer et clôturer le trimestre | 9.9, 9.11, 9.15 | Résultats figés |
| A15 | Directeur des études | Vérifier le modèle et les signataires, émettre et publier les bulletins | 10.1–10.4 | Bulletins publiés avec code de vérification |
| A16 | Parent (`parent@`) | Lire résultats et bulletin de Nadia, vérifier l'authenticité par le code | 21.4, 21.5, 10.6 | Bulletin et code concordants |
| A17 | Parent | Payer en ligne (Salimata, reste à payer) : 5 000 puis 5 001 puis 5 013 | 21.9, 12.23 | Réussite, attente, échec |
| A18 | Économe | Constater les paiements et le reçu ; imprimer | 12.20, 12.21 | Reçus `REC-…` immuables |

- [ ] A1–A7 admission → inscription  - [ ] A8–A10 emploi du temps → appel  - [ ] A11–A15 notes → bulletin  - [ ] A16–A18 famille → paiement

**Points de contrôle** : (1) la facture des frais d'inscription n'est créée qu'à l'inscription ; (2) la décision d'admission est refusée au chargé d'admissions (adresse/bouton) ; (3) un élève ne voit pas la note tant qu'elle n'est pas publiée (21.33) ; (4) le parent ne voit que Nadia et Salimata.

---

## Parcours B. Incident de vie scolaire jusqu'à l'information de la famille

**Établissement** : Collège Le Baobab. **Élèves de test** : COULIBALY Moussa, TOURE Jean-Marc, DIABATE Salimata (voir chapitre 19a).

| # | Compte | Étape | Scénario | Résultat attendu |
|---|---|---|---|---|
| B1 | Enseignant | Saisie rapide d'un incident | 19.5 | Note créée, visible du personnel |
| B2 | Éducateur | Encouragement partageable et observation réservée au personnel | 19.6 | Encouragement visible de l'élève et des parents |
| B3 | Éducateur | Proposer une exclusion (il ne la valide pas) | 19.8 | Mesure "proposée" |
| B4 | Directeur (MFA) | Valider une mesure, en rejeter une autre | 19.10 | Mesure validée / rejetée |
| B5 | Directeur | Tenter de valider sa propre proposition | 19.11 | Refus (quatre yeux) |
| B6 | Directeur | Notifier la famille | 19.12 | État "notifiée", envoi simulé |
| B7 | Parent, élève | Constater : rien avant la notification, la décision après | 19.13, 19.22 | Décision visible |
| B8 | Parent | Recours ; la direction décide | 19.14 | Recours instruit |
| B9 | Directeur | Convocation : créer, envoyer, accuser, entretien | 19.15 | Convocation suivie |
| B10 | Parent | Lire l'annonce / le message reçu | 15.12, 15.4 | Accusé de réception possible |

- [ ] Cas nominal  - [ ] Quatre yeux (B5)  - [ ] Famille informée (B7)

---

## Parcours C. Conseil de classe et procès-verbal

**Établissement** : Collège Le Baobab, séance de démonstration du Trimestre 2 (les séances du Trimestre 1 ne sont pas ouvrables : période clôturée).

| # | Compte | Étape | Scénario | Résultat attendu |
|---|---|---|---|---|
| C1 | Directeur des études | Calendrier, synthèse de la classe | 19.25, 19.26 | Séances listées |
| C2 | Directeur des études | Planifier, composer, convoquer | 19.28–19.30 | Séance "planifiée" |
| C3 | Directeur des études | Ouvrir la séance (refus sans président, puis refus période clôturée) | 19.31 | Messages de refus attendus |
| C4 | Enseignant, direction des études | Propositions et décisions humaines | 19.34–19.36 | Décisions enregistrées |
| C5 | Direction des études | Clore la séance | 19.38 | Séance close |
| C6 | Direction | Générer le procès-verbal et le PDF | 19.39 | PV généré |
| C7 | Direction | Signatures (refus attendu avec les comptes de démonstration) | 19.40 | Écart connu : signature impossible |
| C8 | Direction | Déverrouillage motivé (quatre yeux) | 19.42 | Séance rouverte après approbation |
| C9 | Parent, élève | Voir décisions et orientation | 19.50, 19.51 | Décisions visibles |

- [ ] Cas nominal  - [ ] Signature (limite connue)  - [ ] Famille

---

## Parcours D. Primaire : compétences, conseil des maîtres, bilan annuel

**Établissement** : École Les Palmiers (`primaire-test`). Comptes : instituteur CP1 A (`enseignant@`), instituteur de maternelle, directeur (MFA), directeur des études (MFA), parent, élève.

| # | Compte | Étape | Scénario | Résultat attendu |
|---|---|---|---|---|
| D1 | Chargé d'admissions | Variante primaire de l'admission | 17.28 | Frais d'inscription de 15 000 F CFA |
| D2 | Instituteur | Appel matin et après-midi du CP1 A | 6.9, 18.4 | Journée complète exigée |
| D3 | Instituteur de maternelle | Lire la grille de compétences sans note | 18.5 | Pas de notes en maternelle |
| D4 | Instituteur | Saisir les compétences du CP1 A (brouillon), notes | 18.6, 8.17 | Saisies enregistrées |
| D5 | Instituteur | Marquer la classe "prête" pour la période | 18.7 | État "prête" |
| D6 | Direction des études | Valider la grille, réviser (période déverrouillée seulement) | 18.8 | Révision refusée sur période verrouillée |
| D7 | Direction | Conseil des maîtres : préparer, proposer, décider, PV | 18.10–18.12 | Décisions et PV (résultats calculés requis : à vérifier) |
| D8 | Direction | Préparer les bilans annuels, sceller (irréversible), réémettre | 18.13, 18.14 | Bilan scellé |
| D9 | Direction | États et export CSV | 18.16 | CSV de démonstration |
| D10 | Parent, élève | Bulletin et compétences | 18.18 | Visibles après publication |

- [ ] Cas nominal  - [ ] Scellement (en dernier)  - [ ] Famille

Note : l'archive d'année ne devient pas « Prête à geler » en démonstration (18.15) : ne pas forcer.

---

## Parcours E. Supérieur : UE/ECUE, relevé, rattrapage, diplôme

**Établissement** : Université Horizon (`superieur-test`). Comptes : enseignant, responsable pédagogique (MFA), directeur des études (MFA), directeur (MFA), étudiant (`eleve@`), parent.

| # | Compte | Étape | Scénario | Résultat attendu |
|---|---|---|---|---|
| E1 | Direction des études | Lire la structure UE/ECUE, crédits | 11.1, 3.8 | Deux UE de deux ECUE |
| E2 | Enseignant, responsable pédagogique, direction des études | Notes : saisir, relire, publier | 8.17, 8.12, 8.13 | Notes publiées |
| E3 | Direction des études | Un semestre est validé si TOUTES les UE le sont | 9.17, 11.2 | Semestre validé ou non selon les UE |
| E4 | Direction des études | Relevé de notes à crédits | 10.13 | Relevé généré |
| E5 | Direction des études | Rattrapage : fenêtre, candidats, la note de session 2 REMPLACE celle de la session 1 | 9.18, 11.7 | Note remplacée (décision métier du 2026-10-01) |
| E6 | Direction | Crédits, dettes, prérequis, dispense | 11.3–11.5 | Éligibilité cohérente |
| E7 | Direction | Créer le diplôme `TG-LIC-INFO`, octroyer à DIABATE Nadia | 11.8, 11.9 | Octroi |
| E8 | Direction | Émettre diplôme, attestation ; vérification publique | 11.12–11.15 | Code vérifié |
| E9 | Étudiant, parent | « Mes documents » | 11.16 | Documents publiés visibles |
| E10 | Direction | Révoquer un diplôme (acte terminal, en dernier) | 11.17 | Diplôme révoqué |

- [ ] Cas nominal  - [ ] Rattrapage remplace  - [ ] Révocation (en dernier)

Écart à garder en tête : le sélecteur « Nœud du curriculum » de la création de diplôme peut échouer (signalé au chapitre 11, écart "Bloquant probable") : si E7 échoue, consigner l'anomalie au lieu de contourner.

---

## Parcours F. Facturation → paiement → reçu → remboursement (quatre yeux)

**Établissement** : Collège Le Baobab (variantes dans les deux autres : 12.40). Comptes : économe (MFA), directeur (MFA), parent, élève.

| # | Compte | Étape | Scénario | Résultat attendu |
|---|---|---|---|---|
| F1 | Économe | Frais, barème, plan, remises | 12.2–12.5 | `TG-DIVERS`, `TG-3T`, `TG-REM10` |
| F2 | Économe | Émettre la facture n°1 test guide (DIABATE Nadia) | 12.7 | 54 000 F CFA en 3 tranches de 18 000 |
| F3 | Économe | Ouvrir la caisse ; virement partiel ; espèces | 12.11–12.13 | Paiements n°1 et n°2 |
| F4 | Économe | Acompte mobile money puis imputation | 12.14 | Acompte imputé |
| F5 | Économe | Paiement en ligne simulé : réussite, attente, échec | 12.16 | Statuts conformes aux fins `001` / `013` |
| F6 | Parent, élève | Paiement en ligne depuis le portail | 12.23, 12.24 | Mêmes comportements |
| F7 | Économe | Reçus : liste, fiche, PDF, vérification publique | 12.21, 12.33 | Reçus `REC-…` |
| F8 | Économe | Avoir de 3 000 F CFA ; refus d'annuler une facture encaissée | 12.25 | Avoir créé |
| F9 | Économe puis directeur | Remboursement : le demandeur n'approuve pas, le directeur approuve | 12.28 | Auto-approbation refusée |
| F10 | Directeur | Résoudre manuellement un paiement bloqué | 12.27 | Résolution tracée |
| F11 | Économe | Clôture de caisse | 12.29 | Clôture avec observation si écart |
| F12 | Économe, directeur | Rapports et écarts attendus | 12.35 | Facturé +139 000, Avoirs +3 000, Encaissé +107 001, Restant dû +28 999 (calcul sur la chaîne du chapitre 12) |

- [ ] Cas nominal  - [ ] Quatre yeux (F9)  - [ ] Cohérence tableaux de bord (16.10, 16.11, 16.16)

---

## Parcours G. Paie d'un enseignant

**Établissement** : Collège Le Baobab. Enseignant : TRAORE Kouadio (`enseignant@`). Comptes : directeur (MFA), économe (MFA), propriétaire (MFA).

| # | Compte | Étape | Scénario | Résultat attendu |
|---|---|---|---|---|
| G1 | Directeur des études ou direction | Réglages et configuration de paie | 13.2, 13.3 | Configuration « Mixte » de TRAORE Kouadio |
| G2 | Direction | Tarifs horaires, simulateur | 13.4 | Tarif résolu |
| G3 | Direction | Créer la période "Septembre test guide", aperçu puis calcul | 13.5, 13.6 | Bulletin calculé |
| G4 | Direction | Primes et retenues | 13.7 | Montant recalculé |
| G5 | Économe | Constater qu'il ne peut ni arrêter ni annuler | 13.8 | Refus |
| G6 | Directeur | Arrêter le montant ; refus s'il a lui-même calculé | 13.9, 13.14 | Quatre yeux |
| G7 | Enseignant | Lire ses bulletins (avant/après l'arrêt) | 13.10, 13.20, 21.27 | Bulletin visible après arrêt |
| G8 | Économe | Verser (référence `VIR-TG-001`) | 13.11 | Bulletin versé et verrouillé |
| G9 | Enseignant | Contestation, décision de la direction | 13.15 | Bulletin contesté puis re-arrêté |
| G10 | Propriétaire | Masse salariale (MFA, lecture auditée) | 13.17, 16.12 | Chiffres cohérents |

- [ ] Cas nominal  - [ ] Quatre yeux (G5, G6)  - [ ] Bulletin visible par le salarié (G7)

Les heures de cours ne viennent que d'un pointage réel Arrivée/Départ (13.13) : le bulletin d'octobre du chapitre 13 chiffre ce cas.

---

## Parcours H. Élève affecté par l'État

**Établissement** : Collège Le Baobab. Dossiers `AFF-TG-0001` (N'GUESSAN Aya), `AFF-TG-0002` (N'GUESSAN Koffi, rejeté). Comptes : secrétariat, directeur (MFA), économe, parent.

| # | Compte | Étape | Scénario | Résultat attendu |
|---|---|---|---|---|
| H1 | Secrétariat | Enregistrer le dossier d'affectation | 19.56 | Dossier `AFF-TG-0001` |
| H2 | Secrétariat | Corriger avant vérification | 19.57 | Dossier corrigé |
| H3 | Secrétariat, directeur | Rejet (`AFF-TG-0002`) et quatre yeux | 19.58 | Enregistreur ≠ vérificateur |
| H4 | Directeur | Vérifier le dossier | 19.59 | Dossier vérifié |
| H5 | Directeur | Activer ; suspendre ; reprendre | 19.60 | Inscription en financement « Affecté par l'État » |
| H6 | Économe | Rapprochement, créance sur l'État | 19.61–19.63 | Écart attendu sur `AFF-DEMO-0001` (frais d'inscription inclus) |
| H7 | Parent | Vue famille : statut, jamais les montants | 19.70 | Pas de montants |
| H8 | Directeur | Terminer le dossier (en dernier) | 19.67 | Dossier « Terminé » |

Limite connue : le reversement des fonds partagés n'est pas modélisé et il n'existe aucune passerelle réelle de l'État.

- [ ] Cas nominal  - [ ] Quatre yeux (H3)  - [ ] Famille sans montants

---

## Parcours I. Examens : session, candidats, centres, notes, résultats, documents

**Établissement** : Collège Le Baobab (cycle complet) ; École Les Palmiers (CEPE de démonstration). Compte : responsable des examens (`examens@`), directeur (MFA), directeur des études (MFA), parent, élève.

| # | Compte | Étape | Scénario | Résultat attendu |
|---|---|---|---|---|
| I1 | Responsable des examens | Type « BEPC test guide (démonstration) », filière, épreuves | 20.3, 20.4 | Type `TG_BEPC` |
| I2 | Responsable des examens | Centre `TG-CTR1`, salles | 20.6 | Capacité 7 places |
| I3 | Responsable des examens | Sessions `TG-BEPC-2027` et `TG-BLANC-2027` | 20.7, 20.8 | Inscriptions ouvertes |
| I4 | Responsable des examens | Candidats de la classe, éligibilité, candidat libre, import CSV | 20.9–20.12 | Candidats `TG_BEPC2027-0000n` |
| I5 | Direction | Dérogation d'éligibilité (écart "inatteignable pour le directeur des études") | 20.14 | Candidat accepté sur dérogation |
| I6 | Responsable des examens | Centres, répartition, clôture des inscriptions, convocations | 20.15–20.17 | Convocations émises |
| I7 | Parent, élève | Vue famille avant résultats | 20.18 | Convocation visible |
| I8 | Responsable des examens | Épreuves en cours ; notes ; résultats de l'autorité | 20.19–20.21 | Résultats saisis |
| I9 | Responsable des examens, direction | Corrections (quatre yeux) | 20.22–20.24 | Demandeur ≠ approbateur |
| I10 | Direction | Statistiques, publication, attestations | 20.25–20.27 | Résultats publiés ; documents émis |
| I11 | Parent, élève | Vue famille après publication | 20.28 | Résultat visible |
| I12 | Responsable des examens | Archiver la session | 20.29 | Session « Archivée » |
| I13 | Responsable des examens (primaire) | Type CEPE, centre, session, candidats libres, import des résultats, exports, publication | 20.35–20.41 | Session `TG-CEPE-2027` |

- [ ] Cas nominal collège  - [ ] CEPE de démonstration  - [ ] Bandeau « règles de démonstration » présent sur les documents

---

## Parcours J. Abonnement, rôles et audit (propriétaire et plateforme)

| # | Compte | Étape | Scénario | Résultat attendu |
|---|---|---|---|---|
| J1 | Opérateur de la plateforme | Connexion à la console, liste des organisations | 1.1–1.3 | Console séparée de `/login` |
| J2 | Opérateur | Créer l'organisation jetable `tg-jetable`, statut, abonnement, dérogations | 1.4, 1.7–1.9 | Organisation et abonnement créés |
| J3 | Opérateur | Plans et journal de plateforme | 1.10, 1.11 | Plans listés ; actes tracés |
| J4 | Propriétaire (MFA) | Profil, établissements, abonnement et usage | 1.13, 1.14, 1.16 | Modules selon l'offre |
| J5 | Propriétaire | Rôles : lire, cloner, créer `tg_secretariat` | 1.17, 1.18 | Rôle personnalisé créé |
| J6 | Propriétaire | Attribuer un rôle | 1.19 | Attribution tracée |
| J7 | Utilisateur concerné | Constater le changement de droits | 24.35 | Garde-fous anti-escalade |
| J8 | Propriétaire | Journal d'audit : filtrer, vérifier la chaîne, exporter | 1.23, 24.48–24.51 | Entrées pour les actes des étapes précédentes |
| J9 | Propriétaire | Droits selon l'abonnement, dernier propriétaire (organisation B, facultatif) | 1.20–1.22 | Limites respectées |
| J10 | Propriétaire | Sessions et MFA | 2.10, 2.12, 24.36–24.41 | Sessions révoquées |

- [ ] Console plateforme  - [ ] Rôle personnalisé  - [ ] Audit complet

---

## Données créées

Ce chapitre ne crée aucun enregistrement propre : il réutilise ceux des chapitres cités. L'index complet se trouve dans [`jeux-de-donnees/annexe-donnees.md`](jeux-de-donnees/annexe-donnees.md).

## Écarts constatés

Les écarts rencontrés à chaque étape sont ceux consignés dans les chapitres de référence. Écarts susceptibles de **bloquer un parcours** :

| Parcours | Étape | Écart | Gravité |
|---|---|---|---|
| E | E7 | Création de diplôme : sélecteur « Nœud du curriculum » incompatible avec l'API (chapitre 11) | Bloquant probable |
| C | C7 | Procès-verbal non signable avec les comptes de démonstration (chapitre 19b) | Majeur |
| I | I5 | Bouton de dérogation inatteignable pour le directeur des études (chapitre 20) | Majeur (à confirmer) |
| A | A4/A5 | Formulaire public de candidature non ouvrable depuis l'interface (chapitre 17) | Majeur |
| B/J | — | Aucun courrier réel : invitations et réinitialisations inatteignables (chapitre 02) | Majeur |

## À vérifier en test

- Classe d'accueil de la nouvelle élève Awa (choix fait à l'offre, 17.17) et nombre exact d'élèves de la 6e A après les imports.
- Valeurs calculées des moyennes (chapitre 09) et statut « Prête à geler » des archives primaires.
- Tout attendu marqué "à vérifier en test" dans les chapitres de référence.

## Non couvert / limites connues

Paiement réel, envois réels (e-mail, SMS, WhatsApp), passerelle de l'État, reversement des fonds partagés, OCR des PDF, appels hors ligne avec conflits réels : voir les sections "Non couvert" des chapitres concernés.
