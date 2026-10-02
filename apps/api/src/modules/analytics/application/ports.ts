/**
 * Ports du module `analytics` : ce que l'application attend de l'extérieur, décrit structurellement.
 *
 *  - `AuditPort` : audit dans la transaction (le plugin le satisfait avec `runtime.auditPort`) ;
 *  - ports SOURCES (`AnalyticsSourcePorts`) : la lecture des faits des autres modules. `analytics` n'importe AUCUN autre
 *    module et n'écrit aucun SQL vers leurs schémas : les adaptateurs de `apps/api/src/platform/adapters/analytics-*.ts`
 *    traduisent l'API PUBLIQUE de chaque fournisseur (academic, people, results, attendance, finance, payroll, tenancy)
 *    vers ces ports. Un port non branché ne fait JAMAIS échouer l'API : la passe est marquée `UNAVAILABLE` et la réponse
 *    déclare le manque (`gaps`), sans chiffre inventé.
 *
 * Toutes les méthodes reçoivent un contexte SYSTÈME du tenant (`createSystemContext`) : les read-models sont ceux de
 * l'établissement entier ; le périmètre de l'utilisateur est appliqué à la LECTURE (`filters.ts`).
 */
import type { Clock, Logger, RequestContext } from "@ecoledigitale/kernel";
import type { TenantDb, Tx } from "@ecoledigitale/database";
import type {
  AttendanceDayFact,
  CashSessionFact,
  ClassPeriodResults,
  ClassroomFact,
  CollectionPointFact,
  EnrollmentFact,
  FinanceScopeFacts,
  PayrollStatusFact,
  PeriodFact,
  ScopeFact,
  StaffPresenceFact,
  TeachingLoadFact,
  Uuid,
  YearFact,
} from "../domain/types";

/** Entrée d'audit : tenant, acteur et requête sont dérivés du contexte de la transaction. */
export interface AuditEntry {
  /** entité.verbe, ex. analytics.export.download */
  action: string;
  /** Type d'objet (snake_case), ex. export */
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
  severity?: "info" | "notice" | "warning" | "critical";
}

export interface AuditPort {
  record(tx: Tx, entry: AuditEntry): Promise<unknown>;
}

export const noopAudit: AuditPort = { async record() {} };

/** Établissements et campus (tenancy). */
export interface ScopeSource {
  listScopes(ctx: RequestContext): Promise<ScopeFact[]>;
}

/** Années, périodes et classes (academic). */
export interface CalendarSource {
  listYears(ctx: RequestContext): Promise<YearFact[]>;
  listPeriods(ctx: RequestContext, yearId: Uuid): Promise<PeriodFact[]>;
  listClassrooms(ctx: RequestContext, yearId: Uuid): Promise<ClassroomFact[]>;
}

/** Inscriptions enrichies du sexe de l'élève (academic + people). */
export interface EnrollmentSource {
  /** Toutes les inscriptions d'une année (`yearId`) ou de toutes les années (`null`). */
  listEnrollments(ctx: RequestContext, input: { yearId: Uuid | null }): Promise<EnrollmentFact[]>;
}

/** Résultats FINAL d'une classe pour une période (results), avec décisions confirmées et libellés des nœuds. */
export interface ResultsSource {
  /** Couples (classe, période) à lire : pour une période (`periodId`) ou une année (`yearId`). */
  listClassPeriods(ctx: RequestContext, input: { yearId?: Uuid | undefined; periodId?: Uuid | undefined }): Promise<Array<{ classroomId: Uuid; periodId: Uuid }>>;
  readClassPeriod(ctx: RequestContext, input: { classroomId: Uuid; periodId: Uuid }): Promise<ClassPeriodResults>;
}

/** Pointages d'élèves (attendance) agrégés par jour et par classe, sur un intervalle de dates. */
export interface AttendanceSource {
  readDays(ctx: RequestContext, input: { from: string; to: string }): Promise<AttendanceDayFact[]>;
}

/** Présence du personnel (attendance), par jour et par membre, sur un intervalle de dates. */
export interface StaffPresenceSource {
  readDays(ctx: RequestContext, input: { from: string; to: string }): Promise<StaffPresenceFact[]>;
}

/** Facturé / encaissé / créances (finance), par année (code) et campus (`null` = tous). */
export interface FinanceSource {
  /** Combinaisons (année, campus) à produire : `*` pour « tous ». */
  readScope(ctx: RequestContext, input: { yearCode: string | null; campusId: Uuid | null; asOf: string }): Promise<FinanceScopeFacts | null>;
  readCollections(ctx: RequestContext, input: { from: string; to: string }): Promise<CollectionPointFact[]>;
  listCashSessions(ctx: RequestContext): Promise<CashSessionFact[]>;
}

/** Masse salariale par période et statut (payroll). */
export interface PayrollSource {
  readMass(ctx: RequestContext): Promise<PayrollStatusFact[]>;
}

/** Charge d'enseignement par membre du personnel (people). */
export interface TeachingLoadSource {
  readLoads(ctx: RequestContext, input: { yearId: Uuid }): Promise<TeachingLoadFact[]>;
}

export interface AnalyticsSourcePorts {
  scopes: ScopeSource;
  calendar: CalendarSource;
  enrollments: EnrollmentSource;
  results: ResultsSource;
  attendance: AttendanceSource;
  staffPresence: StaffPresenceSource;
  finance: FinanceSource;
  payroll: PayrollSource;
  teachingLoad: TeachingLoadSource;
}

/** Nom d'un port, pour la déclaration des manques. */
export type SourcePortName = keyof AnalyticsSourcePorts;

export interface AnalyticsDeps {
  tenantDb: TenantDb;
  clock: Clock;
  logger: Logger;
  audit: AuditPort;
  /** Ports sources résolus à l'appel (ordre de chargement indifférent) : `undefined` = non branché. */
  sources: () => Partial<AnalyticsSourcePorts>;
}
