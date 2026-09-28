# S02 — Ouverture de classe, enseignant, emploi du temps, signataires

| | |
|---|---|
| **Rôle** | Administrateur |
| **Prérequis** | S01 (`CLASSE_ID`, `SEMESTRE_ID`, UE et ECUE créées) |
| **Produit** | `ENSEIGNANT_ID` (+ ses identifiants), `SALLE_ID`, trois `UE_SESSION_ID`, `NOM_CLASSE`, créneaux d'emploi du temps, 4 signataires |
| **Budget** | ~50 appels d'outils |

---

## Étapes

### 1. Enseignant
`/academic/teachers/new` → *Prénom* `Awa`, *Nom* `Formatrice <TAG>`, *Email*
`awa.formatrice.<tag-minuscule>@example.test`, *Type de contrat* **Vacataire**.
Bouton **Créer l'enseignant**.

> Le mot de passe est généré par le serveur et **un e-mail d'identifiants part
> systématiquement**. L'adresse ci-dessus est en `.test`, donc non routable : c'est voulu.
> Relever le mot de passe s'il apparaît à l'écran — S04 en aura besoin. S'il n'apparaît nulle
> part et qu'aucun moyen de le définir n'existe, c'est une **anomalie MAJEURE** (« compte
> enseignant inutilisable sans accès à la boîte mail ») : la noter, et signaler dans le rapport
> que S04 devra se rabattre sur un compte enseignant préexistant.

### 2. Salle
`/academic/classrooms/new` → *Nom de la salle* `Salle <TAG>`, *Code* `S<NN>`.
Bouton **Créer**.

### 3. Ouverture de classe
`/professionnel/admin/sessions/new` (intitulé : « Ouvrir une classe ») :

| Champ | Valeur |
|---|---|
| *Classe* | `LICENCE 1 TESTOLOGIE <TAG>` |
| *Nom de la classe* | `L1 TESTOLOGIE <TAG>` — à retenir, c'est la clé de navigation de tous les écrans aval |
| *Semestres couverts (portée)* | cocher `Semestre 1 <TAG>` |
| *Semestre* | `Semestre 1 <TAG>` |
| *Date de début* | premier jour du mois en cours |
| *Date de fin* | dernier jour du mois suivant |
| *Enseignant par ECUE* | l'enseignante de l'étape 1 sur **les quatre** ECUE |

Bouton **Créer**.

**Contrôle** : l'opération crée **une session par UE** du semestre — donc **trois** sessions
attendues, pas une. Vérifier le compte dans `/professionnel/admin/sessions` et relever les trois
`UE_SESSION_ID`. Un nombre différent de 3 est une anomalie **MAJEURE** (préciser le nombre obtenu).

### 4. Emploi du temps
`/professionnel/admin/planning` → *Nom de la classe* = `L1 TESTOLOGIE <TAG>`, *Semestre* =
`Semestre 1 <TAG>`. Dates pré-remplies : les garder.

Trois créneaux via **Ajouter un créneau** :

| ECUE | Jour | Début | Fin | Salle |
|---|---|---|---|---|
| Comptabilité générale | Lundi | 08:00 | 10:00 | `Salle <TAG>` |
| Comptabilité analytique | Mardi | 10:00 | 12:00 | `Salle <TAG>` |
| Droit civil | Mercredi | 14:00 | 16:00 | `Salle <TAG>` |

Bouton **Enregistrer 3 créneau(x)**.

**Contrôles** :
- L'enseignant n'est pas saisissable : il est repris de l'affectation faite à l'étape 3.
  Vérifier qu'il apparaît sur les trois créneaux. Un créneau « non affecté » alors que l'étape 3
  a bien affecté l'enseignante est une anomalie **MAJEURE**.
- L'enregistrement fait **un appel par créneau**. Un succès partiel (2 sur 3) doit être relevé
  précisément, avec le créneau fautif.
- Si le sélecteur *Nom de la classe* est vide : **bloquant** — il ne liste que les classes ayant
  une session ouverte, donc l'étape 3 n'a pas produit ce qu'elle annonçait.

### 5. Signataires
`/professionnel/admin/signataires` — quatre fiches indépendantes, chacune avec son propre bouton
**Enregistrer**. Ne pas en oublier une : elles ne s'enregistrent pas ensemble.

| Fiche | *Nom* | *Qualité* | *Fonction* |
|---|---|---|---|
| Attestation de réussite — signataire | `Koffi Signataire <TAG>` | `Enseignant Chercheur` | `Directeur des études` |
| Diplôme — signataire de gauche | `Aya Gauche <TAG>` | — | `Le Directeur Général` |
| Diplôme — signataire de droite | `Yao Droite <TAG>` | — | `Le Président du Jury` |
| Attestation d'authenticité — signataire | `Ama Authentique <TAG>` | — | `Le Secrétaire Général` |

**Contrôle** : recharger la page une fois et vérifier que les quatre noms sont toujours là. Ces
valeurs seront relues sur les PDF de S08 et S09 — un signataire perdu ici ne se voit que deux
scénarios plus loin, sous une forme bien plus difficile à diagnostiquer.

---

## Pièges connus

| Piège | Conduite à tenir |
|---|---|
| Une ouverture = N sessions | Trois UE ⇒ trois sessions. Compter, ne pas supposer. |
| Le « nom de classe » est la clé de navigation | Inscriptions, planning, notes, bulletins s'y accrochent tous. Le porter au registre en toutes lettres. |
| Quatre boutons Enregistrer distincts | Une fiche signataire oubliée ⇒ PDF incomplet en S08/S09. |
| Mot de passe enseignant non affiché | Voir étape 1 : MAJEURE, et S04 bascule sur un compte existant. |
