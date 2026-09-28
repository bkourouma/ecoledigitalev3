# S07 — Bulletins : génération, contrôle des calculs, PDF, clôture

| | |
|---|---|
| **Rôle** | Administrateur |
| **Prérequis** | S06 (décisions définitives : A et B admis, C ajourné) |
| **Produit** | Bulletins générés, PDF vérifiés, semestre clôturé |
| **Budget** | ~55 appels d'outils · **2 captures autorisées** (les PDF) |

---

## Étapes

### 1. Roster
`/professionnel/admin/bulletins` → classe `L1 TESTOLOGIE <TAG>`, `Semestre 1 <TAG>`.
Attendu : les trois étudiants, aucun autre. Un étudiant étranger au run dans cette liste est une
anomalie **MAJEURE** (fuite de périmètre).

### 2. Générer les bulletins
Bouton de génération pour le semestre. Attendu : trois bulletins produits, sans erreur.

### 3. Contrôler les valeurs — étudiant A

Ouvrir le bulletin de `Aminata Excellente <TAG>` et relever :

| Grandeur | Valeur attendue |
|---|---|
| `Comptabilité générale <TAG>` | 14,6 |
| `Comptabilité analytique <TAG>` | 15,0 |
| UE `Comptabilité <TAG>` | 14,8 — validée |
| `Droit civil <TAG>` | 13,0 |
| UE `Droit <TAG>` | 13,0 — validée |
| Conduite | 16,0 |
| Décision | **Admis** |
| Crédits | à relever tels qu'affichés, puis comparer à 4 + 3 + 5 + 1 = **13** |

**Sur les crédits** : deux totaux coexistent dans l'application — les **crédits d'ECUE** (saisis
en S01 : 13 au total) et les **UV d'UE** (jamais saisies, probablement restées à 0 — voir S01
étape 5). Noter lequel des deux le bulletin affiche. Un bulletin qui annonce **0 crédit** pour
un étudiant admis est une anomalie **MAJEURE**, et elle explique d'avance ce que S08 trouvera
sur l'éligibilité au diplôme : le signaler dans les deux scénarios plutôt qu'une seule fois.

### 4. Contrôler les cas limites — B et C

| Étudiant | À vérifier |
|---|---|
| B | Les notes **de session 2** apparaissent, pas celles de session 1. La mention du rattrapage est présente. Décision **Admis**. |
| C | Décision **Ajourné**. L'UE non validée et la note éliminatoire sont visibles. Le bulletin est bien généré (un étudiant ajourné a droit à son bulletin). |

Un bulletin refusé à C est une anomalie **MAJEURE** : l'échec doit se documenter, pas
disparaître.

### 5. PDF
Générer le PDF d'un bulletin (A), puis d'un second (C). Le rendu est produit dans le navigateur.

Contrôles, **une capture par PDF** :
- en-tête de l'établissement et identité de l'étudiant corrects ;
- les notes du PDF sont **celles de l'écran** ;
- la décision figure sur le document ;
- aucune zone vide là où un signataire ou un total est attendu.

> La classe s'appelle `LICENCE 1 …`, ce qui déclenche un gabarit de bulletin différent de celui
> des autres niveaux. Si le PDF semble mal calibré (colonnes décalées, mentions absentes), le
> signaler comme **MAJEURE** en précisant le niveau de la classe — c'est le genre de défaut qui
> ne se voit que sur Licence 1 et 2.

### 6. Clôture du semestre
Bouton de clôture. Attendu : la clôture passe, et la saisie des notes devient impossible
ensuite.

Contrôles :
- Retourner sur `/professionnel/admin/notes` et tenter de modifier une note : le refus est le
  comportement attendu. Une note encore modifiable après clôture est une anomalie **MAJEURE**
  (un bulletin signé pourrait être contredit après coup).
- La clôture est refusée si une conduite manque. Comme elles ont toutes été saisies en S05, un
  refus ici signale une conduite perdue : **bloquant**, et il faut dire laquelle.

### 7. Historique
`/professionnel/admin/bulletins/historique` : les trois bulletins doivent y figurer, datés.

---

## Pièges connus

| Piège | Conduite à tenir |
|---|---|
| Deux notions de crédits | ECUE (saisies) vs UV d'UE (non saisies). Toujours préciser laquelle est affichée. |
| Gabarit spécifique Licence 1/2 | Le PDF n'est pas le même selon le niveau. Le préciser dans toute anomalie de rendu. |
| Clôture irréversible | Elle verrouille la saisie. Elle se fait **en dernier**, après tous les contrôles de valeurs. |
| PDF produit côté navigateur | Pas d'appel serveur à chercher : s'il ne sort pas, l'erreur est dans la console, pas dans le réseau. |
