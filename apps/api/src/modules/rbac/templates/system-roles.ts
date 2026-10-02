/**
 * Modèles de rôles SYSTÈME (données). Instanciés pour chaque tenant au
 * provisioning (`instantiateSystemRoles`), verrouillés : un tenant ne les édite
 * pas, il les CLONE pour obtenir un rôle personnalisé.
 *
 * Chaque modèle liste des CLÉS exactes (et, pour la direction seulement, des
 * motifs, cf. `permission-catalog.ts`) résolus contre le catalogue réel agrégé de
 * TOUS les manifestes de modules :
 *   - un motif qui ne correspond à aucune permission est « en attente » : toléré à
 *     l'exécution (module pas encore déployé, re-résolu à la synchro), mais un test
 *     (`system-roles.test.ts`) ÉCHOUE s'il en reste un contre le catalogue complet
 *     des modules livrés : une faute de frappe ou une permission renommée ne
 *     passe jamais en silence ;
 *   - `except` retire des clés/motifs de l'ensemble octroyé.
 *
 * PRINCIPES
 *   1. Moindre privilège : les rôles autres que `owner`/`directeur` énumèrent des
 *      CLÉS EXACTES, jamais `module.*` (une permission ajoutée plus tard à un module,
 *      surtout sensible, ne doit pas être accordée d'office). Seuls `parent` et
 *      `eleve` s'appuient sur la convention de nommage, et un test vérifie qu'ils
 *      reçoivent TOUTES les permissions `*.child.*` / `*.self.*` du catalogue et
 *      rien d'autre.
 *   2. Séparation des tâches : ce qui se demande/saisit/calcule n'est pas détenu
 *      avec ce qui approuve/arrête/révoque (saisie de note ≠ validation ≠ publication ;
 *      demande de surcharge ≠ approbation ; calcul de paie ≠ arrêt du bulletin ;
 *      émission ≠ révocation d'un document ; clôture ≠ réouverture…). Un test liste les
 *      paires incompatibles et vérifie qu'AUCUN rôle autre que `owner`/`directeur`
 *      ne détient les deux côtés. La direction (`*`) cumule par construction : pour
 *      elle la séparation est imposée PAR PERSONNE à l'exécution (réglages
 *      `results.require_separate_approver`, `payroll.settings.requireSeparateApprover`,
 *      quatre yeux des remboursements, `assess.settings`).
 *   3. Toute permission `sensitive` (MFA obligatoire) accordée à un rôle autre que
 *      `owner` est justifiée ICI (`sensitiveJustifications`) ; un test refuse une
 *      permission sensible sans justification, et une justification périmée.
 *      `mfaRecommended` = le rôle porte au moins une permission sensible (test).
 *   4. Les droits sur SES PROPRES données de membre du personnel (`staff.own.*`,
 *      `attendance.own.*`, congés, bulletins de paie, emploi du temps personnel) sont
 *      dans le rôle `personnel`, à CUMULER avec un rôle de fonction (secrétariat,
 *      économe, éducateur…) ; `enseignant` et `educateur` les embarquent déjà.
 *
 * Conventions de nommage des modules (respectées par leurs manifestes) :
 *   - `<ressource>.<action>` : `student.read`, `grade.enter`, `finance.payment.create` ;
 *   - données PROPRES à l'élève   : `<ressource>.self.<action>`  (`grade.self.read`) ;
 *   - données des ENFANTS du parent : `<ressource>.child.<action>` (`grade.child.read`) ;
 *   - données PROPRES au personnel : `<ressource>.own.<action>`   (`staff.own.read`)
 *     ou `payroll.payslip.read_own`.
 * Le contrôle « cet élève est bien l'enfant de ce parent » est une règle de
 * domaine (relation Guardian) appliquée par le module concerné, pas un périmètre RBAC.
 *
 * Permissions JAMAIS accordées à un rôle de tenant :
 *   - `rules.platform.manage` : console de la plateforme (catalogue national des
 *     règles), réservée aux opérateurs authentifiés en super-administrateur ; la
 *     route ne passe pas par le RBAC de tenant, aucun rôle de tenant ne doit
 *     pouvoir la porter (retirée de `owner` et `directeur`).
 *
 * `label` / `description` : français (donnée de pack, ADR-007).
 */

