/**
 * Adaptateurs de ports ENTRE modules — le SEUL endroit de la plateforme qui connaît plusieurs modules.
 *
 * Chaque module déclare des PORTS (ce qu'il attend de ses voisins) et échoue FERMÉ (`*.port_unavailable`) tant qu'ils ne sont
 * pas branchés. Les conventions interdisent à un module d'importer un autre autrement que par son `index.ts` : les
 * adaptateurs de ce dossier importent les `index.ts` des deux modules d'une paire (règle `platform-adapters-only-via-index` de
 * `.dependency-cruiser.cjs`, sans autre exception) et traduisent l'API publique du fournisseur vers le port du consommateur.
 *
 *   académique -> résultats / bulletins / présences / emploi du temps / paie / personnel / enseignement supérieur
 *   personnel  -> académique / évaluations / présences / emploi du temps / paie / finance / bulletins / supérieur
 *   résultats  -> bulletins / supérieur        finance -> académique / bulletins        présences -> bulletins / paie
 *   emploi du temps -> présences / paie        bulletins -> supérieur                   stockage d'objets -> présences / personnel / bulletins
 *
 * `wireApiPorts` branche l'API (registres par application Fastify) ; `installWorkerAdapters` branche le worker (registres par
 * processus). Les deux construisent les MÊMES adaptateurs sur le même kit de lecture (`kit.ts`).
 */
