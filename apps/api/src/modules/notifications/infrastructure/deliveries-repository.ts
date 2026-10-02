/**
 * SQL du journal d'envoi, qui est AUSSI la file d'envoi : `PENDING` -> `SENDING` (bail) -> `SENT` / reprise / `FAILED` /
 * `BOUNCED`. Les insertions se font par lots (`unnest`), les réclamations par `FOR UPDATE SKIP LOCKED` (plusieurs
 * workers sans doublon). L'adresse complète et le contenu rendu sont EFFACÉS à l'état terminal (minimisation).
 */
import type { Tx } from "@ecoledigitale/database";
import type { NotifCategory, NotifChannel, NotifDeliveryStatus, NotifSourceKind } from "@ecoledigitale/contracts/src/v2/notifications";

export interface DeliveryContent {
  subject: string | null;
  text: string;
  /** Lien absolu vers l'application (push, in-app), `null` sinon. */
  link: string | null;
  schoolName: string;
  senderName: string;
  replyTo: string | null;
  legalFooter: string | null;
}

export interface DeliveryDraft {
  id: string;
  createdAt: Date;
  dedupeKey: string;
  groupKey: string | null;
  sourceKind: NotifSourceKind;
  sourceEventId: string | null;
  ruleKey: string | null;
  templateCode: string;
  templateVersion: number;
  locale: string;
  category: NotifCategory;
  urgent: boolean;
  channel: NotifChannel;
  subjectKey: string;
  aliasKeys: readonly string[];
  recipientUserId: string | null;
  recipientMasked: string;
  recipientAddress: string | null;
  addressHash?: string | null;
  content: DeliveryContent | null;
  context: Readonly<Record<string, string>>;
  status: NotifDeliveryStatus;
  skipReason: string | null;
  maxAttempts: number;
  availableAt: Date;
  lastErrorCode?: string | null;
  lastError?: string | null;
  createdBy: string | null;
}

/** Insère par lots ; les doublons (`dedupe_key`) sont ignorés. Retourne les clés réellement insérées. */
export async function insertDeliveries(tx: Tx, tenantId: string, drafts: readonly DeliveryDraft[]): Promise<Set<string>> {
  const inserted = new Set<string>();
  const CHUNK = 500;
  for (let i = 0; i < drafts.length; i += CHUNK) {
    const d = drafts.slice(i, i + CHUNK);
    const rows = await tx.many<{ dedupeKey: string }>(
      `INSERT INTO notifications.deliveries (id, tenant_id, created_at, updated_at, dedupe_key, group_key, source_kind, source_event_id, rule_key,
          template_code, template_version, locale, category, urgent, channel, subject_key, alias_keys, recipient_user_id, recipient_masked,
          recipient_address, address_hash, content, context, status, skip_reason, attempts, max_attempts, available_at, last_error_code, last_error, created_by)
       SELECT x.id, $1, x.created_at, x.created_at, x.dedupe_key, x.group_key, x.source_kind, x.source_event_id, x.rule_key,
              x.template_code, x.template_version, x.locale, x.category, x.urgent, x.channel, x.subject_key, COALESCE(string_to_array(nullif(x.alias_keys, ''), ','), ARRAY[]::text[]),
              x.recipient_user_id, x.recipient_masked, x.recipient_address, x.address_hash, x.content::jsonb, x.context::jsonb, x.status, x.skip_reason, 0,
              x.max_attempts, x.available_at, x.last_error_code, x.last_error, x.created_by
         FROM unnest($2::uuid[], $3::timestamptz[], $4::text[], $5::text[], $6::text[], $7::uuid[], $8::text[], $9::text[], $10::int[], $11::text[],
                     $12::text[], $13::boolean[], $14::text[], $15::text[], $16::text[], $17::uuid[], $18::text[], $19::text[], $20::text[], $21::text[],
                     $22::text[], $23::text[], $24::int[], $25::timestamptz[], $26::text[], $27::text[], $28::uuid[], $29::text[])
              AS x(id, created_at, dedupe_key, group_key, source_kind, source_event_id, rule_key, template_code, template_version, locale,
                   category, urgent, channel, subject_key, alias_keys, recipient_user_id, recipient_masked, recipient_address, content, context,
                   status, skip_reason, max_attempts, available_at, last_error_code, last_error, created_by, address_hash)
       ON CONFLICT (tenant_id, dedupe_key) DO NOTHING
       RETURNING dedupe_key AS "dedupeKey"`,
      [
        tenantId,
        d.map((x) => x.id),
        d.map((x) => x.createdAt),
        d.map((x) => x.dedupeKey),
        d.map((x) => x.groupKey),
        d.map((x) => x.sourceKind),
        d.map((x) => x.sourceEventId),
        d.map((x) => x.ruleKey),
        d.map((x) => x.templateCode),
        d.map((x) => x.templateVersion),
        d.map((x) => x.locale),
        d.map((x) => x.category),
        d.map((x) => x.urgent),
        d.map((x) => x.channel),
        d.map((x) => x.subjectKey),
        d.map((x) => x.aliasKeys.join(",")),
        d.map((x) => x.recipientUserId),
        d.map((x) => x.recipientMasked),
        d.map((x) => x.recipientAddress),
        d.map((x) => (x.content ? JSON.stringify(x.content) : null)),
        d.map((x) => JSON.stringify(x.context)),
        d.map((x) => x.status),
        d.map((x) => x.skipReason),
        d.map((x) => x.maxAttempts),
        d.map((x) => x.availableAt),
        d.map((x) => x.lastErrorCode ?? null),
        d.map((x) => (x.lastError ? x.lastError.slice(0, 500) : null)),
        d.map((x) => x.createdBy),
        d.map((x) => x.addressHash ?? null),
      ],
    );
    for (const r of rows) inserted.add(r.dedupeKey);
  }
  return inserted;
}

