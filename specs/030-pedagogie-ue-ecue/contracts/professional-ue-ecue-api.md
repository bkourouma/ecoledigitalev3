# API Contract — Module Professionnel Filière → UE → ECUE (030)

Base path : `/api/v1/professional` (préfixe existant). **Rupture directe** des
endpoints `subjects`/`sessions` (dev only, D-R10). RBAC via
`professional-guards.ts` (admin/owner pour l'administration, enseignant pour la
pédagogie, étudiant/parent pour le parcours). Toutes les règles validées côté
serveur ; isolation RLS par tenant.

Légende : 🔁 repointé · ➕ nouveau · ♻️ renommé · = inchangé.

## 1. Référentiel — ECUE (pédagogie) ♻️ ex-`/subjects`

| Méthode | Chemin | Rôle | Notes |
|---|---|---|---|
| GET | `/ecue` | admin | liste ECUE (code, libellé, bilan_type, statut) — **sans prix/UV** |
| POST | `/ecue` | admin | crée une ECUE |
| GET | `/ecue/:id` | admin | détail ECUE + UE qui la mutualisent |
| PATCH | `/ecue/:id` | admin | édite |
| DELETE | `/ecue/:id` | admin | refuse si rattachée à une UE (détacher d'abord) |
| GET | `/ecue/:id/materials` | admin/enseignant | supports pérennes de l'ECUE |
| POST | `/ecue/:id/materials/upload` | admin/enseignant | dépose un support |

## 2. Référentiel — UE (administratif) ➕

| Méthode | Chemin | Rôle | Notes |
|---|---|---|---|
| GET | `/ue` | admin | liste UE (filiere_id, prix, devise, nb_uv, statut) |
| POST | `/ue` | admin | crée une UE rattachée à une filière |
| GET | `/ue/:id` | admin | détail UE + ECUE composées + prérequis + cohortes |
| PATCH | `/ue/:id` | admin | édite (prix/UV/statut) |
| DELETE | `/ue/:id` | admin | refuse si inscriptions/cohortes actives |
| GET | `/ue/:id/ecue` | admin | liaisons UE↔ECUE (coefficient, obligatoire, ordre) |
| POST | `/ue/:id/ecue` | admin | rattache une ECUE (mutualisation autorisée inter-filières) |
| PATCH | `/ue/:id/ecue/:ecueId` | admin | modifie coefficient/obligatoire/ordre |
| DELETE | `/ue/:id/ecue/:ecueId` | admin | détache l'ECUE de l'UE |
| GET | `/ue/:id/prerequisites` | admin | prérequis (UE) |
| PUT | `/ue/:id/prerequisites` | admin | définit (même filière + acyclique) |

## 3. Cohortes d'UE ♻️ ex-`/sessions` → `/ue-sessions`

| Méthode | Chemin | Rôle | Notes |
|---|---|---|---|
| GET | `/ue/:id/sessions` | admin | cohortes d'une UE |
| POST | `/ue/:id/sessions` | admin | crée une cohorte (refus si UE inactive) |
| GET | `/ue-sessions/:id` | admin | détail cohorte |
| PATCH | `/ue-sessions/:id` | admin | édite |
| PATCH | `/ue-sessions/:id/status` | admin | machine à états |
| DELETE | `/ue-sessions/:id` | admin | supprime |

## 4. Séances d'ECUE & présence ➕ / 🔁

| Méthode | Chemin | Rôle | Notes |
|---|---|---|---|
| GET | `/ue-sessions/:id/seances` | admin/enseignant | séances planifiées de la cohorte |
| POST | `/ue-sessions/:id/seances` | admin/enseignant | planifie une séance (ecue_id + date) |
| PATCH | `/seances/:seanceId` | admin/enseignant | édite |
| DELETE | `/seances/:seanceId` | admin/enseignant | supprime |
| GET | `/seances/:seanceId/attendance` | enseignant | fiche de présence de la séance |
| POST | `/seances/:seanceId/attendance` | enseignant | saisit/maj présence (present/absent/retard/excuse) |
| GET | `/seances/:seanceId/live-sessions` | enseignant | visios de la séance |
| POST | `/seances/:seanceId/live-sessions` | enseignant | crée une visio rattachée à la séance |

## 5. Évaluations 🔁 (rattachées à l'ECUE)

Toutes les routes `/assignments*`, `/questions*`, `/answers*`, `/submissions*`
**inchangées dans leur forme** ; seul le rattachement change :
- création d'évaluation : `ecue_id` (obligatoire) + `ue_session_id?` (contexte).
- `GET /ecue/:id/assignments` (liste par ECUE) remplace `/subjects/:id/...`.

| = | `/assignments`, `/assignments/:id`, `/assignments/:id/questions`, `/assignments/:id/submit`, `/assignments/:id/submit-answers`, `/assignments/:id/submit-upload`, `/assignments/:id/submissions`, `/assignments/:id/submissions/:studentId/grade`, `/questions/:questionId`, `/answers/:answerId/grade`, `/submissions/:submissionId/detail` | inchangées |

## 6. Résultats ECUE & validation UE ➕

| Méthode | Chemin | Rôle | Notes |
|---|---|---|---|
| GET | `/ue-sessions/:id/results` | admin/enseignant | résultats ECUE des étudiants de la cohorte |
| POST | `/ue-sessions/:id/results/recompute` | admin | recalcule moyennes ECUE + validation UE → UV |
| PATCH | `/ecue-results/:resultId/validate` | admin/enseignant | validation manuelle (override, tracé) |
| GET | `/students/:studentId/ue-results` | admin | capitalisation UV par UE de l'étudiant |

## 7. Inscription / commerce 🔁 (à l'UE)

| Méthode | Chemin | Rôle | Notes |
|---|---|---|---|
| = | `/student/catalog` | étudiant | catalogue Filière → UE inscriptibles → ECUE |
| = | `/student/programmes` | étudiant | filières (libellé métier) |
| = | `/student/cart`, `/student/cart/items`, `/student/cart/items/:enrollmentId` | étudiant | panier d'**UE** ; ligne pointe `ue_session_id` |
| = | `/student/orders`, `/student/orders/:id`, `/student/orders/:id/payment`, `/student/receipts/:paymentId` | étudiant | commande/paiement à l'UE |
| = | `/student/enrollments` | étudiant | inscriptions UE (prérequis UE contrôlés) |
| = | `/enrollments`, `/enrollments/:id/complete`, `/payments` | admin | gestion |
| ➕ | `/student/ue/:ueSessionId/ecue` | étudiant | ECUE débloquées par l'inscription confirmée |

## 8. Diplômes 🔁 (composés d'UE)

| = / 🔁 | Chemin | Notes |
|---|---|---|
| = | `/diplomas`, `/diplomas/:id`, `/diplomas/:id/award`, `/diplomas/:id/awarded`, `/diplomas/:id/candidates`, `/diplomas/:id/recompute`, `/diplomas/:id/revoke` | inchangées dans la forme |
| 🔁 | `/diplomas/:id/requirements` | exigences = **UE** (`ue_id`), validation même filière |
| = | `/student/diplomas`, `/student/diplomas/:id/progress`, `/student/diplomas/:id/attestation` | progression via UV capitalisées (UE) |
| = | `/parent/diplomas`, `/parent/enrollments`, `/parent/payments`, `/parent/children` | espace parent |

## 9. Codes d'erreur ajoutés (`ERROR_STATUS`)

`ECUE_NOT_FOUND`, `UE_NOT_FOUND`, `UE_INACTIVE`, `UE_ECUE_LINK_EXISTS`,
`ECUE_STILL_LINKED`, `UE_PREREQ_NOT_SAME_FILIERE`, `UE_PREREQ_CYCLE`,
`UE_PREREQ_NOT_VALIDATED`, `UE_SESSION_NOT_FOUND`, `SEANCE_NOT_FOUND`,
`ECUE_RESULT_NOT_FOUND`, `DIPLOMA_UE_NOT_SAME_FILIERE` (en complément des codes
028/029 conservés : `SESSION_FULL`, `ENROLLMENT_ACTIVE_EXISTS`, …).

## 10. Schémas Zod (`packages/contracts`)

- `professional.ts` : `ProfessionalEcue*` (ex-Subject), `ProfessionalUe*`,
  `ProfessionalUeEcue*` (liaison), `ProfessionalUePrerequisite*`,
  `ProfessionalUeSession*`, `ProfessionalEcueSeance*`,
  `ProfessionalEcueAttendance*`, `ProfessionalEcueResult*`.
- `professional-diplomas.ts` : `DiplomaRequirement` avec `ue_id`,
  `StudentProfessionalUeResult*`.
- Barrel `index.ts` re-exporte les nouveaux schémas ; suppression des exports
  `*Subject*` obsolètes.
