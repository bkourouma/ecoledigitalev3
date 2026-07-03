# Guide de test end-to-end — Module Professionnel (feature 028)

Ce guide propose un **scénario de test manuel complet, interface par interface**, avec des **données réelles prêtes à saisir** dans chaque formulaire. Il valide le parcours de bout en bout : administration du catalogue → inscription/paiement étudiant → suivi → prérequis → vues parent → espace enseignant.

> Scénario fil rouge : un établissement ouvre 3 matières professionnelles de comptabilité-gestion. Un étudiant s'inscrit à la carte, paie, est suivi, puis débloque une matière à prérequis. Le parent et l'enseignant consultent/gèrent leur périmètre.

---

## 0. Préparation

### 0.1 Démarrer l'application

```powershell
pnpm dev
```
- API : `http://localhost:4000`  ·  Web : `http://localhost:3000`
- Les migrations `0061` et `0062` sont **déjà appliquées** sur la base de dev `dbecoledigitale`. (Sinon : `node scripts/apply-migration-0061-professional-module.js` puis `...0062...`.)

### 0.2 Comptes nécessaires (4 rôles, même établissement)

| Rôle | Sert à tester | Page d'accueil après login |
|---|---|---|
| **admin** | catalogue, sessions, prérequis, suivi | `/professionnel/admin/matieres` |
| **student** (étudiant) | catalogue, panier, commande, paiement | `/professionnel/etudiant` |
| **parent** | consultation lecture seule | `/parent/professionnel` |
| **teacher** (enseignant) | supports, appel | `/teacher/professionnel` |

> Le **parent doit être rattaché à l'étudiant** de test (table `student_parents`). L'**enseignant** de test doit avoir une ligne dans `teachers`. Connexion : `http://localhost:3000/login`.

### 0.3 Récupérer les identifiants (UUID) à coller dans les formulaires

Les formulaires admin demandent des UUID (programme, enseignant, salle). Récupérez-les une fois pour toutes — via un client SQL sur `dbecoledigitale` :

```sql
-- Programme d'accueil des matières (en choisir UN, le noter : <PROGRAMME_ID>)
SELECT id, name, code FROM programmes ORDER BY name LIMIT 10;

-- Enseignant à affecter à une session (le noter : <ENSEIGNANT_ID>)
SELECT id, first_name, last_name FROM teachers ORDER BY last_name LIMIT 10;

-- Étudiant de test + son id de profil (le noter : <STUDENT_PROFILE_ID>)
SELECT sp.id AS student_profile_id, u.first_name, u.last_name, u.email
FROM student_profiles sp JOIN users u ON u.id = sp.user_id ORDER BY u.last_name LIMIT 10;

-- Vérifier le lien parent ↔ enfant (doit renvoyer au moins 1 ligne pour le test parent)
SELECT pr.parent_id, pr.student_id, u.email AS parent_email
FROM student_parents pr JOIN users u ON u.id = pr.parent_id
WHERE pr.student_id = '<STUDENT_PROFILE_ID>';

-- (optionnel) Salle pour une session
SELECT id, name, code FROM classrooms ORDER BY name LIMIT 5;
```

À noter avant de commencer :

| Variable | Valeur (à remplir) |
|---|---|
| `<PROGRAMME_ID>` | …………………………………………… |
| `<ENSEIGNANT_ID>` | …………………………………………… |
| `<STUDENT_PROFILE_ID>` | …………………………………………… |

> Date de référence du scénario : **20 mai 2026**. Les fenêtres d'inscription ci-dessous englobent cette date — adaptez-les si vous testez à une autre date (la fenêtre doit contenir « aujourd'hui »).

---

## 1. Interface Admin — Matières  ·  `/professionnel/admin/matieres`

Connecté en **admin**. Créez les **3 matières** ci-dessous (bouton **Créer** après chaque saisie).

### 1.1 Matière A — sans prérequis

| Champ | Valeur à saisir |
|---|---|
| ID du programme (UUID) | `<PROGRAMME_ID>` |
| Code | `COMPTA-GEN` |
| Libellé | `Comptabilité générale` |
| Description | `Principes, journal, grand-livre et écritures comptables de base.` |
| Nombre d'UV | `4` |
| Prix (FCFA) | `75000` |
| Statut | `Actif` |

### 1.2 Matière B — aura un prérequis (étape 1.4)

| Champ | Valeur à saisir |
|---|---|
| ID du programme (UUID) | `<PROGRAMME_ID>` |
| Code | `COMPTA-ANA` |
| Libellé | `Comptabilité analytique` |
| Description | `Coûts, marges, seuil de rentabilité et analyse de gestion.` |
| Nombre d'UV | `5` |
| Prix (FCFA) | `90000` |
| Statut | `Actif` |

### 1.3 Matière C — capacité volontairement faible (test « complet »)

