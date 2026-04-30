import type { Pool, PoolClient } from "pg";
import type { FastifyBaseLogger } from "fastify";
import type { OwnerFormationsResponse } from "@ecoledigitale/contracts";
import { getTableName, usesSessionBasedProfessionalTraining } from "../utils/table-names";

async function scalarCount(
  client: PoolClient,
  sql: string,
  params: unknown[],
  log: FastifyBaseLogger,
  label: string
): Promise<number> {
  try {
    const r = await client.query<{ v: string | null }>(sql, params);
    return Math.round(parseFloat(r.rows[0]?.v != null ? String(r.rows[0].v) : "0") || 0);
  } catch (e) {
    log.warn({ err: e, label }, "owner formations query failed");
    return 0;
  }
}

async function scalarSum(
  client: PoolClient,
  sql: string,
  params: unknown[],
  log: FastifyBaseLogger,
  label: string
): Promise<number> {
  try {
    const r = await client.query<{ v: string | null }>(sql, params);
    return Math.round((parseFloat(r.rows[0]?.v != null ? String(r.rows[0].v) : "0") || 0) * 100) / 100;
  } catch (e) {
    log.warn({ err: e, label }, "owner formations sum failed");
    return 0;
  }
}

export async function fetchOwnerFormations(
  pool: Pool,
  tenantId: string,
  log: FastifyBaseLogger
): Promise<OwnerFormationsResponse> {
  const sessionMode = usesSessionBasedProfessionalTraining(tenantId);
  const sessionsTable = getTableName(tenantId, "sessions_professionnelles");
  const inscriptionsTable = getTableName(tenantId, "inscriptions_professionnelles");
  const paiementsTable = getTableName(tenantId, "paiements_professionnels");
  const entreprisesTable = getTableName(tenantId, "entreprises_clientes");
  const formateursTable = getTableName(tenantId, "formateurs");

  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

    const activeSessions = await scalarCount(
      client,
      `SELECT COUNT(*)::text AS v FROM ${sessionsTable} WHERE tenant_id = $1::uuid`,
      [tenantId],
      log,
      "formationsSessions"
    );

    const enrollments = await scalarCount(
      client,
      `SELECT COUNT(*)::text AS v FROM ${inscriptionsTable} WHERE tenant_id = $1::uuid`,
      [tenantId],
      log,
      "formationsEnrollments"
    );

    const revenue = await scalarSum(
      client,
      `SELECT COALESCE(SUM(montant), 0)::text AS v
       FROM ${paiementsTable}
       WHERE tenant_id = $1::uuid AND statut = 'valide'::payment_professional_status`,
      [tenantId],
      log,
      "formationsRevenue"
    );

    const companies = await scalarCount(
      client,
      `SELECT COUNT(DISTINCT id)::text AS v FROM ${entreprisesTable} WHERE tenant_id = $1::uuid`,
      [tenantId],
      log,
      "formationsCompanies"
    );

    let activeFormateurs: number | undefined;
    if (sessionMode) {
      activeFormateurs = await scalarCount(
        client,
        `SELECT COUNT(*)::text AS v FROM ${formateursTable} WHERE tenant_id = $1::uuid AND actif = true`,
        [tenantId],
        log,
        "formationsFormateurs"
      );
    }

    return {
      usesSessionBasedProfessionalTraining: sessionMode,
      activeSessions,
      enrollments,
      revenue,
      companies,
      activeFormateurs,
    };
  } finally {
    client.release();
  }
}
