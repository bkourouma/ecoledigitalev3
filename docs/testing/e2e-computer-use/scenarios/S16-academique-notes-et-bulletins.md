# S16 — Parcours académique : présences, moyennes, bulletins, relevé

| | |
|---|---|
| **Rôle** | Administrateur (et Enseignant si l'affectation l'exige) |
| **Prérequis** | S15 (année active, classe d'année, étudiant inscrit, deux matières) |
| **Produit** | Créneaux, présences, moyennes semestrielles, bulletin académique, relevé de notes |
| **Budget** | ~60 appels d'outils · **1 capture** (le bulletin) |

---

## Étapes

### 1. Affectation enseignant ↔ matière ↔ classe
`/academic/assignments/new` → *Classe* `BTS1-G-<TAG>`, *Cours* `Mathématiques <TAG>`,
*Enseignant* (celui du run ou un enseignant existant), *Type de contrat*, dates couvrant la
période, *Montant* renseigné. **Enregistrer**. Répéter pour `Économie <TAG>`.

### 2. Générer les créneaux
`/academic/assignments` → bouton **Générer les créneaux**.

Attendu : des séances apparaissent ensuite dans `/attendance`.

**Contrôle** : c'est le seul prérequis réel de la saisie de présence — sans créneau, la liste
des séances reste vide. Si aucun créneau n'est produit alors que les deux affectations existent,
c'est **BLOQUANT** : relever le retour de l'appel et le nombre de créneaux annoncé.

> Il existe une seconde voie, la génération d'emploi du temps (`/simple-schedule`). Elle n'est
> **pas** obligatoire : ne pas la jouer ici, et ne pas signaler son absence d'usage.

### 3. Présences
`/attendance` → ouvrir la première séance de `Mathématiques <TAG>`.
Passer l'étudiant à **Absent**, **Enregistrer**. Rouvrir une fois : le statut doit tenir.

Ouvrir une seconde séance, le laisser **Présent**, **Enregistrer**.

**Contrôle** : une séance qui s'ouvre sur « Session introuvable » alors qu'elle figure dans la
liste est une anomalie **MAJEURE**.

### 4. Moyennes semestrielles
`/annee-academique/moyennes-semestre` → *Semestre* `Semestre 1 <TAG>`, *Classe* `BTS1-G-<TAG>`.

Si le sélecteur de classe est vide, c'est que le cycle ne contient pas « BTS » : revoir S15
étape 1. Autrement dit, ce vide-là n'est pas un bug ici, c'en est la conséquence.

Saisir :

| Matière | COEF | Note |
|---|---|---|
| `Mathématiques <TAG>` | 3 | **14** |
| `Économie <TAG>` | 2 | **9** |

Assiduité : la renseigner conformément à l'étape 3 (une absence sur deux séances).

**Moyenne générale attendue** : `(14 × 3 + 9 × 2) / 5 = 60 / 5 = **12,00**`.

Enregistrer la grille, puis relever la moyenne affichée. Un écart est une anomalie **MAJEURE** :
donner les notes, les coefficients et la moyenne obtenue — c'est presque toujours un
coefficient ignoré (qui donnerait 11,50) ou un arrondi non documenté.

### 5. Bulletin
Bouton **Générer les bulletins** pour la classe, puis bouton **Bulletin** sur la ligne de
l'étudiant. **Une capture.**

| Point | Attendu |
|---|---|
| Identité et matricule | `<TAG>-ACA` |
| Les deux matières, leurs coefficients, leurs notes | conformes à l'étape 4 |
| Moyenne générale | **12,00** |
| Assiduité | cohérente avec les présences saisies |
| Année et période | celles du run |

### 6. Attestations
Bouton **Générer les attestations** depuis le même écran. Relever ce qui est produit et à quel
titre. Si le document sort vide ou identique au bulletin, le signaler en **MAJEURE** avec la
différence attendue.

### 7. Relevé de notes (saisie manuelle)
`/annee-academique/releves-de-notes` — accessible uniquement par URL directe.

Créer un relevé : *Étudiant* du run, *Année académique* du run, *Date du relevé* du jour,
*Total crédits* `30`, *Moyenne générale (GPA)/20* `12`, fichier PDF si l'upload est possible.

**Deux constats à porter au rapport :**
1. Le lien de cette page est **retiré du menu** : une fonctionnalité en service mais
   inatteignable sans connaître l'URL. **MINEURE** d'ergonomie, à signaler une fois — de même
   pour `/annee-academique/rapports-de-presence`.
2. Ce relevé est **entièrement manuel** : ni la moyenne ni les crédits ne sont repris du
   bulletin de l'étape 5. Vérifier qu'aucun pré-remplissage n'existe, puis poser la question au
   rapport, dans les points à trancher : *un relevé ressaisi à la main peut contredire le
   bulletin calculé — est-ce voulu ?*

### 8. Rapport de présence
`/annee-academique/rapports-de-presence` — également hors menu. Créer un rapport pour
l'étudiant : *Total jours* `2`, *Jours présents* `1`, *Jours absents* `1`.

**Contrôle** : tenter une saisie incohérente (présents + absents **supérieurs** au total). Un
refus est attendu ; une acceptation est une anomalie **MAJEURE**.

Comparer ensuite ces chiffres à ce que l'application a réellement enregistré à l'étape 3 : là
encore, saisie manuelle contre données calculées. Noter si les deux peuvent diverger sans que
rien ne l'indique.

### 9. Contrôle de fin de chaîne
Vérifier explicitement qu'**aucun écran de ce parcours ne propose de délivrer un diplôme**, et
le consigner. C'est la réponse factuelle à la question de départ : dans l'état actuel du
produit, « de la création du programme à la délivrance du diplôme » n'est réalisable que par le
module professionnel (chaîne A).

---

## Pièges connus

| Piège | Conduite à tenir |
|---|---|
| Deux systèmes de notes | Les devoirs/évaluations (`/academic/evaluations`) sont distincts de la grille des moyennes semestrielles. Seule la grille alimente le bulletin. Ne pas mélanger. |
| `/annee-academique/bulletins` | Cette URL n'a pas de page : ne pas y aller, le bulletin se génère depuis `moyennes-semestre`. Un 404 y est attendu. |
| Pages hors menu | Relevés et rapports de présence : MINEURES d'ergonomie, signalées une fois. |
| Saisies manuelles | Relevé et rapport de présence ne calculent rien. Le signaler comme question de conception, pas comme bug. |
