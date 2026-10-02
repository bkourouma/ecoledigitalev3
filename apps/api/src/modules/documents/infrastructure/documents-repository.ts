/**
 * SQL des documents et de leurs versions. Les LISTES filtrent en SQL avec les MÊMES règles de visibilité que
 * `domain/policy.ts` (`visibilityPredicate` ↔ `resolveAccess`) ; un test d'intégration compare les deux.
 *
 * Dates : `date` renvoyées en texte `YYYY-MM-DD` (jamais de conversion locale du pilote) ; `bigint` en texte puis `Number`.
 */
import type { Tx } from "@ecoledigitale/database";
import { readableConfidentialities } from "../domain/policy";
import type { Actor, DocumentConfidentiality, DocumentKind, DocumentOwnerType, DocumentShareLevel, DocumentStatus, DocumentVisibility, Uuid } from "../domain/types";

export interface DocumentRow {
  id: Uuid;
  kind: DocumentKind;
  categoryId: Uuid;
  categoryCode: string;
  categoryLabel: string;
  confidentiality: DocumentConfidentiality;
  audienceOwner: boolean;
  audienceGuardians: boolean;
  ownerUpload: boolean;
  categoryStatus: "ACTIVE" | "ARCHIVED";
  categoryAlertDays: number[] | null;
  categoryRequiresExpiry: boolean;
  categoryRetentionDays: number | null;
  title: string;
  description: string | null;
  tags: string[];
  metadata: Record<string, string | number | boolean>;
  ownerType: DocumentOwnerType;
  ownerId: Uuid | null;
  visibility: DocumentVisibility;
  status: DocumentStatus;
  currentVersionNo: number;
  versionCount: number;
  fileName: string;
  extension: string;
  mime: string;
  sizeBytes: number;
  expiresOn: string | null;
  alertDays: number[] | null;
  alertsSent: number[];
  expiredNotifiedAt: Date | null;
  archivedAt: Date | null;
  archiveReason: string | null;
  purgeAfter: Date | null;
  purgedAt: Date | null;
  createdBy: Uuid;
  createdAt: Date;
  updatedBy: Uuid;
  updatedAt: Date;
  shareLevel: DocumentShareLevel | null;
  grantLevel: DocumentShareLevel | null;
}

type RawDocument = Omit<DocumentRow, "sizeBytes"> & { sizeBytes: string };

/** Paramètres positionnels : `$1` tenant, `$2` utilisateur, `$3` instant — toujours présents. */
const SELECT_DOC = `
  d.id, d.kind, d.category_id AS "categoryId", c.code AS "categoryCode", c.label AS "categoryLabel", c.confidentiality,
  c.audience_owner AS "audienceOwner", c.audience_guardians AS "audienceGuardians", c.owner_upload AS "ownerUpload",
  c.status AS "categoryStatus", c.alert_days AS "categoryAlertDays", c.requires_expiry AS "categoryRequiresExpiry", c.retention_days AS "categoryRetentionDays",
  d.title, d.description, d.tags, d.metadata, d.owner_type AS "ownerType", d.owner_id AS "ownerId", d.visibility, d.status,
  d.current_version_no AS "currentVersionNo", d.version_count AS "versionCount", d.current_file_name AS "fileName", d.current_extension AS "extension",
  d.current_mime AS "mime", d.current_size_bytes::text AS "sizeBytes", to_char(d.expires_on, 'YYYY-MM-DD') AS "expiresOn", d.alert_days AS "alertDays",
  d.alerts_sent AS "alertsSent", d.expired_notified_at AS "expiredNotifiedAt", d.archived_at AS "archivedAt", d.archive_reason AS "archiveReason",
  d.purge_after AS "purgeAfter", d.purged_at AS "purgedAt", d.created_by AS "createdBy", d.created_at AS "createdAt", d.updated_by AS "updatedBy", d.updated_at AS "updatedAt",
  (SELECT max(s.level) FROM documents.shares s WHERE s.tenant_id = d.tenant_id AND s.document_id = d.id AND s.user_id = $2
      AND s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at > $3)) AS "shareLevel",
  (SELECT max(g.level) FROM documents.category_grants g WHERE g.tenant_id = d.tenant_id AND g.category_id = d.category_id AND g.user_id = $2
      AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > $3)) AS "grantLevel"`;

const FROM_DOC = `FROM documents.documents d JOIN documents.categories c ON c.tenant_id = d.tenant_id AND c.id = d.category_id`;

