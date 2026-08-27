import type {
  CreateEmploiTempsSlot,
  UpdateEmploiTempsSlot,
} from "@ecoledigitale/contracts";
import { ProfessionalBaseService, ok, fail, ServiceResult } from "./professional-base.service";

/**
 * Service Emploi du temps hebdomadaire — Module Professionnel.
 *
 * Décrit, pour une ECUE programmée (session d'UE) d'un SEMESTRE, le jour de la
 * semaine et le créneau horaire récurrents. Consulté par filière + semestre.
 */
export class ProfessionalEmploiTempsService extends ProfessionalBaseService {
  /**
   * Session « encore en cours » : ni terminée ni annulée, et dont la date de fin
   * n'est pas dépassée. La date est testée en plus du statut car la finalisation
   * automatique (statut → « termine ») n'a lieu qu'au chargement de la liste des
   * sessions : le statut stocké peut être en retard. Les plannings des sessions
   * terminées restent consultables via la page Consultation.
   */
  private static readonly OPEN_SESSION_CLAUSE =
    `s.statut NOT IN ('termine', 'annule') AND s.date_fin >= CURRENT_DATE`;

  /** Filières ayant au moins une session encore OUVERTE (pour créer un planning). */
  async listFilieresWithOpenSessions(tenantId: string): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const res = await client.query(
        `SELECT DISTINCT p.id, p.name, p.code
         FROM professional_ue_sessions s
         JOIN professional_ue u ON u.id = s.ue_id
         JOIN programmes p ON p.id = u.filiere_id
         WHERE s.tenant_id = $1
           AND ${ProfessionalEmploiTempsService.OPEN_SESSION_CLAUSE}
         ORDER BY p.name`,
        [tenantId]
      );
      return ok(res.rows);
    });
  }

  /**
   * Noms de classe ayant au moins une session encore OUVERTE.
   *
   * Le planning se construit pour un nom de classe précis : deux noms d'une
   * même classe peuvent tourner sur le même semestre avec des ECUE distinctes.
   * Le nom se déduit du libellé de la session, dont on retire le suffixe
   * « — CODE UE ».
   */
  async listNomsWithOpenSessions(tenantId: string): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const res = await client.query(
        `SELECT DISTINCT p.id AS classe_id, p.name AS classe_nom, p.code AS classe_code,
                btrim(split_part(s.libelle, ' ' || chr(8212) || ' ', 1)) AS nom
         FROM professional_ue_sessions s
         JOIN professional_ue u ON u.id = s.ue_id
         JOIN programmes p ON p.id = u.filiere_id
         WHERE s.tenant_id = $1
           AND ${ProfessionalEmploiTempsService.OPEN_SESSION_CLAUSE}
         ORDER BY p.name, nom`,
        [tenantId]
      );
      return ok(res.rows);
    });
  }

  /** Semestres d'une filière ayant au moins une session encore OUVERTE. */
  async listSemestresWithOpenSessions(
    tenantId: string,
    filiereId: string
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const res = await client.query(
        `SELECT DISTINCT sm.id, sm.libelle
         FROM professional_ue_sessions s
         JOIN professional_semestre_sessions ss ON ss.ue_session_id = s.id AND ss.tenant_id = s.tenant_id
         JOIN professional_semestres sm ON sm.id = ss.semestre_id
         WHERE s.tenant_id = $1 AND sm.filiere_id = $2
           AND ${ProfessionalEmploiTempsService.OPEN_SESSION_CLAUSE}
         ORDER BY sm.libelle`,
        [tenantId, filiereId]
      );
      return ok(res.rows);
    });
  }

  /** Filières ayant au moins un créneau d'emploi du temps. */
  async listFilieresWithEmploiTemps(tenantId: string): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const res = await client.query(
        `SELECT DISTINCT p.id, p.name, p.code
         FROM professional_emploi_temps et
         JOIN professional_ue_sessions s ON s.id = et.ue_session_id AND s.tenant_id = et.tenant_id
         JOIN professional_ue u ON u.id = s.ue_id
         JOIN programmes p ON p.id = u.filiere_id
         WHERE et.tenant_id = $1
         ORDER BY p.name`,
        [tenantId]
      );
      return ok(res.rows);
    });
  }

  /** Semestres d'une filière ayant au moins un créneau d'emploi du temps. */
  async listSemestresWithEmploiTemps(
    tenantId: string,
    filiereId: string
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const res = await client.query(
        `SELECT DISTINCT sm.id, sm.libelle,
                (SELECT min(s.date_debut)::text FROM professional_semestre_sessions ss2
                 JOIN professional_ue_sessions s ON s.id = ss2.ue_session_id
                 WHERE ss2.semestre_id = sm.id AND ss2.tenant_id = sm.tenant_id) AS date_debut,
                (SELECT max(s.date_fin)::text FROM professional_semestre_sessions ss2
                 JOIN professional_ue_sessions s ON s.id = ss2.ue_session_id
                 WHERE ss2.semestre_id = sm.id AND ss2.tenant_id = sm.tenant_id) AS date_fin
         FROM professional_emploi_temps et
         JOIN professional_semestre_sessions ss ON ss.ue_session_id = et.ue_session_id AND ss.tenant_id = et.tenant_id
         JOIN professional_semestres sm ON sm.id = ss.semestre_id
         WHERE et.tenant_id = $1 AND sm.filiere_id = $2
         ORDER BY sm.libelle`,
        [tenantId, filiereId]
      );
      return ok(res.rows);
    });
  }

  /**
   * Options de consultation : un enregistrement par couple
   * (nom de classe, semestre) possédant au moins un créneau, avec son année
   * scolaire. La page en dérive ses trois listes déroulantes sans avoir à
   * enchaîner trois requêtes dépendantes.
   *
   * L'année scolaire suit le pivot de septembre, comme partout ailleurs.
   */
  async listConsultationOptions(tenantId: string): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const res = await client.query(
        `SELECT DISTINCT
                p.id AS classe_id, p.name AS classe_nom, p.code AS classe_code,
                btrim(split_part(s.libelle, ' ' || chr(8212) || ' ', 1)) AS nom,
                sm.id AS semestre_id, sm.libelle AS semestre_libelle,
                CASE WHEN EXTRACT(MONTH FROM min(s.date_debut) OVER w) >= 9
                     THEN EXTRACT(YEAR FROM min(s.date_debut) OVER w)::int || '-' ||
                          (EXTRACT(YEAR FROM min(s.date_debut) OVER w)::int + 1)
                     ELSE (EXTRACT(YEAR FROM min(s.date_debut) OVER w)::int - 1) || '-' ||
                          EXTRACT(YEAR FROM min(s.date_debut) OVER w)::int
                END AS annee_scolaire
         FROM professional_emploi_temps et
         JOIN professional_ue_sessions s ON s.id = et.ue_session_id AND s.tenant_id = et.tenant_id
         JOIN professional_ue u ON u.id = s.ue_id
         JOIN programmes p ON p.id = u.filiere_id
         JOIN professional_semestre_sessions ss
           ON ss.ue_session_id = s.id AND ss.tenant_id = s.tenant_id
         JOIN professional_semestres sm ON sm.id = ss.semestre_id
         WHERE et.tenant_id = $1
         WINDOW w AS (PARTITION BY sm.id)
         ORDER BY annee_scolaire DESC, nom, sm.libelle`,
        [tenantId]
      );
      return ok(res.rows);
    });
  }

  /** Liste les emplois du temps d'un semestre = périodes distinctes (date début/fin). */
  async listEmploisDuTemps(tenantId: string, semestreId: string): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const res = await client.query(
        `SELECT et.date_debut::text AS date_debut, et.date_fin::text AS date_fin,
                count(*)::int AS nb_creneaux,
                count(DISTINCT et.ecue_id)::int AS nb_ecue,
                min(et.created_at) AS created_at
         FROM professional_emploi_temps et
         WHERE et.tenant_id = $1
           AND et.ue_session_id IN (
             SELECT ue_session_id FROM professional_semestre_sessions
             WHERE semestre_id = $2 AND tenant_id = $1
           )
         GROUP BY et.date_debut, et.date_fin
         ORDER BY et.date_debut`,
        [tenantId, semestreId]
      );
      return ok(res.rows);
    });
  }

  /** En-tête (filière, semestre, période) + créneaux du semestre, filtrable par période. */
  async getEmploiTemps(
    tenantId: string,
    semestreId: string,
    period?: { date_debut?: string; date_fin?: string }
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const head = await client.query(
        `SELECT sm.id, sm.libelle, p.id AS filiere_id, p.name AS filiere_nom, p.code AS filiere_code,
                (SELECT min(s.date_debut)::text FROM professional_semestre_sessions ss
                 JOIN professional_ue_sessions s ON s.id = ss.ue_session_id
                 WHERE ss.semestre_id = sm.id AND ss.tenant_id = sm.tenant_id) AS date_debut,
                (SELECT max(s.date_fin)::text FROM professional_semestre_sessions ss
                 JOIN professional_ue_sessions s ON s.id = ss.ue_session_id
                 WHERE ss.semestre_id = sm.id AND ss.tenant_id = sm.tenant_id) AS date_fin
         FROM professional_semestres sm
         JOIN programmes p ON p.id = sm.filiere_id
         WHERE sm.id = $1 AND sm.tenant_id = $2`,
        [semestreId, tenantId]
      );
      if (head.rowCount === 0) return fail("SEMESTRE_NOT_FOUND", "Semestre introuvable.");

      // Filtre optionnel par période (= un emploi du temps précis).
      const params: any[] = [tenantId, semestreId];
      let periodFilter = "";
      const hasPeriod = !!(period?.date_debut && period?.date_fin);
      if (hasPeriod) {
        params.push(period!.date_debut, period!.date_fin);
        periodFilter = ` AND et.date_debut = $3 AND et.date_fin = $4`;
      }

      const slots = await client.query(
        `SELECT et.id, et.jour, et.heure_debut::text AS heure_debut, et.heure_fin::text AS heure_fin,
                et.date_debut::text AS date_debut, et.date_fin::text AS date_fin,
                et.ue_session_id, u.code AS ue_code, u.libelle AS ue_libelle,
                btrim(split_part(s.libelle, ' ' || chr(8212) || ' ', 1)) AS classe_nom,
                et.ecue_id, e.code AS ecue_code, e.libelle AS ecue_libelle,
                et.enseignant_id, te.first_name, te.last_name,
                et.classroom_id, c.name AS classroom_name, c.code AS classroom_code
         FROM professional_emploi_temps et
         JOIN professional_ue_sessions s ON s.id = et.ue_session_id AND s.tenant_id = et.tenant_id
         JOIN professional_ue u ON u.id = s.ue_id
         JOIN professional_ecue e ON e.id = et.ecue_id
         LEFT JOIN teachers te ON te.id = et.enseignant_id
         LEFT JOIN classrooms c ON c.id = et.classroom_id
         WHERE et.tenant_id = $1
           AND et.ue_session_id IN (
             SELECT ue_session_id FROM professional_semestre_sessions
             WHERE semestre_id = $2 AND tenant_id = $1
           )${periodFilter}
         ORDER BY et.jour, et.heure_debut`,
        params
      );

      const header = { ...head.rows[0] };
      // Quand on consulte un emploi du temps précis, la période = celle du filtre.
      if (hasPeriod) {
        header.date_debut = period!.date_debut;
        header.date_fin = period!.date_fin;
      }
      return ok({ ...header, slots: slots.rows });
    });
  }

  /** ECUE programmables du semestre (depuis ses sessions), avec enseignant affecté. */
  async listSemestreEcue(tenantId: string, semestreId: string): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const res = await client.query(
        `SELECT s.id AS ue_session_id, u.code AS ue_code, u.libelle AS ue_libelle,
                btrim(split_part(s.libelle, ' ' || chr(8212) || ' ', 1)) AS classe_nom,
                e.id AS ecue_id, e.code AS ecue_code, e.libelle AS ecue_libelle, l.ordre,
                t.enseignant_id, te.first_name, te.last_name
         FROM professional_semestre_sessions ss
         JOIN professional_ue_sessions s ON s.id = ss.ue_session_id AND s.tenant_id = ss.tenant_id
         JOIN professional_ue u ON u.id = s.ue_id
         JOIN professional_ue_ecue l ON l.ue_id = u.id AND l.tenant_id = u.tenant_id
         JOIN professional_ecue e ON e.id = l.ecue_id
         LEFT JOIN professional_session_ecue_teachers t
           ON t.ue_session_id = s.id AND t.ecue_id = e.id AND t.tenant_id = s.tenant_id
         LEFT JOIN teachers te ON te.id = t.enseignant_id
         WHERE ss.semestre_id = $1 AND ss.tenant_id = $2
         ORDER BY u.code, l.ordre, e.code`,
        [semestreId, tenantId]
      );
      return ok(res.rows);
    });
  }

  /** Emploi du temps de l'étudiant connecté. */
  async listStudentEmploiTemps(
    tenantId: string,
    userId: string
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const sp = await client.query(
        `SELECT id FROM student_profiles WHERE user_id=$1 AND tenant_id=$2 LIMIT 1`,
        [userId, tenantId]
      );
      const studentId =
        sp.rowCount && sp.rowCount > 0 ? (sp.rows[0].id as string) : null;
      if (!studentId) return fail("NOT_FOUND", "Profil étudiant introuvable.");
      return ok(await this.queryEmploiTempsForStudent(client, tenantId, studentId));
    });
  }

  /**
   * Emploi du temps d'un enfant, pour son parent : même grille que celle de
   * l'espace étudiant, à condition que le lien parent-enfant existe.
   */
  async listChildEmploiTemps(
    tenantId: string,
    parentUserId: string,
    childId: string
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const link = await client.query(
        `SELECT 1 FROM student_parents
         WHERE parent_id = $1 AND student_id = $2 AND tenant_id = $3
         LIMIT 1`,
        [parentUserId, childId, tenantId]
      );
      if (!link.rowCount) {
        return fail("FORBIDDEN", "Cet élève n'est pas rattaché à votre compte.");
      }
      return ok(await this.queryEmploiTempsForStudent(client, tenantId, childId));
    });
  }

  /**
   * Créneaux des cohortes où l'élève est inscrit (confirmé/terminé). La Conduite
   * (note de comportement, pas une matière) est exclue.
   */
  private async queryEmploiTempsForStudent(
    client: any,
    tenantId: string,
    studentId: string
  ): Promise<any[]> {
      const res = await client.query(
        `SELECT et.id, et.jour,
                et.heure_debut::text AS heure_debut, et.heure_fin::text AS heure_fin,
                et.date_debut::text AS date_debut, et.date_fin::text AS date_fin,
                et.ecue_id, e.code AS ecue_code, e.libelle AS ecue_libelle,
                u.code AS ue_code, u.libelle AS ue_libelle,
                p.name AS filiere_nom, p.code AS filiere_code,
                btrim(split_part(s.libelle, ' ' || chr(8212) || ' ', 1)) AS classe_nom,
                CASE WHEN EXTRACT(MONTH FROM s.date_debut) >= 9
                     THEN EXTRACT(YEAR FROM s.date_debut)::int || '-' ||
                          (EXTRACT(YEAR FROM s.date_debut)::int + 1)
                     ELSE (EXTRACT(YEAR FROM s.date_debut)::int - 1) || '-' ||
                          EXTRACT(YEAR FROM s.date_debut)::int
                END AS annee_scolaire,
                sm.id AS semestre_id, sm.libelle AS semestre_libelle,
                et.enseignant_id, te.first_name, te.last_name,
                et.classroom_id, c.name AS classroom_name, c.code AS classroom_code
         FROM professional_emploi_temps et
         JOIN professional_ue_sessions s ON s.id = et.ue_session_id AND s.tenant_id = et.tenant_id
         JOIN professional_ue u ON u.id = s.ue_id
         JOIN programmes p ON p.id = u.filiere_id
         JOIN professional_ecue e ON e.id = et.ecue_id
         JOIN professional_enrollments en ON en.ue_session_id = s.id
              AND en.student_id = $2 AND en.statut IN ('confirmee','terminee')
         LEFT JOIN teachers te ON te.id = et.enseignant_id
         LEFT JOIN classrooms c ON c.id = et.classroom_id
         -- Rattachement au semestre : en LEFT, un créneau non rattaché ne doit
         -- pas disparaître de l'emploi du temps.
         LEFT JOIN professional_semestre_sessions ss
                ON ss.ue_session_id = s.id AND ss.tenant_id = s.tenant_id
         LEFT JOIN professional_semestres sm ON sm.id = ss.semestre_id
         WHERE et.tenant_id = $1
           AND NOT (e.libelle ILIKE 'conduite%' OR e.code ILIKE '%EC-CON%')
         ORDER BY et.jour, et.heure_debut`,
        [tenantId, studentId]
      );
      return res.rows;
  }

  /** Vérifie que l'ECUE est bien rattachée à l'UE de la session. */
  private async validEcueForSession(
    client: any,
    tenantId: string,
    ueSessionId: string,
    ecueId: string
  ): Promise<boolean> {
    const res = await client.query(
      `SELECT 1
       FROM professional_ue_sessions s
       JOIN professional_ue_ecue l ON l.ue_id = s.ue_id AND l.tenant_id = s.tenant_id
       WHERE s.id = $1 AND s.tenant_id = $2 AND l.ecue_id = $3`,
      [ueSessionId, tenantId, ecueId]
    );
    return (res.rowCount ?? 0) > 0;
  }

  async createSlot(
    tenantId: string,
    input: CreateEmploiTempsSlot,
    createdBy?: string
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const valid = await this.validEcueForSession(client, tenantId, input.ue_session_id, input.ecue_id);
      if (!valid) return fail("ECUE_NOT_IN_SESSION", "L'ECUE ne fait pas partie de cette session.");
      if (input.heure_fin <= input.heure_debut)
        return fail("VALIDATION_ERROR", "L'heure de fin doit suivre l'heure de début.");
      if (input.date_fin < input.date_debut)
        return fail("VALIDATION_ERROR", "La date de fin doit être postérieure ou égale à la date de début.");
      const res = await client.query(
        `INSERT INTO professional_emploi_temps
           (tenant_id, ue_session_id, ecue_id, enseignant_id, classroom_id, jour, heure_debut, heure_fin, date_debut, date_fin, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id`,
        [
          tenantId,
          input.ue_session_id,
          input.ecue_id,
          input.enseignant_id ?? null,
          input.classroom_id ?? null,
          input.jour,
          input.heure_debut,
          input.heure_fin,
          input.date_debut,
          input.date_fin,
          createdBy ?? null,
        ]
      );
      return ok({ id: res.rows[0].id });
    });
  }

  async updateSlot(
    tenantId: string,
    id: string,
    input: UpdateEmploiTempsSlot
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const sets: string[] = [];
      const params: any[] = [];
      let i = 1;
      for (const key of ["jour", "heure_debut", "heure_fin", "date_debut", "date_fin", "enseignant_id", "classroom_id"] as const) {
        if (input[key] !== undefined) {
          sets.push(`${key} = $${i++}`);
          params.push(input[key]);
        }
      }
      if (sets.length === 0) return ok({ id });
      sets.push("updated_at = now()");
      params.push(id, tenantId);
      const res = await client.query(
        `UPDATE professional_emploi_temps SET ${sets.join(", ")}
         WHERE id = $${i++} AND tenant_id = $${i}
         RETURNING id`,
        params
      );
      if (res.rowCount === 0) return fail("SLOT_NOT_FOUND", "Créneau introuvable.");
      return ok({ id });
    });
  }

  async deleteSlot(tenantId: string, id: string): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const res = await client.query(
        `DELETE FROM professional_emploi_temps WHERE id = $1 AND tenant_id = $2 RETURNING id`,
        [id, tenantId]
      );
      if (res.rowCount === 0) return fail("SLOT_NOT_FOUND", "Créneau introuvable.");
      return ok({ id });
    });
  }
}