export interface SystemRoleTemplate {
  /** Clé stable, anglais, snake_case. Réservée : un rôle personnalisé ne peut pas la prendre. */
  readonly key: string;
  readonly label: string;
  readonly description: string;
  /** Clés exactes et motifs octroyés. */
  readonly permissions: readonly string[];
  /** Clés/motifs retirés de `permissions`. */
  readonly except?: readonly string[];
  /** Le plan impose la MFA pour ces profils (information pour l'IAM ; l'exigence réelle est portée par `sensitive`). */
  readonly mfaRecommended?: boolean;
  /**
   * Justification de CHAQUE permission `sensitive` accordée (clé exacte ou motif → raison métier).
   * Documentaire (non persistée) mais contrôlée par test : tout droit sensible d'un rôle autre
   * que `owner` doit y figurer, et une entrée qui ne correspond plus à rien est refusée.
   */
  readonly sensitiveJustifications?: Readonly<Record<string, string>>;
}

export const SYSTEM_ROLE_TEMPLATES: readonly SystemRoleTemplate[] = Object.freeze<SystemRoleTemplate[]>([
  // ------------------------------------------------------------------------------------------------
  // PROPRIÉTAIRE — fondateur : tout, y compris l'abonnement (entitlements.manage), la définition des
  // rôles, la validation de paie au-delà du seuil (payroll.payslip.approve_owner) et les réglages de
  // paie (seuil propriétaire, séparation des tâches). Seule exclusion : la console plateforme.
  // Les permissions sensibles exigent la MFA (garde `requirePermission`).
  // ------------------------------------------------------------------------------------------------
  {
    key: "owner",
    label: "Propriétaire",
    description: "Fondateur de l'établissement : tous les droits, y compris l'abonnement, les rôles et la validation de paie.",
    permissions: ["*"],
    except: ["rules.platform.manage"],
    mfaRecommended: true,
  },

  // ------------------------------------------------------------------------------------------------
  // DIRECTEUR — délégué du propriétaire : tout sauf
  //   - l'abonnement et ses surcharges (entitlements.manage) ;
  //   - la définition des rôles (rbac.role.manage) : il attribue des rôles, il ne les redéfinit pas ;
  //   - la validation de paie au-delà du seuil (payroll.payslip.approve_owner) et les réglages de
  //     paie (payroll.settings.manage : seuil propriétaire, séparation des tâches) : sinon il
  //     pourrait se retirer le contrôle du propriétaire ;
  //   - la console plateforme (rules.platform.manage).
  // Il détient les deux côtés des paires de séparation des tâches : la distinction est imposée par
  // PERSONNE à l'exécution (celui qui a demandé/calculé/saisi ne peut pas approuver).
  // ------------------------------------------------------------------------------------------------
  {
    key: "directeur",
    label: "Directeur",
    description: "Direction de l'établissement : tout, sauf l'abonnement, la définition des rôles et la validation propriétaire de la paie.",
    permissions: ["*"],
    except: [
      "entitlements.manage",
      "rbac.role.manage",
      "payroll.payslip.approve_owner",
      "payroll.settings.manage",
      "rules.platform.manage",
    ],
    mfaRecommended: true,
    sensitiveJustifications: {
      "rbac.*": "Attribuer et retirer les rôles du personnel (la définition des rôles reste au propriétaire).",
      "academic.*": "Clôturer, reconduire, rouvrir les années et périodes, appliquer un modèle de pack : actes de direction de l'établissement.",
      "curriculum.*": "Amender un curriculum publié : décision de direction avec effet sur les résultats.",
      "enrollment.*": "Déroger à l'éligibilité d'une offre et changer le financement d'une inscription : arbitrages de direction.",
      "assessment.*": "Régler les types d'évaluation et la séparation des tâches de la saisie des notes.",
      "grade.*": "Valider, publier et corriger après publication les notes : responsabilité de direction (garde-fou final).",
      "attendance.*": "Rouvrir un appel validé, surcharger un récapitulatif, décider des congés du personnel.",
      "audit.*": "Exporter le journal d'audit : contrôle de direction.",
      "finance.*": "Rembourser (quatre yeux à l'exécution) : la direction supervise la caisse.",
      "rules.*": "Choisir et faire évoluer les règles de calcul de l'établissement (la console nationale reste à la plateforme).",
      "higher.*": "Octroyer, forcer et révoquer les diplômes, émettre les documents officiels, affecter les signataires.",
      "iam.*": "Réinitialiser la double authentification d'un membre : gestion des accès par la direction.",
      "payroll.*": "Gérer les configurations de paie, arrêter, verser et annuler les bulletins (le seuil propriétaire et les réglages restent au propriétaire).",
      "student.*": "Changer le statut, lire les champs sensibles, exporter et anonymiser les dossiers élèves.",
      "staff.*": "Gérer les statuts et les contrats du personnel.",
      "reportcard.*": "Émettre, publier, révoquer les bulletins et gérer l'identité et les signataires imprimés.",
      "result.*": "Approuver ou révoquer les surcharges, régler les résultats.",
      "period.*": "Verrouiller, clôturer, rouvrir une période, changer sa version de règle.",
      "decision.*": "Modifier une décision proposée par la règle (délibération).",
      "schedule.*": "Valider les séances pour la paie, dépasser un conflit, créer une séance comptable, verrouiller les heures.",
    },
  },

  // ------------------------------------------------------------------------------------------------
  // DIRECTEUR DES ÉTUDES — pilotage pédagogique : structure académique, curriculum, évaluations,
  // validation/publication des notes, résultats, bulletins, enseignement supérieur, emplois du temps,
  // présences. Il ne SAISIT pas de notes, ne les demande pas en correction (saisie ≠ validation) et
  // ne détient pas la contrepartie de ce qu'il initie : approbation des surcharges, réouverture
  // d'une période close, révocation d'un document, réouverture d'un appel → direction.
  // ------------------------------------------------------------------------------------------------
  {
    key: "directeur_etudes",
    label: "Directeur des études",
    description: "Pilotage pédagogique : structure académique, notes, résultats, bulletins, emplois du temps, présences.",
    permissions: [
      // Structure académique (années, périodes, programmes, classes, réglages). La clôture/reconduction
      // d'année, la réouverture d'une période et l'application d'un modèle de pack restent à la direction.
      "academic.read",
      "academic.year.read",
      "academic.year.manage",
      "academic.period.read",
      "academic.period.manage",
      "academic.period.close",
      "academic.program.read",
      "academic.program.manage",
      "academic.classroom.read",
      "academic.classroom.manage",
      "academic.settings.manage",
      // Curriculum : édition et publication (l'amendement d'un curriculum publié reste à la direction).
      "curriculum.read",
      "curriculum.manage",
      "curriculum.publish",
      // Inscriptions : suivi, mouvements, issue de fin d'année, choix de cours. Création/annulation = secrétariat ;
      // dérogation et financement = direction / économe.
      "enrollment.read",
      "enrollment.update",
      "enrollment.outcome.record",
      "enrollment.course.manage",
      // Évaluations et notes : supervision de toutes les évaluations, relecture, validation, publication,
      // approbation d'une correction (le professeur la DEMANDE, ne l'approuve pas). Pas de saisie de note.
      "assessment.type.read",
      "assessment.read",
      "assessment.manage",
      "grade.read",
      "grade.review",
      "grade.validate",
      "grade.publish",
      "grade.revise.approve",
      // Résultats : calcul, délibération, verrouillage et clôture. Il DEMANDE une surcharge ; l'approbation,
      // la réouverture, le changement de version de règle et les réglages sont à la direction.
      "result.read",
      "result.explain",
      "result.recompute",
      "result.override.request",
      "period.lock",
      "period.close",
      "decision.record",
      "decision.approve",
      "appreciation.write",
      // Bulletins : lecture, explicabilité, émission, publication, modèles. La révocation et l'identité
      // imprimée (logo, signataires) restent à la direction.
      "reportcard.read",
      "reportcard.explain",
      "reportcard.generate",
      "reportcard.publish",
      "reportcard.template.manage",
      // Enseignement supérieur : diplômes, crédits, prérequis, rattrapages, octroi et émission de documents.
      // Forcer/révoquer un diplôme et affecter les signataires restent à la direction.
      "higher.diploma.read",
      "higher.diploma.manage",
      "higher.award.read",
      "higher.award.create",
      "higher.document.read",
      "higher.document.issue",
      "higher.credits.read",
      "higher.prerequisite.manage",
      "higher.resit.manage",
      "higher.settings.manage",
      // Emplois du temps : conception, publication, salles, calendrier ; validation des séances pour la paie
      // (quatre yeux avec la constatation par l'éducateur) et dépassement motivé d'un conflit.
      // Séance comptable et verrou des heures de paie = direction.
      "schedule.read",
      "schedule.manage",
      "schedule.publish",
      "schedule.room.manage",
      "schedule.room.book",
      "schedule.calendar.manage",
      "schedule.occurrence.validate",
      "schedule.conflict.override",
      // Présences : supervision des appels, validation, justificatifs (décision), personnel, rapports.
      // Réouverture d'un appel et surcharge d'un récapitulatif = direction.
      "attendance.read",
      "attendance.manage",
      "attendance.validate",
      "attendance.justification.read",
      "attendance.justification.decide",
      "attendance.staff.read",
      "attendance.staff.record",
      "attendance.leave.decide",
      "attendance.report.read",
      "attendance.settings.manage",
      // Personnes : élèves et tuteurs en lecture ; personnel en lecture, affectations d'enseignement et
      // disponibilités (jamais les contrats, ni la création de fiches : direction).
      "student.list",
      "student.read",
      "guardian.read",
      "staff.list",
      "staff.read",
      "staff.availability.manage",
      "teaching.read",
      "teaching.assign",
      // Règles de calcul : lecture et simulation seulement (la liaison et l'édition d'expressions = direction).
      "rules.ruleset.read",
      "rules.version.simulate",
    ],
    mfaRecommended: true,
    sensitiveJustifications: {
      "grade.validate": "Approuver une feuille de notes relue : étape du circuit de validation, après la saisie par l'enseignant.",
      "grade.publish": "Publier les notes aux familles : acte final du circuit (immuable ensuite), tenu par un autre que celui qui saisit.",
      "grade.revise.approve": "Approuver une correction de note publiée : l'enseignant la demande, la direction des études l'approuve.",
      "period.lock": "Verrouiller les notes d'une période avant délibération : responsabilité pédagogique de la clôture.",
      "period.close": "Clôturer une période (résultats FINAL immuables) : acte de la direction des études ; la réouverture reste à la direction.",
      "decision.approve": "Modifier une décision de passage proposée par la règle en délibération (motivation de 20 caractères exigée).",
      "reportcard.generate": "Émettre et réémettre les bulletins et relevés : cœur du métier ; la révocation est séparée (direction).",
      "reportcard.publish": "Rendre un bulletin visible aux familles ou le retirer.",
      "higher.award.create": "Octroyer un diplôme à un étudiant éligible ; forcer une non-éligibilité ou révoquer = direction.",
      "higher.document.issue": "Émettre diplômes et attestations ; les signataires sont affectés par la direction.",
      "schedule.occurrence.validate": "Valider les séances pour la paie : contrôle des heures payables, séparé de leur constatation et du calcul de paie.",
      "schedule.conflict.override": "Autoriser une double réservation motivée dans la conception des emplois du temps.",
      "attendance.leave.decide": "Approuver ou refuser les congés des enseignants et du personnel encadrant.",
    },
  },

  // ------------------------------------------------------------------------------------------------
  // SECRÉTARIAT — scolarité : inscriptions, dossiers élèves et tuteurs, émission des bulletins,
  // relevés et attestations, présences (lecture/saisie des justificatifs), emploi du temps et
  // finances en LECTURE seule. Ni publication ni révocation de document, ni décision de justificatif,
  // ni encaissement, ni personnel.
  // ------------------------------------------------------------------------------------------------
  {
    key: "secretariat",
    label: "Secrétariat",
    description: "Inscriptions, dossiers élèves et tuteurs, bulletins et attestations, présences, consultation des finances.",
    permissions: [
      // Inscriptions (création/annulation) ; dérogation et financement = direction / économe.
      "enrollment.read",
      "enrollment.create",
      "enrollment.update",
      "enrollment.cancel",
      "enrollment.course.manage",
      // Référentiels académiques en lecture (classes, niveaux, années, curriculum).
      "academic.read",
      "academic.year.read",
      "academic.period.read",
      "academic.program.read",
      "academic.classroom.read",
      "curriculum.read",
      // Dossiers élèves et tuteurs ; l'anonymisation reste à la direction.
      "student.list",
      "student.read",
      "student.create",
      "student.update",
      "student.status.update",
      "student.sensitive.read",
      "student.export",
      "guardian.read",
      "guardian.manage",
      // Bulletins et relevés : lecture et ÉMISSION (génération) ; ni publication ni révocation.
      "reportcard.read",
      "reportcard.generate",
      // Attestations et documents officiels de l'enseignement supérieur : consultation et émission
      // (octroi, force, révocation et signataires = direction / direction des études).
      "higher.document.read",
      "higher.document.issue",
      // Présences : lecture, saisie, réception des justificatifs (jamais la décision), rapports.
      "attendance.read",
      "attendance.take",
      "attendance.justification.submit",
      "attendance.justification.read",
      "attendance.report.read",
      // Emploi du temps en lecture.
      "schedule.read",
      // Finances : consultation seule (factures, paiements, reçus).
      "finance.invoice.read",
      "finance.payment.read",
      "finance.receipt.read",
    ],
    mfaRecommended: true,
    sensitiveJustifications: {
      "student.status.update": "Retrait, transfert ou clôture d'un dossier : opération courante de la scolarité, tracée.",
      "student.sensitive.read": "Pièces d'état civil et identifiant national nécessaires à l'inscription ; chaque lecture est auditée.",
      "student.export": "Listes d'élèves pour les administrations et les classes ; export plafonné et audité.",
      "reportcard.generate": "Émettre les bulletins et relevés ; la publication aux familles et la révocation sont séparées.",
      "higher.document.issue": "Délivrer les attestations de scolarité ; les signataires et la révocation restent à la direction.",
    },
  },

  // ------------------------------------------------------------------------------------------------
  // ÉCONOME — finance complète (frais, factures, encaissements, caisse, remboursements) et préparation
  // de la paie (configurations, tarifs, périodes, calcul, ajustements, notification, versement).
  // Le calcul et le versement sont séparés de l'ARRÊT du bulletin (payroll.payslip.approve →
  // direction), de son annulation, des réglages de paie et de la validation propriétaire.
  // Lecture seule des élèves, inscriptions et personnel.
  // ------------------------------------------------------------------------------------------------
  {
    key: "econome",
    label: "Économe",
    description: "Gestion financière : frais, factures, encaissements, caisse ; préparation, calcul et versement de la paie.",
    permissions: [
      // Finance complète.
      "finance.fee.read",
      "finance.fee.manage",
      "finance.invoice.read",
      "finance.invoice.create",
      "finance.invoice.cancel",
      "finance.payment.read",
      "finance.payment.create",
      "finance.payment.refund",
      "finance.cashregister.open",
      "finance.cashregister.close",
      "finance.report.read",
      "finance.receipt.read",
      // Financement d'une inscription (bourse, affectation par l'État) : impact direct sur la facturation.
      "enrollment.funding.update",
      // Paie : préparation, calcul, ajustements, notification, versement. Pas d'arrêt (approve), d'annulation,
      // de réglages ni de validation propriétaire.
      "payroll.config.read",
      "payroll.config.manage",
      "payroll.rate.read",
      "payroll.rate.manage",
      "payroll.period.manage",
      "payroll.run.calculate",
      "payroll.payslip.read",
      "payroll.payslip.adjust",
      "payroll.payslip.notify",
      "payroll.payslip.pay",
      "payroll.report.read",
      // Lecture des élèves, tuteurs, inscriptions, personnel et référentiels (jamais de contrats).
      "student.list",
      "student.read",
      "guardian.read",
      "enrollment.read",
      "staff.list",
      "staff.read",
      "academic.read",
      "academic.year.read",
      "academic.program.read",
      "academic.classroom.read",
    ],
    mfaRecommended: true,
    sensitiveJustifications: {
      "finance.payment.refund": "Demander et exécuter un remboursement ; l'approbation exige une seconde personne (quatre yeux à l'exécution).",
      "enrollment.funding.update": "Changer le financement d'une inscription : conditionne les factures émises par l'économe.",
      "payroll.config.manage": "Saisir salaires et conditions de paie des enseignants ; lecture et modifications auditées.",
      "payroll.rate.manage": "Tenir la grille des tarifs horaires ; modifications datées et auditées.",
      "payroll.run.calculate": "Lancer le calcul de paie (réclame les heures) ; l'arrêt du bulletin est fait par une autre personne.",
      "payroll.payslip.read": "Consulter les bulletins de paie : donnée salariale, lecture et export audités.",
      "payroll.payslip.adjust": "Saisir primes et retenues sur un bulletin calculé ; l'arrêt est fait par une autre personne.",
      "payroll.payslip.pay": "Constater le versement d'un bulletin déjà arrêté par la direction (état APPROVED → PAID).",
    },
  },

  // ------------------------------------------------------------------------------------------------
  // ENSEIGNANT — SES classes : évaluations, notes (saisie, demande de correction), appréciations,
  // appel, élèves de ses classes (jamais `student.read`/`student.list` globaux), emploi du temps
  // personnel, SES données de personnel (fiche, présence, congés, bulletins de paie).
  // Aucune permission de validation, higher, finance ni gestion de paie.
  // ------------------------------------------------------------------------------------------------
  {
    key: "enseignant",
    label: "Enseignant",
    description: "Enseignement : appel, évaluations, notes et appréciations de ses classes ; ses données de personnel.",
    permissions: [
      // Évaluations et notes de ses classes (le module vérifie l'affectation : assess.not_assigned).
      "assessment.type.read",
      "assessment.read",
      "assessment.create",
      "assessment.update",
      "grade.read",
      "grade.enter",
      "grade.revise.request",
      // Appréciations de matière (le conseil de classe est rédigé par la direction des études).
      "appreciation.write",
      // Appel de ses classes ; justificatifs et décisions = vie scolaire.
      "attendance.read",
      "attendance.take",
      // Élèves de SES classes seulement (fiche réduite, 404 hors périmètre).
      "student.class.read",
      // Emploi du temps personnel et déclaration d'une séance ponctuelle de ses classes.
      "schedule.own.read",
      "schedule.occurrence.declare",
      // Ses données de personnel : fiche, classes et contrats, présence, congés, bulletins de paie.
      "staff.own.read",
      "staff.own.update",
      "attendance.own.read",
      "attendance.own.record",
      "attendance.leave.request",
      "payroll.payslip.read_own",
      "payroll.my.dispute",
    ],
  },

  // ------------------------------------------------------------------------------------------------
  // ÉDUCATEUR — vie scolaire : appel et suivi des présences, justificatifs (dépôt et lecture),
  // constatation des séances, lecture des élèves et tuteurs. La décision sur un justificatif, la
  // réouverture d'un appel, la surcharge d'un récapitulatif et les congés du personnel ne sont pas à
  // lui (séparation dépôt/décision, appel/réouverture).
  // Le module `discipline` n'existe pas encore : aucune permission disciplinaire n'est déclarée.
  // ------------------------------------------------------------------------------------------------
  {
    key: "educateur",
    label: "Éducateur",
    description: "Vie scolaire : appel et suivi des présences, justificatifs, suivi des élèves.",
    permissions: [
      // Présences des élèves.
      "attendance.read",
      "attendance.take",
      "attendance.manage",
      "attendance.validate",
      "attendance.justification.submit",
      "attendance.justification.read",
      "attendance.report.read",
      // Constatation manuelle de la réalisation d'une séance (validée ensuite pour la paie par la direction des études).
      "schedule.read",
      "schedule.occurrence.hold",
      // Élèves, tuteurs, classes et inscriptions en lecture.
      "student.list",
      "student.read",
      "guardian.read",
      "enrollment.read",
      "academic.classroom.read",
      // Ses données de personnel (fiche, présence, congés).
      "staff.own.read",
      "staff.own.update",
      "attendance.own.read",
      "attendance.own.record",
      "attendance.leave.request",
    ],
  },

  // ------------------------------------------------------------------------------------------------
  // RESPONSABLE PÉDAGOGIQUE — coordination d'une filière/niveau : curriculum, lecture des évaluations
  // et des résultats, relecture et validation des notes (grade.validate). Il ne saisit pas (séparation
  // saisie/validation), ne publie pas et n'approuve pas les corrections (direction des études).
  // ------------------------------------------------------------------------------------------------
  {
    key: "responsable_pedagogique",
    label: "Responsable pédagogique",
    description: "Coordination d'une filière ou d'un niveau : curriculum, évaluations, relecture et validation des notes.",
    permissions: [
      // Structure académique et curriculum (édition ; la publication revient à la direction des études).
      "academic.read",
      "academic.year.read",
      "academic.period.read",
      "academic.program.read",
      "academic.classroom.read",
      "curriculum.read",
      "curriculum.manage",
      // Évaluations et feuilles de notes : lecture, relecture, validation (pas de saisie, de publication).
      "assessment.type.read",
      "assessment.read",
      "grade.read",
      "grade.review",
      "grade.validate",
      // Résultats et bulletins en lecture.
      "result.read",
      "result.explain",
      "reportcard.read",
      "reportcard.explain",
      // Contexte : emplois du temps, enseignement, présences, élèves, personnel, règles.
      "schedule.read",
      "teaching.read",
      "attendance.read",
      "attendance.report.read",
      "enrollment.read",
      "student.list",
      "student.read",
      "staff.list",
      "staff.read",
      "rules.ruleset.read",
    ],
    mfaRecommended: true,
    sensitiveJustifications: {
      "grade.validate": "Approuver une feuille de notes relue : étape de contrôle entre la saisie de l'enseignant et la publication par la direction des études.",
    },
  },

  // ------------------------------------------------------------------------------------------------
  // PERSONNEL — NOUVEAU : tout membre du personnel (administratif, entretien, intervenant) : ses
  // propres données et uniquement elles. À cumuler avec un rôle de fonction.
  // ------------------------------------------------------------------------------------------------
  {
    key: "personnel",
    label: "Personnel",
    description: "Portail du personnel : sa fiche, sa présence et ses congés, son emploi du temps et ses bulletins de paie.",
    permissions: [
      "staff.own.read",
      "staff.own.update",
      "attendance.own.read",
      "attendance.own.record",
      "attendance.leave.request",
      "payroll.payslip.read_own",
      "payroll.my.dispute",
      "schedule.own.read",
    ],
  },

  // ------------------------------------------------------------------------------------------------
  // PARENT — ses ENFANTS uniquement (relation de tutelle vérifiée par chaque module) : toutes les
  // permissions `*.child.*` du catalogue, aucune permission de gestion. Énumérées (et non `*.child.*`) :
  // un test vérifie l'égalité avec l'ensemble des clés `*.child.*` du catalogue.
  // Finance : `finance.child.read` (situation financière des enfants) et `finance.child.pay` (paiement en
  // ligne initié par le parent) ; la tutelle est relue par finance à chaque requête (routes `/finance/me/*`).
  // ------------------------------------------------------------------------------------------------
  {
    key: "parent",
    label: "Parent",
    description: "Portail parent : suivi de ses enfants (scolarité, notes, résultats, bulletins, présences, emploi du temps).",
    permissions: [
      "student.child.read",
      "student.child.update",
      "enrollment.child.read",
      "grade.child.read",
      "result.child.read",
      "reportcard.child.read",
      "attendance.child.read",
      "attendance.child.justify",
      "schedule.child.read",
      "higher.child.read",
      "finance.child.read",
      "finance.child.pay",
    ],
  },

  // ------------------------------------------------------------------------------------------------
  // ÉLÈVE — lui-même uniquement : toutes les permissions `*.self.*` du catalogue (dossier, inscriptions,
  // notes, résultats, bulletins, présences, emploi du temps, parcours supérieur). L'inscription libre-
  // service (enrollment.self.create) n'a d'effet que sous la feature `academic.a-la-carte` (supérieur).
  // ------------------------------------------------------------------------------------------------
  {
    key: "eleve",
    label: "Élève",
    description: "Portail élève : son dossier, ses notes, résultats, bulletins, présences et son emploi du temps.",
    permissions: [
      "student.self.read",
      "student.self.update",
      "enrollment.self.read",
      "enrollment.self.create",
      "grade.self.read",
      "result.self.read",
      "reportcard.self.read",
      "attendance.self.read",
      "attendance.self.justify",
      "schedule.self.read",
      "higher.self.read",
      "finance.self.read",
      "finance.self.pay",
    ],
  },
]);

export const SYSTEM_ROLE_KEYS: readonly string[] = Object.freeze(SYSTEM_ROLE_TEMPLATES.map((t) => t.key));

export function getSystemRoleTemplate(key: string): SystemRoleTemplate | undefined {
  return SYSTEM_ROLE_TEMPLATES.find((t) => t.key === key);
}

export function isReservedRoleKey(key: string, templates: readonly SystemRoleTemplate[] = SYSTEM_ROLE_TEMPLATES): boolean {
  return templates.some((t) => t.key === key);
}
