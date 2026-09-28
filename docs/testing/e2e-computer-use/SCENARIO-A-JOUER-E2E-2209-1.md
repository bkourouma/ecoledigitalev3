# Scénario E2E à jouer — Programme → Diplôme
### Campagne `E2E-2209-1` · module professionnel · à dérouler avec l'extension navigateur Claude

Fichier autonome : tout ce qu'il faut est ici. Environnement local, web `http://localhost:3000`,
API `http://localhost:4000`, tenant `ecoledigitale`.

---

## 0. Comment s'en servir

Ouvre l'application dans Chrome, puis colle ceci à Claude dans l'extension :

> Tu joues un scénario de test sur EcoleDigitale, en local sur http://localhost:3000. Le scénario
> complet est dans le fichier que je te donne / colle ci-dessous. Suis-le étape par étape, dans
> l'ordre. Tu ne corriges rien et tu ne modifies aucun fichier : tu constates et tu notes.
> Après chaque étape, dis-moi en une ligne si c'est OK ou KO. Quand c'est KO, donne-moi l'URL,
> le geste exact, l'attendu, le constaté, et le message d'erreur s'il y en a un. Si une étape
> bloque la suite, arrête-toi et dis-le-moi au lieu de chercher un contournement.

Trois règles de saisie à lui rappeler, elles évitent 80 % des faux bugs :

1. **Remplir un champ en cliquant dedans puis en tapant**, jamais en écrivant la valeur
   directement dans l'élément — les champs sont des composants React contrôlés, et une valeur
   posée de force n'est pas vue par la page : le formulaire part vide tout en paraissant rempli.
2. **Sortir du champ après la saisie** (Tab ou clic ailleurs) : certains champs n'enregistrent
   qu'à la perte du focus — c'est le cas de la note de conduite, qui n'a aucun bouton.
3. **Valider par un clic sur le bouton, jamais par la touche Entrée** : plusieurs formulaires
   n'écoutent pas Entrée et donnent l'illusion d'une soumission silencieuse.

Et deux particularités de l'environnement, à ne pas confondre avec des pannes :

- une page servie pour la première fois peut mettre **jusqu'à une minute** à compiler ;
- l'API redémarre parfois seule. Sur une erreur 500 ou une connexion refusée : **attendre
  20 secondes et rejouer le geste une fois**. Ce n'est une anomalie que si ça se reproduit.

---

## 1. Connexion

