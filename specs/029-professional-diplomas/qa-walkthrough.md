# Workflow de test bout-en-bout — Diplômes Professionnels (Feature 029)

> **Public** : testeur QA (humain) qui valide la feature `029-professional-diplomas` dans l'environnement de **dev local**, après l'implémentation des 44 tâches.
> **Statut de la feature** : implémentée, `jest professional` = 126 tests verts, migration `0064` appliquée.
> **Ce que ce document apporte par rapport à `quickstart.md`** : des **données réelles** déjà présentes dans la base de dev (tenant, programme, matières, étudiant, parent), des **valeurs concrètes à saisir** dans chaque formulaire, et un parcours qui exerce **les 5 user stories** en une seule session.

---

## 0. Pré-requis

### 0.1 Services lancés

```powershell
# À la racine du monorepo
pnpm dev   # lance l'API (port 4000) + le web (port 3000)
```

Vérifier :

- API : `GET http://localhost:4000/api/v1/professional/_health` → `{ "success": true, "data": { "module":"professional","status":"ok" } }` (préfixe protégé par auth — voir §0.3 pour le JWT).
- Web : `http://localhost:3000` répond.

### 0.2 Base de données

La migration `0064` doit être appliquée :

```powershell
node scripts/apply-migration-0064-professional-diplomas.js
```

Sortie attendue : `Migration 0064 applied successfully.` (idempotent — sans risque de rejouer).

### 0.3 Comptes de test (déjà en base, tenant `ecoledigitale`)

| Rôle | Email | Identifiant interne | Notes |
|---|---|---|---|
| **Administrateur** | `admin@imhotepacademy.fr` | — | Rôle `admin` sur le tenant `ecoledigitale` |
| **Étudiant** | `ibrahim.traore@example.com` | `student_profiles.id` = `505593e8-9fe2-4bc1-9982-72dc60a58054` | Ibrahim Traoré, matricule 10045 |
| **Parent** | `mariam.traore@example.com` | `users.id` = `fb0ba230-a8ae-4335-9f78-c1105022c756` | Mariam Traoré, rattachée à Ibrahim |

> Mots de passe : voir l'équipe / les seeds de dev. L'en-tête `X-Tenant` à utiliser pour les appels API directs est `ecoledigitale` (slug du tenant).

---

## 1. Données réelles utilisées par le workflow

### 1.1 IDs déjà en base (à connaître)

| Concept | Valeur |
|---|---|
| Tenant `ecoledigitale` | `f73f529f-5b1b-4027-877d-d4dc344d081b` |
| Programme « BTS GESTION COMMERCIALE 1ère ANNEE » (code `BTS GC 1`) | `e9f40e09-2e85-49f2-8517-5bee742bba43` |
| Matière `COMPTA-GEN` — 4 UV | `b093db26-a030-478d-b939-5d47445e6db0` |
| Matière `COMPTA-ANA` — 5 UV | `4564716d-2bc7-4197-95fd-bac24c78fcbe` |
| Matière `FISC-ENT` — 3 UV  | `4fe57f6b-ed48-46c9-9865-a67e708ab54f` |
| Étudiant Ibrahim — `student_profiles.id` | `505593e8-9fe2-4bc1-9982-72dc60a58054` |
| Inscription Ibrahim sur `COMPTA-ANA` (statut `confirmee`, à terminer en §6) | `7370d213-27bb-428c-8b46-77ca596f4b21` |

### 1.2 État initial des inscriptions d'Ibrahim

| Matière | UV | Statut initial |
|---|---|---|
| COMPTA-GEN | 4 | **terminée** ✅ |
| FISC-ENT  | 3 | **terminée** ✅ |
| COMPTA-ANA | 5 | confirmée (sera terminée en §6) |

→ Avant le workflow : Ibrahim cumule **7 UV** validées sur les matières exigées des diplômes que nous allons créer.

### 1.3 Les 2 diplômes que nous allons créer

| Diplôme | Code (à saisir) | UV à valider | Exigences | Ibrahim éligible ? |
|---|---|---|---|---|
| **A. CAP Comptabilité de base** | `QA-CAP-BASE` | **7** | COMPTA-GEN (oblig.), FISC-ENT (oblig.), COMPTA-ANA (non oblig.) | **Oui** dès la composition (7 UV obligatoires terminées) |
| **B. Certificat Comptabilité Analytique** | `QA-CERT-ANA` | **9** | COMPTA-GEN (oblig.), COMPTA-ANA (oblig.) | **Non** au départ (COMPTA-ANA pas encore terminée) |

