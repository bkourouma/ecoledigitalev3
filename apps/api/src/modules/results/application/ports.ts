/**
 * Ports du module `results` : tout ce qui vient d'ailleurs est décrit STRUCTURELLEMENT, sans importer le schéma d'un autre
 * module (ADR-001). Les implémentations RÉELLES des ports `GradesPort`, `LockPort` (module `assess`) et `RulesPort`
 * (module `rules`) sont dans `infrastructure/` et passent par les `index.ts` publics de ces modules. Les ports
 * `CurriculumPort`, `RosterPort`, `GuardianshipPort` sont fournis par `academic` et `people` (enregistrés par
 * `registerResultsPorts(app, ports)`) ; non branchés, ils sont INDISPONIBLES (échec fermé), jamais « tout autorisé ».
 *
 * Aucune formule, aucun seuil : le port de règles évalue des CLÉS de règle sur des contextes typés.
 */
import type { RequestContext, Result, AppError } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import type { BatchEvaluator } from "../domain/pipeline/runner";
import type { ClassStructure, CompetencyCounters, EnrollmentRef, EnrollmentYearFacts, GradeFact } from "../domain/types";

/** Entrée d'audit telle que l'attend `audit.record` (identique à `RuntimeAuditEntry`). */
export interface AuditEntry {
  action: string;
  entity: string;
  entityId?: string | number | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
  severity?: "info" | "notice" | "warning" | "critical";
}

export interface AuditPort {
  record(tx: Tx, entry: AuditEntry): Promise<unknown>;
}

export const noopAudit: AuditPort = Object.freeze({
  async record(): Promise<void> {
    /* le module audit n'est pas branché */
  },
});

export class RecordingAudit implements AuditPort {
  readonly entries: AuditEntry[] = [];
  async record(_tx: Tx, entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }
  actions(): string[] {
    return this.entries.map((e) => e.action);
  }
  clear(): void {
    this.entries.length = 0;
  }
}

/** Curriculum, périodes et attributs de programme (004) : structure d'une classe × période. */
export interface CurriculumPort {
  getStructure(ctx: RequestContext, input: { classroomId: string; academicPeriodId: string }): Promise<ClassStructure | null>;
}

export interface RosterEntry extends EnrollmentRef {
  /** Inscription active (non retirée) : seules les inscriptions actives sont calculées. */
  readonly active: boolean;
  readonly classroomId: string;
}

/** Inscriptions d'une classe (004 / 008). */
export interface RosterPort {
  listEnrollments(ctx: RequestContext, classroomId: string): Promise<readonly RosterEntry[]>;
}

/** Lien élève ↔ compte et tutelle (008) : relu à CHAQUE lecture famille. */
export interface GuardianshipPort {
  studentIdForUser(ctx: RequestContext, userId: string): Promise<string | null>;
  isGuardianOf(ctx: RequestContext, userId: string, studentId: string): Promise<boolean>;
}

export interface ActorNamePort {
  nameOf(ctx: RequestContext, userId: string): Promise<string>;
  /** Personnel (`people.staff.id`) lié au compte, ou `null` (auteur d'une appréciation). */
  staffIdForUser(ctx: RequestContext, userId: string): Promise<string | null>;
}

// --------------------------------------------------------------------------------------------------------------------
// Notes et verrous (module assess, via son API publique)
// --------------------------------------------------------------------------------------------------------------------

export interface PendingAssessmentInfo {
  id: string;
  title: string;
  status: string;
  sessionNo: number;
  curriculumNodeId: string;
}

export interface LockOutcome {
  alreadyLocked: boolean;
  pending: PendingAssessmentInfo[];
}

/** Notes publiées et verrou de période (assess). Toutes les opérations rejoignent la transaction `tx` de l'appelant. */
export interface AssessPort {
  listPublished(ctx: RequestContext, tx: Tx, input: { classroomId: string; academicPeriodId: string }): Promise<readonly GradeFact[]>;
  lock(ctx: RequestContext, tx: Tx, input: { classroomId: string; academicPeriodId: string; sessions: readonly (1 | 2)[]; force: boolean; reason: string | null }): Promise<Result<LockOutcome, AppError>>;
  /** Libère toutes les sessions (réouverture CORRECTION). */
  unlock(ctx: RequestContext, tx: Tx, input: { classroomId: string; academicPeriodId: string; reason: string }): Promise<Result<void, AppError>>;
  /** Libère la session 2 seulement (fenêtre de rattrapage). */
  releaseSession2(ctx: RequestContext, tx: Tx, input: { classroomId: string; academicPeriodId: string; reason: string }): Promise<Result<void, AppError>>;
  listPending(ctx: RequestContext, tx: Tx, input: { classroomId: string; academicPeriodId: string }): Promise<readonly PendingAssessmentInfo[]>;
}

