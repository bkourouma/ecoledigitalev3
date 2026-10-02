/**
 * Ports du module documents. Élèves, personnel, utilisateurs sont des UUID SANS clé étrangère : leur existence et leurs liens
 * (tutelle, fiche liée à un compte) sont vérifiés par ces ports, fournis à l'assemblage par `apps/api/src/platform/adapters`
 * (people, iam, entitlements, stockage d'objets). Tant qu'un port n'est pas branché, le module ÉCHOUE FERMÉ
 * (`documents.port_unavailable`).
 *
 * Un port appartient à un AUTRE module (ou à l'infrastructure) : aucune fonction de port ne prend de `Tx`. Les appels sont
 * SÉQUENTIELS (ils partagent la connexion de la transaction : jamais de `Promise.all`).
 */
import type { RequestContext } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import type { ActorLinks, DocumentOwnerType, Uuid } from "../domain/types";

// ---------------------------------------------------------------------------
// Stockage d'objets
// ---------------------------------------------------------------------------

export interface StoredObject {
  readonly bytes: Uint8Array;
  readonly contentType: string | null;
}

export interface StoragePort {
  put(key: string, bytes: Uint8Array, options: { contentType: string }): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
  /** URL de lecture à durée COURTE (≤ 5 min, plafonnée par l'adaptateur), en téléchargement (`attachment`). */
  signedUrl(key: string, options: { ttlSeconds: number; fileName: string; contentType: string }): Promise<{ url: string; expiresAt: Date }>;
}

// ---------------------------------------------------------------------------
// Antivirus
// ---------------------------------------------------------------------------

export type ScanVerdict =
  | { readonly status: "CLEAN" }
  | { readonly status: "INFECTED"; readonly signature: string }
  | { readonly status: "ERROR"; readonly reason: string };

/** Port `MalwareScanner` : analyse un fichier AVANT son stockage. Ne lève jamais : toute panne est un verdict `ERROR`. */
export interface MalwareScanner {
  readonly engine: string;
  scan(bytes: Uint8Array, hints: { fileName: string; mime: string }): Promise<ScanVerdict>;
}

/**
 * Politique d'analyse de la plateforme. `scanner: null` = aucun antivirus configuré : les fichiers sont stockés `UNSCANNED`.
 * `failClosed` : un verdict `ERROR` refuse le dépôt (`documents.scan_unavailable`) au lieu de stocker `UNSCANNED`.
 */
export interface ScanPolicy {
  readonly scanner: MalwareScanner | null;
  readonly failClosed: boolean;
}

export const NO_SCANNER: ScanPolicy = Object.freeze({ scanner: null, failClosed: false });

// ---------------------------------------------------------------------------
// Annuaire des propriétaires et des personnes (people, iam)
// ---------------------------------------------------------------------------

export interface PersonRef {
  readonly id: Uuid;
  readonly displayName: string;
  readonly detail: string | null;
}

export interface OwnerDirectory {
  /** Fiches liées au COMPTE de l'appelant : élève, enfants dont il est tuteur, membre du personnel. Relu à chaque appel. */
  resolveActorLinks(ctx: RequestContext): Promise<ActorLinks>;
  /** Identifiants qui existent dans le tenant (un identifiant inconnu ou d'un autre tenant est ABSENT du résultat). */
  existingOwners(ctx: RequestContext, type: Exclude<DocumentOwnerType, "NONE">, ids: readonly Uuid[]): Promise<ReadonlySet<Uuid>>;
  /** Noms d'affichage des propriétaires ; les inconnus sont absents. */
  ownerNames(ctx: RequestContext, type: Exclude<DocumentOwnerType, "NONE">, ids: readonly Uuid[]): Promise<ReadonlyMap<Uuid, string>>;
  /** Recherche de propriétaires par nom (sélecteur de dépôt). */
  searchOwners(ctx: RequestContext, type: Exclude<DocumentOwnerType, "NONE">, query: string, limit: number): Promise<readonly PersonRef[]>;
  /** Comptes (identités) du tenant : noms d'affichage ; les inconnus (ou d'un autre tenant) sont absents. */
  userNames(ctx: RequestContext, userIds: readonly Uuid[]): Promise<ReadonlyMap<Uuid, string>>;
  /** Recherche de comptes par nom (sélecteur de partage). */
  searchUsers(ctx: RequestContext, query: string, limit: number): Promise<readonly PersonRef[]>;
  /** Comptes des tuteurs d'un élève (partage rapide). Vide si l'élève est inconnu. */
  guardianUsers(ctx: RequestContext, studentId: Uuid): Promise<readonly PersonRef[]>;
}

// ---------------------------------------------------------------------------
// Conversion Office -> PDF (prévisualisation), désactivée par défaut
// ---------------------------------------------------------------------------

export interface DocumentConverter {
  readonly enabled: boolean;
  /** PDF dérivé ; `null` si la conversion échoue (la prévisualisation répond alors « indisponible »). */
  toPdf(bytes: Uint8Array, hints: { extension: string; mime: string }): Promise<Uint8Array | null>;
}

export const NO_CONVERTER: DocumentConverter = Object.freeze({ enabled: false, async toPdf() { return null; } });

// ---------------------------------------------------------------------------
// Usage de stockage et quotas
// ---------------------------------------------------------------------------

export interface UsageReporter {
  /** Jauge `STORAGE_BYTES` (entitlements). Échec toléré : jamais bloquant pour l'opération documentaire. */
  reportStorageBytes(ctx: RequestContext, usedBytes: number): Promise<void>;
}

export const NO_USAGE_REPORTER: UsageReporter = Object.freeze({ async reportStorageBytes() {} });

/** Quota du PLAN du tenant, en octets (palier selon les features `documents.storage.*`). */
export type PlanQuotaResolver = (ctx: RequestContext) => Promise<number>;

// ---------------------------------------------------------------------------
// Audit (même transaction que l'opération sensible)
// ---------------------------------------------------------------------------

export interface AuditEntry {
  /** `documents.<entité>.<action>`. */
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  /** Opération sensible (lecture d'un document CONFIDENTIAL, libération de quarantaine, purge…). */
  readonly sensitive?: boolean;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly reason?: string | null;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface AuditPort {
  record(tx: Tx, ctx: RequestContext, entry: AuditEntry): Promise<void>;
}

export const noopAudit: AuditPort = Object.freeze({
  async record(): Promise<void> {
    /* le module audit est branché par l'adaptateur de http/plugin.ts */
  },
});

/** Collecteur en mémoire, pour les tests. */
export class RecordingAudit implements AuditPort {
  readonly entries: Array<{ ctx: RequestContext; entry: AuditEntry }> = [];
  async record(_tx: Tx, ctx: RequestContext, entry: AuditEntry): Promise<void> {
    this.entries.push({ ctx, entry });
  }
  actions(): string[] {
    return this.entries.map((e) => e.entry.action);
  }
}

/** Ports que la plateforme branche (stockage et annuaire obligatoires ; le reste a des valeurs par défaut sûres). */
export interface DocumentsPorts {
  readonly storage: StoragePort;
  readonly owners: OwnerDirectory;
  readonly scan: ScanPolicy;
  readonly converter: DocumentConverter;
  readonly usage: UsageReporter;
  readonly planQuota: PlanQuotaResolver;
}
