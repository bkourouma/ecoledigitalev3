# S13 — Rémunération du formateur : séances, tarifs, bulletin de paie

| | |
|---|---|
| **Rôle** | Administrateur, puis Enseignant (étape 6) |
| **Prérequis** | S04 (trois séances tenues par l'enseignante du run) |
| **Produit** | Tarif horaire, séances validées, un bulletin de paie archivé puis versé |
| **Budget** | ~60 appels d'outils · **1 capture** (le bulletin PDF) |

> Attention au vocabulaire : ici, « bulletin » désigne le **bulletin de paie de l'enseignant**,
> pas le bulletin de notes de l'étudiant. Les deux mots cohabitent dans l'application. Dans le
> rapport, toujours préciser lequel.

---

## Étapes

### 1. Tarif horaire
`/professionnel/admin/remuneration` → section des tarifs ECUE. Créer un tarif pour
`Comptabilité générale <TAG>` : **5 000 FCFA/heure**, période couvrant le mois en cours.

**Contrôle du chevauchement** : créer un second tarif sur la **même ECUE** et une période qui
**recouvre** la première. Attendu : refus explicite (erreur de chevauchement). Relever le
message. Deux tarifs concurrents acceptés sur une même période sont une anomalie **MAJEURE** —
le montant à payer devient indéterminé.

Tester aussi la priorité : un tarif **nominatif** (pour cette enseignante) doit l'emporter sur
un tarif **générique**. Si l'écran le permet, créer un tarif nominatif à **6 000** sur une
période **disjointe**, et noter lequel s'applique à la période des séances.

### 2. Validation des séances
`/professionnel/admin/remuneration/seances`. Retrouver les trois séances de S04
(2 h chacune, soit **6 heures**).

| Contrôle | Attendu |
|---|---|
| Les trois séances sont listées | oui |
| Chacune porte une durée de 2 h | oui |
| Aucun motif de non-payabilité | sinon relever le blocage affiché mot pour mot |

Valider les trois séances.

> Une séance planifiée n'est **jamais** payée tant qu'elle n'est pas validée. Si des séances
> apparaissent déjà validées sans geste de l'administrateur, c'est une anomalie **MAJEURE**.

### 3. Montant attendu
`6 heures × 5 000 = **30 000 FCFA**`. Le porter au registre **avant** de générer le bulletin.

### 4. Générer le bulletin de la période
`/professionnel/admin/remuneration/bulletins` → bouton
**Générer les bulletins de cette période**.

| Contrôle | Attendu |
|---|---|
| Un bulletin pour `Awa Formatrice <TAG>` | oui |
| Montant | **30 000** |
| Détail des heures | 6 h, origine **professionnelle** |
| Colonne d'origine | présente — le calcul agrège heures académiques et professionnelles ; ici seules les professionnelles existent |

Un montant différent est **MAJEUR** : donner le nombre d'heures retenu et le tarif appliqué tels
que l'écran les affiche, pour distinguer une erreur de durée d'une erreur de tarif.

**Idempotence** : relancer la génération une seconde fois. Attendu : le bulletin n'est ni
dupliqué, ni doublé en montant. Un doublon est **MAJEUR**.

### 5. Archiver puis verser
1. Bouton **Tout archiver (N)** → le bulletin passe au statut **Impayé** dans l'historique.
2. `/professionnel/admin/remuneration/historique` : tenter d'éditer le PDF du bulletin
   **impayé**. Attendu : action **indisponible** — un bulletin impayé ne s'imprime pas.
   Si le PDF sort quand même, c'est une anomalie **MAJEURE** (une pièce de paie non versée
   circulerait comme si elle l'était).
3. Bouton **Marquer versé** → statut **Payé**, date de versement figée.
4. Éditer le PDF. **Une capture** : identité de l'enseignante, période, 6 h, 30 000, et la date
   de versement.

### 6. Vue enseignant
Se connecter avec le compte de `Awa Formatrice <TAG>` (mêmes réserves d'identifiants qu'en S10)
et ouvrir `/teacher/remuneration/historique`.

| Contrôle | Attendu |
|---|---|
| Le bulletin **versé** est visible | oui |
| Aucun bulletin d'un autre enseignant | vérifier — une fuite ici est **BLOQUANTE** |
| Un bulletin archivé mais impayé | **ne doit pas** apparaître |

Pour vérifier le dernier point : revenir en administrateur, générer et archiver un bulletin sur
une période sans versement, puis reprendre la vue enseignant. S'il y apparaît, c'est **MAJEUR** :
l'enseignant verrait comme acquis un montant qui ne lui a pas été versé.

---

## Pièges connus

| Piège | Conduite à tenir |
|---|---|
| Deux sens du mot « bulletin » | Paie vs notes. Toujours préciser dans le rapport. |
| Séance validée ≠ séance tenue | La validation est un geste administratif distinct. |
| Verrou après approbation | Un bulletin approuvé peut refuser toute modification (`PAYMENT_LOCKED`). C'est attendu : relever le message, ne pas forcer. |
| Tarif figé dans l'historique | Un tarif modifié après coup ne doit pas réécrire un bulletin déjà produit. Si l'occasion se présente, le vérifier et le signaler. |
