import type { PoolClient } from "pg";
import { ProfessionalBaseService, ok, fail, ServiceResult } from "./professional-base.service";

/**
 * Supports de cours rattachés à l'ECUE (feature 030) — pérennes d'une cohorte à
 * l'autre, avec tracking des consultations (lecture seule via le site).
 *
 * Accès : admin · enseignant d'une cohorte de l'UE contenant l'ECUE · étudiant
 * inscrit (confirmée/terminée) à une telle cohorte · parent d'un tel étudiant.
 */

export type MaterialKind = "pdf" | "pptx" | "video" | "image" | "autre";

export interface EcueMaterialInsert {
  ecueId: string;
  titre: string;
  description?: string | null;
  kind: MaterialKind;
  storagePath: string;
  mimeType: string;
  fileSize: number;
  uploadedBy: string;
}

export class ProfessionalEcueMaterialsService extends ProfessionalBaseService {
  /** Liste des supports d'une ECUE. */
  async listForEcue(
    tenantId: string,
    userId: string,
    ecueId: string,
    isAdmin: boolean
  ): Promise<ServiceResult<any[]>> {
    return this.withTenant(tenantId, async (client) => {
      if (!(await this.ecueExists(client, ecueId))) return fail("ECUE_NOT_FOUND", "ECUE introuvable.");

      if (!isAdmin) {
        const okAccess = await this.userHasAccessToEcue(client, userId, ecueId);
        if (!okAccess) return fail("FORBIDDEN", "Vous n'avez pas accès à cette ECUE.");
      }

      const res = await client.query(
        `SELECT m.id, m.ecue_id, m.titre, m.description, m.kind,
                m.mime_type, m.file_size, m.uploaded_by, m.created_at,
                COALESCE(v.nb_views, 0)::int AS nb_views,
                COALESCE(v.nb_unique, 0)::int AS nb_viewers
         FROM professional_ecue_materials m
         LEFT JOIN LATERAL (
           SELECT count(*) AS nb_views, count(DISTINCT user_id) AS nb_unique
           FROM professional_ecue_material_views
           WHERE material_id = m.id
         ) v ON true
         WHERE m.ecue_id = $1
         ORDER BY m.created_at DESC`,
        [ecueId]
      );
      return ok(res.rows);
    });
  }

