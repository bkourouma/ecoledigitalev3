import { ProfessionalBaseService, ok, fail, ServiceResult } from "./professional-base.service";
import { getLiveKitService, LiveKitService } from "./livekit.service";

/**
 * Séances visio professionnelles — utilise LiveKit via la table `live_sessions`
 * (parent column `professional_ecue_seance_id`, feature 030).
 *
 * Une séance d'ECUE (`professional_ecue_seances`) peut héberger PLUSIEURS
 * séances visio (matin/après-midi, rattrapage…) — pas de contrainte UNIQUE.
 */

export interface CreateLiveSessionInput {
  titre?: string | null;
  scheduled_at?: string | null;
  recording_enabled?: boolean;
}

export class ProfessionalLiveSessionsService extends ProfessionalBaseService {
  private lk(): LiveKitService | null {
    try {
      return getLiveKitService();
    } catch {
      return null;
    }
  }

  /**
   * Liste les séances visio rattachées à une séance d'ECUE. Accès :
   *  - admin
   *  - enseignant de la séance ou de la cohorte
   *  - étudiant inscrit (confirmée/terminée) à la cohorte
   *  - parent d'un tel étudiant
   */
  async list(
    tenantId: string,
    userId: string,
    seanceId: string,
    isAdmin: boolean
  ): Promise<ServiceResult<any[]>> {
    return this.withTenant(tenantId, async (client) => {
      if (!isAdmin) {
        const accessRes = await client.query(
          `SELECT 1
           FROM professional_ecue_seances se
           JOIN professional_ue_sessions us ON us.id = se.ue_session_id
           WHERE se.id = $1 AND se.tenant_id = $2
             AND (
               EXISTS (SELECT 1 FROM teachers t
                       WHERE t.user_id = $3 AND (
                         t.id IN (se.enseignant_id, us.enseignant_id)
                         OR EXISTS (SELECT 1 FROM professional_session_ecue_teachers a
                                    WHERE a.ue_session_id = se.ue_session_id
                                      AND a.ecue_id = se.ecue_id
                                      AND a.enseignant_id = t.id)
                       ))
               OR EXISTS (
                 SELECT 1 FROM professional_enrollments e
                 JOIN student_profiles sp ON sp.id = e.student_id
                 WHERE e.ue_session_id = se.ue_session_id AND sp.user_id = $3
                   AND e.statut IN ('confirmee','terminee')
               )
               OR EXISTS (
                 SELECT 1 FROM professional_enrollments e
                 JOIN student_parents pr ON pr.student_id = e.student_id AND pr.tenant_id = e.tenant_id
                 WHERE e.ue_session_id = se.ue_session_id AND pr.parent_id = $3
                   AND e.statut IN ('confirmee','terminee')
               )
             ) LIMIT 1`,
          [seanceId, tenantId, userId]
        );
        if (accessRes.rowCount === 0) {
          return fail("FORBIDDEN", "Vous n'avez pas accès à cette séance.");
        }
      }
      const res = await client.query(
        `SELECT ls.id, ls.room_name, ls.status, ls.recording_enabled,
                ls.created_by_user_id, ls.started_at, ls.ended_at,
                ls.created_at, ls.updated_at,
                u.first_name AS creator_first_name, u.last_name AS creator_last_name
         FROM live_sessions ls
         LEFT JOIN users u ON u.id = ls.created_by_user_id
         WHERE ls.tenant_id = $1
           AND ls.professional_ecue_seance_id = $2
         ORDER BY ls.created_at DESC`,
        [tenantId, seanceId]
      );
      return ok(res.rows);
    });
  }

  /** Crée une séance visio LiveKit pour une séance d'ECUE donnée. */
  async create(
    tenantId: string,
    userId: string,
    seanceId: string,
    input: CreateLiveSessionInput
  ): Promise<ServiceResult<any>> {
    const lk = this.lk();
    if (!lk) return fail("LIVEKIT_NOT_CONFIGURED", "LiveKit n'est pas configuré sur ce serveur.");

    return this.withTenant(tenantId, async (client) => {
      const sr = await client.query(
        `SELECT id FROM professional_ecue_seances WHERE id = $1 AND tenant_id = $2`,
        [seanceId, tenantId]
      );
      if (sr.rowCount === 0) return fail("SEANCE_NOT_FOUND", "Séance introuvable.");

      const idRes = await client.query<{ id: string }>("SELECT uuid_generate_v4() AS id");
      const newId = idRes.rows[0].id;
      const roomName = LiveKitService.buildRoomName(tenantId, newId);

      const ins = await client.query(
        `INSERT INTO live_sessions (
           id, tenant_id, professional_ecue_seance_id, room_name, status,
           recording_enabled, created_by_user_id
         )
         VALUES ($1, $2, $3, $4, 'created', $5, $6)
         RETURNING *`,
        [newId, tenantId, seanceId, roomName, input.recording_enabled ?? true, userId]
      );

      try {
        await lk.createRoom(roomName);
      } catch (err: any) {
        await client.query(`DELETE FROM live_sessions WHERE id = $1`, [newId]);
        return fail("LIVEKIT_UPSTREAM_ERROR", err?.message ?? "Échec de provisionnement LiveKit.");
      }

      return ok(ins.rows[0]);
    });
  }

  /** Renvoie le JWT de connexion pour l'utilisateur courant. */
  async getJoinToken(
    tenantId: string,
    userId: string,
    liveSessionId: string,
    role: "moderator" | "participant",
    displayName: string
  ): Promise<ServiceResult<{ url: string; token: string; roomName: string }>> {
    const lk = this.lk();
    if (!lk) return fail("LIVEKIT_NOT_CONFIGURED", "LiveKit n'est pas configuré sur ce serveur.");

    return this.withTenant(tenantId, async (client) => {
      const r = await client.query(
        `SELECT id, room_name, professional_ecue_seance_id
         FROM live_sessions
         WHERE id = $1 AND tenant_id = $2 AND professional_ecue_seance_id IS NOT NULL`,
        [liveSessionId, tenantId]
      );
      if (r.rowCount === 0) return fail("NOT_FOUND", "Séance visio introuvable.");
      const row = r.rows[0];
      const token = await lk.mintToken({
        roomName: row.room_name,
        identity: userId,
        displayName,
        role,
      });
      return ok({ url: lk.publicUrl(), token, roomName: row.room_name });
    });
  }

  /** Marque la séance visio comme terminée (modérateur). */
  async end(tenantId: string, liveSessionId: string): Promise<ServiceResult<any>> {
    const lk = this.lk();
    return this.withTenant(tenantId, async (client) => {
      const r = await client.query(
        `SELECT id, room_name, status FROM live_sessions
         WHERE id = $1 AND tenant_id = $2 AND professional_ecue_seance_id IS NOT NULL`,
        [liveSessionId, tenantId]
      );
      if (r.rowCount === 0) return fail("NOT_FOUND", "Séance visio introuvable.");
      const row = r.rows[0];
      if (row.status !== "ended") {
        if (lk) {
          try {
            await lk.deleteRoom(row.room_name);
          } catch {
            /* ignore */
          }
        }
        await client.query(
          `UPDATE live_sessions SET status = 'ended', ended_at = now(), updated_at = now()
           WHERE id = $1`,
          [liveSessionId]
        );
      }
      const res = await client.query(`SELECT * FROM live_sessions WHERE id = $1`, [liveSessionId]);
      return ok(res.rows[0]);
    });
  }
}
