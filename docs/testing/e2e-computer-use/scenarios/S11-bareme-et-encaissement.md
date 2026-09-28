# S11 — Barème de la classe et encaissement

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
