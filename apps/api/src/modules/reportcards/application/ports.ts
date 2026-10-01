/**
 * Ports du module reportcards. Les références vers élèves, inscriptions, classes et périodes sont des UUID SANS clé
 * étrangère ; leur contenu vient des modules voisins par ces ports (inversion de dépendance). Tant qu'un port n'est pas
 * branché, le module ÉCHOUE FERMÉ (`reportcards.port_unavailable`) : jamais de bulletin sans la source de vérité des résultats.
 *
 *  - `ResultsReadPort`        module `results` (spec 011) : états de période, résultats FINAL, délibération, trace ;
 *  - `GuardianshipPort`       module `people` (spec 008) : qui est l'élève / le tuteur lié, vérifié à CHAQUE lecture ;
 *  - `AttendanceSummaryPort`  module `attendance` (010) : absences par période, copiées dans le snapshot à l'émission ;
 *  - `LearnerStandingPort`    module `finance` (014) : impayé ou non, SANS détail (option « bloquer si impayé », Q-13) ;
 *  - `StoragePort`            défini ICI (adaptateurs S3/MinIO et mémoire, `infrastructure/storage-*.ts`) ;
 *  - `PdfRenderer`            Puppeteer dans le worker (`infrastructure/puppeteer-renderer.ts`) ;
 *  - `KeyProvider`            clé privée Ed25519 de l'environnement / du gestionnaire de secrets.
 *
 * Aucune fonction de port ne prend de `Tx` : un port appartient à un AUTRE module, qui ouvre sa propre lecture.
 */
import type { RequestContext } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import type { SigningInput } from "../domain/signing";
import type { FinalResultBundle, PeriodState, RosterEntry, Uuid } from "../domain/types";

// ---------------------------------------------------------------------------
// results
// ---------------------------------------------------------------------------

export interface ResultsReadPort {
  /** État de la période pour la classe (clôture, version des résultats, délibération). `null` si inconnu. */
  getPeriodState(ctx: RequestContext, query: { classroomId: Uuid; academicPeriodId: Uuid }): Promise<PeriodState | null>;
  /** Inscriptions de la classe pour la période avec l'état de leur résultat (FINAL / ERROR / MISSING). */
  listRoster(ctx: RequestContext, query: { classroomId: Uuid; academicPeriodId: Uuid }): Promise<readonly RosterEntry[]>;
  /** Résultats FINAL d'une inscription (valeurs, libellés, provenance des règles, trace), ou `null` s'il n'y en a pas. */
  getFinalBundle(ctx: RequestContext, query: { enrollmentId: Uuid; academicPeriodId: Uuid }): Promise<FinalResultBundle | null>;
  /** Résultats FINAL cumulés d'un élève sur plusieurs périodes / années (relevé), ou `null`. */
  getCumulativeBundle(ctx: RequestContext, query: { studentId: Uuid; academicYearIds?: readonly Uuid[] }): Promise<FinalResultBundle | null>;
}

// ---------------------------------------------------------------------------
// people / attendance / finance
// ---------------------------------------------------------------------------

export interface GuardianshipPort {
  /** Fiche élève de l'utilisateur connecté (portail élève), ou `null`. */
  studentIdOfUser(ctx: RequestContext, userId: Uuid): Promise<Uuid | null>;
  /** L'utilisateur est-il tuteur LIÉ (non révoqué) de cet élève ? Revérifié à chaque lecture (AC6.3). */
  isGuardianOf(ctx: RequestContext, userId: Uuid, studentId: Uuid): Promise<boolean>;
  /** Élèves dont l'utilisateur est tuteur lié. */
  listChildren(ctx: RequestContext, userId: Uuid): Promise<readonly Uuid[]>;
}

export interface UserDirectoryPort {
  /** Nom affichable d'un utilisateur (figé dans le snapshot comme « émis par », « révoqué par »). */
  displayName(ctx: RequestContext, userId: Uuid): Promise<string | null>;
}

export interface AttendanceSummary {
  readonly justifiedMinutes: number;
  readonly unjustifiedMinutes: number;
  readonly lateCount: number;
}

