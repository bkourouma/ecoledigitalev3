# Portails v2 : parent, élève, enseignant

Routes `/v2/parent/*`, `/v2/student/*`, `/v2/teacher/*` (arborescence `src/app/v2/`, pages legacy `app/{parent,student,teacher}` intactes).
Les portails **assemblent** les écrans et hooks déjà livrés (`platform/v2/*`) dans une coquille commune, et comblent ce qui manquait.
Tout passe par le client API typé (schémas Zod de `packages/contracts/src/v2/*`), `usePermission` / `useFeature` et les gardes serveur.
**Aucune logique métier côté client** : moyennes, rangs, décisions, montants, états d'appel, conflits sont ceux de l'API.

## Accès strictement limité

Trois couches, de la plus fine à la plus sûre :

1. **Garde serveur** : chaque `layout.tsx` de portail appelle `requireAnyPermission(...PORTAL_GUARD.<portail>)` (`student.child.read`,
   `student.self.read`, `staff.own.read`/`schedule.own.read`), chaque page ajoute sa permission (fail-closed : service des permissions
   indisponible = `/unauthorized`). Un identifiant d'URL mal formé est un 404 immédiat (`isUuid`).
2. **Garde d'écran** (affichage, jamais une barrière) :
   - parent : `ChildScope` n'affiche rien et **n'émet aucune lecture** pour un enfant absent de `GET /people/children` (liens vivants
     avec accès au portail) ; message « n'est pas rattaché à votre compte » ;
   - élève : aucun identifiant dans l'adresse, l'élève est celui de `GET /people/me/student` (sinon message « aucun dossier lié ») ;
   - enseignant : `TeacherClassDetail` refuse une classe absente de `GET /people/me/classes` avant toute lecture d'élèves.
3. **L'API reste la barrière** : lien de tutelle relu à chaque requête par chaque module (`403 …not_visible` pour `assess` et `results`,
   `404` uniforme pour `finance`, `academic`, `people`), périmètre de l'enseignant (`assess.not_assigned`, fiche réduite). Les refus
   sont affichés avec le **message de l'API** (`ErrorBlock`), jamais avalés ni remplacés par une page vide.

Matrice testée (Vitest/RTL, faux client API validant les réponses par les vrais schémas) : parent × enfant non lié (neuf écrans, zéro appel de
données), 403/404 de l'API sur résultats, finance, reçu, emploi du temps ; élève sans dossier ; enseignant × classe étrangère, bulletin d'un
autre (404), contestation d'un bulletin versé (409).

## Parent

| Route | Écran | Permission (page) |
|---|---|---|
| `/v2/parent` | un bloc par enfant : moyenne publiée, absences et retards, scolarité restante, prochaines séances | `student.child.read` |
| `/v2/parent/children/[childId]` | tableau de bord de l'enfant + annonces | `student.child.read` |
| `.../results` | résultats officiels (période, année) et notes publiées, matières nommées | `grade.child.read` ou `result.child.read` |
| `.../reportcards` | bulletins publiés : téléchargement contrôlé (URL signée), code et QR de vérification publique | `reportcard.child.read` |
| `.../attendance` | absences, justificatifs (dépôt, retrait) | `attendance.child.read` |
| `.../schedule`, `.../upcoming` | emploi du temps (semaine / jour), examens planifiés à 30 jours | `schedule.child.read` |
| `.../finance`, `.../finance/receipts/[id]` | scolarité (`/finance/me/*`) : totaux, échéances, factures, paiements, reçus PDF, **paiement en ligne** | `finance.child.read` (+ `finance.child.pay`, fonction `finance.online-payment`) |
| `.../documents` | bulletins, reçus, diplômes et attestations du supérieur | l'une de `reportcard.child.read`, `finance.child.read`, `higher.child.read` |
| `.../emergency` | dossier de l'enfant, responsables, contacts d'urgence (modifiables) | `student.child.read` (+ `student.child.update`) |
| `/v2/parent/account` | coordonnées modifiables, sécurité, établissements | `student.child.read` |

Plusieurs enfants : sélecteur dans l'en-tête (`ChildHeader`) qui **conserve la section** ; onglets filtrés par permissions. Plusieurs
établissements : « Mes établissements » (`/v2/account/tenants`, avec `NEXT_PUBLIC_AUTH_V2=1`) ; chaque établissement est une session distincte.