// --------------------------------------------------------------------------------------------------------------------
// Règles (module rules, via son API publique)
// --------------------------------------------------------------------------------------------------------------------

export interface RulePin {
  readonly ruleVersionKind: "TENANT" | "NATIONAL";
  readonly ruleVersionId: string;
  readonly ruleSetCode: string;
  readonly ruleVersionNo: number;
  readonly definitionHash: string;
}

/** Provenance d'une version de règles : `placeholder` = jeu de DÉMONSTRATION (filigrane obligatoire sur tout ce qui en dérive). */
export type RuleSourceKind = "regulation" | "institution" | "platform" | "placeholder";

export interface RuleSession {
  readonly pin: RulePin;
  readonly engineVersion: string;
  readonly contractId: string;
  /** Provenance de la version épinglée (`placeholder` ⇒ résultats marqués « règles de démonstration »). */
  readonly sourceKind: RuleSourceKind;
  /** La version épinglée définit-elle cette règle ? (règles OPTIONNELLES du contrat : mention, appréciation, sections…) */
  hasRule(ruleKey: string): boolean;
  /** Évaluateur synchrone sur la version épinglée (déjà chargée, hash vérifié). `trace` : conserver la trace du moteur. */
  evaluator(options: { trace: boolean }): BatchEvaluator;
}

export interface ResolveRequest {
  readonly contractId: string;
  readonly institutionId?: string | undefined;
  readonly levelCode?: string | undefined;
  readonly educationLevelCode?: string | undefined;
  /** Date de DÉBUT de la période (jamais l'horloge, R-RUL-05). */
  readonly date: string;
}

export interface RulesPort {
  /** Version applicable à la date, ou `null` (⇒ `results.no_active_ruleset`, jamais de valeur par défaut). */
  resolve(ctx: RequestContext, request: ResolveRequest): Promise<Result<(RulePin & { contractId: string }) | null, AppError>>;
  /** Charge la version épinglée (hash vérifié : `rules.hash_mismatch` si elle a dérivé) et rend un évaluateur. */
  open(ctx: RequestContext, pin: RulePin & { contractId: string }): Promise<Result<RuleSession, AppError>>;
  /** Provenance de la version épinglée (lecture légère, sans évaluateur) ; `null` si elle est introuvable. */
  sourceKindOf?(ctx: RequestContext, pin: RulePin): Promise<RuleSourceKind | null>;
}

/**
 * Faits de fin d'année par inscription (spec 005, règles `cas_absences` et `cas_deja_redoublant`) : absences en journées et jours
 * ouverts (module `attendance`), redoublements du cycle (module `academic`). Port FACULTATIF : non branché, les faits sont signalés
 * indisponibles (`yearFacts: "UNAVAILABLE"`) et les cas valent `false` — jamais une valeur devinée.
 */
export interface YearFactsPort {
  getYearFacts(ctx: RequestContext, input: { classroomId: string; academicYearId: string; enrollmentIds: readonly string[] }): Promise<ReadonlyMap<string, EnrollmentYearFacts>>;
}

/**
 * Compteurs de compétences par inscription (module `primary_school`) : entrée de `decision_fin_annee` du contrat
 * `competency-period@1`. Non branché à la dernière période : calcul refusé (échec fermé), jamais de décision sans compteur.
 */
export interface CompetencyCountersPort {
  getCompetencyCounters(ctx: RequestContext, input: { classroomId: string; academicYearId: string; enrollmentIds: readonly string[] }): Promise<ReadonlyMap<string, CompetencyCounters>>;
}

export interface ResultsPorts {
  readonly curriculum: CurriculumPort;
  readonly roster: RosterPort;
  readonly assess: AssessPort;
  readonly rules: RulesPort;
  readonly guardianship: GuardianshipPort;
  readonly names: ActorNamePort;
  /** Faits d'assiduité et de redoublement (contrat `coef-period@1`) ; facultatif. */
  readonly yearFacts?: YearFactsPort | undefined;
  /** Compteurs de compétences (contrat `competency-period@1`) ; facultatif. */
  readonly competencyCounters?: CompetencyCountersPort | undefined;
}
