/**
 * Ports du module stateassign — ce qu'il attend de ses voisins, décrit structurellement.
 *
 * Élèves, inscriptions, factures, bourses, paiements, présences et documents sont des UUID SANS clé étrangère : leur existence et
 * leurs faits sont lus par ces ports, que fournit la plateforme (`apps/api/src/platform/adapters`) à partir des API PUBLIQUES
 * d'`academic`, `finance`, `attendance`, `documents` et `people`. Tant qu'un port n'est pas branché, le module ÉCHOUE FERMÉ
 * (`stateassign.port_unavailable`) : aucune vérification sans inscription lisible, aucun rapprochement sans `finance`.
 *
 * Un port appartient à un AUTRE module : aucune de ses fonctions ne prend de `Tx`. Les appels sont SÉQUENTIELS (ils partagent
 * la connexion de la transaction : jamais de `Promise.all`).
 *
 * Faits, jamais calculs : la présence vient d'`attendance`, la facturation de `finance` ; stateassign les consigne et les compare.
 */
import type { Tx } from "@ecoledigitale/database";
import type { Money, RequestContext, Result } from "@ecoledigitale/kernel";
import type { IsoDate, Uuid } from "../domain/types";

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export interface AuditEntry {
  /** `stateassign.<entité>.<verbe>` */
  readonly action: string;
  /** Type d'objet (snake_case). */
  readonly resourceType: string;
  readonly resourceId: string;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly reason?: string | null;
  readonly metadata?: Record<string, unknown> | null;
  /** Acte sensible : sévérité `notice` (vérification, avenant, rejet…). */
  readonly sensitive?: boolean;
}

export interface AuditPort {
  record(tx: Tx, ctx: RequestContext, entry: AuditEntry): Promise<unknown>;
}

export const noopAudit: AuditPort = Object.freeze({ async record() {} });

/** Audit enregistreur (tests). */
export class RecordingAudit implements AuditPort {
  readonly entries: AuditEntry[] = [];
  async record(_tx: Tx, _ctx: RequestContext, entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }
}

// ---------------------------------------------------------------------------
// Inscriptions (academic)
// ---------------------------------------------------------------------------

export interface EnrollmentFacts {
  readonly enrollmentId: Uuid;
  readonly studentId: Uuid;
  readonly institutionId: Uuid;
  readonly academicYearId: Uuid;
  /** `PENDING`, `ACTIVE`, `SUSPENDED`, `COMPLETED`, `WITHDRAWN`, `TRANSFERRED_OUT`, `CANCELLED`. */
  readonly status: string;
  readonly fundingType: string;
  readonly assignmentReference: string | null;
  readonly classroomId: Uuid | null;
}

export interface PeriodFacts {
  readonly id: Uuid;
  readonly label: string;
  readonly startsOn: IsoDate;
  readonly endsOn: IsoDate;
}

export interface EnrollmentPort {
  /** `null` si l'inscription n'existe pas ou est hors du périmètre du contexte. */
  getEnrollment(ctx: RequestContext, enrollmentId: Uuid): Promise<EnrollmentFacts | null>;
  /** Périodes d'une année (pour planifier les contrôles par période). */
  listPeriods(ctx: RequestContext, academicYearId: Uuid): Promise<readonly PeriodFacts[]>;
}

export interface SetFundingInput {
  readonly enrollmentId: Uuid;
  readonly reference: string;
  readonly issuedOn: IsoDate | null;
  /** Autorité émettrice (financeur) telle que saisie sur le dossier ; `null` si non renseignée. */
  readonly funderLabel: string | null;
  /**
   * Montant de l'État déclaré par le dossier (O-04, cumul) : sa PART du financement de l'inscription. Absent : comportement historique
   * (type de financement unique). Si l'inscription cumule déjà un autre financement, le montant est exigé.
   */
  readonly stateAmount?: Money | null;
  readonly reason: string;
}

export interface FundingRefusal {
  readonly code: string;
  readonly message: string;
}

/**
 * `academic.changeEnrollmentFunding(STATE_ASSIGNED, référence)` : la référence d'affectation de l'inscription n'a qu'UNE source,
 * le dossier VÉRIFIÉ. Appelé dans la transaction de la vérification : un refus d'`academic` annule la vérification.
 */
export interface EnrollmentFundingPort {
  setStateAssignedFunding(ctx: RequestContext, input: SetFundingInput): Promise<Result<true, FundingRefusal>>;
}

// ---------------------------------------------------------------------------
// Facturation (finance)
// ---------------------------------------------------------------------------

export interface FundingInvoiceFacts {
  readonly invoiceId: Uuid;
  readonly number: string | null;
  readonly status: string;
  readonly total: Money;
  /** Imputations nettes des remboursements. */
  readonly paid: Money;
  readonly credited: Money;
  readonly dueDate: IsoDate;
  /** Bourse (financeur) à laquelle la facture est liée, `null` pour la facture de la famille. */
  readonly scholarshipId: Uuid | null;
  /** Nature et nom du financeur (cumul, O-04) : renseignés pour les factures de financeur, absents pour la facture de la famille. */
  readonly funderKind?: string | null;
  readonly funderName?: string | null;
}

