# Workflow QA bout-en-bout — Module Professionnel

> **Public** : testeur QA (humain) qui valide **l'ensemble du Module Professionnel** d'EcoleDigitale en dev local.
> **Périmètre couvert** : inscription publique, catalogue admin (matières, prérequis, supports au niveau matière, sessions), diplômes, parcours étudiant (panier, commande, paiement), parcours enseignant (supports, évaluations, séances visio LiveKit), parcours étudiant après inscription (supports lecture seule, évaluations, notes, visio), suivi (tracking de consultation), achèvement et octroi automatique du diplôme, vues étudiant et parent.
> **Durée estimée** : 45 min à 1h15 selon la rigueur.
> **Données** : on s'appuie sur les données déjà en base (tenant `ecoledigitale`, programme BTS GC 1, 3 matières COMPTA-GEN/COMPTA-ANA/FISC-ENT, étudiant Ibrahim Traoré déjà inscrit) **plus** un étudiant et un parent **fraîchement créés** via `/register` au §2.

---

## 0. Pré-requis techniques

### 0.1 Services lancés

```powershell
# À la racine du monorepo
pnpm dev    # API sur :4000, Web sur :3000
```

Si tu as relancé `pnpm dev` plusieurs fois sans tuer les anciens process, fais d'abord :

```powershell
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force
```

puis `pnpm dev`.

### 0.2 Base de données

- PostgreSQL accessible sur `localhost:5432/dbecoledigitale`.
- Migrations à jour jusqu'à `0066_*` (sessions onglets) et `0064` (diplômes professionnels).

### 0.3 Comptes existants (tenant `ecoledigitale`)

| Rôle | Email | Notes |
|---|---|---|
| **Administrateur** | `admin@imhotepacademy.fr` | À utiliser pour valider l'inscription, créer matières/diplômes, etc. |
| **Étudiant existant** | `ibrahim.traore@example.com` | `student_profiles.id` = `505593e8-9fe2-4bc1-9982-72dc60a58054` — déjà inscrit à des matières |
| **Parent existant** | `mariam.traore@example.com` | Rattaché à Ibrahim |

> Mots de passe : récupère-les côté seed/équipe.

### 0.4 IDs réels à connaître

| Concept | UUID |
|---|---|
| Tenant `ecoledigitale` | `f73f529f-5b1b-4027-877d-d4dc344d081b` |
| Programme « BTS GESTION COMMERCIALE 1ère ANNEE » (`BTS GC 1`) | `e9f40e09-2e85-49f2-8517-5bee742bba43` |
| Matière `COMPTA-GEN` — 4 UV | `b093db26-a030-478d-b939-5d47445e6db0` |
| Matière `COMPTA-ANA` — 5 UV | `4564716d-2bc7-4197-95fd-bac24c78fcbe` |
| Matière `FISC-ENT` — 3 UV | `4fe57f6b-ed48-46c9-9865-a67e708ab54f` |

### 0.5 Variables que tu créeras en cours de route