const toDocument = (r: RawDocument): DocumentRow => ({ ...r, sizeBytes: Number(r.sizeBytes) });

/** Un document (RLS) avec les partages / droits de l'appelant déjà résolus. `null` : inconnu ou autre tenant. */
export async function getDocument(tx: Tx, tenantId: Uuid, id: Uuid, userId: Uuid, now: Date, options: { forUpdate?: boolean } = {}): Promise<DocumentRow | null> {
  const row = await tx.queryOne<RawDocument>(
    `SELECT ${SELECT_DOC} ${FROM_DOC} WHERE d.tenant_id = $1 AND d.id = $4${options.forUpdate ? " FOR UPDATE OF d" : ""}`,
    [tenantId, userId, now, id],
  );
  return row ? toDocument(row) : null;
}

// ---------------------------------------------------------------------------
// Visibilité (miroir SQL de domain/policy.ts)
// ---------------------------------------------------------------------------

export class SqlParams {
  readonly values: unknown[] = [];
  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

/**
 * Condition SQL « l'appelant VOIT ce document » (alias `d` documents, `c` catégories) ; mêmes règles R1..R7 que `resolveAccess`.
 * La gestion voit tout (y compris archivé) ; sinon, un document archivé n'est jamais visible.
 */
export function visibilityPredicate(actor: Actor, now: Date, p: SqlParams): string {
  if (actor.caps.manage === true) return "TRUE";
  const user = p.add(actor.userId);
  const nowP = p.add(now);
  const tiers = p.add(readableConfidentialities(actor.caps));
  const studentId = p.add(actor.links.studentId);
  const staffId = p.add(actor.links.staffId);
  const children = p.add([...actor.links.childStudentIds]);
  const upload = actor.caps.upload === true ? "TRUE" : "FALSE";
  const selfRead = actor.caps.selfRead === true ? "TRUE" : "FALSE";
  const ownRead = actor.caps.ownRead === true ? "TRUE" : "FALSE";
  const childRead = actor.caps.childRead === true ? "TRUE" : "FALSE";
  const linkExists = `((d.owner_type = 'STUDENT' AND (d.owner_id = ${studentId}::uuid OR d.owner_id = ANY(${children}::uuid[]))) OR (d.owner_type = 'STAFF' AND d.owner_id = ${staffId}::uuid))`;
  return `(d.status = 'ACTIVE' AND (
    (d.created_by = ${user}::uuid AND (${upload} OR ${linkExists}))
    OR EXISTS (SELECT 1 FROM documents.shares s WHERE s.tenant_id = d.tenant_id AND s.document_id = d.id AND s.user_id = ${user}::uuid
               AND s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at > ${nowP}::timestamptz))
    OR EXISTS (SELECT 1 FROM documents.category_grants g WHERE g.tenant_id = d.tenant_id AND g.category_id = d.category_id AND g.user_id = ${user}::uuid
               AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > ${nowP}::timestamptz))
    OR (d.visibility <> 'PRIVATE' AND c.confidentiality = ANY(${tiers}::text[]))
    OR (d.visibility = 'INHERIT' AND c.audience_owner AND (
          (${selfRead} AND d.owner_type = 'STUDENT' AND d.owner_id = ${studentId}::uuid)
       OR (${ownRead} AND d.owner_type = 'STAFF' AND d.owner_id = ${staffId}::uuid)))
    OR (d.visibility = 'INHERIT' AND c.audience_guardians AND ${childRead} AND d.owner_type = 'STUDENT' AND d.owner_id = ANY(${children}::uuid[]))
  ))`;
}

// ---------------------------------------------------------------------------
// Liste paginée
// ---------------------------------------------------------------------------

export type SortKey = "updatedAt" | "createdAt" | "title" | "expiresOn";

const SORTS: Readonly<Record<SortKey, { expr: string; cast: string }>> = {
  updatedAt: { expr: "d.updated_at", cast: "timestamptz" },
  createdAt: { expr: "d.created_at", cast: "timestamptz" },
  // Tri par titre DÉTERMINISTE : clé normalisée (minuscules, sans accents : « cni élève » avant « cni enfant ») comparée en
  // collation « C » (octets). Sans cela, l'ordre dépendait de la locale de l'image Postgres (en_US.utf8, C.UTF-8, ICU...).
  title: { expr: 'documents.normalize_search(d.title) COLLATE "C"', cast: "text" },
  expiresOn: { expr: "COALESCE(d.expires_on, 'infinity'::date)", cast: "date" },
};

export interface ListFilters {
  q?: string | undefined;
  /** Identifiants de propriétaires dont le NOM correspond à `q` (résolus par le port). */
  ownerIdsMatchingQuery?: readonly Uuid[] | undefined;
  categoryId?: Uuid | undefined;
  kind?: DocumentKind | undefined;
  ownerType?: DocumentOwnerType | undefined;
  ownerId?: Uuid | undefined;
  status: "ACTIVE" | "ARCHIVED" | "ALL";
  expiry?: "any" | "expiring" | "expired" | "dated" | "missing" | undefined;
  withinDays: number;
  today: string;
  scope?: "all" | "mine" | "shared" | "child" | "self" | "own" | undefined;
  sort: SortKey;
  dir: "asc" | "desc";
  cursor?: { value: string; id: Uuid } | undefined;
  limit: number;
}

const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (m) => `\\${m}`);

