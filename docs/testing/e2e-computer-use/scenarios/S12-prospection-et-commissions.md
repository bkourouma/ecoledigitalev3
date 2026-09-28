# S12 — Prospection : commercial, provenance, commission

| | |
|---|---|
| **Rôle** | Administrateur |
| **Prérequis** | S11 (au moins un paiement confirmé sur Aminata) |
| **Produit** | `COMMERCIAL_ID`, provenance rattachée à A, une commission calculée puis réglée |
| **Budget** | ~50 appels d'outils |

> Une commission n'est **jamais stockée** : elle se recalcule à chaque affichage, à partir des
> paiements confirmés et du taux **figé sur la provenance de l'étudiant** au moment où elle a
> été saisie. D'où l'ordre de ce scénario : le commercial et la provenance d'abord, le contrôle
> du montant ensuite, et surtout un test explicite de ce qui se passe quand on change le taux
> après coup.

---

## Étapes

### 1. Créer un commercial
`/professionnel/admin/prospection/commerciaux` → nom `Moussa Commercial <TAG>`,
taux de commission par défaut **10 %**. Enregistrer. Relever `COMMERCIAL_ID`.

### 2. Rattacher une provenance à Aminata
`/professionnel/admin/prospection/provenances` → pour Aminata (A) : canal **commercial**,
commercial `Moussa Commercial <TAG>`, taux **10 %**.

**Contrôle** : vérifier qu'un canal **autre que « commercial »** n'ouvre pas droit à commission —
sélectionner un autre canal sur Bakary (B), sans commercial, et vérifier en étape 4 qu'aucune
commission n'apparaît pour lui. Une commission attribuée hors canal commercial est une anomalie
**MAJEURE**.

### 3. Calcul attendu
Aminata a réglé en S11 : 50 000 puis le solde. La commission attendue vaut
**10 % de chaque paiement confirmé**, arrondi à l'unité :

| Paiement | Montant | Commission attendue |
|---|---|---|
| 1 | 50 000 | **5 000** |
| 2 | solde relevé en S11 | **10 % du solde, arrondi** |
| | | **Total : 10 % du total encaissé** |

Reporter ces trois valeurs au registre **avant** de regarder l'écran. Comparer ensuite.

### 4. Vérifier les lignes de commission
`/professionnel/admin/prospection/commissions` puis
`/professionnel/admin/prospection/commissions/historique` (titre : « Commissions à payer »).

| Contrôle | Attendu |
|---|---|
| Une ligne par paiement confirmé d'Aminata | oui |
| Montant de chaque ligne | conforme au tableau ci-dessus |
| Bakary | aucune ligne (canal non commercial) |
| Chantal | aucune ligne (aucun paiement) |

Tout écart de montant est **MAJEUR** : donner l'assiette retenue par l'application (montant du
paiement ? montant de la commande ? total dû ?) telle qu'on peut la déduire du chiffre affiché.
C'est la question la plus utile de ce scénario : une commission assise sur autre chose que le
paiement encaissé se paie en argent réel.

### 5. Test du taux figé
Revenir sur la provenance d'Aminata et porter le taux à **20 %**. Enregistrer, puis rouvrir
l'écran des commissions.

Attendu : les commissions **déjà nées** des paiements antérieurs **ne bougent pas** — le taux
est figé au moment de la saisie de la provenance. Si elles passent rétroactivement à 20 %, c'est
une anomalie **MAJEURE** : la rémunération du passé se réécrit toute seule.

Remettre ensuite le taux à 10 % et noter si ce retour en arrière a, lui aussi, un effet
rétroactif.

### 6. Règlement
Sur « Commissions à payer » : sélectionner la première ligne → bouton
**Marquer payé — 1 ligne(s), {montant} FCFA**.

Attendu : la ligne quitte cet écran et se retrouve dans
`/professionnel/admin/prospection/commissions/historique/payees`, avec le même montant.

**Contrôles** :
- Le montant annoncé sur le bouton doit être exactement celui de la ligne sélectionnée.
- Une ligne déjà payée ne doit pas pouvoir l'être deux fois. Vérifier qu'elle n'est plus
  proposée. Un double règlement possible est **MAJEUR**.
- Utiliser ensuite **Tout marquer payé (N)** pour le reste, et vérifier la cohérence du total.

---

## Pièges connus

| Piège | Conduite à tenir |
|---|---|
| Commission recalculée, jamais stockée | Un montant qui change d'un écran à l'autre vient d'une assiette différente, pas d'un cache. |
| Taux figé sur la provenance | Le taux du commercial n'est qu'un défaut ; c'est celui de la provenance qui compte. |
| Seul le canal « commercial » commissionne | Contrôle de l'étape 2, à ne pas sauter. |
| Versement = pièce comptable | Un règlement ne se supprime pas à la légère. Ne pas tester la suppression sans y être invité. |
