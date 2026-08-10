import type { PoolClient } from "pg";
import type {
  CreateProfessionalEcue,
  UpdateProfessionalEcue,
} from "@ecoledigitale/contracts";
import { ProfessionalBaseService, ok, fail, ServiceResult } from "./professional-base.service";

/**
 * Service catalogue ECUE — Module Professionnel (feature 030).
 *
 * L'ECUE (Élément Constitutif d'UE, ex-Matière) est le pôle PÉDAGOGIQUE :
 * code, libellé, type de bilan, statut. Elle NE porte ni prix ni UV (portés par
 * l'UE) et n'est pas rattachée directement à une filière (mutualisation via la
 * liaison `professional_ue_ecue`, cf. professional-ue.service.ts).
 */

// numeric → string par node-pg ; ici l'ECUE n'a pas de colonne numérique métier.
const ECUE_COLS = `id, tenant_id, bilan_type_id, code, libelle, description, credits,
  statut, created_at, updated_at`;

export interface EcueListFilters {
  statut?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

export class ProfessionalCatalogService extends ProfessionalBaseService {
  /* ------------------------------ ECUE -------------------------------- */

  async createEcue(
    tenantId: string,
    input: CreateProfessionalEcue
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      try {
        const res = await client.query(
          `INSERT INTO professional_ecue
             (tenant_id, bilan_type_id, code, libelle, description, credits, statut)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (tenant_id, code) DO NOTHING
           RETURNING ${ECUE_COLS}`,
          [
            tenantId,
            input.bilan_type_id ?? null,
            input.code,
            input.libelle,
            input.description ?? null,
            input.credits ?? null,
            input.statut ?? "actif",
          ]
        );
        if (res.rowCount === 0) {
          return fail("DUPLICATE_CODE", `Une ECUE avec le code "${input.code}" existe déjà.`);
        }
        return ok(res.rows[0]);
      } catch (e: any) {
        if (e?.code === "23503") {
          return fail("VALIDATION_ERROR", "Le type de bilan indiqué est introuvable.");
        }
        throw e;
      }
    });
  }

  async listEcue(
    tenantId: string,
    filters: EcueListFilters
  ): Promise<ServiceResult<any>> {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(1000, Math.max(1, filters.pageSize ?? 20));
    return this.withTenant(tenantId, async (client) => {
      const where: string[] = ["e.tenant_id = $1"];
      const params: any[] = [tenantId];
      let i = 2;
      if (filters.statut) {
        where.push(`e.statut = $${i++}`);
        params.push(filters.statut);
      }
      if (filters.q) {
        where.push(`(e.code ILIKE $${i} OR e.libelle ILIKE $${i})`);
        params.push(`%${filters.q}%`);
        i++;
      }
      const whereSql = where.join(" AND ");
      const countRes = await client.query(
        `SELECT count(*)::int AS total FROM professional_ecue e WHERE ${whereSql}`,
        params
      );
      const total = countRes.rows[0].total as number;
      // Chaque ECUE renvoie aussi les UE qui la mutualisent (pour l'affichage carte/détail).
      const listRes = await client.query(
        `SELECT e.id, e.tenant_id, e.bilan_type_id, e.code, e.libelle, e.description,
                e.credits, e.statut, e.created_at, e.updated_at,
                COALESCE(
                  json_agg(
                    json_build_object('id', u.id, 'code', u.code, 'libelle', u.libelle,
                      'est_obligatoire', l.est_obligatoire, 'coefficient', l.coefficient::float8)
                    ORDER BY u.code
                  ) FILTER (WHERE u.id IS NOT NULL), '[]'
                ) AS ue
         FROM professional_ecue e
         LEFT JOIN professional_ue_ecue l ON l.ecue_id = e.id
         LEFT JOIN professional_ue u ON u.id = l.ue_id
         WHERE ${whereSql}
         GROUP BY e.id
<<<<<<< HEAD
         ORDER BY e.created_at DESC
=======
         ORDER BY e.created_at DESC, e.id
>>>>>>> 030-pedagogie-ue-ecue
         LIMIT $${i++} OFFSET $${i++}`,
        [...params, pageSize, (page - 1) * pageSize]
      );
      return ok({ items: listRes.rows, total, page, pageSize });
    });
  }

  async getEcue(tenantId: string, id: string): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const res = await client.query(
        `SELECT ${ECUE_COLS} FROM professional_ecue WHERE id=$1 AND tenant_id=$2`,
        [id, tenantId]
      );
      if (res.rowCount === 0) return fail("ECUE_NOT_FOUND", "ECUE introuvable.");
      const ue = await this.loadLinkedUe(client, id);
      return ok({ ...res.rows[0], ue });
    });
  }

  /** UE qui mutualisent l'ECUE (id, code, libellé, est_obligatoire, coefficient). */
  private async loadLinkedUe(client: PoolClient, ecueId: string): Promise<any[]> {
    const res = await client.query(
      `SELECT u.id, u.code, u.libelle, l.est_obligatoire, l.coefficient::float8 AS coefficient
       FROM professional_ue_ecue l
       JOIN professional_ue u ON u.id = l.ue_id
       WHERE l.ecue_id = $1
       ORDER BY u.code`,
      [ecueId]
    );
    return res.rows;
  }

  async updateEcue(
    tenantId: string,
    id: string,
    input: UpdateProfessionalEcue
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const sets: string[] = [];
      const params: any[] = [];
      let i = 1;
      const fields: (keyof UpdateProfessionalEcue)[] = [
        "bilan_type_id",
        "code",
        "libelle",
        "description",
        "credits",
        "statut",
      ];
      for (const key of fields) {
        if (input[key] !== undefined) {
          sets.push(`${key} = $${i++}`);
          params.push(input[key]);
        }
      }
      if (sets.length === 0) {
        return this.getEcue(tenantId, id);
      }
      sets.push("updated_at = now()");
      params.push(id, tenantId);
      try {
        const res = await client.query(
          `UPDATE professional_ecue SET ${sets.join(", ")}
           WHERE id=$${i++} AND tenant_id=$${i++} RETURNING ${ECUE_COLS}`,
          params
        );
        if (res.rowCount === 0) return fail("ECUE_NOT_FOUND", "ECUE introuvable.");
        return ok(res.rows[0]);
      } catch (e: any) {
        if (e?.code === "23505") {
          return fail("DUPLICATE_CODE", "Ce code d'ECUE est déjà utilisé.");
        }
        if (e?.code === "23503") {
          return fail("VALIDATION_ERROR", "Le type de bilan indiqué est introuvable.");
        }
        throw e;
      }
    });
  }

  async deactivateEcue(tenantId: string, id: string): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const res = await client.query(
        `UPDATE professional_ecue SET statut='inactif', updated_at=now()
         WHERE id=$1 AND tenant_id=$2 RETURNING ${ECUE_COLS}`,
        [id, tenantId]
      );
      if (res.rowCount === 0) return fail("ECUE_NOT_FOUND", "ECUE introuvable.");
      return ok(res.rows[0]);
    });
  }

  /**
   * Supprime définitivement une ECUE (supports/évaluations liés en cascade).
   * Refusé si l'ECUE est encore rattachée à une UE — détacher la liaison d'abord.
   */
  async deleteEcue(tenantId: string, id: string): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const linked = await client.query(
        `SELECT 1 FROM professional_ue_ecue WHERE ecue_id=$1 AND tenant_id=$2 LIMIT 1`,
        [id, tenantId]
      );
      if ((linked.rowCount ?? 0) > 0) {
        return fail(
          "ECUE_STILL_LINKED",
          "Impossible de supprimer : cette ECUE est rattachée à une ou plusieurs UE. Détachez-la d'abord."
        );
      }
      try {
        const res = await client.query(
          `DELETE FROM professional_ecue WHERE id=$1 AND tenant_id=$2 RETURNING id`,
          [id, tenantId]
        );
        if (res.rowCount === 0) return fail("ECUE_NOT_FOUND", "ECUE introuvable.");
        return ok({ id });
      } catch (e: any) {
        if (e?.code === "23503") {
          return fail(
            "ECUE_STILL_LINKED",
            "Impossible de supprimer : des données liées existent. Désactivez l'ECUE à la place."
          );
        }
        throw e;
      }
    });
  }
}
