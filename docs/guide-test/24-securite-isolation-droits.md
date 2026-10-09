# Chapitre 24. Sécurité : droits par rôle, isolation entre établissements, séparation des tâches, authentification, journal d'audit

Ce chapitre est **transversal** : il ne crée presque aucune donnée. Il consiste à **essayer d'ouvrir ou de faire ce qu'on ne doit pas pouvoir faire** et à constater un refus propre : aucune donnée d'autrui, aucun détail technique, aucune page blanche. Un seul cas où l'on voit ce qu'on ne devrait pas voir est un défaut **Bloquant** : prévenir l'équipe immédiatement.

> Le numéro 23 est réservé aux parcours de bout en bout. Les écrans de gestion des rôles, du journal d'audit et des comptes sont décrits en détail au chapitre 1 ; les circuits de validation sont joués dans leurs chapitres (notes : 8, paie : 13, vie scolaire : 19, examens : 20, finance : 12). Ici, on **contrôle les refus**.

## Prérequis, comptes, droits, données de départ

**URL réelle.** Le web est servi sur `http://localhost:3000` (API sur `http://localhost:4000`). Le dossier `apps/web/src/app/v2/` est un segment d'adresse **réel** : les écrans sont bien sous `/v2/...` (aucune réécriture dans `apps/web/next.config.js`, aucun préfixe dans `apps/web/middleware.ts`). Les pages de connexion et de refus historiques sont **hors `/v2`** : `/login` (connexion, avec le panneau des comptes de test), `/unauthorized` (page « Accès refusé »), `/select-role`. Les liens d'invitation et de réinitialisation sont aussi hors `/v2` (`/auth/invitation`, `/auth/reset-password`). Il n'y a **pas de sous-domaine par établissement** en local : l'établissement est porté par la session (voir 24.18).