import type { FastifyInstance } from "fastify";
import type { Clock, Logger } from "@ecoledigitale/kernel";
import type { SystemDb, TenantDb } from "@ecoledigitale/database";
import { registerAdmissionsPorts, setAdmissionsWorkerPorts, type AdmissionsPorts } from "../../modules/admissions";
import {
  registerAcademicPorts,
  setAcademicWorkerPorts,
  type AcademicPorts,
} from "../../modules/academic";
import { registerAnalyticsPorts, setAnalyticsWorkerPorts, type AnalyticsSourcePorts } from "../../modules/analytics";
import { createDocumentsDeps, documentsAuditAdapter, officeConverterFromEnv, registerDocumentsPorts, scanPolicyFromEnv, setDocumentsWorkerPorts, type DocumentsPorts } from "../../modules/documents";
import { registerAssessPorts, type AssessPorts } from "../../modules/assess";
import { registerExaminationsPorts, setExaminationsWorkerPorts, type ExaminationsPorts } from "../../modules/examinations";
import { createExaminationsAssessPort } from "./examinations-assess";
import { createExaminationsEligibilityFacts, createExaminationsFamilyLinks, createExaminationsInstitutions, createExaminationsStudentDirectory } from "./examinations-directories";
import { createExaminationsOfficialDocuments, createExaminationsPieceDocuments } from "./examinations-documents";
import { createExaminationsRulesPort } from "./examinations-rules";
import { registerAttendancePorts, type AttendancePorts } from "../../modules/attendance";
import { registerFinancePorts, type FinancePortSet } from "../../modules/finance";
import { registerHigherPorts, registerHigherWorkerPorts, type HigherPorts } from "../../modules/higher";
import { importsAuditAdapter, registerImportsPorts, setImportsWorkerPorts, type ImportPorts } from "../../modules/imports";
import { audit as auditService } from "../../modules/audit";
import { registerMessagingPorts, setMessagingWorkerPorts, type MessagingPorts } from "../../modules/messaging";
import { registerNotificationsPorts, setNotificationsWorkerPorts, type NotificationsPorts } from "../../modules/notifications";
import { registerStateassignPorts, setStateassignWorkerPorts, type StateassignPorts } from "../../modules/stateassign";
import { registerCouncilsPorts, setCouncilsWorkerPorts, type CouncilsPorts } from "../../modules/councils";
import { createSchoolLifeDeps } from "../../modules/schoollife";
import { registerPeoplePorts, setPeopleWorkerPorts, type PeoplePortSet } from "../../modules/people";
import { registerPayrollPorts, type PayrollPortsInput } from "../../modules/payroll";
import { registerReportcardsPorts, reportcardsAuditAdapter, setReportcardsWorkerResources, type PdfRenderer, type ReportcardsPorts } from "../../modules/reportcards";
import { createOfficialDocumentDeps, type OfficialDocumentDepsOptions } from "./official-documents";
import { registerResultsPorts, setResultsWorkerPorts, type ResultsPorts } from "../../modules/results";
import { registerSchedulingPorts } from "../../modules/scheduling";
import { registerSchoolLifePorts, type SchoolLifePorts } from "../../modules/schoollife";
import type { ModuleRuntime, RuntimeAuditPort } from "../runtime";
import { createAcademicCompletionLookup, createAcademicScheduleChecker, createAcademicUsageGuard } from "./academic-guards";
import { createAnalyticsSources } from "./analytics-sources";
import { createAssessCurriculumPort, createAssessPeriodPort, createAssessRosterPort } from "./academic-assess";
import { createAttendancePeriodPort, createAttendanceRosterPort } from "./academic-attendance";
import { createDocumentsUsageReporter } from "./entitlements-documents";
import { createDocumentsOwnerDirectory } from "./people-documents";
import { withMalwareScan } from "./storage-scan";
import { createHigherCurriculumPort, createHigherEnrollmentDirectory } from "./academic-higher";
import { createPayrollCurriculumLabelPort } from "./academic-payroll";
import { createPeopleAcademicQuery } from "./academic-people";
import { createResultsCurriculumPort, createResultsRosterPort } from "./academic-results";
import { createSchedulingAcademicQuery } from "./academic-scheduling";
import { createReportcardsAttendanceSummary } from "./attendance-reportcards";
import { createFinanceEnrollmentDirectory, createFinanceLearnerDirectory } from "./directories-finance";
import { createAcademicInvoiceFactsReader, createAcademicRegistrationFeeProbe } from "./finance-academic";
import { createFinanceReceiptDocuments, createReportcardsLearnerStanding } from "./finance-reportcards";
import { createFinanceGuardianshipPort } from "./people-finance";
import { createMessagingAudienceDirectory } from "./academic-messaging";
import { createMessagingPeopleDirectory } from "./people-messaging";
import { createNotificationsDirectory } from "./people-notifications";
import { createNotificationsAnnouncements, createNotificationsGrades, createNotificationsOverdueSource, createNotificationsTeachingLoad } from "./sources-notifications";
import { createAssessActorNamePort, createAssessGuardianshipPort, createAssessTeachingPort } from "./people-assess";
import { createAcademicGuardianship, createAcademicOfferingReadiness, createAcademicStudentDirectory } from "./people-academic";
import { createAttendancePeoplePort } from "./people-attendance";
import { createHigherActorDirectory, createHigherStudentDirectory } from "./people-higher";
import { createPayrollStaffDirectory } from "./people-payroll";
import { createPayrollPayslipDocuments } from "./payroll-reportcards";
import { createReportcardsGuardianshipPort, createReportcardsUserDirectory } from "./people-reportcards";
import { createResultsActorNamePort, createResultsGuardianshipPort } from "./people-results";
import { createSchedulingPeopleQuery } from "./people-scheduling";
import { createPayrollAttendanceHours, createPayrollSessionHours } from "./payroll-sources";
import { createHigherInstitutionPort, createHigherSignatoryDirectory } from "./reportcards-higher";
import { createHigherDocumentFiles, createHigherDocumentVerifier } from "./reportcards-higher-documents";
import { createAcademicPromotionDecisions } from "./results-academic";
import { createReportcardsResultsRead } from "./results-reportcards";
import { createResultsYearFactsPort } from "./results-year-facts";
import { createHigherCreditsSource, createHigherCycleResults, createHigherResitSession } from "./results-higher";
import { createAttendanceOccurrencePort, createSchedulingAttendanceQuery } from "./scheduling-attendance";
import { asAttendanceStorage, asDocumentsStorage, asMessagingStorage, asPeopleStorage, createObjectStorage, DiskStorage, registerDiskStorageRoute, type ObjectStorage } from "./storage";
import { registerPrimarySchoolPorts, setPrimarySchoolWorkerPorts, type PrimarySchoolPorts } from "../../modules/primary_school";
import { createPrimaryClassroomPort, createPrimaryOutcomePort, createPrimaryPeriodStatePort } from "./academic-primary";
import { createPrimaryGuardianshipPort, createPrimaryTeachingPort } from "./people-primary";
import { createPrimaryResultsPort, createPrimaryRulesPort } from "./results-primary";
import { createPrimaryAttendancePort } from "./attendance-primary";
import { createPrimaryDocumentsPort } from "./reportcards-primary";
import { createAdapterKit, type AdapterKit } from "./kit";
import { createClassroomsImportPort, createCurriculumImportPort } from "./imports-academic";
import { createGradesImportPort } from "./imports-assess";
import { createOpeningBalancesImportPort } from "./imports-finance";
import { createGuardiansImportPort, createImportActorNames, createStaffImportPort, createStudentsImportPort } from "./imports-people";
import { createImportWriteEnv } from "./imports-support";
import { createAdmissionsCatalog, createAdmissionsEnrollmentService } from "./admissions-academic";
import { createAdmissionsDocumentStore } from "./admissions-documents";
import { createAdmissionsRegistrationFees } from "./admissions-finance";
import { createAdmissionsApplicantNotifier } from "./admissions-notifier";
import { createAdmissionsActorDirectory, createAdmissionsStudentRegistry } from "./admissions-people";
import { createAdmissionsWriteEnv } from "./admissions-support";
import { createSchoollifeEnrollmentPort, createSchoollifePeriodPort } from "./academic-schoollife";
import { createSchoollifeAttendanceView } from "./attendance-schoollife";
import { createSchoollifeNotificationPort, createSchoollifeNotificationsDeps } from "./notifications-schoollife";
import { createSchoollifePeoplePort, createSchoollifeStudentStatusPort } from "./people-schoollife";
import { createStateassignEnrollmentPort, createStateassignFundingPort } from "./academic-stateassign";
import { createStateassignAttendanceFacts } from "./attendance-stateassign";
import { createStateassignDocumentRefs } from "./documents-stateassign";
import { createStateassignFinancePort } from "./finance-stateassign";
import { createStateassignGuardianshipPort, createStateassignStudentNames } from "./people-stateassign";
import { createCouncilsAcademicPort, createCouncilsOutcomePort } from "./academic-councils";
import { createCouncilsResultsRead, createCouncilsResultsWrite, createCouncilsRuleCodes } from "./results-councils";
import { createCouncilsAttendancePort } from "./attendance-councils";
import { createCouncilsSchoolLifePort } from "./schoollife-councils";
import { createCouncilsFamilyPort, createCouncilsStaffPort, createCouncilsStudentStatusPort } from "./people-councils";
import { createCouncilsNotificationPort } from "./notifications-councils";
import { createCouncilsDocumentsPort } from "./reportcards-councils";
import { createCouncilsStoragePort } from "./storage-councils";
import { createCouncilsTemplatePort } from "./tenancy-councils";

