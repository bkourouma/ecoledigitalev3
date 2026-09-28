# S01 — Socle pédagogique : cycle, filière, classe, UE, ECUE, semestre

| | |
|---|---|
| **Rôle** | Administrateur |
| **Prérequis** | Aucun (premier scénario de la chaîne A) |
| **Produit** | `CYCLE_ID`, `FILIERE_ID`, `CLASSE_ID`, `UE_1..3_ID`, `ECUE_1..4_ID`, `SEMESTRE_ID` |
| **Budget** | ~45 appels d'outils |

> **Ordre contre-intuitif, ne pas improviser** : dans ce module, les **UE se créent avant le
> semestre**. Un semestre n'est qu'un regroupement d'UE déjà existantes. Créer le semestre en
> premier est impossible — ce n'est pas un bug.

---

## Nommage imposé

`<TAG>` = tag de run, ex. `E2E-2209-1`.

| Objet | Valeur exacte à saisir |
|---|---|
| Cycle | `LICENCE <TAG>` — type **Académique** |
| Filière | `TESTOLOGIE <TAG>` |
| Classe | Nom `LICENCE 1 TESTOLOGIE <TAG>` · Code `L1TST<NN>` (≤ 20 caractères) |
| UE 1 | Code `UE-COMPTA-<TAG>` · Libellé `Comptabilité <TAG>` · Prix `150000` |
| UE 2 | Code `UE-DROIT-<TAG>` · Libellé `Droit <TAG>` · Prix `100000` |
| UE 3 (transversale) | Code `UE-CONDUITE-<TAG>` · Libellé `Conduite <TAG>` · Prix `0` |
| ECUE 1 | Code `ECUE-CG-<TAG>` · Libellé `Comptabilité générale <TAG>` · Crédits `4` → UE 1 |
| ECUE 2 | Code `ECUE-CA-<TAG>` · Libellé `Comptabilité analytique <TAG>` · Crédits `3` → UE 1 |
| ECUE 3 | Code `ECUE-DC-<TAG>` · Libellé `Droit civil <TAG>` · Crédits `5` → UE 2 |
| ECUE 4 (conduite) | Code `EC-CON-<TAG>` · Libellé `Conduite <TAG>` · Crédits `1` → UE 3 |
| Semestre | `Semestre 1 <TAG>` — UE cochées : **UE 1, UE 2 et UE 3** |

**Deux contraintes de nommage qui ne se négocient pas :**

1. L'ECUE 4 n'est reconnue comme « conduite » par le serveur que si son **libellé commence par
   « Conduite »** ou si son **code contient `EC-CON`**. D'où le tag placé en **suffixe**, jamais
   en préfixe, sur cette ligne-là. Si la conduite n'est pas reconnue, la saisie des notes de S05
   est bloquée et toute la chaîne aval tombe avec elle.
2. La spécialité `TESTOLOGIE <TAG>` doit être unique en base. Le diplôme (S08) se calcule sur un
   **cycle entier** déduit du nom de la classe : une spécialité déjà existante ferait entrer les
   UE de vraies filières dans le périmètre du diplôme de test, qui deviendrait inatteignable.

---

## Étapes

### 1. Connexion
`/login` → compte administrateur, tenant `ecoledigitale`. Attendu : redirection vers
`/tableau-de-bord`.

### 2. Cycle
`/academic/cycles/new` → *Nom du cycle* = `LICENCE <TAG>`, *Type* = **Académique**.
Bouton **Enregistrer**. Attendu : retour à la liste, cycle présent.