export interface ListedDocument extends DocumentRow {
  sortValue: string;
}

export async function listDocuments(tx: Tx, tenantId: Uuid, actor: Actor, now: Date, f: ListFilters): Promise<ListedDocument[]> {
  const p = new SqlParams();
  p.add(tenantId); // $1
  p.add(actor.userId); // $2
  p.add(now); // $3
  const where: string[] = ["d.tenant_id = $1", visibilityPredicate(actor, now, p)];
  if (f.status !== "ALL") where.push(`d.status = ${p.add(f.status)}`);
  if (f.categoryId) where.push(`d.category_id = ${p.add(f.categoryId)}::uuid`);
  if (f.kind) where.push(`d.kind = ${p.add(f.kind)}`);
  if (f.ownerType) where.push(`d.owner_type = ${p.add(f.ownerType)}`);
  if (f.ownerId) where.push(`d.owner_id = ${p.add(f.ownerId)}::uuid`);
  if (f.q) {
    const like = p.add(`%${escapeLike(f.q)}%`);
    const parts = [`d.search_key LIKE documents.normalize_search(${like}) ESCAPE '\\'`, `documents.normalize_search(c.label) LIKE documents.normalize_search(${like}) ESCAPE '\\'`];
    if (f.ownerIdsMatchingQuery && f.ownerIdsMatchingQuery.length > 0) parts.push(`d.owner_id = ANY(${p.add([...f.ownerIdsMatchingQuery])}::uuid[])`);
    where.push(`(${parts.join(" OR ")})`);
  }
  switch (f.expiry) {
    case "expiring": {
      const today = p.add(f.today);
      where.push(`d.expires_on IS NOT NULL AND d.expires_on >= ${today}::date AND d.expires_on <= (${today}::date + ${p.add(f.withinDays)}::int)`);
      break;
    }
    case "expired":
      where.push(`d.expires_on IS NOT NULL AND d.expires_on < ${p.add(f.today)}::date`);
      break;
    case "dated":
      where.push("d.expires_on IS NOT NULL");
      break;
    case "missing":
      where.push("c.requires_expiry AND d.expires_on IS NULL");
      break;
    default:
      break;
  }
  const user = "$2";
  switch (f.scope) {
    case "mine":
      where.push(`d.created_by = ${user}::uuid`);
      break;
    case "shared":
      where.push(`EXISTS (SELECT 1 FROM documents.shares s WHERE s.tenant_id = d.tenant_id AND s.document_id = d.id AND s.user_id = ${user}::uuid AND s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at > $3::timestamptz))`);
      break;
    case "child":
      where.push(`d.owner_type = 'STUDENT' AND d.owner_id = ANY(${p.add([...actor.links.childStudentIds])}::uuid[])`);
      break;
    case "self":
      where.push(`d.owner_type = 'STUDENT' AND d.owner_id = ${p.add(actor.links.studentId)}::uuid`);
      break;
    case "own":
      where.push(`d.owner_type = 'STAFF' AND d.owner_id = ${p.add(actor.links.staffId)}::uuid`);
      break;
    default:
      break;
  }
  const sort = SORTS[f.sort];
  const cmp = f.dir === "asc" ? ">" : "<";
  if (f.cursor) where.push(`(${sort.expr}, d.id) ${cmp} (${p.add(f.cursor.value)}::${sort.cast}, ${p.add(f.cursor.id)}::uuid)`);
  const limit = p.add(f.limit + 1);
  const rows = await tx.many<RawDocument & { sortValue: string }>(
    `SELECT ${SELECT_DOC}, (${sort.expr})::text AS "sortValue" ${FROM_DOC}
      WHERE ${where.join(" AND ")}
      ORDER BY ${sort.expr} ${f.dir.toUpperCase()}, d.id ${f.dir.toUpperCase()}
      LIMIT ${limit}`,
    p.values,
  );
  return rows.map((r) => ({ ...toDocument(r), sortValue: r.sortValue }));
}

