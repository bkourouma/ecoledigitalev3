import type { PoolClient } from "pg";
import type {
  CreateProfessionalCoursePlanning,
  UpdateProfessionalCoursePlanning,
} from "@ecoledigitale/contracts";
import {
  ProfessionalBaseService,
  ok,
  fail,
  ServiceResult,
  ServiceFailure,
} from "./professional-base.service";

/**
 * Service Planning des cours — Module Professionnel.
 *
 * Planifie un créneau (date_debut → date_fin) pour un ECUE d'une SESSION d'UE
 * OUVERTE. Accessible aux administrateurs (toutes les sessions ouvertes) et aux
 * enseignants (uniquement les ECUE qui leur sont affectés dans la session).
 */

export interface PlanningScope {
  isAdmin: boolean;
  userId: string;
}

const PLANNING_COLS = `cp.id, cp.tenant_id, cp.ue_session_id, cp.ecue_id, cp.enseignant_id,
  cp.titre, cp.date::text AS date, cp.heure_debut::text AS heure_debut,
  cp.heure_fin::text AS heure_fin, cp.created_at, cp.updated_at`;

export class ProfessionalPlanningService extends ProfessionalBaseService {
  private async getTeacherId(
    client: PoolClient,
    tenantId: string,
    userId: string
  ): Promise<string | null> {
    const res = await client.query(
      `SELECT id FROM teachers WHERE user_id=$1 AND tenant_id=$2 LIMIT 1`,
      [userId, tenantId]
    );
    return res.rowCount && res.rowCount > 0 ? (res.rows[0].id as string) : null;
  }