## Élève

`/v2/student` (mon dossier : fiche, repères, inscriptions), `results`, `reportcards`, `schedule`, `upcoming`, `attendance` (justificatifs),
`finance` (+ `receipts/[id]`), `documents`, `profile` (identité en lecture seule, coordonnées modifiables : `student.self.update`).

## Enseignant

| Route | Écran | Permission (page) |
|---|---|---|
| `/v2/teacher` | **Aujourd'hui** : séances du jour, état de l'appel, « Faire l'appel », « Saisir les notes » | `schedule.own.read` |
| `/v2/teacher/classes`, `/[classroomId]` | mes classes (matières, rôles), élèves de la classe | `staff.own.read`, `student.class.read` |
| `/v2/teacher/assessments`, `/new`, `/[id]`, `/[id]/grades` | mes évaluations, création, circuit, **grille de notes** (écrans `assessments` hébergés dans le portail) | `assessment.read`, `assessment.create`, `grade.read`/`grade.enter` |
| `/v2/teacher/attendance`, `/call/[kind]/[id]` | mes appels du jour, appel journalier, file hors ligne (conflits à vérifier), historique 30 jours | `attendance.take` |
| `/v2/teacher/schedule`, `/export` | mon emploi du temps, export **ICS** (téléchargement, jetons révocables) | `schedule.own.read` |
| `/v2/teacher/payslips`, `/[id]` | mes bulletins de paie, document figé, PDF scellé, **contestation** motivée | `payroll.payslip.read_own` (+ `payroll.my.dispute`) |
| `/v2/teacher/leaves` | mes congés et ma présence (fonction `attendance.staff`) | `attendance.own.read` |
| `/v2/teacher/profile` | fiche, affectations, coordonnées modifiables | `staff.own.read` (+ `staff.own.update`) |

Le portail fournit la file d'appel hors ligne (`OutboxProvider`) à toutes ses pages. Le conflit d'un pointage est arbitré par la
direction : l'enseignant le voit dans « Mes appels » sans pouvoir l'écraser.

## Organisation

- `src/platform/portal/` : `menus.ts` (menus et onglets par permission, fonctions pures testées), `PortalShell` (coquille `admin/shell/Shell` :
  lien d'évitement, tiroir mobile, déconnexion), `ChildScope` (garde de tutelle, sélecteur, onglets), `ids.ts`.
- `src/platform/v2/portal.ts` : hooks famille (libellés, notes publiées paginées par curseur, résultats, bulletins d'un enfant, documents du
  supérieur, **finance `/finance/me/*`**, coordonnées personnelles). `teaching.ts` : contexte d'enseignement (mes classes nommées, périodes,
  matières), options de classes, contestation d'un bulletin.
- `src/app/v2/_family/` : écrans partagés parent / élève (`FamilyResults`, `FamilyReportCards`, `FamilySchedule`, `FamilyUpcoming`,
  `FamilyFinance`, `FamilyDocuments`, `FamilySnapshot`, `OwnContactForm`). `src/app/v2/{parent,student,teacher}/_components` : écrans propres.
- `src/platform/ui/{pdf.ts,PdfButton.tsx,QrCode.tsx}` : téléchargement d'un PDF servi par l'API avec le jeton (202 « en cours de rendu » →
  nouvelle interrogation bornée, puis message), QR local (SVG, aucune donnée ne quitte la page).
- i18n : espace de noms `v2Portal` (`shell`, `menu.<portail>`, `child`, `family`, `parent`, `student`, `teacher`, `contact`, `pdf`) ;
  `src/app/v2/portal-messages-coverage.test.ts` vérifie chaque clé statique et chaque entrée de menu / onglet.

### Modifications additives de fichiers existants

`attendance/_components/CallScreen` (`backHref`), `CallListScreen` (`basePath`), `schedule/_components/TimetableScreen` (`exportHref`),
`assessments/_components/{GradeEntry (detailHref), AssessmentCreate (basePath), AssessmentDetail}` (liens restant dans le portail, classe nommée par « mes classes »),
`platform/v2/directory.ts` (`useClassroomDirectory` : repli sur « mes classes » pour un enseignant sans `academic.classroom.read`),
`assessments/_components/shared.tsx` (sélecteurs de classe, période et matière : repli sur « mes classes » pour un enseignant sans lecture
académique ; comportement inchangé pour tout autre profil). Défauts inchangés : aucun autre écran n'est affecté.