/** Compteurs du tableau de bord des expirations (sur les documents VISIBLES et actifs). */
export async function countExpirations(tx: Tx, tenantId: Uuid, actor: Actor, now: Date, today: string, withinDays: number): Promise<{ expiring: number; expired: number; missingExpiry: number; total: number }> {
  const p = new SqlParams();
  p.add(tenantId);
  const visible = visibilityPredicate(actor, now, p);
  const t = p.add(today);
  const w = p.add(withinDays);
  const r = await tx.queryOne<{ expiring: string; expired: string; missing: string; total: string }>(
    `SELECT count(*) FILTER (WHERE d.expires_on IS NOT NULL AND d.expires_on >= ${t}::date AND d.expires_on <= (${t}::date + ${w}::int))::text AS expiring,
            count(*) FILTER (WHERE d.expires_on IS NOT NULL AND d.expires_on < ${t}::date)::text AS expired,
            count(*) FILTER (WHERE c.requires_expiry AND d.expires_on IS NULL)::text AS missing,
            count(*)::text AS total
       ${FROM_DOC}
      WHERE d.tenant_id = $1 AND d.status = 'ACTIVE' AND ${visible}`,
    p.values,
  );
  return { expiring: Number(r?.expiring ?? 0), expired: Number(r?.expired ?? 0), missingExpiry: Number(r?.missing ?? 0), total: Number(r?.total ?? 0) };
}

/** Un document ACTIF visible de l'appelant ayant le même contenu, la même catégorie et le même propriétaire (dédoublonnage). */
export async function findVisibleDuplicate(tx: Tx, tenantId: Uuid, actor: Actor, now: Date, input: { sha256: string; categoryId: Uuid; ownerType: DocumentOwnerType; ownerId: Uuid | null; excludeDocumentId?: Uuid }): Promise<Uuid | null> {
  const p = new SqlParams();
  p.add(tenantId);
  const visible = visibilityPredicate(actor, now, p);
  const sha = p.add(input.sha256);
  const cat = p.add(input.categoryId);
  const ownerType = p.add(input.ownerType);
  const ownerId = p.add(input.ownerId);
  const exclude = input.excludeDocumentId ? `AND d.id <> ${p.add(input.excludeDocumentId)}::uuid` : "";
  const r = await tx.queryOne<{ id: Uuid }>(
    `SELECT d.id ${FROM_DOC}
       JOIN documents.versions v ON v.tenant_id = d.tenant_id AND v.document_id = d.id AND v.version_no = d.current_version_no
      WHERE d.tenant_id = $1 AND d.status = 'ACTIVE' AND ${visible} AND v.sha256 = ${sha} AND v.state = 'ACTIVE'
        AND d.category_id = ${cat}::uuid AND d.owner_type = ${ownerType} AND d.owner_id IS NOT DISTINCT FROM ${ownerId}::uuid ${exclude}
      ORDER BY d.created_at LIMIT 1`,
    p.values,
  );
  return r?.id ?? null;
}

// ---------------------------------------------------------------------------
// Écritures
// ---------------------------------------------------------------------------

export interface NewDocument {
  id: Uuid;
  kind: DocumentKind;
  categoryId: Uuid;
  title: string;
  description: string | null;
  tags: readonly string[];
  metadata: Readonly<Record<string, string | number | boolean>>;
  ownerType: DocumentOwnerType;
  ownerId: Uuid | null;
  visibility: DocumentVisibility;
  fileName: string;
  extension: string;
  mime: string;
  sizeBytes: number;
  expiresOn: string | null;
  alertDays: readonly number[] | null;
  createdBy: Uuid;
  searchText: string;
}