export { createAdapterKit, type AdapterKit, type AdapterKitInput } from "./kit";
export { createObjectStorage, DiskStorage, registerDiskStorageRoute, type ObjectStorage } from "./storage";

/** Tous les ports branchés par la plateforme, par module CONSOMMATEUR. */
export interface PlatformPorts {
  readonly academic: Partial<AcademicPorts>;
  readonly people: Partial<PeoplePortSet>;
  readonly finance: Partial<FinancePortSet>;
  readonly assess: Partial<AssessPorts>;
  readonly attendance: Partial<AttendancePorts>;
  readonly scheduling: Parameters<typeof registerSchedulingPorts>[0];
  readonly payroll: PayrollPortsInput;
  readonly results: Partial<ResultsPorts>;
  readonly reportcards: Partial<ReportcardsPorts>;
  readonly higher: Partial<HigherPorts>;
  /** Sources des read-models de direction (025) : lectures de tenancy, academic, people, results, attendance, finance, payroll. */
  readonly analytics: AnalyticsSourcePorts;
  readonly messaging: Partial<MessagingPorts>;
  /** Imports Excel / CSV (031) : un port d'écriture par importeur, bâti sur l'API publique des modules cibles. */
  readonly imports: Partial<ImportPorts>;
  /** Gestion documentaire (024) : stockage, annuaire des propriétaires (people, iam), antivirus et conversion (environnement), usage. */
  readonly documents: Partial<DocumentsPorts>;
  /** Canaux externes (016) : coordonnées de remise, échéances en retard, résultats FINAL, charge d'enseignement, annonces. */
  readonly notifications: Partial<NotificationsPorts>;
  /** Examens nationaux (018) : élèves et inscriptions, règles `exam-national@1`, évaluations, pièces, documents officiels scellés, stockage. */
  readonly examinations: Partial<ExaminationsPorts>;
  /** Pack Primary (005) : classes, périodes, affectations, résultats, règles, assiduité, documents officiels. */
  readonly primary_school: Partial<PrimarySchoolPorts>;
  /** Admissions (007) : élève INACTIF, tuteurs, doublons (people), inscription (academic), facture (finance), catalogue, pièces, notifications. */
  readonly admissions: Partial<AdmissionsPorts>;
  /** Vie scolaire (006) : inscriptions et périodes (academic), tuteurs et périmètre (people), vue d'assiduité (attendance), information des tuteurs (notifications), statut d'élève (people). */
  readonly schoollife: Partial<SchoolLifePorts>;
  /** Élèves affectés par l'État (006) : inscription et financement (academic), facturation (finance), présence (attendance), pièces (documents), noms et tutelle (people). La passerelle reste `NotConfigured`. */
  readonly stateassign: Partial<StateassignPorts>;
  /** Conseils de classe (006) : classes, effectif, inscriptions et issues (academic), résultats et délibération (results), assiduité, vie scolaire (comptages), personnel et tutelle (people), notifications, PV scellé (reportcards), stockage, modèle de pack (tenancy). */
  readonly councils: Partial<CouncilsPorts>;
}