**Prérequis.**
- Les trois établissements de l'annexe (Collège Le Baobab `secondaire-test`, École Les Palmiers `primaire-test`, Université Horizon `superieur-test`) sont démarrés et peuplés.
- Trois contextes de navigation **séparés** (Chrome normal, Chrome en navigation privée, et un autre navigateur ou un autre profil). **Deux fenêtres privées d'un même navigateur partagent la même session** : se connecter dans l'une déconnecte l'autre. Utiliser une fenêtre normale + une fenêtre privée + un second navigateur.
- Pour les comptes avec MFA, le code du moment est proposé sur `/login` (un code ne sert qu'une fois ; attendre le suivant pour une seconde connexion). Aucun mot de passe ni code n'est écrit dans ce chapitre.
- Pour les scénarios 24.25 à 24.34, l'objet à refuser (remboursement demandé, bulletin calculé, feuille de notes soumise, mesure proposée…) est créé dans le chapitre cité. S'il n'existe pas, jouer d'abord son scénario de création.

**Comptes** (e-mails de l'annexe ; `<slug>` vaut `secondaire-test`, `primaire-test` ou `superieur-test`).

| Rôle | E-mail | Établissement par défaut dans ce chapitre | MFA |
|---|---|---|---|
| Propriétaire | `direction.generale@<slug>.test` | Collège | oui |
| Directeur | `directeur@<slug>.test` | Collège | oui |
| Directeur des études | `etudes@<slug>.test` | Collège | oui |
| Responsable pédagogique | `pedagogie@<slug>.test` | Collège | oui |
| Secrétariat | `secretariat@<slug>.test` | Collège (et École pour l'isolation) | oui |
| Économe | `econome@<slug>.test` | Collège | oui |
| Enseignant | `enseignant@secondaire-test.test` | Collège | non |
| Instituteur (CP1 A) | `enseignant@primaire-test.test` | École | non |
| Instituteur de maternelle (GS-A) | `instituteur.maternelle@primaire-test.test` | École | non |
| Éducateur | `educateur@<slug>.test` | Collège | non |
| Responsable des examens | `examens@<slug>.test` | Collège | non |
| Chargé d'admissions | `admissions@<slug>.test` | Collège | non |
| Parent (DIABATE Séka) | `parent@<slug>.test` | Collège | non |
| Élève (DIABATE Nadia) | `eleve@<slug>.test` | Collège | non |
| Opérateur de la plateforme | voir chapitre 1 | console `/v2/platform/login` | voir chapitre 1 |

**Droits.** Tous les rôles sont concernés. Les accès par rôle sont déduits de `apps/api/src/modules/rbac/templates/system-roles.ts` (rôles et permissions) et des gardes de pages (`requirePermission`, `requireAnyPermission` dans `apps/web/src/app/v2/**`).

**Données de départ.** Seulement les comptes et le jeu de l'annexe (fichiers `scripts/seed-v2/demo/staff.ts`, `scenario.ts`, `demo/primary.ts`, `demo/schoollife.ts`). Le type d'événement `EXCLUSION_DEMO` (« Exclusion temporaire (démonstration) ») exige les quatre yeux. L'enseignant du primaire (`enseignant@primaire-test.test`) et l'instituteur de maternelle portent **le même rôle système `instituteur`** ; seule leur classe diffère (CP1 A / Grande Section A, code `GS-A`).

---

## 24.0 Grille de lecture : les réponses possibles à un refus

Chaque situation a **une** réponse attendue. Les prouver est l'objet du chapitre.

| # | Situation | Réponse attendue | Preuve dans le code |
|---|---|---|---|
| R1 | Pas connecté, adresse `/v2/...` protégée | Retour à la page de connexion `/login` | `createGuards.requireSession` : `redirect(LOGIN_PATH)` (`apps/web/src/platform/auth/guards.ts`) |
| R2 | Connecté, mais le droit de la page manque | Redirection vers `/unauthorized` : titre « Accès refusé », texte "Vous n'avez pas les droits nécessaires pour afficher cette page.", lien "Retour à l'accueil". Aucune donnée. | `requirePermission` / `requireAnyPermission` → `redirect("/unauthorized")` ; `apps/web/src/app/unauthorized/page.tsx` |
| R3 | Console plateforme sans jeton d'opérateur | Retour à `/v2/platform/login` (le contenu n'est jamais rendu) | `OperatorShell` : `router.replace(OPERATOR_LOGIN_PATH)` |
| R4 | Adresse qui n'existe pas, ou identifiant mal formé dans une adresse qui le valide | Page 404 par défaut de Next ("This page could not be found.", en anglais : écart connu C-03-09) | Pas de `not-found.tsx` ; `notFound()` si `!isUuid(id)` (parcours parent, élève, enseignant, finance famille) |
| R5 | Identifiant bien formé mais inexistant, **ou d'un autre établissement, ou d'un autre enfant** | L'écran s'ouvre puis affiche un message de type **introuvable**, sans donnée : « Ressource introuvable. », ou le message de l'écran (« Cet élément est introuvable ou hors de votre périmètre. », « Élément introuvable », « Cette entrée n'existe pas ou n'appartient pas à votre établissement. », « Ce rôle n'existe pas dans votre établissement. »). Jamais "interdit", jamais le nom de l'objet. | API : `NotFoundError.of(...)` (HTTP 404) ; la RLS rend la ligne invisible ; finance famille : "TOUJOURS la même 404 `finance.not_found`" |
| R6 | Écran sans garde de page (compte, membres) | L'écran s'ouvre mais l'API refuse : "Action non autorisée." (403) ou « Vous n'avez pas les droits nécessaires pour cette action. » | `ForbiddenError("Action non autorisée.")` (`rbac/http/guard.ts`) ; `errorMessageSpec` |
| R7 | Fonction absente de l'offre (pack) | « Cette fonctionnalité n'est pas incluse dans votre offre. » (API : 403, code `entitlements.feature_not_available`) | `FeatureGate`, `createRequireFeature` |
| R8 | Acte sensible sans MFA | 403 `rbac.mfa_required` : « Cette action sensible exige une authentification à deux facteurs (MFA). Activez-la sur votre compte puis reconnectez-vous. » ; ou fenêtre « Confirmez votre identité » | `apiErrors.mfaRequired`, `v2StepUp` |
| R9 | Trop d'essais de connexion ou de code | "Trop de tentatives. Réessayez dans N minute(s)." (429 + `Retry-After`) | `explainIamError`, `describeSignInError` |

**Défauts à signaler** : une liste ou une fiche d'un autre établissement, d'un autre enfant ou d'un autre élève ; un message du type "vous n'avez pas accès à cet élève" (révèle l'existence : Majeur) ; une trace d'erreur, un identifiant interne brut ou un nom de table dans un message ; une page blanche ; une action qui réussit alors que le rôle ne la permet pas.

---

## 24.1 Matrice rôle × module

Légende : **●** = accès à l'écran **et** droit d'agir (la permission d'action du module est détenue) ; **○** = consultation seulement (la permission de lecture est détenue, pas celle d'action) ; **—** = écran refusé (R2). Matrice **calculée** à partir de `system-roles.ts` : le propriétaire et le directeur détiennent `*` (le directeur sans `entitlements.manage`, `rbac.role.manage`, `payroll.payslip.approve_owner`, `payroll.settings.manage`, `rules.platform.manage` ; le propriétaire sans `rules.platform.manage`). Les `*.self.*` / `*.child.*` du propriétaire et du directeur découlent de `*` : leurs écrans de portail s'ouvrent mais n'ont aucun élève, enfant ou fiche de personnel rattaché (voir "À vérifier en test"). Le contrôle réel reste l'API.

| Module (écran de référence) | Prop. | Dir. | D. études | Resp. péda. | Secr. | Écon. | Ens. | Instit. | Éduc. | Resp. exam. | Adm. | Par. | Élève |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Années et périodes `/v2/academic/years` | ● | ● | ● | ○ | ○ | ○ | — | — | ○ | ○ | — | — | — |
| Clôture / reconduction d'année `/v2/academic/rollover` | ● | ● | — | — | — | — | — | — | — | — | — | — | — |
| Classes et salles de cours `/v2/academic/classrooms` | ● | ● | ● | ○ | ○ | ○ | — | — | ○ | ○ | — | — | — |
| Curriculum `/v2/academic/curriculum` | ● | ● | ● | ● | ○ | — | — | — | — | — | — | — | — |
| Inscriptions `/v2/enrollments` | ● | ● | ○ | ○ | ● | ○ | — | — | ○ | ○ | — | — | — |
| Élèves (fiches) `/v2/students` | ● | ● | ○ | ○ | ● | ○ | ○ | ○ | ○ | ○ | — | — | — |
| Tuteurs `/v2/guardians` | ● | ● | ○ | — | ● | ○ | — | — | ○ | — | — | — | — |
| Personnel (fiches) `/v2/staff` | ● | ● | ○ | ○ | — | ○ | — | — | — | — | — | — | — |
| Affectations d'enseignement `/v2/staff/assignments` | ● | ● | ● | ○ | — | — | — | — | — | — | — | — | — |
| Admissions : traitement `/v2/admissions` | ● | ● | — | — | ● | — | — | — | — | — | ● | — | — |
| Admissions : décision, réglages `/v2/admissions/settings` | ● | ● | — | — | — | — | — | — | — | — | — | — | — |
| Appel (présences élèves) `/v2/attendance/call` | ● | ● | ○ | ○ | ● | — | ● | ● | ● | — | — | — | — |
| Justificatifs d'absence : décision `/v2/attendance/justifications` | ● | ● | ● | — | ○ | — | — | — | ○ | — | — | — | — |
| Présence et congés du personnel `/v2/attendance/staff` | ● | ● | ● | — | — | — | — | — | — | — | — | — | — |
| Emplois du temps `/v2/schedule/timetables` | ● | ● | ● | ○ | ○ | — | — | — | ○ | — | — | — | — |
| Évaluations : saisie des notes `/v2/assessments` | ● | ● | ○ | ○ | — | — | ● | ● | — | ○ | — | — | — |
| Notes : relecture `/v2/assessments` | ● | ● | ● | ● | — | — | — | — | — | — | — | — | — |
| Notes : validation `/v2/assessments` | ● | ● | ● | ● | — | — | — | — | — | — | — | — | — |
| Notes : publication `/v2/assessments` | ● | ● | ● | — | — | — | — | — | — | — | — | — | — |
| Corrections de notes `/v2/assessments/revisions` | ● | ● | ● | — | — | — | ○ | ○ | — | — | — | — | — |
| Résultats de classe `/v2/results` | ● | ● | ● | ○ | — | — | — | — | — | — | — | — | — |
| Surcharges de résultat `/v2/results/overrides` | ● | ● | ○ | — | — | — | — | — | — | — | — | — | — |
| Bulletins : liste, émission `/v2/reportcards` | ● | ● | ● | ○ | ● | — | — | ○ | — | — | — | — | — |
| Bulletins : publication `/v2/reportcards` | ● | ● | ● | — | — | — | — | — | — | — | — | — | — |
| Bulletins : révocation, identité `/v2/reportcards/identity` | ● | ● | — | — | — | — | — | — | — | — | — | — | — |
| Règles de calcul `/v2/rules` | ● | ● | ○ | ○ | — | — | — | — | — | — | — | — | — |
| Conseils de classe `/v2/councils` | ● | ● | ● | — | ○ | — | ○ | — | — | — | — | — | — |
| Vie scolaire : lecture générale `/v2/schoollife` | ● | ● | ○ | — | — | — | ● | — | ● | — | — | — | — |
| Vie scolaire : validation des mesures `/v2/schoollife/validations` | ● | ● | — | — | — | — | — | — | — | — | — | — | — |
| Examens nationaux `/v2/examinations` | ● | ● | ○ | — | — | — | — | — | — | ● | — | — | — |
| Examens : publication des résultats `/v2/examinations/results` | ● | ● | ● | — | — | — | — | — | — | — | — | — | — |
| Finance : factures `/v2/finance/invoices` | ● | ● | — | — | ○ | ● | — | — | — | — | — | — | — |
| Finance : encaissement, caisse `/v2/finance/payments/new` | ● | ● | — | — | — | ● | — | — | — | — | — | — | — |
| Finance : remboursements `/v2/finance/refunds` | ● | ● | — | — | ○ | ● | — | — | — | — | — | — | — |
| Finance : fournisseurs de paiement `/v2/finance/providers` | ● | ● | — | — | — | — | — | — | — | — | — | — | — |
| Paie : bulletins de paie `/v2/payroll` | ● | ● | — | — | — | ● | — | — | — | — | — | — | — |
| Paie : arrêt du bulletin `/v2/payroll/payslips` | ● | ● | — | — | — | — | — | — | — | — | — | — | — |
| Paie : réglages `/v2/payroll/configuration/settings` | ● | — | — | — | — | — | — | — | — | — | — | — | — |
| Pilotage de la direction `/v2/direction` | ○ | ○ | — | — | — | — | — | — | — | — | — | — | — |
| Journal d'audit `/v2/audit` | ● | ● | — | — | — | — | — | — | — | — | — | — | — |
| Rôles et attributions `/v2/access/roles` | ● | ● | — | — | — | — | — | — | — | — | — | — | — |
| Utilisateurs (comptes) `/v2/admin/members` | ● | ● | — | — | — | — | — | — | — | — | — | — | — |
| Établissement et abonnement `/v2/settings` | ● | ● | ○ | ○ | ○ | ○ | — | — | ○ | ○ | ○ | — | — |
| Documents (GED) `/v2/documents` | ● | ● | ● | ○ | ● | ● | ○ | — | ○ | ○ | — | ○ | ○ |
| Documents : quarantaine, catégories `/v2/documents/quarantine` | ● | ● | — | — | — | — | — | — | — | — | — | — | — |
| Messagerie `/v2/messages` | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ○ | ○ |
| Messagerie : modération `/v2/messages/moderation` | ● | ● | — | — | — | — | — | — | — | — | — | — | — |
| Notifications : journal, envoi `/v2/notifications` | ● | ● | ● | — | ● | ○ | — | — | — | ○ | — | — | — |
| Imports Excel / CSV `/v2/imports` | ● | ● | ● | — | ● | ● | ● | ● | — | — | — | — | — |
| Imports : réglages `/v2/imports/settings` | ● | ● | — | — | — | — | — | — | — | — | — | — | — |
| Primaire : compétences, conseil des maîtres `/v2/primary` | ● | ● | ○ | — | ○ | — | — | ● | — | — | — | — | — |
| Primaire : sceller un bilan, réglages `/v2/primary/parametres` | ● | ● | — | — | — | — | — | — | — | — | — | — | — |
| Affectation d'État `/v2/stateassign` | ● | ● | ○ | — | ● | ○ | — | — | — | — | — | — | — |
| Affectation d'État : vérification `/v2/stateassign/verification` | ● | ● | — | — | — | — | — | — | — | — | — | — | — |
| Supérieur : diplômes, crédits `/v2/higher/diplomas` | ● | ● | ● | — | — | — | — | — | — | — | — | — | — |
| Supérieur : dispenses, signataires `/v2/higher/signatories` | ● | ● | ○ | — | ○ | — | — | — | — | — | — | — | — |
| Portail enseignant (mise en page) `/v2/teacher` | ○ | ○ | — | — | — | — | ○ | ○ | ○ | — | — | — | — |
| Portail parent (ses enfants) `/v2/parent` | ○ | ○ | — | — | — | — | — | — | — | — | — | ○ | — |
| Portail élève (lui-même) `/v2/student` | ○ | ○ | — | — | — | — | — | — | — | — | — | — | ○ |
| Paiement en ligne par la famille `/v2/finance/me` | ● | ● | — | — | — | — | — | — | — | — | — | ● | ● |

Précisions :
- **Pack et offre.** Beaucoup d'écrans dépendent aussi de l'offre de l'établissement (R7) : vie scolaire, conseils de classe, affectation d'État et « Élèves affectés par l'État » (finance) sont du pack **Secondaire** ; compétences, conseil des maîtres, bilans annuels, archives d'année et états du primaire sont du pack **Primaire** ; diplômes, rattrapages, dispenses, UE annuelles, prérequis et signataires sont du pack **Supérieur** (source : `features` des manifestes des modules). Un propriétaire qui tape `/v2/schoollife` dans l'école primaire passe la garde de page mais le contenu doit répondre R7 : voir 24.17.
- **`/v2/teacher`** : la page d'accueil exige `schedule.own.read` ; la mise en page du portail enseignant n'exige que `staff.own.read` **ou** `schedule.own.read`. L'éducateur ouvre donc `/v2/teacher/classes`, `/v2/teacher/profile`, `/v2/teacher/leaves`, `/v2/teacher/attendance` mais pas `/v2/teacher` ni `/v2/teacher/schedule`.
- **Atterrissage après connexion** (`apps/web/src/lib/role-landing.ts`) : propriétaire et directeur `/v2/direction` ; directeur des études `/v2/academic` (redirige vers `/v2/academic/years`) ; responsable pédagogique `/v2/assessments` ; secrétariat `/v2/students` ; économe `/v2/finance` ; enseignant `/v2/teacher` ; instituteur `/v2/primary` ; éducateur `/v2/attendance` ; responsable des examens `/v2/examinations` ; chargé d'admissions `/v2/admissions` ; parent `/v2/parent` ; élève `/v2/student` ; tout autre rôle `/v2/home`.
- **Cumul de rôles.** Un membre du personnel peut cumuler un rôle de fonction et le rôle `personnel` (`staff.own.*`, `payroll.payslip.read_own`, `schedule.own.read`). Les comptes de la démonstration n'ont **pas** `personnel` : le secrétariat n'a donc pas `/v2/staff/me` ni `/v2/payroll/my`.

---

## 24.2 Droits par rôle : accès et adresses interdites

Pour chaque scénario : se connecter avec le compte (fenêtre dédiée), vérifier l'atterrissage et le menu, puis **taper chaque adresse à la main dans la barre d'adresse** (même si le menu ne la propose pas), en rechargeant la page (adresse complète, pas un clic). Résultat attendu pour toutes les adresses des tableaux : R2 (`/unauthorized`, « Accès refusé »), sauf mention. Les adresses sont vérifiées contre la matrice calculée du 24.1 ; la colonne "Permission manquante" est celle que la page exige (`requirePermission`).

> Le menu vient de `GET /api/v1/rbac/me/navigation` (permission **et** offre). Les libellés de menu cités ci-dessous viennent des manifestes de l'API, pas de `fr-CI.json` : ils sont notés entre guillemets droits. Si le menu n'a pas pu être chargé, l'écran dit « Le menu n'a pas pu être chargé. Les pages restent accessibles par leur adresse. » : les gardes s'appliquent quand même.

#### 24.1 Propriétaire
Compte : Propriétaire (Collège) · Où : `/login` puis `/v2/direction` · Prérequis : MFA.
1. Se connecter ; vérifier l'atterrissage `/v2/direction`.
2. Parcourir le menu : tous les groupes de gestion (académique, admissions, pilotage, évaluations, présences, documents, examens, finance, paie, personnes, bulletins, résultats, règles, emplois du temps, vie scolaire, élèves affectés, messagerie, imports) plus « Utilisateurs », « Rôles et permissions », « Attributions de rôles », « Journal d'audit », « Établissement ». Le menu est celui du directeur ; la différence est dans les écrans : seul le propriétaire ouvre `/v2/payroll/configuration/settings` (réglages de paie) et peut modifier l'abonnement et définir des rôles.
3. Taper les adresses suivantes :

| Adresse | Pourquoi c'est refusé | Résultat attendu exact |
|---|---|---|
| `/v2/platform/tenants` | Console réservée aux opérateurs (jeton `superAdminToken` du navigateur) | R3 : retour à `/v2/platform/login` ; aucune organisation affichée |
| `/v2/platform/plans` | idem | R3 |
| `/v2/platform/audit` | idem | R3 |
| `/v2/platform/tenants/new` | idem | R3 |

4. Dans l'école primaire (fenêtre Propriétaire du primaire), taper `/v2/higher/diplomas` et `/v2/schoollife`.
Résultat attendu : la garde de page est franchie (le propriétaire détient `*`) ; le contenu doit répondre R7 « Cette fonctionnalité n'est pas incluse dans votre offre. » (à vérifier en test : message exact de chaque écran).
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le propriétaire (console plateforme)

#### 24.2 Directeur
Compte : Directeur (Collège) · Où : `/v2/direction` · Prérequis : MFA.
1. Se connecter ; menu = celui du propriétaire (126 entrées au maximum selon l'offre), y compris « Journal d'audit », « Rôles et permissions », « Utilisateurs », « Mesures à valider », « Vérification des affectations ».
2. Taper :

| Adresse | Permission manquante | Résultat attendu exact |
|---|---|---|
| `/v2/payroll/configuration/settings` | `payroll.payslip.approve_owner` / `payroll.settings.manage` (retirées au directeur) | R2 `/unauthorized` (rapport C-11-10 : « Accès refusé ») |
| `/v2/platform/tenants` | jeton d'opérateur | R3 |
| `/v2/platform/plans` | jeton d'opérateur | R3 |
| `/v2/platform/audit` | jeton d'opérateur | R3 |

3. Ouvrir `/v2/settings/subscription` : l'écran s'ouvre (lecture), mais toute modification de l'abonnement est refusée par l'API (`entitlements.manage` détenu par le propriétaire seulement) : R6 si un bouton est proposé.
4. Ouvrir `/v2/access/roles/new` : l'écran s'ouvre (le directeur lit les rôles) ; l'enregistrement d'un rôle est refusé par l'API (`rbac.role.manage` retirée) : R6 ou R8 selon l'état de la session. Le directeur attribue des rôles (`rbac.assignment.manage`) mais ne peut accorder que des permissions qu'il détient (anti-escalade, voir 24.35).
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le directeur

#### 24.3 Directeur des études
Compte : Directeur des études (Collège) · Où : `/v2/academic` · Prérequis : MFA.
1. Menu autorisé : « Années et périodes », "Programmes et niveaux", « Curriculum », « Classes », « Inscriptions », « Paramètres académiques » ; "Feuilles à relire", « Corrections de notes », « Types d'évaluation » ; « Suivi des appels », « Justificatifs d'absence », « Présence du personnel » ; « Conseils de classe », « Effets des décisions », « Orientation » ; « Examens », "Candidats aux examens", "Résultats d'examen", « Statistiques d'examen », "Corrections d'examen" ; "Bulletins — émission", "Bulletins — liste", « Modèles de documents » ; « Résultats de classe », "Périodes : verrouillage et clôture", « Délibérations » ; « Règles de calcul » (lecture) ; « Emplois du temps », « Salles et équipements », « Remplacements » ; « Vie scolaire » (lecture générale) ; pilotage « Pédagogie », « Alertes de direction » ; « Documents », "Imports Excel / CSV", « Élèves », « Parents et tuteurs », « Personnel », « Affectations », « Messages », « Annonces ».
2. Taper :

| Adresse | Permission manquante | Résultat attendu exact |
|---|---|---|
| `/v2/finance` | aucune des permissions `finance.*` d'entrée | R2 |
| `/v2/payroll/history` | `payroll.payslip.read` | R2 |
| `/v2/direction` | `analytics.read` (rapport de session 03 : « Accès refusé ») | R2 |
| `/v2/audit` | `audit.read` | R2 |
| `/v2/reportcards/identity` | `reportcard.branding.manage` | R2 |
| `/v2/admissions/settings` | `admission.settings.manage` | R2 |
| `/v2/students/new` | `student.create` | R2 |
| `/v2/access/roles` | `rbac.role.read` | R2 |

- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le directeur des études

#### 24.4 Responsable pédagogique
Compte : Responsable pédagogique (Collège) · Où : `/v2/assessments` · Prérequis : MFA.
1. Menu autorisé : « Années et périodes », "Programmes et niveaux", « Curriculum », « Classes », « Inscriptions » ; "Feuilles à relire", « Types d'évaluation » ; « Suivi des appels » ; "Bulletins — liste" ; « Résultats de classe » ; « Règles de calcul » ; « Emplois du temps » ; « Documents », "Documents à échéance" ; « Élèves », « Personnel », « Affectations » ; « Messages », « Annonces » ; « Établissement ».
2. Taper :

| Adresse | Permission manquante | Résultat attendu exact |
|---|---|---|
| `/v2/assessments/new` | `assessment.create` ou `assessment.manage` | R2 (rapport C-09-03) |
| `/v2/reportcards/issue` | `reportcard.generate` | R2 |
| `/v2/finance` | permissions `finance.*` | R2 |
| `/v2/payroll/history` | `payroll.payslip.read` | R2 |
| `/v2/students/new` | `student.create` | R2 |
| `/v2/staff/new` | `staff.create` | R2 |
| `/v2/results/overrides` | `result.override.request` / `result.override.approve` | R2 |

- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le responsable pédagogique

#### 24.5 Secrétariat
Compte : Secrétariat (Collège) · Où : `/v2/students` · Prérequis : MFA.
1. Menu autorisé : « Années et périodes », "Programmes et niveaux", « Curriculum », « Classes », « Inscriptions » ; « Admissions », « Candidatures », « Prospects », « Listes d'attente », "Recrutement : tableaux de bord" ; « Suivi des appels », « Justificatifs d'absence » ; « Conseils de classe » ; « Documents » ; "Facturation", « Encaissements » (lecture) ; "Imports Excel / CSV" ; « Messages », « Annonces » ; « Élèves », « Parents et tuteurs » ; "Bulletins — émission", "Bulletins — liste" ; « Emplois du temps » ; "Élèves affectés", « Créances sur l'État », « États des affectations » ; « Établissement ».
2. Taper :

| Adresse | Permission manquante | Résultat attendu exact |
|---|---|---|
| `/v2/admissions/settings` | `admission.settings.manage` | R2 |
| `/v2/finance/payments/new` | `finance.payment.create` | R2 |
| `/v2/finance/cash` | `finance.cashregister.open` | R2 |
| `/v2/staff/new` | `staff.create` | R2 |
| `/v2/payroll/history` | `payroll.payslip.read` | R2 |
| `/v2/access/roles` | `rbac.role.read` | R2 |
| `/v2/schoollife` | `schoollife.read.all` | R2 |
| `/v2/examinations` | `exam.session.read` | R2 |

3. **Adresse qui n'est pas refusée** : `/v2/finance/refunds` s'ouvre (garde `finance.payment.read`, détenue en lecture) ; le secrétariat voit la liste mais aucune demande ni approbation ne doit être proposée (`finance.payment.refund` absente) : R6 si une action est tentée par l'API. L'ancien guide (5.3) la donnait comme refusée : attendu corrigé.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le secrétariat

#### 24.6 Économe
Compte : Économe (Collège) · Où : `/v2/finance` · Prérequis : MFA.
1. Menu autorisé : "Facturation", « Encaissements », « Caisse », « Frais et barèmes », "Tableau de bord financier", "Paiements en ligne", « Paiements à rapprocher », « Webhooks en échec » (lecture), « Élèves affectés par l'État » ; « Bulletins de paie », « Configuration de la paie », « Historique des paiements », « Rapports de paie », « Masse salariale » ; pilotage « Scolarité », « Trésorerie », « Alertes de direction » ; « Élèves », « Parents et tuteurs », « Personnel » (lecture) ; "Élèves affectés", « Rapprochement des affectations », « Créances sur l'État » ; "Imports Excel / CSV" (préparation) ; « Documents », « Messages », « Annonces ».
2. Taper :

| Adresse | Permission manquante | Résultat attendu exact |
|---|---|---|
| `/v2/students/new` | `student.create` | R2 |
| `/v2/enrollments/new` | `enrollment.create` | R2 |
| `/v2/assessments` | `assessment.read`, `grade.read`, `grade.enter` | R2 |
| `/v2/examinations` | `exam.session.read` | R2 |
| `/v2/payroll/configuration/settings` | `payroll.settings.manage` (propriétaire) | R2 |
| `/v2/finance/providers` | `finance.provider.manage` (direction) | R2 (session 05 : « Accès refusé ») |
| `/v2/access/roles` | `rbac.role.read` | R2 |

- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour l'économe

#### 24.7 Enseignant (Collège)
Compte : Enseignant (Collège) · Où : `/v2/teacher` · Prérequis : aucun (pas de MFA).
1. Menu du portail enseignant : « Aujourd'hui », « Mes classes », « Mes évaluations », « Mes appels », « Mon emploi du temps », « Saisie vie scolaire », « Conseils de classe », « Mes bulletins de paie », « Mes congés et ma présence », « Messages », « Annonces », « Mon profil ».
2. Taper :

| Adresse | Permission manquante | Résultat attendu exact |
|---|---|---|
| `/v2/finance` | permissions `finance.*` | R2 |
| `/v2/payroll` | `payroll.period.manage` / `payroll.payslip.read` | R2 |
| `/v2/admissions` | `admission.read` | R2 |
| `/v2/access/roles` | `rbac.role.read` | R2 |
| `/v2/audit` | `audit.read` | R2 |
| `/v2/settings` | `tenancy.institution.read` | R2 |
| `/v2/students/new` | `student.create` | R2 |
| `/v2/results` | `result.read`, `period.lock`, `period.close` | R2 |

3. `/v2/assessments/revisions` s'ouvre (demande de correction `grade.revise.request`) mais l'approbation est absente. Sur la feuille de notes de l'enseignant, **aucun** bouton « Marquer comme relue », « Approuver » ni « Publier les notes » ne doit apparaître.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour l'enseignant

#### 24.8 Instituteur (CP1 A, École Les Palmiers)
Compte : Instituteur `enseignant@primaire-test.test` (rôle `instituteur`) · Où : `/v2/primary` · Prérequis : aucun.
1. Atterrissage `/v2/primary` ; menu du portail enseignant : « Aujourd'hui », « Mes classes », « Mes évaluations », « Mes appels », « Mon emploi du temps », « Ma classe (primaire) », « Conseil des maîtres », « Mes bulletins de paie », « Mes congés et ma présence », « Messages », « Annonces », « Mon profil ». Dans `/v2/primary` : classe, compétences, appréciations, conseil, bilans (lecture), archives (lecture).
2. Taper :

| Adresse | Permission manquante | Résultat attendu exact |
|---|---|---|
| `/v2/primary/parametres` | `primary.settings.manage` | R2 |
| `/v2/primary/direction` | `primary.report.read` | R2 |
| `/v2/primary/etats` | `primary.report.read` | R2 |
| `/v2/finance` | permissions `finance.*` | R2 |
| `/v2/payroll` | `payroll.payslip.read` / `payroll.period.manage` | R2 |
| `/v2/reportcards/issue` | `reportcard.generate` | R2 |
| `/v2/results` | `result.read`, `period.lock`, `period.close` | R2 |
| `/v2/admissions` | `admission.read` | R2 |

- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour l'instituteur

#### 24.9 Instituteur de maternelle (Grande Section A)
Compte : `instituteur.maternelle@primaire-test.test` (même rôle `instituteur`, titulaire de `GS-A`) · Où : `/v2/primary` · Prérequis : aucun.
1. Mêmes menus et mêmes refus qu'en 24.8 : rejouer au moins `/v2/primary/parametres`, `/v2/primary/direction`, `/v2/finance`, `/v2/payroll`.
2. Résultat attendu : R2 pour chacune. En maternelle il n'y a pas de notes (compétences seulement) : la saisie de notes n'est pas proposée (voir chapitre 8, primaire).
3. La séparation entre les deux classes du primaire (CP1 A et GS-A) est contrôlée en 24.23.
- [ ] Cas nominal  - [ ] Droit refusé pour l'instituteur de maternelle

#### 24.10 Éducateur
Compte : Éducateur (Collège) · Où : `/v2/attendance` · Prérequis : aucun (pas de MFA).
1. Menu : « Années et périodes », « Classes », « Inscriptions », « Suivi des appels », « Justificatifs d'absence », « Emplois du temps », « Élèves », « Parents et tuteurs », « Vie scolaire », « Convocations », « Documents », « Messages », « Annonces », « Mes notifications », « Établissement » (lecture).
2. Taper :

| Adresse | Permission manquante | Résultat attendu exact |
|---|---|---|
| `/v2/schoollife/validations` | `schoollife.measure.validate` (il propose, la direction valide) | R2 |
| `/v2/schoollife/parametres` | `schoollife.settings.manage` | R2 |
| `/v2/finance` | permissions `finance.*` | R2 |
| `/v2/results` | `result.read`, `period.lock`, `period.close` | R2 |
| `/v2/assessments` | `assessment.read`, `grade.read`, `grade.enter` | R2 |
| `/v2/payroll/history` | `payroll.payslip.read` | R2 |
| `/v2/students/new` | `student.create` | R2 |
| `/v2/audit` | `audit.read` | R2 |

- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour l'éducateur

#### 24.11 Responsable des examens
Compte : Responsable des examens (Collège) · Où : `/v2/examinations` · Prérequis : aucun (pas de MFA).
1. Menu : « Examens », "Candidats aux examens", « Centres et salles », « Examens blancs », "Résultats d'examen", « Statistiques d'examen », "Exports d'examen", "Corrections d'examen" ; « Années et périodes », "Programmes et niveaux", « Classes », « Inscriptions », « Élèves » ; "Journal des notifications", « Canaux d'envoi » ; « Documents », « Messages », « Annonces » ; « Établissement ».
2. Taper :

| Adresse | Permission manquante | Résultat attendu exact |
|---|---|---|
| `/v2/finance` | permissions `finance.*` | R2 |
| `/v2/students/new` | `student.create` | R2 |
| `/v2/admissions/settings` | `admission.settings.manage` | R2 |
| `/v2/schoollife` | `schoollife.read.all` | R2 |
| `/v2/assessments/new` | `assessment.create` / `assessment.manage` | R2 |
| `/v2/results/overrides` | `result.override.request` / `result.override.approve` | R2 |

3. `/v2/examinations/corrections` s'ouvre (`exam.result.read`) : il peut **lire** ; demander et approuver une correction exigent `exam.result.revise` (direction) : les boutons ne doivent pas être proposés (chapitre 20, scénario 20.24).
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le responsable des examens

#### 24.12 Chargé d'admissions
Compte : Chargé d'admissions (Collège) · Où : `/v2/admissions` · Prérequis : aucun (pas de MFA).
1. Menu court : « Admissions », « Candidatures », « Prospects », « Listes d'attente », "Recrutement : tableaux de bord", « Admissions » (indicateurs), « Messages », « Annonces », « Établissement ».
2. Taper :

| Adresse | Permission manquante | Résultat attendu exact |
|---|---|---|
| `/v2/finance` | permissions `finance.*` | R2 |
| `/v2/assessments` | `assessment.read`, `grade.read`, `grade.enter` | R2 |
| `/v2/admissions/settings/workflow` | `admission.workflow.manage` | R2 |
| `/v2/admissions/settings` | `admission.settings.manage` | R2 |
| `/v2/students` | `student.list` / `student.class.read` (le dossier élève naît à l'acceptation de l'offre) | R2 |
| `/v2/enrollments` | `enrollment.read` | R2 |
| `/v2/documents` | aucune permission de lecture documentaire | R2 |

- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le chargé d'admissions

#### 24.13 Parent
Compte : Parent `parent@secondaire-test.test` (DIABATE Séka : Nadia et Salimata) · Où : `/v2/parent` · Prérequis : aucun.
1. Menu du portail parent : « Mes enfants », « Vie scolaire », « Décisions du conseil », « Affectation de mon enfant », « Examens de mes enfants », « Messages », « Annonces », « Paramètres du compte » (au collège ; « Bulletin et compétences (primaire) » apparaît à l'école primaire). Dans la fiche d'un enfant : résultats, bulletins, absences, emploi du temps, évaluations à venir, scolarité, documents, urgence.
2. Taper :

| Adresse | Permission manquante | Résultat attendu exact |
|---|---|---|
| `/v2/students` | `student.list` / `student.class.read` | R2 |
| `/v2/finance/invoices` | `finance.invoice.read` (le parent a `finance.child.read`) | R2 |
| `/v2/admissions/applications` | `admission.read` | R2 |
| `/v2/direction` | `analytics.read` | R2 |
| `/v2/teacher` | `staff.own.read` / `schedule.own.read` | R2 |
| `/v2/student` | `student.self.read` | R2 |
| `/v2/payroll/my` | `payroll.payslip.read_own` | R2 |
| `/v2/schedule/generator` | `schedule.read` | R2 |

3. L'isolation entre enfants est dans 24.23.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le parent

#### 24.14 Élève
Compte : Élève `eleve@secondaire-test.test` (DIABATE Nadia) · Où : `/v2/student` · Prérequis : aucun.
1. Menu du portail élève : « Mon dossier », « Mes résultats », « Mes bulletins », « Mon emploi du temps », « Évaluations à venir », « Mes absences », « Ma scolarité », « Mes documents », « Ma vie scolaire », « Décisions du conseil », « Mon examen », « Messages », « Annonces », « Mon profil ».
2. Taper :

| Adresse | Permission manquante | Résultat attendu exact |
|---|---|---|
| `/v2/parent` | `student.child.read` | R2 |
| `/v2/students` | `student.list` / `student.class.read` | R2 |
| `/v2/finance` | permissions `finance.*` de gestion (l'élève a `finance.self.read`) | R2 |
| `/v2/assessments` | `assessment.read`, `grade.read`, `grade.enter` | R2 |
| `/v2/teacher` | `staff.own.read` / `schedule.own.read` | R2 |
| `/v2/attendance` | `attendance.read` | R2 |
| `/v2/finance/invoices` | `finance.invoice.read` | R2 |

- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour l'élève

#### 24.15 Opérateur de la plateforme
Compte : opérateur (voir chapitre 1) · Où : `/v2/platform/login` puis `/v2/platform/tenants` · Prérequis : **aucune session d'établissement** ouverte dans ce navigateur (utiliser un profil dédié).
1. Se connecter à la console ; menu : « Organisations », « Plans et catalogue », « Journal de plateforme ». Le jeton d'opérateur vit dans le navigateur (clé `superAdminToken`) et **n'est pas** une session d'établissement.
2. Taper :

| Adresse | Pourquoi c'est refusé | Résultat attendu exact |
|---|---|---|
| `/v2/students` | pas de session d'établissement (NextAuth) : l'opérateur ne lit pas les données internes | R1 : retour à `/login` |
| `/v2/finance` | idem | R1 |
| `/v2/access/roles` | idem | R1 |
| `/v2/direction` | idem | R1 |

3. Réciproque : sur le jeton d'un utilisateur d'établissement, la console répond R3 (scénario 24.1) et l'API `/api/v1/platform/tenants` répond 401 avec le message "Jeton d'opérateur invalide." (voir 24.22).
- [ ] Cas nominal  - [ ] Droit refusé pour l'opérateur (pas de session d'établissement)

#### 24.16 Visiteur non connecté et pages publiques
Compte : aucun (fenêtre privée neuve) · Où : barre d'adresse · Prérequis : aucune session ouverte.
1. Taper `/v2/finance`, `/v2/students`, `/v2/direction`, `/v2/parent`, `/v2/audit`.
Résultat attendu : R1 pour chacune, retour à `/login` ; aucun contenu entrevu.
2. Taper les pages **volontairement publiques** : `/v2/login`, `/v2/forgot-password`, `/v2/reset-password`, `/v2/verify`, `/v2/notifications/unsubscribe`.
Résultat attendu : elles s'ouvrent sans connexion et ne montrent aucune donnée d'établissement (`/v2/verify/<code>` n'affiche que le statut d'un document et jamais de donnée personnelle, rapports C-12 : « Document authentique »).
- [ ] Cas nominal  - [ ] Droit refusé pour un visiteur

#### 24.17 Écrans sans garde de page et fonctions hors offre
Compte : tout compte ci-dessous · Où : barre d'adresse · Prérequis : aucun.
Ces écrans n'ont **pas** de garde de page par permission : le contrôle réel est l'API (la page s'ouvre, la donnée est refusée).

| Compte | Adresse | Résultat attendu |
|---|---|---|
| Enseignant | `/v2/admin/members` | Le cadre de l'écran s'ouvre, la liste ne se charge pas : message "Action non autorisée." (R6). Aucune ligne de membre. |
| Parent | `/v2/admin/members` | idem (R6) |
| Éducateur | `/v2/admin/members` | idem (R6) |
| Directeur | `/v2/admin/members` | liste des membres (permission `iam.user.read`) |
| Tout compte connecté | `/v2/account/security`, `/v2/account/sessions`, `/v2/account/tenants` | s'ouvrent : chacun gère **son** compte |
| Propriétaire (École primaire) | `/v2/schoollife`, `/v2/councils`, `/v2/stateassign` | garde franchie ; contenu : R7 (fonction du pack Secondaire) |
| Propriétaire (Collège) | `/v2/primary/direction`, `/v2/higher/diplomas` | garde franchie ; contenu : R7 (packs Primaire / Supérieur) |

Cas invalides : un propriétaire qui voit une liste réelle de dossiers de vie scolaire dans l'école primaire = défaut (le module n'appartient pas à son offre).
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé (API) pour un enseignant sur les membres

---

## 24.3 Isolation entre établissements

**Principe.** Trois verrous indépendants : (1) la **session** porte l'établissement (le jeton IAM désigne le tenant ; un en-tête `X-Tenant` ne le remplace jamais quand un jeton valide est présent : `apps/api/src/plugins/tenant-context.ts`) ; (2) les **permissions** sont celles de l'établissement de la session ; (3) la base : chaque table d'un établissement porte `tenant_id` et la sécurité par lignes (RLS) PostgreSQL, **activée et forcée** (`kernel.enable_tenant_rls`), avec le rôle applicatif `app_user` sans `BYPASSRLS` et une seule politique `tenant_isolation`. Sans `app.tenant_id` valide, aucune ligne n'est visible ni insérable (échec fermé).

#### 24.18 Préparer les trois contextes
Compte : Secrétariat de chaque établissement · Où : `http://localhost:3000/login` · Prérequis : trois contextes séparés.
1. Contexte A (Chrome normal) : se connecter en `secretariat@secondaire-test.test`.
2. Contexte B (fenêtre privée) : se connecter en `secretariat@primaire-test.test`.
3. Contexte C (autre navigateur ou autre profil) : se connecter en `secretariat@superieur-test.test`.
4. Dans chaque contexte, ouvrir « Mon compte » > « Sécurité du compte » : vérifier que l'établissement affiché est le bon.
Résultat attendu : trois sessions indépendantes. Ne jamais se reconnecter dans un contexte avec le compte d'un autre établissement (cela remplace la session).
- [ ] Cas nominal

#### 24.19 Les listes ne mélangent pas les établissements
Compte : Secrétariat (trois contextes) · Où : « Élèves » (`/v2/students`), « Classes » (`/v2/academic/classrooms`), "Facturation" (`/v2/finance/invoices`).
1. Dans A, noter le nombre d'élèves, les codes de classe (`6E-A`…) et les montants de scolarité (200 000 F CFA).
2. Dans B, noter les mêmes éléments (`CP1-A` et `GS-A`, scolarité 120 000 F CFA) ; dans C : `L1-A`, 600 000 F CFA.
Résultat attendu : les noms des élèves de la graine sont **identiques** dans les trois établissements (DIABATE Nadia, BAMBA Aya…) mais ce sont des personnes **distinctes** ; aucune classe, aucun montant, aucun filtre d'un autre établissement n'apparaît.
- [ ] Cas nominal  - [ ] Aucune classe d'un autre établissement dans les filtres

#### 24.20 Identifiant technique copié d'un établissement et collé dans l'autre
Compte : Secrétariat (contextes A, B, C), Direction pour certains objets · Où : adresses de détail · Prérequis : 24.18.
1. Dans A, ouvrir une fiche et **copier l'identifiant** (la suite hexadécimale de l'adresse après le dernier `/`). Objets à copier, un par ligne :

| Objet | Adresse de détail dans A | Compte pour la copier | Compte qui colle (B ou C) |
|---|---|---|---|
| Élève | `/v2/students/<id>` | Secrétariat | Secrétariat |
| Tuteur | `/v2/guardians/<id>` | Secrétariat | Secrétariat |
| Inscription | `/v2/enrollments/<id>` | Secrétariat | Secrétariat |
| Facture | `/v2/finance/invoices/<id>` | Économe | Économe |
| Paiement | `/v2/finance/payments/<id>` | Économe | Économe |
| Reçu | `/v2/finance/receipts/<id>` | Économe | Économe |
| Candidature | `/v2/admissions/applications/<id>` | Chargé d'admissions | Chargé d'admissions |
| Bulletin | `/v2/reportcards/<id>` | Secrétariat | Secrétariat |
| Document | `/v2/documents/<id>` | Secrétariat | Secrétariat |
| Classe | `/v2/academic/classrooms/<id>` | Secrétariat | Secrétariat |
| Évaluation | `/v2/assessments/<id>` | Directeur des études | Directeur des études |
| Fiche de personnel | `/v2/staff/<id>` | Directeur | Directeur |
| Bulletin de paie | `/v2/payroll/payslips/<id>` | Économe | Économe |
| Séance de conseil | `/v2/councils/<id>` | Directeur des études | Directeur des études |
| Entrée du journal | `/v2/audit/<id>` | Directeur | Directeur |
| Rôle | `/v2/access/roles/<id>` | Directeur | Directeur |

2. Dans B (puis dans C), taper la **même adresse** avec l'identifiant copié.
Résultat attendu pour chaque ligne : la page s'ouvre sans donnée et affiche un message de type **introuvable** (R5) ; selon l'écran : « Ressource introuvable. », « Cet élément est introuvable ou hors de votre périmètre. », « Élément introuvable », « Cette entrée n'existe pas ou n'appartient pas à votre établissement. » (journal), « Ce rôle n'existe pas dans votre établissement. » (rôle) ou le message de l'API ("Élève introuvable (…)"). **Jamais** « Accès refusé », jamais le nom de l'élève, jamais "cet élève appartient à un autre établissement".
3. Répéter dans le sens inverse (B vers A, C vers A).
4. Dans une fenêtre sans connexion, coller la même adresse : R1 (retour à `/login`).
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Identifiant tronqué (`/v2/parent/children/abc`) | R4 : page 404 (identifiant non valide) |
| Identifiant valide mais inexistant (un UUID aléatoire) | Même réponse R5 que pour l'objet d'un autre établissement (c'est le critère d'isolation : les deux réponses doivent être indiscernables) |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Introuvable (et non refusé) pour les 16 objets

#### 24.21 Accès API avec le mauvais établissement
Compte : Secrétariat A et B · Où : console du navigateur (Outils de développement > Console) sur `http://localhost:3000`, **onglet connecté** · Prérequis : 24.20 (identifiants copiés).
Ne jamais afficher ni recopier le jeton.
1. Dans le contexte A, copier l'identifiant d'un élève du Collège (`<id-A>`). Dans le contexte B (École), exécuter, en remplaçant `<id-A>` :
```js
const r = await fetch('/api/v1/people/students/<id-A>');
console.log(r.status, await r.text());
```
Résultat attendu : statut **404**, corps JSON de la forme `{ "status": 404, "code": "people.student_not_found", "kind": "not_found", "message": "Élève introuvable (<id-A>)." }` : l'identifiant reflété est celui que **vous** avez saisi ; aucune autre information. Jamais 403 ni 200.
2. Même test direct sur l'API (en-tête explicite, sans afficher le jeton) :
```js
const t = localStorage.getItem('ecoledigitale_jwt_token');
const r = await fetch('http://localhost:4000/api/v1/people/students/<id-A>', { headers: { Authorization: 'Bearer ' + t, 'X-Tenant': 'secondaire-test' } });
console.log(r.status, await r.text());
```
Résultat attendu : 404 identique : l'en-tête `X-Tenant: secondaire-test` **ne change pas d'établissement** (le jeton fait foi ; à vérifier en test).
3. Sans jeton : `await fetch('http://localhost:4000/api/v1/people/students/<id-A>', { headers: { 'X-Tenant': 'secondaire-test' } })` : statut **401**.
4. Autres routes à essayer avec un identifiant de l'autre établissement (tous 404) :

| Objet | Requête |
|---|---|
| Facture | `/api/v1/finance/invoices/<id>` |
| Paiement | `/api/v1/finance/payments/<id>` |
| Reçu (PDF) | `/api/v1/finance/receipts/<id>/pdf` |
| Classe | `/api/v1/academic/classrooms/<id>` |
| Évaluation | `/api/v1/assess/assessments/<id>` |
| Personnel | `/api/v1/people/staff/<id>` |
| Tuteur | `/api/v1/people/guardians/<id>` |
| Entrée du journal | `/api/v1/audit/logs/<id>` |

Cas invalides :
| Saisie | Message attendu |
|---|---|
| Identifiant non UUID (`.../students/xyz`) | 400 (validation) ou 404, jamais 500 ni trace |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] 404 (jamais 403 ni 200) pour les 9 routes

#### 24.22 Jeton altéré, jeton d'établissement sur la console plateforme
Compte : Secrétariat · Où : console du navigateur · Prérequis : 24.21.
1. Jeton altéré : modifier le dernier caractère du jeton avant l'envoi.
```js
const t = localStorage.getItem('ecoledigitale_jwt_token');
const bad = t.slice(0, -1) + (t.slice(-1) === 'a' ? 'b' : 'a');
const r = await fetch('http://localhost:4000/api/v1/people/students', { headers: { Authorization: 'Bearer ' + bad } });
console.log(r.status);
```
Résultat attendu : **401** (signature invalide : `JwtError bad_signature`, algorithme et en-tête stricts).
2. Jeton d'établissement sur la console plateforme :
```js
const t = localStorage.getItem('ecoledigitale_jwt_token');
const r = await fetch('http://localhost:4000/api/v1/platform/tenants', { headers: { Authorization: 'Bearer ' + t } });
console.log(r.status, await r.text());
```
Résultat attendu : **401** avec le message "Jeton d'opérateur invalide." (code `platform.operator_token_invalid`) : un jeton d'utilisateur ne vaut jamais jeton d'opérateur.
- [ ] Cas nominal  - [ ] Cas invalide

#### 24.23 Isolation à l'intérieur d'un établissement (famille, classe)
Comptes : Parent, Élève, Enseignant (Collège), Instituteur CP1, Instituteur de maternelle · Où : adresses de détail · Prérequis : identifiants d'élèves copiés par le secrétariat (DIABATE Salimata, BAMBA Aya).
1. **Parent** (DIABATE Séka, Collège) : copier (en secrétariat) l'identifiant de **BAMBA Aya** (autre tuteur) ; en parent, taper `/v2/parent/children/<id>`, puis `/v2/parent/children/<id>/results`, `/finance`, `/reportcards`, `/attendance`.
Résultat attendu : aucune donnée d'Aya (introuvable ou message neutre ; finance famille : toujours la même 404 `finance.not_found`). L'identifiant mal formé donne R4.
2. **Élève** (Nadia) : copier l'identifiant d'un **reçu de sa sœur Salimata** (en économe) ; en élève, taper `/v2/student/finance/receipts/<id>`.
Résultat attendu : « Ressource introuvable. » (rapport C-13 : reçus de Salimata introuvables) ; la fiche de la sœur ne s'ouvre pas non plus (`/v2/students/<id>` donne R2 : l'élève n'a pas `student.list`).
3. **Enseignant** (Collège) : copier l'identifiant d'un élève d'une autre classe que les siennes ; taper `/v2/students/<id>`.
Résultat attendu : la page s'ouvre (permission `student.class.read`) mais la fiche est introuvable ("404 hors périmètre" selon `system-roles.ts`) ; aucune donnée.
4. **Instituteur CP1** (`enseignant@primaire-test.test`) : copier (en secrétariat du primaire) l'identifiant d'un élève de `GS-A` ; taper `/v2/students/<id>` : introuvable. Inverse avec l'instituteur de maternelle et un élève de `CP1-A`.
5. Un parent ne paie ni ne lit pour un enfant qui n'est pas lié : essayer `/v2/finance/me/<id d'un enfant d'un autre tuteur>` : introuvable.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Message "vous n'avez pas accès à cet enfant" | Défaut Majeur (révèle l'existence) |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Parent, élève, enseignant et instituteurs cloisonnés

#### 24.24 Sécurité par lignes PostgreSQL (administrateur de la base, lecture seule)
Compte : personne ayant accès à la base `ecoledigitale_v2` · Où : client SQL · Prérequis : connexion avec le **rôle applicatif** (membre de `app_user`), jamais le compte propriétaire de la base ni un super-utilisateur (un super-utilisateur ignore la RLS). Ne rien écrire.
1. Relever les identifiants de deux établissements : `SELECT id, slug FROM kernel.tenants;` (rôle d'administration).
2. Avec le rôle applicatif :
```sql
BEGIN;
SELECT set_config('app.tenant_id', '<uuid du tenant A>', true);
SELECT count(*) FROM academic.classrooms;
SELECT count(*) FROM academic.classrooms WHERE tenant_id <> '<uuid du tenant A>'::uuid;
SELECT set_config('app.tenant_id', '', true);
SELECT count(*) FROM academic.classrooms;
ROLLBACK;
```
Résultat attendu : le premier `count` donne les classes de A seulement ; le deuxième donne **0** ; le troisième (sans tenant) donne **0** (échec fermé). Répéter sur `academic.enrollments` et `finance.fees`.
3. Contrôle automatique (équipe technique, **instance jetable uniquement**, jamais la base de démonstration) : `pnpm test:isolation` (`scripts/db/test-isolation.mjs`) vérifie que chaque table de chaque schéma a RLS activée et forcée.
- [ ] Cas nominal (administrateur)  - [ ] Résultat de `pnpm test:isolation` joint au rapport

---

## 24.4 Séparation des tâches (« quatre yeux »)

Deux familles de garde-fous :

**A. Exigence de personne** (la même personne ne peut pas faire les deux gestes) : le serveur compare l'utilisateur authentifié au demandeur / proposant / enregistreur. Le propriétaire et le directeur détiennent les deux côtés des permissions : c'est cette règle qui les empêche de se valider eux-mêmes. Pour jouer les tests, utiliser **deux personnes**, par exemple le **propriétaire** et le **directeur** (fenêtres séparées).

| # | Geste demandé → geste à approuver | Comptes pour le test | Condition (défaut) | Message de refus exact (API) | Indice à l'écran | Code HTTP | Source |
|---|---|---|---|---|---|---|---|
| 1 | Demande de remboursement (économe) → approbation | économe demande ; directeur ou propriétaire approuve ; refus : le même compte approuve | Toujours (`refundSelfApproval` à `false`) | "Le demandeur ne peut pas approuver son propre remboursement." (`finance.refund_self_approval`) | « Règle des quatre yeux : la personne qui demande un remboursement ne peut pas l'approuver. » | 409 | `finance/domain/refund.ts` |
| 2 | Calcul d'un bulletin de paie → arrêt | calcul par l'économe ou le directeur ; arrêt par une autre personne | **Réglage** « Séparation des tâches » (propriétaire, **décoché par défaut**) | "Séparation des tâches : celui qui a calculé le bulletin ne peut pas l'arrêter." (`payroll.separation_of_duties`) | « Séparation des tâches : faites arrêter ce bulletin par une autre personne que celle qui l'a calculé. » | 409 | `payroll/application/workflow.ts` |
| 3 | Bulletin au-delà du seuil → arrêt | seul le propriétaire arrête | Réglage « Seuil de validation par le propriétaire » (vide par défaut) | "Ce montant dépasse le seuil : seul le propriétaire peut arrêter ce bulletin." (`payroll.owner_approval_required`) | "Montant au-dessus du seuil : seul le propriétaire peut l'arrêter, depuis « Masse salariale  ». " | 409 | idem |
| 4 | Feuille de notes soumise → relue / approuvée / publiée | l'auteur de la soumission ne fait aucune des trois étapes | Réglages « Le relecteur doit être une autre personne que le saisissant » et « L'approbateur doit être une autre personne que le relecteur » (**cochés par défaut**) | "La personne qui a soumis la feuille ne peut pas la relire, l'approuver ni la publier." (`assess.four_eyes`) | message affiché sous la barre d'état | 409 | `assess/domain/workflow.ts` |
| 5 | Demande de correction d'une note publiée → approbation | demandeur ≠ approbateur | Réglage "L'approbateur doit être une autre personne…" (coché par défaut) | "Le demandeur d'une correction ne peut pas l'approuver lui-même." (`assess.four_eyes`) | — | 409 | idem |
| 6 | Demande de surcharge d'un résultat → approbation | directeur des études (demande) → direction (approuve) ; même compte refusé | Réglage des résultats (`requireSeparateApprover`, **vrai par défaut**) | "Le demandeur d'une surcharge ne peut pas l'approuver lui-même." (`results.four_eyes`) | « La demande devra être approuvée par une autre personne que vous. » | 409 | `results/application/governance.ts` |
| 7 | Demande de déverrouillage d'un conseil de classe → approbation | directeur des études demande ; direction approuve | Réglage « Le déverrouillage doit être approuvé par une autre personne » (**vrai par défaut**) | "L'approbation doit venir d'une autre personne que le demandeur (séparation des tâches)." (`councils.four_eyes_required`) | — | 403 | `councils/application/unlock.ts` |
| 8 | Correction d'une note ou d'un résultat d'examen publié → approbation | direction (propriétaire ↔ directeur) | Toujours | "Une révision est approuvée par une autre personne que celle qui l'a demandée." ; au rejet : "Une demande est décidée par une autre personne que celle qui l'a faite." | « Vous ne pouvez pas approuver votre propre demande. » | 403 | `examinations/application/revisions.ts` |
| 9 | Mesure de vie scolaire proposée → validée | proposant ≠ validateur pour les types « quatre yeux » (ex. « Exclusion temporaire (démonstration) ») | Case « Séparation des tâches (quatre yeux) » du type | "La validation doit venir d'une autre personne que le proposant (séparation des tâches)." (`schoollife.four_eyes_required`) | « Le validateur doit être une autre personne que vous. » | 403 | `schoollife/application/measures.ts` |
| 10 | Dossier d'élève affecté par l'État enregistré → vérifié | secrétariat enregistre ; direction vérifie | Réglage « Exiger une autre personne pour la vérification » (**vrai par défaut**) | "La vérification doit venir d'une autre personne que celle qui a enregistré le dossier." (`stateassign.four_eyes_required`) | « Vous ne pouvez pas vérifier un dossier que vous avez vous-même enregistré (sauf réglage de l'établissement). » | 403 | `stateassign/application/assignments.ts` |
| 11 | Séance comptable créée → validée pour la paie | créée par la direction (`schedule.accounting.create`) ; validée par une autre personne (directeur des études) | Toujours | "Validation "à quatre yeux" : celui qui a saisi une séance comptable ne peut pas la valider." | — | 403 | `scheduling/domain/errors.ts` |
| 12 | Version nationale d'un jeu de règles → approbation | opérateur de la plateforme seulement | Réglage de plateforme `nationalFourEyes` (vrai par défaut) | "L'auteur d'une version nationale ne peut pas l'approuver (séparation des tâches)." | — | 409 | `rules/application/transitions.ts` |

Quand le réglage est relâché (cases 4, 5, 6, 7 ; 10), l'acte est **autorisé mais la dérogation est inscrite** sur l'objet (`fourEyesWaived`) et auditée en avertissement : par exemple « Cette évaluation a été validée sans séparation des tâches (réglage de l'établissement). »

**À ne pas confondre.** La **résolution manuelle d'un paiement en ligne en attente** (`/v2/finance/payments/pending`) n'est **pas** à quatre yeux : une seule personne habilitée tranche, avec motif, preuve et MFA récente ("Une seule personne habilitée tranche. Chaque résolution exige une vérification MFA récente…"). L'ancien guide la citait parmi les quatre yeux : attendu corrigé. De même, l'octroi d'une dispense d'UE (`higher.exemption.grant`) n'exige aucune seconde personne (réservé à la direction).

**B. Incompatibilité de rôles** (aucun rôle autre que propriétaire et directeur ne détient les deux côtés ; testée dans `system-roles.test.ts`).

| Un côté | Autre côté | Qui détient quoi |
|---|---|---|
| Saisie d'une note (`grade.enter`) | Relecture / validation / publication | Enseignant et instituteur saisissent ; responsable pédagogique relit et valide (`grade.review`, `grade.validate`) ; directeur des études valide et publie (`grade.publish`, `grade.revise.approve`) |
| Demande de correction (`grade.revise.request`) | Approbation (`grade.revise.approve`) | Enseignant / instituteur demandent ; directeur des études approuve |
| Demande de surcharge | Approbation | Directeur des études demande ; direction approuve (`result.override.approve`) |
| Calcul de paie (`payroll.run.calculate`) | Arrêt (`payroll.payslip.approve`) et validation propriétaire | Économe calcule et verse ; direction arrête ; propriétaire seul au-delà du seuil |
| Émission d'un bulletin (`reportcard.generate`) | Révocation (`reportcard.revoke`) | Secrétariat et directeur des études émettent ; direction révoque |
| Dépôt d'un justificatif (`attendance.justification.submit`) | Décision (`attendance.justification.decide`) | Éducateur, secrétariat déposent ; directeur des études décide |
| Appel (`attendance.take`) | Réouverture (`attendance.session.reopen`) | Enseignant et éducateur font l'appel ; direction rouvre |
| Constatation d'une séance (`schedule.occurrence.hold`, éducateur) | Validation pour la paie (`schedule.occurrence.validate`, directeur des études) | puis calcul de paie (économe) |
| Traitement d'une candidature (secrétariat, chargé d'admissions) | Décision (`admission.decide`) | Direction seulement |
| Proposition d'une mesure (éducateur) | Validation (`schoollife.measure.validate`) | Direction seulement |
| Enregistrement d'une affectation d'État (secrétariat) | Vérification (`stateassign.verify`) | Direction seulement |
| Saisie des résultats d'examen (responsable des examens) | Publication (directeur des études, `exam.result.publish`), application d'un lot et révision (direction) | trois niveaux |
| Préparation d'un import (économe : `imports.create`) | Lancement d'un import, soldes d'ouverture (`imports.import.*`, MFA) | Direction |

Pour chaque scénario ci-dessous : **Résultat attendu** = le message de la colonne "Message de refus exact" et, à l'écran, l'indice de la colonne suivante ; l'objet ne change pas d'état.

#### 24.25 Remboursement (quatre yeux)
Comptes : Économe, Directeur · Où : fiche d'un paiement (`/v2/finance/payments/<id>`) puis « Remboursements » (`/v2/finance/refunds`) · Prérequis : un paiement remboursable (chapitre 12) ; MFA.
1. Économe : sur la fiche d'un paiement, demander un remboursement (chapitre 12) : message « La demande de remboursement a été enregistrée ; une autre personne doit l'approuver. ».
2. Même économe : `/v2/finance/refunds`, cliquer « Approuver » sur sa propre demande, confirmer.
Résultat attendu : refus "Le demandeur ne peut pas approuver son propre remboursement." ; la demande reste en attente.
3. Directeur : « Approuver » la même demande : « Le remboursement est approuvé. » (ou "…approuvé et exécuté.").
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Secrétariat ouvre `/v2/finance/refunds` et tente d'approuver (API) | R6 "Action non autorisée." (pas de `finance.payment.refund`) |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : le secrétariat ne voit aucune action

#### 24.26 Paie (quatre yeux et seuil propriétaire)
Comptes : Propriétaire, Directeur, Économe · Où : `/v2/payroll/configuration/settings` puis la période · Prérequis : chapitre 13 (scénarios 13.9 et 13.14) ; réglage « Séparation des tâches » **coché** par le propriétaire.
1. Rejouer le scénario 13.14 : le directeur calcule puis tente d'arrêter.
Résultat attendu : "Séparation des tâches : celui qui a calculé le bulletin ne peut pas l'arrêter." puis l'indice « Séparation des tâches : faites arrêter ce bulletin par une autre personne que celle qui l'a calculé. » ; bulletin « Calculé ».
2. Abaisser le seuil propriétaire (scénario 13.16) : le directeur tente d'arrêter un bulletin au-dessus du seuil.
Résultat attendu : "Montant au-dessus du seuil : seul le propriétaire peut l'arrêter, depuis « Masse salariale  ». ".
3. Contrôle de rôle : l'économe n'a ni « Arrêter le montant » ni « Valider ».
4. Remettre le réglage « Séparation des tâches » à son état d'origine (décoché) à la fin.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour l'économe

#### 24.27 Notes : celui qui soumet ne relit pas, n'approuve pas, ne publie pas
Compte : Directeur (soumetteur de test), puis Responsable pédagogique · Où : chapitre 8, scénarios 8.14 et 8.12 · Prérequis : MFA.
1. Rejouer 8.14 : le directeur soumet la feuille "Contrôle direction test guide" et clique « Marquer comme relue ».
Résultat attendu : "La personne qui a soumis la feuille ne peut pas la relire, l'approuver ni la publier." ; l'état reste « Soumise ». Même refus à « Approuver » et à « Publier les notes ».
2. Rôle : l'enseignant n'a aucun de ces trois boutons ; le responsable pédagogique n'a pas « Publier les notes » (publication au directeur des études ou à la direction).
- [ ] Cas nominal  - [ ] Droit refusé : aucun bouton de validation chez l'enseignant

#### 24.28 Correction d'une note publiée : le demandeur n'approuve pas
Comptes : Enseignant (demande), Directeur des études (approbation) · Où : `/v2/assessments/revisions` · Prérequis : chapitre 8, scénario 8.15.
1. L'enseignant demande la correction (« Envoyer la demande »). L'enseignant ne voit pas « Approuver ».
2. Directeur (qui détient `grade.revise.approve`) : demander lui-même une correction puis cliquer « Approuver » sur sa propre demande.
Résultat attendu : "Le demandeur d'une correction ne peut pas l'approuver lui-même." (réglage coché par défaut).
3. Le directeur des études approuve la demande de l'enseignant : « Correction approuvée et appliquée. ».
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour l'enseignant

#### 24.29 Surcharge de résultat : le demandeur n'approuve pas
Comptes : Directeur des études (demande), Directeur ou Propriétaire (approbation) · Où : `/v2/results/overrides` · Prérequis : chapitre 9 (résultats), période non clôturée.
1. Directeur des études : créer la demande ; lire « La demande de surcharge est enregistrée ; elle doit être approuvée par une autre personne. ». Il n'a pas le bouton « Approuver » (permission `result.override.approve` absente).
2. Directeur : demander lui-même une surcharge puis « Approuver » sa propre demande.
Résultat attendu : "Le demandeur d'une surcharge ne peut pas l'approuver lui-même."
3. Propriétaire : « Approuver » la demande du directeur : « La surcharge est approuvée. ».
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le directeur des études

#### 24.30 Conseil de classe : déverrouillage
Comptes : Directeur des études (demande), Directeur ou Propriétaire (approbation) · Où : `/v2/councils/<id>` (séance close) · Prérequis : chapitre 19 (conseils de classe), séance close.
1. Directeur des études : « Demander le déverrouillage », motif, « Envoyer la demande » : « Demande de déverrouillage envoyée. ».
2. Même compte (ou direction qui a demandé) : « Approuver » sa propre demande.
Résultat attendu : "L'approbation doit venir d'une autre personne que le demandeur (séparation des tâches)." (le directeur des études n'a de toute façon pas `council.unlock.approve`).
3. Autre membre de la direction : « Approuver » : « Demande approuvée. ».
- [ ] Cas nominal  - [ ] Cas invalide

#### 24.31 Examens : correction approuvée par une autre personne
Comptes : Directeur, Propriétaire · Où : chapitre 20, scénario 20.24.
1. Rejouer 20.24 : le directeur demande, puis clique « Approuver » (refus "Une révision est approuvée par une autre personne que celle qui l'a demandée.") puis « Rejeter » (refus "Une demande est décidée par une autre personne que celle qui l'a faite.").
2. Le propriétaire approuve.
3. Le responsable des examens ne voit pas « Approuver » (R2/R6 : pas de `exam.result.revise`).
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le responsable des examens

#### 24.32 Vie scolaire : le proposant ne valide pas
Compte : Éducateur (proposition), Directeur (tentative), Propriétaire (validation) · Où : chapitre 19, scénarios 19.8 et 19.11.
1. Éducateur : proposer l'exclusion (19.8). Il n'a ni « Mesures à valider » (`/v2/schoollife/validations` : R2) ni « Valider ».
2. Directeur : rejouer 19.11 (il propose puis valide sa propre proposition « Exclusion temporaire (démonstration) »).
Résultat attendu : fenêtre ouverte avec l'erreur "La validation doit venir d'une autre personne que le proposant (séparation des tâches)." ; la mesure reste « Proposée ».
3. Propriétaire : valide : succès.
Cas invalides : un avertissement sans case « quatre yeux » (« Avertissement (démonstration) ») peut être validé par son proposant s'il détient `schoollife.measure.validate` (la séparation dépend du **type**).
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour l'éducateur

#### 24.33 Affectation d'État : l'enregistreur ne vérifie pas
Comptes : Secrétariat (enregistre), Directeur (vérifie) · Où : `/v2/stateassign` (liste), `/v2/stateassign/verification` · Prérequis : chapitre 19 (élèves affectés par l'État), dossier « Enregistré ».
1. Secrétariat : enregistrer un dossier (chapitre 19). Le secrétariat ne peut pas ouvrir `/v2/stateassign/verification` (R2).
2. Si le même compte détient la permission de vérification (propriétaire ou directeur ayant enregistré), tenter « Vérifier » sur son propre dossier.
Résultat attendu : "La vérification doit venir d'une autre personne que celle qui a enregistré le dossier." Un autre membre de la direction peut vérifier.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le secrétariat

#### 24.34 Séance comptable : le créateur ne la valide pas
Comptes : Directeur (création), Directeur des études (validation) · Où : `/v2/schedule/occurrences` · Prérequis : chapitre 7 (emploi du temps, séances comptables) ; MFA.
1. Directeur : créer une séance comptable (heures déclarées sans plage réelle, passées de moins de 24 h).
2. Même directeur : valider cette séance.
Résultat attendu : "Validation "à quatre yeux" : celui qui a saisi une séance comptable ne peut pas la valider." (ligne refusée avec le motif `SELF_VALIDATION`).
3. Directeur des études : valider : succès.
- [ ] Cas nominal  - [ ] Cas invalide

#### 24.35 Garde-fous de gestion des rôles (anti-escalade, dernier propriétaire)
Compte : Directeur · Où : `/v2/access/assignments` · Prérequis : MFA ; **aucune écriture n'est attendue** (tous les essais doivent être refusés).
1. Tenter d'attribuer le rôle « Propriétaire » à un membre.
Résultat attendu : refus "Action refusée : vous ne pouvez accorder que des permissions que vous détenez vous-même sur ce périmètre. Permissions qui vous manquent : …" (le directeur ne détient pas `entitlements.manage`).
2. Tenter de révoquer l'attribution du seul propriétaire.
Résultat attendu : refus, soit l'anti-escalade ci-dessus, soit « Action refusée : l'établissement doit toujours conserver au moins un propriétaire. » (message exact à relever). Si l'action réussit, c'est un défaut **Bloquant** : prévenir immédiatement.
3. Tenter de modifier un rôle système : « Ce rôle système est verrouillé. Clonez-le pour créer une variante modifiable. ».
- [ ] Cas nominal  - [ ] Cas invalide

---

## 24.5 Authentification : MFA, sessions, verrouillage, jetons à usage unique

**Obligation de la MFA par rôle.**

| Rôle | MFA dans la démonstration | Obligation | Permissions sensibles détenues (exigent une session MFA à l'usage) |
|---|---|---|---|
| Propriétaire | oui | **Imposée à la connexion** par la politique (liste par défaut : `owner`, `admin`, `director`, `bursar`, `accountant`, `super_admin`) ; ne peut pas être désactivée | toutes |
| Directeur | oui | recommandée ; exigée à l'usage de chaque permission sensible | rôles (attribution), finance (remboursement, rapprochement, rejeu), paie, bulletins, résultats, périodes, vie scolaire, élèves (statut, export, anonymisation), imports d'ouverture, documents confidentiels… |
| Directeur des études | oui | idem | publication et validation des notes, clôture de période, conseils (séance, procès-verbal), bulletins (émission, publication), supérieur (diplômes, documents), validation des séances pour la paie… |
| Responsable pédagogique | oui | idem | `grade.validate` |
| Secrétariat | oui | idem | statut d'un élève, lecture des champs sensibles, export d'élèves, émission de bulletins, signature de procès-verbaux, attestations |
| Économe | oui | idem | remboursement, financement d'inscription, configurations et tarifs de paie, calcul, ajustement, versement, lecture des bulletins de paie |
| Enseignant, instituteur, éducateur, responsable des examens, chargé d'admissions, parent, élève | non | aucune permission sensible : aucun code demandé | aucune |

La politique de connexion n'impose par défaut que `owner` ; pour les autres rôles de gestion, c'est le **garde** (`requirePermission`) qui refuse un acte sensible sans MFA (`rbac.mfa_required`) ; les comptes de la démonstration sont déjà enrôlés. La liste est réglable par l'exploitation (`IAM_MFA_REQUIRED_ROLES`).

Valeurs de référence : jeton d'accès 15 min (renouvelé automatiquement), jeton de renouvellement 14 jours d'inactivité, session au plus 30 jours ; défi MFA valable 5 min, 5 essais par défi ; 10 codes de secours à usage unique ; mot de passe de 12 caractères au moins ; lien de réinitialisation 30 min, invitation 7 jours ; verrou de connexion 1 min après 5 échecs en 15 min (doublé à chaque verrou, 1 h au plus) ; élévation MFA ("step-up") 5 min.

#### 24.36 MFA à la connexion : faux code, bon code
Compte : Économe (Collège) · Où : `/login` · Prérequis : compte MFA.
1. Cliquer sur le compte dans le panneau de droite, valider : l'écran « Vérification en deux étapes » demande « Saisissez le code à 6 chiffres de votre application d'authentification. ».
2. Saisir `000000`.
Résultat attendu : "Code invalide. Vérifiez l'heure de votre téléphone et réessayez." (ou, selon l'écran, "Code invalide. Vérifiez l'heure de votre téléphone.") ; on reste sur l'écran du code.
3. Saisir le code du moment proposé : connexion réussie.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Code de 5 chiffres | Le bouton reste inactif tant que les 6 chiffres ne sont pas saisis |
| Cinq faux codes de suite | "La vérification a expiré. Reconnectez-vous." (défi épuisé) ou "Trop de tentatives. Réessayez dans 1 minute." (verrou MFA par identité) : l'un ou l'autre |
- [ ] Cas nominal  - [ ] Cas invalide

#### 24.37 Rejeu d'un code TOTP
Compte : Directeur · Où : `/login` (deux connexions successives) · Prérequis : compte MFA ; ne pas verrouiller le compte.
1. Se connecter avec le code du moment (réussi). Se déconnecter (« Mon compte » > « Se déconnecter »).
2. Se reconnecter immédiatement en saisissant **le même code**.
Résultat attendu : refus "Code invalide. Vérifiez l'heure de votre téléphone et réessayez." : le pas de temps déjà utilisé est consommé (`mfa_last_step`) ; un code d'un pas antérieur est refusé aussi.
3. Attendre le code suivant (30 s) : connexion réussie.
- [ ] Cas nominal  - [ ] Cas invalide

#### 24.38 Codes de secours
Compte : compte de test **créé pour ce scénario** (voir "À vérifier en test") · Où : `/login`, écran du code · Prérequis : les 10 codes de secours ont été notés lors de l'enrôlement (« Conservez vos codes de secours : ils ne seront plus affichés. »).
1. Sur l'écran du code, cliquer « Utiliser un code de secours » ; saisir un code ; connexion réussie.
2. Se reconnecter et saisir **le même code de secours**.
Résultat attendu : "Code de secours invalide." (usage unique). Les comptes de la démonstration n'exposent pas leurs codes de secours : ne pas jouer ce scénario sur eux.
- [ ] Cas nominal  - [ ] Cas invalide

#### 24.39 Acte sensible sans session MFA
Compte : compte de gestion **sans MFA enrôlée** (créé pour le test, voir "À vérifier en test") · Où : une action sensible, par exemple `/v2/payroll/payslips` pour l'économe ou `/v2/audit` (export) pour le directeur · Prérequis : aucun compte de la démonstration ne convient (tous les comptes sensibles sont enrôlés).
1. Se connecter sans second facteur ; ouvrir une page dont la garde est une permission sensible (`payroll.payslip.read`).
Résultat attendu : R2 (`/unauthorized`) : les permissions sensibles sont absentes de `GET /api/v1/rbac/me/permissions` (listées dans `requiresMfa`) tant que la session n'est pas MFA.
2. Tenter l'action par l'API : réponse 403, code `rbac.mfa_required`, « Cette action sensible exige une authentification à deux facteurs (MFA). Activez-la sur votre compte puis reconnectez-vous. ».
3. Fenêtre « Confirmez votre identité » (« Cette action est sensible. Saisissez le code à 6 chiffres affiché par votre application d'authentification pour continuer. ») : sans MFA activée, « La vérification en deux étapes n'est pas activée sur votre compte. Activez-la depuis la page Sécurité, puis reconnectez-vous. »
- [ ] Cas nominal  - [ ] Cas invalide

#### 24.40 Désactivation de la MFA là où elle est imposée
Compte : Propriétaire · Où : « Mon compte » > « Sécurité du compte » (`/v2/account/security`) · Prérequis : MFA ; mot de passe du compte (fourni par l'équipe technique, jamais recopié).
1. Section « Vérification en deux étapes » : l'état dit « Activée : un code de votre application d'authentification est demandé à chaque connexion. ».
2. Cliquer « Désactiver… », saisir le mot de passe et le code, cliquer « Désactiver la vérification ».
Résultat attendu : refus "Votre rôle exige la vérification en deux étapes : elle ne peut pas être désactivée." La MFA reste active.
**Ne jamais aller au bout sur un autre compte de la démonstration** (le directeur, l'économe… peuvent la désactiver ; la ré-enrôler change le secret et casse le code proposé sur `/login`).
- [ ] Cas nominal  - [ ] Cas invalide

#### 24.41 Sessions : révocation depuis un autre appareil
Compte : Enseignant (Collège) · Où : « Mon compte » > « Mes sessions » (`/v2/account/sessions`) · Prérequis : deux contextes (A, normal ; B, autre navigateur).
1. Se connecter avec le même compte dans A et dans B.
2. Dans A, ouvrir « Mes sessions » : deux lignes (« Cet appareil » sur la courante, appareil, adresse, "rôle …", "Connecté le … · actif le …").
3. Dans A, cliquer « Révoquer » sur la session de B : "Session révoquée."
4. Dans B, recharger ou cliquer sur un lien.
Résultat attendu : B est renvoyé à `/login` (message "Votre session a pris fin. Reconnectez-vous." si l'adresse porte `expired=1`, sinon un appel API répond « Votre session a expiré. Veuillez vous reconnecter. »). A reste connecté. La révocation est **immédiate** (le verdict de session est invalidé via Redis, sans délai de grâce).
- [ ] Cas nominal  - [ ] Cas invalide

#### 24.42 Déconnexion de tous les appareils ; retour arrière du navigateur
Compte : Enseignant (Collège) · Où : `/v2/account/sessions`.
1. Avec deux sessions ouvertes (A et B), dans A cliquer « Déconnecter tous mes appareils ».
Résultat attendu : A et B sont déconnectés ; retour à `/login`.
2. Dans A, bouton « Précédent » du navigateur : aucune page privée ne réapparaît avec des données (à vérifier en test).
3. Se déconnecter simplement (« Mon compte » > « Se déconnecter ») puis taper `/v2/teacher` : R1.
- [ ] Cas nominal  - [ ] Cas invalide

#### 24.43 Expiration de session
Compte : n'importe quel compte · Où : navigation normale.
La durée d'un jeton d'accès (15 min) est renouvelée automatiquement tant que la session vit ; la session meurt après 14 jours d'inactivité ou 30 jours au total. Ce n'est **pas testable à la main en quelques minutes** : le test manuel équivalent est 24.41. Avec l'équipe technique (variables `IAM_ACCESS_TTL_SEC`, `IAM_REFRESH_IDLE_TTL_SEC`, bornes basses 60 s / 300 s), vérifier qu'une session expirée renvoie à `/login` avec « Votre session a pris fin. Reconnectez-vous. ».
- [ ] Cas nominal (avec l'équipe technique)

#### 24.44 Verrouillage après des essais de connexion échoués
Compte : Élève de l'École (`eleve@primaire-test.test`, sans MFA, peu sensible) · Où : `/login` · Prérequis : aucune autre session de ce compte à préserver.
1. Saisir l'e-mail à la main, puis un mot de passe volontairement faux ("Mauvais-mot-de-passe-test-guide"), 5 fois de suite (moins de 15 minutes).
Résultat attendu : à chaque essai "Identifiants invalides. Vérifiez votre e-mail et votre mot de passe." (même message pour un e-mail inexistant : pas d'énumération) ; la durée de réponse ne varie pas (plancher de 600 ms).
2. Au 6e essai, **avec le bon mot de passe** (clic sur le compte dans le panneau).
Résultat attendu : "Trop de tentatives. Réessayez dans 1 minute." (statut 429, en-tête `Retry-After`) : le verrou prime sur le mot de passe correct.
3. Attendre 1 minute puis se reconnecter : succès (la durée de verrou double si le niveau est déjà atteint, jusqu'à 1 h).
- [ ] Cas nominal  - [ ] Cas invalide

#### 24.45 Mot de passe oublié : réponse neutre
Compte : aucun · Où : `/v2/forgot-password` · Prérequis : aucun.
1. Saisir un e-mail existant (`eleve@primaire-test.test`) puis valider.
2. Saisir un e-mail inexistant (`inconnu@exemple.test`) puis valider.
Résultat attendu : **même** message dans les deux cas : "Si un compte existe pour cette adresse, un e-mail vient d'être envoyé. Pensez à vérifier vos courriers indésirables." (aucun indice sur l'existence du compte). L'environnement n'envoie aucun e-mail réel.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Plus de 3 demandes en 1 heure pour la même adresse | message neutre ou « Trop de requêtes. Réessayez dans un instant. » (à relever) |
- [ ] Cas nominal  - [ ] Cas invalide

#### 24.46 Jetons d'invitation et de réinitialisation à usage unique
Compte : aucun · Où : `/auth/reset-password`, `/auth/invitation` · Prérequis : aucun (sans lien réel).
1. Ouvrir `/auth/reset-password` **sans** `?token=`.
Résultat attendu : "Ce lien est incomplet ou n'est plus valable." avec le lien "Demander un nouveau lien".
2. Ouvrir `/auth/reset-password?token=faux-jeton-test-guide-0123456789`, saisir un nouveau mot de passe respectant la politique (12 caractères) deux fois, « Enregistrer ».
Résultat attendu : "Ce lien n'est plus valable. Demandez-en un nouveau."
3. Avec un lien réel fourni par l'équipe technique (l'environnement n'envoie pas d'e-mail ; jamais recopié dans un rapport) : premier usage accepté (« Mot de passe enregistré. Vous pouvez vous connecter. »), **deuxième usage** du même lien refusé avec le même message ; passé 30 minutes (invitation : 7 jours) refusé ; après un changement de mot de passe, les autres appareils sont déconnectés.
- [ ] Cas nominal  - [ ] Cas invalide

#### 24.47 Politique de mot de passe
Compte : compte de test dédié · Où : `/auth/invitation` avec un lien d'invitation fourni, ou « Sécurité du compte » · Prérequis : un compte jetable (ne jamais changer le mot de passe d'un compte de l'annexe).
| Saisie | Message attendu |
|---|---|
| `court1` | "Le mot de passe doit contenir au moins 12 caractères." |
| Un mot de passe courant (liste intégrée) | "Ce mot de passe est trop courant. Choisissez une phrase de passe plus originale." |
| L'adresse e-mail du compte | "Le mot de passe ne doit pas être votre adresse e-mail." |
| `aaaaaaaaaaaaaaaa` | "Le mot de passe est trop répétitif." |
| `abcdefghijklmnop` | "Le mot de passe ne doit pas être une suite de caractères consécutifs." |
| Confirmation différente | "Les mots de passe ne correspondent pas." (bouton inactif) |
- [ ] Cas invalide

---

## 24.6 Journal d'audit

**Quels actes sont tracés.** Chaque module écrit dans le journal, dans la même transaction que l'acte (pas d'audit, pas d'acte) ; les événements d'identité arrivent par le worker (quelques secondes de délai). Actions typiques (préfixes à saisir dans le filtre « Action ») : `login.failed` (échec de connexion, acteur « Système »), `session.revoked`, `role.changed`, `assignment.changed`, `mfa.*`, `password.*`, `membership.*`, `tenant.*`, `override.set`, `impersonation.started` (gravité Critique), `finance.refund.*`, `finance.provider.*`, `finance.webhook.replayed`, `payroll.payslip.approved`, `payroll.settings.updated`, `grade.published`, `assess.revision.*`, `reportcard.*`, `higher.award.revoked`, `people.student.sensitive_read`, `people.student.exported`, `people.staff_contract.read`, `documents.document.downloaded`, `documents.quarantine.released`, `admissions.exam_result.read_average`, `analytics.payroll.read`, `audit_log.exported`. **Non tracés** : une connexion réussie (aucun abonnement `iam.user.logged_in`), et les simples consultations de listes.

**Chaîne d'intégrité.** Chaque entrée porte un numéro de séquence sans trou, l'empreinte de la précédente et sa propre empreinte SHA-256 (HMAC si une clé est configurée). L'application ne peut ni modifier, ni supprimer, ni tronquer le journal (droits + déclencheurs) ; l'écran n'a que des commandes de lecture, de vérification et d'export. Lecture réservée à `audit.read` (propriétaire et directeur uniquement), export à `audit.export` (sensible : MFA).

#### 24.48 Les actes de ce chapitre sont tracés
Compte : Directeur · Où : « Journal d'audit » (`/v2/audit`) · Prérequis : avoir joué 24.41 (révocation) et 24.44 (échecs de connexion) il y a au moins une minute.
1. Filtrer « Action » = `login.failed`.
Résultat attendu : les échecs de 24.44 apparaissent (acteur « Système » : l'auteur n'est pas authentifié ; gravité « Notable » ou « Avertissement » quand le compte a été verrouillé ; identifiant et cause dans les métadonnées).
2. Filtrer `session.revoked` : la révocation de 24.41 apparaît, avec l'acteur.
3. Ouvrir une ligne (« Voir le détail », `/v2/audit/<id>`) : « Informations générales » (« Numéro de séquence », « Empreinte », « Empreinte précédente », « Algorithme », « Adresse IP », « Requête »).
4. Filtrer par préfixe (`finance.*`) après avoir joué 24.25 : `finance.refund.requested` et `finance.refund.approved` portent le demandeur et l'approbateur distincts.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Fin de période avant le début | « La fin de période doit suivre le début. » (message de l'écran, rapport C-02) |
- [ ] Cas nominal  - [ ] Cas invalide

#### 24.49 Vérifier la chaîne
Compte : Directeur ou Propriétaire · Où : `/v2/audit`, panneau « Intégrité de la chaîne ».
1. Cliquer « Vérifier la chaîne » (portée « Toute la chaîne »).
Résultat attendu : « Chaîne intègre » avec « N entrées vérifiées (séquences X à Y). Aucune anomalie. » ; point de départ « début de la chaîne » ou « ancre de confiance (début au milieu de la chaîne) ».
2. Une anomalie réelle (« Chaîne altérée », liste « Empreinte incohérente », « Chaînage rompu », « Trou dans la séquence »…) est un défaut **Bloquant** : prévenir l'équipe.
- [ ] Cas nominal  - [ ] Cas invalide

#### 24.50 Lecture réservée et immuabilité
Comptes : Directeur des études, Économe, Enseignant, Directeur · Où : `/v2/audit` et API.
1. Directeur des études, économe, enseignant : taper `/v2/audit` : R2. Console : `await fetch('/api/v1/audit/logs')` : statut 403, "Action non autorisée."
2. Directeur : aucune commande « Modifier » ou « Supprimer » sur la liste ni sur `/v2/audit/<id>`. Console : `await fetch('/api/v1/audit/logs/<id>', { method: 'DELETE' })` puis `PATCH` : le serveur ne connaît aucune route d'écriture sur le journal (réponse 404 attendue ; à vérifier en test).
3. Dans les autres établissements, `/v2/audit/<id d'une entrée du Collège>` : « Cette entrée n'existe pas ou n'appartient pas à votre établissement. »
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour l'enseignant

#### 24.51 Export du journal
Compte : Directeur · Où : `/v2/audit`, bouton « Exporter en CSV ».
1. Sans période : « L'export exige une période : renseignez les deux dates. »
2. Période de plus de 31 jours : « La période d'export est limitée à 31 jours. »
3. Période valide : « Export terminé : N lignes dans `<fichier>`. » (10 000 lignes au plus ; au-delà : "Le plafond de 10 000 lignes est atteint…"). Cet export est **lui-même journalisé** (`audit_log.exported`) : le retrouver au journal.
4. Compte sans `audit.export` : bouton absent ; "L'export est réservé aux profils disposant de la permission "Exporter le journal d'audit" (action sensible : MFA exigée). ".
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé

---

## 24.7 En-têtes de sécurité, stockage et fichiers protégés

#### 24.52 En-têtes de sécurité utiles
Compte : tout compte · Où : Outils de développement > Réseau, cliquer sur la requête du document (la page) puis "En-têtes de réponse" · Prérequis : aucun.
Résultat attendu sur une réponse du **web** (`localhost:3000`, posé par `apps/web/middleware.ts`) :

| En-tête | Valeur attendue |
|---|---|
| `Content-Security-Policy` | `default-src 'self'` ; `script-src 'self' 'unsafe-inline' 'unsafe-eval'` ; `style-src 'self' 'unsafe-inline'` ; `img-src 'self' data: https:` ; `font-src 'self' data:` ; `connect-src 'self' http://localhost:4000 http://localhost:3000` ; `frame-ancestors 'none'` ; `base-uri 'self'` ; `form-action 'self'` |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |
| `X-Powered-By` | **absent** |

Sur une réponse de l'**API** (`localhost:4000`, plugin `@fastify/helmet`) : `Strict-Transport-Security: max-age=15552000; includeSubDomains` ; `X-Content-Type-Options: nosniff` ; pas de `X-Powered-By` (autres en-têtes par défaut de helmet : à relever). Réponses de téléchargement de documents : `Cache-Control: no-store` (ou `private, no-store`). Pages de lien à usage unique (`/auth/reset-password`, `/auth/invitation`) : `referrer: no-referrer` dans les métadonnées.
Cas invalides : un en-tête attendu absent est un défaut Mineur ; `X-Powered-By` présent est un défaut Mineur.
- [ ] Cas nominal  - [ ] Cas invalide

#### 24.53 Cookies et stockage du navigateur
Compte : Enseignant · Où : Outils de développement > Application > Cookies / Stockage local · Prérequis : connecté.
Résultat attendu : le cookie de renouvellement (`ed_refresh`, ou `__Secure-ed_refresh` en HTTPS) est `HttpOnly`, `SameSite=Lax`, chemin `/api/v1/iam` ; le cookie de session NextAuth est `HttpOnly`. Le jeton d'accès (15 min) est dans le stockage local (`ecoledigitale_jwt_token`) : constat de conception (voir "Écarts constatés"). Après « Se déconnecter », le jeton et la session sont effacés.
- [ ] Cas nominal

#### 24.54 Téléchargement de fichier protégé
Comptes : Parent, Économe, Secrétariat · Où : bulletin d'un enfant (`/v2/parent/children/<id>/reportcards`), reçu (`/v2/finance/receipts/<id>`), document (`/v2/documents/<id>`) · Prérequis : un bulletin publié (chapitre 10), un reçu, un document.
1. Parent : télécharger le bulletin de son enfant : le fichier arrive par une **adresse signée à courte durée** (60 s par défaut, 300 s au plus), en pièce jointe.
2. Copier cette adresse signée immédiatement, l'ouvrir dans une fenêtre sans connexion avant 60 s : le fichier est servi (l'adresse signée fait foi, comportement voulu) ; la rouvrir après 60 s : refus (pas de fichier).
3. Modifier un caractère de la signature : refus.
4. Parent : demander le PDF du bulletin d'un enfant d'un autre tuteur (`GET /api/v1/reportcards/report-cards/<id>/pdf`, identifiant copié par le secrétariat) : réponse **identique à un bulletin inexistant** (404) ; un bulletin non publié : refus "Ce bulletin n'est pas disponible.".
5. Reçu : économe `GET /api/v1/finance/receipts/<id>/pdf` : PDF ; sans jeton : 401 ; reçu d'un autre établissement : 404.
6. Document en quarantaine (analyse antivirus positive) : jamais servi ; libération réservée à la direction, avec motif, MFA et audit (`documents.quarantine.released`).
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Adresse signée expirée | refus sans contenu (message exact à relever) |
| Bulletin d'un enfant non lié | 404 (R5) |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé

---

## 24.8 Bilan de sécurité (à cocher)

Date : ____ · Testeur : ____ · Environnement : localhost:3000 / 4000 · Version : ____

| Test | Scénarios | Réussi | Échoué | Fiche d'anomalie (gravité) |
|---|---|:-:|:-:|---|
| Adresses interdites par rôle (15 rôles + visiteur) | 24.1 à 24.17 | - [ ] | - [ ] | |
| Console plateforme inaccessible aux utilisateurs d'établissement et inversement | 24.1, 24.15, 24.22 | - [ ] | - [ ] | |
| Listes séparées entre les trois établissements | 24.19 | - [ ] | - [ ] | |
| Identifiants collés d'un établissement à l'autre : introuvables (16 objets) | 24.20 | - [ ] | - [ ] | |
| API avec le mauvais établissement : 404, jamais 403 ni 200 | 24.21 | - [ ] | - [ ] | |
| Jeton altéré refusé ; jeton d'établissement refusé sur la console | 24.22 | - [ ] | - [ ] | |
| Parent, élève, enseignant, instituteurs cloisonnés | 24.23 | - [ ] | - [ ] | |
| Sécurité par lignes PostgreSQL (administrateur) | 24.24 | - [ ] | - [ ] | |
| Quatre yeux : 10 circuits refusent la même personne | 24.25 à 24.34 | - [ ] | - [ ] | |
| Garde-fous : anti-escalade, dernier propriétaire, rôle verrouillé | 24.35 | - [ ] | - [ ] | |
| MFA : faux code, rejeu, code de secours, désactivation refusée | 24.36 à 24.40 | - [ ] | - [ ] | |
| Sessions : révocation immédiate, déconnexion générale | 24.41, 24.42 | - [ ] | - [ ] | |
| Verrouillage et messages neutres (pas d'énumération) | 24.44, 24.45 | - [ ] | - [ ] | |
| Jetons à usage unique, politique de mot de passe | 24.46, 24.47 | - [ ] | - [ ] | |
| Journal d'audit : actes tracés, chaîne intègre, lecture réservée, export borné | 24.48 à 24.51 | - [ ] | - [ ] | |
| En-têtes, cookies, fichiers protégés | 24.52 à 24.54 | - [ ] | - [ ] | |

Verdict : - [ ] Aucune fuite d'isolation ni de droits - [ ] Fuite constatée (Bloquant : prévenir immédiatement)

---

## Attendus de l'ancien guide corrigés par ce chapitre

| Point de l'ancien guide (`docs/GUIDE_UTILISATEUR_TEST.md`, partie 5) | Constat dans le code | Correction |
|---|---|---|
| 5.3 : secrétariat, `/v2/finance/refunds` "refusé" | La garde est `finance.payment.read`, détenue en lecture par le secrétariat | La page s'ouvre (lecture) ; seules les actions sont refusées (24.5, 24.25) |
| 5.1.2 à 5.1.4 : adresses `demo-secondaire.localhost:3100`, remplacer le sous-domaine | Pas de sous-domaine en local : un seul hôte `localhost:3000`, l'établissement est dans la session | Protocole à trois contextes de navigation (24.18, 24.20) ; « Aucun accès actif pour cet établissement. » n'est reproductible que si un indice d'établissement est fourni (sous-domaine ou `NEXT_PUBLIC_TENANT_SLUG`) |
| 5.3 : opérateur "pas de session d'établissement (à confirmer)" | `requireSession` redirige vers `/login` ; la console utilise un jeton séparé (`superAdminToken`) | R1 sur toute page d'établissement (24.15) |
| 5.4 : « quatre yeux » pour la résolution des paiements en attente | "Une seule personne habilitée tranche" (MFA récente, motif, preuve) | Retirée de la liste des quatre yeux (24.4) |
| 5.4 / C13 : séparation de la paie toujours active | Réglage propriétaire, **décoché par défaut** | À cocher avant le test (24.26) |
| C13.12 : message de refus de la paie | L'API dit "Séparation des tâches : celui qui a calculé le bulletin ne peut pas l'arrêter." ; l'écran ajoute l'indice "faites arrêter ce bulletin par une autre personne" | Les deux sont affichés (24.26) |
| 5.5 : « Précédent » ne doit pas réafficher une page privée (à confirmer) | non prouvé par le code | "À vérifier en test" (24.42) |
| 5.7 : "La connexion réussie n'est pas tracée" | Confirmé : aucun abonnement d'audit sur `iam.user.logged_in` | Conservé (24.6) |
| Rapports C-03-09, C-05-16, C-07-15, C-08-09, C-09-03, C-10-09, C-11-10, C-12-08, C-13-07 : « Accès refusé » en ancienne mise en page, anglais, « Chargement… » prolongé, 403 de la boîte de notifications | Les redirections vers `/unauthorized` sont correctes (concordance totale avec la matrice) ; la mise en page de la page de refus reste à moderniser (écart connu, "À planifier") | Le critère de réussite est **le refus sans donnée**, pas l'habillage (24.0) |

Concordance vérifiée entre la matrice calculée et les rapports de testeurs (`docs/qa/e2e/rapports`) : rapport 03 (directeur des études, 6 adresses), 04 (secrétariat, 8), 07 (enseignant, 9), 08 (éducateur, 5), 09 (responsable pédagogique, 6), 10 (responsable des examens, 5), 11 (directeur, réglages de paie), 12 et 13 (parent et élève : pages de gestion refusées, reçus de la sœur introuvables) : toutes concordent.

---

## Données créées

Ce chapitre ne crée **aucun enregistrement métier**. Effets de bord uniquement :
- sessions de connexion supplémentaires (24.18, 24.41) : à révoquer à la fin ;
- entrées du journal d'audit (échecs de connexion, révocations, exports) : **non supprimables par conception** ;
- verrouillage temporaire du compte `eleve@primaire-test.test` (24.44) : expire seul après 1 minute ;
- avec les chapitres cités : demandes de remboursement, périodes de paie, feuilles de notes, mesures de vie scolaire, séances comptables créées pour les quatre yeux (noms "… test guide" définis dans leurs chapitres) ;
- le fragment `_annexe-fragments/24-securite.md` en donne la liste.

## Écarts constatés

| Écran | Constat | Gravité |
|---|---|---|
| Menu de gestion : "Paramètres de présence", "Calendrier de l'établissement", « Validation des séances », "Paramètres des personnes" | Les manifestes de l'API renvoient `/admin/attendance/parametres`, `/admin/emploi-du-temps/calendrier`, `/admin/emploi-du-temps/validation`, `/admin/personnes/parametres` ; `LEGACY_TO_V2_HREF` (`apps/web/src/platform/admin/menu.ts`) ne les réécrit pas et `apps/web/src/app/(dashboard)/admin` n'a pas ces pages : entrées de menu probablement menant à une 404 (à confirmer en test) | Mineur |
| `/v2/admin/members` (et `/v2/account/security`, `/v2/account/sessions`, `/v2/home`) | Aucune garde de page par permission : un enseignant ou un parent voit l'écran puis un message d'erreur au lieu de `/unauthorized` ; aucune donnée n'est affichée (l'API refuse) | Mineur |
| Page 404 et `/unauthorized` | 404 par défaut en anglais ("This page could not be found.") ; page « Accès refusé » en ancienne mise en page, parfois précédée de « Chargement… » (C-03-09 et renvois) | Mineur |
| Sécurité du navigateur (`middleware.ts`) | CSP avec `script-src 'unsafe-inline' 'unsafe-eval'` et jeton d'accès (15 min) dans le stockage local : la CSP atténue peu un script injecté ; les adresses `localhost` sont écrites en dur dans `connect-src` | Suggestion |
| Portails du propriétaire et du directeur | Leur `*` inclut les permissions `*.self.*` et `*.child.*` : `/v2/student`, `/v2/parent`, `/v2/teacher` passent la garde de page sans élève, enfant ni fiche liés | Suggestion |
| Politique MFA | La liste par défaut (`owner`, `admin`, `director`, `bursar`, `accountant`, `super_admin`) ne contient pas les clés de rôles v2 (`directeur`, `econome`…) : seul le propriétaire est contraint à la connexion ; les autres ne le sont qu'à l'usage d'une permission sensible ou s'ils se sont enrôlés | Suggestion |

## À vérifier en test

- Message exact des écrans en R5 pour chacun des 16 objets de 24.20 (« Ressource introuvable. » ou message propre à l'écran) ; message de la fiche enfant d'un autre tuteur (rapport C-12-04 : "Établissement inconnu" constaté pour un identifiant inconnu).
- `X-Tenant` ignoré quand le jeton est valide (24.21, étape 2) ; réponse exacte de la route sans jeton (401 attendu).
- Contenu exact des écrans hors offre (R7) pour chaque module d'un autre pack (24.1, 24.17).
- Propriétaire / directeur sur `/v2/student`, `/v2/parent`, `/v2/teacher` : écran vide ou erreur ?
- Ordre d'apparition « Trop de tentatives » / "La vérification a expiré" après cinq faux codes (24.36).
- Comptes de test pour 24.38 et 24.39 : créer un membre de gestion sans MFA par « Utilisateurs » (`/v2/admin/members`) n'est possible que si le lien d'invitation est accessible (aucun e-mail réel n'est envoyé) ; sinon "non testé".
- Effet du bouton « Précédent » après déconnexion (24.42).
- Route 404 ou 405 des méthodes d'écriture sur `/api/v1/audit/logs/<id>` (24.50).
- Reçu : l'annonce de rentrée destinée aux parents est visible de l'élève (C-13-04, corrigé dans la graine) : ne pas confondre avec une fuite.
- En-têtes complets de helmet côté API (24.52).
- Lien de téléchargement de bulletin "à usage unique" constaté par un testeur (C-12-09) : le code lu ne montre qu'une adresse signée à durée courte ; vérifier si une seconde lecture est refusée.

## Non couvert / limites connues

- **Routes historiques** (`/owner/*`, `/tableau-de-bord`, `/professionnel/admin`, `/teacher/*`, `/parent/*`, `/student/*`, `/super-admin/*`, `/admin/*`) : hors du périmètre `/v2` ; leurs gardes existent (`requireAccess`) mais ne sont pas testées ici.
- **Impersonation** (session d'assistance par l'opérateur, badge « Assistance » dans « Mes sessions ») : traitée au chapitre 1.
- **Connexion Google** (`NEXT_PUBLIC_GOOGLE_AUTH`), **changement de rôle** (`/select-role`) et **changement d'établissement** (`/v2/account/tenants`) : un seul rôle et un seul établissement par compte de démonstration.
- **Expiration réelle de session** (24.43) : seulement avec réglage des variables d'environnement.
- **Antivirus** (quarantaine) : nécessite un fichier de test d'analyse positive ; couvert par le chapitre des documents.
- **Attaques techniques** (injection, XSS, CSRF, force brute à grande échelle) : hors du périmètre d'une recette utilisateur ; le test automatique `pnpm test:isolation` et les suites des modules (`rbac`, `iam`, `audit`) les couvrent côté développeurs.
- Les libellés de menu de gestion sont fournis par l'API et ne sont pas dans `fr-CI.json` (guillemets droits). Les libellés « … » restants qui ne sont que dans le code (écrans de connexion, de sécurité du compte et de sessions, textes codés en dur) sont à vérifier en test.
