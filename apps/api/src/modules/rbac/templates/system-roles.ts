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
 *      reçoivent TOUTES les permissions `child` / `self` du catalogue (à trois ET quatre
 *      segments : `student.child.read`, `primary.competency.child.read`) et rien d'autre.
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
 * Permissions de modules PAS ENCORE livrés (Primary, conseils, vie scolaire, affectation d'État,
 * admissions, examens) : clés exactes listées dans `reserved-permissions.ts` (liste blanche versionnée,
 * avec module futur et spec). Elles restent « en attente » (sans échec) jusqu'à la livraison du manifeste
 * du module ; tout autre motif en attente fait échouer les tests.
 *
 * Conventions de nommage des modules (respectées par leurs manifestes) :
 *   - `<ressource>.<action>` : `student.read`, `grade.enter`, `finance.payment.create` ;
 *   - données PROPRES à l'élève   : `<ressource>.self.<action>`  (`grade.self.read`) ;
 *   - données des ENFANTS du parent : `<ressource>.child.<action>` (`grade.child.read`) ;
 *     (une clé à quatre segments est admise : `primary.competency.child.read`) ;
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
      "analytics.*": "Consulter la masse salariale par période dans les tableaux de bord de direction (lecture seule, MFA exigée, chaque lecture est auditée).",
      "payroll.*": "Gérer les configurations de paie, arrêter, verser et annuler les bulletins (le seuil propriétaire et les réglages restent au propriétaire).",
      "student.*": "Changer le statut, lire les champs sensibles, exporter et anonymiser les dossiers élèves.",
      "staff.*": "Gérer les statuts et les contrats du personnel.",
      "reportcard.*": "Émettre, publier, révoquer les bulletins et gérer l'identité et les signataires imprimés.",
      "result.*": "Approuver ou révoquer les surcharges, régler les résultats.",
      "period.*": "Verrouiller, clôturer, rouvrir une période, changer sa version de règle.",
      "decision.*": "Modifier une décision proposée par la règle (délibération).",
      "schedule.*": "Valider les séances pour la paie, dépasser un conflit, créer une séance comptable, verrouiller les heures.",
      "notifications.*": "Envoyer un avis urgent (contourne heures calmes et préférences de catégorie, audité, authentification forte) : responsabilité de direction.",
      "imports.*": "Reprise de données (soldes financiers d'ouverture : factures et avoirs de reprise, MFA exigée, audité) : acte de direction ; les autres rôles n'ont aucun droit d'import tant que le plan de rôles du module n'est pas arrêté.",
      "messaging.*": "Modérer les signalements, restreindre l'envoi et superviser les conversations avec motif obligatoire (audité) : responsabilité de direction.",
      "documents.*": "Lire les documents confidentiels (dossiers médicaux, contrats, comptabilité), administrer tous les documents, y compris archivés, et libérer ou détruire un fichier en quarantaine : responsabilité de direction (chaque lecture est auditée).",
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
      // Gestion documentaire (module documents) : voir specs/v2/024-documents.
      "documents.read",
      "documents.read.restricted",
      "documents.upload",
      "documents.share",
      "documents.archive",
      "documents.history.read",
      // Messagerie interne et annonces (module messaging) : voir specs/v2/016-communications.
      "messaging.read",
      "messaging.send",
      "messaging.send.any",
      "messaging.announcement.publish",
      "messaging.announcement.manage",
      // Notifications (module notifications) : voir specs/v2/016-communications.
      "notifications.read",
      "notifications.send",
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
      // RÉSERVÉES (pack Secondary, spec 006 §10 ; `reserved-permissions.ts`, en attente jusqu'à la livraison des
      // modules) : conseils de classe (`council.*` SAUF l'approbation d'un déverrouillage, qui est à la direction,
      // et la révocation d'un procès-verbal : émission/signature ≠ révocation), vie scolaire en lecture,
      // affectation d'État en lecture.
      "council.read",
      "council.manage",
      "council.prepare",
      "council.session.run",
      "council.proposal.write",
      "council.decision.record",
      "council.minutes.generate",
      "council.minutes.read",
      "council.minutes.sign",
      "council.unlock.request",
      "council.effect.manage",
      "council.exclusion.apply",
      "council.settings.manage",
      "council.orientation.read",
      "council.orientation.manage",
      "council.orientation.override",
      "schoollife.read",
      "stateassign.read",
    ],
    mfaRecommended: true,
    sensitiveJustifications: {
      "council.session.run": "Ouvrir et clore une séance de conseil de classe (quorum, valeur probante du procès-verbal) : acte de la direction des études.",
      "council.decision.record": "Enregistrer la décision HUMAINE du conseil (passage, redoublement, exclusion) : jamais prise par la règle.",
      "council.minutes.sign": "Signer le procès-verbal du conseil : engage l'établissement ; la révocation reste à la direction.",
      "council.exclusion.apply": "Appliquer l'effet d'une décision d'exclusion décidée par le conseil (le changement de statut exige en plus `student.status.update`).",
      "council.settings.manage": "Régler les types de conseil, rôles et types de décision : conditionne la validité des délibérations.",
      "council.orientation.override": "Déroger à un parcours d'orientation autorisé : décision pédagogique motivée et tracée.",
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
      // Gestion documentaire (module documents) : voir specs/v2/024-documents.
      "documents.read",
      "documents.read.restricted",
      "documents.upload",
      "documents.share",
      "documents.history.read",
      // Messagerie interne et annonces (module messaging) : voir specs/v2/016-communications.
      "messaging.read",
      "messaging.send",
      "messaging.announcement.publish",
      // Notifications (module notifications) : voir specs/v2/016-communications.
      "notifications.read",
      "notifications.send",
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
      // RÉSERVÉES (`reserved-permissions.ts`, en attente jusqu'à la livraison des modules).
      // Admissions (spec 007 §11 : le « chargé d'admissions » est le secrétariat) : tout le traitement d'un dossier,
      // JAMAIS la décision (`admission.decide`), le dépassement de capacité, les campagnes/réglages/workflows,
      // l'export ni l'anonymisation : direction.
      "admission.read",
      "admission.create",
      "admission.update",
      "admission.document.upload",
      "admission.document.review",
      "admission.interview.manage",
      "admission.offer.manage",
      "admission.duplicate.resolve",
      "admission.waitlist.manage",
      "admission.prospect.manage",
      "admission.enroll",
      "admission.report.read",
      // Conseils de classe (spec 006 §10) : planifier/convoquer, générer, lire et signer les procès-verbaux ;
      // pas la révocation (émission ≠ révocation), pas la tenue de séance ni les décisions.
      "council.read",
      "council.manage",
      "council.minutes.generate",
      "council.minutes.read",
      "council.minutes.sign",
      // Affectation d'État : enregistrer les dossiers et gérer les références de pièces ; vérifier, activer,
      // suspendre, amender = direction.
      "stateassign.read",
      "stateassign.record",
      "stateassign.document.manage",
    ],
    mfaRecommended: true,
    sensitiveJustifications: {
      "council.minutes.sign": "Signer les procès-verbaux de conseil en tant que secrétaire de séance ; la révocation reste à la direction.",
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
      // Gestion documentaire (module documents) : voir specs/v2/024-documents.
      "documents.read",
      "documents.read.restricted",
      "documents.upload",
      // Messagerie interne et annonces (module messaging) : voir specs/v2/016-communications.
      "messaging.read",
      "messaging.send",
      // Notifications (module notifications) : voir specs/v2/016-communications.
      "notifications.read",
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
      // RÉSERVÉES (spec 006 §10 ; `reserved-permissions.ts`) : affectation d'État — lecture, rapprochement avec la
      // facturation, contrôles. Ni enregistrement ni vérification des dossiers.
      "stateassign.read",
      "stateassign.reconcile",
      "stateassign.control.perform",
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
      // Gestion documentaire (module documents) : voir specs/v2/024-documents.
      "documents.read",
      "documents.own.read",
      "documents.own.upload",
      // Messagerie interne et annonces (module messaging) : voir specs/v2/016-communications.
      "messaging.read",
      "messaging.send",
      "messaging.announcement.publish_class",
      // Notifications (module notifications) : voir specs/v2/016-communications.
      "notifications.own.manage",
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
      // RÉSERVÉES (spec 006 §10 ; `reserved-permissions.ts`) : proposer au conseil de classe, signaler et noter
      // la vie scolaire de SES classes (le module vérifie l'affectation). Aucune validation de sanction.
      "council.proposal.write",
      "schoollife.read",
      "schoollife.incident.write",
      "schoollife.note.write",
    ],
  },

  // ------------------------------------------------------------------------------------------------
  // INSTITUTEUR — NOUVEAU (spec 005 pack-template §7, US2) : titulaire UNIQUE d'une classe du primaire
  // (maternelle, CP1-CM2), enseignant de toutes les matières. Patron : `enseignant` (même expression de
  // « sa classe » : le module vérifie l'affectation, `student.class.read`, jamais `student.read`/`student.list`
  // globaux, `*.own.*` pour ses données de personnel) + évaluation par compétences et conseil des maîtres.
  // Clés de la spec mappées sur les clés RÉELLES des manifestes : `attendance.take|read`, `assessment.create|update`,
  // `grade.enter`, `student.class.read`, `messaging.*`, `reportcard.read` existent telles quelles ; le patron
  // enseignant ajoute ce qu'une saisie réelle exige (`assessment.read`, `assessment.type.read`, `grade.read`,
  // `grade.revise.request`, `appreciation.write`, emploi du temps et données de personnel).
  // ABSENTES volontairement (spec) : `grade.validate`, `grade.publish`, `grade.revise.approve`,
  // `primary.competency.revise`, `primary.bilan.seal`, `period.close`, toute permission `finance.*`
  // (une classe à titulaire unique saisit et PRÉPARE ; la validation finale, le scellé du bilan et la
  // clôture de période sont à la direction). `primary.*` sont RÉSERVÉES jusqu'à la livraison du module
  // `primary_school` (`reserved-permissions.ts`). Aucune permission sensible ⇒ pas de MFA recommandée.
  // ------------------------------------------------------------------------------------------------
  {
    key: "instituteur",
    label: "Instituteur",
    description: "Titulaire unique d'une classe du primaire : appel, évaluations, notes, compétences et conseil des maîtres de sa classe ; ses données de personnel.",
    permissions: [
      // Messagerie interne et annonces (module messaging) : voir specs/v2/016-communications.
      "messaging.read",
      "messaging.send",
      "messaging.announcement.publish_class",
      // Évaluations chiffrées et notes de SA classe (le module vérifie l'affectation : assess.not_assigned).
      "assessment.type.read",
      "assessment.read",
      "assessment.create",
      "assessment.update",
      "grade.read",
      "grade.enter",
      "grade.revise.request",
      // Appréciations ; bulletins de sa classe en lecture (l'émission et la publication sont à d'autres rôles).
      "appreciation.write",
      "reportcard.read",
      // Appel journalier de sa classe.
      "attendance.read",
      "attendance.take",
      // Élèves de SA classe seulement (fiche réduite, 404 hors périmètre).
      "student.class.read",
      // Emploi du temps personnel et déclaration d'une séance ponctuelle de sa classe.
      "schedule.own.read",
      "schedule.occurrence.declare",
      // Ses données de personnel : fiche, présence, congés, bulletins de paie.
      "staff.own.read",
      "staff.own.update",
      "attendance.own.read",
      "attendance.own.record",
      "attendance.leave.request",
      "payroll.payslip.read_own",
      "payroll.my.dispute",
      // RÉSERVÉES (module `primary_school`, spec 005 §10) : compétences (lecture, saisie, validation ; JAMAIS la
      // révision après validation), banque d'appréciations, conseil des maîtres (lecture et préparation).
      "primary.competency.read",
      "primary.competency.record",
      "primary.competency.validate",
      "primary.phrase.read",
      "primary.council.read",
      "primary.council.prepare",
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
      // Gestion documentaire (module documents) : voir specs/v2/024-documents.
      "documents.read",
      "documents.own.read",
      "documents.own.upload",
      // Messagerie interne et annonces (module messaging) : voir specs/v2/016-communications.
      "messaging.read",
      "messaging.send",
      "messaging.announcement.publish_class",
      // Notifications (module notifications) : voir specs/v2/016-communications.
      "notifications.own.manage",
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
      // RÉSERVÉES (spec 006 §10 ; `reserved-permissions.ts`) : vie scolaire — saisie (incidents, observations,
      // PROPOSITION de mesure, convocation des tuteurs). SANS validation de sanction ni d'exclusion, ni
      // révocation, ni recours (séparation proposition ≠ validation).
      "schoollife.read",
      "schoollife.incident.write",
      "schoollife.measure.propose",
      "schoollife.note.write",
      "schoollife.convocation.manage",
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
      // Gestion documentaire (module documents) : voir specs/v2/024-documents.
      "documents.read",
      // Messagerie interne et annonces (module messaging) : voir specs/v2/016-communications.
      "messaging.read",
      "messaging.send",
      "messaging.announcement.publish_class",
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
      "documents.own.read",
      "documents.own.upload",
      "staff.own.read",
      "staff.own.update",
      "attendance.own.read",
      "attendance.own.record",
      "attendance.leave.request",
      "payroll.payslip.read_own",
      "payroll.my.dispute",
      "schedule.own.read",
      // Notifications (module notifications) : voir specs/v2/016-communications.
      "notifications.own.manage",
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
      // Gestion documentaire (module documents) : voir specs/v2/024-documents.
      "documents.child.read",
      "documents.child.upload",
      // Messagerie interne et annonces (module messaging) : voir specs/v2/016-communications.
      "messaging.child.read",
      "messaging.child.send",
      // Notifications (module notifications) : voir specs/v2/016-communications.
      "notifications.child.manage",
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
      // RÉSERVÉES (`reserved-permissions.ts`, en attente jusqu'à la livraison des modules) : compétences et bilan
      // annuel du primaire (spec 005), décisions du conseil, vie scolaire partageable, statut d'affectation
      // d'État (spec 006), documents d'examen (spec 018).
      "primary.competency.child.read",
      "primary.bilan.child.read",
      "council.child.read",
      "schoollife.child.read",
      "stateassign.child.read",
      "exam.document.child.read",
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
      // Gestion documentaire (module documents) : voir specs/v2/024-documents.
      "documents.self.read",
      "documents.self.upload",
      // Messagerie interne et annonces (module messaging) : voir specs/v2/016-communications.
      "messaging.self.read",
      "messaging.self.send",
      // Notifications (module notifications) : voir specs/v2/016-communications.
      "notifications.self.manage",
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
      // RÉSERVÉES (`reserved-permissions.ts`) : ses compétences et son bilan (spec 005), les décisions de son
      // conseil et sa vie scolaire partageable (spec 006), ses documents d'examen (spec 018).
      "primary.competency.self.read",
      "primary.bilan.self.read",
      "council.self.read",
      "schoollife.self.read",
      "exam.document.self.read",
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