Note ces IDs au fur et à mesure (visibles dans l'URL après création) — ils servent pour les étapes suivantes :

| Variable | À récupérer à l'étape | Ex. |
|---|---|---|
| `{NEW_STUDENT_ID}` | §3 (admin valide l'inscription) | `student_profiles.id` |
| `{NEW_PARENT_ID}` | §3 | `users.id` |
| `{SUBJECT_INTRO_ID}` | §5 (nouvelle matière) | `professional_subjects.id` |
| `{SESSION_ID}` | §6 (création session) | `professional_subject_sessions.id` |
| `{DIPLOMA_ID}` | §7 (création diplôme) | `professional_diplomas.id` |
| `{ORDER_ID}` | §8 (commande étudiant) | `professional_orders.id` |
| `{ENROLLMENT_ID}` | §8 | `professional_enrollments.id` |
| `{ASSIGNMENT_ID}` | §11 (évaluation enseignant) | `assignments.id` ou équivalent |

---

## 1. Vue d'ensemble du workflow

```text
┌─────────────────────────────────────────────────────────────────────┐
│  PHASE 1 — Onboarding                                                │
│  §2  Inscription publique étudiant + parent (/register)              │
│  §3  Admin valide les inscriptions                                   │
├─────────────────────────────────────────────────────────────────────┤
│  PHASE 2 — Construction du catalogue (admin)                        │
│  §4  Matières professionnelles                                       │
│  §5  Prérequis entre matières                                        │
│  §6  Supports de cours (au niveau matière, PDF/PPT/vidéo)            │
│  §7  Sessions datées                                                 │
│  §8  Diplôme professionnel + exigences                               │
├─────────────────────────────────────────────────────────────────────┤
│  PHASE 3 — Parcours étudiant (achat à la carte)                     │
│  §9  Catalogue, panier, commande, paiement                           │
├─────────────────────────────────────────────────────────────────────┤
│  PHASE 4 — Enseignement                                              │
│  §10 Enseignant : voir ses sessions + déposer support                │
│  §11 Enseignant : créer une évaluation                               │
│  §12 Enseignant : programmer séance visio LiveKit                    │
├─────────────────────────────────────────────────────────────────────┤
│  PHASE 5 — Apprentissage côté étudiant                              │
│  §13 Étudiant : voir les supports en lecture seule + tracking        │
│  §14 Étudiant : prendre l'évaluation                                 │
│  §15 Étudiant : rejoindre la séance visio                            │
├─────────────────────────────────────────────────────────────────────┤
│  PHASE 6 — Notation & suivi                                          │
│  §16 Enseignant : corriger les copies                                │
│  §17 Étudiant : voir sa note                                         │
│  §18 Admin/enseignant : tracking des consultations de supports       │
├─────────────────────────────────────────────────────────────────────┤
│  PHASE 7 — Achèvement & diplôme                                      │
│  §19 Admin : marquer l'inscription terminée                          │
│  §20 Octroi automatique du diplôme (hook)                            │
│  §21 Étudiant + parent : voir le diplôme et l'attestation            │
├─────────────────────────────────────────────────────────────────────┤
│  §22 Nettoyage SQL                                                   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Inscription publique de l'étudiant

**URL** : <http://localhost:3000/register>

**Ce que cette page permet** : un futur étudiant (ou son parent) peut s'inscrire sans intervention admin. La demande passe en statut `en_attente` et un administrateur du tenant la valide ensuite.

### 2.1 Renseigner les informations de l'étudiant

| Champ | Valeur à saisir |
|---|---|
| Type d'inscription | **Étudiant** |
| Établissement (tenant) | **ecoledigitale** (ou « EcoleDigitale ») |
| Prénom | `Test` |
| Nom | `QA-Module` |
| Date de naissance | `2005-04-15` |
| Email | `test.qa.module@example.com` |
| Téléphone | `+221 77 000 00 01` |
| Mot de passe | `Qa-2026!` |
| Confirmation | `Qa-2026!` |
| Cycle / Programme demandé | `BTS GESTION COMMERCIALE 1ère ANNEE` |

Clique sur **« S'inscrire »**.

### ✅ Attendu

- Message de succès « **Votre demande d'inscription a été reçue, en attente de validation administrative.** »
- Une entrée a été créée dans la table `registration_requests` au statut `en_attente`.

### 2.2 Inscription publique du parent (en parallèle)

Refais la même opération avec :

| Champ | Valeur |
|---|---|
| Type d'inscription | **Parent** |
| Prénom | `Parent` |
| Nom | `QA-Module` |
| Email | `parent.qa.module@example.com` |
| Téléphone | `+221 77 000 00 02` |
| Mot de passe | `Qa-2026!` |
| Lien avec l'enfant | Email de l'enfant : `test.qa.module@example.com` (selon UI) |

> Si l'UI ne propose pas la liaison parent-enfant dès l'inscription, on fera la liaison en admin au §3.

---

## 3. Validation administrative des inscriptions

> Connecte-toi en **administrateur** : <http://localhost:3000/login> → `admin@imhotepacademy.fr`.

**URL** : <http://localhost:3000/registration-requests>

**Ce que cette page permet** : lister, examiner, valider ou refuser les demandes d'inscription publiques.

### 3.1 Valider la demande étudiante

1. Trouve la ligne « Test QA-Module — test.qa.module@example.com » au statut `En attente`.
2. Clique sur le bouton **« Examiner »** ou directement **« Valider »** selon l'UI.
3. À la validation, le système :
   - Crée l'utilisateur (`users.id`) avec le rôle `student`.
   - Crée le profil étudiant (`student_profiles.id`) — **note cet ID, c'est `{NEW_STUDENT_ID}`**.
   - Inscrit l'étudiant au programme demandé via `student_enrollments` (académique).
   - Active le compte → l'étudiant peut maintenant se connecter.

### 3.2 Valider la demande parent

Idem pour `Parent QA-Module`. Note `{NEW_PARENT_ID}` = le `users.id` du parent.

### 3.3 Lier parent ↔ enfant

**URL admin** : <http://localhost:3000/academic/students> (ou la page de gestion étudiant)

Ouvre le profil de **Test QA-Module** → onglet « Parents » → **« Ajouter un parent »** → sélectionne **Parent QA-Module**.

> Ou en SQL si l'UI n'expose pas l'action :
> ```sql
> INSERT INTO student_parents (tenant_id, student_id, parent_id)
> VALUES ('f73f529f-5b1b-4027-877d-d4dc344d081b', '{NEW_STUDENT_ID}', '{NEW_PARENT_ID}');
> ```

### 3.4 Récupérer `{NEW_STUDENT_ID}`

Sur la page liste des étudiants, clique sur Test QA-Module. L'URL devient `/academic/students/<student_profile_id>` → c'est `{NEW_STUDENT_ID}`.

---

## 4. Catalogue admin — créer (ou réutiliser) des matières professionnelles

**URL** : <http://localhost:3000/professionnel/admin/matieres>

**Ce que cette page permet** : lister, créer, modifier, désactiver les matières du module professionnel (vendues à la carte). Chaque matière porte un code, un libellé, une valeur en UV et un prix.

### 4.1 Vérifier que les 3 matières existantes sont là

Tu dois voir :

- **Comptabilité générale** (`COMPTA-GEN`) — 4 UV — prix défini
- **Comptabilité analytique** (`COMPTA-ANA`) — 5 UV
- **Fiscalité des entreprises** (`FISC-ENT`) — 3 UV

### 4.2 Créer une nouvelle matière (pour valider le formulaire)

Clique sur **« Nouvelle matière »** → URL <http://localhost:3000/professionnel/admin/matieres/new>.

| Champ | Valeur |
|---|---|
| Programme | `BTS GESTION COMMERCIALE 1ère ANNEE` |
| Code | `INTRO-COMPTA` |
| Libellé | `Introduction à la comptabilité` |
| Description | `Cours d'introduction, prérequis du parcours.` |
| Nombre d'UV | `2` |
| Prix | `15000` (FCFA) |
| Statut | `Actif` |

→ **« Créer la matière »**. Note l'ID dans l'URL → `{SUBJECT_INTRO_ID}`.

### ✅ Attendu

La nouvelle matière apparaît dans la liste avec ses caractéristiques.

---

## 5. Prérequis entre matières

**URL** : ouvre la matière `COMPTA-GEN` → <http://localhost:3000/professionnel/admin/matieres/b093db26-a030-478d-b939-5d47445e6db0> → onglet ou bouton **« Prérequis »**.

**Ce que cette page permet** : configurer qu'une matière B ne peut être suivie qu'après validation de la matière A. Un étudiant ne pourra pas ajouter au panier une matière dont au moins un prérequis n'est pas `terminée`.

### 5.1 Définir un prérequis

1. Sur la matière `COMPTA-GEN`, ajoute comme prérequis la nouvelle matière `INTRO-COMPTA` que tu viens de créer.
2. Sauvegarde.

### ✅ Attendu

- La liste des prérequis affiche `INTRO-COMPTA`.
- Côté serveur, une ligne a été créée dans `professional_subject_prerequisites`.

### 5.2 Test négatif (recommandé)

Essaye de définir COMPTA-GEN comme prérequis d'elle-même → rejet (auto-référence interdite, `VALIDATION_ERROR`).
Essaye d'ajouter une matière d'un autre programme → rejet `CROSS_PROGRAMME_PREREQUISITE`.

> Pour la suite du workflow, **supprime ce prérequis** (ou tu auras besoin de terminer INTRO-COMPTA avant de pouvoir t'inscrire à COMPTA-GEN — ralentit le test).

---

## 6. Supports de cours — au niveau de la matière

> **Important** : depuis la feature `0065_subject-materials`, les supports sont **rattachés à la matière** (pas à la session). Conséquence : une fois déposé, le support est disponible pour **toutes les sessions futures** de la matière. L'enseignant n'a plus besoin de tout redéposer chaque année.

**URL** : <http://localhost:3000/professionnel/admin/matieres/b093db26-a030-478d-b939-5d47445e6db0> → onglet/section **« Supports de cours »**.

### 6.1 Ajouter un support PDF

1. Clique sur **« Ajouter un support »**.
2. Renseigne :

| Champ | Valeur |
|---|---|
| Titre | `Manuel de comptabilité générale — chapitre 1` |
| Type | **PDF** |
| Fichier | uploader un PDF de test (n'importe lequel, < 10 Mo) |
| Description | `Notions de base, plan comptable.` |

3. **« Enregistrer »**.

### 6.2 Ajouter un support PowerPoint

| Champ | Valeur |
|---|---|
| Titre | `Diaporama — Le bilan comptable` |
| Type | **PowerPoint** (PPTX) |
| Fichier | un `.pptx` de test |
| Description | `Exposé visuel du chapitre 1.` |

### 6.3 Ajouter un support Vidéo

| Champ | Valeur |
|---|---|
| Titre | `Tutoriel vidéo — Lire un bilan` |
| Type | **Vidéo** |
| URL ou fichier | URL YouTube : `https://www.youtube.com/watch?v=dQw4w9WgXcQ` (test) — ou MP4 uploadé |
| Description | `Démonstration pratique.` |

### ✅ Attendu

Les 3 supports apparaissent dans la liste de la matière. Pas de notion de « session » — ils appartiennent à la matière.

---

## 7. Sessions datées

**URL** : <http://localhost:3000/professionnel/admin/sessions> (vue admin globale) ou depuis la fiche matière → **« Nouvelle session »**.

**Ce que cette page permet** : ouvrir une instance datée d'une matière, à laquelle les étudiants pourront s'inscrire pendant une fenêtre d'inscription.

### 7.1 Créer une session pour COMPTA-GEN

URL directe : <http://localhost:3000/professionnel/admin/sessions/new> (ou depuis la matière).

| Champ | Valeur |
|---|---|
| Matière | **Comptabilité générale (COMPTA-GEN)** |
| Libellé | `Session QA — Sept 2026` |
| Date de début | `2026-09-01` |
| Date de fin | `2026-12-15` |
| Ouverture des inscriptions | `2026-05-26` (aujourd'hui ou la veille) |
| Fermeture des inscriptions | `2026-09-30` |
| Capacité maximale | `30` |
| Enseignant | sélectionne un enseignant disponible (ex. : `prof@imhotepacademy.fr`) |
| Salle | (optionnel) |
| Statut initial | `Brouillon` |

→ **« Créer la session »**. Note `{SESSION_ID}` dans l'URL.

### 7.2 Passer la session au statut « Ouvert »

Sur l'écran détail de la session → bouton **« Ouvrir aux inscriptions »** ou changement de statut.

**URL** : <http://localhost:3000/professionnel/admin/sessions/{SESSION_ID}>

**Onglets attendus sur cette page** (feature `0066`) :
1. **Détails** — métadonnées de la session
2. **Inscrits** — étudiants inscrits (vide pour l'instant)
3. **Supports de cours** — hérités de la matière (les 3 ajoutés en §6)
4. **Évaluations** — vide pour l'instant (sera créé en §11)
5. **Séances visio** — vide (créée en §12)

### ✅ Attendu

- Session au statut `ouvert`.
- L'onglet **Supports** liste déjà les 3 supports (héritage matière → session).

---

## 8. Diplôme professionnel + exigences

**URL** : <http://localhost:3000/professionnel/admin/diplomes>

**Ce que cette page permet** : définir un diplôme qu'un étudiant peut obtenir en validant un certain nombre d'UV sur des matières précises.

### 8.1 Créer le diplôme

Clique sur **« Nouveau diplôme »** → <http://localhost:3000/professionnel/admin/diplomes/new>.

| Champ | Valeur |
|---|---|
| Programme | `BTS GESTION COMMERCIALE 1ère ANNEE` |
| Code | `QA-WALKTHROUGH-DIP` |
| Libellé | `Diplôme Test QA Bout-en-bout` |
| Description | `Diplôme créé pendant le workflow QA complet.` |
| UV à valider | `7` |
| Statut | `Actif` |

→ **« Créer »** → tu es redirigé vers l'éditeur d'exigences. Note `{DIPLOMA_ID}`.

### 8.2 Composer les exigences

| Matière | Cocher | Obligatoire | Ordre |
|---|:---:|:---:|---|
| COMPTA-GEN (4 UV) | ☑ | ☑ | 0 |
| FISC-ENT (3 UV) | ☑ | ☑ | 1 |
| COMPTA-ANA (5 UV) | ☑ | ☐ | 2 |

Bandeau attendu : **« ✓ La cible de 7 UV est atteignable »** (4 + 3 + 5 = 12 UV atteignables).

→ **« Enregistrer les exigences »**.

### ✅ Attendu

- Le détail du diplôme affiche : 3 matières exigées, total atteignable 12 UV, requis 7 UV, statut `actif`.
- Section « Étudiants diplômés » : vide pour l'instant. Le dropdown propose **Ibrahim Traoré (10045)** et **Fatoumata Traoré (10046)** (les étudiants existants ayant des inscriptions dans le programme). Pour ton nouvel étudiant Test QA, il n'apparaîtra dans le dropdown qu'**après** sa première inscription professionnelle (étape §9).

---

## 9. Parcours étudiant — catalogue, panier, commande, paiement

> **Déconnecte-toi** de l'admin. **Connecte-toi** en tant que `test.qa.module@example.com` (mot de passe `Qa-2026!`).

### 9.1 Catalogue étudiant

**URL** : <http://localhost:3000/professionnel/etudiant>

**Ce que cette page permet** : choisir un programme parmi ceux qui ont au moins une matière inscriptible.

→ Sélectionne **BTS GESTION COMMERCIALE 1ère ANNEE**.

**Attendu** : la liste des matières inscriptibles s'affiche.

### 9.2 Voir les sessions inscriptibles

Pour chaque matière, tu vois les sessions ouvertes. Pour **COMPTA-GEN**, tu dois voir :

- `Session QA — Sept 2026` — Capacité 30/30 places — Statut **inscriptible** ✓

> Si COMPTA-GEN apparaît **verrouillée** parce que tu as laissé le prérequis `INTRO-COMPTA` du §5.1, retourne en admin et supprime le prérequis, puis reviens.

### 9.3 Ajouter au panier

Clique sur **« Ajouter au panier »** pour la `Session QA — Sept 2026` de COMPTA-GEN.

**Attendu** :
- Le panier indique **1 matière** — montant total = le prix de COMPTA-GEN (en FCFA).
- Le prix est **figé** sur la ligne de panier (changement ultérieur du prix de la matière n'affecte plus ce panier).

### 9.4 Valider la commande

**URL** : <http://localhost:3000/professionnel/etudiant/panier> (ou icône panier).

→ **« Valider ma commande »**.

**Attendu** :
- La commande passe au statut `en_attente_paiement`.
- Référence générée au format `PRO-2026-NNNNNN`.
- Tu es redirigé vers la page de paiement de la commande. Note `{ORDER_ID}` dans l'URL.

### 9.5 Payer

Selon l'UI de paiement disponible :

| Champ | Valeur |
|---|---|
| Mode de paiement | `Espèces` ou `Mobile money` (test local) |
| Référence de transaction | `TX-QA-WALKTHROUGH-001` |

→ **« Confirmer le paiement »**.

**Attendu** :
- Commande passe à `payée`, inscription passe à `confirmée`.
- Reçu généré (`receipt_number`).
- Tu peux maintenant accéder au contenu pédagogique.

### 9.6 Test d'idempotence du paiement

Rejoue la même opération avec **la même référence de transaction `TX-QA-WALKTHROUGH-001`**. L'API doit renvoyer le **même paiement** sans créer de doublon (FR-022).

### 9.7 Voir mes inscriptions

**URL** : <http://localhost:3000/professionnel/etudiant/inscriptions>

→ La ligne d'inscription à `Session QA — Sept 2026` apparaît au statut **`confirmée`**. Note `{ENROLLMENT_ID}`.

---

## 10. Enseignant — voir ses sessions + supports

> **Déconnecte-toi**. **Connecte-toi** en tant qu'**enseignant** (celui que tu as affecté à la session, ex. `prof@imhotepacademy.fr`).

**URL** : <http://localhost:3000/teacher/professionnel>

**Ce que cette page permet** : pour un enseignant, lister les sessions professionnelles qui lui sont affectées, et accéder à leurs supports + évaluations + visio.

### 10.1 Vérifier la liste

Tu vois la ligne `Session QA — Sept 2026` (COMPTA-GEN) avec un compteur d'inscrits **1** (Test QA-Module).

### 10.2 Ouvrir la session

Clique dessus → URL : <http://localhost:3000/professionnel/admin/sessions/{SESSION_ID}> (ou équivalent côté enseignant).

### 10.3 Onglet « Supports de cours »

Les 3 supports ajoutés par l'admin en §6 apparaissent (PDF, PPTX, vidéo). L'enseignant peut **en ajouter** d'autres :

| Champ | Valeur |
|---|---|
| Titre | `Note de l'enseignant — TD à rendre` |
| Type | PDF |
| Fichier | un PDF de test |

→ Le support est ajouté **au niveau matière** (pas seulement à cette session) : il sera visible dans toutes les sessions futures.

---

## 11. Enseignant — créer une évaluation

**URL** : <http://localhost:3000/professionnel/admin/sessions/{SESSION_ID}> → onglet **« Évaluations »** (ou bouton **« Nouvelle évaluation »**).

> L'implémentation réutilise le même système que les évaluations post-BTS (référence : <http://localhost:3000/teacher/assignments/create>).

### 11.1 Créer le devoir

| Champ | Valeur |
|---|---|
| Titre | `Devoir n°1 — Le bilan comptable` |
| Type | Devoir maison / Évaluation écrite |
| Description / consignes | `Réaliser le bilan de l'entreprise X au 31/12/2025. Document Word attendu.` |
| Date d'ouverture | `2026-09-05 08:00` |
| Date limite | `2026-09-30 23:59` |
| Note maximale | `20` |
| Coefficient | `1` |
| Pièces jointes (sujet) | optionnel — uploader le sujet PDF |

→ **« Publier l'évaluation »**. Note `{ASSIGNMENT_ID}`.

### ✅ Attendu

- L'évaluation apparaît dans l'onglet « Évaluations » de la session.
- Côté étudiant inscrit, elle sera proposée à partir de la date d'ouverture.

---

## 12. Enseignant — programmer une séance visio LiveKit

**URL** : <http://localhost:3000/professionnel/admin/sessions/{SESSION_ID}> → onglet **« Séances visio »** → **« Nouvelle séance »**.

**Ce que cette page permet** : créer une réunion vidéo en direct, propulsée par LiveKit. Une URL de salon est générée. Les étudiants inscrits peuvent la rejoindre.

### 12.1 Créer la séance

| Champ | Valeur |
|---|---|
| Titre | `Cours live — Chapitre 1 : Le bilan` |
| Date | demain (ex. `2026-05-27`) |
| Heure de début | `14:00` |
| Durée | `1h30` |
| Description | `Présentation du chapitre 1 et atelier pratique.` |

→ **« Programmer »**.

### ✅ Attendu

- Une ligne « Cours live — Chapitre 1 » apparaît dans l'onglet « Séances visio ».
- Un bouton **« Démarrer / Rejoindre »** est disponible à l'heure prévue.
- Les étudiants inscrits voient cette séance dans leur espace.

---

## 13. Étudiant — voir et consulter les supports (lecture seule + tracking)

> **Reconnecte-toi** en tant que `test.qa.module@example.com`.

**URL** : <http://localhost:3000/professionnel/etudiant/inscriptions/{ENROLLMENT_ID}> (ou clic sur l'inscription dans la liste).

**Ce que cette page permet** : après confirmation de paiement, l'étudiant accède au contenu pédagogique de la matière de cette session — supports, évaluations, notes, séances visio.

### 13.1 Onglet « Supports »

Les 4 supports apparaissent (3 admin + 1 enseignant en §10.3).

### 13.2 Visionner un PDF

Clique sur **`Manuel de comptabilité générale — chapitre 1`**.

**Attendu** :
- Un **viewer intégré** ouvre le PDF dans la page (iframe / PDF.js).
- **AUCUN bouton de téléchargement** — le clic droit / sauvegarder est désactivé ou inopérant.
- Une ligne est enregistrée dans `professional_subject_material_views` (ou équivalent) : { material_id, student_id, viewed_at, view_count++ }.

### 13.3 Visionner la vidéo

Clique sur **`Tutoriel vidéo — Lire un bilan`**.

**Attendu** :
- La vidéo est intégrée (player), pas de bouton « Télécharger ».

### 13.4 Visionner le PowerPoint

Clique sur **`Diaporama — Le bilan comptable`**.

**Attendu** :
- Visualisation en page (conversion → image/HTML, ou viewer PPTX).
- Pas de téléchargement.

---

## 14. Étudiant — prendre l'évaluation

Toujours sur la page d'inscription, va à l'onglet **« Évaluations »**.

### 14.1 Ouvrir le devoir

Tu vois `Devoir n°1 — Le bilan comptable`, date limite `2026-09-30`.

Clique **« Faire le devoir »**.

### 14.2 Rendre la copie

| Champ | Valeur |
|---|---|
| Réponse texte (si demandé) | `Voir document joint.` |
| Pièce jointe | un fichier `bilan-test.docx` ou PDF de test |

→ **« Soumettre »**.

### ✅ Attendu

- L'évaluation passe au statut « Rendue » côté étudiant.
- Côté enseignant, elle apparaît dans `Corrections en attente`.

---

## 15. Étudiant — rejoindre la séance visio

Onglet **« Séances visio »** sur la page d'inscription.

### 15.1 Voir la séance programmée

Tu vois `Cours live — Chapitre 1`, date demain 14h00.

### 15.2 Recevoir la notification

Quand l'enseignant **démarre la séance** (cf. §12.1, bouton **Démarrer**), tu reçois une notification (icône cloche en haut) ou une bannière sur la page d'inscription.

### 15.3 Rejoindre

Clique **« Rejoindre la séance »**.

**Attendu** :
- Une nouvelle page LiveKit s'ouvre, demande l'accès caméra/micro.
- Tu te retrouves dans le salon avec l'enseignant.

---

## 16. Enseignant — corriger les copies

> **Reconnecte-toi** en tant qu'enseignant.

**URL** : <http://localhost:3000/teacher/corrections> (ou via la session → onglet Évaluations → liste des copies).

### 16.1 Ouvrir la copie de Test QA-Module

Clique sur la ligne. Tu vois la pièce jointe rendue.

### 16.2 Noter

| Champ | Valeur |
|---|---|
| Note | `16` (sur 20) |
| Commentaire | `Bon travail, attention au passif. Détails clairs.` |

→ **« Enregistrer la correction »**.

### ✅ Attendu

- La copie passe au statut « Corrigée ».
- L'étudiant est notifié.

---

## 17. Étudiant — voir sa note

Reconnecte-toi en `test.qa.module@example.com`.

**URL** : <http://localhost:3000/professionnel/etudiant/inscriptions/{ENROLLMENT_ID}> → onglet **« Évaluations »** ou **« Notes »**.

**Attendu** :
- `Devoir n°1` — Note : **16/20** — Commentaire enseignant visible.

---

## 18. Tracking des consultations de supports

> **Reconnecte-toi** en **administrateur** (ou enseignant).

**URL** : <http://localhost:3000/professionnel/admin/sessions/{SESSION_ID}> → onglet **« Supports »** → bouton/section **« Statistiques de consultation »** ou similaire.

**Ce que cette page permet** : voir qui a ouvert quel support et combien de fois (audit pédagogique).

### ✅ Attendu

Tu vois une ligne par étudiant et par support, ex. :

| Étudiant | Support | Première vue | Dernière vue | Nb vues |
|---|---|---|---|---|
| Test QA-Module | Manuel de comptabilité… | 2026-05-26 14:35 | 2026-05-26 14:35 | 1 |
| Test QA-Module | Diaporama — Le bilan | 2026-05-26 14:37 | 2026-05-26 14:37 | 1 |
| Test QA-Module | Tutoriel vidéo… | 2026-05-26 14:39 | 2026-05-26 14:39 | 1 |

---

## 19. Admin — marquer l'inscription terminée

> **Reconnecte-toi** en admin.

**URL** : <http://localhost:3000/professionnel/admin/suivi> (ou la section appropriée).

### 19.1 Trouver l'inscription

Filtre par étudiant `Test QA-Module` ou par session `Session QA — Sept 2026`. Tu vois la ligne au statut `confirmée`.

### 19.2 Marquer terminée

Clique sur l'action **« Marquer terminée »** (icône ✓ ou bouton).

**Attendu** :
- L'inscription passe au statut **`terminée`**.
- ⚡ **Hook d'octroi automatique** : `recomputeForStudent` se déclenche en best-effort dans le handler de route → recherche des diplômes actifs avec une exigence sur COMPTA-GEN → évalue l'éligibilité de Test QA-Module → cumul 4 UV (COMPTA-GEN), obligatoires (COMPTA-GEN ✓, FISC-ENT ✗) → **PAS éligible** (FISC-ENT obligatoire non terminée).

> Pour que l'octroi auto se déclenche **vraiment**, il faudrait que Test QA-Module ait aussi terminé FISC-ENT et obtenu au moins 7 UV. Soit tu inscris et termines FISC-ENT pour Test QA-Module aussi (allonge le test), soit tu testes l'octroi auto avec **Ibrahim** (qui a déjà 7 UV).

### 19.3 Variante — Tester l'octroi auto avec Ibrahim

Si Ibrahim a déjà COMPTA-GEN + FISC-ENT terminées (la mémoire dit que oui), il a 7 UV. Il manquait juste **un diplôme actif sur le programme** : tu viens d'en créer un (`{DIPLOMA_ID}`).

Pour déclencher l'octroi auto :

1. Soit clique sur **« Recalculer l'éligibilité »** depuis l'écran détail du diplôme `{DIPLOMA_ID}` → bandeau « **1 nouvel octroi créé** » (Ibrahim).
2. Soit re-termine une inscription d'Ibrahim qui touche une matière exigée pour redéclencher le hook.

Vérifie sur la page détail du diplôme `{DIPLOMA_ID}` : **Ibrahim apparaît dans la table « Étudiants diplômés »** avec une référence `DIP-2026-XXXXXX` et `octroye_par` vide (= octroi automatique).

---

## 20. Vérifier l'octroi automatique côté étudiant

### 20.1 Reconnecte-toi en Ibrahim

`ibrahim.traore@example.com`

**URL** : <http://localhost:3000/professionnel/etudiant/diplomes>

**Attendu** :
- Section « Diplômes obtenus » : card **`Diplôme Test QA Bout-en-bout`**, badge vert **Obtenu**, barre 100 %, référence.

### 20.2 Voir la progression

Clique **« Voir ma progression »** → <http://localhost:3000/professionnel/etudiant/diplomes/{DIPLOMA_ID}>

**Attendu** :
- Compteur **7 / 7 UV** (ou plus si Ibrahim a aussi terminé COMPTA-ANA).
- Pourcentage **100 %**.
- Matières validées : COMPTA-GEN, FISC-ENT.
- Matières restantes : COMPTA-ANA (si pas terminée).

### 20.3 Consulter l'attestation

Clique **« Voir l'attestation »** :

```
Diplôme Test QA Bout-en-bout
Programme : BTS GESTION COMMERCIALE 1ère ANNEE
Référence : DIP-2026-XXXXXX
Titulaire : Ibrahim Traoré
Date d'obtention : 2026-05-26
UV validées : 7
Matières :
  - Comptabilité générale — 4 UV
  - Fiscalité des entreprises — 3 UV
```

---

## 21. Vérifier la vue parent

> **Reconnecte-toi** en `mariam.traore@example.com` (parent d'Ibrahim).

**URL** : <http://localhost:3000/parent/professionnel/diplomes>

### 21.1 Sélectionner l'enfant

Choisis **Ibrahim Traoré** dans le sélecteur.

### ✅ Attendu

- Section « Diplômes obtenus » : la card **`Diplôme Test QA Bout-en-bout`**, badge vert, barre 100 %, référence visible.
- **AUCUN bouton d'action** (lecture seule).
- Si tu changes le `child_id` dans l'URL pour un enfant qui n'est pas le sien → `403 FORBIDDEN`.

---

## 22. Nettoyage SQL

Après validation, ne laisse pas tes données de test polluer la base :

```sql
BEGIN;

-- Diplôme du workflow + ses octrois historiques
DELETE FROM student_professional_diplomas
WHERE diploma_id IN (
  SELECT id FROM professional_diplomas
  WHERE tenant_id='f73f529f-5b1b-4027-877d-d4dc344d081b'
    AND code='QA-WALKTHROUGH-DIP'
);
DELETE FROM professional_diplomas
WHERE tenant_id='f73f529f-5b1b-4027-877d-d4dc344d081b'
  AND code='QA-WALKTHROUGH-DIP';

-- Inscription, commande, paiement de Test QA-Module
DELETE FROM professional_payments
WHERE reference_transaction = 'TX-QA-WALKTHROUGH-001';
DELETE FROM professional_enrollments
WHERE student_id = '{NEW_STUDENT_ID}'::uuid
  AND tenant_id='f73f529f-5b1b-4027-877d-d4dc344d081b';
DELETE FROM professional_orders
WHERE student_id = '{NEW_STUDENT_ID}'::uuid
  AND tenant_id='f73f529f-5b1b-4027-877d-d4dc344d081b';

-- Session QA + ses supports/évaluations/visio
DELETE FROM professional_subject_sessions
WHERE id = '{SESSION_ID}'::uuid
  AND tenant_id='f73f529f-5b1b-4027-877d-d4dc344d081b';

-- Matière INTRO-COMPTA
DELETE FROM professional_subject_prerequisites
WHERE professional_subject_id IN (
  SELECT id FROM professional_subjects
  WHERE code IN ('INTRO-COMPTA','COMPTA-GEN','COMPTA-ANA','FISC-ENT')
    AND tenant_id='f73f529f-5b1b-4027-877d-d4dc344d081b'
);
DELETE FROM professional_subjects
WHERE code='INTRO-COMPTA'
  AND tenant_id='f73f529f-5b1b-4027-877d-d4dc344d081b';

-- Lien parent-enfant test
DELETE FROM student_parents
WHERE student_id = '{NEW_STUDENT_ID}'::uuid
  AND parent_id = '{NEW_PARENT_ID}'::uuid;

-- Profils + utilisateurs de test
DELETE FROM student_profiles WHERE id = '{NEW_STUDENT_ID}'::uuid;
DELETE FROM users WHERE email IN (
  'test.qa.module@example.com',
  'parent.qa.module@example.com'
);

-- Inscriptions de validation
DELETE FROM registration_requests
WHERE email IN (
  'test.qa.module@example.com',
  'parent.qa.module@example.com'
);

COMMIT;
```

---

## 23. Checklist de validation finale

À la fin du workflow, **toutes les cases doivent être cochées** :

### Onboarding
- [ ] §2 — Inscription publique étudiant + parent reçue
- [ ] §3 — Admin valide les 2 inscriptions et lie parent-enfant

### Catalogue
- [ ] §4 — Nouvelle matière `INTRO-COMPTA` créée ; les 3 existantes visibles
- [ ] §5 — Prérequis configuré, refus auto-référence et cross-programme observés (puis supprimé pour la suite)
- [ ] §6 — 3 supports (PDF, PPTX, vidéo) ajoutés au niveau matière COMPTA-GEN
- [ ] §7 — Session ouverte ; onglets Détails/Inscrits/Supports/Évaluations/Visio visibles
- [ ] §8 — Diplôme `QA-WALKTHROUGH-DIP` créé avec 3 exigences (cible 7 UV atteignable)

### Étudiant — achat
- [ ] §9 — Test QA-Module inscrit à COMPTA-GEN, prix figé, commande payée, idempotence prouvée

### Enseignant
- [ ] §10 — Enseignant voit ses sessions + supports hérités ; il peut en ajouter
- [ ] §11 — Évaluation créée
- [ ] §12 — Séance visio programmée

### Étudiant — accès au contenu
- [ ] §13 — Supports consultés en lecture seule (PDF, PPTX, vidéo), pas de téléchargement
- [ ] §14 — Évaluation rendue avec pièce jointe
- [ ] §15 — Étudiant rejoint la séance visio

### Notation
- [ ] §16 — Enseignant corrige (16/20 + commentaire)
- [ ] §17 — Étudiant voit sa note

### Suivi
- [ ] §18 — Admin/enseignant voit le tracking de consultation des supports

### Diplôme
- [ ] §19 — Inscription marquée terminée → hook déclenché
- [ ] §20 — Ibrahim devient titulaire automatiquement, attestation accessible
- [ ] §21 — Parent voit le diplôme en lecture seule

### Hygiène
- [ ] §22 — Nettoyage SQL exécuté

Si une étape échoue, **note précisément** ce que tu as fait, ce que tu attendais, et ce que tu as obtenu (status code + corps de la réponse de l'API si possible). Cela permet de diagnostiquer rapidement.

---

## Annexe A — Codes d'erreur du module

| Code | HTTP | Quand |
|---|---|---|
| `VALIDATION_ERROR` | 422 | Données invalides (Zod, règles métier) |
| `TENANT_REQUIRED` | 400 | `X-Tenant` manquant |
| `FORBIDDEN` | 403 | Rôle non autorisé ou enfant non rattaché |
| `NOT_FOUND` | 404 | Ressource inexistante |
| `DUPLICATE_CODE` | 409 | Code de matière déjà utilisé |
| `SUBJECT_HAS_OPEN_SESSIONS` | 409 | Désactivation matière refusée |
| `SUBJECT_HAS_ENROLLMENTS` | 409 | Suppression matière refusée |
| `PREREQUISITE_NOT_MET` | 422 | Prérequis non satisfait pour ajouter au panier |
| `PREREQUISITE_CYCLE` | 422 | Définition de prérequis crée un cycle |
| `CROSS_PROGRAMME_PREREQUISITE` | 422 | Prérequis d'un autre programme |
| `SESSION_NOT_ENROLLABLE` | 422 | Session fermée / hors fenêtre |
| `SESSION_FULL` | 409 | Capacité atteinte |
| `DUPLICATE_ENROLLMENT` | 409 | Étudiant déjà inscrit à la session |
| `ALREADY_PAID` | 409 | Commande déjà payée |
| `DIPLOMA_NOT_FOUND` | 404 | Diplôme inexistant |
| `DUPLICATE_DIPLOMA_CODE` | 409 | Code de diplôme déjà utilisé |
| `CROSS_PROGRAMME_REQUIREMENT` | 422 | Exigence pointant vers une matière d'un autre programme |
| `DIPLOMA_HAS_AWARDS` | 409 | Suppression refusée — octrois existants |
| `DIPLOMA_ALREADY_AWARDED` | 409 | Étudiant déjà titulaire |
| `DIPLOMA_NOT_ELIGIBLE` | 422 | Octroi manuel sans `force` sur non-éligible |
| `DIPLOMA_NOT_AWARDED` | 404 | Révocation ou attestation sur diplôme non obtenu |

## Annexe B — Récupérer un JWT pour les appels API directs

Depuis le navigateur (connecté) → DevTools → **Application** → **Local Storage** → cherche une clé `auth-token` / `jwt` / `token` → copie la valeur.

Test direct :

```powershell
$JWT = "<colle ton JWT ici>"
Invoke-RestMethod -Method GET `
  -Uri "http://localhost:4000/api/v1/professional/diplomas" `
  -Headers @{
    "Authorization" = "Bearer $JWT"
    "X-Tenant" = "f73f529f-5b1b-4027-877d-d4dc344d081b"
  }
```

---

## Annexe C — Schéma synthétique des flux

```text
                ┌──────────────┐
                │  /register   │ ── crée registration_request (statut: en_attente)
                └──────┬───────┘
                       │
                ┌──────▼───────────┐
                │ Admin valide      │ ── crée users + student_profiles
                │ registration       │ ── inscrit au programme académique
                └──────┬───────────┘
                       │
                       ▼
        ┌──────────────────────────────────────────────────┐
        │ Admin construit le catalogue                      │
        │   - matières + UV + prix + prérequis              │
        │   - supports au niveau matière                    │
        │   - sessions datées                               │
        │   - diplôme + exigences                           │
        └──────────────────────────────────────────────────┘
                       │
                       ▼
              Étudiant : catalogue → panier → commande → paiement
                       │ (paiement confirmé)
                       ▼
                 Inscription confirmée
                       │
                       ▼
        Étudiant : supports (vue), évaluations (rendu), visio (live)
        Enseignant : corrections, supports, séances visio
                       │
                       ▼
               Admin/enseignant marque l'inscription terminée
                       │
                       ▼  (hook best-effort, FR-020)
        recomputeForStudent → éligibilité ? → octroi auto diplôme
                       │
                       ▼
            Étudiant voit son diplôme + attestation
            Parent voit le diplôme de son enfant (lecture seule)
```