| Champ | Valeur à saisir |
|---|---|
| ID du programme (UUID) | `<PROGRAMME_ID>` |
| Code | `FISC-ENT` |
| Libellé | `Fiscalité des entreprises` |
| Description | `Régime fiscal, TVA et déclarations de l'entreprise.` |
| Nombre d'UV | `3` |
| Prix (FCFA) | `60000` |
| Statut | `Actif` |

✅ **Attendu** : les 3 matières apparaissent dans le tableau « Catalogue (3) » avec le statut `actif`.

### 1.4 Définir le prérequis de la matière B

1. Cliquer **Éditer** sur la ligne `COMPTA-ANA`.
2. Le panneau **« Prérequis de la matière »** apparaît sous le formulaire.
3. Cocher **`COMPTA-GEN — Comptabilité générale`**.
4. Cliquer **Enregistrer les prérequis**.

✅ **Attendu** : message « Prérequis enregistrés. »

### 1.5 Test négatif — code dupliqué

Créer une 4ᵉ matière avec le code `COMPTA-GEN` (déjà pris).
✅ **Attendu** : erreur rouge « Une matière avec le code "COMPTA-GEN" existe déjà. »

---

## 2. Interface Admin — Sessions  ·  `/professionnel/admin/sessions`

Toujours en **admin**. Sélectionnez une matière dans le menu déroulant, créez la session, puis **ouvrez-la** (sélecteur de statut → `ouvert`).

### 2.1 Session de `COMPTA-GEN — Comptabilité générale`

| Champ | Valeur à saisir |
|---|---|
| Libellé | `Session Juin 2026 — Comptabilité générale` |
| Date de début | `2026-06-09` |
| Date de fin | `2026-07-04` |
| Ouverture des inscriptions | `2026-05-05T08:00` |
| Fermeture des inscriptions | `2026-06-06T18:00` |
| Capacité max | `25` |
| ID enseignant | `<ENSEIGNANT_ID>` |
| ID salle | *(laisser vide)* |

→ Créer, puis dans le tableau régler le statut sur **`ouvert`**.

### 2.2 Session de `COMPTA-ANA — Comptabilité analytique`

| Champ | Valeur à saisir |
|---|---|
| Libellé | `Session Juillet 2026 — Comptabilité analytique` |
| Date de début | `2026-07-13` |
| Date de fin | `2026-08-08` |
| Ouverture des inscriptions | `2026-05-05T08:00` |
| Fermeture des inscriptions | `2026-07-10T18:00` |
| Capacité max | `20` |
| ID enseignant | *(laisser vide)* |
| ID salle | *(laisser vide)* |

→ Créer, puis statut **`ouvert`**.

### 2.3 Session de `FISC-ENT — Fiscalité des entreprises` (capacité = 2)

| Champ | Valeur à saisir |
|---|---|
| Libellé | `Session Juin 2026 — Fiscalité` |
| Date de début | `2026-06-16` |
| Date de fin | `2026-07-11` |
| Ouverture des inscriptions | `2026-05-05T08:00` |
| Fermeture des inscriptions | `2026-06-13T18:00` |
| Capacité max | `2` |
| ID enseignant | *(laisser vide)* |
| ID salle | *(laisser vide)* |

→ Créer, puis statut **`ouvert`**.

### 2.4 Tests négatifs

- Créer une session avec **Date de fin antérieure à la date de début** (`début 2026-07-01`, `fin 2026-06-01`) → ✅ rejet « Données de session invalides ».
- Tenter de créer une session sur une matière passée en `inactif` → ✅ rejet « Une matière inactive n'accepte pas de nouvelle session. »

✅ **Attendu global §2** : 3 sessions au statut `ouvert`.

---

## 3. Interface Étudiant — Catalogue, panier & paiement  ·  `/professionnel/etudiant`

Se **déconnecter** et se reconnecter en **étudiant** (`<STUDENT_PROFILE_ID>`).

### 3.1 Choisir le programme

- Dans le menu **Programme**, sélectionner le programme `<PROGRAMME_ID>`.

✅ **Attendu** : le programme apparaît avec « 2 matière(s) » (COMPTA-GEN et FISC-ENT sont inscriptibles ; COMPTA-ANA est verrouillée donc non comptée comme librement inscriptible mais reste affichée).

### 3.2 Lire le catalogue

✅ **Attendu** :
- `COMPTA-GEN` et `FISC-ENT` : bouton **Ajouter** actif sur leur session.
- `COMPTA-ANA` : badge **« Verrouillée »** + ligne « Prérequis manquants : COMPTA-GEN ». Bouton **Indisponible** (désactivé).

### 3.3 Remplir le panier

1. Sur `Comptabilité générale` → session « Session Juin 2026 » → **Ajouter**.
2. Sur `Fiscalité des entreprises` → session « Session Juin 2026 — Fiscalité » → **Ajouter**.

