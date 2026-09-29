# Tri du rapport partiel `E2E-2909-1` (actes 0 à 3.1, joué en production)

**Rapport reçu le** 29/09/2026 · **Environnement du run** :
`https://ecoledigitale.allianceconsultants.net`, base de production.

Chaque anomalie a été confrontée au code. Verdicts : **corrigé**, **configuration** (rien à
changer dans le code, un réglage de l'environnement explique l'écart), **voulu**, **à décider**.

---

## ANO-A0-01 — Panneau « Comptes par tenant » exposé en production

**Verdict : confirmé, corrigé dans le code. Gravité réelle : critique.**

**Cause.** `apps/web/src/app/login/page.tsx` affichait le panneau sans aucune condition
d'environnement. Les identifiants étaient écrits en dur dans `lib/technical-accounts.ts`, donc
**inclus dans le JavaScript envoyé à tout visiteur** de `/login`, panneau affiché ou non.

**Correctif.**
- **Identifiants côté serveur.** Ils sont déplacés dans `lib/technical-accounts.server.ts`,
  jamais importé par un composant client. Le code envoyé au navigateur a été vérifié : il ne
  contient plus aucun mot de passe.
- **Nouvelle route `/api/technical-accounts`.** Elle ne renvoie les comptes que si
  `SHOW_TECHNICAL_ACCOUNTS=true`, ou, faute de réglage, hors production (`next dev`).
  Autrement, elle répond `{ enabled: false }`.
- **`/api/tenants` coupé.** Il cesse d'énumérer les établissements quand le panneau est coupé.
- **`docker-compose.yml` épinglé.** Il fixe `SHOW_TECHNICAL_ACCOUNTS: ${SHOW_TECHNICAL_ACCOUNTS:-false}`.

**Ce que le correctif ne suffit PAS à régler. À faire par l'exploitation, sans attendre :**
1. **Changer en production les mots de passe des comptes techniques** : `admin@`, `owner@`,
   `teacher@`, `student@`, `parent@<tenant>.local`, sur **chaque** tenant.
   - Le mot de passe par défaut `Password@2025` et le schéma d'adresse sont dans le dépôt : les
     cacher de l'écran ne les rend pas secrets.
2. **Changer aussi ceux des trois comptes de démonstration** : `adjoua.brou@…`,
   `adama.kouassi.001@…`, `bernard.kouassi.p01@…`. Leurs mots de passe restent lisibles dans
   l'historique Git.
3. **Contrôler les connexions récentes de ces comptes** dans les journaux, en cherchant des
   adresses IP inconnues : ils étaient ouverts à tous depuis la mise en ligne du panneau.
4. **Déployer le correctif**, puis vérifier que `/login` n'affiche plus que le formulaire.

---

## ANO-A1-01 — « Scolarité », « Paiements », « Finances étudiantes » absents du menu admin

**Verdict : configuration (ou version déployée plus ancienne), pas le code.**

Dans le code actuel, ces entrées sont rendues pour tout administrateur. Deux filtres seulement
peuvent les masquer :
- **la configuration des menus** (« Accès → Menus par rôle », ou la liste blanche d'un rôle
  admin personnalisé). Clés concernées :
  - `finance.scolarite`
  - `finance.student_payments`
  - `finance.tuition_schedules`
  - les rapports financiers ;
- **le bloc « Finances Étudiantes »**, qui exige en plus que le rôle soit littéralement `admin`
  ou `super_admin`. Un compte au rôle `administrateur` ne le voit pas
  (`Sidebar.tsx`, section « Student Finance Admin »).

**À vérifier en production :**
- l'écran « Menus par rôle » du rôle Administrateur ;
- le commit réellement déployé : le déplacement de Scolarité et Paiements dans le groupe
  « Étudiants » est récent.

---

## ANO-A2-01 — Les UE « Conduite » absentes de la liste des UE

**Verdict : voulu.**

`professionnel/admin/ue/page.tsx` les exclut délibérément : « La Conduite est transversale
(sans prix) : jamais affichée ni comptée ici. » Cela explique l'écart 364 / 484.

Conséquence ergonomique : une UE de conduite ne se modifie (UV, statut) qu'en ouvrant sa fiche
par l'URL. **Proposition** : un filtre « Afficher les UE de conduite » plutôt qu'une exclusion
totale.

---

## ANO-A2-02 — Une même UE cochable dans plusieurs semestres

**Verdict : à décider.**

Rien n'empêche aujourd'hui une UE d'appartenir à deux semestres : ni l'écran, ni l'API, ni la
base. L'unicité ne porte que sur le couple (semestre, UE).

Si une UE ne doit appartenir qu'à un semestre, **proposition** :
- griser dans les autres blocs une UE déjà cochée ;
- ajouter un contrôle serveur.

À trancher avant de coder : certaines formations partagent-elles volontairement une UE entre
semestres ?

---

## ANO-A3-01 — Service e-mail non configuré en production

**Verdict : configuration.**