export async function insertDocument(tx: Tx, tenantId: Uuid, d: NewDocument, now: Date): Promise<void> {
  await tx.query(
    `INSERT INTO documents.documents (id, tenant_id, kind, category_id, title, description, tags, metadata, owner_type, owner_id, visibility, status,
        current_version_no, version_count, current_file_name, current_extension, current_mime, current_size_bytes, expires_on, alert_days,
        created_by, created_at, updated_by, updated_at, search_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, 'ACTIVE', 1, 1, $12, $13, $14, $15, $16::date, $17, $18, $19, $18, $19, documents.normalize_search($20))`,
    [d.id, tenantId, d.kind, d.categoryId, d.title, d.description, [...d.tags], JSON.stringify(d.metadata), d.ownerType, d.ownerId, d.visibility,
      d.fileName, d.extension, d.mime, d.sizeBytes, d.expiresOn, d.alertDays ? [...d.alertDays] : null, d.createdBy, now, d.searchText],
  );
}

export interface VersionRow {
  id: Uuid;
  documentId: Uuid;
  versionNo: number;
  storageKey: string;
  fileName: string;
  extension: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  scanStatus: "CLEAN" | "UNSCANNED";
  scanEngine: string | null;
  note: string | null;
  uploadedBy: Uuid;
  createdAt: Date;
  state: "ACTIVE" | "PURGED";
  renditionKey: string | null;
}

type RawVersion = Omit<VersionRow, "sizeBytes"> & { sizeBytes: string };

const VERSION_COLS = `id, document_id AS "documentId", version_no AS "versionNo", storage_key AS "storageKey", file_name AS "fileName", extension,
  detected_mime AS "mime", size_bytes::text AS "sizeBytes", sha256, scan_status AS "scanStatus", scan_engine AS "scanEngine", note,
  uploaded_by AS "uploadedBy", created_at AS "createdAt", state, rendition_key AS "renditionKey"`;

const toVersion = (r: RawVersion): VersionRow => ({ ...r, sizeBytes: Number(r.sizeBytes) });

export interface NewVersion {
  id: Uuid;
  documentId: Uuid;
  versionNo: number;
  storageKey: string;
  fileName: string;
  extension: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  scanStatus: "CLEAN" | "UNSCANNED";
  scanEngine: string | null;
  note: string | null;
  uploadedBy: Uuid;
}