Le diplôme A exerce l'**octroi automatique au recompute**. Le diplôme B exerce l'**octroi forcé**, la **révocation**, puis l'**octroi automatique au hook `terminee`** (en §6).

---

## 2. Scénario 1 — Admin : créer le diplôme A et constater l'octroi automatique (US1 + US2)

> Connectez-vous en tant qu'**admin** (`admin@imhotepacademy.fr`).

### 2.1 Aller à la liste des diplômes

URL : `http://localhost:3000/professionnel/admin/diplomes`

**Attendu** : la liste s'affiche. Si aucun diplôme n'a déjà été créé, le bloc « Aucun diplôme » apparaît avec un bouton « Créer un diplôme ».

### 2.2 Créer le diplôme A

Cliquer sur **« Nouveau diplôme »** (en haut à droite) → URL : `/professionnel/admin/diplomes/new`.

Remplir le formulaire **avec ces valeurs exactes** :

| Champ | Valeur |
|---|---|
| Programme | `BTS GESTION COMMERCIALE 1ère ANNEE` |
| Code | `QA-CAP-BASE` |
| Libellé | `CAP Comptabilité de base` |
| Description | `Diplôme d'essai — workflow QA 029` |
| UV à valider | `7` |
| Statut | `Actif` |

Cliquer sur **« Créer le diplôme »**.

**Attendu** : redirection automatique vers `/professionnel/admin/diplomes/{id}/exigences` (l'éditeur d'exigences) — le diplôme est créé au statut `actif`.

### 2.3 Composer les exigences du diplôme A

Sur l'éditeur d'exigences, la liste des matières du programme s'affiche. **Cocher les 3 matières** et configurer :

| Matière | Cocher | Obligatoire | Ordre |
|---|:---:|:---:|---|
| `COMPTA-GEN` — Comptabilité générale (4 UV) | ☑ | ☑ | `0` |
| `FISC-ENT` — Fiscalité de l'entreprise (3 UV) | ☑ | ☑ | `1` |
| `COMPTA-ANA` — Comptabilité analytique (5 UV) | ☑ | ☐ | `2` |

Vérifier le bandeau « Total UV sélectionnées » :

> **Attendu** : `12 / 7 UV requises` → bandeau vert « ✓ La cible de 7 UV est atteignable. »

Cliquer sur **« Enregistrer les exigences »** → redirection vers le détail du diplôme.

### 2.4 Vérifier l'octroi automatique au recompute

Sur l'écran détail (`/professionnel/admin/diplomes/{id}`), le bandeau « Vue d'ensemble » affiche pour l'instant :

- `Statut : actif`
- `UV à valider : 7`
- `UV atteignables : 12`
- `Étudiants diplômés : 0`

Cliquer sur **« Recalculer l'éligibilité »** (bouton en haut, icône ↻).

**Attendu** :

- Bandeau bleu : « **1 nouvel(s) octroi(s) créé(s) lors du recalcul.** »
- `Étudiants diplômés : 1` (après refresh).
- Section « Étudiants diplômés » : une ligne **« Ibrahim Traoré »**, référence au format `DIP-2026-XXXXXX`, statut `obtenu`, UV `7`.

### 2.5 Vérifier l'idempotence

Re-cliquer sur **« Recalculer l'éligibilité »**.

**Attendu** : bandeau bleu « **Recalcul terminé : aucun nouvel octroi (tous les étudiants éligibles sont déjà diplômés).** » — toujours **1 octroi** affiché.

### 2.6 Vérifier qu'on ne peut pas supprimer un diplôme déjà octroyé

Retour à la liste (`/professionnel/admin/diplomes`). Sur la card « CAP Comptabilité de base », cliquer sur l'icône poubelle 🗑.

**Attendu** : bandeau d'erreur rouge « **Impossible de supprimer : ce diplôme a été octroyé à au moins un étudiant.** » (code `DIPLOMA_HAS_AWARDS`).

---

## 3. Scénario 2 — Étudiant : voir sa progression et l'attestation (US3)

> Déconnectez-vous et reconnectez-vous en tant qu'**étudiant** (`ibrahim.traore@example.com`).

### 3.1 Voir mes diplômes

URL : `http://localhost:3000/professionnel/etudiant/diplomes`

**Attendu** :

- Section « **Diplômes obtenus** » : une card « **CAP Comptabilité de base** » avec badge vert « Obtenu », barre de progression à 100 %, référence `DIP-2026-XXXXXX`.