✅ **Attendu** : le panier (colonne de droite) affiche 2 lignes ; **Total : 135000 FCFA** (= 75000 + 60000).

### 3.4 Test négatif — matière verrouillée

Tenter d'ajouter une session de `COMPTA-ANA` (si un bouton est accessible) → ✅ rejet « Les prérequis de la matière ne sont pas tous satisfaits. »

### 3.5 Valider la commande et payer

1. Cliquer **Valider la commande** → le bloc **Paiement** apparaît avec une référence `PRO-2026-000001` (ou similaire).
2. Renseigner le paiement :

| Champ | Valeur à saisir |
|---|---|
| Mode de paiement | `mobile_money` |
| Référence de transaction (optionnel) | `TX-TEST-001` |

3. Cliquer **Payer**.

✅ **Attendu** : bandeau vert « Paiement confirmé — reçu n° `REC-PRO-2026-000001`. Vos inscriptions sont confirmées. »

---

## 4. Interface Étudiant — Mes inscriptions  ·  `/professionnel/etudiant/inscriptions`

✅ **Attendu** : 2 lignes — `COMPTA-GEN` et `FISC-ENT` — au statut **« Confirmée »** (vert), avec la référence de commande `PRO-2026-000001`.

---

## 5. Interface Admin — Suivi & achèvement  ·  `/professionnel/admin/suivi`

Se reconnecter en **admin**.

### 5.1 Vérifier les inscriptions et le paiement