### 3. Filière
`/academic/programmes/new` (intitulé à l'écran : « Nouvelle filière ») → *Nom de la filière* =
`TESTOLOGIE <TAG>`. Bouton **Enregistrer**. Attendu : retour à `/academic/programmes`.

> Le menu dit « Filières » là où l'URL dit `programmes` : c'est connu, ce n'est pas une anomalie.

### 4. Classe
`/academic/classes/new` → *Cycle* = celui de l'étape 2, *Filière* = celle de l'étape 3,
*Nom de la classe* = `LICENCE 1 TESTOLOGIE <TAG>`, *Code* = `L1TST<NN>`.
Bouton **Enregistrer**.

**Contrôle** : relever `CLASSE_ID` dans l'URL de la fiche ou dans la réponse de
`POST /api/v1/programmes`. C'est cet identifiant que tout le module professionnel appellera
« Classe », et parfois `filiere_id` dans ses requêtes — les deux désignent bien cet objet-ci.

### 5. Les trois UE
`/professionnel/admin/ue/new`, une par UE : *Classe*, *Code*, *Libellé*, *Prix*.
Bouton **Créer l'UE**. Après chaque création, relever l'UUID dans l'URL de redirection
(`/professionnel/admin/ue/<uuid>`).

**Contrôle à faire une seule fois, sur l'UE 1** — le formulaire n'expose **aucun champ UV /
crédits**. Ouvrir la fiche de l'UE et chercher un endroit où renseigner les UV.
- Si un champ existe sur la fiche détail : renseigner **7 UV** pour l'UE 1, **5** pour l'UE 2,
  **1** pour l'UE 3, et noter où il se trouve.
- Si aucun champ n'existe nulle part : **anomalie MAJEURE** — les UV restent à 0, alors que
  l'éligibilité au diplôme (S08) compare la somme des UV validées au total requis. La noter et
  **continuer** : la chaîne reste jouable, et S08 devra alors établir ce que vaut un diplôme
  délivré sur une exigence de 0 UV.

### 6. Les quatre ECUE
`/professionnel/admin/matieres/new` (intitulé : « Nouvelles ECUE »). Sélectionner *Classe* puis
*UE* de rattachement, puis remplir les lignes (*Code*, *Libellé*, *Crédits*) ;
**Ajouter une ECUE** pour une ligne supplémentaire. Bouton **Créer les N ECUE**.

Le rattachement se faisant par UE, procéder en trois passes : ECUE 1+2 sur l'UE 1,
ECUE 3 sur l'UE 2, ECUE 4 sur l'UE 3.

**Contrôle** : la création d'une ECUE rattachée déclenche **deux appels** (`POST .../ecue` puis
`POST .../ue/{ueId}/ecue`). Un message « N opération(s) en échec » signifie que la ligne a été
créée mais **pas rattachée** : anomalie MAJEURE, avec le détail du message.

### 7. Semestre
`/professionnel/admin/semestres/new` → *Classe*, *Libellé* = `Semestre 1 <TAG>`, cocher les
**trois** UE. Bouton **Créer le semestre**.

**Contrôle** : si le message « Aucune UE pour cette classe. Créez d'abord des UE… » s'affiche
alors que l'étape 5 a réussi, c'est **bloquant** : le rattachement UE↔classe n'a pas pris.

### 8. Vérification du socle
Ouvrir `/professionnel/admin/ue` et `/professionnel/admin/matieres` filtrés sur la classe.
Attendu : 3 UE, 4 ECUE, chacune rattachée à la bonne UE. Un seul relevé, pas de capture.

---

## Pièges connus

| Piège | Conduite à tenir |
|---|---|
| Le formulaire UE force les UV à 0 | Voir étape 5. MAJEURE si aucun champ nulle part, jamais bloquante. |
| ECUE créée mais non rattachée | Le rattachement est un second appel qui peut échouer seul. Vérifier à l'étape 8. |
| Libellé de la conduite préfixé par le tag | Casse la détection serveur. Le tag va en **suffixe** sur l'ECUE 4. |
| « Classe » = `programmes` = `filiere_id` | Trois noms pour le même objet selon l'écran. Au plus une anomalie MINEURE de vocabulaire, une seule fois pour toute la campagne. |
