/**
 * Types du domaine reportcards. Les formes du snapshot viennent du contrat (`packages/contracts/src/v2/reportcards.ts`),
 * source unique de la forme JSON haché et signé.
 */
import type {
  ReportcardExplain,
  ReportcardSnapshot,
  ReportcardSnapshotLine,
} from "@ecoledigitale/contracts/src/v2/reportcards";

export type Uuid = string;
export type IsoDate = string;
export type IsoInstant = string;

export type { ReportcardExplain, ReportcardSnapshot, ReportcardSnapshotLine };

export type DocumentKind = "REPORT_CARD" | "TRANSCRIPT";
export type TemplateDocumentKind = DocumentKind | "DIPLOMA" | "ATTESTATION_SUCCESS" | "ATTESTATION_AUTHENTICITY" | "PAYSLIP" | "RECEIPT";
export type Scope = "PERIOD" | "YEAR" | "CUMULATIVE";
export type CardStatus = "ISSUED" | "PUBLISHED" | "SUPERSEDED" | "REVOKED";
export type RenderStatus = "PENDING" | "RENDERING" | "RENDERED" | "FAILED";
export type Pack = "PRIMARY" | "SECONDARY" | "HIGHER" | "VIRTUAL" | "CORE";
export type BatchStatus = "PENDING" | "SNAPSHOTTING" | "RENDERING" | "COMPLETED" | "COMPLETED_WITH_ERRORS" | "FAILED" | "CANCELLED";

export interface SignatureSlot {
  readonly slot: string;
  readonly label: string;
  readonly required: boolean;
}

export interface SignatureAssignment {
  readonly slot: string;
  readonly signatoryId: Uuid;
}

export interface Branding {
  readonly id: Uuid;
  readonly institutionId: Uuid | null;
  readonly version: number;
  readonly isCurrent: boolean;
  readonly legalName: string;
  readonly shortName: string | null;
  readonly headerLeft: readonly string[];
  readonly headerRight: readonly string[];
  readonly address: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly website: string | null;
  readonly registrationRef: string | null;
  readonly logoObjectKey: string | null;
  readonly emblemObjectKey: string | null;
  readonly primaryColor: string | null;
  readonly secondaryColor: string | null;
  readonly footerText: string | null;
  readonly createdAt: Date;
}