### 3.2 Voir la progression détaillée

Cliquer sur **« Voir ma progression »** sur la card.

URL : `/professionnel/etudiant/diplomes/{id}`

**Attendu** :

- Carte « Ma progression » : message « Vous avez obtenu ce diplôme. »
- Compteur : `7 / 7 UV` — `100 %`
- Bloc « Matières validées (2) » : COMPTA-GEN, FISC-ENT (avec mention « obligatoire » pour les deux)
- Bloc « À valider (1) » : COMPTA-ANA (5 UV)
- Carte « Attestation » : référence du diplôme, bouton « Voir l'attestation »

### 3.3 Voir l'attestation

Cliquer sur **« Voir l'attestation »**.

**Attendu** : bloc encadré affichant :

- `CAP Comptabilité de base`
- `Programme : BTS GESTION COMMERCIALE 1ère ANNEE`
- `Référence : DIP-2026-XXXXXX`
- `Titulaire : Ibrahim Traoré`
- `UV validées : 7`
- Liste des matières validées (COMPTA-GEN — 4 UV, FISC-ENT — 3 UV)

---

## 4. Scénario 3 — Admin : créer le diplôme B et tester l'octroi forcé + révocation (US4)

> Reconnectez-vous en **admin**.

### 4.1 Créer le diplôme B

Aller à `/professionnel/admin/diplomes/new`. Remplir :

| Champ | Valeur |
|---|---|
| Programme | `BTS GESTION COMMERCIALE 1ère ANNEE` |
| Code | `QA-CERT-ANA` |
| Libellé | `Certificat Comptabilité Analytique` |
| Description | (laisser vide) |
| UV à valider | `9` |
| Statut | `Actif` |

→ **« Créer le diplôme »** → redirection vers l'éditeur d'exigences.

### 4.2 Composer les exigences du diplôme B

| Matière | Cocher | Obligatoire | Ordre |
|---|:---:|:---:|---|
| COMPTA-GEN | ☑ | ☑ | 0 |
| COMPTA-ANA | ☑ | ☑ | 1 |

**Attendu** :

- Bandeau « Total UV sélectionnées : `9 / 9 UV requises` » — vert.

→ **« Enregistrer les exigences »**.

### 4.3 Vérifier qu'Ibrahim N'est PAS éligible

Sur le détail du diplôme, cliquer sur **« Recalculer l'éligibilité »**.

