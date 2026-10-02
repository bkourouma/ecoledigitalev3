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
import {
  registerAcademicPorts,
  setAcademicWorkerPorts,
  type AcademicPorts,
} from "../../modules/academic";
import { registerAnalyticsPorts, setAnalyticsWorkerPorts, type AnalyticsSourcePorts } from "../../modules/analytics";
import { registerAssessPorts, type AssessPorts } from "../../modules/assess";
import { registerAttendancePorts, type AttendancePorts } from "../../modules/attendance";
import { registerFinancePorts, type FinancePortSet } from "../../modules/finance";
import { registerHigherPorts, registerHigherWorkerPorts, type HigherPorts } from "../../modules/higher";
import { registerPeoplePorts, setPeopleWorkerPorts, type PeoplePortSet } from "../../modules/people";
import { registerPayrollPorts, type PayrollPortsInput } from "../../modules/payroll";
import { registerReportcardsPorts, setReportcardsWorkerResources, type ReportcardsPorts } from "../../modules/reportcards";
import { registerResultsPorts, setResultsWorkerPorts, type ResultsPorts } from "../../modules/results";
import { registerSchedulingPorts } from "../../modules/scheduling";
import type { ModuleRuntime } from "../runtime";
import { createAcademicCompletionLookup, createAcademicScheduleChecker, createAcademicUsageGuard } from "./academic-guards";
import { createAnalyticsSources } from "./analytics-sources";
import { createAssessCurriculumPort, createAssessPeriodPort, createAssessRosterPort } from "./academic-assess";
import { createAttendancePeriodPort, createAttendanceRosterPort } from "./academic-attendance";
import { createHigherCurriculumPort, createHigherEnrollmentDirectory } from "./academic-higher";
import { createPayrollCurriculumLabelPort } from "./academic-payroll";
import { createPeopleAcademicQuery } from "./academic-people";
import { createResultsCurriculumPort, createResultsRosterPort } from "./academic-results";
import { createSchedulingAcademicQuery } from "./academic-scheduling";
import { createReportcardsAttendanceSummary } from "./attendance-reportcards";
import { createFinanceEnrollmentDirectory, createFinanceLearnerDirectory } from "./directories-finance";
import { createAcademicInvoiceFactsReader, createAcademicRegistrationFeeProbe } from "./finance-academic";
import { createReportcardsLearnerStanding } from "./finance-reportcards";
import { createAssessActorNamePort, createAssessGuardianshipPort, createAssessTeachingPort } from "./people-assess";
import { createAcademicGuardianship, createAcademicOfferingReadiness, createAcademicStudentDirectory } from "./people-academic";
import { createAttendancePeoplePort } from "./people-attendance";
import { createHigherActorDirectory, createHigherStudentDirectory } from "./people-higher";
import { createPayrollStaffDirectory } from "./people-payroll";
import { createReportcardsGuardianshipPort, createReportcardsUserDirectory } from "./people-reportcards";
import { createResultsActorNamePort, createResultsGuardianshipPort } from "./people-results";
import { createSchedulingPeopleQuery } from "./people-scheduling";
import { createPayrollAttendanceHours, createPayrollSessionHours } from "./payroll-sources";
import { createHigherInstitutionPort, createHigherSignatoryDirectory } from "./reportcards-higher";
import { createReportcardsResultsRead } from "./results-reportcards";
import { createHigherCreditsSource, createHigherCycleResults, createHigherResitSession } from "./results-higher";
import { createAttendanceOccurrencePort, createSchedulingAttendanceQuery } from "./scheduling-attendance";
import { asAttendanceStorage, asPeopleStorage, createObjectStorage, DiskStorage, registerDiskStorageRoute, type ObjectStorage } from "./storage";
import { createAdapterKit, type AdapterKit } from "./kit";

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
}

/** Construit les adaptateurs de chaque paire de modules sur un kit de lecture. `storage` : stockage d'objets (ou `null`). */
export function buildPlatformPorts(kit: AdapterKit, storage: ObjectStorage | null): PlatformPorts {
  const { academic, people, finance, attendance, scheduling, results, reportcards, assess, higher, rules, lookups, clock } = kit;
  return {
    academic: {
      students: createAcademicStudentDirectory(people),
      guardianship: createAcademicGuardianship(people),
      readiness: createAcademicOfferingReadiness(people),
      schedule: createAcademicScheduleChecker(scheduling),
      usageGuard: createAcademicUsageGuard(assess, results),
      completion: createAcademicCompletionLookup(higher, academic),
      registrationFee: createAcademicRegistrationFeeProbe(finance, academic, clock),
      invoiceFacts: createAcademicInvoiceFactsReader(finance),
    },
    people: {
      academic: createPeopleAcademicQuery(academic),
      ...(storage ? { storage: asPeopleStorage(storage) } : {}),
    },
    finance: {
      learners: createFinanceLearnerDirectory(people),
      enrollments: createFinanceEnrollmentDirectory(academic),
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
      ...(storage ? { storage: asAttendanceStorage(storage) } : {}),
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
      curriculum: createPayrollCurriculumLabelPort(academic),
    },
    results: {
      curriculum: createResultsCurriculumPort(academic),
      roster: createResultsRosterPort(academic),
      guardianship: createResultsGuardianshipPort(lookups),
      names: createResultsActorNamePort(lookups),
    },
    reportcards: {
      results: createReportcardsResultsRead({ results, academic, people, rules }),
      guardianship: createReportcardsGuardianshipPort(lookups),
      attendance: createReportcardsAttendanceSummary(attendance),
      standing: createReportcardsLearnerStanding(finance),
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
    },
    analytics: createAnalyticsSources(kit),
  };
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
  const ports = buildPlatformPorts(kit, storage);
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
  const ports = buildPlatformPorts(kit, storage);
  setAcademicWorkerPorts(ports.academic);
  setPeopleWorkerPorts(ports.people);
  setResultsWorkerPorts(ports.results);
  registerHigherWorkerPorts(ports.higher);
  registerSchedulingPorts(ports.scheduling);
  setAnalyticsWorkerPorts(ports.analytics);
  if (storage) setReportcardsWorkerResources({ storage });
  return { kit, ports, storage };
}
