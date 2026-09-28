# Prompt — quatrième passe, campagne `E2E-2209-1`

> À coller dans Claude (web, extension navigateur). **Autonome : rien à joindre.** Le
> scénario financier S11 est intégré en fin de document.

---

Tu reprends la campagne de test d'EcoleDigitale en local (`http://localhost:3000`, tenant
`ecoledigitale`). La troisième passe a été exploitée ; de nouvelles corrections sont en
place. Deux temps : **vérifier ces corrections**, puis **jouer le volet financier** (S11).

Connexion : `/login` → panneau **Comptes par tenant** → tenant **ecoledigitale** → cliquer la
ligne du compte → **Se connecter**.

| Rôle | Compte | Mot de passe |
|---|---|---|
| Admin | `admin@ecoledigitale.local` | `Password@2025` |
| Étudiante diplômée (Aminata) | `aminata.e2e22091@example.test` | `%hR5ae@@QXyb` |
| Étudiante ajournée (Chantal) | `chantal.e2e22091@example.test` | `zR58E6Y#WSxc` |

Pièges d'environnement : une page servie pour la première fois met jusqu'à une minute à
compiler ; une page qui a échoué reste figée sur son erreur même une fois l'API revenue —
**recharge avant de conclure** ; remplis les champs au clavier, valide par un clic.

---

## Temps 1 — Vérifier les corrections

**1. Le bulletin dans l'espace étudiant.**
> Aminata → `/student/documents` → onglet Bulletins → **Voir**. Attendu : le PDF s'ouvre dans
> la visionneuse. C'est désormais **le même gabarit que côté administration**.
> Si la génération échoue, une **bannière rouge** doit dire pourquoi — plus jamais de
> bouton qui tourne puis s'arrête sans un mot.

**2. L'identité imprimée sur ce bulletin.**
> Sur le PDF d'Aminata, côté étudiant **et** côté admin :
> - **Spécialité : `TESTOLOGIE E2E-2209-1`** — et non plus « BTS TESTOLOGIE … » ;
> - **Niveau : `LICENCE 1`** — et non plus « BTS 1 » ;
> - la **mise en page** reste celle de style BTS (tableau à coefficients, total des points).
>
> Le mot « BTS » ne doit plus apparaître dans les champs d'identité. Il subsiste dans le
> **nom du fichier téléchargé** (`Bulletin_BTS_….pdf`) : c'est connu, pas une anomalie.

**3. La décision du jury sur ce bulletin.**
> Dans le tableau de synthèse (Total des points · Moyenne semestrielle · Rang), une
> quatrième colonne **« Décision du jury »** doit porter **ADMIS** pour Aminata.
> Vérifie aussi le bulletin de **Chantal** : **AJOURNÉ**.
>
> Les **crédits n'y figurent pas, volontairement** : ce bulletin est un document à
> coefficients, les UV relèvent de la logique LMD. Leur éventuel ajout est une décision de
> la scolarité, pas encore prise. Leur absence n'est pas une anomalie.

**4. Le diplôme.**
> Admin → `/professionnel/admin/diplomes` → fiche → diplôme d'Aminata, **et** Aminata →
> `/student/diplomes` → **Télécharger mon diplôme**. Sur les deux PDF :
> - la référence **`Réf. DIP-2026-000001`** en pied de page ;
> - le matricule **`IPAM-L1TST01-0061`** ;
> - **« totalisant 13/13 UV »** dans la phrase d'obtention ;
> - l'état civil : née le **15 juin 2005** à **Abidjan** ;
> - les deux signataires, `Aya Gauche` à gauche, `Yao Droite` à droite.

**5. Notes après clôture.**
> `/professionnel/admin/notes` → classe et semestre du run. Attendu : bannière ambrée, et
> **tous les champs du tableau inertes** — impossible d'y taper, boutons de devoirs et de
> suppression inclus. Le tableau est désormais dans un `<fieldset disabled>`.