export async function insertVersion(tx: Tx, tenantId: Uuid, v: NewVersion, now: Date): Promise<void> {
  await tx.query(
    `INSERT INTO documents.versions (id, tenant_id, document_id, version_no, storage_key, file_name, extension, detected_mime, size_bytes, sha256,
        scan_status, scan_engine, scanned_at, note, uploaded_by, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
    [v.id, tenantId, v.documentId, v.versionNo, v.storageKey, v.fileName, v.extension, v.mime, v.sizeBytes, v.sha256, v.scanStatus, v.scanEngine,
      v.scanStatus === "CLEAN" ? now : null, v.note, v.uploadedBy, now],
  );
}

export async function listVersions(tx: Tx, tenantId: Uuid, documentId: Uuid): Promise<VersionRow[]> {
  const rows = await tx.many<RawVersion>(`SELECT ${VERSION_COLS} FROM documents.versions WHERE tenant_id = $1 AND document_id = $2 ORDER BY version_no DESC`, [tenantId, documentId]);
  return rows.map(toVersion);
}

export async function getVersion(tx: Tx, tenantId: Uuid, documentId: Uuid, versionNo: number): Promise<VersionRow | null> {
  const row = await tx.queryOne<RawVersion>(`SELECT ${VERSION_COLS} FROM documents.versions WHERE tenant_id = $1 AND document_id = $2 AND version_no = $3`, [tenantId, documentId, versionNo]);
  return row ? toVersion(row) : null;
}

export async function setVersionRendition(tx: Tx, tenantId: Uuid, versionId: Uuid, key: string, now: Date): Promise<void> {
  await tx.query(`UPDATE documents.versions SET rendition_key = $3, rendition_at = $4 WHERE tenant_id = $1 AND id = $2`, [tenantId, versionId, key, now]);
}

/** Tête de version après dépôt d'une nouvelle version. */
export async function updateDocumentHead(
  tx: Tx,
  tenantId: Uuid,
  id: Uuid,
  head: { versionNo: number; fileName: string; extension: string; mime: string; sizeBytes: number; searchText: string; expiresOn?: string | null | undefined; updatedBy: Uuid },
  now: Date,
): Promise<void> {
  const reset = head.expiresOn !== undefined;
  await tx.query(
    `UPDATE documents.documents SET current_version_no = $3, version_count = version_count + 1, current_file_name = $4, current_extension = $5,
        current_mime = $6, current_size_bytes = $7, search_key = documents.normalize_search($8), updated_by = $9, updated_at = $10
        ${reset ? ", expires_on = $11::date, alerts_sent = '{}', expired_notified_at = NULL" : ""}
      WHERE tenant_id = $1 AND id = $2`,
    reset
      ? [tenantId, id, head.versionNo, head.fileName, head.extension, head.mime, head.sizeBytes, head.searchText, head.updatedBy, now, head.expiresOn]
      : [tenantId, id, head.versionNo, head.fileName, head.extension, head.mime, head.sizeBytes, head.searchText, head.updatedBy, now],
  );
}

export interface DocumentPatch {
  title?: string;
  description?: string | null;
  tags?: readonly string[];
  metadata?: Readonly<Record<string, string | number | boolean>>;
  categoryId?: Uuid;
  kind?: DocumentKind;
  visibility?: DocumentVisibility;
  expiresOn?: string | null;
  alertDays?: readonly number[] | null;
  searchText: string;
}

export async function updateDocumentFields(tx: Tx, tenantId: Uuid, id: Uuid, patch: DocumentPatch, by: Uuid, now: Date): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [tenantId, id, by, now];
  const add = (column: string, value: unknown, cast = ""): void => {
    params.push(value);
    sets.push(`${column} = $${params.length}${cast}`);
  };
  if (patch.title !== undefined) add("title", patch.title);
  if (patch.description !== undefined) add("description", patch.description);
  if (patch.tags !== undefined) add("tags", [...patch.tags]);
  if (patch.metadata !== undefined) add("metadata", JSON.stringify(patch.metadata), "::jsonb");
  if (patch.categoryId !== undefined) add("category_id", patch.categoryId);
  if (patch.visibility !== undefined) add("visibility", patch.visibility);
  if (patch.alertDays !== undefined) add("alert_days", patch.alertDays ? [...patch.alertDays] : null);
  if (patch.expiresOn !== undefined) {
    add("expires_on", patch.expiresOn, "::date");
    sets.push("alerts_sent = '{}'", "expired_notified_at = NULL");
  }
  params.push(patch.searchText);
  sets.push(`search_key = documents.normalize_search($${params.length})`);
  await tx.query(`UPDATE documents.documents SET ${sets.join(", ")}, updated_by = $3, updated_at = $4 WHERE tenant_id = $1 AND id = $2`, params);
}

export async function archiveDocument(tx: Tx, tenantId: Uuid, id: Uuid, by: Uuid, reason: string, purgeAfter: Date | null, now: Date): Promise<void> {
  await tx.query(
    `UPDATE documents.documents SET status = 'ARCHIVED', archived_at = $3, archived_by = $4, archive_reason = $5, purge_after = $6, updated_by = $4, updated_at = $3
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id, now, by, reason, purgeAfter],
  );
}