`SMTP_HOST`, `SMTP_USER` et `SMTP_PASSWORD` manquent dans l'environnement de l'API. En
attendant, « Réinitialiser le mot de passe » sur les fiches enseignant, étudiant et parent
affiche le nouveau mot de passe une fois.

---

## Onglet figé au doublon d'enseignant (acte 3.1)

**Verdict : limite de l'outil de test, pas un défaut bloquant.**

`academic/teachers/new` signale ses erreurs, dont « Un enseignant avec cet email existe déjà »,
par un `alert()` natif, que l'extension ne sait pas fermer. Un humain clique OK.

**Proposition** : afficher ces erreurs dans la page, comme le fait déjà l'échec d'envoi
d'e-mail.

---

## Le run lui-même : poursuite en production, décidée par l'utilisateur

L'utilisateur a choisi de poursuivre en production. Le scénario a un **mode production**
(§0.1 bis) :
- l'humain se connecte lui-même aux comptes ;
- les encaissements et les diplômes sont optionnels (paramètres OUI / NON), parce qu'ils
  consomment de vrais numéros de reçu et de diplôme ;
- la paie n'est jamais générée ;
- le nettoyage est obligatoire en fin de run.

**Reprise** : à l'acte 3.1 (test de doublon), avec le même tag `E2E-2909-1` et le registre du
rapport. L'alerte native restée ouverte est à fermer par l'humain.

**Nettoyage en fin de run** : `docs/testing/e2e-computer-use/nettoyage-parcours-pro.sql`, avec
`-v tag=E2E-2909-1 -v code=29091`, d'abord à blanc (`commit=0`).

---

# Deuxième rapport — actes 3 à 6, production

| Anomalie | Verdict | Suite |
|---|---|---|
| **ANO-A4-01** — tables de prospection absentes (500) | Corrigé par l'exploitation : migrations 0120 à 0130 appliquées | Reste `0035_transcripts.sql` à appliquer (relevés de notes) |
| **ANO-A4-02** — message SQL brut renvoyé au navigateur | **Corrigé** | Les routes `professional`, `professional-remuneration` et `prospection` avaient leur propre gestionnaire d'erreurs, qui renvoyait `error.message` tel quel. Elles utilisent désormais `utils/public-error-message.ts` : en production, une erreur PostgreSQL devient « Erreur interne du serveur. ». Les messages métier restent affichés. Le détail reste dans les journaux |
| **ANO-A4-03** — la fenêtre « Nouveau commercial » ne se ferme pas | **Corrigé** | La fermeture attendait le rechargement de toutes les listes de prospection. Elle suit maintenant directement la réponse du serveur, et le rechargement se fait en arrière-plan |
| **ANO-A5-01** — matricule `-0061` au lieu de `-0001` | **Voulu**, erreur du scénario | Le suffixe est le numéro d'ordre de l'étudiant dans l'établissement : il reste le même d'une classe à l'autre (`professional-enrollment.service.ts`). Scénario corrigé |
| **ANO-A5-02** — les inscrits restent cochés après enregistrement | **Corrigé** | La sélection est vidée et la liste des inscriptibles rechargée dès l'enregistrement |
| **ANO-A5-03** — ligne de créneau qui déborde (planning) | **Corrigé** | Les colonnes peuvent rétrécir (`min-w-0`) : une ECUE au libellé long ne pousse plus la ligne hors de l'écran |
| **ANO-A5-04** — créneau supprimé sans confirmation | **Corrigé** | Boîte de confirmation « Supprimer ce créneau ? » (composant de l'application, pas une alerte native) |
| **ANO-A3-02** — erreurs en `alert()` natif (enseignant, étudiant, parent) | **À planifier** | Refonte des trois formulaires pour afficher l'erreur dans la page. Pas d'impact sur les données ; gêne l'automatisation |
| **ANO-A3-03** — sous-préfecture « Abengourou » affichée, vide enregistrée | **Pas un défaut visible** | Le champ est dans une carte **masquée** (`className="hidden"`) et facultatif dans le schéma. L'outil de test lit le DOM caché ; un utilisateur ne voit rien. À nettoyer à l'occasion : l'étoile « * » d'un champ masqué et facultatif est trompeuse |
| Téléphone `0701<JJMMN>` à 9 chiffres | Erreur du scénario | Corrigé : `0701<JJMMN>0` |
| « Inscription directe, sans paiement préalable » (onglet Inscrits d'une session) | **À décider** | Ce chemin confirme l'étudiant sans passer par le verrou des frais d'inscription. Voulu pour les régularisations ? Sinon, il faut l'aligner sur `professional-inscription-gate.ts` |
| Signataire « Diplôme — droite » : titre dans le champ Nom | Donnée | « CELESTE BAH, Enseignant - chercheur » : à vérifier sur le PDF du diplôme. Correction dans Signataires si le rendu déplaît |
| TF (« Total des frais ») = 350 000 | Constat | Le total dû d'un étudiant couvre dès l'inscription le barème complet des trois semestres, pas la part du semestre ouvert |