✅ **Attendu** :
- Tableau **Inscriptions** : 2 lignes (nom de l'étudiant, matières COMPTA-GEN / FISC-ENT, statut `confirmee`).
- Tableau **Paiements** : 1 ligne — montant `135000`, mode `mobile_money`, référence `TX-TEST-001`, reçu `REC-PRO-2026-000001`, statut `confirme`.
- Le filtre **Statut** → `confirmee` n'affiche que les inscriptions confirmées.

### 5.2 Marquer une inscription « terminée » (débloque le prérequis)

Sur la ligne de l'inscription **`COMPTA-GEN`** (statut `confirmee`) → cliquer **Marquer terminée**.

✅ **Attendu** : la ligne passe au statut `terminee`.

---

## 6. Interface Étudiant — Prérequis débloqué  ·  `/professionnel/etudiant`

Se reconnecter en **étudiant**, re-sélectionner le programme.

✅ **Attendu** : `COMPTA-ANA — Comptabilité analytique` n'est **plus verrouillée** (le prérequis `COMPTA-GEN` est `terminée`) → bouton **Ajouter** actif.

### 6.1 Inscrire la matière à prérequis

1. Ajouter au panier la session « Session Juillet 2026 — Comptabilité analytique ».
2. **Total attendu : 90000 FCFA**.
3. **Valider la commande** → nouvelle commande `PRO-2026-000002`.
4. Payer :

| Champ | Valeur |
|---|---|
| Mode de paiement | `virement` |
| Référence de transaction | `TX-TEST-002` |

✅ **Attendu** : paiement confirmé, reçu `REC-PRO-2026-000002`. Dans **Mes inscriptions** : 3 inscriptions au total.

---

## 7. Interface Parent — Consultation  ·  `/parent/professionnel`

Se reconnecter en **parent** (rattaché à l'étudiant de test).

1. Menu **Enfant** → sélectionner l'enfant.

✅ **Attendu** :
- Tableau **Inscriptions** : 3 lignes (COMPTA-GEN `terminée`, FISC-ENT `confirmée`, COMPTA-ANA `confirmée`).
- Tableau **Paiements** : 2 lignes (`135000` et `90000`).
- **Lecture seule** : aucun bouton d'action / de modification.

---

## 8. Interface Enseignant — Sessions, supports & appel  ·  `/teacher/professionnel`

Se reconnecter en **enseignant** (`<ENSEIGNANT_ID>`).

1. Menu **Session** → sélectionner « COMPTA-GEN — Session Juin 2026 — Comptabilité générale » (la seule affectée à cet enseignant).

✅ **Attendu** : la session apparaît avec « 1 inscrit(s) ».

### 8.1 Ajouter un support de cours

| Champ | Valeur à saisir |
|---|---|
| Titre du support | `Polycopié — Chapitre 1 : le bilan comptable` |
| URL / lien (optionnel) | `https://exemple.org/supports/compta-gen-ch1.pdf` |

→ **Ajouter le support**. ✅ **Attendu** : le support apparaît dans la liste.

### 8.2 Faire l'appel (présences)

- L'étudiant de test apparaît dans le tableau **Appel**.
- Régler son statut sur **`present`** → cliquer **Enregistrer les présences**.

✅ **Attendu** : message « Présences enregistrées. »

---

## 9. Cas limites & robustesse

| # | Test | Mode opératoire | Résultat attendu |
|---|---|---|---|
| 9.1 | **Double inscription** | Étudiant : ré-ajouter au panier une session déjà inscrite | Rejet « Vous êtes déjà inscrit à cette session. » |
| 9.2 | **Capacité atteinte** | Inscrire 2 étudiants distincts sur la session `FISC-ENT` (capacité 2), puis un 3ᵉ | 3ᵉ ajout rejeté « La session est complète. » ; la session passe au statut `complet` (visible en admin) |
| 9.3 | **Idempotence du paiement** | Rejouer un paiement avec la **même** `reference_transaction` (`TX-TEST-001`) | Aucun doublon ; le reçu existant est renvoyé |
| 9.4 | **Cycle de prérequis** | Admin : éditer `COMPTA-GEN`, tenter d'y ajouter `COMPTA-ANA` comme prérequis | Rejet « Cette définition de prérequis créerait un cycle. » |
| 9.5 | **Prérequis hors programme** | Admin : créer une matière dans un autre programme, tenter de la définir comme prérequis | Rejet « …doivent appartenir au même programme… » |
| 9.6 | **Hors fenêtre d'inscription** | Admin : créer une session dont la fenêtre est passée (`fermée` < aujourd'hui) et l'ouvrir ; côté étudiant | La session n'apparaît pas comme inscriptible |
| 9.7 | **Transition de statut invalide** | Admin : tenter `brouillon → terminé` directement sur une session | Rejet « Transition de statut invalide. » |
| 9.8 | **Désactivation bloquée** | Admin : tenter de désactiver une matière ayant une session `ouvert` | Rejet « …des sessions ouvertes ou en cours existent. » |

---

## 10. Non-régression (modules existants intacts)

| Vérification | Attendu |
|---|---|
| Module « formations professionnelles » (`/formations-professionnelles/...`) | Inchangé et fonctionnel |
| Module académique classique (cours, notes, paiements scolarité) | Inchangé |
| Rapports financiers (`/admin/finances/reports`) | Fonctionnent ; les revenus professionnels apparaissent dans le bloc additionnel `professional` |
| Connexion / navigation des autres rôles | Inchangées ; nouvelles entrées « professionnel » visibles dans le menu latéral |

---

## 11. Checklist finale — 15 critères d'acceptation (spec §11)

| # | Critère | OK |
|---|---|----|
| 1 | Matière créée rattachée à un programme, visible au catalogue dès session `ouvert` + fenêtre valide | ☐ |
| 2 | L'étudiant doit choisir un programme ; seuls ceux à offre inscriptible sont proposés | ☐ |
| 3 | Matière à prérequis non satisfait → verrouillée, non ajoutable | ☐ |
| 4 | Tous prérequis `terminée` → matière inscriptible ; achèvement débloque la dépendante | ☐ |
| 5 | Prérequis en cycle / hors programme / auto-référence → rejeté | ☐ |
| 6 | Session hors fenêtre / `complet` / `brouillon` / `annulé` → non inscriptible | ☐ |
| 7 | 3 matières au panier → `montant_total` = somme exacte des prix figés | ☐ |
| 8 | Validation panier → `en_attente_paiement` ; paiement confirmé → `payee` + inscriptions `confirmee` | ☐ |
| 9 | Tant que non payé, pas d'accès au contenu pédagogique | ☐ |
| 10 | 2ᵉ inscription à une session déjà inscrite → refusée | ☐ |
| 11 | Capacité atteinte → session `complet`, plus d'inscription | ☐ |
| 12 | Étudiant avec inscription classique peut créer une commande professionnelle | ☐ |
| 13 | Aucune fuite de données entre établissements (RLS) | ☐ |
| 14 | Rejeu du même paiement (même référence) → pas de doublon | ☐ |
| 15 | `/formations-pro*` et module classique inchangés (non-régression) | ☐ |

---

## Annexe — Dépannage rapide

| Symptôme | Piste |
|---|---|
| `400 Tenant Required` | Le contexte établissement n'est pas résolu — vérifier la connexion / le sous-domaine. |
| Le programme n'apparaît pas côté étudiant | Aucune matière du programme n'a de session `ouvert` dans sa fenêtre d'inscription. |
| `403` sur une page | Le compte n'a pas le rôle attendu (admin / student / parent / teacher). |
| Une session n'apparaît pas chez l'enseignant | Le champ « ID enseignant » de la session ne correspond pas à `<ENSEIGNANT_ID>`. |
| Le parent ne voit pas l'enfant | Aucune ligne dans `student_parents` pour ce couple parent/élève. |

> Tests automatisés associés : `pnpm --filter @ecoledigitale/api exec jest professional` (72 tests unitaires — logique métier).
