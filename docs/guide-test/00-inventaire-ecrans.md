# Inventaire des écrans de l'application (v2)

Inventaire de **toutes les pages** de `apps/web/src/app/v2` (une page = une route de l'App Router, groupes `(…)` retirés, dossiers privés `_…` ignorés). Les adresses se tapent après `http://localhost:3000`. Chaque ligne indique le module, l'écran, l'URL, les rôles ou permissions requis (lus dans les gardes de pages, les menus et `system-roles.ts`), les fonctions de l'écran et le scénario du guide qui le couvre. Une route non couverte porte la mention "Non couvert" et sa raison.

Le script `scripts/check-guide-test.mjs` vérifie que **chaque route de l'App Router figure dans ce document** et que chaque route citée dans le guide existe.

Les sections sont regroupées par chapitre du guide. Les fragments ont été rédigés par chapitre : les préambules propres à un chapitre sont conservés.


---

## Inventaire des écrans : chapitre 01 (console de la plateforme, administration de l'établissement, accueil)

Fragment destiné à `00-inventaire-ecrans.md`. Adresse du navigateur : `http://localhost:3000` + URL ci-dessous (le dossier `apps/web/src/app/v2/` correspond au préfixe `/v2`, sans réécriture ; les groupes de routes `(admin)` et `(console)` ne figurent pas dans l'adresse). Source des gardes : `apps/web/src/app/v2/(admin)/*/layout.tsx` (`requirePermission`), `apps/web/src/platform/admin/console/*` (jeton d'opérateur), `apps/api/src/modules/rbac/templates/system-roles.ts`.

Dans la colonne des droits, "propriétaire + directeur" désigne les deux rôles qui détiennent `*` (le directeur sans `entitlements.manage`, `rbac.role.manage`, `payroll.settings.manage`…).

| Module | Écran | URL | Rôles/permissions | Fonctions | Chapitre-scénario |
|---|---|---|---|---|---|
| Console plateforme | Connexion de l'opérateur | `/v2/platform/login` | Aucune session d'établissement ; identifiants d'opérateur (variables `SUPER_ADMIN_*` de l'API) ; jeton conservé dans le navigateur | Connexion, redirection vers la console si déjà connecté | 01 : 1.1, 1.2 |
| Console plateforme | Racine de la console | `/v2/platform` | Opérateur (garde côté navigateur, sinon redirection vers `/v2/platform/login`) | Redirection vers `/v2/platform/tenants` | 01 : 1.2 |
| Console plateforme | Organisations (liste) | `/v2/platform/tenants` | Opérateur | Liste paginée (25 par page), recherche par nom ou identifiant, filtre par statut, lien vers la fiche et vers la création | 01 : 1.3 |
| Console plateforme | Nouvelle organisation | `/v2/platform/tenants/new` | Opérateur | Provisionnement : organisation, établissements (un par pack), rôles système, abonnement d'essai, propriétaire invité | 01 : 1.4, 1.5 |
| Console plateforme | Fiche d'une organisation | `/v2/platform/tenants/[tenantId]` | Opérateur | Vue d'ensemble ; statut (suspendre, réactiver, archiver, motif) ; abonnement (offre, packs, statut, période, tranche) ; dérogations de fonctionnalités (ajout, suppression) ; droits effectifs et usage ; réconciliation | 01 : 1.6 à 1.9 |
| Console plateforme | Plans et catalogue | `/v2/platform/plans` | Opérateur | Lecture des plans, packs, fonctionnalités ; création/modification d'un plan ; fonctionnalités d'un plan | 01 : 1.10 |
| Console plateforme | Journal de plateforme | `/v2/platform/audit` | Opérateur | Lecture du journal des actions d'opérateur, chargement par curseur | 01 : 1.11 |
| Accueil | Accueil de gestion | `/v2/home` | Toute personne connectée ; contenu = modules du menu du rôle | Cartes par module, liens vers les écrans autorisés | 01 : 1.12 |
| Établissement | Profil et marque | `/v2/settings` | Lecture : `tenancy.institution.read` (propriétaire, directeur, études, secrétariat, économe, éducateur, pédagogique, examens, admissions) ; écriture : `tenancy.institution.manage` (propriétaire + directeur) | Raison sociale, nom commercial, pays, contact, logo, couleurs, domaine, aperçu, enregistrer/annuler | 01 : 1.13 |
| Établissement | Établissements et campus | `/v2/settings/institutions` | Lecture : `tenancy.institution.read` ; établissements : `tenancy.institution.manage` ; campus : `tenancy.campus.manage` (propriétaire + directeur) | Liste, création et modification d'un établissement, création/modification/suppression d'un campus, campus par défaut | 01 : 1.14, 1.20 |
| Établissement | Mise en service | `/v2/settings/onboarding` | Lecture : `tenancy.institution.read` ; actions : `tenancy.institution.manage` | Étapes, progression, terminer/ignorer une étape, passer en production (définitif) | 01 : 1.15, 1.21 |
| Établissement | Abonnement et usage | `/v2/settings/subscription` | `entitlements.read` (propriétaire + directeur ; les autres rôles autorisés sur `/v2/settings` reçoivent une erreur "Action non autorisée." dans la page) | Lecture : offre, statut, packs, tranche, fonctionnalités actives par origine, usage mesuré | 01 : 1.16, 1.22 |
| Accès et rôles | Racine des accès | `/v2/access` | `rbac.role.read` (propriétaire + directeur) | Redirection vers `/v2/access/roles` | 01 : 1.17 |
| Accès et rôles | Rôles et permissions | `/v2/access/roles` | `rbac.role.read` (propriétaire + directeur) ; cloner/créer : `rbac.role.manage` (propriétaire seul) | Liste des rôles, ouverture, clonage | 01 : 1.17 |
| Accès et rôles | Nouveau rôle | `/v2/access/roles/new` | Garde de page : `rbac.role.read` ; l'API exige `rbac.role.manage` (propriétaire seul) et une session MFA | Création d'un rôle personnalisé (libellé, clé, description, permissions) | 01 : 1.18 |
| Accès et rôles | Fiche d'un rôle | `/v2/access/roles/[id]` | `rbac.role.read` ; modifier/supprimer/cloner : `rbac.role.manage` | Consultation, modification d'un rôle personnalisé, suppression, clonage ; rôle système verrouillé | 01 : 1.17, 1.18 |
| Accès et rôles | Attributions de rôles | `/v2/access/assignments` | Garde de page : `rbac.role.read` ; attribuer/modifier/révoquer : `rbac.assignment.manage` (propriétaire + directeur) | Liste filtrée, attribution, modification de la validité, révocation, anti-escalade, dernier propriétaire | 01 : 1.19 |
| Journal d'audit | Journal d'audit | `/v2/audit` | `audit.read` (propriétaire + directeur) ; export : `audit.export` (sensible, MFA) | Filtres, liste, vérification de la chaîne, export CSV | 01 : 1.23 |
| Journal d'audit | Détail d'une entrée | `/v2/audit/[id]` | `audit.read` | Informations générales, changements champ par champ, empreintes ; entrée introuvable | 01 : 1.23 |

---

## Inventaire des écrans : chapitre 02 (connexion, MFA, comptes)

