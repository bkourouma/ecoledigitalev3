# Prompt de reprise — campagne E2E-2209-1

> À coller dans Claude (web, avec l'extension navigateur).
> **Joindre aussi** le fichier `SCENARIO-A-JOUER-E2E-2209-1.md` : il contient le détail des
> étapes 6 à 11, que ce prompt ne répète pas.

---

Tu reprends une campagne de test de bout en bout sur EcoleDigitale, en local
(`http://localhost:3000`, tenant `ecoledigitale`). Une première passe s'est arrêtée sur une
anomalie bloquante ; elle a été corrigée. Ta mission tient en deux temps : **vérifier les
correctifs**, puis **reprendre le test là où il s'était arrêté**.

Connexion : `/login` → panneau **Comptes par tenant** → tenant **ecoledigitale** → cliquer la
ligne du compte voulu (le formulaire se remplit) → **Se connecter**. Mot de passe commun des
comptes techniques : `Password@2025`. Compte admin : `admin@ecoledigitale.local`.

---

## Temps 1 — Vérifier ce qui a été corrigé (ne me crois pas sur parole)

Cinq correctifs ont été appliqués. Pour chacun, je te donne le geste de vérification. Dis-moi
franchement lequel tient et lequel ne tient pas — un correctif annoncé mais non constaté est
plus dangereux qu'un bug connu.

**1. Le bloquant : les inscrits invisibles.** Une inscription non payée était ignorée par toute
la scolarité. La règle est volontaire (les frais d'inscription conditionnent l'accès), mais la
confirmation n'était déclenchée que par un encaissement — donc une classe **sans** frais
d'inscription ne se confirmait jamais. Corrigé, plus une reprise des lignes existantes.

> Vérifier : `/professionnel/admin/inscrits`, filtrer `E2E-2209-1`. Les trois étudiants doivent
> porter le statut **Confirmée** (et non « En attente paiement »).

**2. Compteurs divergents Diplômes / Attestations.** Les deux écrans comptaient la même cohorte
différemment (3 contre 0).

> Vérifier : `/professionnel/admin/attestations` (classe du run) doit annoncer **3 étudiants
> inscrits**, et `/professionnel/admin/diplomes` **3 candidats**. Les deux chiffres doivent
> être égaux.

**3. Filtre « Classe » des écrans ECUE, qui restait vide.** Même cause que le point 1.

> Vérifier : `/professionnel/admin/matieres` → le sélecteur **Classe** doit proposer
> `LICENCE 1 TESTOLOGIE E2E-2209-1`.

**4. Comptes inutilisables faute d'e-mail.** Un bouton **Réinitialiser le mot de passe** a été
ajouté sur les fiches enseignant et étudiant. Le mot de passe s'affiche **une seule fois**.

> Vérifier : `/academic/students/<id>` → le bouton est présent, la confirmation nomme bien
> l'étudiant, et le mot de passe obtenu permet réellement de se connecter.

**5. Deux correctifs d'interface que je n'ai PAS pu vérifier — c'est à toi de trancher :**

> a) `/professionnel/admin/signataires` : cliquer dans un champ déjà rempli doit **sélectionner
> son contenu**, pour que la frappe le remplace au lieu de s'y ajouter. Auparavant on
> enregistrait des valeurs composites du genre « Celeste BAHKoffi Signataire ». Vérifie aussi
> qu'une saisie en cours n'est plus écrasée si tu changes d'onglet et reviens.
>
> b) `/professionnel/admin/inscriptions` : après un enregistrement, le message de confirmation
> doit **venir sous tes yeux** (la page défile jusqu'à lui) au lieu de s'afficher hors écran,
> tout en haut, pendant que tu es en bas.

---

## Temps 2 — État réel des données

Tout porte le tag `E2E-2209-1`. **Ne crée rien de ce qui suit, tout existe déjà :**

| Objet | Valeur |
|---|---|
| Cycle / Filière / Classe | `LICENCE E2E-2209-1` · `TESTOLOGIE E2E-2209-1` · `LICENCE 1 TESTOLOGIE E2E-2209-1` (code `L1TST01`) |
| UE | `Comptabilité` (7 UV) · `Droit` (5 UV) · `Conduite` (1 UV) |
| ECUE | `Comptabilité générale` (4 cr.) · `Comptabilité analytique` (3 cr.) · `Droit civil` (5 cr.) · `Conduite` (1 cr.) |
| Semestre | `Semestre 1 E2E-2209-1`, les 3 UE rattachées |
| Ouverture de classe | nom **`L1 TESTOLOGIE E2E-2209-1`** — 3 sessions, emploi du temps à 3 créneaux |
| Signataires | les 4 sont renseignés (noms de test) |
| Étudiants | `Aminata Excellente` (A) · `Bakary Rattrapage` (B) · `Chantal Ajournee` (C) — **inscriptions confirmées** |
| Enseignante | `Awa Formatrice E2E-2209-1` — `awa.formatrice.e2e22091@example.test` / **`zQmU?jXJGW9m`** |
| Séances | 3 séances déjà créées (07, 14 et 21/09/2026) sur `Comptabilité générale`, **sans feuille d'appel saisie** |

Deux avertissements sur les comptes :

- Le mot de passe d'**Aminata a été réinitialisé** pendant la vérification du correctif n°4, et
  il n'a pas été noté. Quand l'étape 11 en aura besoin, **génère-en un nouveau** depuis sa fiche.
- Les comptes de **Bakary** et **Chantal** n'ont jamais eu de mot de passe utilisable : même
  procédé si tu en as besoin.

---

## Temps 3 — Reprendre le test

**Reprends le scénario joint à l'étape 6.1** (séances et présences) et va jusqu'au bout, c'est
à dire jusqu'à la délivrance du diplôme et sa visibilité côté étudiant et parent.

Trois corrections à apporter au fichier joint, constatées lors de la première passe :

1. **Création des séances** : le scénario indique `/teacher/professional-seances`. Cette page
   est en lecture seule. La création se fait par **`/teacher/attendance` → « Nouvelle
   présence »**, qui planifie la séance puis ouvre la feuille d'appel.
2. **Étapes 1 à 5 : déjà faites.** N'y retourne pas, sauf pour les vérifications du Temps 1.
3. **Les trois séances existent déjà** : commence directement par la saisie des présences
   (tableau de l'étape 6.1), sans les recréer.

Le cœur du test est aux étapes 7, 8 et 9 : les notes, les décisions de semestre, puis le
diplôme. Les valeurs à saisir et les résultats attendus y sont donnés au chiffre près — saisis
exactement ce qui est écrit, et compare sans arrondir mentalement.

---

## Comment travailler

- Tu **ne corriges rien** et tu ne modifies aucun fichier : tu constates et tu notes.
- Pour remplir un champ : **clique dedans, tape au clavier, puis sors du champ** (Tab ou clic
  ailleurs). Ne colle pas une valeur par programme — les champs sont des composants React
  contrôlés et le formulaire partirait vide tout en paraissant rempli. Valide **par un clic sur
  le bouton**, jamais par la touche Entrée.
- Une page servie pour la première fois peut mettre **jusqu'à une minute** à s'afficher. Sur une
  erreur 500 ou une connexion refusée : attends 20 secondes et rejoue le geste **une fois**.
  Anomalie seulement si ça se reproduit.
- Deux gestes te demanderont peut-être la main : l'**upload de fichier** et la **boîte de
  dialogue native** du motif de révocation (étape 9.6). Si tu n'y arrives pas, dis-le au lieu de
  contourner.
- Aucun paiement réel. Devant un vrai formulaire bancaire ou d'opérateur : arrêt immédiat.

## Ce que j'attends en retour

Après chaque étape, une ligne : OK ou KO. Quand c'est KO :

```
Étape : 7 — notes ECUE Comptabilité générale
URL : http://localhost:3000/professionnel/admin/notes
Geste : saisie devoirs 12 et 16, examen 15 pour Aminata
Attendu : note ECUE 14,6
Constaté : 13,2
Requête : POST /api/v1/professional/ecue/<id>/manual-notes → 200
```

Et à la fin, trois choses : le tableau des étapes avec leur statut, la liste des anomalies
classées bloquante / majeure / mineure, et — le plus important — **ce que tu n'as pas pu
vérifier**. Une campagne qui prétend tout couvrir fait plus de mal qu'une campagne qui dit où
sont ses trous.