**Attendu** : bandeau bleu « **Recalcul terminé : aucun nouvel octroi …** » — `Étudiants diplômés : 0`. (Ibrahim n'a pas terminé COMPTA-ANA, donc obligatoire manquante.)

### 4.4 Tester un test négatif : octroi sans `force`

Sur l'écran détail, dans la section « Étudiants diplômés » :

- Coller dans le champ « Identifiant de l'étudiant » : `505593e8-9fe2-4bc1-9982-72dc60a58054`
- **Ne pas cocher** « Forcer (ignorer l'éligibilité) »
- Cliquer sur **« Octroyer »**

**Attendu** : bandeau rouge « **L'étudiant n'est pas éligible. Utilisez l'octroi forcé pour passer outre.** » (code `DIPLOMA_NOT_ELIGIBLE`).

### 4.5 Tester l'octroi forcé

Même formulaire, cette fois :

- Identifiant étudiant : `505593e8-9fe2-4bc1-9982-72dc60a58054`
- **Cocher** « Forcer (ignorer l'éligibilité) »
- **« Octroyer »**

**Attendu** :

- Bandeau vert « Diplôme octroyé à l'étudiant. »
- Liste « Étudiants diplômés » : 1 ligne — Ibrahim Traoré, référence `DIP-2026-XXXXXX`, statut `obtenu`.

### 4.6 Tester un test négatif : double octroi

Renouveler immédiatement l'octroi (cocher ou non, peu importe).

**Attendu** : bandeau rouge « **Cet étudiant détient déjà ce diplôme.** » (code `DIPLOMA_ALREADY_AWARDED`).

### 4.7 Tester un test négatif : révocation sans motif

Sur la ligne d'Ibrahim, cliquer sur **« Révoquer »**. Une fenêtre `prompt` s'ouvre.

- **Premier essai** : laisser vide → OK.

**Attendu** : bandeau rouge « **Le motif de révocation est requis.** ».

### 4.8 Révocation avec motif

Re-cliquer sur **« Révoquer »**. Dans la fenêtre `prompt`, saisir :

```
Erreur de saisie — l'étudiant n'a pas encore terminé COMPTA-ANA
```

→ OK.

**Attendu** :

- Bandeau vert « Diplôme révoqué. »
- La ligne d'Ibrahim affiche statut `revoque` avec le motif en colonne « Action ».
- Le bouton « Révoquer » a disparu (statut terminal).

### 4.9 Vérifier qu'un nouvel octroi est possible après révocation

Refaire un octroi forcé (cocher « Forcer », « Octroyer »).

**Attendu** : un nouvel octroi `obtenu` apparaît avec une **nouvelle référence** (la révoquée reste affichée comme historique).

### 4.10 Révoquer à nouveau pour préparer le scénario suivant

Révoquer le nouveau octroi avec motif `Préparation scénario auto-award`. (Ceci permet au §6 de tester l'octroi auto via le hook.)

---

## 5. Scénario 4 — Parent : consulter les diplômes de son enfant (US5)

> Déconnectez-vous et reconnectez-vous en **parent** (`mariam.traore@example.com`).

### 5.1 Aller à la page des diplômes enfant

URL : `http://localhost:3000/parent/professionnel/diplomes`

**Attendu** : sélecteur d'enfant, avec **Ibrahim Traoré (10045)** disponible.

### 5.2 Sélectionner Ibrahim

Choisir « Ibrahim Traoré » dans le menu déroulant.

**Attendu** :

- Section « **Diplômes obtenus** » : une card « **CAP Comptabilité de base** » (le diplôme A), badge vert « Obtenu », barre de progression 100 %, référence.
- Section « **En cours** » : une card « **Certificat Comptabilité Analytique** » (le diplôme B), pas de badge Obtenu, pourcentage cohérent avec la progression d'Ibrahim (≈ 44 % = 4 / 9 UV — COMPTA-GEN terminée seulement).
- **Aucun bouton d'action** (lecture seule, FR-032).

### 5.3 Vérification de cloisonnement (API)

Avec le JWT du parent Mariam, tenter d'accéder à un enfant qui n'est pas le sien (changer `child_id` dans l'URL d'appel API) :

```powershell
# Exemple ; remplacer <JWT_PARENT> et utiliser un student_id inexistant ou non lié
curl -X GET "http://localhost:4000/api/v1/professional/parent/diplomas?child_id=00000000-0000-0000-0000-000000000000" `
  -H "Authorization: Bearer <JWT_PARENT>" `
  -H "X-Tenant: ecoledigitale"
```

**Attendu** : `403 FORBIDDEN` avec message « Cet enfant n'est pas rattaché à votre compte. ».

---

## 6. Scénario 5 — Octroi automatique sur transition `terminee` (US2 — chemin live)

> Reconnectez-vous en **admin**.

Ce scénario vérifie le **hook best-effort** branché sur `POST /enrollments/:id/complete` : marquer une inscription `terminee` doit déclencher la réévaluation des diplômes et octroyer automatiquement le diplôme B à Ibrahim.

### 6.1 Marquer terminée l'inscription COMPTA-ANA d'Ibrahim

**Via l'API** (le plus direct — le suivi 028 admin peut aussi le faire) :

```powershell
$JWT_ADMIN = "<JWT_ADMIN>"   # JWT de l'admin
curl -X POST "http://localhost:4000/api/v1/professional/enrollments/7370d213-27bb-428c-8b46-77ca596f4b21/complete" `
  -H "Authorization: Bearer $JWT_ADMIN" `
  -H "X-Tenant: ecoledigitale" `
  -H "Content-Type: application/json"
```

**Attendu** : `200` avec `{ "success": true, "data": { "id": "7370d213-…", "statut": "terminee", "subject_id": "4564716d-…", … } }`.

### 6.2 Vérifier l'octroi automatique sur le diplôme B

Sur l'écran détail du diplôme B (`/professionnel/admin/diplomes/{id_B}`), **rafraîchir la page** (le hook s'est exécuté côté serveur).

**Attendu** :

- Section « Étudiants diplômés » : **une nouvelle ligne** au statut `obtenu` pour Ibrahim, avec une **nouvelle référence** `DIP-2026-XXXXXX`, `octroye_par` vide (octroi automatique — non affiché dans l'UI).
- L'octroi révoqué de §4.10 reste visible en historique.
- `Étudiants diplômés : 1` (le compteur ne compte que les `obtenu`).

### 6.3 Vérifier côté étudiant

Reconnectez-vous en **Ibrahim** → `/professionnel/etudiant/diplomes`.

**Attendu** : section « Diplômes obtenus » contient désormais **les deux diplômes** (A et B). Le diplôme B est à 100 %.

### 6.4 Vérifier la non-régression du chemin `028`

L'achèvement de l'inscription a réussi (étape 6.1 — `200`) même si le recompute des diplômes échouait. C'est garanti par le `try/catch` best-effort (FR-020) ; aucune action supplémentaire à tester ici, l'étape 6.1 le prouve.

---

## 7. Cas négatifs additionnels (validations serveur)

### 7.1 Validation Zod côté création

Tenter de créer un diplôme avec `uv_required = 0` :

- Via l'UI (`/professionnel/admin/diplomes/new`) : saisir `0` dans « UV à valider » → bandeau rouge « Le nombre d'UV à valider doit être un entier strictement positif. ».
- Via API : `POST /diplomas` avec `{"uv_required":0,…}` → `422 VALIDATION_ERROR`.

### 7.2 Code dupliqué

Tenter de recréer un diplôme avec le code `QA-CAP-BASE` déjà utilisé → **422 / 409 `DUPLICATE_DIPLOMA_CODE`** : « Un diplôme avec le code "QA-CAP-BASE" existe déjà. ».

### 7.3 Cohérence de programme des exigences (API)

Via curl, tenter d'ajouter une exigence pointant vers une matière inexistante (UUID bidon) :

```powershell
curl -X PUT "http://localhost:4000/api/v1/professional/diplomas/<id_diplome_A>/requirements" `
  -H "Authorization: Bearer <JWT_ADMIN>" `
  -H "X-Tenant: ecoledigitale" `
  -H "Content-Type: application/json" `
  -d '{"requirements":[{"subject_id":"00000000-0000-0000-0000-000000000000","est_obligatoire":false,"ordre":0}]}'
```

**Attendu** : `422 VALIDATION_ERROR` — « Une matière référencée est introuvable. ».

### 7.4 Rôle enseignant : aucun accès

Avec un JWT enseignant (rôle `teacher`), appeler n'importe quel endpoint diplôme :

```powershell
curl -X GET "http://localhost:4000/api/v1/professional/diplomas" `
  -H "Authorization: Bearer <JWT_TEACHER>" -H "X-Tenant: ecoledigitale"
```

**Attendu** : `403 FORBIDDEN` (la garde `requireAdmin` refuse).

### 7.5 Isolation tenant

Avec un JWT admin d'un **autre** tenant, tenter d'accéder à un diplôme du tenant `ecoledigitale` par son id :

**Attendu** : `404 DIPLOMA_NOT_FOUND` (la RLS borne les lectures au tenant courant).

---

## 8. Non-régression du Module Professionnel `028`

Vérifier qu'aucune fonctionnalité existante n'est cassée :

| Parcours `028` | URL / endpoint | Attendu |
|---|---|---|
| Catalogue matières (admin) | `/professionnel/admin/matieres` | Liste inchangée, les 3 matières (COMPTA-GEN, COMPTA-ANA, FISC-ENT) toujours visibles |
| Sessions (admin) | `/professionnel/admin/sessions` | Liste inchangée |
| Étudiant — mes inscriptions | `/professionnel/etudiant/inscriptions` | Toujours fonctionnel pour Ibrahim |
| Parent — vue 028 | `/parent/professionnel` | Toujours fonctionnel pour Mariam |
| Marquer terminée | `POST /enrollments/:id/complete` | Renvoie toujours `200` même si le recompute diplômes échouait |
| Jest 028 | `pnpm --filter @ecoledigitale/api exec jest professional` | **126 tests verts** (72 de `028` + 54 de `029`) |

---

## 9. Nettoyage final

Après la validation, supprimer les deux diplômes de test pour ne pas polluer la base de dev :

```sql
-- Connexion psql ou via votre client SQL
BEGIN;

-- Identifier les diplômes QA
SELECT id, code, libelle FROM professional_diplomas
WHERE tenant_id = 'f73f529f-5b1b-4027-877d-d4dc344d081b'
  AND code IN ('QA-CAP-BASE','QA-CERT-ANA');

-- Supprimer leurs octrois (toutes lignes, dont révoquées)
DELETE FROM student_professional_diplomas
WHERE tenant_id = 'f73f529f-5b1b-4027-877d-d4dc344d081b'
  AND diploma_id IN (
    SELECT id FROM professional_diplomas
    WHERE tenant_id = 'f73f529f-5b1b-4027-877d-d4dc344d081b'
      AND code IN ('QA-CAP-BASE','QA-CERT-ANA')
  );

-- Supprimer les diplômes (exigences en CASCADE)
DELETE FROM professional_diplomas
WHERE tenant_id = 'f73f529f-5b1b-4027-877d-d4dc344d081b'
  AND code IN ('QA-CAP-BASE','QA-CERT-ANA');

COMMIT;
```

> **Note** : le smoke test du §6.1 a marqué l'inscription `7370d213-…` (Ibrahim sur COMPTA-ANA) au statut `terminee`. Si vous souhaitez rejouer le scénario §6 plusieurs fois, remettez-la à `confirmee` :
>
> ```sql
> UPDATE professional_enrollments
> SET statut = 'confirmee', updated_at = now()
> WHERE id = '7370d213-27bb-428c-8b46-77ca596f4b21';
> ```

---

## 10. Critères de réussite du workflow

Le workflow est validé si **toutes** les vérifications suivantes sont vraies :

- [ ] §2 — Diplôme A créé, exigences enregistrées, **1 octroi automatique** sur Ibrahim après recompute, idempotence confirmée, suppression refusée.
- [ ] §3 — Ibrahim voit le diplôme A obtenu, sa progression 7/7 UV à 100 %, et peut consulter son attestation.
- [ ] §4 — Diplôme B créé, octroi non éligible rejeté, octroi forcé accepté, double octroi rejeté, révocation sans motif rejetée, révocation avec motif acceptée, ré-octroi possible après révocation.
- [ ] §5 — Mariam voit en lecture seule les deux diplômes d'Ibrahim, **0 action** disponible, accès à un autre enfant refusé en `403`.
- [ ] §6 — Marquer `7370d213-…` terminée déclenche **automatiquement** l'octroi du diplôme B à Ibrahim (hook côté serveur, sans intervention manuelle).
- [ ] §7 — Toutes les validations négatives renvoient les codes d'erreur attendus.
- [ ] §8 — Aucun parcours `028` n'est dégradé, `jest professional` reste à 126 verts.
- [ ] §9 — Nettoyage SQL effectué.

Si une seule case échoue, **noter le scénario, le statut/code reçu et le statut/code attendu**, puis remonter au mainteneur de la feature avant déploiement.

---

## Annexe A — Récupérer un JWT pour les appels API directs

Si la route `POST /api/v1/auth/login` (ou similaire selon le projet) est exposée :

```powershell
$body = @{ email = "admin@imhotepacademy.fr"; password = "<password>" } | ConvertTo-Json
$resp = Invoke-RestMethod -Method POST -Uri "http://localhost:4000/api/v1/auth/login" `
        -Headers @{ "Content-Type"="application/json" } `
        -Body $body
$JWT_ADMIN = $resp.data.token   # adapter au format réel de réponse
```

Sinon, récupérer le JWT depuis le navigateur (DevTools → Application → Local Storage / Cookies) après connexion.

## Annexe B — Codes d'erreur diplômes (référence rapide)

| Code | HTTP | Cas |
|---|---|---|
| `DIPLOMA_NOT_FOUND` | 404 | Diplôme inexistant dans le tenant courant |
| `DUPLICATE_DIPLOMA_CODE` | 409 | Code de diplôme déjà utilisé |
| `CROSS_PROGRAMME_REQUIREMENT` | 422 | Matière d'un autre programme |
| `DIPLOMA_HAS_AWARDS` | 409 | Suppression refusée — octrois non révoqués existants |
| `DIPLOMA_ALREADY_AWARDED` | 409 | L'étudiant détient déjà ce diplôme |
| `DIPLOMA_NOT_ELIGIBLE` | 422 | Octroi manuel sans `force` sur un étudiant non éligible |
| `DIPLOMA_NOT_AWARDED` | 404 | Révocation sur un diplôme non obtenu / attestation indisponible |
| `INVALID_DIPLOMA_STATUS_TRANSITION` | 422 | Transition de statut d'octroi non permise |
| `VALIDATION_ERROR` | 422 | Données invalides (Zod ou règles métier) |
| `FORBIDDEN` | 403 | Rôle non autorisé / enfant non rattaché au parent |
| `TENANT_REQUIRED` | 400 | En-tête `X-Tenant` manquant |
