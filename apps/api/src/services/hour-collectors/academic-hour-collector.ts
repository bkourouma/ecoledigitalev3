import type { PoolClient } from "pg";
import type { HourCollectionScope, HourCollector, HourRecord } from "./types";
import { heureDejaPayeeSQL } from "./heures-consommees";

/**
 * Heures de l'Académique — séances de présence enseignant.
 *
 * La requête reprend la sémantique de celle qui vivait dans
 * `payment-calculator.ts` (statut `completed`, `session_date` dans la période,
 * durée = `duration_hours`) avec deux changements délibérés :
 *
 *   1. UNE requête pour toute la période au lieu d'une par enseignant — le
 *      calculateur bouclait sur les enseignants, ce qui ne tient pas à l'échelle
 *      visée (SC-006).
 *   2. `attendanceSessionId` est renseigné à sa place, et non plus glissé dans
 *      `teachingHoursId`. C'est précisément l'erreur qui rendait le chemin
 *      horaire inopérant : la FK de `payment_hour_details` pointe sur
 *      `teaching_hours`, jamais sur `teacher_attendance_sessions` (écart E4).
 *
 * Comme le collecteur professionnel, il écarte les séances DÉJÀ CONSOMMÉES par
 * un autre bulletin (`heures-consommees.ts`) : une heure n'est payable qu'une
 * fois, quelles que soient les dates couvertes par les périodes.
 *
 * `teaching_hours` — l'autre table d'heures, alimentée par
 * `/teaching-hours/from-assignments` — n'est pas collectée ici : le calculateur
 * ne l'a jamais lue, et l'y ajouter changerait des montants académiques sans
 * rapport avec cette feature.
 */
export class AcademicHourCollector implements HourCollector {
  readonly source = "academique" as const;

  async collect(client: PoolClient, scope: HourCollectionScope): Promise<HourRecord[]> {
    const { tenantId, periodStart, periodEnd, teacherIds, periodId } = scope;
    const restrict = Boolean(teacherIds && teacherIds.length > 0);
    const res = await client.query(
      `SELECT
         s.id                       AS attendance_session_id,
         ta.teacher_id              AS teacher_id,
         s.session_date::text       AS session_date,
         s.duration_hours::float8   AS hours,
         cc.course_id               AS course_id,
         c.name                     AS intitule,
         c.code                     AS code
       FROM teacher_attendance_sessions s
       JOIN teacher_assignments ta ON ta.id = s.assignment_id
       LEFT JOIN class_courses  cc ON cc.id = ta.class_course_id
       LEFT JOIN courses        c  ON c.id  = cc.course_id
       WHERE s.tenant_id = $1
         AND s.status = 'completed'
         AND s.session_date BETWEEN $2::date AND $3::date
         AND s.duration_hours IS NOT NULL
         AND ($4::boolean IS FALSE OR ta.teacher_id = ANY($5::uuid[]))
         AND NOT ${heureDejaPayeeSQL("attendance_session_id", "s.id", "s.tenant_id", "$6")}
       ORDER BY ta.teacher_id, s.session_date`,
      [
        tenantId,
        periodStart,
        periodEnd,
        restrict,
        restrict ? teacherIds : [],
        periodId,
      ]
    );

    return res.rows.map((r) => ({
      source: "academique" as const,
      teacherId: r.teacher_id,
      sessionDate: r.session_date,
      hours: Number(r.hours) || 0,
      attendanceSessionId: r.attendance_session_id,
      courseId: r.course_id,
      seanceId: null,
      ecueId: null,
      ueSessionId: null,
      intitule: r.intitule,
      code: r.code,
      cohorteLibelle: null,
    }));
  }
}