  /** Sessions OUVERTES sélectionnables (avec leur UE). Enseignant → ses sessions. */
  async listPlannableSessions(tenantId: string, scope: PlanningScope): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const params: any[] = [tenantId];
      let teacherClause = "";
      if (!scope.isAdmin) {
        const teacherId = await this.getTeacherId(client, tenantId, scope.userId);
        if (!teacherId) return ok([]);
        params.push(teacherId);
        teacherClause = `AND EXISTS (
          SELECT 1 FROM professional_session_ecue_teachers a
          WHERE a.ue_session_id = s.id AND a.enseignant_id = $2 AND a.tenant_id = s.tenant_id)`;
      }
      const res = await client.query(
        `SELECT s.id, s.libelle,
                s.date_debut::text AS date_debut, s.date_fin::text AS date_fin,
                s.ue_id, u.code AS ue_code, u.libelle AS ue_libelle
         FROM professional_ue_sessions s
         JOIN professional_ue u ON u.id = s.ue_id AND u.tenant_id = s.tenant_id
         WHERE s.tenant_id = $1 AND s.statut = 'ouvert' ${teacherClause}
         ORDER BY u.code, s.date_debut DESC`,
        params
      );
      return ok(res.rows);
    });
  }

  /** ECUE de l'UE de la session. Enseignant → uniquement ses ECUE dans la session. */
  async listSessionEcue(
    tenantId: string,
    ueSessionId: string,
    scope: PlanningScope
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const params: any[] = [ueSessionId, tenantId];
      let teacherClause = "";
      if (!scope.isAdmin) {
        const teacherId = await this.getTeacherId(client, tenantId, scope.userId);
        if (!teacherId) return ok([]);
        params.push(teacherId);
        teacherClause = `AND EXISTS (
          SELECT 1 FROM professional_session_ecue_teachers a
          WHERE a.ue_session_id = s.id AND a.ecue_id = l.ecue_id
            AND a.enseignant_id = $3 AND a.tenant_id = s.tenant_id)`;
      }
      const res = await client.query(
        `SELECT l.ecue_id AS id, e.code AS ecue_code, e.libelle AS ecue_libelle,
                l.est_obligatoire
         FROM professional_ue_sessions s
         JOIN professional_ue_ecue l ON l.ue_id = s.ue_id AND l.tenant_id = s.tenant_id
         JOIN professional_ecue e ON e.id = l.ecue_id AND e.tenant_id = l.tenant_id
         WHERE s.id = $1 AND s.tenant_id = $2 ${teacherClause}
         ORDER BY l.ordre, e.code`,
        params
      );
      return ok(res.rows);
    });
  }

  /** Plannings (pour le calendrier), filtrables par période. Enseignant → les siens. */
  async listPlannings(
    tenantId: string,
    scope: PlanningScope,
    filters: { from?: string; to?: string } = {}
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const where: string[] = ["cp.tenant_id = $1"];
      const params: any[] = [tenantId];
      let i = 2;

      if (!scope.isAdmin) {
        const teacherId = await this.getTeacherId(client, tenantId, scope.userId);
        if (!teacherId) return ok([]);
        where.push(`EXISTS (
          SELECT 1 FROM professional_session_ecue_teachers a
          WHERE a.ue_session_id = cp.ue_session_id AND a.ecue_id = cp.ecue_id
            AND a.enseignant_id = $${i} AND a.tenant_id = cp.tenant_id)`);
        params.push(teacherId);
        i++;
      }
      if (filters.from) {
        where.push(`cp.date >= $${i++}`);
        params.push(filters.from);
      }
      if (filters.to) {
        where.push(`cp.date <= $${i++}`);
        params.push(filters.to);
      }

      const res = await client.query(
        `SELECT ${PLANNING_COLS},
                e.code AS ecue_code, e.libelle AS ecue_libelle,
                u.code AS ue_code, u.libelle AS ue_libelle,
                s.libelle AS session_libelle
         FROM professional_course_plannings cp
         JOIN professional_ecue e ON e.id = cp.ecue_id AND e.tenant_id = cp.tenant_id
         JOIN professional_ue_sessions s ON s.id = cp.ue_session_id AND s.tenant_id = cp.tenant_id
         JOIN professional_ue u ON u.id = s.ue_id AND u.tenant_id = s.tenant_id
         WHERE ${where.join(" AND ")}
         ORDER BY cp.date, cp.heure_debut`,
        params
      );
      return ok(res.rows);
    });
  }

  /**
   * Vérifie que la session est ouverte et que l'ECUE appartient à son UE.
   * Retourne l'enseignant affecté à cet ECUE dans la session (ou null), ou une
   * erreur. Pour un enseignant non-admin, exige qu'il soit affecté à l'ECUE.
   */
  private async resolveSessionEcue(
    client: PoolClient,
    tenantId: string,
    ueSessionId: string,
    ecueId: string,
    scope: PlanningScope
  ): Promise<{ ok: true; enseignant_id: string | null } | ServiceFailure> {
    const sess = await client.query(
      `SELECT statut FROM professional_ue_sessions WHERE id=$1 AND tenant_id=$2`,
      [ueSessionId, tenantId]
    );
    if (sess.rowCount === 0) return fail("UE_SESSION_NOT_FOUND", "Session introuvable.");
    if (sess.rows[0].statut !== "ouvert") {
      return fail("SESSION_NOT_OPEN", "La session doit être ouverte pour planifier un cours.");
    }
    const link = await client.query(
      `SELECT 1 FROM professional_ue_ecue l
       JOIN professional_ue_sessions s ON s.ue_id = l.ue_id AND s.tenant_id = l.tenant_id
       WHERE s.id=$1 AND l.ecue_id=$2 AND l.tenant_id=$3`,
      [ueSessionId, ecueId, tenantId]
    );
    if (link.rowCount === 0) {
      return fail("ECUE_NOT_IN_SESSION", "Cet ECUE n'appartient pas à l'UE de la session.");
    }
    // Enseignant affecté à cet ECUE dans la session (modèle session↔ECUE).
    const assigned = await client.query(
      `SELECT enseignant_id FROM professional_session_ecue_teachers
       WHERE ue_session_id=$1 AND ecue_id=$2 AND tenant_id=$3`,
      [ueSessionId, ecueId, tenantId]
    );
    const enseignant_id: string | null = assigned.rows[0]?.enseignant_id ?? null;

    if (!scope.isAdmin) {
      const teacherId = await this.getTeacherId(client, tenantId, scope.userId);
      if (!teacherId || enseignant_id !== teacherId) {
        return fail("FORBIDDEN", "Vous n'êtes pas affecté à cet ECUE dans cette session.");
      }
    }
    return { ok: true, enseignant_id };
  }

  async createPlanning(
    tenantId: string,
    input: CreateProfessionalCoursePlanning,
    scope: PlanningScope
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const resolved = await this.resolveSessionEcue(
        client,
        tenantId,
        input.ue_session_id,
        input.ecue_id,
        scope
      );
      if (!("ok" in resolved)) return resolved;
      try {
        const res = await client.query(
          `INSERT INTO professional_course_plannings
             (tenant_id, ue_session_id, ecue_id, enseignant_id, titre, date, heure_debut, heure_fin, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           RETURNING ${PLANNING_COLS.replace(/cp\./g, "")}`,
          [
            tenantId,
            input.ue_session_id,
            input.ecue_id,
            resolved.enseignant_id,
            input.titre ?? null,
            input.date,
            input.heure_debut,
            input.heure_fin ?? null,
            scope.userId || null,
          ]
        );
        return ok(res.rows[0]);
      } catch (e: any) {
        if (e?.code === "23514") {
          return fail("VALIDATION_ERROR", "La date de fin doit être postérieure à la date de début.");
        }
        throw e;
      }
    });
  }

  async updatePlanning(
    tenantId: string,
    id: string,
    input: UpdateProfessionalCoursePlanning,
    scope: PlanningScope
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const cur = await client.query(
        `SELECT ue_session_id, ecue_id FROM professional_course_plannings
         WHERE id=$1 AND tenant_id=$2`,
        [id, tenantId]
      );
      if (cur.rowCount === 0) return fail("PLANNING_NOT_FOUND", "Planning introuvable.");
      const resolved = await this.resolveSessionEcue(
        client,
        tenantId,
        cur.rows[0].ue_session_id,
        cur.rows[0].ecue_id,
        scope
      );
      if (!("ok" in resolved)) return resolved;

      const sets: string[] = [];
      const params: any[] = [];
      let i = 1;
      for (const key of ["titre", "date", "heure_debut", "heure_fin"] as const) {
        if (input[key] !== undefined) {
          sets.push(`${key} = $${i++}`);
          params.push(input[key]);
        }
      }
      if (sets.length === 0) return ok({ id });
      sets.push("updated_at = now()");
      params.push(id, tenantId);
      try {
        const res = await client.query(
          `UPDATE professional_course_plannings SET ${sets.join(", ")}
           WHERE id=$${i++} AND tenant_id=$${i++}
           RETURNING ${PLANNING_COLS.replace(/cp\./g, "")}`,
          params
        );
        return ok(res.rows[0]);
      } catch (e: any) {
        if (e?.code === "23514") {
          return fail("VALIDATION_ERROR", "La date de fin doit être postérieure à la date de début.");
        }
        throw e;
      }
    });
  }

  async deletePlanning(
    tenantId: string,
    id: string,
    scope: PlanningScope
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const cur = await client.query(
        `SELECT ue_session_id, ecue_id FROM professional_course_plannings
         WHERE id=$1 AND tenant_id=$2`,
        [id, tenantId]
      );
      if (cur.rowCount === 0) return fail("PLANNING_NOT_FOUND", "Planning introuvable.");
      const resolved = await this.resolveSessionEcue(
        client,
        tenantId,
        cur.rows[0].ue_session_id,
        cur.rows[0].ecue_id,
        scope
      );
      if (!("ok" in resolved)) return resolved;
      await client.query(
        `DELETE FROM professional_course_plannings WHERE id=$1 AND tenant_id=$2`,
        [id, tenantId]
      );
      return ok({ id });
    });
  }
}
