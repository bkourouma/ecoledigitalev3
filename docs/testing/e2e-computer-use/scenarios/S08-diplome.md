# S08 — Diplôme : éligibilité, octroi, PDF, authenticité, révocation

| | |
|---|---|
| **Rôle** | Administrateur |
| **Prérequis** | S07 (bulletins générés, semestre clôturé) |
| **Produit** | `DIPLOME_ID`, diplômes octroyés à A et B, un octroi forcé puis révoqué sur C |
| **Budget** | ~60 appels d'outils · **3 captures autorisées** |

> C'est l'aboutissement de la chaîne. Si un seul scénario devait être joué avec soin, c'est
> celui-ci : tout ce qui précède n'existe que pour rendre ce moment possible.

---

## Deux propriétés du module qu'il faut avoir en tête

1. **Le diplôme n'est pas créé à la main.** Il est créé — et ses exigences régénérées — à
   chaque ouverture de la page liste. Ne pas chercher un bouton « Nouveau diplôme » : son
   absence n'est pas une anomalie.
2. **Un diplôme couvre un cycle entier**, pas une classe. Le cycle est déduit du nom de la
   classe (`LICENCE 1 TESTOLOGIE <TAG>` → cycle Licence, spécialité `TESTOLOGIE <TAG>`).
   C'est précisément pour cela que S01 impose une spécialité unique.

---

## Étapes

### 1. Ouvrir la liste
`/professionnel/admin/diplomes`. Retrouver le diplôme du cycle `TESTOLOGIE <TAG>`.
Relever `DIPLOME_ID`.

**Contrôle d'isolement** : ouvrir l'onglet **UE requises**. Il doit contenir **exactement** les
trois UE du run (`Comptabilité <TAG>`, `Droit <TAG>`, `Conduite <TAG>`), et rien d'autre.

Toute UE étrangère au run est une anomalie **BLOQUANTE** : le regroupement par cycle aurait
happé des filières réelles, le diplôme de test deviendrait inatteignable, et — plus grave — cela
voudrait dire qu'en production un diplôme peut exiger des UE d'une autre filière. Relever dans
ce cas le nom exact des UE intruses et le nom de leur classe d'origine : c'est l'information qui
permettra de comprendre la règle de regroupement.

### 2. Relever le total d'UV exigé
Sur la fiche du diplôme, noter la valeur d'UV requise et le détail par UE.

Attendu d'après S01 : les UV d'UE n'ont **pas** pu être saisies, donc chaque UE vaut
vraisemblablement **0 UV** et le total requis vaut **0**.

Si c'est le cas, c'est une anomalie **MAJEURE** — à formuler ainsi, sans l'adoucir : *le
critère de crédits du diplôme est inopérant, puisque « 0 UV acquis ≥ 0 UV requis » est
toujours vrai ; l'éligibilité ne repose plus que sur la validation des UE.* Donner la valeur
exacte affichée. Cette anomalie est le prolongement direct de celle de S01 étape 5 : les
rapprocher dans le rapport plutôt que de les traiter comme deux problèmes distincts.

### 3. Vérifier les statuts des trois étudiants

| Étudiant | État attendu | Pourquoi |
|---|---|---|
| A | **Éligible** | ses trois UE sont validées |
| B | **Éligible** | ses trois UE sont validées après rattrapage |
| C | **ni éligible, ni diplômé** | UE Comptabilité non validée |

Écarts à traiter comme **BLOQUANTS** : A ou B non éligible (le diplôme devient impossible à
obtenir au terme d'un parcours complet et réussi) ; C éligible (un étudiant ajourné serait
diplômé, ce qui est le défaut le plus grave que ce module puisse avoir).

Sur la ligne de C, vérifier aussi que le bouton **Générer le diplôme** est bien **désactivé**.

### 4. Octroyer le diplôme de A
Bouton **Générer le diplôme** sur la ligne d'Aminata. Attendu : l'octroi se fait, puis le PDF
est produit.

Contrôles sur le PDF — **une capture** :