// ---------------------------------------------------------------------------
// Plafonds et file
// ---------------------------------------------------------------------------

/** Remises « consommées » dans les dernières 24 h, par canal (envoyées, en cours, rebondies, simulées). */
export async function usedLast24h(tx: Tx, tenantId: string, now: Date): Promise<Record<string, number>> {
  const rows = await tx.many<{ channel: string; n: string }>(
    `SELECT channel, count(*)::text AS n FROM notifications.deliveries
      WHERE tenant_id = $1 AND status IN ('SENDING','SENT','DELIVERED','BOUNCED','SIMULATED') AND updated_at > $2::timestamptz - interval '24 hours'
      GROUP BY channel`,
    [tenantId, now],
  );
  return Object.fromEntries(rows.map((r) => [r.channel, Number(r.n)]));
}

/** Remises récentes (hors ignorées et annulées) par (personne, canal) pour ces clés, sur 24 h. */
export async function subjectCountsLast24h(tx: Tx, tenantId: string, subjectKeys: readonly string[], now: Date): Promise<Map<string, number>> {
  if (subjectKeys.length === 0) return new Map();
  const rows = await tx.many<{ subjectKey: string; channel: string; n: string }>(
    `SELECT subject_key AS "subjectKey", channel, count(*)::text AS n FROM notifications.deliveries
      WHERE tenant_id = $1 AND subject_key = ANY($2::text[]) AND status NOT IN ('SKIPPED','CANCELLED') AND created_at > $3::timestamptz - interval '24 hours'
      GROUP BY subject_key, channel`,
    [tenantId, [...subjectKeys], now],
  );
  return new Map(rows.map((r) => [`${r.subjectKey}|${r.channel}`, Number(r.n)]));
}

export async function countPending(tx: Tx, tenantId: string): Promise<number> {
  const r = await tx.queryOne<{ n: string }>(`SELECT count(*)::text AS n FROM notifications.deliveries WHERE tenant_id = $1 AND status = 'PENDING'`, [tenantId]);
  return Number(r?.n ?? 0);
}

export interface ClaimedDelivery {
  id: string;
  createdAt: Date;
  dedupeKey: string;
  groupKey: string | null;
  sourceKind: NotifSourceKind;
  ruleKey: string | null;
  templateCode: string;
  templateVersion: number;
  category: NotifCategory;
  urgent: boolean;
  channel: NotifChannel;
  subjectKey: string;
  aliasKeys: string[];
  recipientUserId: string | null;
  recipientAddress: string | null;
  content: DeliveryContent | null;
  context: Record<string, string>;
  attempts: number;
  maxAttempts: number;
}