Fragment destiné à `00-inventaire-ecrans.md`. Adresse du navigateur : `http://localhost:3000` + URL ci-dessous (dossier `app/v2` = préfixe `/v2`, groupe `(auth)` absent de l'adresse). Les pages de `(auth)` sont enveloppées par `AuthV2Gate` (404 si `NEXT_PUBLIC_AUTH_V2` n'est pas à 1 ; il l'est en développement). Les pages `account/*` et `admin/members` sont dans la coque de navigation du rôle (`AppShell`) : sans session, retour à `/login`.

| Module | Écran | URL | Rôles/permissions | Fonctions | Chapitre-scénario |
|---|---|---|---|---|---|
| Authentification | Connexion (même formulaire que `/login`, avec panneau des comptes de test) | `/v2/login` | public | E-mail et mot de passe, étape MFA (code ou code de secours), enrôlement forcé de la MFA, codes de secours, panneau de comptes de test avec code MFA automatique, erreurs non révélatrices, verrouillage | 02 : 2.1 à 2.7 |
| Authentification | Mot de passe oublié | `/v2/forgot-password` | public | Demande de lien (réponse identique que le compte existe ou non, 3 demandes par heure et par adresse) | 02 : 2.8 |
| Authentification | Nouveau mot de passe (réinitialisation ; mêmes composants que `/auth/reset-password` et `/auth/invitation`) | `/v2/reset-password` | public, jeton à usage unique reçu par courrier (aucun courrier dans l'environnement de test) | Définir un mot de passe avec un jeton, politique de mot de passe, jeton invalide ou absent | 02 : 2.9 (jeton valide : non couvert) |
| Compte | Sécurité du compte | `/v2/account/security` | toute personne connectée | Changer le mot de passe, activer la MFA (QR code, clé, codes de secours), désactiver la MFA | 02 : 2.11 à 2.13 |
| Compte | Mes sessions | `/v2/account/sessions` | toute personne connectée | Liste des sessions, révoquer une session, "Me déconnecter", "Déconnecter tous mes appareils" | 02 : 2.10 |
| Compte | Mes établissements | `/v2/account/tenants` | toute personne connectée (le lien du menu n'apparaît qu'avec plusieurs accès) | Changer d'établissement (nouvelle session, code MFA redemandé) | 02 : 2.15 |
| Utilisateurs | Membres de l'établissement | `/v2/admin/members` | pas de garde de page ; lecture `iam.user.read`, invitation `iam.user.invite`, suspension `iam.user.manage`, révocation de sessions `iam.session.revoke`, réinitialisation MFA `iam.mfa.reset` (propriétaire et directeur) | Inviter, suspendre/rétablir, révoquer les sessions, réinitialiser la MFA | 02 : 2.13, 2.14, 2.17 |
| Racine | Racine `/v2` | `/v2` | toute personne connectée | Redirection vers l'écran d'arrivée du rôle (`/v2/direction`, `/v2/students`, `/v2/teacher`…), sinon `/v2/home` | 02 : 2.2 |

Pages hors dossier `app/v2` liées à ce chapitre (non listées dans l'inventaire des routes `v2`) : `/login` (même composant que `/v2/login`, 2.1), `/auth/reset-password` et `/auth/invitation` (liens de courrier, 2.9), `/unauthorized` (page « Accès refusé », chapitre 1), `/register` (ancienne application, non couverte).

---

## Inventaire : structure académique (fragment du chapitre 3)

Adresses du navigateur : `app/v2/` = préfixe `/v2`. Refus de droit : redirection vers `/unauthorized` (« Accès refusé »).

| Module | Écran | URL | Rôles/permissions | Fonctions | Chapitre-scénario |
|---|---|---|---|---|---|
| academic | Accueil de l'espace | `/v2/academic` | aucune garde propre ; redirige vers `/v2/academic/years` | redirection | 03 / 3.1 |
| academic | Années et périodes | `/v2/academic/years` | `academic.year.read` (écriture : `academic.year.manage`, `academic.period.manage`, `academic.period.close`, `academic.year.close`, `academic.period.reopen`) | liste, création, modification, ouverture, clôture d'année ; périodes : plan, ajout, modification, suppression, ouverture, clôture des notes, clôture, réouverture ; frise | 03 / 3.1 à 3.5, 3.14 |
| academic | Programmes | `/v2/academic/programs` | `academic.program.read` (écriture : `academic.program.manage`) | arborescence, création, modification, archivage/réactivation, niveaux couverts | 03 / 3.7 |
| academic | Curriculum | `/v2/academic/curriculum` | `curriculum.read` (écriture : `curriculum.manage`, `curriculum.publish`, `curriculum.amend`) | version, nœuds (ajout, modification, déplacement, prérequis, suppression), rapport de validation, publication, amendement, historique, clonage | 03 / 3.8 |
| academic | Classes | `/v2/academic/classrooms` | `academic.classroom.read` (écriture : `academic.classroom.manage`) | liste filtrée, pagination, création | 03 / 3.9 |
| academic | Fiche de classe | `/v2/academic/classrooms/<identifiant>` | `academic.classroom.read` (actions : `academic.classroom.manage`) | élèves, enseignants, activer, terminer, annuler | 03 / 3.9, 3.15 |
| academic | Offres de cours | `/v2/academic/offerings` | `academic.classroom.read` ; fonction `academic.a-la-carte` (supérieur) ; ouvrir un semestre : `academic.classroom.manage` | liste des offres, assistant « Ouvrir un semestre », ouvrir/démarrer/terminer/annuler | 03 / 3.10 |
| academic | Reconduction annuelle (assistant) | `/v2/academic/rollover` | `academic.year.rollover` ; fonction `academic.rollover` | choix des années et des étapes, aperçu sans écriture, confirmation, lancement | 03 / 3.12, 3.13 |
| academic | Historique des reconductions | `/v2/academic/rollover/runs` | `academic.year.rollover` | liste des exécutions par année source, reprise du suivi | 03 / 3.12, 3.13 |
| academic | Suivi d'une reconduction | `/v2/academic/rollover/runs/<identifiant>` | `academic.year.rollover` | progression par étape, rapport, relance | 03 / 3.13 |
| academic | Paramètres académiques | `/v2/academic/settings` | `academic.read` (écriture : `academic.settings.manage`) | périodes, niveaux, financements, politiques d'inscription, numérotation, calendrier et jours fériés | 03 / 3.6, 3.11 |

---

## Inventaire : personnes et inscriptions (fragment du chapitre 4)

Adresses du navigateur : `app/v2/` = préfixe `/v2`. Refus de droit : redirection vers `/unauthorized` (« Accès refusé »). Un identifiant hors périmètre donne un message d'introuvable.

| Module | Écran | URL | Rôles/permissions | Fonctions | Chapitre-scénario |
|---|---|---|---|---|---|
| people | Liste des élèves | `/v2/students` | `student.list` ou `student.class.read` (enseignant : ses classes) ; export : `student.export` | recherche, filtres, pagination, export CSV | 04 / 4.1, 4.12, 4.29 |
| people | Nouvel élève | `/v2/students/new` | `student.create` | assistant identité, tuteurs, récapitulatif ; doublon probable | 04 / 4.3 à 4.5 |
| people | Fiche élève | `/v2/students/<identifiant>` | `student.read` ou `student.class.read` ; `student.update`, `student.status.update`, `student.sensitive.read`, `guardian.manage` | identité, informations sensibles, modification, tuteurs, urgences, parcours, statut, pièces | 04 / 4.6 à 4.10, 4.28, 4.29 |
| people | Mes enfants | `/v2/students/children` | `student.child.read` (parent) | liste des enfants | 04 / 4.13 |
| people | Fiche d'un enfant (parent) | `/v2/students/children/<identifiant>` | `student.child.read` ; correction : `student.child.update` | résumé, tuteurs, correction des contacts d'urgence, inscriptions | 04 / 4.8, 4.13 |
| people | Liste des tuteurs | `/v2/guardians` | `guardian.read` ; création : `guardian.manage` | recherche, création, doublon | 04 / 4.2 |
| people | Fiche tuteur | `/v2/guardians/<identifiant>` | `guardian.read` ; `guardian.manage` | coordonnées, enfants liés, modification, invitation au portail | 04 / 4.11 |
| people | Liste du personnel | `/v2/staff` | `staff.list` ou `staff.read` | recherche, filtres, tri par charge, alertes de qualifications | 04 / 4.14 |
| people | Nouveau membre du personnel | `/v2/staff/new` | `staff.create` | création, doublon (e-mail) | 04 / 4.15 |
| people | Fiche du personnel | `/v2/staff/<identifiant>` | `staff.read` ; `staff.update`, `staff.status.update`, `staff.contract.read`, `staff.contract.manage`, `staff.qualification.manage`, `staff.availability.manage`, `teaching.read` | identité, contrats, qualifications, compétences, disponibilités, charge, historique, statut, invitation | 04 / 4.16 à 4.18 |
| people | Affectations d'enseignement | `/v2/staff/assignments` | `teaching.read` ; `teaching.assign` | matrice par classe, par enseignant, affecter, désigner, remplacer, terminer | 04 / 4.19 |
| people | Mon espace | `/v2/staff/me` | `staff.own.read` | fiche et classes de l'enseignant | 04 / 4.20 |
| academic | Liste des inscriptions | `/v2/enrollments` | `enrollment.read` | filtres, pagination, ouverture | 04 / 4.21 |
| academic | Nouvelle inscription | `/v2/enrollments/new` | `enrollment.create` | assistant élève, classe, financement, récapitulatif ; nouvel élève ; capacité | 04 / 4.22, 4.25 |
| academic | Fiche d'inscription | `/v2/enrollments/<identifiant>` | `enrollment.read` ; `enrollment.update`, `enrollment.cancel`, `enrollment.funding.update`, `enrollment.confirm.override`, `enrollment.course.manage` | confirmer sans paiement, suspendre, reprendre, terminer, retirer, annuler, transférer, financement, placements, historique, cours | 04 / 4.23 à 4.28 |

---

| Module | Écran | URL | Rôles/permissions | Fonctions | Chapitre-scénario |
|---|---|---|---|---|---|
| Imports | Historique des imports | `/v2/imports` | `imports.read` : secrétariat, directeur des études, économe, enseignant, instituteur, directeur, propriétaire (chacun voit ses imports ; `imports.manage` voit ceux des autres) | liste paginée (20 par page), filtres « Type de données » et « État », lien vers la fiche, bouton « Nouvel import » (`imports.create`) | 05-imports 5.1, 5.35 |
| Imports | Nouvel import (assistant en 6 étapes : fichier, colonnes, validation, aperçu, import, rapport) | `/v2/imports/new` | `imports.create` ; carte utilisable = droit d'importer + droit du module visé ; lancement = `imports.import.<importeur>` (soldes : MFA) | choix de l'importeur, téléchargement du modèle CSV/Excel, envoi (.csv .xlsx .xls .ods), association des colonnes, options, modèle de mapping, validation, aperçu, mode, confirmation, lancement | 05-imports 5.8 à 5.32 |
| Imports | Fiche d'un import (reprise de l'assistant à l'étape de l'état serveur, rapport) | `/v2/imports/[id]` | `imports.read` ; visible seulement par l'auteur ou `imports.manage` (sinon "introuvable") | reprise, « Modifier les colonnes », lancement, annulation en cours (`imports.cancel`), rapport, téléchargement des erreurs et du rapport | 05-imports 5.2, 5.3, 5.28, 5.30, 5.31, 5.35 |
| Imports | Modèles (modèles de fichier et modèles de mapping) | `/v2/imports/templates` | `imports.read` ; suppression d'un modèle : `imports.template.manage` (direction) | téléchargement des gabarits CSV/Excel par importeur, liste et suppression des modèles de mapping | 05-imports 5.4, 5.5, 5.6 |
| Imports | Paramètres des imports | `/v2/imports/settings` | `imports.manage` (direction seule) | huit plafonds et quotas (lignes, colonnes, taille, lot, tout ou rien, imports actifs, par 24 h, conservation), enregistrement | 05-imports 5.7, 5.10, 5.11, 5.31 |

---

| Module | Écran | URL | Rôles/permissions | Fonctions | Chapitre-scénario |
|---|---|---|---|---|---|
| Présences | Tableau de bord d'assiduité (« Assiduité par classe ») | `/v2/attendance` | `attendance.read` (enseignant, instituteur, éducateur, secrétariat, responsable pédagogique, directeur des études, direction) ; surcharge : `attendance.summary.override` (direction) ; recalcul : `attendance.manage` | récapitulatif par classe et période, recalcul, surcharge et retrait de surcharge, lien vers la fiche élève | 06 : 6.13 |
| Présences | Absences et retards | `/v2/attendance/absences` | `attendance.report.read` (éducateur, secrétariat, responsable pédagogique, directeur des études, direction) ; « Justifier » : `attendance.justification.submit` | liste filtrée (classe, dates, justification, statut), pagination, justification rapide, export CSV | 06 : 6.12 |
| Présences | Alertes d'assiduité | `/v2/attendance/alerts` | lecture `attendance.read` ; ajout, activation, suppression : `attendance.settings.manage` (directeur des études, direction) | liste des règles, ajout (code, indicateur, seuil), activer, désactiver, supprimer | 06 : 6.18 |
| Présences | Faire l'appel (séances et appels du jour) | `/v2/attendance/call` | `attendance.take` ou `attendance.manage` (enseignant, instituteur, éducateur, secrétariat, directeur des études, direction) | séances du jour, appel journalier (matin, après-midi, jour), ouverture pour une autre classe (direction), file locale | 06 : 6.10 |
| Présences | Appel d'une séance ou d'une classe (`<kind>` = `occurrence` ou `daily`) | `/v2/attendance/call/<kind>/<id>` | `attendance.take` ou `attendance.manage` ; l'API vérifie l'affectation | ouverture de l'appel, pointage (présent, absent, retard, départ anticipé), absence justifiée (direction), soumission, corrections | 06 : 6.2, 6.3, 6.4, 6.9, 6.10, 6.11 |
| Présences | Absences de mes enfants (liste) | `/v2/attendance/children` | `attendance.child.read` (parent) | liste des enfants liés, lien vers leurs absences | 06 : 6.15, 6.23 |
| Présences | Absences d'un enfant | `/v2/attendance/children/<studentId>` | `attendance.child.read` ; dépôt : `attendance.child.justify` | récapitulatif, absences à justifier, justificatifs, dépôt, retrait | 06 : 6.15, 6.23 |
| Présences | Appels non faits | `/v2/attendance/compliance` | `attendance.report.read` | taux d'appel par enseignant et par classe, séances sans appel, accès à l'appel | 06 : 6.17 |
| Présences | Conflits de synchronisation | `/v2/attendance/conflicts` | `attendance.manage` (éducateur, directeur des études, direction) ; fonction `attendance.offline` | liste à arbitrer et arbitrés, conserver ou appliquer la saisie de l'appareil | 06 : 6.19 (état vide ; conflit réel non reproductible : voir Non couvert, hors ligne) |
| Présences | Justificatifs d'absence | `/v2/attendance/justifications` | lecture `attendance.justification.read` ; dépôt : `.submit` (éducateur, secrétariat, direction) ; décision : `.decide` (directeur des études, direction) | liste filtrée, détail, pièces (ouverture journalisée), accepter, rejeter, révoquer, dépôt | 06 : 6.16 |
| Présences | Mes absences (élève) | `/v2/attendance/me` | `attendance.self.read` (élève) ; dépôt : `attendance.self.justify` | récapitulatif, absences, justificatifs, dépôt, retrait | 06 : 6.22 |
| Présences | Suivi des appels | `/v2/attendance/sessions` | `attendance.read` ; valider : `attendance.validate` (éducateur, directeur des études, direction) ; rouvrir : `attendance.session.reopen` (direction) ; annuler : `attendance.take` ou `.manage` | liste filtrée (dates, état, classe), validation seule ou par lot, réouverture motivée, annulation motivée | 06 : 6.5, 6.6, 6.7, 6.8 |
| Présences | Ma présence (personnel) | `/v2/attendance/staff/me` | `attendance.own.read`, `.own.record` ou `attendance.leave.request` (enseignant, instituteur, éducateur, personnel, direction) ; fonction `attendance.staff` | arrivée, départ, demande de congé, annulation, historique | 06 : 6.20 |
| Présences | Présence du personnel (gestion) | `/v2/attendance/staff` | `attendance.staff.read` (directeur des études, direction) ; enregistrer : `attendance.staff.record` ; décider : `attendance.leave.decide` ; demander : `attendance.leave.request` | récapitulatif, présences, congés, approuver, refuser, annuler, enregistrer une présence | 06 : 6.21 |
| Présences | Fiche d'absences d'un élève | `/v2/attendance/student/<studentId>` | `attendance.read` ; attestation : `attendance.report.read` | récapitulatif de période, pointages, justificatifs, données d'attestation, impression | 06 : 6.14 |
| Présences (portail enseignant) | Mes appels | `/v2/teacher/attendance` | `attendance.take` ou `attendance.manage` | séances du jour, appel journalier, file locale, historique des 30 derniers jours | 06 : 6.1 |
| Présences (portail enseignant) | Index d'appel (sans contenu propre) | `/v2/teacher/attendance/call` | aucun contrôle propre ; redirection vers `/v2/teacher/attendance` | redirection | 06 : 6.1 (étape 8) |
| Présences (portail enseignant) | Appel d'une séance ou d'une classe dans le portail (`<kind>` = `occurrence` ou `daily`) | `/v2/teacher/attendance/call/<kind>/<id>` | `attendance.take` ou `attendance.manage` ; l'API vérifie l'affectation | même écran d'appel que `/v2/attendance/call/<kind>/<id>`, retour vers « Mes appels » | 06 : 6.2, 6.9 |

---

| Module | Écran | URL | Rôles/permissions | Fonctions | Chapitre-scénario |
|---|---|---|---|---|---|
| Emploi du temps | Emploi du temps (semaine ou jour) | `/v2/schedule` | `schedule.read`, `.own.read`, `.self.read` ou `.child.read` (direction, directeur des études, éducateur, secrétariat, responsable pédagogique, enseignant, instituteur, parent, élève) | vue semaine ou jour ; sujets : moi, mes enfants, classe, enseignant, salle, élève ; séances annulées ; lien d'export | 07 : 7.1, 7.15 |
| Emploi du temps | Export calendrier | `/v2/schedule/export` | `schedule.read`, `.own.read`, `.self.read` ou `.child.read` | téléchargement .ics, liens d'abonnement créés, listés, révoqués | 07 : 7.14 |
| Emploi du temps | Générateur : propositions | `/v2/schedule/generator` | lecture `schedule.read` ; lancement : `schedule.manage` | liste des générations, accès au lancement | 07 : 7.16, 7.19 |
| Emploi du temps | Générateur : nouvelle génération | `/v2/schedule/generator/new` | `schedule.manage` (directeur des études, direction) ; fonction `scheduling.generation` | cadre, grille, besoins par matière, paramètres, graine, lancement | 07 : 7.16, 7.17 |
| Emploi du temps | Générateur : proposition | `/v2/schedule/generator/<id>` | lecture `schedule.read` ; appliquer, abandonner, relancer : `schedule.manage` | état, aperçu par classe, enseignant, salle, séances non placées et causes, application dans un brouillon, abandon, relance | 07 : 7.17, 7.18 |
| Emploi du temps | Séances | `/v2/schedule/occurrences` | lecture `schedule.read` ; créer : `schedule.manage`, `schedule.room.book` ou `schedule.occurrence.declare` ; déplacer, salle, remplacer, annuler, rétablir : `schedule.manage` ; constater : `schedule.occurrence.hold` ; dépasser un conflit : `schedule.conflict.override` | liste filtrée, création avec aperçu de conflits et aide au placement, report, changement de salle, remplacement, annulation, rétablissement, constat | 07 : 7.7, 7.8, 7.9, 7.10 |
| Emploi du temps | Remplacements | `/v2/schedule/replacements` | `schedule.manage` (directeur des études, direction) | séances à remplacer (congé, salle, fin d'affectation), propositions de remplaçants, remplacement | 07 : 7.11 |
| Emploi du temps | Salles et équipements | `/v2/schedule/rooms` | lecture `schedule.read` ; créer, changer l'état : `schedule.room.manage` ; équipements : fonction `scheduling.equipment` | salles, état de service, occupation de la semaine, équipements | 07 : 7.2, 7.3 |
| Emploi du temps | Patrons récurrents (liste) | `/v2/schedule/timetables` | lecture `schedule.read` ; créer : `schedule.manage` | liste filtrée par état, création d'un brouillon | 07 : 7.4 |
| Emploi du temps | Fiche d'un emploi du temps (éditeur de créneaux) | `/v2/schedule/timetables/<id>` | lecture `schedule.read` ; modifier, générer : `schedule.manage` ; publier, archiver : `schedule.publish` | créneaux récurrents (jour, heures, salle, intervenants, alternance A/B), conflits du brouillon, publication, archivage, génération des séances | 07 : 7.4, 7.5, 7.6, 7.12, 7.20 |
| Emploi du temps | Aujourd'hui | `/v2/schedule/today` | `schedule.own.read` (enseignant, instituteur, personnel, direction) | séances du jour, état de l'appel, accès à l'appel et à la saisie des notes | 07 : 7.13 |
| Emploi du temps (portail enseignant) | Mon emploi du temps | `/v2/teacher/schedule` | `schedule.own.read` | même écran que `/v2/schedule` limité à « Mon emploi du temps », lien d'export | 07 : 7.13 |
| Emploi du temps (portail enseignant) | Export calendrier du portail | `/v2/teacher/schedule/export` | `schedule.own.read` | même écran que `/v2/schedule/export` | 07 : 7.14 |

---

| Module | Écran | URL | Rôles/permissions | Fonctions | Chapitre-scénario |
|---|---|---|---|---|---|
| Évaluations | Liste des évaluations | `/v2/assessments` | assessment.read, grade.read ou grade.enter (enseignant, instituteur, responsable pédagogique, directeur des études, directeur, propriétaire, responsable des examens) | liste, filtres classe/période/état, « Seulement mes évaluations » (assessment.manage), accès fiche et feuille | 08 : 8.1, 8.19 |
| Évaluations | Nouvelle évaluation | `/v2/assessments/new` | assessment.create ou assessment.manage (enseignant, instituteur, directeur des études, directeur, propriétaire) | création simple ou multiple (classes/cours), choix de l'enseignant (manage), session 2 (supérieur) | 08 : 8.14, 8.17, 8.19 |
| Évaluations | Types d'évaluation et réglages de saisie | `/v2/assessments/types` | lecture assessment.type.read ; écriture assessment.type.manage (directeur, propriétaire) | liste, création, modification, activation/désactivation, séparation des tâches, décimales | 08 : 8.2, 8.3 |
| Évaluations | Corrections de notes | `/v2/assessments/revisions` | grade.revise.request (enseignant) ou grade.revise.approve (directeur des études, directeur, propriétaire) | liste filtrée par état, approuver, rejeter, appliquer | 08 : 8.15, 8.19 |
| Évaluations | Fiche d'une évaluation | `/v2/assessments/[id]` | assessment.read ou grade.read | détail, circuit de validation (soumettre, relire, approuver, publier, renvoyer en brouillon, annuler), historique, corrections | 08 : 8.1, 8.9 à 8.14 |
| Évaluations | Feuille de notes | `/v2/assessments/[id]/grades` | grade.read ou grade.enter | saisie en lot, codes ABS/ABJ/DISP/NN, enregistrement automatique, corrections et historique d'une note publiée | 08 : 8.7, 8.8, 8.13, 8.15 |
| Évaluations | Mes évaluations (enseignant) | `/v2/teacher/assessments` | assessment.read, grade.read ou grade.enter | liste de ses évaluations, filtres | 08 : 8.4 |
| Évaluations | Nouvelle évaluation (enseignant) | `/v2/teacher/assessments/new` | assessment.create (enseignant, instituteur) | création simple et multiple | 08 : 8.5, 8.6, 8.17 |
| Évaluations | Fiche d'une évaluation (enseignant) | `/v2/teacher/assessments/[id]` | assessment.read ou grade.read | détail, circuit, historique | 08 : 8.4, 8.9 |
| Évaluations | Feuille de notes (enseignant) | `/v2/teacher/assessments/[id]/grades` | grade.read ou grade.enter | saisie en lot, demande de correction | 08 : 8.7, 8.8, 8.15 |

---

| Module | Écran | URL | Rôles/permissions | Fonctions | Chapitre-scénario |
|---|---|---|---|---|---|
| Règles | Catalogue des jeux de règles | `/v2/rules` | rules.ruleset.read (responsable pédagogique, directeur des études, directeur, propriétaire) | liste, recherche, filtre d'origine, créer une variante (rules.version.create + option) | 09 : 9.1, 9.5, 9.19 |
| Règles | Liaisons aux programmes | `/v2/rules/bindings` | lecture rules.ruleset.read ; écriture rules.binding.manage (directeur, propriétaire) | lecture par contrat, ajouter, modifier, supprimer | 09 : 9.3, 9.4 |
| Règles | Version d'un jeu de règles | `/v2/rules/versions/[id]` | rules.ruleset.read (édition : directeur, propriétaire ; simulation : + directeur des études) | règles, paramètres, validation, banc d'essai, éditeur d'expressions (pack Supérieur), simulation, gouvernance, journal | 09 : 9.2, 9.5, 9.6 |
| Résultats | Périodes (état, verrouillage, délibération, clôture) | `/v2/results` | result.read, period.lock ou period.close ; réouverture : period.reopen (directeur, propriétaire) | état, verrouiller, délibérer, clôturer, rouvrir, relancer le calcul, changer de version de règle | 09 : 9.7, 9.11, 9.14 à 9.16 |
| Résultats | Résultats de classe | `/v2/results/matrix` | result.read | matrice, tri, détail par cours, lien d'explication et de résultat annuel | 09 : 9.8, 9.17 |
| Résultats | Décisions et délibérations | `/v2/results/decisions` | decision.record, decision.approve ou appreciation.write | décisions (confirmer, modifier avec motif), délibérations, appréciations | 09 : 9.13 |
| Résultats | Surcharges | `/v2/results/overrides` | demande : result.override.request ; décision : result.override.approve (directeur, propriétaire) | demander, approuver, rejeter, révoquer | 09 : 9.12 |
| Résultats | Rattrapage | `/v2/results/resit` | higher.resit.manage (pack Supérieur) | candidats, fenêtre de rattrapage, inscrits | 09 : 9.18 |
| Résultats | Explication d'un résultat | `/v2/results/[id]/explain` | result.explain | trace de calcul, empreintes, étapes | 09 : 9.9 |
| Résultats | Résultat annuel d'une inscription | `/v2/results/year/[enrollmentId]/[yearId]` | result.read | résultat annuel, périodes manquantes | 09 : 9.10 |

---

| Module | Écran | URL | Rôles/permissions | Fonctions | Chapitre-scénario |
|---|---|---|---|---|---|
| Bulletins | Bulletins émis (liste) | `/v2/reportcards` | `reportcard.read` (Propriétaire, Directeur, Directeur des études, Secrétariat, Responsable pédagogique, Instituteur) ; actions : `reportcard.publish`, `reportcard.generate`, `reportcard.revoke` | liste filtrée (classe, période, état, nature, dernière version, à réémettre), sélection et publication groupée, télécharger, publier, retirer, relancer le PDF, réémettre, révoquer | 10 : 10.4, 10.14, 10.15, 10.16, 10.17 |
| Bulletins | Fiche d'un bulletin | `/v2/reportcards/[id]` | `reportcard.read` ; trace : `reportcard.explain` | contenu figé, QR et code de vérification, générations du PDF, téléchargement, trace d'explicabilité, mêmes actions que la liste | 10 : 10.5, 10.14, 10.16 |
| Bulletins | Émettre (lot) | `/v2/reportcards/issue` | `reportcard.generate` (Propriétaire, Directeur, Directeur des études, Secrétariat) ; publication du lot : `reportcard.publish` | contrôle préalable, bulletin provisoire, réémission avec motif, génération idempotente, avancement, reprise, relance des PDF, PDF de la classe, publier le lot | 10 : 10.9, 10.15 |
| Bulletins | Modèles de documents | `/v2/reportcards/templates` | `reportcard.template.manage` (Propriétaire, Directeur, Directeur des études) | configuration versionnée par nature (bulletin, relevé), options, signataires par emplacement, aperçu | 10 : 10.3, 10.13 |
| Bulletins | Identité et réglages | `/v2/reportcards/identity` | `reportcard.branding.manage` (Propriétaire, Directeur) | identité visuelle versionnée (textes, couleurs, logo, emblème), historique, réglages (délibération, mention publique, blocage impayé) | 10 : 10.1 |
| Bulletins | Signataires | `/v2/reportcards/signatories` | `reportcard.signatory.manage` (Propriétaire, Directeur) | créer, modifier, activer, désactiver, signature image, période de validité | 10 : 10.2 |
| Bulletins | Mes bulletins / bulletins de mes enfants | `/v2/reportcards/family` | `reportcard.self.read` ou `reportcard.child.read` (Élève, Parent) | bulletins publiés par enfant, téléchargement journalisé | 10 : 10.10 |
| Vérification publique | Vérification d'un document | `/v2/verify` | public, sans connexion | vérification par code (aussi `?code=`), comparaison d'un fichier PDF | 10 : 10.6, 10.7, 10.8 |
| Vérification publique | Vérification par lien du QR code | `/v2/verify/[code]` | public, sans connexion | vérification immédiate du code de l'adresse | 10 : 10.6, 10.7 |
| Vérification publique | Alias imprimé du QR code | `/v2/verify/v/[code]` | public, sans connexion | vérification immédiate du code de l'adresse | 10 : 10.6 |

---

| Module | Écran | URL | Rôles/permissions | Fonctions | Chapitre-scénario |
|---|---|---|---|---|---|
| Enseignement supérieur | Accueil du module | `/v2/higher` | session ; redirige vers les diplômes | redirection vers `/v2/higher/diplomas` | 11 : 11.8, 11.18 |
| Enseignement supérieur | Diplômes | `/v2/higher/diplomas` | `higher.diploma.read` ; création : `higher.diploma.manage` ; fonction d'offre `higher.diplomas` | liste, recherche, filtre d'état, création depuis un cycle du curriculum | 11 : 11.8 |
| Enseignement supérieur | Fiche d'un diplôme | `/v2/higher/diplomas/[id]` | `higher.diploma.read` ; modifier, synchroniser, supprimer : `diploma.manage` ; octroyer : `award.create` ; forcer et ré-octroyer : `award.force` ; révoquer : `award.revoke` ; émettre : `document.issue` | exigences, candidats, progression, réévaluation, octroi, octroi forcé, ré-octroi, documents émis, diplôme, duplicata, attestation d'authenticité, révocation | 11 : 11.8, 11.9, 11.10, 11.12, 11.17 |
| Enseignement supérieur | Attestations de réussite | `/v2/higher/attestations` | `higher.diploma.read` ; émission : `higher.document.issue` ; fonction `higher.attestations` | liste d'éligibilité par programme et classe, émission unitaire | 11 : 11.14 |
| Enseignement supérieur | Documents émis | `/v2/higher/documents` | `higher.document.read` (Propriétaire, Directeur, Directeur des études, Secrétariat) ; publier : `document.issue` ; révoquer : `award.revoke` | liste filtrée, détail, PDF, relance, publication, révocation | 11 : 11.13 |
| Enseignement supérieur | Crédits et dettes | `/v2/higher/credits` | `higher.credits.read` ; durée de validité : `higher.settings.manage` | registre de crédits, dettes d'UE, rattrapages d'un étudiant, réglage de la validité | 11 : 11.3 |
| Enseignement supérieur | Prérequis entre UE | `/v2/higher/prerequisites` | `higher.prerequisite.manage` ou `higher.credits.read` ; fonction `higher.prerequisites` | choix du curriculum, prérequis d'une UE (validée, suivie, moyenne minimale), contrôle d'un étudiant | 11 : 11.4 |
| Enseignement supérieur | Rattrapages | `/v2/higher/resit` | `higher.resit.manage` ; fonction `higher.session2` | candidats, ouverture et clôture de fenêtre, inscrits | 11 : 11.7 |
| Enseignement supérieur | Dispenses d'UE | `/v2/higher/exemptions` | `higher.exemption.read` ; accorder, révoquer : `higher.exemption.grant` ; politique : `higher.settings.manage` | liste, filtre, politique de crédits, octroi motivé, révocation motivée | 11 : 11.5 |
| Enseignement supérieur | UE annuelles | `/v2/higher/annual-ues` | `higher.diploma.read` ; déclarer, retirer : `higher.annual_ue.manage` | liste, déclaration, retrait motivé | 11 : 11.6 |
| Enseignement supérieur | Signataires datés | `/v2/higher/signatories` | `higher.slot.manage` (Propriétaire, Directeur) | affectation datée par emplacement, historique | 11 : 11.11 |
| Enseignement supérieur | Mes documents | `/v2/higher/me/documents` | `higher.self.read` ou `higher.child.read` (Élève, Parent) | documents publiés de l'étudiant ou des enfants, téléchargement | 11 : 11.16 |

---

| Module | Écran | URL | Rôles/permissions | Fonctions | Chapitre-scénario |
|---|---|---|---|---|---|
| Finance | Vue d'ensemble | `/v2/finance` | l'une de `finance.report.read`, `finance.invoice.read`, `finance.payment.read`, `finance.cashregister.open`, `finance.fee.read` (économe, directeur, secrétariat sans chiffres) | synthèse (8 indicateurs), 6 accès rapides | 12.1 |
| Finance | Frais | `/v2/finance/fees` | `finance.fee.read` ; création et (dés)activation `finance.fee.manage` (économe, directeur) | liste, filtres, créer, désactiver, réactiver | 12.2 |
| Finance | Barèmes | `/v2/finance/fees/schedules` | `finance.fee.read` ; création `finance.fee.manage` | liste, filtres, créer, résoudre un montant | 12.3 |
| Finance | Plans d'échéancier | `/v2/finance/fees/plans` | `finance.fee.read` ; création `finance.fee.manage` + fonction `finance.installments` | liste, créer | 12.4 |
| Finance | Remises | `/v2/finance/fees/discounts` | `finance.fee.read` ; création `finance.fee.manage` | liste, créer | 12.5 |
| Finance | Factures (liste) | `/v2/finance/invoices` | `finance.invoice.read` (économe, directeur, secrétariat) | liste paginée, filtres (apprenant, statut, payeur, année, classe) | 12.6 |
| Finance | Nouvelle facture | `/v2/finance/invoices/new` | `finance.invoice.create` (économe, directeur) | depuis le catalogue (aperçu, remises, plan, émission, brouillon), saisie libre | 12.7, 12.8, 12.9, 12.17, 12.30, 12.31 |
| Finance | Fiche facture | `/v2/finance/invoices/[id]` | `finance.invoice.read` ; émettre / échéancier `finance.invoice.create` ; avoir / annuler `finance.invoice.cancel` | lecture, imprimer, émettre un brouillon, générer un échéancier, avoir, annuler | 12.10, 12.25, 12.30 |
| Finance | Encaissements (liste) | `/v2/finance/payments` | `finance.payment.read` (économe, directeur, secrétariat) | liste paginée, filtres, export CSV de la page | 12.20 |
| Finance | Encaisser un paiement | `/v2/finance/payments/new` | `finance.payment.create` (économe, directeur) | espèces, chèque, virement, carte, mobile money ; imputation automatique, manuelle, acompte ; payeur famille ou financeur ; double clic | 12.11 à 12.15, 12.18, 12.19, 12.31, 12.32, 12.34 |
| Finance | Paiement en ligne | `/v2/finance/payments/online` | `finance.payment.create` + fonction `finance.online-payment` | initier (fournisseur simulé), suivi, vérifier | 12.16 |
| Finance | Paiements à rapprocher | `/v2/finance/payments/pending` | `finance.payment.read` ; vérifier `finance.payment.create` ; résoudre / clore `finance.payment.reconcile` (direction, MFA récente) | liste, vérifier maintenant, résolution manuelle, anciennes demandes | 12.26, 12.27 |
| Finance | Fiche paiement | `/v2/finance/payments/[id]` | `finance.payment.read` ; imputer `finance.payment.create` ; rembourser `finance.payment.refund` | lecture, suivi, imputer le solde, demander un remboursement | 12.13, 12.14, 12.20, 12.28 |
| Finance | Reçus (liste) | `/v2/finance/receipts` | `finance.receipt.read` (économe, directeur, secrétariat) | liste, filtre apprenant | 12.21 |
| Finance | Fiche reçu | `/v2/finance/receipts/[id]` | `finance.receipt.read` | lecture, impression navigateur | 12.21 |
| Finance | Remboursements | `/v2/finance/refunds` | `finance.payment.read` ; approuver, refuser, exécuter, remboursement manuel `finance.payment.refund` (demandeur ≠ approbateur) | liste, filtre statut, approuver, refuser, exécuter, confirmer à la main | 12.28 |
| Finance | Caisse | `/v2/finance/cash` | `finance.cashregister.open` ; clôture `finance.cashregister.close` ; nouvelle caisse `finance.fee.manage` | créer une caisse, ouvrir, clôturer (comptage, écart), historique, détail | 12.11, 12.13, 12.29 |
| Finance | Remises et bourses | `/v2/finance/funding` | `finance.invoice.read` ; modification `finance.fee.manage` ; État : fonction `finance.state-assigned` (secondaire) | type de financement, bourses (créer, suspendre, réactiver, terminer), répartition des factures | 12.31 |
| Finance | Rapports | `/v2/finance/reports` | `finance.report.read` (économe, directeur) | synthèse, créances par classe et par apprenant, balance âgée, évolution, comptes fournisseurs, exports CSV | 12.35 |
| Finance | Webhooks en échec | `/v2/finance/webhooks` | `finance.webhook.read` (économe, directeur) ; rejeu `finance.webhook.replay` (direction, MFA) | liste, filtres, détail, rejeu | 12.37 |
| Finance | Fournisseurs de paiement | `/v2/finance/providers` | `finance.provider.manage` (direction seule, MFA) | lecture de l'état, configuration, test, activation, rotation des clés (non exercés : lecture seule) | 12.36 |
| Finance | Mes finances (famille) | `/v2/finance/me` | `finance.child.read` (parent) ou `finance.self.read` (élève) | une carte par enfant : facturé, payé, reste à payer | 12.22, 12.24 |
| Finance | Situation d'un apprenant (famille) | `/v2/finance/me/[learnerId]` | `finance.child.read` / `finance.self.read` + propriété relue côté serveur ; payer `finance.child.pay` / `finance.self.pay` | situation, échéances, factures, paiements, reçus, payer en ligne | 12.22, 12.23, 12.24 |
| Finance | Reçu (famille) | `/v2/finance/me/[learnerId]/receipts/[id]` | `finance.child.read` / `finance.self.read` + propriété | lecture, PDF scellé, impression | 12.22, 12.33 |

---

| Module | Écran | URL | Rôles/permissions | Fonctions | Chapitre-scénario |
|---|---|---|---|---|---|
| Paie | Périodes de paie (liste) | `/v2/payroll` | `payroll.period.manage` ou `payroll.payslip.read` (contenu : `period.manage`) ; économe, directeur, propriétaire | liste, création de période, avertissement "en attente de calcul" | 13.1, 13.5 |
| Paie | Fiche d'une période (calcul, bulletins, versement) | `/v2/payroll/periods/[id]` | `payroll.period.manage` ; calcul : `run.calculate` ; arrêt : `payslip.approve` ; versement : `payslip.pay` | aperçu, calcul, recalcul, historique des calculs, arrêt/versement par lot, activer/clôturer/archiver | 13.6, 13.8, 13.9, 13.16, 13.18, 13.19 |
| Paie | Bulletins (liste) | `/v2/payroll/payslips` | `payroll.payslip.read` ; économe, directeur, propriétaire | liste filtrée (enseignant, période, statut) | 13.1, 13.9 |
| Paie | Fiche d'un bulletin | `/v2/payroll/payslips/[id]` | `payroll.payslip.read` ou `read_own` ; actions : `adjust`, `approve`, `pay`, `cancel`, `notify` | montants, lignes d'heures, primes et retenues, arrêt, versement, contestation, annulation, envoi au titulaire, aperçu imprimable, historique | 13.7 à 13.11, 13.14, 13.15, 13.21 |
| Paie | Configurations de paie | `/v2/payroll/configuration` | `payroll.config.read` (écriture : `config.manage`) ; économe, directeur, propriétaire | liste, création, modification, situation d'un enseignant | 13.3 |
| Paie | Tarifs horaires et simulateur | `/v2/payroll/configuration/rates` | `payroll.rate.read` (écriture : `rate.manage`) ; économe, directeur, propriétaire | liste, création, modification, suppression, simulateur de tarif | 13.4 |
| Paie | Réglages de la paie | `/v2/payroll/configuration/settings` | `payroll.settings.manage` ; propriétaire seulement | seuil et majoration d'heures supplémentaires, séparation des tâches, seuil du propriétaire | 13.2, 13.14, 13.16, 13.21 |
| Paie | Historique des paiements | `/v2/payroll/history` | `payroll.payslip.read` ; économe, directeur, propriétaire | liste filtrée des bulletins arrêtés/versés, export CSV | 13.12 |
| Paie | Rapports de paie | `/v2/payroll/reports` | `payroll.report.read` ; économe, directeur, propriétaire | synthèse par statut et origine des heures, filtres, export CSV | 13.1, 13.12 |
| Paie | Masse salariale (propriétaire) | `/v2/payroll/owner` | `payroll.report.read` + fonction `payroll.owner-validation` ; validation : `payslip.approve` | totaux par période, annulés/contestés à part, validation d'un bulletin | 13.14, 13.16, 13.17 |
| Paie | Mes bulletins (salarié) | `/v2/payroll/my` | `payroll.payslip.read_own` ; enseignant, instituteur, personnel | liste de ses bulletins arrêtés | 13.20 |
| Paie | Un de mes bulletins | `/v2/payroll/my/[id]` | `payroll.payslip.read_own` | document figé en lecture, renvoi vers la gestion pour contester | 13.20 |
| Portail enseignant | Mes bulletins de paie | `/v2/teacher/payslips` | `payroll.payslip.read_own` ; enseignant, instituteur, personnel | liste de ses bulletins arrêtés, contestés, versés | 13.10, 13.11, 13.15 |
| Portail enseignant | Un bulletin de paie | `/v2/teacher/payslips/[id]` | `payroll.payslip.read_own` (+ `payroll.my.dispute` pour contester) | document figé, PDF (après versement), contestation motivée | 13.10, 13.11, 13.15, 13.21 |

---

| Module | Écran | URL | Rôles/permissions | Fonctions | Chapitre-scénario |
|---|---|---|---|---|---|
| Documents | Explorateur | `/v2/documents` | une permission de lecture du module (`documents.read`, `.read.restricted`, `.read.confidential`, `.manage`, `child.read`, `self.read`, `own.read`) | liste filtrée, dépôt d'un document (types, tailles, catégories, visibilité, échéance) | 14.1 à 14.4, 14.6, 14.10, 14.12 |
| Documents | Fiche d'un document | `/v2/documents/[id]` | idem + droit sur le document (niveau, déposant, partage, droit de catégorie, propriétaire, tuteur) | détail, versions, aperçu, téléchargement, modification, partage, historique, archivage, restauration | 14.5 à 14.7, 14.9, 14.11, 14.13, 14.14, 14.18 |
| Documents | Recherche dans les PDF | `/v2/documents/search` | même permission que l'explorateur ; réindexation : `documents.manage` | recherche plein texte, extraits, état de l'index, réindexation | 14.8 |
| Documents | Échéances | `/v2/documents/expirations` | même permission que l'explorateur | compteurs, onglets à échoir / échus / sans échéance, horizon | 14.4, 14.15 |
| Documents | Catégories | `/v2/documents/categories` | `documents.category.manage` ; propriétaire, directeur | création, modification, droits par personne, archivage/restauration | 14.1, 14.15 |
| Documents | Quarantaine | `/v2/documents/quarantine` | `documents.quarantine.manage` ; propriétaire, directeur | liste par état, libération et destruction motivées | 14.17 (lecture seule ; Non couvert : alimentation de la quarantaine sans antivirus) |
| Documents | Paramètres | `/v2/documents/settings` | `documents.settings.manage` ; propriétaire, directeur | stockage utilisé, taille maximale, quota, seuils, conservation, versions maximales | 14.16 |

---

| Module | Écran | URL | Rôles/permissions | Fonctions | Chapitre-scénario |
|---|---|---|---|---|---|
| Messagerie | Boîte de réception | `/v2/messages` | `messaging.read`, `messaging.child.read`, `messaging.self.read` (tous les rôles) | liste par dossier (Boîte de réception, Favoris, Archivés, Envoyés), recherche objet/personnes et texte, non lus, pagination | 15.1, 15.34 |
| Messagerie | Nouveau message | `/v2/messages/new` | `messaging.send`, `.send.any`, `.child.send`, `.self.send` (portée calculée par les règles R1 à R5) | message direct, de groupe, diffusion (classes, toute l'école), pièces jointes, priorité | 15.2, 15.3, 15.6, 15.8, 15.9, 15.10 |
| Messagerie | Fil de conversation | `/v2/messages/{id}` | lecture messagerie (participant) | lecture (marque lu), réponse, favori, sourdine, archivage, quitter un groupe, retirer son message, signaler | 15.4, 15.5, 15.7, 15.11, 15.21 |
| Messagerie | Notifications et préférences de messagerie | `/v2/messages/notifications` | lecture messagerie | liste, marquer lu, tout marquer lu, préférences par catégorie, silence | 15.20 |
| Messagerie | Modération | `/v2/messages/moderation` | `messaging.moderation.read` (Propriétaire, Directeur) ; décision `.manage` ; supervision `.supervise` | signalements (examiner, rejeter, sanctionner, restreindre), restrictions (lever), supervision motivée | 15.22, 15.23, 15.34 |
| Messagerie | Paramètres de la messagerie | `/v2/messages/settings` | `messaging.settings.manage` (Propriétaire, Directeur) | politique élèves, contacts d'administration, pièces jointes, plafonds, messages automatiques | 15.24, 15.25, 15.34 |
| Annonces | Liste des annonces | `/v2/announcements` | lecture messagerie ou permission de publication | boîte « Reçues », « Publiées par moi », filtres statut, non lues, expirées | 15.12, 15.13, 15.19 |
| Annonces | Nouvelle annonce | `/v2/announcements/new` | `messaging.announcement.publish`, `.publish_class`, `.manage` | ciblage, audiences, programmation, expiration, accusé, épinglage, brouillon, publication, comptage | 15.14, 15.15, 15.17 |
| Annonces | Fiche d'une annonce | `/v2/announcements/{id}` | lecture messagerie ou publication ; gestion : auteur ou `.manage` | lecture, accusé de réception, statistiques, accusés de lecture, publier, retirer avec motif, supprimer le brouillon | 15.12, 15.13, 15.18 |
| Annonces | Modification d'une annonce | `/v2/announcements/{id}/edit` | `messaging.announcement.publish`, `.publish_class`, `.manage` | modification d'un brouillon ou d'une annonce programmée ; contenu figé après publication | 15.16 |
| Notifications | Journal des envois | `/v2/notifications` | `notifications.read` ou gestion des gabarits, règles, réglages | liste filtrée, statistiques par période, statuts (Simulé, Non envoyé…) | 15.26, 15.34 |
| Notifications | Envoyer un message | `/v2/notifications/send` | `notifications.send` ou `notifications.send.urgent` (urgence : Propriétaire, Directeur) | envoi manuel (convocation, annonce, avis urgent), audiences, canaux, stratégie, confirmation | 15.27, 15.28 |
| Notifications | Gabarits | `/v2/notifications/templates` | lecture `notifications.read` ; édition `notifications.templates.manage` | aperçu, variables, nouvelle version, activation, retour au gabarit livré | 15.29 |
| Notifications | Règles | `/v2/notifications/rules` | lecture `notifications.read` ; édition `notifications.rules.manage` | consulter, modifier, rétablir la règle livrée | 15.30 |
| Notifications | Canaux d'envoi | `/v2/notifications/channels` | lecture `notifications.read` ; réglages et essai `notifications.settings.manage` | état des canaux, essai, plafonds, heures calmes, consentement, tentatives | 15.31 |
| Notifications | Désinscription publique | `/v2/notifications/unsubscribe` | aucune (lien signé) | confirmation de désinscription d'un canal | 15.33 (cas lien absent ou invalide seulement) |
| Compte | Mes notifications | `/v2/account/notifications` | `notifications.own.manage`, `.child.manage`, `.self.manage` | canaux et catégories, heures calmes, appareils push | 15.32 |

---

| Module | Écran | URL | Rôles/permissions | Fonctions | Chapitre-scénario |
|---|---|---|---|---|---|
| Direction | Tableau de bord de la direction | `/v2/direction` | `analytics.read` (Propriétaire, Directeur) ; bloc financier : `analytics.finance.read` | cartes d'indicateurs, fraîcheur, filtres, liens | 16.1, 16.2, 16.5 |
| Direction | Effectifs et présences | `/v2/direction/effectifs` | `analytics.read` ; présence : `analytics.attendance.read` ; export `analytics.export` | répartitions, effectifs par classe, admissions, fenêtre de présence, export CSV | 16.2, 16.3, 16.4 |
| Pilotage | Indicateurs de direction (hub) | `/v2/analytics` | `analytics.read` ; chaque bloc : sa permission de données | 8 blocs, masse salariale à la demande | 16.6 |
| Pilotage | Admissions (entonnoir) | `/v2/analytics/admissions` | `analytics.admissions.read` (Propriétaire, Directeur, Directeur des études, Chargé d'admissions) | entonnoir par statut et étape, places, export | 16.7, 16.26 |
| Pilotage | Vie scolaire (agrégée) | `/v2/analytics/vie-scolaire` | `analytics.schoollife.read` (Propriétaire, Directeur, Directeur des études) | 4 comptages, export | 16.8 |
| Pilotage | Alertes de direction | `/v2/analytics/alertes` | `analytics.alerts.read` + droit de données de l'indicateur ; accusé : `analytics.alerts.acknowledge` | liste, filtres, détail, accusé de réception, export historique | 16.20, 16.21, 16.23 |
| Pilotage | Règles d'alerte | `/v2/analytics/alertes/regles` | lecture `analytics.alerts.read` ; création et modification `analytics.alerts.manage` | liste, création, modification, activation | 16.17, 16.18, 16.19, 16.21, 16.22 |
| Pilotage | Comparaisons | `/v2/analytics/comparaisons` | `analytics.read` (domaines selon droits de données) | comparaison effectifs, assiduité, résultats, recouvrement | 16.14 |
| Propriétaire | Redirection de l'espace propriétaire | `/v2/owner` | aucune garde propre (redirige vers `/v2/direction`) | redirection | 16.24 |
| Propriétaire | Pédagogie | `/v2/owner/pedagogie` | `analytics.pedagogy.read` (Propriétaire, Directeur, Directeur des études) | résultats, distribution, décisions, matières, charge d'enseignement, exports | 16.5, 16.9 |
| Propriétaire | Scolarité | `/v2/owner/scolarite` | `analytics.finance.read` (Propriétaire, Directeur, Économe) | recouvrement, créances par classe ou apprenant, export | 16.10, 16.25 |
| Propriétaire | Trésorerie | `/v2/owner/tresorerie` | `analytics.treasury.read` (Propriétaire, Directeur, Économe) | encaissements, créances âgées, écarts de caisse, exports | 16.11, 16.25 |
| Propriétaire | Masse salariale | `/v2/owner/paie` | `analytics.payroll.read` (sensible, MFA) + offre `analytics.payroll-insights` | masse par période, export | 16.12 |
| Propriétaire | Charges et résultat | `/v2/owner/charges` | `analytics.charges.read` (Propriétaire, Directeur) | message de module absent | 16.13 |
| Propriétaire | Fraîcheur des données | `/v2/owner/fraicheur` | `analytics.read` ; reconstruction `analytics.rebuild` ; réglages `analytics.settings.manage` | états des sources, reconstruction, seuils de lecture | 16.15 |

---

| Module | Écran | URL | Rôles/permissions | Fonctions | Chapitre-scénario |
|---|---|---|---|---|---|
| Admissions | Pipeline des candidatures | `/v2/admissions` | `admission.read` (directeur, propriétaire, chargé d'admissions, secrétariat) | liste par étape, filtre campagne et niveau, déplacement d'un dossier | 17.1, 17.2 |
| Admissions | Liste des candidatures | `/v2/admissions/applications` | `admission.read` | filtres statut, niveau, recherche, délai dépassé ; pagination | 17.3 |
| Admissions | Nouvelle candidature | `/v2/admissions/applications/new` | `admission.create` | création d'un dossier (candidat, 1 à 4 tuteurs) | 17.10 |
| Admissions | Dossier de candidature | `/v2/admissions/applications/[id]` | `admission.read` ; actions selon `admission.update`, `admission.decide`, `admission.document.upload`/`review`/`attach`, `admission.interview.manage`, `admission.offer.manage`, `admission.enroll`, `admission.duplicate.resolve`, `admission.export`, `admission.anonymize` | modifier, consentement, étapes et décisions, pièces, entretiens, offres, doublons, historique, export, anonymisation, rattachement à la GED | 17.4, 17.11 à 17.17, 17.23, 17.24, 17.25 |
| Admissions | Campagnes d'admission | `/v2/admissions/campaigns` | `admission.campaign.manage` ou `admission.read` (lecture seule sans la première) | créer, ouvrir, clôturer, capacités par niveau | 17.5 |
| Admissions | Prospects | `/v2/admissions/prospects` | `admission.prospect.manage` | créer, marquer contacté, convertir en candidature, perdu | 17.9 |
| Admissions | Rapports de recrutement | `/v2/admissions/reports` | `admission.report.read` | entonnoir, capacités, délais, sources, motifs de refus | 17.21 |
| Admissions | Paramètres d'admission | `/v2/admissions/settings` | `admission.settings.manage` (directeur, propriétaire) | politiques, textes de consentement, lien public, pièces, motifs, priorités | 17.6, 17.7, 17.8 |
| Admissions | Workflow d'admission | `/v2/admissions/settings/workflow` | `admission.workflow.manage` (publier : `admission.workflow.publish`, sensible) | lire, créer un brouillon, éditer étapes et transitions, supprimer | 17.22 |
| Admissions | Listes d'attente | `/v2/admissions/waitlist` | `admission.waitlist.manage` (ordre : `admission.waitlist.reorder`, direction) | lecture par niveau, ordre manuel, promotion | 17.20 |
| Portail public | Formulaire de candidature | `/v2/apply/[school]` | public, sans connexion | dépôt d'une candidature par la famille (fermé tant que le réglage d'ouverture n'est pas posé) | 17.26 (ouverture non atteignable depuis l'interface : voir Écarts) |
| Portail public | Réponse à une offre | `/v2/apply/[school]/offer` | public, sans connexion | accepter ou décliner une offre (jeton dans le fragment `#t=`) | 17.18 |
| Portail public | Suivi de candidature | `/v2/apply/[school]/track` | public, sans connexion | suivi par code, dépôt de pièces demandées | 17.26 (cas positif non atteignable sans formulaire ouvert) |

---

| Module | Écran | URL | Rôles/permissions | Fonctions | Chapitre-scénario |
|---|---|---|---|---|---|
| Pack Primaire | Index du pack | `/v2/primary` | au moins une permission `primary.*` | redirection : direction vers `/v2/primary/direction`, famille vers `/v2/primary/mon-enfant`, instituteur vers `/v2/primary/classe` | 18.1 |
| Pack Primaire | Ma classe | `/v2/primary/classe` | `primary.competency.read`/`record`, `primary.council.read`/`prepare` ou `primary.class.read_all` (instituteur, direction, directeur des études, secrétariat) | classes, périodes, appel du jour, marquer ou retirer l'état "prête" | 18.3, 18.4, 18.7 |
| Pack Primaire | Compétences | `/v2/primary/competences` | `primary.competency.read`/`record` ; valider : `primary.competency.validate` ; réviser : `primary.competency.revise` (direction) | grille élèves × compétences, saisie sans note, remplissage, validation, révision, synthèse par compteurs | 18.5, 18.6, 18.8 |
| Pack Primaire | Appréciations | `/v2/primary/appreciations` | `primary.phrase.read` (instituteur) ou `primary.phrase.manage` (directeur, directeur des études) | banque de phrases, rédaction, création et activation de phrases | 18.9 |
| Pack Primaire | Conseil des maîtres | `/v2/primary/conseil` | `primary.council.read`/`prepare` (instituteur) ou `primary.council.manage` (direction) | préparer, proposer, feuille de présence, décider, procès-verbal | 18.10, 18.11, 18.12 |
| Pack Primaire | Avancement des classes | `/v2/primary/direction` | `primary.report.read` (directeur, directeur des études, secrétariat) | feux d'avancement par classe et période | 18.2 |
| Pack Primaire | Bilans annuels | `/v2/primary/bilans` | `primary.bilan.read`/`prepare` ; sceller `primary.bilan.seal`, réémettre `primary.bilan.reissue` (direction) | lire, préparer les brouillons, sceller (irréversible), réémettre | 18.13, 18.14 |
| Pack Primaire | Archives d'année | `/v2/primary/archives` | `primary.archive.prepare`, `primary.archive.freeze` ou `primary.bilan.read` (lecture) | préparer l'archive, empêchements, geler (non atteignable) | 18.15 |
| Pack Primaire | États du primaire | `/v2/primary/etats` | `primary.report.read` | sept états en aperçu et export CSV | 18.16 |
| Pack Primaire | Paramètres du pack | `/v2/primary/parametres` | `primary.settings.manage` (direction) ; modèle : `primary.template.apply` ; échelles, référentiels : `primary.scale.manage`, `primary.framework.*` | réglages, modèle de pack, échelles, référentiels | 18.17 |
| Pack Primaire | Bulletin et compétences de mon enfant | `/v2/primary/mon-enfant` | `primary.bilan.child.read`, `primary.bilan.self.read` ou `primary.competency.child.read`/`self.read` (parent, élève) | bilans scellés publiés, compteurs de compétences | 18.18 |

---

| Module | Écran | URL | Rôles/permissions | Fonctions | Chapitre-scénario |
|---|---|---|---|---|---|
| Vie scolaire | Tableau de bord | `/v2/schoollife` | `schoollife.read.all` : directeur, propriétaire, directeur des études, éducateur | indicateurs, listes incidents/mesures/convocations, accès fiche | 19a : 19.1, 19.2, 19.3 |
| Vie scolaire | Saisie rapide | `/v2/schoollife/saisie` | `schoollife.read` : directeur, propriétaire, éducateur, enseignant (menu portail enseignant) ; incident : `incident.write`, notes : `note.write` | déclarer un incident, encourager, noter une observation | 19a : 19.5, 19.6, 19.18, 19.20 |
| Vie scolaire | Fiche de vie scolaire d'un élève | `/v2/schoollife/eleves/[studentId]` | `schoollife.read` (enseignant limité à ses classes) | chronologie, retards/absences (lecture), points de conduite, historique, proposer une mesure, convoquer, retirer une note, lecture confidentielle avec motif, ajuster les points | 19a : 19.4, 19.7, 19.8, 19.9, 19.11, 19.18, 19.21 |
| Vie scolaire | Mesures à valider | `/v2/schoollife/validations` | `schoollife.measure.validate` : directeur, propriétaire (exclusion : `exclusion.validate`, effets : `exclusion.apply`, recours : `appeal.decide`, révocation : `measure.revoke`) | valider, rejeter, annuler, notifier la famille, marquer exécutée, révoquer, trancher un recours, appliquer/écarter l'effet d'une exclusion | 19a : 19.10, 19.11, 19.12, 19.14, 19.17 |
| Vie scolaire | Convocations | `/v2/schoollife/convocations` | `schoollife.convocation.manage` : éducateur, directeur, propriétaire | créer, envoyer, tenir, absent, reporter, annuler, filtrer | 19a : 19.15, 19.16 |
| Vie scolaire | Paramètres de vie scolaire | `/v2/schoollife/parametres` | `schoollife.settings.manage` : directeur, propriétaire (barèmes : `conduct.manage`) | réglages d'établissement, niveaux de gravité, types d'événements, barèmes de conduite | 19a : 19.19, 19.20, 19.21 |
| Vie scolaire | Vie scolaire de mes enfants (parent) | `/v2/schoollife/famille` | `schoollife.child.read` : parent | décisions notifiées, encouragements partagés, convocations, accuser réception, déposer un recours | 19a : 19.13, 19.14, 19.15 |
| Vie scolaire | Ma vie scolaire (élève) | `/v2/schoollife/moi` | `schoollife.self.read` : élève | décisions notifiées et encouragements partagés, recours | 19a : 19.22 |
| Conseils de classe | Calendrier des conseils | `/v2/councils` | `council.read` : directeur, propriétaire, directeur des études, secrétariat, enseignant (menu portail) ; planifier : `council.manage` | liste filtrable, synthèse de classe, planifier un conseil | 19b : 19.25, 19.26, 19.28 |
| Conseils de classe | Effets des décisions | `/v2/councils/effets` | `council.effect.manage` : directeur, propriétaire, directeur des études (exclusion : `council.exclusion.apply`) | file des effets, filtres, relancer, appliquer, abandonner, annuler | 19b : 19.44, 19.45 |
| Conseils de classe | Orientation | `/v2/councils/orientation` | `council.orientation.read` : directeur, propriétaire, directeur des études (gestion : `orientation.manage`, dérogation : `orientation.override`) | parcours autorisés, dossiers d'orientation, vœux, consentement, transferts de série | 19b : 19.46, 19.47, 19.48 |
| Conseils de classe | Paramètres des conseils | `/v2/councils/parametres` | `council.settings.manage` : directeur, propriétaire, directeur des études | rôles de participants, types de conseil, types de décision, réglages d'établissement | 19b : 19.32, 19.49 |
| Conseils de classe | Décisions de mes enfants (parent) | `/v2/councils/famille` | `council.child.read` : parent | décisions visibles, orientation, vœux, accord de la famille | 19b : 19.50, 19.51 |
| Conseils de classe | Mes décisions (élève) | `/v2/councils/moi` | `council.self.read` : élève | décisions visibles, orientation en lecture seule | 19b : 19.50, 19.51 |
| Conseils de classe | Dossier de classe d'une séance | `/v2/councils/[councilId]` | `council.read` (actions : `manage`, `prepare`, `session.run`) | état, quorum, participants et présence, ordre du jour, préparer, convoquer, ouvrir, clore, modifier, annuler | 19b : 19.27, 19.29, 19.30, 19.31, 19.33, 19.38 |
| Conseils de classe | Délibération (mode séance) | `/v2/councils/[councilId]/deliberation` | `council.read` (décision : `council.decision.record`) | navigation élève par élève, saisie d'une décision | 19b : 19.36 |
| Conseils de classe | Fiche d'un élève dans la séance | `/v2/councils/[councilId]/eleves/[itemId]` | `council.read` (propositions : `proposal.write`, décisions : `decision.record`) | faits figés, suggestions, propositions, décisions, marquer examiné, reconstruire | 19b : 19.34, 19.35, 19.36, 19.37 |
| Conseils de classe | Historique de la séance | `/v2/councils/[councilId]/historique` | `council.read` | journal de séance, demandes de déverrouillage | 19b : 19.43 |
| Conseils de classe | Procès-verbal | `/v2/councils/[councilId]/pv` | `council.minutes.read` : directeur, propriétaire, directeur des études, secrétariat (générer : `minutes.generate`, signer : `minutes.sign`, révoquer : `minutes.revoke`, déverrouillage : `unlock.request` / `unlock.approve`) | générer, PDF, signatures électronique et papier, révoquer, demander/approuver/refuser un déverrouillage, rouvrir | 19b : 19.39, 19.40, 19.41, 19.42 |
| Élèves affectés par l'État | Liste des dossiers | `/v2/stateassign` | `stateassign.read` / `verify` / `reconcile` / `record` : directeur, propriétaire, secrétariat, économe, directeur des études | liste filtrable, enregistrer un dossier | 19c : 19.54, 19.56 |
| Élèves affectés par l'État | Fiche d'un dossier | `/v2/stateassign/[id]` | mêmes permissions de lecture ; actes : `record`, `verify`, `manage`, `amend`, `reconcile`, `receivable.manage`, `control.perform`, `document.manage` | corriger, vérifier, rejeter, activer, suspendre, reprendre, terminer, transférer, amender, rapprocher, créances, contrôles, pièces | 19c : 19.55, 19.57, 19.58, 19.60, 19.62, 19.64, 19.65, 19.66, 19.67 |
| Élèves affectés par l'État | Vérification des affectations | `/v2/stateassign/verification` | `stateassign.verify` : directeur, propriétaire | file "à vérifier" et "vérifiés, à activer" | 19c : 19.59 |
| Élèves affectés par l'État | Rapprochement des affectations | `/v2/stateassign/reconciliation` | `stateassign.reconcile` ou `read` : économe, directeur, secrétariat et directeur des études (lecture) | écarts facturé − déclaré, compteurs, rapprocher, contrôles à faire et anomalies | 19c : 19.61, 19.64 |
| Élèves affectés par l'État | Créances sur l'État | `/v2/stateassign/receivables` | `stateassign.read` ou `receivable.manage` | liste des échéances, ancienneté, filtres | 19c : 19.62, 19.63 |
| Élèves affectés par l'État | États des affectations | `/v2/stateassign/reports` | `stateassign.read` ou `export` (export CSV : `stateassign.export` : économe, directeur) | tableau de bord, exports CSV, état de la passerelle | 19c : 19.68 |
| Élèves affectés par l'État | Paramètres des affectations | `/v2/stateassign/settings` | `stateassign.settings.manage` : directeur, propriétaire | séparation des tâches, tolérance, contrôles exigés, délai de grâce, formats d'export | 19c : 19.69 |
| Élèves affectés par l'État | Affectation de mon enfant (parent) | `/v2/stateassign/family` | `stateassign.child.read` : parent | statut du dossier de chaque enfant (sans montants) | 19c : 19.70 |

---

| Module | Écran | URL | Rôles/permissions | Fonctions | Chapitre-scénario |
|---|---|---|---|---|---|
| Examens | Sessions d'examen (liste) | `/v2/examinations` | `exam.session.read` (examens, directeur, études, propriétaire) ; création : `exam.session.manage` | Liste filtrable (état, nature), création de session officielle ou blanche | 20.1, 20.7, 20.35, 20.36 |
| Examens | Détail d'une session | `/v2/examinations/sessions/[id]` | `exam.session.read` ; actions : `exam.session.manage` ; publication : en plus `exam.result.publish` | Parcours, effectifs, copie et gel de la définition, changements d'état, blocages, liens vers les écrans | 20.8, 20.16, 20.19, 20.21, 20.26, 20.29 |
| Examens | Candidats | `/v2/examinations/candidates` | `exam.candidate.read` ou `exam.candidate.manage` ; candidats libres : `exam.external.manage` ; évaluation : `exam.eligibility.evaluate` | Ajout d'une classe, évaluation de l'éligibilité, filtres, inscription en lot, candidats libres (saisie, import CSV) | 20.9, 20.10, 20.11, 20.12, 20.34, 20.37 |
| Examens | Fiche candidat | `/v2/examinations/candidates/[id]` | `exam.candidate.read` ou `exam.candidate.manage` ; dérogation : `exam.eligibility.override` ; données restreintes : `exam.external.read` ; anonymisation : `exam.external.anonymize` ; frais : `exam.fee.read` | Éligibilité (règle, manuelle, dérogation), pièces, identifiants officiels, inscription, retrait, documents, historique | 20.10, 20.13, 20.14, 20.17, 20.37 |
| Examens | Répartition | `/v2/examinations/assignments` | `exam.center.manage` ou `exam.session.read` (lecture seule sans la gestion) | Choix des centres, répartition automatique, changement et retrait de place | 20.15, 20.19, 20.38 |
| Examens | Centres et salles | `/v2/examinations/centers` | `exam.center.manage` (examens, directeur, propriétaire) | Création de centres et de salles, activation et désactivation | 20.6, 20.36 |
| Examens | Examens blancs | `/v2/examinations/mock` | `exam.mock.manage` (examens, directeur, propriétaire) | Liens épreuve-évaluation, reprise des notes publiées, calcul par la règle | 20.30, 20.34 |
| Examens | Notes et résultats | `/v2/examinations/results` | `exam.result.read`, `exam.result.enter` ou `exam.score.enter` ; publication d'une ligne : `exam.result.publish` | Notes par épreuve (saisie en lot), saisie des résultats de l'autorité, publication d'un résultat | 20.16, 20.20, 20.21, 20.23, 20.31, 20.39 |
| Examens | Imports de l'autorité | `/v2/examinations/imports` | `exam.import.manage` ; application du lot : `exam.result.release` (direction) | Dépôt de fichier, analyse, rapport d'erreurs, application atomique | 20.33, 20.39 |
| Examens | Corrections | `/v2/examinations/corrections` | `exam.result.read` ou `exam.result.revise` ; demande : `exam.result.enter` ; décision : `exam.result.revise` | Demande de correction de note ou de résultat, approbation, rejet, règle des quatre yeux | 20.22, 20.23, 20.24, 20.27 |
| Examens | Statistiques | `/v2/examinations/statistics` | `exam.statistics.read` | Effectifs et taux par groupe, comparaison (année précédente, examen blanc) | 20.25, 20.32, 20.41 |
| Examens | Exports et documents | `/v2/examinations/exports` | `exam.export.run` (exports) ou `exam.document.issue` (documents) | Exports par format publié, convocations, attestations, relevés, révocation | 20.17, 20.27, 20.31, 20.33, 20.38, 20.40, 20.41 |
| Examens | Types d'examens | `/v2/examinations/types` | `exam.type.read` ; gestion : `exam.type.manage` ; barème des frais : `exam.fee.read` | Création de type, filières, épreuves, chargement du pack CEPE, transmission aux admissions, barème (lecture) | 20.2, 20.3, 20.4, 20.5, 20.35 |
| Examens | Examen de l'élève (famille) | `/v2/examinations/family` | `exam.document.child.read` (parent) ou `exam.document.self.read` (élève) | Inscription, place, issue publiée et documents de l'enfant ou de l'élève | 20.18, 20.28, 20.41 |

---

## Inventaire : portails parent, élève, enseignant (fragment du chapitre 21)

Les adresses sont celles du navigateur : l'arborescence `apps/web/src/app/v2/` donne directement `/v2/...` (aucun préfixe supplémentaire, aucune réécriture dans `next.config.js` ni dans `middleware.ts`, qui ne fait qu'ajouter des en-têtes). La garde de chaque `layout.tsx` ouvre le portail, puis chaque page ajoute sa permission ; sans droit, la garde serveur renvoie vers `/unauthorized` (page « Accès refusé »), sans session vers `/login`.

Rôles qui détiennent les permissions (modèles de `apps/api/src/modules/rbac/templates/system-roles.ts`) : `*.child.*` = **Parent** seul ; `*.self.*` = **Élève** seul ; `schedule.own.read` / `staff.own.read` = **Enseignant**, **Instituteur** (et `personnel` ; l'**Éducateur** détient `staff.own.read`, voir « À vérifier » du chapitre).

| Module | Écran | URL | Rôles/permissions | Fonctions | Chapitre-scénario |
|---|---|---|---|---|---|
| Portail parent | Mes enfants (accueil) | `/v2/parent` | Parent : `student.child.read` | liste des enfants liés, repères de chacun (moyenne, absences, scolarité, séances), lien « Ouvrir » | 21 / 21.1, 21.2, 21.14 |
| Portail parent | Paramètres du compte | `/v2/parent/account` | Parent : `student.child.read` (+ `student.child.update` pour le formulaire) ; liens de sécurité si l'authentification v2 est active | identité en lecture seule, modification de ses coordonnées (e-mail, téléphones, adresse, ville, quartier), liens sécurité / sessions / établissements | 21 / 21.13 |
| Portail parent | Tableau de bord d'un enfant | `/v2/parent/children/[childId]` | Parent : `student.child.read` + lien de tutelle vivant avec accès portail | repères du moment, carte « Annonces », sélecteur « Enfant », onglets | 21 / 21.3 |
| Portail parent | Résultats d'un enfant | `/v2/parent/children/[childId]/results` | Parent : `grade.child.read` ou `result.child.read` | résultats officiels (période, année), détail par matière, notes publiées filtrables par période, « Afficher plus » | 21 / 21.4 |
| Portail parent | Bulletins d'un enfant | `/v2/parent/children/[childId]/reportcards` | Parent : `reportcard.child.read` | liste des bulletins publiés, « Télécharger le PDF », « Vérifier l'authenticité » (code, QR), lien vers la vérification publique | 21 / 21.5 |
| Portail parent | Absences d'un enfant | `/v2/parent/children/[childId]/attendance` | Parent : `attendance.child.read` (+ `attendance.child.justify`) | récapitulatif, absences et retards, justificatifs, « Déposer un justificatif », « Justifier », « Retirer ce justificatif » | 21 / 21.6 |
| Portail parent | Emploi du temps d'un enfant | `/v2/parent/children/[childId]/schedule` | Parent : `schedule.child.read` | vue semaine / jour, navigation, séances annulées | 21 / 21.7 |
| Portail parent | Évaluations à venir d'un enfant | `/v2/parent/children/[childId]/upcoming` | Parent : `schedule.child.read` | examens et contrôles planifiés à 30 jours | 21 / 21.7 |
| Portail parent | Scolarité d'un enfant | `/v2/parent/children/[childId]/finance` | Parent : `finance.child.read` (+ `finance.child.pay` et fonction `finance.online-payment` pour « Payer en ligne ») | situation, échéances, factures dépliables, paiements, reçus, paiement en ligne (simulé), suivi du paiement | 21 / 21.8, 21.9 |
| Portail parent | Reçu d'un enfant | `/v2/parent/children/[childId]/finance/receipts/[id]` | Parent : `finance.child.read` | détail du reçu, PDF, impression | 21 / 21.10 |
| Portail parent | Documents d'un enfant | `/v2/parent/children/[childId]/documents` | Parent : l'une de `reportcard.child.read`, `finance.child.read`, `higher.child.read` | lecture seule : bulletins, reçus, diplômes et attestations ; aucun dépôt | 21 / 21.11 |
| Portail parent | Dossier et contacts d'un enfant | `/v2/parent/children/[childId]/emergency` | Parent : `student.child.read` (+ `student.child.update` pour « Modifier ») | dossier, responsables, inscriptions, correction des contacts d'urgence (pas d'ajout ni de retrait) | 21 / 21.12 |
| Portail élève | Mon dossier (accueil) | `/v2/student` | Élève : `student.self.read` | fiche, repères du moment, inscriptions, carte « Annonces » | 21 / 21.16 |
| Portail élève | Mon dossier détaillé | `/v2/student/me` | Élève : `student.self.read` (+ `student.self.update`) | identité, classe, coordonnées, tuteur principal, inscriptions, « Mettre à jour mes coordonnées » ; **aucun lien de menu** (atteint par adresse) | 21 / 21.21 |
| Portail élève | Mon profil | `/v2/student/profile` | Élève : `student.self.read` (+ `student.self.update`) | identité en lecture seule, coordonnées modifiables | 21 / 21.21 |
| Portail élève | Mes résultats | `/v2/student/results` | Élève : `grade.self.read` ou `result.self.read` | résultats officiels et notes publiées | 21 / 21.17 |
| Portail élève | Mes bulletins | `/v2/student/reportcards` | Élève : `reportcard.self.read` | bulletins publiés, PDF, vérification | 21 / 21.17 |
| Portail élève | Mon emploi du temps | `/v2/student/schedule` | Élève : `schedule.self.read` | vue semaine / jour | 21 / 21.17 |
| Portail élève | Évaluations à venir | `/v2/student/upcoming` | Élève : `schedule.self.read` | examens planifiés à 30 jours | 21 / 21.17 |
| Portail élève | Mes absences | `/v2/student/attendance` | Élève : `attendance.self.read` (+ `attendance.self.justify`) | absences, justificatifs, dépôt, retrait | 21 / 21.18 |
| Portail élève | Ma scolarité | `/v2/student/finance` | Élève : `finance.self.read` (+ `finance.self.pay` et fonction `finance.online-payment`) | situation, échéances, factures, paiements, reçus, paiement en ligne (simulé) | 21 / 21.19 |
| Portail élève | Reçu de l'élève | `/v2/student/finance/receipts/[id]` | Élève : `finance.self.read` | détail du reçu, PDF, impression | 21 / 21.19, 21.22 |
| Portail élève | Mes documents | `/v2/student/documents` | Élève : l'une de `reportcard.self.read`, `finance.self.read`, `higher.self.read` | lecture seule : bulletins, reçus, diplômes ; aucun dépôt | 21 / 21.20 |
| Portail enseignant | Aujourd'hui | `/v2/teacher` | Enseignant, Instituteur : `schedule.own.read` | séances du jour, état de l'appel, « Faire l'appel », « Saisir les notes » | 21 / 21.24 |
| Portail enseignant | Mes classes | `/v2/teacher/classes` | Enseignant, Instituteur : `staff.own.read` | classes où l'on est affecté, matières, rôle, gestes rapides | 21 / 21.25 |
| Portail enseignant | Élèves d'une classe | `/v2/teacher/classes/[classroomId]` | Enseignant, Instituteur : `student.class.read` ou `staff.own.read` ; la classe doit figurer dans "mes classes" | liste des élèves (nom, matricule, statut), garde "classe étrangère" | 21 / 21.25, 21.26 |
| Portail enseignant | Mes congés et ma présence | `/v2/teacher/leaves` | Enseignant, Instituteur : l'une de `attendance.own.read`, `attendance.own.record`, `attendance.leave.request` + fonction `attendance.staff` | pointage arrivée / départ, demande de congé, annulation | 21 / 21.27 |
| Portail enseignant | Mon profil | `/v2/teacher/profile` | Enseignant, Instituteur : `staff.own.read` (+ `staff.own.update`) | fiche, affectations, coordonnées modifiables | 21 / 21.28 |
| Portail enseignant | Mes évaluations | `/v2/teacher/assessments` | Enseignant, Instituteur : `assessment.read`, `grade.read` ou `grade.enter` | liste, filtre par classe | Couvert par le chapitre 08 (évaluations et notes) ; renvoi depuis 21.30 |
| Portail enseignant | Nouvelle évaluation | `/v2/teacher/assessments/new` | Enseignant, Instituteur : `assessment.create` | création d'une évaluation | Couvert par le chapitre 08 |
| Portail enseignant | Détail d'une évaluation | `/v2/teacher/assessments/[id]` | Enseignant, Instituteur : `assessment.read` | détail, circuit de validation | Couvert par le chapitre 08 |
| Portail enseignant | Grille de notes | `/v2/teacher/assessments/[id]/grades` | Enseignant, Instituteur : `grade.read` / `grade.enter` | saisie des notes, hors ligne | Couvert par le chapitre 08 ; hors ligne : 22 / 22.30 |
| Portail enseignant | Mes appels | `/v2/teacher/attendance` | Enseignant, Instituteur : `attendance.take` | séances à faire, historique 30 jours, file hors ligne | Couvert par le chapitre 06 (présences) ; hors ligne : 22 / 22.29 |
| Portail enseignant | Choix d'un appel | `/v2/teacher/attendance/call` | Enseignant, Instituteur : `attendance.take` | choix de la séance / de la classe | Couvert par le chapitre 06 |
| Portail enseignant | Faire l'appel | `/v2/teacher/attendance/call/[kind]/[id]` | Enseignant, Instituteur : `attendance.take` | appel par séance (`occurrence`) ou journalier (`daily`) | Couvert par le chapitre 06 ; hors ligne : 22 / 22.29 |
| Portail enseignant | Mon emploi du temps | `/v2/teacher/schedule` | Enseignant, Instituteur : `schedule.own.read` | semaine / jour, copie hors ligne | Couvert par le chapitre 07 (emploi du temps) ; hors ligne : 22 / 22.28 |
| Portail enseignant | Export du calendrier | `/v2/teacher/schedule/export` | Enseignant, Instituteur : `schedule.own.read` | export ICS, jetons révocables | Couvert par le chapitre 07 |
| Portail enseignant | Mes bulletins de paie | `/v2/teacher/payslips` | Enseignant, Instituteur : `payroll.payslip.read_own` | liste des bulletins arrêtés | Couvert par le chapitre 13 (paie) |
| Portail enseignant | Bulletin de paie | `/v2/teacher/payslips/[id]` | Enseignant, Instituteur : `payroll.payslip.read_own` (+ `payroll.my.dispute`) | document figé, PDF, contestation | Couvert par le chapitre 13 |
| Hors App Router `/v2` | Page hors ligne | `/offline` | public (aucune session) | « Vous êtes hors ligne », « Réessayer la connexion », copie de l'emploi du temps | 22 / 22.24 à 22.27 |

### Composants communs (aucune page, donc aucune adresse)

| Dossier | Contenu | Utilisé par | Chapitre-scénario |
|---|---|---|---|
| `app/v2/_family/` | `FamilySnapshot` (4 cartes + « Annonces »), `FamilyResults`, `FamilyReportCards`, `FamilySchedule`, `FamilyUpcoming`, `FamilyFinance` (+ suivi de paiement + reçu), `FamilyDocuments`, `OwnContactForm`, `messaging.ts` | portails parent et élève (`OwnContactForm` aussi enseignant) | 21 / 21.3 à 21.13, 21.16 à 21.21, 21.28 |
| `app/v2/_test/` | gabarits de données pour les tests automatiques (`fixtures-*.ts`), test de la page `/unauthorized` ; **aucune page** | tests Vitest | Non couvert : pas un écran |
