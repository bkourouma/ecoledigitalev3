# S05 — Notes de session 1, conduite, recalcul

| | |
|---|---|
| **Rôle** | Administrateur |
| **Prérequis** | S03 (inscriptions), S01 (l'ECUE de conduite doit être reconnue comme telle) |
| **Produit** | Notes de session 1, notes de conduite, résultats d'UE calculés |
| **Budget** | ~65 appels d'outils |

> C'est le scénario qui fabrique les trois destins : **A admis d'emblée**, **B renvoyé au
> rattrapage**, **C avec une note éliminatoire**. Les valeurs ci-dessous ne sont pas
> décoratives — elles sont choisies pour que chaque moyenne tombe juste et que tout écart
> constaté soit indiscutable. Les saisir telles quelles.

---

## Barème appliqué par l'application

`note ECUE = moyenne des devoirs × 0,4 + examen × 0,6`
· validée si **≥ 10** · éliminatoire si **< 5**.

## Valeurs à saisir

`/professionnel/admin/notes` → *Nom de classe* `L1 TESTOLOGIE <TAG>`, *Semestre* `Semestre 1 <TAG>`.

### ECUE `Comptabilité générale <TAG>` (4 crédits)

| Étudiant | Devoir 1 | Devoir 2 | Examen | Moyenne devoirs | **Note ECUE attendue** | État attendu |
|---|---|---|---|---|---|---|
| A | 12 | 16 | 15 | 14 | **14,6** | Validée |
| B | 8 | 10 | 7 | 9 | **7,8** | Insuffisante |
| C | 4 | 2 | 3 | 3 | **3,0** | **Éliminatoire** |

### ECUE `Comptabilité analytique <TAG>` (3 crédits)

| Étudiant | Devoir 1 | Examen | **Note ECUE attendue** |
|---|---|---|---|
| A | 15 | 15 | **15,0** |
| B | 10 | 10 | **10,0** |
| C | 11 | 11 | **11,0** |

### ECUE `Droit civil <TAG>` (5 crédits)

| Étudiant | Devoir 1 | Examen | **Note ECUE attendue** |
|---|---|---|---|
| A | 13 | 13 | **13,0** |
| B | 14 | 14 | **14,0** |
| C | 6 | 6 | **6,0** |

### Conduite — `/professionnel/admin/conduite`

| Étudiant | Note /20 |
|---|---|
| A | 16 |
| B | 14 |
| C | 12 |

> La note de conduite **s'enregistre au moment où le champ perd le focus**, sans bouton. Après
> saisie, sortir du champ puis recharger la page une fois pour vérifier que les trois notes sont
> bien là. Une conduite non enregistrée bloque le calcul des notes à l'étape suivante — et le
> message d'erreur, lui, ne dira pas que c'est la conduite qui manque.

---

## Étapes

1. **Saisir les trois ECUE** dans l'ordre du tableau. Après chaque ECUE, relever la note
   calculée affichée pour les trois étudiants et la comparer à la colonne « attendue ».
2. **Saisir la conduite**, puis recharger et vérifier.
3. **Recalculer** les résultats : bouton de recalcul de la session d'UE (ou
   `POST .../ue-sessions/{id}/results/recompute` déclenché par l'écran).
4. **Relever les moyennes d'UE** obtenues :

| UE | ECUE agrégées | A | B | C |
|---|---|---|---|---|
| `Comptabilité <TAG>` | CG + CA | **14,8** → validée | **8,9** → non validée | **7,0** → non validée |
| `Droit <TAG>` | DC | **13,0** → validée | **14,0** → validée | **6,0** → non validée |
| `Conduite <TAG>` | Conduite | **16,0** → validée | **14,0** → validée | **12,0** → validée |

5. **Relever la décision de semestre** de chacun :

| Étudiant | Décision attendue | Pourquoi |
|---|---|---|
| A | **Admis** | toutes ses UE sont validées |
| B | **Rattrapage** | UE Comptabilité à 8,9 — aucune compensation entre UE |
| C | **Rattrapage** | deux UE non validées, dont une avec note éliminatoire |

---

## Contrôles

- **Chaque écart de note ECUE est une anomalie MAJEURE.** Donner les trois nombres : les notes
  saisies, la note attendue, la note affichée. C'est le cœur du module : une moyenne fausse ici
  produit un diplôme faux trois scénarios plus loin.
- **Pas de compensation entre UE** : si B ressort « Admis » alors que son UE Comptabilité est à
  8,9, c'est une anomalie **MAJEURE** de règle métier, pas un arrondi.
- **Note éliminatoire** : la note de 3,0 de C doit être signalée comme éliminatoire à l'écran
  (pas seulement « insuffisante »). Si rien ne la distingue d'une note à 9, c'est **MINEURE**
  côté affichage, mais vérifier en S06 qu'elle se comporte bien comme éliminatoire — ce qui,
  là, serait MAJEUR.
- **Blocage par conduite manquante** : avant de saisir la conduite, tenter une fois le calcul
  des notes. Un blocage explicite est le comportement attendu ; relever le message exact. Un
  calcul qui passe sans conduite est une anomalie **MAJEURE** (la conduite entre dans la
  moyenne — un semestre calculé sans elle est faux).
- **Bulletin prématuré** : ouvrir `/professionnel/admin/bulletins` et vérifier que B et C, en
  attente de session 2, n'ont **pas** de bulletin consultable ni générable. Un bulletin
  disponible à ce stade est une anomalie **MAJEURE** — il serait produit sur des notes non
  définitives.

---

## Pièges connus

| Piège | Conduite à tenir |
|---|---|
| Conduite enregistrée au `blur` | Toujours sortir du champ, puis recharger pour vérifier. |
| Un seul devoir au lieu de deux | La moyenne des devoirs porte sur ce qui est saisi : avec un seul devoir, elle vaut ce devoir. Les tableaux ci-dessus en tiennent déjà compte. |
| Virgule ou point décimal | Saisir des entiers uniquement, comme prévu ci-dessus, pour écarter toute question de format. |
| Recalcul non déclenché | Les moyennes d'UE peuvent rester périmées tant que le recalcul n'a pas tourné. Ne pas conclure à un calcul faux sans avoir recalculé une fois. |
