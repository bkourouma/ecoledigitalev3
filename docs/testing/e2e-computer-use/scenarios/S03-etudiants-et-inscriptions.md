# S03 — Étudiants et inscriptions en lot

| | |
|---|---|
| **Rôle** | Administrateur |
| **Prérequis** | S02 (`NOM_CLASSE`, les trois `UE_SESSION_ID`) |
| **Produit** | `ETUDIANT_A_ID`, `ETUDIANT_B_ID`, `ETUDIANT_C_ID`, inscriptions actives, `FILIERE_NAV_ID` |
| **Budget** | ~55 appels d'outils |

> Trois étudiants, parce que la suite a besoin de trois destins différents : un qui réussit tout,
> un qui passe par le rattrapage, un qui échoue définitivement. Avec un seul étudiant, on ne
> teste qu'une branche sur trois du calcul de bulletin et de l'éligibilité au diplôme.

---

## Étapes

### 1. Créer les trois étudiants
`/academic/students/new`, trois fois. Le formulaire est long et **presque tout est obligatoire** :

| Champ | Étudiant A | Étudiant B | Étudiant C |
|---|---|---|---|
| Prénom | `Aminata` | `Bakary` | `Chantal` |
| Nom | `Excellente <TAG>` | `Rattrapage <TAG>` | `Ajournee <TAG>` |
| Matricule DESPS | `<TAG>-A` | `<TAG>-B` | `<TAG>-C` |
| Email | `aminata.<tag>@example.test` | `bakary.<tag>@example.test` | `chantal.<tag>@example.test` |
| Téléphone, Sexe, Date et lieu de naissance, Nationalité, Résidence, Sous-préfecture | valeurs plausibles et cohérentes | | |
| Date d'obtention du BAC, Série | année en cours − 1, série `D` | | |
| **Dernier diplôme obtenu (fichier)** | **upload obligatoire** | | |

Bouton **Créer l'étudiant**.

**Sur l'upload obligatoire** — c'est le point le plus fragile du scénario pour un agent :
1. Joindre un petit PDF existant du dépôt (ex. `activite2_test.pdf` à la racine).
2. Si le volet navigateur ne permet pas de choisir un fichier, **ne pas contourner** :
   s'arrêter et signaler « **point à vérifier par un humain — upload de fichier non
   automatisable** », en précisant combien d'étudiants ont pu être créés. Sans ce fichier la
   création échoue, donc la chaîne s'arrête : il faudra créer les trois étudiants à la main
   avant de relancer la campagne.
3. Si l'étudiant est bien créé mais que **l'upload seul** échoue : ce n'est pas bloquant (le
   code tolère cet échec), noter en **MINEURE** et continuer.

### 2. Inscriptions en lot
`/professionnel/admin/inscriptions` :
- *Nom de classe* = `L1 TESTOLOGIE <TAG>`
- Cocher **toutes** les sessions proposées du `Semestre 1 <TAG>`
- Cocher les **trois** étudiants (champ de recherche : filtrer sur `<TAG>`)
- Provenance : laisser vide, elle est testée en S11

Bouton **Enregistrer les inscriptions**.

**Contrôles** :
- Le compteur affiché avant validation vaut `nb_sessions × nb_étudiants`. Avec 2 sessions
  inscriptibles et 3 étudiants : **6**. Noter la valeur réellement affichée.
- L'UE **Conduite** est volontairement **masquée** de la liste des sessions (UE transversale) :
  son absence est le comportement attendu. C'est sa **présence** qui serait une anomalie
  MAJEURE — les étudiants seraient alors inscrits à une UE qui ne doit pas se commander.
- Un étudiant déjà pourvu d'une inscription active n'est pas proposé. Si l'un des trois
  n'apparaît pas alors qu'il vient d'être créé, c'est **bloquant**.

### 3. Vérification
`/professionnel/admin/inscrits`, filtrer sur `<TAG>`. Attendu : trois cartes, une par étudiant,
rattachées à la classe du run. Ouvrir **Détails** sur l'étudiant A seulement, relever
`ETUDIANT_A_ID` et le `filiereId` présent dans l'URL (`FILIERE_NAV_ID`, utile à S08).

**Contrôle de statut** : noter le statut initial des inscriptions — `en_attente_paiement`
attendu. S11 vérifiera son évolution après encaissement. S'il naît déjà à `confirmee` sans
qu'aucun paiement n'existe, c'est une anomalie **MAJEURE** à signaler ici.

---

## Pièges connus

| Piège | Conduite à tenir |
|---|---|
| Upload de diplôme obligatoire | Voir étape 1. Peut arrêter net la campagne : le signaler tôt et précisément. |
| E-mails en `.test` | Volontaire, non routable, aucun envoi réel. Ne jamais saisir une vraie adresse. |
| Conduite absente des sessions | Comportement attendu. C'est sa présence qui serait le bug. |
| Filtre « sans inscription active » | Un étudiant invisible = une inscription fantôme, donc bloquant. |
