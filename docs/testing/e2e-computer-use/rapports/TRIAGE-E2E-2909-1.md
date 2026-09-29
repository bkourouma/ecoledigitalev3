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

## Le run lui-même : à arrêter en production

Le parcours crée des données, encaisse des paiements et octroie un diplôme. **Il ne doit pas
continuer en production** : le scénario l'interdit désormais (§0.1 bis).

Données `E2E-2909-1` déjà créées en production, à supprimer. L'ordre compte à cause des clés
étrangères :
1. les semestres ;
2. les ECUE ;
3. les UE ;
4. la classe ;
5. la filière ;
6. le cycle ;
7. les deux enseignants et leurs comptes utilisateurs.

Identifiants :
- Semestres :
  - `4b432732-9f2a-4c5b-b7a5-7a62ff401509`
  - `8ae3eb98-9d24-423b-ad2e-0e00877c91c7`
  - `1b246551-364d-4835-9117-a50ff2f93a3b`
- ECUE et UE : ceux du registre du rapport (codes `*-29091`).
- Classe : `5c111540-2e58-4ddf-b551-27e9af61632e` (`L1T29091`).
- Cycle : `LIC29091`. Filière : `TESTOLOGIE E2E-2909-1`.
- Enseignants : `awa.29091@example.test` et `kone.29091@example.test`.

Reprendre ensuite le parcours **depuis l'acte 1**, sur `localhost` ou une copie de test, avec un
nouveau tag (`E2E-JJMM-2`).
