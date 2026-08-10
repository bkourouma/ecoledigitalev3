import type { Pool, PoolClient } from "pg";
import type {
  OwnerRecrutementQuery,
  OwnerRecrutementResponse,
} from "@ecoledigitale/contracts";
import type { FastifyBaseLogger } from "fastify";

/**
 * Entonnoir des inscriptions en ligne.
 *
 * `registration_requests` est une table riche dont aucun indicateur n'est tiré
 * aujourd'hui : l'API expose déjà un `pendingCount` qui n'est affiché nulle part.
 *
 * Limite du modèle, exposée à l'écran : aucune colonne ne trace l'ENVOI des
 * identifiants. La dernière étape de l'entonnoir mesure la présence de
 * `users.initial_password` — donc « identifiants générés », pas « transmis ».
 */

/** Profondeur par défaut de l'analyse, en jours. */
export const OWNER_RECRUTEMENT_DEFAULT_DAYS = 180;

/** Nombre de motifs de rejet remontés. */
export const OWNER_RECRUTEMENT_TOP_REASONS = 10;

// Dérivés du contrat de réponse plutôt que des schémas Zod : ces types restent
// alignés automatiquement si les énumérations du contrat évoluent, sans importer
// de valeur runtime dans un service qui n'en a pas besoin.
type AccountType = NonNullable<OwnerRecrutementResponse["accountType"]>;
type RequestStatus = NonNullable<OwnerRecrutementResponse["status"]>;

