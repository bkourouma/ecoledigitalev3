# S15 — Parcours académique : socle, année, classe, inscription

| | |
|---|---|
| **Rôle** | Administrateur |
| **Prérequis** | Aucun — chaîne indépendante, peut tourner en parallèle de la chaîne A |
| **Produit** | `CYCLE_BTS_ID`, `PROG_ACA_ID`, `ANNEE_ID`, `PERIODE_ID`, `CLASSE_ANNEE_ID`, une inscription académique |
| **Budget** | ~60 appels d'outils |

> **Le parcours académique ne délivre pas de diplôme.** Il s'arrête aux bulletins et aux relevés
> de notes ; le diplôme n'existe que dans le module professionnel. Ce n'est pas une anomalie à
> signaler : c'est la conception actuelle. Ce que cette chaîne vérifie, c'est que le parcours va
> bien jusqu'à **son** terme à lui.

---

## Un choix de nommage à comprendre avant de commencer

Le cycle de cette chaîne doit s'appeler **`BTS <TAG>`** — le mot `BTS` est obligatoire.

Raison : l'écran de saisie des moyennes et de génération des bulletins ne liste que les classes
dont le **cycle contient « bts »** dans son nom ou son code. Avec un cycle nommé autrement, le
sélecteur de classe reste vide et la chaîne s'arrête sans message d'erreur.

Ce filtre est **lui-même une anomalie MAJEURE à signaler une fois** (« un établissement qui
n'ouvre pas de BTS ne peut générer aucun bulletin »), mais on le contourne ici sciemment —
c'est le seul contournement autorisé de toute la campagne, et il est documenté comme tel. Le
signaler dès l'étape 1, puis jouer le reste normalement.

---

## Étapes

### 1. Cycle
`/academic/cycles/new` → *Nom du cycle* `BTS <TAG>`, *Type* **Académique**,
*Niveau de certification* `Bac+2`. **Enregistrer**.

### 2. Filière
`/academic/programmes/new` → `GESTION <TAG>`. **Enregistrer**.

### 3. Type de bilan
`/annee-academique/types-de-bilan` → libellé `Semestriel <TAG>`. **Ajouter**.

> Cette page n'est accessible que par URL directe (absente du menu). Son absence du menu se
> signale en **MINEURE**, une fois : c'est pourtant un prérequis obligatoire de la création des
> matières, donc un administrateur non guidé se retrouve bloqué sans savoir pourquoi.

### 4. Classe (au sens « programme »)
`/academic/classes/new` → *Cycle* `BTS <TAG>`, *Filière* `GESTION <TAG>`,
*Nom de la classe* `BTS 1 GESTION <TAG>`, *Code* `B1G<NN>`. **Enregistrer**.
Relever `PROG_ACA_ID`.

### 5. Matières
`/academic/courses/new` → *Programme* `BTS 1 GESTION <TAG>`, *Type de bilan* `Semestriel <TAG>`.

| Matière | COEF |
|---|---|
| `Mathématiques <TAG>` | 3 |
| `Économie <TAG>` | 2 |

**Enregistrer**. Les coefficients sont choisis pour rendre la moyenne pondérée vérifiable en
S16 : les saisir exactement.

### 6. Salle
`/academic/classrooms/new` → `Salle ACA <TAG>`, code `SA<NN>`. **Créer**.

### 7. Année académique et période
`/annee-academique/demarrer` :
1. *Nom* de l'année : `<année en cours>-<année+1> <TAG>` → **Créer**, puis **Activer**.
2. Période : *Nom* `Semestre 1 <TAG>`, dates couvrant le mois en cours et le suivant → valider.

**Contrôle** : l'activation est un prérequis de tout le reste. Si l'année n'est pas activable,
c'est **BLOQUANT**. Noter aussi ce qu'il advient de l'année précédemment active — bascule
silencieuse ou avertissement.

### 8. Classe d'année
`/annee-academique/ajouter-classe/new` → *Programme* `BTS 1 GESTION <TAG>`,
*Nom de la classe* `BTS1-G-<TAG>`. **Créer la classe**. Relever `CLASSE_ANNEE_ID`.

> Deux objets portent le nom de « classe » dans ce parcours : celui de l'étape 4 (un programme)
> et celui-ci (une classe rattachée à une année). Le registre doit distinguer les deux sans
> ambiguïté, sinon S16 se trompera de cible.

### 9. Étudiant
`/academic/students/new` → `Diallo Academique <TAG>`, matricule `<TAG>-ACA`, e-mail
`diallo.<tag>@example.test`. Mêmes réserves qu'en S03 sur l'**upload obligatoire** du dernier
diplôme : en cas d'impossibilité, s'arrêter et le signaler plutôt que de contourner.

### 10. Inscription
`/annee-academique/inscription/new` → *Étudiant* celui de l'étape 9, *Classe* `BTS1-G-<TAG>`,
date d'inscription du jour, frais laissés à leurs valeurs par défaut. Valider.

**Contrôle** : vérifier dans `/annee-academique/classes/<CLASSE_ANNEE_ID>` (onglet Étudiants)
que l'étudiant y figure. Une inscription enregistrée mais invisible dans sa classe est
**BLOQUANTE** pour S16.

---

## Pièges connus

| Piège | Conduite à tenir |
|---|---|
| Filtre « BTS » codé en dur | Signalé en étape 1, puis contourné par le nommage. Seul contournement autorisé de la campagne. |
| Deux sens de « classe » | Programme (étape 4) vs classe d'année (étape 8). À distinguer au registre. |
| Type de bilan hors menu | Prérequis invisible des matières. MINEURE, mais à signaler. |
| Année non activée | Bloque `ajouter-classe`, `inscription` et `moyennes-semestre` d'un coup, avec un simple bandeau. |