## Extensions d'API (additives, testées)

- `GET /api/v1/academic/me/labels` et `/children/:studentId/labels` (`enrollment.self.read` / `enrollment.child.read` + tutelle) : classes,
  périodes et matières des inscriptions de l'élève. Sans elles, les notes, résultats, présences et séances ne portent que des identifiants.
  Test : `academic/test/integration/family-labels.integration.test.ts`.
- `GET /api/v1/people/me/classes` : `classroomName`, `classroomCode`, `nodeLabel` par affectation, `periods` de l'année, `nodes` évaluables.
  Permet à un enseignant sans `academic.classroom.read` de nommer ses classes, de créer une évaluation et de lire son emploi du temps.
  Test : `people/test/integration/teaching.integration.test.ts`.

## Parité avec le legacy (`app/{parent,student,teacher}`) : manques et choix

- **Devoirs à rendre / soumission de copies / corrections en attente** : la nouvelle plateforme n'a pas de module de devoirs ; « évaluations à
  venir » = examens PLANIFIÉS à l'emploi du temps (séances de type évaluation). Parité manquante, à décider avec le module d'évaluation en ligne.
- **Supports de cours, visioconférence, tuteur IA, support/FAQ, auto-inscription (module professionnel)** : hors périmètre (specs 022, 018+).
- **Messages et annonces** : le module de messagerie est livré par un autre chantier. Points d'entrée prêts (`/v2/messages`, `/v2/announcements`),
  masqués tant que `NEXT_PUBLIC_V2_MESSAGING=1` n'est pas posé ; la carte « Annonces » du tableau de bord affiche un message d'attente.
- **Heures déclarées / séances professionnelles de l'enseignant** : remplacées par les séances validées du module `scheduling` et les bulletins de
  paie (`payroll`).
- **Tableau de bord analytique enseignant** (`/teacher/reports`) : pas de route v2 ; reste à faire avec la spec 025.
- **Libellés des décisions et mentions** : les résultats portent des codes (`mentionCode`, `decisionCode`) dont le libellé vient de la version
  de règle (lecture réservée au personnel) : la famille voit le code et le résultat normalisé (`decisionOutcome`, traduit). À arbitrer : exposer le
  `label_map` en lecture famille.
- **Contacts d'urgence « désactivés » du legacy** : livrés (lecture et correction par le parent, `student.child.update`).
- **Parcours professionnel / diplômes** : diplômes et attestations publiés dans « Documents » ; parcours détaillé (`/higher/.../pathway`) : hook prêt
  (`useFamilyPathway`), écran non livré.

## Points à arbitrer

1. Libellés famille des décisions / mentions (ci-dessus).
2. Ouvrir à la famille la liste des évaluations annoncées (aujourd'hui seules les séances d'évaluation planifiées le sont).
3. Pièces jointes d'un justificatif déposé par un parent : l'écran existant reste celui de `attendance` ; le dépôt de fichiers dépend du stockage.
4. Salles : le nom de la salle d'une séance n'est pas lisible sans `schedule.read` (seul `locationLabel` est affiché) ; proposer `roomName` dans le DTO.

## Tests

```bash
pnpm --filter @ecoledigitale/web test                       # Vitest/RTL (API simulée) : matrice d'accès de chaque portail
PW_CHANNEL=msedge pnpm --filter @ecoledigitale/web exec playwright test -c playwright.portals.config.ts   # garde serveur de chaque route, 375 px et bureau (Next seul)
```

Fichiers : `parent/_components/Parent.test.tsx`, `student/_components/Student.test.tsx`, `teacher/_components/Teacher.test.tsx`,
`platform/portal/portal.test.tsx` (menus, onglets, sélecteur d'enfant), `platform/ui/pdf.test.ts`, `portal-messages-coverage.test.ts`.
Les parcours authentifiés de bout en bout exigent NextAuth + API + Postgres : non couverts par Playwright.