  /** Insertion d'un support après upload. */
  async insertMaterial(
    tenantId: string,
    input: EcueMaterialInsert
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      if (!(await this.ecueExists(client, input.ecueId))) return fail("ECUE_NOT_FOUND", "ECUE introuvable.");
      const res = await client.query(
        `INSERT INTO professional_ecue_materials
           (tenant_id, ecue_id, titre, description, kind,
            storage_path, mime_type, file_size, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id, ecue_id, titre, description, kind,
                   mime_type, file_size, uploaded_by, created_at`,
        [
          tenantId,
          input.ecueId,
          input.titre,
          input.description ?? null,
          input.kind,
          input.storagePath,
          input.mimeType,
          input.fileSize,
          input.uploadedBy,
        ]
      );
      return ok(res.rows[0]);
    });
  }

  /**
   * Suppression d'un support — retourne le storage_path pour supprimer le fichier.
   * Un enseignant ne peut supprimer que les supports d'une ECUE qu'il enseigne.
   */
  async deleteMaterial(
    tenantId: string,
    materialId: string,
    opts?: { userId?: string; isAdmin?: boolean }
  ): Promise<ServiceResult<{ storage_path: string }>> {
    return this.withTenant(tenantId, async (client) => {
      const cur = await client.query(
        `SELECT ecue_id FROM professional_ecue_materials WHERE id=$1 AND tenant_id=$2`,
        [materialId, tenantId]
      );
      if (cur.rowCount === 0) return fail("NOT_FOUND", "Support introuvable.");
      if (opts && opts.isAdmin === false) {
        const owns = await this.teacherTeachesEcue(client, opts.userId ?? "", cur.rows[0].ecue_id);
        if (!owns) {
          return fail("FORBIDDEN", "Vous ne pouvez supprimer que les supports de vos ECUE.");
        }
      }
      const res = await client.query(
        `DELETE FROM professional_ecue_materials
         WHERE id=$1 AND tenant_id=$2 RETURNING storage_path`,
        [materialId, tenantId]
      );
      if (res.rowCount === 0) return fail("NOT_FOUND", "Support introuvable.");
      return ok(res.rows[0]);
    });
  }

  /** Récupère un support pour lecture si l'utilisateur y a accès. */
  async getMaterialForRead(
    tenantId: string,
    userId: string,
    materialId: string,
    isAdmin: boolean
  ): Promise<
    ServiceResult<{ ecue_id: string; titre: string; storage_path: string; mime_type: string; kind: MaterialKind }>
  > {
    return this.withTenant(tenantId, async (client) => {
      const res = await client.query(
        `SELECT id, ecue_id, titre, storage_path, mime_type, kind
         FROM professional_ecue_materials
         WHERE id=$1 AND tenant_id=$2`,
        [materialId, tenantId]
      );
      if (res.rowCount === 0) return fail("NOT_FOUND", "Support introuvable.");
      const m = res.rows[0];
      if (isAdmin) return ok(m);
      if (await this.userHasAccessToEcue(client, userId, m.ecue_id)) return ok(m);
      return fail("FORBIDDEN", "Vous n'avez pas accès à ce support.");
    });
  }

  /** Enregistre une consultation. */
  async logView(tenantId: string, materialId: string, userId: string): Promise<void> {
    await this.withTenant(tenantId, async (client) => {
      await client.query(
        `INSERT INTO professional_ecue_material_views (tenant_id, material_id, user_id)
         VALUES ($1,$2,$3)`,
        [tenantId, materialId, userId]
      );
    });
  }

  /** Liste des consultations d'un support (admin et enseignant de l'ECUE). */
  async listViews(
    tenantId: string,
    userId: string,
    materialId: string,
    isAdmin: boolean
  ): Promise<ServiceResult<any[]>> {
    return this.withTenant(tenantId, async (client) => {
      const mRes = await client.query(
        `SELECT ecue_id FROM professional_ecue_materials WHERE id=$1 AND tenant_id=$2`,
        [materialId, tenantId]
      );
      if (mRes.rowCount === 0) return fail("NOT_FOUND", "Support introuvable.");
      const ecueId = mRes.rows[0].ecue_id as string;

      if (!isAdmin) {
        if (!(await this.teacherTeachesEcue(client, userId, ecueId))) {
          return fail("FORBIDDEN", "Statistiques réservées aux admins et aux enseignants de l'ECUE.");
        }
      }

      const res = await client.query(
        `SELECT v.id, v.user_id, v.opened_at,
                u.first_name, u.last_name, u.email,
                ARRAY(
                  SELECT r.key FROM user_roles ur
                  JOIN roles r ON r.id = ur.role_id
                  WHERE ur.user_id = u.id AND r.tenant_id = $1
                ) AS roles
         FROM professional_ecue_material_views v
         JOIN users u ON u.id = v.user_id
         WHERE v.material_id = $2
         ORDER BY v.opened_at DESC`,
        [tenantId, materialId]
      );
      return ok(res.rows);
    });
  }

  /** Statistiques agrégées par utilisateur pour un support. */
  async listViewsAggregated(
    tenantId: string,
    userId: string,
    materialId: string,
    isAdmin: boolean
  ): Promise<ServiceResult<any[]>> {
    const allRes = await this.listViews(tenantId, userId, materialId, isAdmin);
    if (!allRes.success) return allRes;
    const byUser = new Map<string, any>();
    for (const row of allRes.data) {
      const prev = byUser.get(row.user_id);
      if (!prev) {
        byUser.set(row.user_id, {
          user_id: row.user_id,
          first_name: row.first_name,
          last_name: row.last_name,
          email: row.email,
          roles: row.roles,
          nb_views: 1,
          first_opened_at: row.opened_at,
          last_opened_at: row.opened_at,
        });
      } else {
        prev.nb_views += 1;
        if (row.opened_at < prev.first_opened_at) prev.first_opened_at = row.opened_at;
        if (row.opened_at > prev.last_opened_at) prev.last_opened_at = row.opened_at;
      }
    }
    return ok(
      Array.from(byUser.values()).sort((a, b) =>
        b.last_opened_at.localeCompare(a.last_opened_at)
      )
    );
  }

  private async ecueExists(client: PoolClient, ecueId: string): Promise<boolean> {
    const r = await client.query(`SELECT 1 FROM professional_ecue WHERE id=$1 LIMIT 1`, [ecueId]);
    return (r.rowCount ?? 0) > 0;
  }

  /** Enseignant d'une cohorte de l'UE contenant l'ECUE (ou d'une séance de l'ECUE). */
  private async teacherTeachesEcue(
    client: PoolClient,
    userId: string,
    ecueId: string
  ): Promise<boolean> {
    if (!userId) return false;
    const r = await client.query(
      `SELECT 1
       FROM professional_session_ecue_teachers a
       JOIN teachers t ON t.id = a.enseignant_id
       WHERE a.ecue_id = $1 AND t.user_id = $2
       UNION
       SELECT 1
       FROM professional_ue_ecue l
       JOIN professional_ue_sessions s ON s.ue_id = l.ue_id
       JOIN teachers t ON t.id = s.enseignant_id
       WHERE l.ecue_id = $1 AND t.user_id = $2
       UNION
       SELECT 1 FROM professional_ecue_seances se
       JOIN teachers t ON t.id = se.enseignant_id
       WHERE se.ecue_id = $1 AND t.user_id = $2
       LIMIT 1`,
      [ecueId, userId]
    );
    return (r.rowCount ?? 0) > 0;
  }

  /** Enseignant, étudiant inscrit, ou parent d'un inscrit pour cette ECUE. */
  private async userHasAccessToEcue(
    client: PoolClient,
    userId: string,
    ecueId: string
  ): Promise<boolean> {
    if (!userId) return false;
    if (await this.teacherTeachesEcue(client, userId, ecueId)) return true;

    const sRes = await client.query(
      `SELECT 1 FROM professional_enrollments e
       JOIN student_profiles sp ON sp.id = e.student_id
       JOIN professional_ue_sessions s ON s.id = e.ue_session_id
       JOIN professional_ue_ecue l ON l.ue_id = s.ue_id
       WHERE l.ecue_id = $1 AND sp.user_id = $2
         AND e.statut IN ('confirmee','terminee')
       LIMIT 1`,
      [ecueId, userId]
    );
    if ((sRes.rowCount ?? 0) > 0) return true;

    const pRes = await client.query(
      `SELECT 1 FROM professional_enrollments e
       JOIN professional_ue_sessions s ON s.id = e.ue_session_id
       JOIN professional_ue_ecue l ON l.ue_id = s.ue_id
       JOIN student_parents pr ON pr.student_id = e.student_id AND pr.tenant_id = e.tenant_id
       WHERE l.ecue_id = $1 AND pr.parent_id = $2
         AND e.statut IN ('confirmee','terminee')
       LIMIT 1`,
      [ecueId, userId]
    );
    return (pRes.rowCount ?? 0) > 0;
  }
}