| Point | Attendu |
|---|---|
| Identité | `Aminata Excellente <TAG>`, matricule `<TAG>-A` |
| Intitulé | le cycle/la spécialité du run |
| Signataire de gauche | `Aya Gauche <TAG>` — `Le Directeur Général` |
| Signataire de droite | `Yao Droite <TAG>` — `Le Président du Jury` |
| Crédits / mentions | relever ce qui est imprimé, notamment si un total de crédits apparaît à **0** |
| Zones vides | aucune |

Un signataire absent renvoie à S02 étape 5 : préciser lequel.

### 5. Vérifier le statut après octroi
Le badge de A doit passer à **Diplômé**. Recharger la page une fois : le statut doit tenir. Un
étudiant qui redevient « Éligible » après rechargement est une anomalie **MAJEURE** (l'octroi
n'a pas été persisté).

### 6. Octroyer le diplôme de B
Même geste, sans regénérer le PDF. Objectif : vérifier qu'un parcours passé par le rattrapage
mène au même résultat qu'un parcours sans faute. Si l'octroi échoue pour B alors qu'il a réussi
pour A, c'est **BLOQUANT** — préciser le message d'erreur.

### 7. Attestation d'authenticité
Sur la fiche du diplôme de A, bouton **Authenticité**. Attendu : un second document, signé par
`Ama Authentique <TAG>`. **Une capture.**

### 8. Octroi forcé puis révocation, sur C
Séquence volontairement anormale : elle teste le garde-fou administratif.

1. Fiche du diplôme, onglet des candidats, ligne de Chantal : bouton **Forcer l'octroi**.
   Une confirmation est attendue. Le forçage doit être **possible mais explicite** — s'il passe
   sans aucune confirmation, c'est une anomalie **MAJEURE** (un clic malheureux diplôme un
   étudiant ajourné).
2. Vérifier que C apparaît alors comme **Diplômé**.
3. Bouton **Révoquer**, motif `Octroi de test <TAG>`.

> La saisie du motif passe par une **boîte de dialogue native du navigateur**. Si le volet ne
> permet pas de la renseigner, ne pas insister : noter « **point à vérifier par un humain —
> dialogue natif non pilotable** », laisser le diplôme forcé en place, et **le signaler dans les
> données à nettoyer**. Signaler aussi, en **MINEURE**, qu'un motif de révocation — donnée
> d'archive — repose sur un `prompt` natif plutôt que sur un formulaire.

4. Après révocation : statut **Révoqué**, motif conservé et visible, et le diplôme ne doit plus
   pouvoir être regénéré. Un statut révoqué qui redevient éligible ou diplômé est **MAJEUR** :
   la révocation est un état terminal.

### 9. Trace
Onglet **Diplômes octroyés** : A et B présents et datés, C présent avec la mention de
révocation.

---

## Ce qu'on ne teste pas ici, et pourquoi

Un impayé **ne bloque pas** la délivrance du diplôme : il n'existe aucune règle de ce type dans
le code. Ne pas tester un blocage qui n'existe pas, et ne pas signaler son absence comme un
bug. En revanche, le rapport final doit poser la question à l'équipe — « un étudiant qui doit
encore de l'argent peut repartir avec son diplôme, est-ce voulu ? » —, dans la section des
points à trancher, pas dans les anomalies.

---

## Pièges connus

| Piège | Conduite à tenir |
|---|---|
| Diplôme auto-créé à l'ouverture | Normal. Pas de bouton de création à chercher. |
| Exigences régénérées à chaque visite | Une exigence modifiée à la main peut disparaître au rechargement. Si cela se produit, c'est MAJEUR : le dire. |
| Portée « cycle » et non « classe » | Cause la plus probable d'une éligibilité impossible. Contrôle de l'étape 1. |
| Dialogue natif pour la révocation | Non pilotable de façon fiable. Ne pas bloquer le scénario dessus. |
| PDF produit côté navigateur | En cas d'échec, l'erreur est dans la console, pas dans le réseau. |