/** Construit les adaptateurs de chaque paire de modules sur un kit de lecture. `storage` : stockage d'objets (ou `null`). */
export function buildPlatformPorts(
  kit: AdapterKit,
  storage: ObjectStorage | null,
  documents: OfficialDocumentDepsOptions = {},
  extras: { documentRenderer?: PdfRenderer; audit?: Pick<RuntimeAuditPort, "record"> } = {},
): PlatformPorts {
  const officialDocuments = createOfficialDocumentDeps(kit, storage, documents);
  const documentRenderer = extras.documentRenderer;
  const { academic, people, finance, attendance, scheduling, results, reportcards, assess, higher, rules, lookups, clock } = kit;
  const messagingDirectory = createMessagingPeopleDirectory({ people, academic, lookups, tenantDb: kit.tenantDb, clock });
  // Politique antivirus UNIQUE de la plateforme : `documents` l'applique avec quarantaine ; les autres modules qui stockent des
  // fichiers (messagerie, photos, justificatifs) l'appliquent par enveloppe de leur vue de stockage (aucune modification de leur code).
  const scan = scanPolicyFromEnv(kit.env, { warn: (m) => kit.logger.warn({}, m) });
  const scanned = () => scan;
  const primaryAttendance = createPrimaryAttendancePort({ attendance, academic });
  // Admissions : écriture par les cas d'usage publics de people, academic, finance (avec le VRAI audit), dans la transaction du module.
  const admissionsEnv = createAdmissionsWriteEnv(kit, () => base, extras.audit);
  const schoollifePeople = createSchoollifePeoplePort(people, academic, lookups);
  const base: Omit<PlatformPorts, "imports" | "examinations" | "stateassign" | "councils"> = {
    academic: {
      students: createAcademicStudentDirectory(people),
      guardianship: createAcademicGuardianship(people),
      readiness: createAcademicOfferingReadiness(people),
      schedule: createAcademicScheduleChecker(scheduling),
      usageGuard: createAcademicUsageGuard(assess, results),
      completion: createAcademicCompletionLookup(higher, academic),
      registrationFee: createAcademicRegistrationFeeProbe(finance, academic, clock),
      invoiceFacts: createAcademicInvoiceFactsReader(finance),
      promotions: createAcademicPromotionDecisions(results),
    },
    people: {
      academic: createPeopleAcademicQuery(academic),
      ...(storage ? { storage: withMalwareScan(asPeopleStorage(storage), scanned) } : {}),
    },
    finance: {
      learners: createFinanceLearnerDirectory(people),
      enrollments: createFinanceEnrollmentDirectory(academic),
      guardianship: createFinanceGuardianshipPort(lookups),
      documents: createFinanceReceiptDocuments(officialDocuments),
    },
    assess: {
      roster: createAssessRosterPort(academic),
      periods: createAssessPeriodPort(academic),
      curriculum: createAssessCurriculumPort(academic),
      teaching: createAssessTeachingPort(people, lookups),
      guardianship: createAssessGuardianshipPort(lookups),
      names: createAssessActorNamePort(lookups),
    },
    attendance: {
      roster: createAttendanceRosterPort(academic),
      periods: createAttendancePeriodPort(academic),
      occurrences: createAttendanceOccurrencePort(scheduling),
      people: createAttendancePeoplePort(people, lookups),
      ...(storage ? { storage: withMalwareScan(asAttendanceStorage(storage), scanned) } : {}),
    },
    scheduling: {
      academic: createSchedulingAcademicQuery(academic),
      people: createSchedulingPeopleQuery(people, lookups),
      attendance: createSchedulingAttendanceQuery(attendance),
    },
    payroll: {
      sessionHours: createPayrollSessionHours(scheduling),
      attendanceHours: createPayrollAttendanceHours(attendance, scheduling),
      staff: createPayrollStaffDirectory(people, lookups),
      documents: createPayrollPayslipDocuments(officialDocuments),
      curriculum: createPayrollCurriculumLabelPort(academic),
    },
    results: {
      curriculum: createResultsCurriculumPort(academic),
      roster: createResultsRosterPort(academic),
      guardianship: createResultsGuardianshipPort(lookups),
      names: createResultsActorNamePort(lookups),
      // faits de fin d année des règles `cas_absences` et `cas_deja_redoublant` (contrat coef-period@1) : attendance + academic
      yearFacts: createResultsYearFactsPort({ attendance, academic }),
    },
    reportcards: {
      results: createReportcardsResultsRead({ results, academic, people, rules }),
      guardianship: createReportcardsGuardianshipPort(lookups),
      attendance: createReportcardsAttendanceSummary(attendance),
      standing: createReportcardsLearnerStanding(finance),
      // Vérification publique des diplômes et attestations : higher lit, reportcards revérifie signature et empreinte.
      external: {
        DIPLOMA: createHigherDocumentVerifier(higher),
        ATTESTATION_SUCCESS: createHigherDocumentVerifier(higher),
        ATTESTATION_AUTHENTICITY: createHigherDocumentVerifier(higher),
      },
      directory: createReportcardsUserDirectory(lookups),
      ...(storage ? { storage } : {}),
    },
    higher: {
      credits: createHigherCreditsSource(results, academic),
      resitSession: createHigherResitSession(results),
      cycleResults: createHigherCycleResults(results, academic),
      curriculum: createHigherCurriculumPort(academic),
      enrollments: createHigherEnrollmentDirectory(academic),
      students: createHigherStudentDirectory(people, lookups),
      actors: createHigherActorDirectory(lookups),
      signatories: createHigherSignatoryDirectory(reportcards),
      institution: createHigherInstitutionPort(reportcards),
      documents: createHigherDocumentFiles(kit, storage, documentRenderer ? { renderer: documentRenderer } : {}),
    },
    analytics: createAnalyticsSources(kit),
    messaging: {
      directory: messagingDirectory,
      audience: createMessagingAudienceDirectory({ people, academic, lookups, tenantDb: kit.tenantDb, clock, directory: messagingDirectory }),
      ...(storage ? { storage: withMalwareScan(asMessagingStorage(storage), scanned) } : {}),
    },
    documents: {
      owners: createDocumentsOwnerDirectory({ people, lookups, tenantDb: kit.tenantDb }),
      usage: createDocumentsUsageReporter(kit.tenantDb),
      scan,
      converter: officeConverterFromEnv(kit.env),
      ...(storage ? { storage: asDocumentsStorage(storage) } : {}),
    },
    notifications: {
      directory: createNotificationsDirectory({ people, academic, lookups, tenantDb: kit.tenantDb, clock }),
      overdue: createNotificationsOverdueSource(kit),
      grades: createNotificationsGrades(kit),
      teachingLoad: createNotificationsTeachingLoad(kit),
      announcements: createNotificationsAnnouncements(kit),
    },
    primary_school: {
      classrooms: createPrimaryClassroomPort({ academic, people, tenantDb: kit.tenantDb, clock }),
      periods: createPrimaryPeriodStatePort(academic),
      outcomes: createPrimaryOutcomePort(academic),
      teaching: createPrimaryTeachingPort({ people, lookups, clock }),
      guardianship: createPrimaryGuardianshipPort(lookups),
      results: createPrimaryResultsPort({ results, academic, rules }),
      rules: createPrimaryRulesPort({ academic, rules, results, attendance: primaryAttendance }),
      attendance: primaryAttendance,
      documents: createPrimaryDocumentsPort(officialDocuments),
    },
    admissions: {
      students: createAdmissionsStudentRegistry(admissionsEnv),
      enrollments: createAdmissionsEnrollmentService(admissionsEnv),
      fees: createAdmissionsRegistrationFees(admissionsEnv),
      catalog: createAdmissionsCatalog(admissionsEnv),
      documents: createAdmissionsDocumentStore(storage, scanned),
      actors: createAdmissionsActorDirectory(admissionsEnv),
      // Canal de notification : le module notifications est un chantier distinct (échec fermé documenté dans admissions-notifier.ts).
      notifier: createAdmissionsApplicantNotifier(null),
    },
    schoollife: {
      enrollments: createSchoollifeEnrollmentPort(academic),
      periods: createSchoollifePeriodPort(academic),
      people: schoollifePeople,
      attendance: createSchoollifeAttendanceView(attendance),
      notifications: createSchoollifeNotificationPort(createSchoollifeNotificationsDeps(kit), schoollifePeople),
      studentStatus: createSchoollifeStudentStatusPort(people),
    },
  };
  // Imports (031) : écriture par les cas d'usage publics des modules cibles, avec le VRAI audit (l'API : `runtime.auditPort` ;
  // le worker : le service d'audit du processus). Sans audit fourni (tests ciblés), l'audit est no-op.
  const writeEnv = createImportWriteEnv(kit, () => base, extras.audit);
  const imports: Partial<ImportPorts> = {
    targets: {
      students: createStudentsImportPort(writeEnv),
      guardians: createGuardiansImportPort(writeEnv),
      staff: createStaffImportPort(writeEnv),
      classrooms: createClassroomsImportPort(writeEnv),
      curriculum: createCurriculumImportPort(writeEnv),
      grades: createGradesImportPort(writeEnv),
      opening_balances: createOpeningBalancesImportPort(writeEnv),
    },
    names: createImportActorNames(writeEnv),
    ...(storage ? { storage } : {}),
    ...(extras.audit ? { audit: importsAuditAdapter(extras.audit) } : {}),
  };
  // Examens nationaux (018) : chaque port est bâti sur l'API PUBLIQUE du fournisseur ; un point attendu et absent fait échouer le port FERMÉ.
  const documentsDeps = createDocumentsDeps({ db: kit.tenantDb, clock: kit.clock, logger: kit.logger, ports: base.documents });
  const examinations: Partial<ExaminationsPorts> = {
    students: createExaminationsStudentDirectory({ academic, people }),
    eligibility: createExaminationsEligibilityFacts({ academic, people }),
    institutions: createExaminationsInstitutions(kit),
    family: createExaminationsFamilyLinks(lookups),
    rules: createExaminationsRulesPort(rules),
    assess: createExaminationsAssessPort(assess),
    pieces: createExaminationsPieceDocuments(documentsDeps),
    officialDocuments: createExaminationsOfficialDocuments(officialDocuments),
    ...(storage ? { storage: asDocumentsStorage(storage) } : {}),
  };
  // Élèves affectés par l'État (006) : lectures et écriture du financement par les cas d'usage PUBLICS d'academic, finance,
  // attendance, documents, people. La passerelle vers une plateforme publique n'est pas branchée : `NotConfigured` (aucun appel externe).
  const stateassignDocumentsDeps = createDocumentsDeps({
    db: kit.tenantDb,
    clock: kit.clock,
    logger: kit.logger,
    portsProvider: () => base.documents,
    ...(extras.audit ? { audit: documentsAuditAdapter(extras.audit) } : {}),
  });
  const stateassign: Partial<StateassignPorts> = {
    enrollments: createStateassignEnrollmentPort(academic),
    funding: createStateassignFundingPort(academic),
    finance: createStateassignFinancePort(finance, academic),
    attendance: createStateassignAttendanceFacts(attendance),
    documents: createStateassignDocumentRefs(stateassignDocumentsDeps),
    students: createStateassignStudentNames(people),
    guardianship: createStateassignGuardianshipPort(lookups),
  };
  // Conseils de classe (006) : lectures et écritures par les API PUBLIQUES des modules voisins ; `councils` ne calcule aucune règle.
  // La vie scolaire est lue par ses fonctions publiques (comptages et codes), sur ses propres ports.
  const councilsSchoollifeDeps = createSchoolLifeDeps({ db: kit.tenantDb, clock: kit.clock, logger: kit.logger, portsProvider: () => base.schoollife });
  const councils: Partial<CouncilsPorts> = {
    academic: createCouncilsAcademicPort({ academic, people, tenantDb: kit.tenantDb, clock }),
    outcomes: createCouncilsOutcomePort(academic),
    resultsRead: createCouncilsResultsRead({ results, academic, rules }),
    resultsWrite: createCouncilsResultsWrite(results),
    ruleCodes: createCouncilsRuleCodes(rules),
    attendance: createCouncilsAttendancePort({ attendance, academic }),
    schoollife: createCouncilsSchoolLifePort(councilsSchoollifeDeps),
    staff: createCouncilsStaffPort(people, lookups),
    family: createCouncilsFamilyPort(people, lookups),
    studentStatus: createCouncilsStudentStatusPort(people),
    notifications: createCouncilsNotificationPort(createSchoollifeNotificationsDeps(kit), people),
    documents: createCouncilsDocumentsPort(reportcards, storage),
    storage: createCouncilsStoragePort(storage),
    templates: createCouncilsTemplatePort(),
  };
  return { ...base, imports, examinations, stateassign, councils };
}