async function safeQuery<T>(
  client: PoolClient,
  sql: string,
  params: unknown[],
  log: FastifyBaseLogger,
  label: string
): Promise<T[]> {
  try {
    const r = await client.query<T>(sql, params);
    return r.rows;
  } catch (e) {
    log.warn({ err: e, label }, "owner recrutement query failed");
    return [];
  }
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Périmètre commun.
 * $1 tenant, $2 début, $3 fin, $4 accountType (text | null), $5 status (text | null).
 *
 * La borne de fin est inclusive côté métier : on compare sur la date, pas
 * l'horodatage, pour qu'une demande déposée le dernier jour à 23h entre bien
 * dans le périmètre.
 */
const REQUEST_FILTER = `
      AND rr.created_at::date >= $2::date
      AND rr.created_at::date <= $3::date
      AND ($4::text IS NULL OR rr.account_type = $4::text)
      AND ($5::text IS NULL OR rr.status = $5::text)`;

export async function fetchOwnerRecrutement(
  pool: Pool,
  tenantId: string,
  log: FastifyBaseLogger,
  filters: OwnerRecrutementQuery
): Promise<OwnerRecrutementResponse> {
  const today = new Date();
  const defaultStart = new Date(today);
  defaultStart.setUTCDate(defaultStart.getUTCDate() - OWNER_RECRUTEMENT_DEFAULT_DAYS);

  const dateDebut = filters.dateDebut ?? isoDate(defaultStart);
  const dateFin = filters.dateFin ?? isoDate(today);
  const accountType = filters.accountType ?? null;
  const status = filters.status ?? null;

  const params = [tenantId, dateDebut, dateFin, accountType, status];

  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

    /* ---- KPI et entonnoir ---- */
    const kpiRows = await safeQuery<{
      received: string | number;
      approved: string | number;
      rejected: string | number;
      pending: string | number;
      accounts_created: string | number;
      credentials_issued: string | number;
      avg_days: string | number | null;
    }>(
      client,
      `SELECT COUNT(*)::int AS received,
              COUNT(*) FILTER (WHERE rr.status = 'approved')::int AS approved,
              COUNT(*) FILTER (WHERE rr.status = 'rejected')::int AS rejected,
              COUNT(*) FILTER (WHERE rr.status = 'pending')::int AS pending,
              COUNT(*) FILTER (WHERE rr.created_user_id IS NOT NULL)::int AS accounts_created,
              -- Dernière marche de l'entonnoir : le compte a bien un mot de passe
              -- initial généré. Rien en base ne dit s'il a été transmis.
              COUNT(*) FILTER (
                WHERE rr.created_user_id IS NOT NULL
                  AND EXISTS (SELECT 1 FROM users u
                               WHERE u.id = rr.created_user_id
                                 AND u.tenant_id = rr.tenant_id
                                 AND u.initial_password IS NOT NULL)
              )::int AS credentials_issued,
              AVG(EXTRACT(EPOCH FROM (rr.reviewed_at - rr.created_at)) / 86400.0)
                FILTER (WHERE rr.reviewed_at IS NOT NULL)::float8 AS avg_days
       FROM registration_requests rr
       WHERE rr.tenant_id = $1::uuid ${REQUEST_FILTER}`,
      params,
      log,
      "kpis"
    );

    const k = kpiRows[0] ?? {
      received: 0,
      approved: 0,
      rejected: 0,
      pending: 0,
      accounts_created: 0,
      credentials_issued: 0,
      avg_days: null,
    };
    const received = Number(k.received) || 0;
    const approved = Number(k.approved) || 0;
    const rejected = Number(k.rejected) || 0;
    // Les demandes encore en attente ne sont pas des refus : elles sortent du ratio.
    const decided = approved + rejected;

    /* ---- Demandes par semaine et par type ---- */
    const weeklyRows = await safeQuery<{
      week_start: Date | string;
      student: string | number;
      parent: string | number;
    }>(
      client,
      `SELECT date_trunc('week', rr.created_at)::date AS week_start,
              COUNT(*) FILTER (WHERE rr.account_type = 'student')::int AS student,
              COUNT(*) FILTER (WHERE rr.account_type = 'parent')::int AS parent
       FROM registration_requests rr
       WHERE rr.tenant_id = $1::uuid ${REQUEST_FILTER}
       GROUP BY week_start
       ORDER BY week_start`,
      params,
      log,
      "weekly"
    );

    /* ---- Répartition par statut ---- */
    const statusRows = await safeQuery<{ status: string; count: string | number }>(
      client,
      `SELECT rr.status, COUNT(*)::int AS count
       FROM registration_requests rr
       WHERE rr.tenant_id = $1::uuid ${REQUEST_FILTER}
       GROUP BY rr.status
       ORDER BY count DESC`,
      params,
      log,
      "byStatus"
    );

    /* ---- Délais de traitement ---- */
    const delayRows = await safeQuery<{ bucket: string; count: string | number }>(
      client,
      `WITH treated AS (
         SELECT EXTRACT(EPOCH FROM (rr.reviewed_at - rr.created_at)) / 3600.0 AS hours
         FROM registration_requests rr
         WHERE rr.tenant_id = $1::uuid ${REQUEST_FILTER}
           AND rr.reviewed_at IS NOT NULL
           -- Un reviewed_at antérieur au dépôt est une incohérence de données :
           -- on l'écarte plutôt que de produire une tranche négative.
           AND rr.reviewed_at >= rr.created_at
       )
       SELECT b.bucket, COUNT(t.hours)::int AS count
       FROM (VALUES ('<24h', 0), ('1-3j', 1), ('3-7j', 2), ('>7j', 3)) AS b(bucket, ord)
       LEFT JOIN treated t ON b.bucket = CASE
              WHEN t.hours < 24  THEN '<24h'
              WHEN t.hours < 72  THEN '1-3j'
              WHEN t.hours < 168 THEN '3-7j'
              ELSE '>7j' END
       GROUP BY b.bucket, b.ord
       ORDER BY b.ord`,
      params,
      log,
      "processingDelays"
    );

    /* ---- Motifs de rejet ---- */
    const reasonRows = await safeQuery<{ reason: string; count: string | number }>(
      client,
      `SELECT TRIM(rr.rejection_reason) AS reason, COUNT(*)::int AS count
       FROM registration_requests rr
       WHERE rr.tenant_id = $1::uuid ${REQUEST_FILTER}
         AND rr.status = 'rejected'
         AND NULLIF(TRIM(rr.rejection_reason), '') IS NOT NULL
       GROUP BY TRIM(rr.rejection_reason)
       ORDER BY count DESC, reason
       LIMIT $6::int`,
      [...params, OWNER_RECRUTEMENT_TOP_REASONS],
      log,
      "rejectionReasons"
    );

    /* ---- Niveaux souhaités ---- */
    const levelRows = await safeQuery<{ level: string; count: string | number }>(
      client,
      `-- Champ libre du formulaire public, stocké en JSONB : on normalise la casse
       -- et les espaces, sinon « Terminale » et « terminale » comptent séparément.
       SELECT INITCAP(TRIM(rr.details->>'currentYear')) AS level, COUNT(*)::int AS count
       FROM registration_requests rr
       WHERE rr.tenant_id = $1::uuid ${REQUEST_FILTER}
         AND NULLIF(TRIM(rr.details->>'currentYear'), '') IS NOT NULL
       GROUP BY INITCAP(TRIM(rr.details->>'currentYear'))
       ORDER BY count DESC, level
       LIMIT 15`,
      params,
      log,
      "desiredLevels"
    );

    return {
      dateDebut,
      dateFin,
      accountType: accountType as AccountType | null,
      status: status as RequestStatus | null,
      kpis: {
        received,
        approvalRate: decided > 0 ? Math.round((approved * 1000) / decided) / 10 : 0,
        avgProcessingDays:
          k.avg_days === null ? null : Math.round((Number(k.avg_days) || 0) * 10) / 10,
        pending: Number(k.pending) || 0,
      },
      funnel: {
        received,
        approved,
        accountsCreated: Number(k.accounts_created) || 0,
        credentialsIssued: Number(k.credentials_issued) || 0,
      },
      weekly: weeklyRows.map((r) => ({
        weekStart:
          r.week_start instanceof Date
            ? r.week_start.toISOString().slice(0, 10)
            : String(r.week_start).slice(0, 10),
        student: Number(r.student) || 0,
        parent: Number(r.parent) || 0,
      })),
      byStatus: statusRows
        .filter((r): r is typeof r & { status: RequestStatus } =>
          ["pending", "approved", "rejected"].includes(r.status)
        )
        .map((r) => ({ status: r.status, count: Number(r.count) || 0 })),
      processingDelays: delayRows.map((r) => ({
        bucket: r.bucket as OwnerRecrutementResponse["processingDelays"][number]["bucket"],
        count: Number(r.count) || 0,
      })),
      rejectionReasons: reasonRows.map((r) => ({
        reason: r.reason,
        count: Number(r.count) || 0,
      })),
      desiredLevels: levelRows.map((r) => ({
        level: r.level,
        count: Number(r.count) || 0,
      })),
    };
  } finally {
    client.release();
  }
}
