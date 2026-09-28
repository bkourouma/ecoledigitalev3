# S06 — Rattrapages (session 2)

| | |
|---|---|
| **Rôle** | Administrateur |
| **Prérequis** | S05 (B et C en rattrapage, C avec une note éliminatoire) |
| **Produit** | Notes de session 2, décisions de semestre définitives |
| **Budget** | ~45 appels d'outils |

---

## Ce qu'on cherche à établir

1. Que la liste des rattrapages contient **exactement** les bons étudiants et les bonnes ECUE.
2. Que la note de session 2 **remplace** celle de session 1 dans le calcul.
3. Qu'une note **< 5 reste éliminatoire même en session 2** — c'est la règle qui sépare
   « rattrapé » d'« ajourné », et donc celle qui décide de qui aura un diplôme.

---

## Étapes

### 1. Liste des rattrapages
`/professionnel/admin/notes/rattrapages`, classe `L1 TESTOLOGIE <TAG>`, `Semestre 1 <TAG>`.

Attendu, d'après les notes de S05 :

| Étudiant | ECUE attendues en rattrapage |
|---|---|
| A | **aucune** — il ne doit pas figurer dans la liste |
| B | `Comptabilité générale <TAG>` (7,8) |
| C | `Comptabilité générale <TAG>` (3,0) **et** `Droit civil <TAG>` (6,0) |

Écarts à traiter comme **MAJEURS** :
- A présent dans la liste → un étudiant admis serait renvoyé au rattrapage ;
- une ECUE validée (`Comptabilité analytique` à 10,0 pour B) présente dans la liste — le seuil
  de 10 serait mal appliqué ;
- l'ECUE éliminatoire de C **absente** de la liste.

> Le cas de `Comptabilité analytique` pour B, exactement à **10,0**, est volontaire : il teste
> la frontière. 10 est validé, donc cette ECUE ne doit **pas** apparaître.

### 2. Saisir les notes de session 2

| Étudiant | ECUE | Note session 2 | Effet attendu |
|---|---|---|---|
| B | `Comptabilité générale <TAG>` | **13** | remplace 7,8 → UE Comptabilité = (13 + 10)/2 = **11,5** → validée |
| C | `Comptabilité générale <TAG>` | **4** | remplace 3,0 → **toujours éliminatoire** |
| C | `Droit civil <TAG>` | **12** | remplace 6,0 → UE Droit = **12,0** → validée |

**Contrôle sur la formule** : relever ce que l'écran affiche comme note d'ECUE après la saisie
de la session 2. Si la note retenue pour B n'est pas **13,0**, décrire précisément ce qui a été
appliqué — par exemple une repondération `devoirs × 0,4 + examen × 0,6` réutilisant les devoirs
de session 1, qui donnerait `0,4 × 9 + 0,6 × 13 = 11,4`. Les deux lectures sont défendables et
le code ne tranche pas explicitement : ce n'est donc pas une anomalie, mais une **question à
trancher par un humain**, à porter au rapport avec le chiffre constaté. Ce qui **serait** une
anomalie MAJEURE : que la note de session 1 continue de l'emporter sur celle de session 2.

### 3. Recalculer et relever les décisions définitives

| Étudiant | Décision attendue | Justification |
|---|---|---|
| A | **Admis** | inchangé depuis S05 |
| B | **Admis** | toutes ses UE validées après rattrapage |
| C | **Ajourné** | UE Comptabilité non validée avec note éliminatoire, même après session 2 |

Si C ressort « Admis » ou reste « Rattrapage » sans fin, c'est **MAJEUR** : dans le premier cas
la règle éliminatoire ne s'applique pas, dans le second l'étudiant n'atteint jamais d'état
terminal et son dossier reste indéfiniment ouvert.

---

## Pièges connus

| Piège | Conduite à tenir |
|---|---|
| Recalcul oublié | Les décisions peuvent rester à leur valeur de S05. Recalculer avant de conclure. |
| Note à 10,0 pile | Validée. Elle ne doit pas apparaître en rattrapage. |
| « Rattrapage » vs « Ajourné » | Deux états distincts. Relever le libellé exact affiché, pas son interprétation. |