const CLAIM_COLS = `d.id, d.created_at AS "createdAt", d.dedupe_key AS "dedupeKey", d.group_key AS "groupKey", d.source_kind AS "sourceKind",
  d.rule_key AS "ruleKey", d.template_code AS "templateCode", d.template_version AS "templateVersion", d.category, d.urgent, d.channel,
  d.subject_key AS "subjectKey", d.alias_keys AS "aliasKeys", d.recipient_user_id AS "recipientUserId", d.recipient_address AS "recipientAddress",
  d.content, d.context, d.attempts, d.max_attempts AS "maxAttempts"`;

/**
 * Réclame jusqu'à `limit` remises dues d'un canal (urgentes d'abord) : `PENDING` échues, ou `SENDING` dont le bail a expiré
 * (worker tué). Pose un bail, incrémente `attempts`. `SKIP LOCKED` : deux workers ne prennent jamais la même remise.
 */
export async function claimDue(tx: Tx, tenantId: string, channel: NotifChannel, now: Date, leaseUntil: Date, limit: number): Promise<ClaimedDelivery[]> {
  if (limit <= 0) return [];
  return tx.many<ClaimedDelivery>(
    `WITH due AS (
       SELECT id FROM notifications.deliveries
        WHERE tenant_id = $1 AND channel = $2
          AND ((status = 'PENDING' AND available_at <= $3) OR (status = 'SENDING' AND locked_until < $3))
        ORDER BY urgent DESC, available_at, id
        LIMIT $5
        FOR UPDATE SKIP LOCKED
     )
     UPDATE notifications.deliveries d SET status = 'SENDING', attempts = d.attempts + 1, locked_until = $4, updated_at = $3
       FROM due WHERE d.tenant_id = $1 AND d.id = due.id
     RETURNING ${CLAIM_COLS}`,
    [tenantId, channel, now, leaseUntil, limit],
  );
}

/** Canaux ayant des remises à traiter (évite de réclamer canal par canal sans objet). */
export async function channelsWithDueWork(tx: Tx, tenantId: string, now: Date): Promise<NotifChannel[]> {
  const rows = await tx.many<{ channel: NotifChannel }>(
    `SELECT DISTINCT channel FROM notifications.deliveries
      WHERE tenant_id = $1 AND ((status = 'PENDING' AND available_at <= $2) OR (status = 'SENDING' AND locked_until < $2))`,
    [tenantId, now],
  );
  return rows.map((r) => r.channel);
}

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

export async function markSent(tx: Tx, tenantId: string, id: string, input: { status: "SENT" | "SIMULATED"; providerId: string | null; cost: { amount: number; currency: string } | null; at: Date }): Promise<void> {
  await tx.query(
    `UPDATE notifications.deliveries SET status = $3, provider_id = $4, cost_amount = $5, cost_currency = $6, sent_at = $7, updated_at = $7,
        locked_until = NULL, recipient_address = NULL, content = NULL, last_error_code = NULL, last_error = NULL
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id, input.status, input.providerId, input.cost?.amount ?? null, input.cost?.currency ?? null, input.at],
  );
}

export async function markRetry(tx: Tx, tenantId: string, id: string, input: { availableAt: Date; code: string; message: string; at: Date }): Promise<void> {
  await tx.query(
    `UPDATE notifications.deliveries SET status = 'PENDING', available_at = $3, last_error_code = $4, last_error = $5, locked_until = NULL, updated_at = $6
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id, input.availableAt, input.code, input.message.slice(0, 500), input.at],
  );
}

export async function markTerminal(tx: Tx, tenantId: string, id: string, input: { status: "FAILED" | "BOUNCED"; code: string; message: string; at: Date }): Promise<void> {
  await tx.query(
    `UPDATE notifications.deliveries SET status = $3, last_error_code = $4, last_error = $5, locked_until = NULL, updated_at = $6,
        recipient_address = NULL, content = NULL
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id, input.status, input.code, input.message.slice(0, 500), input.at],
  );
}

export async function markSkipped(tx: Tx, tenantId: string, id: string, input: { status: "SKIPPED" | "CANCELLED"; reason: string; at: Date }): Promise<void> {
  await tx.query(
    `UPDATE notifications.deliveries SET status = $3, skip_reason = $4, locked_until = NULL, updated_at = $5, recipient_address = NULL, content = NULL
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id, input.status, input.reason, input.at],
  );
}