export async function restoreDocument(tx: Tx, tenantId: Uuid, id: Uuid, by: Uuid, now: Date): Promise<void> {
  await tx.query(
    `UPDATE documents.documents SET status = 'ACTIVE', archived_at = NULL, archived_by = NULL, archive_reason = NULL, purge_after = NULL, updated_by = $3, updated_at = $4
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id, by, now],
  );
}

// ---------------------------------------------------------------------------
// Usage de stockage
// ---------------------------------------------------------------------------

export interface UsageCounts {
  usedBytes: number;
  documentCount: number;
  versionCount: number;
  archivedCount: number;
}

export async function usageCounts(tx: Tx, tenantId: Uuid): Promise<UsageCounts> {
  const v = await tx.queryOne<{ used: string; versions: string }>(
    `SELECT coalesce(sum(size_bytes), 0)::text AS used, count(*)::text AS versions FROM documents.versions WHERE tenant_id = $1 AND state = 'ACTIVE'`,
    [tenantId],
  );
  const d = await tx.queryOne<{ docs: string; archived: string }>(
    `SELECT count(*) FILTER (WHERE purged_at IS NULL)::text AS docs, count(*) FILTER (WHERE status = 'ARCHIVED' AND purged_at IS NULL)::text AS archived FROM documents.documents WHERE tenant_id = $1`,
    [tenantId],
  );
  return { usedBytes: Number(v?.used ?? 0), versionCount: Number(v?.versions ?? 0), documentCount: Number(d?.docs ?? 0), archivedCount: Number(d?.archived ?? 0) };
}

// ---------------------------------------------------------------------------
// Alertes d'expiration (job)
// ---------------------------------------------------------------------------

export interface ExpiryCandidate {
  id: Uuid;
  kind: DocumentKind;
  categoryId: Uuid;
  ownerType: DocumentOwnerType;
  ownerId: Uuid | null;
  createdBy: Uuid;
  expiresOn: string;
  alertDays: number[] | null;
  categoryAlertDays: number[] | null;
  alertsSent: number[];
  expiredNotifiedAt: Date | null;
}

/** Documents actifs datés dont l'échéance est ≤ `horizon` (date), par lot et par identifiant croissant. */
export async function listExpiryCandidates(tx: Tx, tenantId: Uuid, horizon: string, afterId: Uuid | null, limit: number): Promise<ExpiryCandidate[]> {
  return tx.many<ExpiryCandidate>(
    `SELECT d.id, d.kind, d.category_id AS "categoryId", d.owner_type AS "ownerType", d.owner_id AS "ownerId", d.created_by AS "createdBy",
            to_char(d.expires_on, 'YYYY-MM-DD') AS "expiresOn", d.alert_days AS "alertDays", c.alert_days AS "categoryAlertDays",
            d.alerts_sent AS "alertsSent", d.expired_notified_at AS "expiredNotifiedAt"
       FROM documents.documents d JOIN documents.categories c ON c.tenant_id = d.tenant_id AND c.id = d.category_id
      WHERE d.tenant_id = $1 AND d.status = 'ACTIVE' AND d.expires_on IS NOT NULL AND d.expires_on <= $2::date AND ($3::uuid IS NULL OR d.id > $3::uuid)
      ORDER BY d.id LIMIT $4`,
    [tenantId, horizon, afterId, limit],
  );
}

export async function markAlerts(tx: Tx, tenantId: Uuid, id: Uuid, sent: readonly number[], expiredAt: Date | null): Promise<void> {
  await tx.query(
    `UPDATE documents.documents SET alerts_sent = $3, expired_notified_at = COALESCE($4, expired_notified_at) WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id, [...sent], expiredAt],
  );
}

// ---------------------------------------------------------------------------
// Purge de rétention (job)
// ---------------------------------------------------------------------------

export interface PurgeCandidate {
  id: Uuid;
  kind: DocumentKind;
  categoryId: Uuid;
  ownerType: DocumentOwnerType;
  ownerId: Uuid | null;
}

export async function listPurgeCandidates(tx: Tx, tenantId: Uuid, now: Date, limit: number): Promise<PurgeCandidate[]> {
  return tx.many<PurgeCandidate>(
    `SELECT id, kind, category_id AS "categoryId", owner_type AS "ownerType", owner_id AS "ownerId" FROM documents.documents
      WHERE tenant_id = $1 AND status = 'ARCHIVED' AND purged_at IS NULL AND purge_after IS NOT NULL AND purge_after <= $2
      ORDER BY purge_after, id LIMIT $3`,
    [tenantId, now, limit],
  );
}

export async function listActiveVersionsOf(tx: Tx, tenantId: Uuid, documentId: Uuid): Promise<VersionRow[]> {
  const rows = await tx.many<RawVersion>(`SELECT ${VERSION_COLS} FROM documents.versions WHERE tenant_id = $1 AND document_id = $2 AND state = 'ACTIVE' ORDER BY version_no`, [tenantId, documentId]);
  return rows.map(toVersion);
}

export async function markVersionsPurged(tx: Tx, tenantId: Uuid, documentId: Uuid, now: Date): Promise<number> {
  const r = await tx.query(
    `UPDATE documents.versions SET state = 'PURGED', purged_at = $3, file_name = 'purgé.' || extension WHERE tenant_id = $1 AND document_id = $2 AND state = 'ACTIVE'`,
    [tenantId, documentId, now],
  );
  return r.rowCount ?? 0;
}

export async function markDocumentPurged(tx: Tx, tenantId: Uuid, documentId: Uuid, now: Date): Promise<void> {
  await tx.query(
    `UPDATE documents.documents SET purged_at = $3, title = '[purgé]', description = NULL, tags = '{}', metadata = '{}'::jsonb, search_key = '',
        current_file_name = 'purgé', updated_at = $3 WHERE tenant_id = $1 AND id = $2`,
    [tenantId, documentId, now],
  );
}