export interface FundingPaymentFacts {
  readonly paymentId: Uuid;
  readonly receivedAt: Date;
  readonly amount: Money;
  readonly allocated: Money;
  readonly reference: string | null;
}

export interface StateFundingBilling {
  readonly currency: string;
  /** Factures du financeur « État » (payeur FUNDER, bourse de nature STATE), non annulées. */
  readonly stateInvoices: readonly FundingInvoiceFacts[];
  /** Factures de la famille (payeur LEARNER), non annulées : elles ne portent QUE la part parent. */
  readonly parentInvoices: readonly FundingInvoiceFacts[];
  /**
   * Cumul de financements (O-04) : factures des AUTRES financeurs (bourse, entreprise…), une par prise en charge. Leur part est comptée
   * avec celle de la famille pour la comparer au montant « famille » déclaré (la famille ne paie que le reste après ces financeurs).
   * Absent : aucun autre financeur (comportement historique).
   */
  readonly otherFunderInvoices?: readonly FundingInvoiceFacts[];
  /** Paiements de financeur sans référence de prise en charge alors que plusieurs financeurs existent : jamais rattachés à l'État. */
  readonly unattributedPayments?: readonly FundingPaymentFacts[];
  /** Paiements reçus de l'État (financeur), confirmés. */
  readonly statePayments: readonly FundingPaymentFacts[];
  /** Bourses de nature STATE actives de l'élève pour l'année. */
  readonly scholarshipIds: readonly Uuid[];
}

export interface FinancePort {
  getStateFundingBilling(
    ctx: RequestContext,
    query: { readonly studentId: Uuid; readonly enrollmentId: Uuid; readonly academicYearId: Uuid; readonly scholarshipId: Uuid | null },
  ): Promise<StateFundingBilling>;
}

// ---------------------------------------------------------------------------
// Présence (attendance)
// ---------------------------------------------------------------------------

export interface AttendanceFacts {
  readonly absentMinutes: number;
  readonly excusedMinutes: number;
  readonly lateCount: number;
  readonly periodId: Uuid | null;
}

export interface AttendanceFactsPort {
  /** Faits de présence EFFECTIFS d'une inscription sur une période (ou l'année) ; `null` : aucun fait disponible. */
  getFacts(ctx: RequestContext, query: { readonly enrollmentId: Uuid; readonly periodId: Uuid | null }): Promise<AttendanceFacts | null>;
}

// ---------------------------------------------------------------------------
// Documents (documents) et élèves (people)
// ---------------------------------------------------------------------------

/** Le document référencé existe et est lisible par l'appelant (la GED applique ses propres droits). */
export interface DocumentRefPort {
  exists(ctx: RequestContext, documentRef: Uuid, caps: DocumentReadCaps): Promise<boolean>;
}

/** Droits de lecture de l'appelant sur la GED (permissions `documents.*`), sondés par le plugin HTTP. */
export interface DocumentReadCaps {
  readonly read?: boolean;
  readonly readRestricted?: boolean;
  readonly manage?: boolean;
}

export interface StudentNamesPort {
  /** « NOM Prénom » par élève ; les inconnus sont absents. Décoration : un échec ne casse jamais une liste. */
  names(ctx: RequestContext, studentIds: readonly Uuid[]): Promise<ReadonlyMap<Uuid, string>>;
}

export interface GuardianshipPort {
  /** Fiche élève liée au compte (`persons.identity_id`), jamais déduite de l'e-mail. */
  studentIdForUser(ctx: RequestContext, userId: string): Promise<string | null>;
  isGuardianOf(ctx: RequestContext, userId: string, studentId: string): Promise<boolean>;
  childrenOf(ctx: RequestContext, userId: string): Promise<string[]>;
}

// ---------------------------------------------------------------------------
// Passerelle vers une plateforme publique d'affectation (FUTURE, PRD §20)
// ---------------------------------------------------------------------------

export interface GatewayAssignment {
  readonly externalRef: string;
  readonly reference: string;
  readonly payloadHash: string;
}

export interface GatewayRefusal {
  readonly code: string;
  readonly message: string;
}

export interface StateGateway {
  /** Nom de l'adaptateur, affiché tel quel. */
  readonly adapter: string;
  status(): { readonly configured: boolean; readonly message: string };
  fetchAssignment(ctx: RequestContext, reference: string): Promise<Result<GatewayAssignment, GatewayRefusal>>;
  pushAttendanceCertificate(ctx: RequestContext, input: { readonly assignmentId: Uuid; readonly documentRef: Uuid }): Promise<Result<{ readonly externalRef: string }, GatewayRefusal>>;
}

export interface StateassignPorts {
  readonly enrollments: EnrollmentPort;
  readonly funding: EnrollmentFundingPort;
  readonly finance: FinancePort;
  readonly attendance: AttendanceFactsPort;
  readonly documents: DocumentRefPort;
  readonly students: StudentNamesPort;
  readonly guardianship: GuardianshipPort;
  readonly gateway: StateGateway;
}