export interface WiredPlatform {
  readonly kit: AdapterKit;
  readonly ports: PlatformPorts;
  readonly storage: ObjectStorage | null;
}

/**
 * Branche l'API : appelée par `registerV2Platform` APRÈS le chargement des modules (les registres de ports sont lus à la
 * requête, l'ordre n'a pas d'importance). Le repli disque du stockage expose sa route d'URL signées.
 */
export function wireApiPorts(app: FastifyInstance, runtime: ModuleRuntime): WiredPlatform {
  const storage = createObjectStorage(runtime.env, { warn: (m) => runtime.logger.warn({}, m) });
  const kit = createAdapterKit({ tenantDb: runtime.tenantDb, systemDb: runtime.systemDb, clock: runtime.clock, logger: runtime.logger, env: runtime.env });
  const ports = buildPlatformPorts(kit, storage, { audit: reportcardsAuditAdapter(runtime.auditPort) }, { audit: runtime.auditPort });
  registerAcademicPorts(app, ports.academic);
  registerPeoplePorts(app, ports.people);
  registerFinancePorts(app, ports.finance);
  registerAssessPorts(app, ports.assess);
  registerAttendancePorts(app, ports.attendance);
  registerSchedulingPorts(ports.scheduling);
  registerPayrollPorts(app, ports.payroll);
  registerResultsPorts(app, ports.results);
  registerReportcardsPorts(app, ports.reportcards);
  registerHigherPorts(app, ports.higher);
  registerAnalyticsPorts(app, ports.analytics);
  registerMessagingPorts(app, ports.messaging);
  registerPrimarySchoolPorts(app, ports.primary_school);
  registerImportsPorts(app, ports.imports);
  registerDocumentsPorts(app, ports.documents);
  registerNotificationsPorts(app, ports.notifications);
  registerExaminationsPorts(app, ports.examinations);
  registerAdmissionsPorts(app, ports.admissions);
  registerSchoolLifePorts(app, ports.schoollife);
  registerStateassignPorts(app, ports.stateassign);
  registerCouncilsPorts(app, ports.councils);
  if (storage instanceof DiskStorage) registerDiskStorageRoute(app, storage);
  return { kit, ports, storage };
}