`http://localhost:3000/login` → panneau **Comptes par tenant** → liste *Tenant* →
**ecoledigitale** → cliquer la ligne **`admin@ecoledigitale.local`** (le formulaire se remplit
tout seul, c'est le chemin le plus fiable) → bouton **Se connecter**.

Mot de passe commun à ces comptes : `Password@2025`.

| Rôle | Compte |
|---|---|
| admin | `admin@ecoledigitale.local` |
| enseignant | `adjoua.brou@ecoledigitale.test` |
| étudiant | `adama.kouassi.001@etu.ecoledigitale.ci` |
| parent | `bernard.kouassi.p01@parents.ecoledigitale.ci` |

Le bouton affiche « Connexion... » pendant une dizaine de secondes : c'est normal.

---

## 2. Ce qui est DÉJÀ FAIT — ne pas le refaire

Vérifié en base juste avant d'écrire ce fichier.

| Objet | Libellé | Identifiant | État |
|---|---|---|---|
| Cycle | `LICENCE E2E-2209-1` | `cd818dac-109b-4b7c-9cd5-9afb2790bc68` | ✅ |
| Filière | `TESTOLOGIE E2E-2209-1` | `4a054d66-5a35-444e-a324-38ff209f3f3d` | ✅ |
| Classe | `LICENCE 1 TESTOLOGIE E2E-2209-1` (code `L1TST01`) | `58eafe7d-35a1-4b2f-8062-f69bd9794ffb` | ✅ |
| UE 1 | `Comptabilité E2E-2209-1` — **7 UV** | `6baef66e-b5dc-4d9f-9383-f2423cd5ee2c` | ✅ |
| UE 2 | `Droit E2E-2209-1` — **5 UV** | `b8fd17b5-cc88-4b3b-958b-74ad5b95c16c` | ✅ |
| UE 3 | `Conduite E2E-2209-1` — **1 UV** | `7017bd0c-8b62-4e28-9a31-335561d197ff` | ✅ |
| ECUE 1 | `Comptabilité générale E2E-2209-1` — 4 crédits → UE 1 | `e9a8847d-52d7-4d8f-86d3-ff9c6346d863` | ✅ |
| ECUE 2 | `Comptabilité analytique E2E-2209-1` — 3 crédits → UE 1 | `a34ef3b1-a115-413b-9a3c-28e207ed4b56` | ✅ |

> Dans tous les écrans du module professionnel, le champ **« Classe »** désigne
> `LICENCE 1 TESTOLOGIE E2E-2209-1`. C'est le même objet que l'API appelle parfois `filiere_id` :
> trois noms, une seule chose.

**Reprise du scénario à l'étape 3 ci-dessous.**

---

## 3. Terminer le socle pédagogique

### 3.1 — ECUE 3, sur l'UE Droit
`/professionnel/admin/matieres/new` → *Classe* `LICENCE 1 TESTOLOGIE E2E-2209-1` →
*UE* `Droit E2E-2209-1` → une ligne :

| Code | Libellé | Crédits |
|---|---|---|
| `ECUE-DC-E2E-2209-1` | `Droit civil E2E-2209-1` | `5` |

Bouton **Créer l'ECUE**.

### 3.2 — ECUE 4, la conduite, sur l'UE Conduite
Même écran → *UE* `Conduite E2E-2209-1` → une ligne :

| Code | Libellé | Crédits |
|---|---|---|
| `EC-CON-E2E-2209-1` | `Conduite E2E-2209-1` | `1` |

**Le libellé doit commencer par le mot « Conduite »** et le code contenir `EC-CON` : c'est à ça
que le serveur reconnaît la note de conduite. Un libellé préfixé par le tag casserait la
détection, et la saisie des notes de l'étape 6 serait bloquée sans que rien ne dise pourquoi.

### 3.3 — Vérifier le rattachement
`/professionnel/admin/matieres`, filtré sur la classe. Attendu : **4 ECUE**, rattachées
respectivement à Comptabilité (2), Droit (1), Conduite (1).

> La création d'une ECUE rattachée fait **deux appels** : la création, puis le rattachement à
> l'UE. Un message « N opération(s) en échec » veut dire que l'ECUE existe mais **flotte**, sans
> UE. À vérifier ici, pas plus tard.

### 3.4 — Le semestre
`/professionnel/admin/semestres/new` → *Classe* `LICENCE 1 TESTOLOGIE E2E-2209-1` →
*Libellé* `Semestre 1 E2E-2209-1` → cocher **les trois UE** → bouton **Créer le semestre**.

> Ordre contre-intuitif mais normal : ici, les UE existent **avant** le semestre, qui n'est
> qu'un regroupement d'UE déjà créées.

---

## 4. Ouvrir la classe, planifier, désigner les signataires

### 4.1 — Enseignant
`/academic/teachers/new` → *Prénom* `Awa`, *Nom* `Formatrice E2E-2209-1`, *Email*
`awa.formatrice.e2e22091@example.test`, *Type de contrat* **Vacataire** →
bouton **Créer l'enseignant**.

> Le mot de passe est généré par le serveur et envoyé par e-mail à une adresse en `.test`, donc
> non routable. **S'il s'affiche à l'écran, le noter** : l'étape 5 en aura besoin. Sinon, on se
> rabattra sur `adjoua.brou@ecoledigitale.test` / `Password@2025`, en le signalant.

### 4.2 — Salle
`/academic/classrooms/new` → *Nom* `Salle E2E-2209-1`, *Code* `SE01` → bouton **Créer**.

### 4.3 — Ouverture de classe
`/professionnel/admin/sessions/new` (titre à l'écran : « Ouvrir une classe ») :

| Champ | Valeur |
|---|---|
| Classe | `LICENCE 1 TESTOLOGIE E2E-2209-1` |
| Nom de la classe | `L1 TESTOLOGIE E2E-2209-1` |
| Semestres couverts (portée) | cocher `Semestre 1 E2E-2209-1` |
| Semestre | `Semestre 1 E2E-2209-1` |
| Date de début | premier jour du mois en cours |
| Date de fin | dernier jour du mois suivant |
| Enseignant par ECUE | `Awa Formatrice` sur **les quatre** ECUE |

Bouton **Créer**.

**À vérifier** : l'opération crée **une session par UE**, donc **3 sessions** dans
`/professionnel/admin/sessions`. Un autre nombre est une anomalie — préciser lequel.

Le *nom de classe* `L1 TESTOLOGIE E2E-2209-1` devient la clé de navigation de tous les écrans
suivants : notes, présences, bulletins, planning. À retenir.

### 4.4 — Emploi du temps
`/professionnel/admin/planning` → *Nom de la classe* `L1 TESTOLOGIE E2E-2209-1` →
*Semestre* `Semestre 1 E2E-2209-1`. Garder les dates pré-remplies. Trois créneaux, via
**Ajouter un créneau** :

| ECUE | Jour | Début | Fin | Salle |
|---|---|---|---|---|
| Comptabilité générale | Lundi | 08:00 | 10:00 | `Salle E2E-2209-1` |
| Comptabilité analytique | Mardi | 10:00 | 12:00 | `Salle E2E-2209-1` |
| Droit civil | Mercredi | 14:00 | 16:00 | `Salle E2E-2209-1` |

Bouton **Enregistrer 3 créneau(x)**.

**À vérifier** : l'enseignant n'est pas saisissable, il est repris de l'affectation de 4.3.
Il doit apparaître sur les trois créneaux. Si le sélecteur *Nom de la classe* est vide, c'est
que l'ouverture de classe n'a pas produit ce qu'elle annonçait — bloquant.

### 4.5 — Les quatre signataires
`/professionnel/admin/signataires` — **quatre fiches, quatre boutons Enregistrer distincts**.
N'en oublier aucune : un signataire manquant ne se verra que sur le PDF du diplôme, à l'étape 9.

| Fiche | Nom | Qualité | Fonction |
|---|---|---|---|
| Attestation de réussite | `Koffi Signataire E2E-2209-1` | `Enseignant Chercheur` | `Directeur des études` |
| Diplôme — gauche | `Aya Gauche E2E-2209-1` | — | `Le Directeur Général` |
| Diplôme — droite | `Yao Droite E2E-2209-1` | — | `Le Président du Jury` |
| Attestation d'authenticité | `Ama Authentique E2E-2209-1` | — | `Le Secrétaire Général` |

Recharger la page ensuite : les quatre noms doivent tenir.

---

## 5. Les trois étudiants et leurs inscriptions

Trois étudiants, parce que la suite a besoin de trois destins : **A réussit tout**, **B passe
par le rattrapage**, **C est ajourné**. Avec un seul, on ne teste qu'une branche sur trois du
calcul de bulletin et de l'éligibilité au diplôme.

### 5.1 — Créer les étudiants
`/academic/students/new`, trois fois. Presque tous les champs sont obligatoires.

| Champ | A | B | C |
|---|---|---|---|
| Prénom | `Aminata` | `Bakary` | `Chantal` |
| Nom | `Excellente E2E-2209-1` | `Rattrapage E2E-2209-1` | `Ajournee E2E-2209-1` |
| Matricule DESPS | `E2E-2209-1-A` | `E2E-2209-1-B` | `E2E-2209-1-C` |
| Email | `aminata.e2e22091@example.test` | `bakary.e2e22091@example.test` | `chantal.e2e22091@example.test` |
| Autres champs | valeurs plausibles et cohérentes (téléphone, sexe, naissance, nationalité, résidence, sous-préfecture, BAC série D l'an dernier) | | |

⚠️ **Le champ « Dernier diplôme obtenu (fichier) » est un upload obligatoire.** C'est le point
le plus pénible à automatiser : si Claude n'arrive pas à joindre un fichier, **fais-le
toi-même** — n'importe quel petit PDF convient, par exemple `activite2_test.pdf` à la racine du
dépôt. Sans ce fichier, la création échoue et toute la suite est bloquée.

### 5.2 — Inscrire en lot
`/professionnel/admin/inscriptions` → *Nom de classe* `L1 TESTOLOGIE E2E-2209-1` → cocher
**toutes** les sessions proposées → chercher `E2E-2209-1` et cocher **les trois** étudiants →
laisser la provenance vide → bouton **Enregistrer les inscriptions**.

**À vérifier** :
- le compteur avant validation vaut `sessions × étudiants` (attendu **6** : 2 sessions
  inscriptibles × 3 étudiants) ;
- l'UE **Conduite** est **absente** des sessions proposées : c'est voulu, elle est transversale.
  C'est sa *présence* qui serait un bug ;
- noter le statut initial des inscriptions (`en_attente_paiement` attendu).

---

## 6. Faire vivre le semestre : séances, présences, notes

### 6.1 — Séances et présences (rôle **enseignant**)
Se déconnecter, se reconnecter avec le compte enseignant.

> Les séances **ne se génèrent pas** depuis l'emploi du temps : c'est l'enseignant qui les crée.
> Ne pas chercher un bouton « générer les séances », il n'existe pas.

`/teacher/professional-seances` → session de l'UE `Comptabilité E2E-2209-1`, ECUE
`Comptabilité générale E2E-2209-1` → créer **trois séances** de 2 h, trois lundis consécutifs,
08:00–10:00.

Puis la feuille d'appel de chacune :

| Séance | Aminata (A) | Bakary (B) | Chantal (C) |
|---|---|---|---|
| 1 | Présent | Présent | Absent |
| 2 | Présent | Retard | Absent |
| 3 | Présent | Présent | Absent |

Rouvrir la feuille de la séance 1 une fois : les statuts doivent tenir.

### 6.2 — Justifier une absence (rôle **admin**)
Se reconnecter en admin. `/professionnel/admin/presences` → classe `L1 TESTOLOGIE E2E-2209-1` →
séance **2** → ligne de Chantal → bouton **Justifier**, motif `Certificat médical E2E-2209-1` →
**Enregistrer**. Le statut passe d'« Absent » à « Excusé ».

Tester aussi **Retirer la justification** puis re-justifier : le statut doit redescendre à
« Absent » puis remonter à « Excusé ».

### 6.3 — Relever la synthèse de présence
`/professionnel/admin/presences`, vue par étudiant. Noter les chiffres affichés **sans les
corriger mentalement**, puis les comparer à ce décompte fait à la main sur 3 séances de 2 h :

- **A** : 3 présences → **100 %**, 0 h d'absence.
- **B** : 2 présences + 1 retard → *quel traitement pour le retard ?* Noter la règle que le
  chiffre affiché implique.
- **C** : 3 absences dont 1 excusée → 6 h si l'excusée compte, 4 h sinon. Noter laquelle des
  deux lectures correspond à l'écran.

Le sort du retard et de l'absence excusée n'est fixé nulle part : ce n'est pas un bug, c'est une
**question à trancher** — à porter dans le compte rendu.

---

## 7. Les notes — le cœur du test

`/professionnel/admin/notes` → *Nom de classe* `L1 TESTOLOGIE E2E-2209-1` →
*Semestre* `Semestre 1 E2E-2209-1`.

**Barème appliqué** : `note ECUE = moyenne des devoirs × 0,4 + examen × 0,6`.
Validée à **≥ 10**, **éliminatoire en dessous de 5**.

Les valeurs ci-dessous ne sont pas décoratives : elles sont choisies pour que chaque moyenne
tombe juste et que le moindre écart soit indiscutable. Les saisir telles quelles.

### ECUE `Comptabilité générale E2E-2209-1` (4 crédits)

| Étudiant | Devoir 1 | Devoir 2 | Examen | **Note attendue** | État |
|---|---|---|---|---|---|
| A | 12 | 16 | 15 | **14,6** | validée |
| B | 8 | 10 | 7 | **7,8** | insuffisante |
| C | 4 | 2 | 3 | **3,0** | **éliminatoire** |

### ECUE `Comptabilité analytique E2E-2209-1` (3 crédits)

| Étudiant | Devoir 1 | Examen | **Note attendue** |
|---|---|---|---|
| A | 15 | 15 | **15,0** |
| B | 10 | 10 | **10,0** |
| C | 11 | 11 | **11,0** |

### ECUE `Droit civil E2E-2209-1` (5 crédits)

| Étudiant | Devoir 1 | Examen | **Note attendue** |
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

> La conduite s'enregistre **à la sortie du champ**, sans bouton. Sortir du champ, puis
> recharger la page pour vérifier que les trois notes sont là.

### Contrôle intermédiaire volontaire
**Avant** de saisir la conduite, tenter une fois le calcul des notes. Un blocage explicite est
le comportement attendu — relever le message. Un calcul qui passe sans conduite serait un bug :
la conduite entre dans la moyenne, un semestre calculé sans elle est faux.

### Après recalcul, relever les moyennes d'UE

| UE | A | B | C |
|---|---|---|---|
| Comptabilité (CG + CA) | **14,8** validée | **8,9** non validée | **7,0** non validée |
| Droit (DC) | **13,0** validée | **14,0** validée | **6,0** non validée |
| Conduite | **16,0** validée | **14,0** validée | **12,0** validée |

### Décisions de semestre attendues

| Étudiant | Décision | Pourquoi |
|---|---|---|
| A | **Admis** | toutes ses UE sont validées |
| B | **Rattrapage** | UE Comptabilité à 8,9 — **il n'y a pas de compensation entre UE** |
| C | **Rattrapage** | deux UE non validées, dont une avec note éliminatoire |

Si B ressort « Admis » avec une UE à 8,9, ce n'est pas un arrondi : c'est la règle de
non-compensation qui ne s'applique pas. À signaler comme grave.

### Dernier contrôle de l'étape
Ouvrir `/professionnel/admin/bulletins` : **B et C ne doivent avoir aucun bulletin
consultable**, puisqu'ils attendent la session 2. Un bulletin disponible à ce stade serait
produit sur des notes non définitives.

---

## 8. Rattrapages, puis bulletins

### 8.1 — La liste des rattrapages
`/professionnel/admin/notes/rattrapages`. Attendu :

| Étudiant | ECUE attendues |
|---|---|
| A | **aucune** — il ne doit pas figurer dans la liste |
| B | `Comptabilité générale` (7,8) |
| C | `Comptabilité générale` (3,0) **et** `Droit civil` (6,0) |

`Comptabilité analytique` de B vaut exactement **10,0** : c'est validé, cette ECUE ne doit
**pas** apparaître. C'est un test de frontière volontaire.

### 8.2 — Saisir la session 2

| Étudiant | ECUE | Note S2 | Effet attendu |
|---|---|---|---|
| B | Comptabilité générale | **13** | remplace 7,8 → UE Comptabilité `(13 + 10)/2 = 11,5` → validée |
| C | Comptabilité générale | **4** | remplace 3,0 → **toujours éliminatoire** |
| C | Droit civil | **12** | remplace 6,0 → UE Droit validée |

**Relever la note d'ECUE effectivement retenue pour B.** Si ce n'est pas 13,0 — par exemple
11,4, ce qui correspondrait à une repondération réutilisant les devoirs de session 1 — ce n'est
pas forcément un bug : les deux lectures se défendent et le code ne tranche pas. **Noter le
chiffre obtenu** et poser la question. En revanche, si la note de session 1 continue de
l'emporter, c'est un vrai défaut.

### 8.3 — Décisions définitives

| Étudiant | Décision | Pourquoi |
|---|---|---|
| A | **Admis** | inchangé |
| B | **Admis** | toutes ses UE validées après rattrapage |
| C | **Ajourné** | UE Comptabilité non validée, note éliminatoire même en session 2 |

Si C ressort « Admis », la règle éliminatoire ne s'applique pas. S'il reste « Rattrapage » sans
fin, son dossier n'atteint jamais d'état terminal. Les deux sont graves.

### 8.4 — Générer les bulletins
`/professionnel/admin/bulletins` → générer pour le semestre. Trois bulletins attendus.

Sur le bulletin d'**Aminata**, vérifier : 14,6 · 15,0 · UE Comptabilité 14,8 · 13,0 · UE Droit
13,0 · conduite 16,0 · **Admis** · crédits.

> **Sur les crédits**, regarder de près : deux totaux coexistent dans l'application, les
> **crédits d'ECUE** (4 + 3 + 5 + 1 = **13**) et les **UV d'UE** (7 + 5 + 1 = **13** aussi, elles
> ont été renseignées). Noter lequel des deux le bulletin affiche. Un bulletin qui annonce
> **0 crédit** pour un étudiant admis est un défaut — et il annoncerait d'avance un problème à
> l'étape 9.

Vérifier aussi que **C, ajourné, a bien un bulletin** : un échec se documente, il ne disparaît
pas.

### 8.5 — PDF et clôture
Éditer le PDF d'un bulletin (A), puis celui de C. Vérifier en-tête, identité, notes conformes à
l'écran, décision présente, aucune zone vide.

> La classe s'appelle `LICENCE 1 …`, ce qui déclenche un **gabarit de bulletin différent** de
> celui des autres niveaux. Un rendu décalé ne se verrait que sur Licence 1 et 2 : le préciser
> si ça arrive.

Puis **clôturer le semestre**. Ensuite, retourner dans les notes et tenter d'en modifier une :
le refus est le comportement attendu. Une note encore modifiable après clôture permettrait de
contredire un bulletin déjà signé.

---

## 9. LE DIPLÔME

`/professionnel/admin/diplomes`.

> Deux choses à savoir avant de chercher des boutons qui n'existent pas :
> le diplôme **n'est pas créé à la main** — il est créé et resynchronisé à chaque ouverture de
> la page ; et il couvre un **cycle entier**, déduit du nom de la classe, pas une seule classe.

### 9.1 — Contrôle d'isolement, à faire en premier
Onglet **UE requises** : il doit contenir **exactement** les trois UE du run — Comptabilité,
Droit, Conduite — et **rien d'autre**.

Si des UE étrangères apparaissent, arrêter et le signaler : cela voudrait dire qu'en production
un diplôme peut exiger les UE d'une autre filière. Noter le nom des UE intruses et leur classe
d'origine.

### 9.2 — Le total d'UV exigé
Relever l'UV requise et le détail par UE. **Attendu : 13 UV** (7 + 5 + 1).

Si le total affiché est **0**, le critère de crédits est inopérant — « 0 acquis ≥ 0 requis » est
toujours vrai — et l'éligibilité ne repose plus que sur la validation des UE. À signaler avec la
valeur exacte.

### 9.3 — Statuts attendus

| Étudiant | État |
|---|---|
| A | **Éligible** |
| B | **Éligible** (après rattrapage) |
| C | ni éligible ni diplômé, bouton **Générer le diplôme** **désactivé** |

A ou B non éligible au terme d'un parcours réussi = le diplôme est inatteignable.
C éligible = un étudiant ajourné serait diplômé : c'est le pire défaut possible ici.

### 9.4 — Délivrer
Bouton **Générer le diplôme** sur la ligne d'Aminata → l'octroi se fait, puis le PDF sort.

Sur le PDF, vérifier : identité `Aminata Excellente E2E-2209-1`, matricule `E2E-2209-1-A`,
intitulé du cycle, **signataire de gauche `Aya Gauche`**, **signataire de droite `Yao Droite`**,
crédits imprimés, aucune zone vide.

Puis recharger la page : le badge doit tenir sur **Diplômé**. Un retour à « Éligible » après
rechargement voudrait dire que l'octroi n'a pas été enregistré.

Faire de même pour **Bakary**, sans regénérer le PDF : l'enjeu est qu'un parcours passé par le
rattrapage aboutisse au même résultat qu'un parcours sans faute.

### 9.5 — Attestation d'authenticité
Sur la fiche du diplôme d'Aminata, bouton **Authenticité** : un second document, signé
`Ama Authentique`.

### 9.6 — Octroi forcé puis révocation, sur Chantal
Séquence volontairement anormale, pour tester le garde-fou.

1. Fiche du diplôme, onglet des candidats, ligne de Chantal → **Forcer l'octroi**. Une
   confirmation est attendue : si ça passe sans rien demander, un clic malheureux diplôme un
   étudiant ajourné.
2. Vérifier qu'elle apparaît **Diplômée**.
3. Bouton **Révoquer**, motif `Octroi de test E2E-2209-1`.
   ⚠️ Le motif passe par une **boîte de dialogue native du navigateur**. Si l'extension ne peut
   pas la remplir, **fais-le toi-même** — sinon le diplôme forcé reste en place et il faudra
   s'en souvenir au nettoyage.
4. Après révocation : statut **Révoqué**, motif visible, et plus aucune regénération possible.
   La révocation est un état terminal.

### 9.7 — Ce qu'on ne teste pas, et pourquoi
Un impayé **ne bloque pas** la délivrance du diplôme : aucune règle de ce type n'existe dans le
code. Ne pas tester un blocage inexistant. En revanche, la question mérite d'être posée à
l'équipe : *un étudiant qui doit encore de l'argent repart avec son diplôme, est-ce voulu ?*

---

## 10. Attestation de réussite

`/professionnel/admin/attestations`, filtré sur la classe.

> L'attestation n'est pas un petit diplôme : elle se calcule sur une **filière et une année**,
> là où le diplôme se calcule sur un **cycle**. Les deux écrans peuvent diverger sans que ce
> soit un bug.

| Étudiant | Statut attendu |
|---|---|
| A | Validés |
| B | Validés |
| C | `1 UE restante` — **1, pas 2** : son UE Droit a été validée en session 2 |

Générer l'attestation d'Aminata. Vérifier le signataire **`Koffi Signataire`** avec sa
**qualité** `Enseignant Chercheur` — ce champ n'existe que sur ce document, et c'est justement
celui qui peut se perdre.

Vérifier enfin que **Chantal ne peut pas** obtenir d'attestation.

---

## 11. Côté étudiant et parent — la preuve que le diplôme est délivré

> Un diplôme que l'administration voit mais que l'étudiant ne voit pas n'est pas délivré. C'est
> cette étape qui distingue « octroyé en base » de « remis ».

**Difficulté connue** : les comptes des étudiants créés à l'étape 5 ont un mot de passe généré,
envoyé à des adresses non routables. Trois options, dans l'ordre :
1. le mot de passe a été noté à la création → l'utiliser ;
2. le réinitialiser depuis la fiche de l'étudiant côté admin — c'est le chemin qu'un vrai
   établissement utiliserait ;
3. à défaut, se connecter avec le compte étudiant de démonstration pour vérifier seulement que
   la page fonctionne — et **dire clairement** que la visibilité du diplôme du run n'a pas pu
   être vérifiée. Ne pas présenter ce repli comme une validation.

### 11.1 — Étudiant diplômé
Compte d'Aminata → `/student/diplomes`. Le diplôme du cycle doit figurer dans « Diplômes
obtenus », téléchargeable, à son nom. **Absent alors qu'il a été octroyé = la délivrance
n'arrive pas jusqu'au bénéficiaire.** Relever aussi le nombre de crédits affiché.

### 11.2 — Étudiante révoquée
Compte de Chantal → `/student/diplomes`. **Aucun diplôme obtenu**, rien de téléchargeable. Si
le document révoqué reste visible, il continue de circuler.

### 11.3 — Parent
Créer un parent (`/academic/parents/new` : `Fatou Parente E2E-2209-1`,
`fatou.parente.e2e22091@example.test`) et le rattacher à Aminata
(`/academic/parents/assign`). Puis, connecté en parent :
`/parent/professionnel/diplomes` → sélectionner Aminata.

Attendu : le diplôme visible **en lecture seule**, aucune action d'octroi ou de révocation, et
surtout **aucun autre enfant** dans le sélecteur. Un enfant non rattaché qui apparaît est une
fuite de confidentialité — à signaler immédiatement, sans recopier les données de l'élève
concerné.

### 11.4 — Cloisonnement
Toujours connecté en parent, ouvrir directement `/professionnel/admin/diplomes`.

- refus explicite ou redirection → correct ;
- page **vide sans message** → défaut d'ergonomie connu : ces pages ne sont protégées que côté
  serveur, rien ne fuite mais l'utilisateur ne comprend pas ;
- **des données visibles** → faille, à remonter tout de suite.

---

## 12. Comment me remonter les résultats

Le plus utile, pour chaque anomalie, tient en six lignes :

```
Étape : 9.3
URL : http://localhost:3000/professionnel/admin/diplomes
Geste : clic sur « Générer le diplôme » ligne Aminata
Attendu : octroi + PDF
Constaté : « ... » (message exact)
Requête : POST /api/v1/professional/diplomas/<id>/award → 500
```

Ce qui fait perdre un aller-retour : « ça ne marche pas » sans le message, une capture d'écran à
la place de la requête, ou plusieurs symptômes différents mélangés dans une seule remontée.

Quand tu auras fini — ou quand ça bloquera — donne-moi le tout : je produis le rapport
d'implémentation, avec les correctifs priorisés par nombre d'étapes débloquées.

---

## Annexe — les deux autres chaînes

Elles existent déjà, en fichiers séparés, et sont indépendantes de celle-ci :

- **Volet financier** — [S11 encaissement](scenarios/S11-bareme-et-encaissement.md) ·
  [S12 commissions](scenarios/S12-prospection-et-commissions.md) ·
  [S13 rémunération formateur](scenarios/S13-remuneration-formateur.md) ·
  [S14 inscription publique payante](scenarios/S14-inscription-publique-payante.md)
- **Parcours académique classique** — [S15 socle](scenarios/S15-socle-academique.md) ·
  [S16 notes et bulletins](scenarios/S16-academique-notes-et-bulletins.md)

À savoir avant de les ouvrir : le parcours académique **ne délivre aucun diplôme** — il s'arrête
aux bulletins et relevés ; et son écran de moyennes ne liste que les classes dont le cycle
contient « BTS », d'où le nommage imposé dans S15.
