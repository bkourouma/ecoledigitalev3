# Recette — Rémunération du Module Professionnel

Parcours de test complet, écran par écran, sur un cas réel : **Nadège Aka**.

**Établi le** : 2026-08-18 · **Périmètre** : feature 031 (migrations `0103` → `0105`)

Chaque étape indique **ce que tu fais**, **ce que tu dois voir**, et **ce qui
serait un défaut**. Les valeurs attendues sont lues en base, pas estimées.

---

## Avant de commencer

### Les deux serveurs

| Service | Adresse |
|---|---|
| API | http://localhost:4000 |
| Web | http://localhost:3000 |

S'ils sont tombés, depuis la racine du dépôt :

```bash
npx tsx apps/api/src/index.ts
```

```bash
pnpm --filter @ecoledigitale/web dev
```

### Le cas de test

**Nadège Aka** — `nadege.aka@ecoledigitale.test`

| | |
|---|---|
| Configuration | **Horaire**, 25 000 XOF/h |
| Seuil heures sup. | 40 h / semaine |
| Validité | du 01/06/2026, sans fin |
| Période de test | **Paie 2026-07 (seed 031)** — 01/07/2026 → 31/07/2026 |

Ses **6 séances** sur la période, 2 h chacune :

| Date | ECUE | Cohorte | Présences |
|---|---|---|---|
| 3 juillet | `L2GL-EC-DPA` | Session S3 2025-2026 | 30 |
| 3 juillet | `L1TL-EC-IMA` | Session S1 2026-2027 | 15 |
| 14 juillet | `L2GL-EC-DPA` | Session S3 2025-2026 | 30 |
| 15 juillet | `L1TL-EC-IMA` | Session S1 2026-2027 | 15 |
| 26 juillet | `L2GL-EC-DPA` | Session S3 2025-2026 | 30 |
| 27 juillet | `L1TL-EC-IMA` | Session S1 2026-2027 | 15 |

**Aucune de ses ECUE n'a de tarif spécifique** — son tarif par défaut
s'appliquera donc.