export interface WorkerAdapterInput {
  readonly tenantDb: TenantDb;
  readonly systemDb: SystemDb;
  readonly logger: Logger;
  readonly clock?: Clock | undefined;
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
}

/**
 * Branche le worker (abonnés et jobs des modules) : ports d'`academic` (confirmation d'inscription sur facture soldée…),
 * `people`, `results` (recalcul), `higher` (capitalisation, éligibilité), `scheduling` (abonnés) et ressources de rendu des
 * bulletins (stockage d'objets). Chaque port non branché ferait échouer fermé les abonnés concernés.
 */
export function installWorkerAdapters(input: WorkerAdapterInput): WiredPlatform {
  const env = input.env ?? process.env;
  const storage = createObjectStorage(env, { warn: (m) => input.logger.warn({}, m) });
  const kit = createAdapterKit({ tenantDb: input.tenantDb, systemDb: input.systemDb, clock: input.clock, logger: input.logger, env });
  const ports = buildPlatformPorts(kit, storage, {}, { audit: { record: (tx, entry) => auditService.record(tx, entry as Parameters<typeof auditService.record>[1]) } });
  setAcademicWorkerPorts(ports.academic);
  setPeopleWorkerPorts(ports.people);
  setResultsWorkerPorts(ports.results);
  registerHigherWorkerPorts(ports.higher);
  registerSchedulingPorts(ports.scheduling);
  setAnalyticsWorkerPorts(ports.analytics);
  setMessagingWorkerPorts(ports.messaging);
  setPrimarySchoolWorkerPorts(ports.primary_school);
  setImportsWorkerPorts(ports.imports);
  setDocumentsWorkerPorts(ports.documents);
  setNotificationsWorkerPorts(ports.notifications);
  setExaminationsWorkerPorts(ports.examinations);
  setAdmissionsWorkerPorts(ports.admissions);
  setStateassignWorkerPorts(ports.stateassign);
  setCouncilsWorkerPorts(ports.councils);
  if (storage) setReportcardsWorkerResources({ storage });
  return { kit, ports, storage };
}