/** Annule les remises EN ATTENTE d'un regroupement (relances d'une facture soldée). Retourne le nombre annulé. */
export async function cancelPendingByGroup(tx: Tx, tenantId: string, groupKey: string, reason: string, at: Date): Promise<number> {
  const r = await tx.query(
    `UPDATE notifications.deliveries SET status = 'CANCELLED', skip_reason = $3, updated_at = $4, recipient_address = NULL, content = NULL
      WHERE tenant_id = $1 AND group_key = $2 AND status = 'PENDING'`,
    [tenantId, groupKey, reason, at],
  );
  return r.rowCount ?? 0;
}

export async function cancelPendingById(tx: Tx, tenantId: string, id: string, reason: string, at: Date): Promise<boolean> {
  const r = await tx.query(
    `UPDATE notifications.deliveries SET status = 'CANCELLED', skip_reason = $3, updated_at = $4, recipient_address = NULL, content = NULL
      WHERE tenant_id = $1 AND id = $2 AND status = 'PENDING'`,
    [tenantId, id, reason, at],
  );
  return (r.rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Accusés des fournisseurs
// ---------------------------------------------------------------------------

export async function findByProviderId(tx: Tx, tenantId: string, providerId: string): Promise<Array<{ id: string; channel: NotifChannel; status: NotifDeliveryStatus; subjectKey: string; recipientMasked: string; addressHash: string | null }>> {
  return tx.many(
    `SELECT id, channel, status, subject_key AS "subjectKey", recipient_masked AS "recipientMasked", address_hash AS "addressHash" FROM notifications.deliveries
      WHERE tenant_id = $1 AND provider_id = $2`,
    [tenantId, providerId],
  );
}

export async function applyProviderStatus(tx: Tx, tenantId: string, id: string, input: { status: "DELIVERED" | "FAILED" | "BOUNCED"; code: string | null; message: string | null; at: Date }): Promise<void> {
  await tx.query(
    `UPDATE notifications.deliveries SET status = $3, delivered_at = CASE WHEN $3 = 'DELIVERED' THEN $6::timestamptz ELSE delivered_at END,
        last_error_code = COALESCE($4, last_error_code), last_error = COALESCE($5, last_error), updated_at = $6
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id, input.status, input.code, input.message?.slice(0, 500) ?? null, input.at],
  );
}

// ---------------------------------------------------------------------------
// Journal (lecture)
// ---------------------------------------------------------------------------

export interface JournalRow {
  id: string;
  createdAt: Date;
  channel: NotifChannel;
  category: NotifCategory;
  templateCode: string;
  templateVersion: number;
  sourceKind: NotifSourceKind;
  ruleKey: string | null;
  status: NotifDeliveryStatus;
  skipReason: string | null;
  urgent: boolean;
  recipientMasked: string;
  recipientUserId: string | null;
  attempts: number;
  maxAttempts: number;
  availableAt: Date;
  sentAt: Date | null;
  lastErrorCode: string | null;
  lastError: string | null;
  providerId: string | null;
  costAmount: string | null;
  costCurrency: string | null;
  sourceEventId: string | null;
}

export interface JournalFilter {
  channel?: NotifChannel | undefined;
  status?: NotifDeliveryStatus | undefined;
  category?: NotifCategory | undefined;
  templateCode?: string | undefined;
  sourceKind?: NotifSourceKind | undefined;
  ruleKey?: string | undefined;
  userId?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  cursor?: { t: string; id: string } | null | undefined;
  limit: number;
}

export async function listJournal(tx: Tx, tenantId: string, f: JournalFilter): Promise<JournalRow[]> {
  return tx.many<JournalRow>(
    `SELECT id, created_at AS "createdAt", channel, category, template_code AS "templateCode", template_version AS "templateVersion",
            source_kind AS "sourceKind", rule_key AS "ruleKey", status, skip_reason AS "skipReason", urgent, recipient_masked AS "recipientMasked",
            recipient_user_id AS "recipientUserId", attempts, max_attempts AS "maxAttempts", available_at AS "availableAt", sent_at AS "sentAt",
            last_error_code AS "lastErrorCode", last_error AS "lastError", provider_id AS "providerId", cost_amount::text AS "costAmount",
            cost_currency AS "costCurrency", source_event_id AS "sourceEventId"
       FROM notifications.deliveries
      WHERE tenant_id = $1
        AND ($2::text IS NULL OR channel = $2) AND ($3::text IS NULL OR status = $3) AND ($4::text IS NULL OR category = $4)
        AND ($5::text IS NULL OR template_code = $5) AND ($6::text IS NULL OR source_kind = $6) AND ($7::text IS NULL OR rule_key = $7)
        AND ($8::uuid IS NULL OR recipient_user_id = $8) AND ($9::timestamptz IS NULL OR created_at >= $9) AND ($10::timestamptz IS NULL OR created_at < $10)
        AND ($11::timestamptz IS NULL OR (created_at, id) < ($11::timestamptz, $12::uuid))
      ORDER BY created_at DESC, id DESC
      LIMIT $13`,
    [tenantId, f.channel ?? null, f.status ?? null, f.category ?? null, f.templateCode ?? null, f.sourceKind ?? null, f.ruleKey ?? null, f.userId ?? null, f.from ?? null, f.to ?? null, f.cursor?.t ?? null, f.cursor?.id ?? null, f.limit],
  );
}

export async function statsSince(tx: Tx, tenantId: string, since: Date): Promise<{ byStatus: Record<string, number>; byChannel: Record<string, number> }> {
  const rows = await tx.many<{ status: string; channel: string; n: string }>(
    `SELECT status, channel, count(*)::text AS n FROM notifications.deliveries WHERE tenant_id = $1 AND created_at >= $2 GROUP BY status, channel`,
    [tenantId, since],
  );
  const byStatus: Record<string, number> = {};
  const byChannel: Record<string, number> = {};
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + Number(r.n);
    byChannel[r.channel] = (byChannel[r.channel] ?? 0) + Number(r.n);
  }
  return { byStatus, byChannel };
}

export interface ChannelStats {
  channel: NotifChannel;
  sent: number;
  failed: number;
  bounced: number;
  skipped: number;
  pending: number;
  oldestPendingAt: Date | null;
  lastErrorCode: string | null;
  lastErrorAt: Date | null;
}

/** État par canal pour la page « canaux et santé » : 24 h glissantes, file, dernière erreur. */
export async function channelStats(tx: Tx, tenantId: string, now: Date): Promise<ChannelStats[]> {
  const rows = await tx.many<{ channel: NotifChannel; sent: string; failed: string; bounced: string; skipped: string; pending: string; oldest: Date | null }>(
    `SELECT channel,
            count(*) FILTER (WHERE status IN ('SENT','DELIVERED','SIMULATED') AND updated_at > $2::timestamptz - interval '24 hours')::text AS sent,
            count(*) FILTER (WHERE status = 'FAILED' AND updated_at > $2::timestamptz - interval '24 hours')::text AS failed,
            count(*) FILTER (WHERE status = 'BOUNCED' AND updated_at > $2::timestamptz - interval '24 hours')::text AS bounced,
            count(*) FILTER (WHERE status = 'SKIPPED' AND updated_at > $2::timestamptz - interval '24 hours')::text AS skipped,
            count(*) FILTER (WHERE status IN ('PENDING','SENDING'))::text AS pending,
            min(available_at) FILTER (WHERE status IN ('PENDING','SENDING')) AS oldest
       FROM notifications.deliveries WHERE tenant_id = $1 GROUP BY channel`,
    [tenantId, now],
  );
  const errors = await tx.many<{ channel: NotifChannel; code: string; at: Date }>(
    `SELECT DISTINCT ON (channel) channel, last_error_code AS code, updated_at AS at FROM notifications.deliveries
      WHERE tenant_id = $1 AND last_error_code IS NOT NULL AND status IN ('FAILED','BOUNCED','PENDING')
      ORDER BY channel, updated_at DESC`,
    [tenantId],
  );
  const errByChannel = new Map(errors.map((e) => [e.channel, e]));
  return rows.map((r) => ({
    channel: r.channel,
    sent: Number(r.sent),
    failed: Number(r.failed),
    bounced: Number(r.bounced),
    skipped: Number(r.skipped),
    pending: Number(r.pending),
    oldestPendingAt: r.oldest,
    lastErrorCode: errByChannel.get(r.channel)?.code ?? null,
    lastErrorAt: errByChannel.get(r.channel)?.at ?? null,
  }));
}

/** Purge des remises terminales plus anciennes que la rétention (jamais une remise en attente). Retourne le nombre supprimé. */
export async function purgeTerminalBefore(tx: Tx, tenantId: string, before: Date): Promise<number> {
  const r = await tx.query(
    `DELETE FROM notifications.deliveries WHERE tenant_id = $1 AND created_at < $2 AND status NOT IN ('PENDING','SENDING')`,
    [tenantId, before],
  );
  return r.rowCount ?? 0;
}