export interface AttendanceSummaryPort {
  getSummary(ctx: RequestContext, query: { enrollmentId: Uuid; academicPeriodId: Uuid }): Promise<AttendanceSummary | null>;
}

export interface LearnerStandingPort {
  /** `true` si l'élève a un impayé exigible. Aucun montant, aucun détail. */
  hasOutstandingBalance(ctx: RequestContext, studentId: Uuid): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Stockage d'objets
// ---------------------------------------------------------------------------

export interface StorageObject {
  readonly bytes: Uint8Array;
  readonly contentType: string | null;
}

export interface StoragePort {
  /** Écrit un objet (chiffré au repos par l'adaptateur). Retourne l'empreinte SHA-256 (hex) et la taille. */
  put(key: string, bytes: Uint8Array, options: { contentType: string }): Promise<{ sha256: string; size: number }>;
  get(key: string): Promise<StorageObject | null>;
  exists(key: string): Promise<boolean>;
  /** URL de lecture à durée COURTE (≤ 5 min côté appelant). */
  signedUrl(key: string, options: { ttlSeconds: number; fileName?: string; contentType?: string }): Promise<{ url: string; expiresAt: Date }>;
  /** URL de DÉPÔT (PUT) à durée courte pour un logo / une signature ; absente = dépôt par URL signée indisponible. */
  signedUploadUrl?(key: string, options: { ttlSeconds: number; contentType: string; maxBytes: number }): Promise<{ url: string; expiresAt: Date; headers: Record<string, string> }>;
}

// ---------------------------------------------------------------------------
// Rendu PDF
// ---------------------------------------------------------------------------

export interface PdfRenderInput {
  readonly html: string;
  readonly title: string;
  /** Date de création inscrite dans le PDF = date d'émission du document (reproductibilité). */
  readonly issuedAt: Date;
}

export interface PdfRenderResult {
  readonly pdf: Uint8Array;
  readonly pages: number;
  readonly rendererVersion: string;
}

export interface PdfRenderer {
  render(input: PdfRenderInput): Promise<PdfRenderResult>;
  close?(): Promise<void>;
}

/** Fusion de PDF (PDF combiné d'une classe). */
export interface PdfMerger {
  merge(pdfs: readonly Uint8Array[]): Promise<{ pdf: Uint8Array; pages: number }>;
}

// ---------------------------------------------------------------------------
// Signature
// ---------------------------------------------------------------------------

export interface KeyProvider {
  /** Identifiant de la clé active (publié avec la clé publique). */
  readonly keyId: string;
  /** Clé publique SPKI DER en base64. */
  readonly publicKey: string;
  /** Signe le message canonique du document. Ne journalise jamais la clé. */
  sign(input: SigningInput): string;
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export interface AuditEntry {
  /** `entité.verbe`, ex. `reportcards.report_card.published`. */
  action: string;
  resourceType: string;
  resourceId: string;
  sensitive?: boolean;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}

export interface AuditPort {
  record(tx: Tx, ctx: RequestContext, entry: AuditEntry): Promise<void>;
  /** Journal de PLATEFORME (opérations sans tenant : gabarits globaux, clés de signature). */
  recordPlatform?(tx: Tx, entry: AuditEntry & { actorId: string }): Promise<void>;
}

export const noopAudit: AuditPort = Object.freeze({
  async record() {
    /* aucun audit branché (tests unitaires) */
  },
});

/** Audit d'enregistrement pour les tests. */
export class RecordingAudit implements AuditPort {
  readonly entries: Array<{ ctx: RequestContext; entry: AuditEntry }> = [];
  async record(_tx: Tx, ctx: RequestContext, entry: AuditEntry): Promise<void> {
    this.entries.push({ ctx, entry });
  }
  get actions(): string[] {
    return this.entries.map((e) => e.entry.action);
  }
}

export interface ReportcardsPorts {
  readonly results: ResultsReadPort;
  readonly guardianship: GuardianshipPort;
  readonly attendance: AttendanceSummaryPort | null;
  readonly standing: LearnerStandingPort | null;
  readonly directory: UserDirectoryPort | null;
  readonly storage: StoragePort;
  readonly renderer: PdfRenderer | null;
  readonly merger: PdfMerger | null;
}