export interface Signatory {
  readonly id: Uuid;
  readonly institutionId: Uuid | null;
  readonly fullName: string;
  readonly title: string | null;
  readonly jobFunction: string | null;
  readonly signatureObjectKey: string | null;
  readonly staffId: Uuid | null;
  readonly active: boolean;
  readonly validFrom: IsoDate | null;
  readonly validTo: IsoDate | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface PlatformTemplate {
  readonly key: string;
  readonly version: number;
  readonly documentKind: TemplateDocumentKind;
  readonly pack: Pack;
  readonly snapshotSchema: string;
  readonly title: string;
  readonly body: string;
  readonly css: string;
  readonly optionsSchema: Record<string, unknown>;
  readonly signatureSlots: readonly SignatureSlot[];
  readonly status: "DRAFT" | "PUBLISHED" | "RETIRED";
  readonly contentHash: string | null;
  readonly publishedAt: Date | null;
}

export interface TemplateConfig {
  readonly id: Uuid;
  readonly institutionId: Uuid | null;
  readonly documentKind: DocumentKind;
  readonly pack: Pack;
  readonly templateKey: string;
  readonly templateVersion: number;
  readonly configVersion: number;
  readonly isCurrent: boolean;
  readonly options: Record<string, unknown>;
  readonly signatureAssignments: readonly SignatureAssignment[];
  readonly createdAt: Date;
}

export interface ReportcardsSettings {
  readonly blockIfUnpaid: boolean;
  readonly requireDeliberation: boolean;
  readonly verificationShowsMention: boolean;
  readonly updatedAt: Date | null;
}

export const DEFAULT_SETTINGS: ReportcardsSettings = Object.freeze({
  blockIfUnpaid: false,
  requireDeliberation: false,
  verificationShowsMention: false,
  updatedAt: null,
});

/** Ligne de la table `report_cards` SANS le contenu (snapshot / trace). */
export interface ReportCardRecord {
  readonly id: Uuid;
  readonly documentKind: DocumentKind;
  readonly enrollmentId: Uuid | null;
  readonly studentId: Uuid;
  readonly classroomId: Uuid | null;
  readonly academicYearId: Uuid | null;
  readonly academicPeriodId: Uuid | null;
  readonly scope: Scope;
  readonly version: number;
  readonly status: CardStatus;
  readonly provisional: boolean;
  readonly snapshotSchema: string;
  readonly snapshotHash: string;
  readonly ruleSetCode: string;
  readonly ruleVersionId: Uuid;
  readonly resultsStateId: Uuid;
  readonly resultsVersion: number;
  readonly closureHash: string;
  readonly templateKey: string;
  readonly templateVersion: number;
  readonly configVersion: number;
  readonly verificationCode: string;
  readonly signingKeyId: string;
  readonly signature: string;
  readonly issuedAt: Date;
  readonly issuedBy: Uuid | null;
  readonly issuedByName: string;
  readonly supersedesId: Uuid | null;
  readonly supersedeReason: string | null;
  readonly supersededAt: Date | null;
  readonly supersededById: Uuid | null;
  readonly revokedAt: Date | null;
  readonly revokedBy: Uuid | null;
  readonly revokeReason: string | null;
  readonly publishedAt: Date | null;
  readonly publishedBy: Uuid | null;
  readonly withdrawnAt: Date | null;
  readonly renderStatus: RenderStatus;
  readonly currentRenderId: Uuid | null;
  readonly batchId: Uuid | null;
  /** Titre et nom de l'élève, extraits du snapshot pour les listes (jamais de notes). */
  readonly title: string;
  readonly studentName: string;
}

export interface RenderRecord {
  readonly id: Uuid;
  readonly reportCardId: Uuid;
  readonly status: RenderStatus;
  readonly objectKey: string | null;
  readonly pdfHash: string | null;
  readonly sizeBytes: number | null;
  readonly pages: number | null;
  readonly rendererVersion: string | null;
  readonly durationMs: number | null;
  readonly attempts: number;
  readonly error: string | null;
  readonly requestedAt: Date;
  readonly finishedAt: Date | null;
}

export interface BatchRecord {
  readonly id: Uuid;
  readonly documentKind: DocumentKind;
  readonly classroomId: Uuid;
  readonly academicPeriodId: Uuid | null;
  readonly resultsStateId: Uuid;
  readonly resultsVersion: number;
  readonly idempotencyKey: string;
  readonly provisional: boolean;
  readonly status: BatchStatus;
  readonly total: number;
  readonly issued: number;
  readonly excluded: number;
  readonly failed: number;
  readonly rendered: number;
  readonly combinedPdfKey: string | null;
  readonly requestedBy: Uuid | null;
  readonly requestedAt: Date;
  readonly finishedAt: Date | null;
}

export interface BatchItemRecord {
  readonly id: Uuid;
  readonly batchId: Uuid;
  readonly enrollmentId: Uuid;
  readonly reportCardId: Uuid | null;
  readonly outcome: "ISSUED" | "EXCLUDED" | "FAILED";
  readonly reasonCode: string | null;
  readonly message: string | null;
}

// ---------------------------------------------------------------------------
// Entrées fournies par le module results (via ResultsReadPort)
// ---------------------------------------------------------------------------

export type PeriodStatus = "OPEN" | "LOCKED" | "DELIBERATED" | "CLOSED";

/** État d'une période pour une classe, tel que le module results le publie. */
export interface PeriodState {
  readonly classroomId: Uuid;
  readonly academicPeriodId: Uuid;
  /** Pack et établissement de la classe : choisissent la configuration de gabarit et l'identité. */
  readonly pack: Pack;
  readonly institutionId: Uuid | null;
  readonly stateId: Uuid;
  readonly status: PeriodStatus;
  readonly resultsVersion: number;
  readonly closureHash: string;
  /** Une délibération (conseil / jury) a eu lieu (HELD). */
  readonly deliberationHeld: boolean;
  readonly deliberationDate: IsoDate | null;
}

export type RosterOutcome = "FINAL" | "ERROR" | "MISSING";

export interface RosterEntry {
  readonly enrollmentId: Uuid;
  readonly studentId: Uuid;
  /** `FINAL` : résultat FINAL disponible ; `ERROR` : erreur de calcul ; `MISSING` : aucun résultat (inscrit tardif…). */
  readonly outcome: RosterOutcome;
  readonly reason?: string | null;
}

/** Résultats FINAL d'une inscription (ou cumulés pour un relevé), prêts à figer. */
export interface FinalResultBundle {
  readonly student: ReportcardSnapshot["student"];
  readonly enrollment: ReportcardSnapshot["enrollment"];
  readonly lines: readonly ReportcardSnapshotLine[];
  readonly summary: ReportcardSnapshot["results"]["summary"];
  readonly annual: ReportcardSnapshot["results"]["annual"];
  readonly deliberation: ReportcardSnapshot["deliberation"];
  readonly generalAppreciation: string | null;
  readonly attendance: ReportcardSnapshot["attendance"];
  readonly rules: ReportcardSnapshot["rules"];
  /** Table code -> libellé extraite du `label_map` de la version de règle. */
  readonly labels: Readonly<Record<string, string>>;
  readonly explain: ReportcardExplain;
}
