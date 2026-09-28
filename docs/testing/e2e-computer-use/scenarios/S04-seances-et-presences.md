# S04 — Séances et présences

| | |
|---|---|
| **Rôles** | Enseignant (étapes 1-3), puis Administrateur (étapes 4-6) |
| **Prérequis** | S03 (trois étudiants inscrits), compte enseignant utilisable |
| **Produit** | `SEANCE_1..3_ID`, feuilles de présence saisies, un justificatif d'absence |
| **Budget** | ~60 appels d'outils |

> Les séances **ne se génèrent pas** à partir de l'emploi du temps : l'emploi du temps est un
> plan d'affichage, la séance est un objet distinct que l'enseignant crée. Ne pas chercher un
> bouton « générer les séances » côté admin — il n'y en a pas, et son absence n'est pas une
> anomalie à signaler ici.

---

## Étapes

### 1. Connexion enseignant
`/login` avec le compte créé en S02. Attendu : redirection vers `/teacher/dashboard`.

Si ce compte est inutilisable (mot de passe jamais affiché — voir S02 étape 1), se connecter
avec un compte enseignant préexistant du tenant et **le noter au rapport** : les séances seront
alors créées par un enseignant qui n'est pas celui affecté aux ECUE, ce qui peut changer ce
qu'il voit. Si la liste de ses sessions est vide pour cette raison, c'est **bloquant**.

### 2. Créer trois séances
`/teacher/professional-seances` → session de l'UE `Comptabilité <TAG>`, ECUE
`Comptabilité générale <TAG>`.

| Séance | Date | Horaires |
|---|---|---|
| 1 | premier lundi de la période | 08:00 – 10:00 |
| 2 | lundi suivant | 08:00 – 10:00 |
| 3 | lundi d'après | 08:00 – 10:00 |

Relever les trois `SEANCE_ID`.

**Contrôle** : la séance doit refuser une ECUE qui n'appartient pas à l'UE de la session. Tenter
**une fois** de créer une séance sur `Droit civil <TAG>` depuis la session `Comptabilité <TAG>` :
un refus est le comportement attendu et se note `OK` ; une création acceptée est une anomalie
**MAJEURE** (séance hors périmètre pédagogique, elle faussera les bulletins). Si elle est créée,
la supprimer aussitôt et le signaler.

### 3. Saisir les présences
Pour chaque séance, feuille d'appel puis **Enregistrer** :

| Séance | Aminata (A) | Bakary (B) | Chantal (C) |
|---|---|---|---|
| 1 | Présent | Présent | Absent |
| 2 | Présent | Retard | Absent |
| 3 | Présent | Présent | Absent |

**Contrôle** : après enregistrement de la séance 1, rouvrir la feuille une fois et vérifier que
les statuts sont conservés. Si la feuille se rouvre vide ou tout à « Présent » par défaut, c'est
**bloquant**. Les séances 2 et 3 se saisissent sans relecture.

### 4. Basculer en administrateur
Se déconnecter, se reconnecter en administrateur.

### 5. Justifier une absence
`/professionnel/admin/presences` → retrouver la classe `L1 TESTOLOGIE <TAG>`, ouvrir la
**séance 2**, ligne de Chantal (C) : bouton **Justifier**, motif
`Certificat médical <TAG>`, puis **Enregistrer**.

Attendu : le statut passe d'« Absent » à « Excusé ».

**Contrôles** :
- Joindre un justificatif PDF si le bouton le propose. En cas d'impossibilité d'upload, même
  conduite qu'en S03 : noter, ne pas contourner, continuer le reste de l'étape.
- Tester **Retirer la justification** puis re-justifier : le statut doit revenir à « Absent »
  puis repasser à « Excusé ». Un statut qui ne redescend pas est une anomalie **MAJEURE**.

### 6. Vérifier la synthèse
`/professionnel/admin/presences/etudiant/<ETUDIANT_C_ID>` et la vue de synthèse par classe.

Relever, **sans les corriger mentalement**, les valeurs affichées :

| Étudiant | Présences | Absences | Retards | Excusés | Heures d'absence | Taux de présence |
|---|---|---|---|---|---|---|
| A | | | | | | |
| B | | | | | | |
| C | | | | | | |

Comptage de référence à la main, sur 3 séances de 2 h :
- **A** : 3 présents, 0 absence → taux attendu **100 %**, 0 h d'absence.
- **B** : 2 présents + 1 retard → à documenter : le retard est-il compté comme présence, comme
  absence, ou à part ? Noter la règle **impliquée par le chiffre affiché**.
- **C** : 3 absences dont 1 excusée → 6 h d'absence si l'excusée compte, 4 h sinon. Noter
  laquelle des deux lectures correspond à l'écran.

Un écart entre la synthèse et ce décompte est une anomalie **MAJEURE** : donner les deux
chiffres, l'affiché et celui compté à la main. L'ambiguïté sur le traitement du retard et de
l'absence excusée n'est **pas** une anomalie en soi — c'est une **question à trancher par un
humain**, à porter dans la section prévue du rapport, parce que le taux de présence n'entre dans
aucun calcul de bulletin ou de diplôme (vérifié dans le code) et qu'aucune règle écrite ne le
fixe.

---

## Pièges connus

| Piège | Conduite à tenir |
|---|---|
| Aucune génération automatique de séances | Normal. L'enseignant les crée une par une. |
| Deux voies de saisie (enseignant et admin) | Ce scénario saisit côté enseignant et corrige côté admin — c'est le parcours réel. |
| Statuts disponibles | Présent, Absent, Retard, Excusé. « Excusé » ne se saisit pas directement : il naît de la justification d'une absence. |
| Déconnexion/reconnexion | Deux rôles dans un même scénario : bien se déconnecter, sinon les écrans admin s'affichent vides sans erreur explicite. |