> ### Le résultat attendu en fin de parcours
>
> **12 h × 25 000 = 300 000 XOF**, sans heures supplémentaires
> (aucune semaine n'atteint 40 h).

### Les trois autres enseignants

La période contient **36 séances** au total. Trois autres enseignants y sont
configurés par le jeu de démonstration — tu les verras dans les résultats de
calcul, c'est normal :

| Enseignant | Configuration |
|---|---|
| Adjoua Brou | Horaire, 10 000 XOF/h |
| Awa Cissé | Salarié, 450 000 XOF |
| Djeneba Camara | Mixte, 450 000 + 10 000 XOF/h |

### ⚠️ Ne relance pas le seed pendant le test

`seed-remuneration-professionnelle.js` remet **toutes** les séances de juillet
2026 à « planifiée » et effacerait ton travail. Il ne sert qu'à repartir de zéro
(voir la dernière section).

---

## Étape 1 — Configuration ✅ déjà faite

**Page** : http://localhost:3000/payments/teacher-configs

Sa configuration démarre au **01/06/2026** et couvre bien la période de test.

> **Ce que ça a déjà vérifié** : l'enregistrement d'une date **hors année
> académique active** est accepté. C'était refusé avant — une rémunération suit
> le contrat de l'enseignant, pas le calendrier scolaire.

---

## Étape 2 — Marquer les séances réalisées

**Page** : http://localhost:3000/professionnel/admin/remuneration/seances

*Menu : Module Professionnel › Rémunération › Validation des séances*

### Ce que tu fais

1. Dates : **du `01/07/2026` au `31/07/2026`**
2. « Statut » et « Payabilité » sur **Toutes**
3. Repère les 6 lignes de **Nadège Aka** (colonne Enseignant)
4. Sur chacune, bascule « Statut » de `Planifiée` sur **`Réalisée`**

### Ce que tu dois voir

- La ligne reste **non payable**, motif **« Non validée »** dans la colonne Paie.
- La colonne **Présences** affiche 30 ou 15 : les appels ont bien été faits.

> **Le point de cette étape.** Marquer qu'un cours a eu lieu n'engage aucune
> dépense. Le statut constate un **fait pédagogique** ; la validation, à l'étape
> suivante, est un **acte de gestion**. Les confondre ferait de chaque appel un
> engagement financier.
>
> La présence saisie est un **indice** que la séance a eu lieu, jamais un
> déclencheur : un enseignant peut faire l'appel puis annuler, ou faire cours
> sans appel.

### Ce serait un défaut si

- Une ligne devient « Payable » dès le passage en « Réalisée ».
- La colonne Paie reste vide sans dire pourquoi.

---

## Étape 3 — Valider pour la paie

**Même page.**

### Ce que tu fais

1. Coche les **6 séances** de Nadège Aka.
2. Ajoute à la sélection **une séance restée « Planifiée »** d'un autre
   enseignant.
3. Clique **Valider**.

### Ce que tu dois voir

Un message du type :

```
6 traitée(s), 1 refusée(s) : 1 × Non marquée réalisée
```

Puis, sur ses 6 lignes : fond vert clair, mention **« Payable »**.

L'indicateur **Heures payables** en haut doit augmenter de **12 h**.

> **Le point de cette étape.** Le lot s'applique **partiellement** : les séances
> éligibles passent, les autres sont refusées avec leur motif. Faire échouer
> tout le lot sur une seule anomalie bloquerait 200 séances pour une.

### Ce serait un défaut si

- Tout le lot échoue à cause de la séance inéligible.
- Le message annonce un succès global sans mentionner le refus.

---

## Étape 4 — Corriger un volume horaire

**Même page.**

### Ce que tu fais

Sur la séance du **3 juillet · `L2GL-EC-DPA`**, remplace le volume `2` par
**`3`** dans le champ, puis quitte le champ (Tab ou clic ailleurs).

### Ce que tu dois voir

- Sous le champ apparaît **« modifié · prévu 2h »**.
- La colonne **Horaires** affiche toujours **08:00 – 10:00**, inchangée.
- L'indicateur **Heures payables** passe de 12 h à **13 h**.

> **Le point de cette étape.** La correction est un **fait de paie**, pas une
> correction d'emploi du temps. Un cours planifié de 08:00 à 11:00 dont seules
> 2 h sont dues n'a pas à voir son créneau pédagogique réécrit. Le prévu et le
> payé restent lisibles côte à côte — c'est ce qui rend la correction
> vérifiable en contrôle.

### À essayer aussi

**Vider le champ** retire la correction : le volume revient à 2 h et la mention
« modifié » disparaît.

**Saisir exactement `2`** (la durée planifiée) ne pose **aucune** correction —
marquer « modifié » ce qui ne l'est pas rendrait le repère inutile.

### Ce serait un défaut si

- Les horaires changent quand tu modifies le volume.
- La mention « modifié » apparaît alors que tu as ressaisi la valeur d'origine.

> **Remets `2`** (ou vide le champ) avant de continuer, pour retrouver les
> 300 000 XOF attendus.

---

## Étape 5 — Ajouter une séance oubliée

**Même page.** Deux chemins, à tester dans cet ordre.

### 5a — Depuis le rapprochement

En haut de l'écran, un bandeau indique les **créneaux d'emploi du temps
attendus sans séance enregistrée** sur la période.

1. Clique **« Voir la liste »**.
2. Choisis une ligne, clique **« Ajouter »**.

**Ce que tu dois voir** : la séance apparaît dans le tableau, marquée
**« ajoutée en comptabilité »** sous le nom de l'enseignant, au statut
**Réalisée** mais **non validée**.

> **Le point.** Sans ce rapprochement, « ajouter une séance oubliée » supposerait
> que tu saches déjà laquelle manque. Ici le système te le dit.

### 5b — Saisie libre

Pour une séance qui n'était **pas** à l'emploi du temps.

1. Clique **« Ajouter une séance »**.
2. Cohorte : **Session S3 2025-2026 — L2GL**
3. ECUE : **`L2GL-EC-DPA`** → l'enseignant se pré-remplit
4. Vérifie que c'est bien **Nadège Aka**
5. Date : **`2026-07-20`**
6. **Laisse les horaires vides** et saisis **Volume horaire = `4`**
7. Libellé : « Rattrapage »
8. **Enregistrer**

**Ce que tu dois voir** : la séance apparaît avec un volume de **4 h**, sans
horaires, marquée « ajoutée en comptabilité », **Réalisée** mais **non validée**.

> **Le point.** Une séance sans horaires était impayable jusqu'ici. Le volume
> saisi la débloque — c'est le cas d'un cours dont l'administration connaît la
> durée sans que l'enseignant ait renseigné le créneau.
>
> Elle est créée **non validée** : engager la dépense reste un acte distinct,
> même quand c'est la même personne qui l'accomplit ensuite.

### Ce serait un défaut si

- La séance est créée directement **payable**.
- Le formulaire accepte d'enregistrer **sans horaires ni volume**.
- Choisir une ECUE ne pré-remplit pas l'enseignant.

> **Pour la suite du guide**, laisse ces séances ajoutées **non validées** :
> les 300 000 XOF attendus ne portent que sur ses 6 séances d'origine.

---

## Étape 6 — Lancer le calcul

**Page** : http://localhost:3000/payments/calculate

*Menu : Rémunération Enseignants › Calcul des Paiements*

### Ce que tu fais

1. Période : **Paie 2026-07 (seed 031)**
2. Enseignant : **Tous**
3. Périmètre des heures : **Tous les modules**
4. Coche **Recalculer les paiements existants**
5. Lance le calcul

### Ce que tu dois voir

| Enseignant | Type | Heures | Montant |
|---|---|---|---|
| **Nadège Aka** | horaire | **pro. 12,0 h** | **300 000** |
| Adjoua Brou | horaire | pro. 10,0 h | 144 000 |
| Awa Cissé | salarié | pro. 10,0 h | 450 000 |
| Djeneba Camara | mixte | pro. 10,0 h | 550 000 |

Sous la colonne Heures, la ventilation **`pro. 12.0h`** doit apparaître.

Plus bas, une vingtaine de lignes **Ignoré** avec l'étiquette
**« Sans configuration »** — les enseignants du tenant sans configuration de
paie.

> **Deux choses à regarder.**
>
> **Awa Cissé est salariée** : ses 10 h apparaissent, mais son montant reste
> 450 000. Les heures ne le modifient pas.
>
> **Les enseignants écartés disent pourquoi.** Un compte rendu qui les omettrait
> ne permettrait pas de savoir s'il manque une configuration, des heures ou un
> tarif.

### Ce serait un défaut si

- Nadège Aka ressort à **0**.
- Son montant diffère de 300 000 (vérifie que tu as bien remis le volume à 2 h
  à l'étape 4, et que les séances de l'étape 5 sont restées non validées).
- Un nom affiche « Unknown ».

### À essayer aussi

Relance avec le périmètre **Académique uniquement** : Nadège Aka tombe à **0**,
elle n'a aucune heure académique. Awa Cissé garde ses 450 000 — un salaire ne
dépend pas des heures.

**Repasse ensuite sur « Tous les modules » et recalcule** avant de continuer.

---

## Étape 7 — Vérifier la justification du montant

**Page** : http://localhost:3000/payments/manage

*Menu : Rémunération Enseignants › Gestion des Paiements* → ouvrir le paiement
de **Nadège Aka**

### Ce que tu dois voir

Un bloc **Détail des heures** avec **6 lignes** :

| Colonne | Valeur attendue |
|---|---|
| Origine | **Professionnel** sur les 6 |
| Intitulé | `L2GL-EC-DPA` et `L1TL-EC-IMA` |
| Cohorte | Session S3 2025-2026 / Session S1 2026-2027 |
| Heures | 2,00 par ligne |
| Tarif | **25 000** par ligne |
| Montant | 50 000 par ligne |

La somme des 6 lignes = **300 000**, égale au montant du paiement.

### Puis édite les documents

Depuis cette page, génère le **bulletin PDF** et le **relevé**. Les deux doivent
porter le **même** tableau, avec la colonne Origine et le récapitulatif :

```
Académique : 0.00 h  ·  Professionnel : 12.00 h
```

### Ce serait un défaut si

- Le détail est vide ou l'intitulé affiche « N/A ».
- Le PDF et l'écran ne montrent pas les mêmes lignes.
- La somme du détail ne retombe pas sur le montant du paiement.

---

## Étape 8 — Les rapports

**Page** : http://localhost:3000/payments/reports

*Menu : Rémunération Enseignants › Rapports Enseignants*

### Ce que tu fais

Sélectionne la période, laisse l'origine sur **Tous les modules**.

### Ce que tu dois voir

Un bloc **Répartition par origine** dont les trois postes s'additionnent
**exactement** au total :

```
Académique + Professionnel + Hors heures (salaires) = Total
```

> **Pourquoi trois postes.** Un enseignant salarié n'a **aucune ligne d'heures** :
> son montant ne provient d'aucune origine. Sans ce troisième poste, la somme
> serait inférieure au total et l'écart passerait pour une erreur de calcul.

### Puis

Bascule l'origine sur **Professionnel** : le nombre de paiements **diminue** —
Awa Cissé en sort, n'ayant aucune ligne d'heures. Son montant reste visible en
« Tous ».

**Exporte en CSV** : le fichier doit porter les colonnes
`Montant Academique` et `Montant Professionnel`, cohérentes avec l'écran.

### Ce serait un défaut si

- La somme des trois postes ne retombe pas sur le total.
- L'export ignore le filtre d'origine.

---

## Étape 9 — Les verrous

Ce sont les tests les plus utiles : ils vérifient que le système **refuse**
quelque chose. Un module qui accepte tout paraît fonctionner jusqu'au jour où il
faut contester un montant.

### 9a — Un paiement approuvé ne se recalcule pas

1. `Gestion des Paiements` → **approuve** le paiement de Nadège Aka.
2. `Calcul des Paiements` → relance un **recalcul complet**.

**Attendu** : sa ligne ressort avec l'étiquette **« Paiement verrouillé »** et le
message « Paiement au statut “approved” : non recalculé ». Son montant est
**inchangé**.

### 9b — Une séance payée ne se modifie plus

Retourne sur **Validation des séances**, filtre sur juillet.

**Attendu** sur ses 6 séances :

- Mention **« Payée »** dans la colonne Paie.
- Case à cocher **désactivée**.
- Liste déroulante Statut **désactivée**.
- Champ Volume horaire **désactivé**.

**Ce serait un défaut si** tu parviens à dévalider, annuler ou modifier le volume
d'une séance déjà payée : le paiement approuvé perdrait sa justification sans que
son montant bouge.

### 9c — Un tarif modifié ne réécrit pas le passé

1. `Module Professionnel › Rémunération › Tarifs horaires ECUE`
2. Crée un tarif sur **`L2GL-EC-DPA`**, générique, **50 000 XOF/h**, valide
   depuis le 01/01/2026.
3. Rouvre le paiement **approuvé** de Nadège Aka.

**Attendu** : le détail affiche toujours **25 000** par heure et **300 000** au
total. Le tarif est figé au moment du calcul.

> **Supprime ce tarif** après le test, sinon les prochains calculs vaudront
> 50 000/h sur cette ECUE.

---

## Étape 10 — Côté enseignant

Nécessite un compte **enseignant**. Si tu n'as pas les identifiants de Nadège
Aka, saute cette étape.

**Page** : `Mes Rémunérations › Séances Professionnelles`

**Attendu** :

- Ses séances à elle, avec « Validée » ou « En attente de validation ».
- Son paiement, marqué **Provisoire (calculé)** tant qu'il n'est pas approuvé,
  avec un bandeau expliquant que le montant peut encore évoluer.
- La ventilation heures professionnelles / académiques.

**Ce serait un défaut si** elle voit les séances ou paiements d'un autre
enseignant.

---

## Remise à zéro

Pour repartir de l'état initial :

```bash
node scripts/seed-remuneration-professionnelle.js
```

Le script remet les séances de juillet 2026 à « planifiée », recrée les
configurations des **trois** enseignants de démonstration et les tarifs ECUE.

> Il ne touche **pas** à la configuration de Nadège Aka (créée hors seed) ni aux
> paiements déjà calculés — l'étape 6 les recalcule.

Pour supprimer les séances que tu as ajoutées aux étapes 5a et 5b, il faut
d'abord les dévalider et recalculer : une séance qui justifie un montant ne peut
pas être supprimée.

---

## Ce que je voudrais savoir en retour

Le risque que je n'ai pas pu écarter est **l'affichage**. Les écrans compilent
et l'API renvoie les bonnes données — vérifié par 25 contrôles automatiques —
mais je n'ai jamais vu leurs composants s'exécuter dans un navigateur.

| Symptôme | Ce que ça indiquerait |
|---|---|
| Écran blanc, erreur React | Un rendu qui casse sur une donnée absente |
| Tableau vide alors que les données existent | Une réponse d'une forme inattendue |
| Colonne vide, « N/A », « undefined » | Un champ mal nommé entre l'API et l'écran |
| Champ de volume qui ne réagit pas | Un état React mal câblé |

Un **montant faux** serait plus grave et plus surprenant : les contrôles
automatiques recalculent l'attendu en SQL, indépendamment du code. Si tu en vois
un, c'est prioritaire.

### Relancer les contrôles automatiques

À tout moment, avec l'API démarrée :

```bash
node scripts/verify-remuneration-031.js
```

25 invariants, dont l'idempotence du recalcul et les verrous. Le script
rétablit l'état qu'il modifie.

---

## Limite connue

L'écran de validation des séances **n'a pas de filtre par enseignant**. Sur
juillet il y a 36 séances tous enseignants confondus : les 6 de Nadège Aka se
repèrent à la colonne Enseignant, mais un filtre serait plus confortable.
C'est un ajout de quelques minutes si tu le souhaites.

Par ailleurs, `/payments/teaching-hours` (« Validation des Heures ») ne montrera
**jamais** ces séances : c'est l'écran de l'**Académique**, qui lit une autre
table. Toute cette recette se déroule sur
`/professionnel/admin/remuneration/seances`.