**6. Confirmation d'inscription.**
> `/professionnel/admin/inscriptions` → enregistre une inscription (l'étudiant de test créé en
> passe 3 fait l'affaire). Attendu : la confirmation apparaît **juste au-dessus du bouton**,
> sans défiler. On ne compte plus sur un défilement automatique.

---

## Temps 2 — Volet financier

Le scénario complet est ci-dessous. Joue-le sur la classe `LICENCE 1 TESTOLOGIE E2E-2209-1`.
**Aucun paiement réel** : tout se fait par saisie administrative. Devant un vrai formulaire
bancaire ou d'opérateur, arrêt immédiat.

Une précision d'état que le scénario ne connaît pas : les inscriptions du run sont déjà
**confirmées** (la classe n'a pas de frais d'inscription au barème, donc rien n'est dû pour
l'inscription elle-même). L'étape 6 de S11 s'attend à trouver `en_attente_paiement` avant
encaissement : **ce ne sera pas le cas, et c'est normal**. Note simplement le statut constaté.

---

## Ce que j'attends en retour

Une ligne par point : OK ou KO. Sur un KO : URL, geste, attendu, constaté, et la requête en
cause si tu la vois. À la fin : le tableau des six vérifications, le déroulé de S11 avec ses
montants constatés, les anomalies classées, et **ce que tu n'as pas pu vérifier**.

---

## Annexe — Scénario S11

### S11 — Barème de la classe et encaissement

| | |
|---|---|
| **Rôle** | Administrateur |
| **Prérequis** | S03 (trois étudiants inscrits) |
| **Produit** | Barème renseigné, encaissements partiels et soldés, reçus |
| **Budget** | ~60 appels d'outils · **1 capture** (le reçu) |
| **Place dans la chaîne** | après S03 ; peut tourner en parallèle de S04-S07 |

---

## Étapes

### 1. Écran de suivi
`/admin/finances/student-payments` → classe `LICENCE 1 TESTOLOGIE <TAG>`.

Attendu : les trois étudiants, avec les onglets **Barème**, **UE suivies (N)** et
**Transactions (N)**.

**Contrôle d'amorçage** : l'onglet *UE suivies* doit refléter les inscriptions de S03. Un
étudiant sans UE suivie alors qu'il est inscrit est une anomalie **MAJEURE** — la facturation
serait déconnectée de la pédagogie.

Relever le montant total dû de chacun et le comparer aux prix saisis en S01 :
`Comptabilité <TAG>` 150 000 + `Droit <TAG>` 100 000 + `Conduite <TAG>` 0 = **250 000 FCFA**
au titre des UE, auxquels s'ajoutent les lignes du barème de classe si elles sont renseignées.
Si le total affiché ne correspond à aucune somme explicable, le noter avec le détail ligne à
ligne — c'est une anomalie **MAJEURE**, et c'est le genre d'écart qu'on ne retrouve plus une
fois des paiements enregistrés par-dessus.

### 2. Encaissement partiel — Aminata (A)
Ligne de barème « Scolarité » (ou la première ligne non réglée) → bouton **Encaisser**.
Modale **Encaisser — {libellé}** :

| Champ | Valeur |
|---|---|
| Montant (FCFA) | `50000` |
| Mode de règlement | **Espèces** |
| Référence (optionnel) | `REC-<TAG>-01` |

Bouton **Enregistrer**.

Attendu : badge **Partiel**, reste à payer diminué de 50 000 exactement.

### 3. Solde — Aminata
Rouvrir **Encaisser** sur la même ligne, utiliser le bouton **Tout** (qui doit pré-remplir
exactement le reste dû), mode **Mobile Money**, référence `REC-<TAG>-02`. **Enregistrer**.

Attendu : badge **Soldé**, reste à payer **0**.

**Contrôles** :
- Le bouton *Tout* doit proposer le reste **exact**. Un écart, même d'une unité, est **MAJEUR** :
  c'est un solde qui ne se solde jamais.
- Vérifier qu'un montant **supérieur** au reste dû est refusé : rouvrir la modale sur une autre
  ligne et tenter un montant manifestement excessif. Un trop-perçu accepté sans avertissement
  est **MAJEUR** ; s'il est refusé, relever le message exact.
- Tenter un montant **négatif** et un montant **à zéro** : les deux doivent être refusés.

### 4. Reçu
Onglet **Transactions** d'Aminata : deux lignes attendues, 50 000 puis le solde.
Bouton **Reçu** sur la première. **Une capture**.

| Point | Attendu |
|---|---|
| Montant | 50 000, pas le total |
| Mode de règlement | Espèces |
| Référence | `REC-<TAG>-01` |
| Identité | Aminata, matricule `<TAG>-A` |
| Numéro de reçu | présent et non vide |

Deux reçus portant le **même numéro** seraient une anomalie **MAJEURE** — c'est une pièce
comptable. Comparer les numéros des deux transactions.

### 5. Laisser Bakary et Chantal impayés
**Ne rien encaisser** pour B et C. C'est volontaire : S08 s'appuie sur le fait qu'un impayé
n'empêche pas la délivrance du diplôme, et B est justement diplômé. Vérifier ici que leur
badge est bien **Non réglé** et le consigner au registre.

### 6. Retour sur le statut d'inscription
`/professionnel/admin/inscrits`, fiche d'Aminata. Le statut relevé en S03 était
`en_attente_paiement`.

Attendu après solde complet : un statut qui reflète le paiement (`confirmee`).

- S'il reste à `en_attente_paiement` alors que tout est soldé : anomalie **MAJEURE**, en
  précisant s'il existe un geste manuel de changement de statut sur la fiche (auquel cas le
  défaut est l'absence d'automatisme, pas l'impossibilité).
- S'il n'existe aucun lien entre les deux notions, le dire explicitement : c'est une
  **question à trancher par un humain** — le statut d'inscription doit-il suivre le solde ?

### 7. Vue étudiant (facultatif, si les identifiants de A sont disponibles)
`/(dashboard)/student-payments` en tant qu'Aminata : elle doit **voir** ses deux versements et
n'avoir **aucun** moyen d'en saisir. Un formulaire de saisie côté étudiant serait une anomalie
**MAJEURE**.

---

## Pièges connus

| Piège | Conduite à tenir |
|---|---|
| Deux écrans de paiement homonymes | `/admin/finances/student-payments` est celui de la scolarité (saisie) ; `/(dashboard)/student-payments` est la consultation étudiant. Ne pas les confondre dans le rapport. |
| Le « payé » est recalculé | Il n'est jamais stocké en dur : un total faux vient d'une transaction fautive, pas d'un compteur désynchronisé. Toujours joindre le détail des transactions. |
| Barème par classe | Les lignes Inscription/Scolarité/Annexes/Autres dépendent de la classe. Si elles sont vides, le dire — le barème n'a peut-être jamais été renseigné pour la classe du run. |
