import type { Pool, PoolClient } from "pg";
import type { FastifyBaseLogger } from "fastify";
import type { OwnerAssiduiteQuery, OwnerAssiduiteResponse } from "@ecoledigitale/contracts";

/**
 * Assiduité, occupation des salles et charge enseignante du module professionnel.
 *
 * Trois jeux de données complets en base et aujourd'hui inexploités en agrégat.
 *
 * Deux sources distinctes, à ne pas confondre :
 *  - `professional_emploi_temps` = ce qui est PLANIFIÉ (grille hebdomadaire).
 *    C'est la source de vérité de l'emploi du temps : `professional_course_plannings`
 *    existe (migrations 0072/0073) mais l'UI admin n'y écrit pas.
 *  - `professional_ecue_seances` = ce qui a été TENU, avec le pointage associé
 *    dans `professional_ecue_attendance`.
 *
 * Pièges appliqués :
 *  - §4.4-5  double chemin semestre → sessions. ⚠️ Écart connu : les services
 *            d'emploi du temps ne passent que par `professional_semestre_sessions`.
 *            On applique ici le double chemin partout, y compris sur l'emploi du
 *            temps, pour ne pas sous-compter la charge.
 *  - §4.4-8  requêtage direct de `professional_ue_sessions`.
 *  - §4.4-11 `teachers.user_id` est nullable : un enseignant peut exister sans
 *            compte de connexion. On le remonte plutôt que de l'exclure.
 */

/**
 * Amplitude ouvrable retenue pour le taux d'occupation : 12 créneaux (08h→20h)
 * sur 6 jours. Constante assumée et exposée dans la réponse — sans elle, le taux
 * d'occupation n'est pas interprétable.
 */
export const OWNER_ASSIDUITE_OPEN_HOURS_PER_DAY = 12;
export const OWNER_ASSIDUITE_OPEN_DAYS = 6;
export const OWNER_ASSIDUITE_OPEN_HOURS_PER_WEEK =
  OWNER_ASSIDUITE_OPEN_HOURS_PER_DAY * OWNER_ASSIDUITE_OPEN_DAYS;

/** Profondeur par défaut de l'analyse, en semaines. */
export const OWNER_ASSIDUITE_DEFAULT_WEEKS = 12;

/** Nombre d'étudiants remontés dans le classement des absences. */
export const OWNER_ASSIDUITE_TOP_ABSENT = 20;

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
    log.warn({ err: e, label }, "owner assiduite query failed");
    return [];
  }
}

/**
 * Périmètre des sessions d'UE : filière + semestre.
 * $1 tenant, $2 filiereIds (uuid[] | null), $3 semestreId (uuid | null).
 *
 * `DISTINCT ON (s.id)` : une session rattachée par les deux chemins à la fois
 * apparaîtrait deux fois et doublerait chaque heure comptée.
 */
const SESSION_SCOPE_CTE = `
  session_scope AS (
    SELECT DISTINCT ON (s.id)
           s.id AS ue_session_id, s.ue_id, u.filiere_id, p.name AS filiere_name
    FROM professional_ue_sessions s
    JOIN professional_ue u ON u.id = s.ue_id AND u.tenant_id = s.tenant_id
    JOIN programmes p ON p.id = u.filiere_id AND p.tenant_id = u.tenant_id
    WHERE s.tenant_id = $1::uuid
      AND ($2::uuid[] IS NULL OR u.filiere_id = ANY($2::uuid[]))
      AND ($3::uuid IS NULL OR (
        s.id IN (SELECT ue_session_id FROM professional_semestre_sessions
                 WHERE semestre_id = $3::uuid AND tenant_id = $1::uuid)
        OR s.ue_id IN (SELECT ue_id FROM professional_semestre_ue
                       WHERE semestre_id = $3::uuid AND tenant_id = $1::uuid)
      ))
    ORDER BY s.id
  )`;

/** Durée d'une séance en heures, depuis ses bornes horaires. */
const SEANCE_HOURS = `
  EXTRACT(EPOCH FROM (se.heure_fin - se.heure_debut)) / 3600.0`;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function fetchOwnerAssiduite(
  pool: Pool,
  tenantId: string,
  log: FastifyBaseLogger,
  filters: OwnerAssiduiteQuery
): Promise<OwnerAssiduiteResponse> {
  const filiereIds =
    filters.filiereIds && filters.filiereIds.length > 0 ? filters.filiereIds : null;
  const semestreId = filters.semestreId ?? null;
  const building = filters.building ?? null;

  const today = new Date();
  const defaultStart = new Date(today);
  defaultStart.setUTCDate(defaultStart.getUTCDate() - OWNER_ASSIDUITE_DEFAULT_WEEKS * 7);

  const dateDebut = filters.dateDebut ?? isoDate(defaultStart);
  const dateFin = filters.dateFin ?? isoDate(today);

  // $1 tenant, $2 filiereIds, $3 semestreId, $4 début, $5 fin
  const scopeParams = [tenantId, filiereIds, semestreId, dateDebut, dateFin];

  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

    /* ---- KPI de présence et d'appels ---- */
    const attendanceKpi = await safeQuery<{
      total_records: string | number;
      presentish: string | number;
      absence_hours: string | number | null;
    }>(
      client,
      `WITH ${SESSION_SCOPE_CTE}
       SELECT COUNT(*)::int AS total_records,
              -- Un retard reste une présence : l'étudiant était là.
              COUNT(*) FILTER (WHERE a.statut IN ('present', 'retard'))::int AS presentish,
              COALESCE(SUM(${SEANCE_HOURS}) FILTER (WHERE a.statut = 'absent'), 0)::float8
                AS absence_hours
       FROM professional_ecue_attendance a
       JOIN professional_ecue_seances se
            ON se.id = a.seance_id AND se.tenant_id = a.tenant_id
       JOIN session_scope sc ON sc.ue_session_id = se.ue_session_id
       WHERE a.tenant_id = $1::uuid
         AND se.date >= $4::date AND se.date <= $5::date`,
      scopeParams,
      log,
      "attendanceKpi"
    );

    const callKpi = await safeQuery<{
      total_seances: string | number;
      called: string | number;
    }>(
      client,
      `WITH ${SESSION_SCOPE_CTE}
       SELECT COUNT(*)::int AS total_seances,
              COUNT(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM professional_ecue_attendance a
                WHERE a.seance_id = se.id AND a.tenant_id = se.tenant_id
              ))::int AS called
       FROM professional_ecue_seances se
       JOIN session_scope sc ON sc.ue_session_id = se.ue_session_id
       WHERE se.tenant_id = $1::uuid
         AND se.date >= $4::date AND se.date <= $5::date
         -- Séances passées uniquement : une séance à venir sans appel est normale.
         AND se.date <= CURRENT_DATE`,
      scopeParams,
      log,
      "callKpi"
    );

    /* ---- Heures planifiées et occupation des salles ---- */
    const plannedKpi = await safeQuery<{
      planned_hours: string | number | null;
      active_rooms: string | number;
    }>(
      client,
      `WITH ${SESSION_SCOPE_CTE}
       SELECT (SELECT COALESCE(SUM(
                 EXTRACT(EPOCH FROM (et.heure_fin - et.heure_debut)) / 3600.0
               ), 0)::float8
               FROM professional_emploi_temps et
               JOIN session_scope sc2 ON sc2.ue_session_id = et.ue_session_id
               WHERE et.tenant_id = $1::uuid) AS planned_hours,
              (SELECT COUNT(*) FROM classrooms cr
                WHERE cr.tenant_id = $1::uuid
                  AND COALESCE(cr.is_active, true) = true
                  AND ($4::text IS NULL OR cr.building = $4::text))::int AS active_rooms`,
      // L'emploi du temps est une grille HEBDOMADAIRE : les bornes de dates ne
      // s'y appliquent pas. On ne les passe donc pas — PostgreSQL rejetterait un
      // paramètre fourni mais jamais référencé.
      [tenantId, filiereIds, semestreId, building],
      log,
      "plannedKpi"
    );

    /* ---- Assiduité par semaine et par filière (heatmap) ---- */
    const weekRows = await safeQuery<{
      week_start: Date | string;
      filiere_id: string;
      filiere_name: string;
      total_records: string | number;
      presentish: string | number;
    }>(
      client,
      `WITH ${SESSION_SCOPE_CTE}
       SELECT date_trunc('week', se.date)::date AS week_start,
              sc.filiere_id,
              sc.filiere_name,
              COUNT(*)::int AS total_records,
              COUNT(*) FILTER (WHERE a.statut IN ('present', 'retard'))::int AS presentish
       FROM professional_ecue_attendance a
       JOIN professional_ecue_seances se
            ON se.id = a.seance_id AND se.tenant_id = a.tenant_id
       JOIN session_scope sc ON sc.ue_session_id = se.ue_session_id
       WHERE a.tenant_id = $1::uuid
         AND se.date >= $4::date AND se.date <= $5::date
       GROUP BY week_start, sc.filiere_id, sc.filiere_name
       ORDER BY week_start, sc.filiere_name`,
      scopeParams,
      log,
      "attendanceByWeek"
    );

    /* ---- Tendance globale du taux de présence ---- */
    const trendRows = await safeQuery<{
      week_start: Date | string;
      total_records: string | number;
      presentish: string | number;
    }>(
      client,
      `WITH ${SESSION_SCOPE_CTE}
       SELECT date_trunc('week', se.date)::date AS week_start,
              COUNT(*)::int AS total_records,
              COUNT(*) FILTER (WHERE a.statut IN ('present', 'retard'))::int AS presentish
       FROM professional_ecue_attendance a
       JOIN professional_ecue_seances se
            ON se.id = a.seance_id AND se.tenant_id = a.tenant_id
       JOIN session_scope sc ON sc.ue_session_id = se.ue_session_id
       WHERE a.tenant_id = $1::uuid
         AND se.date >= $4::date AND se.date <= $5::date
       GROUP BY week_start
       ORDER BY week_start`,
      scopeParams,
      log,
      "presenceTrend"
    );

    /* ---- Étudiants les plus absents ---- */
    const absentRows = await safeQuery<{
      student_id: string;
      student_name: string;
      matricule: string | null;
      absence_hours: string | number | null;
      excused_hours: string | number | null;
      absence_count: string | number;
    }>(
      client,
      `WITH ${SESSION_SCOPE_CTE}
       SELECT a.student_id,
              TRIM(COALESCE(us.first_name, '') || ' ' || COALESCE(us.last_name, '')) AS student_name,
              sp.student_number AS matricule,
              COALESCE(SUM(${SEANCE_HOURS}) FILTER (WHERE a.statut = 'absent'), 0)::float8
                AS absence_hours,
              -- Les absences excusées sont distinguées, pas fondues dans le total.
              COALESCE(SUM(${SEANCE_HOURS}) FILTER (WHERE a.statut = 'excuse'), 0)::float8
                AS excused_hours,
              COUNT(*) FILTER (WHERE a.statut = 'absent')::int AS absence_count
       FROM professional_ecue_attendance a
       JOIN professional_ecue_seances se
            ON se.id = a.seance_id AND se.tenant_id = a.tenant_id
       JOIN session_scope sc ON sc.ue_session_id = se.ue_session_id
       JOIN student_profiles sp ON sp.id = a.student_id AND sp.tenant_id = a.tenant_id
       JOIN users us ON us.id = sp.user_id AND us.tenant_id = sp.tenant_id
       WHERE a.tenant_id = $1::uuid
         AND se.date >= $4::date AND se.date <= $5::date
       GROUP BY a.student_id, us.first_name, us.last_name, sp.student_number
       HAVING COUNT(*) FILTER (WHERE a.statut = 'absent') > 0
       ORDER BY absence_hours DESC
       LIMIT $6::int`,
      [...scopeParams, OWNER_ASSIDUITE_TOP_ABSENT],
      log,
      "topAbsentStudents"
    );

    /* ---- Occupation des salles : jour × créneau ---- */
    const occupancyRows = await safeQuery<{
      jour: string | number;
      hour: string | number;
      occupied_rooms: string | number;
      active_rooms: string | number;
    }>(
      client,
      `WITH ${SESSION_SCOPE_CTE},
       active_rooms AS (
         SELECT COUNT(*)::int AS n
         FROM classrooms cr
         WHERE cr.tenant_id = $1::uuid
           AND COALESCE(cr.is_active, true) = true
           AND ($4::text IS NULL OR cr.building = $4::text)
       )
       SELECT et.jour,
              -- Un créneau qui chevauche plusieurs heures est compté sur chacune :
              -- generate_series déplie la plage horaire réservée.
              h.hour,
              COUNT(DISTINCT et.classroom_id)::int AS occupied_rooms,
              (SELECT n FROM active_rooms) AS active_rooms
       FROM professional_emploi_temps et
       JOIN session_scope sc ON sc.ue_session_id = et.ue_session_id
       JOIN classrooms cr ON cr.id = et.classroom_id AND cr.tenant_id = et.tenant_id
       CROSS JOIN LATERAL generate_series(
         EXTRACT(HOUR FROM et.heure_debut)::int,
         GREATEST(EXTRACT(HOUR FROM et.heure_fin)::int - 1,
                  EXTRACT(HOUR FROM et.heure_debut)::int)
       ) AS h(hour)
       WHERE et.tenant_id = $1::uuid
         AND et.classroom_id IS NOT NULL
         AND ($4::text IS NULL OR cr.building = $4::text)
       GROUP BY et.jour, h.hour
       ORDER BY et.jour, h.hour`,
      [tenantId, filiereIds, semestreId, building],
      log,
      "roomOccupancy"
    );

    /* ---- Charge par enseignant ---- */
    const teacherRows = await safeQuery<{
      teacher_id: string;
      teacher_name: string;
      weekly_hours: string | number | null;
      ecue_count: string | number;
      filiere_count: string | number;
      has_user_account: boolean;
    }>(
      client,
      `WITH ${SESSION_SCOPE_CTE}
       SELECT t.id AS teacher_id,
              TRIM(t.first_name || ' ' || t.last_name) AS teacher_name,
              COALESCE(SUM(
                EXTRACT(EPOCH FROM (et.heure_fin - et.heure_debut)) / 3600.0
              ), 0)::float8 AS weekly_hours,
              COUNT(DISTINCT et.ecue_id)::int AS ecue_count,
              COUNT(DISTINCT sc.filiere_id)::int AS filiere_count,
              -- §4.4-11 : un enseignant peut n'avoir aucun compte de connexion.
              (t.user_id IS NOT NULL) AS has_user_account
       FROM professional_emploi_temps et
       JOIN session_scope sc ON sc.ue_session_id = et.ue_session_id
       JOIN teachers t ON t.id = et.enseignant_id AND t.tenant_id = et.tenant_id
       WHERE et.tenant_id = $1::uuid
       GROUP BY t.id, t.first_name, t.last_name, t.user_id
       ORDER BY weekly_hours DESC
       LIMIT 30`,
      [tenantId, filiereIds, semestreId],
      log,
      "teacherLoad"
    );

    /* ---- Usage des salles ---- */
    const roomRows = await safeQuery<{
      classroom_id: string;
      name: string;
      code: string;
      capacity: string | number;
      building: string | null;
      weekly_hours: string | number | null;
    }>(
      client,
      `WITH ${SESSION_SCOPE_CTE}
       SELECT cr.id AS classroom_id, cr.name, cr.code,
              cr.capacity, cr.building,
              COALESCE(SUM(
                EXTRACT(EPOCH FROM (et.heure_fin - et.heure_debut)) / 3600.0
              ), 0)::float8 AS weekly_hours
       FROM classrooms cr
       -- LEFT JOIN : une salle jamais utilisée doit apparaître à 0 h, c'est
       -- précisément l'information recherchée.
       LEFT JOIN professional_emploi_temps et
              ON et.classroom_id = cr.id AND et.tenant_id = cr.tenant_id
       LEFT JOIN session_scope sc ON sc.ue_session_id = et.ue_session_id
       WHERE cr.tenant_id = $1::uuid
         AND COALESCE(cr.is_active, true) = true
         AND ($4::text IS NULL OR cr.building = $4::text)
       GROUP BY cr.id, cr.name, cr.code, cr.capacity, cr.building
       ORDER BY weekly_hours ASC, cr.name`,
      [tenantId, filiereIds, semestreId, building],
      log,
      "roomUsage"
    );

    /* ---- ECUE obligatoires sans enseignant sur session ouverte ---- */
    const unassignedRows = await safeQuery<{
      ue_session_id: string;
      ue_code: string;
      ecue_id: string;
      ecue_code: string;
      ecue_libelle: string;
      filiere_name: string;
    }>(
      client,
      `WITH ${SESSION_SCOPE_CTE}
       SELECT s.id AS ue_session_id, u.code AS ue_code,
              e.id AS ecue_id, e.code AS ecue_code, e.libelle AS ecue_libelle,
              sc.filiere_name
       FROM professional_ue_sessions s
       JOIN session_scope sc ON sc.ue_session_id = s.id
       JOIN professional_ue u ON u.id = s.ue_id AND u.tenant_id = s.tenant_id
       JOIN professional_ue_ecue l ON l.ue_id = u.id AND l.tenant_id = u.tenant_id
       JOIN professional_ecue e ON e.id = l.ecue_id AND e.tenant_id = l.tenant_id
       WHERE s.tenant_id = $1::uuid
         AND s.statut IN ('ouvert', 'complet', 'en_cours')
         AND l.est_obligatoire = true
         AND NOT EXISTS (
           SELECT 1 FROM professional_session_ecue_teachers st
           WHERE st.ue_session_id = s.id AND st.ecue_id = e.id
             AND st.tenant_id = s.tenant_id
         )
       ORDER BY sc.filiere_name, u.code, e.code
       LIMIT 50`,
      [tenantId, filiereIds, semestreId],
      log,
      "unassignedEcue"
    );

    /* ---- Assemblage ---- */
    const att = attendanceKpi[0] ?? { total_records: 0, presentish: 0, absence_hours: 0 };
    const totalRecords = Number(att.total_records) || 0;
    const presentish = Number(att.presentish) || 0;

    const call = callKpi[0] ?? { total_seances: 0, called: 0 };
    const totalSeances = Number(call.total_seances) || 0;

    const planned = plannedKpi[0] ?? { planned_hours: 0, active_rooms: 0 };
    const plannedHours = Number(planned.planned_hours) || 0;
    const activeRooms = Number(planned.active_rooms) || 0;
    const roomCapacityHours = activeRooms * OWNER_ASSIDUITE_OPEN_HOURS_PER_WEEK;

    const rate = (num: number, den: number) =>
      den > 0 ? Math.round((num * 1000) / den) / 10 : 0;

    const dateOf = (d: Date | string) =>
      d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);

    return {
      dateDebut,
      dateFin,
      filiereIds: filiereIds ?? [],
      semestreId,
      building,
      openingHoursPerWeek: OWNER_ASSIDUITE_OPEN_HOURS_PER_WEEK,
      kpis: {
        presenceRate: rate(presentish, totalRecords),
        absenceHours: Math.round((Number(att.absence_hours) || 0) * 10) / 10,
        callRate: rate(Number(call.called) || 0, totalSeances),
        roomOccupancyRate: rate(plannedHours, roomCapacityHours),
        plannedHours: Math.round(plannedHours * 10) / 10,
      },
      attendanceByWeek: weekRows.map((r) => {
        const tot = Number(r.total_records) || 0;
        return {
          weekStart: dateOf(r.week_start),
          filiereId: r.filiere_id,
          filiereName: r.filiere_name,
          presentRate: rate(Number(r.presentish) || 0, tot),
          totalRecords: tot,
        };
      }),
      topAbsentStudents: absentRows.map((r) => ({
        studentId: r.student_id,
        studentName: r.student_name || "—",
        matricule: r.matricule,
        absenceHours: Math.round((Number(r.absence_hours) || 0) * 10) / 10,
        excusedHours: Math.round((Number(r.excused_hours) || 0) * 10) / 10,
        absenceCount: Number(r.absence_count) || 0,
      })),
      roomOccupancy: occupancyRows.map((r) => {
        const occupied = Number(r.occupied_rooms) || 0;
        const active = Number(r.active_rooms) || 0;
        return {
          jour: Number(r.jour) || 1,
          hour: Number(r.hour) || 0,
          occupiedRooms: occupied,
          rate: rate(occupied, active),
        };
      }),
      teacherLoad: teacherRows.map((r) => ({
        teacherId: r.teacher_id,
        teacherName: r.teacher_name || "—",
        weeklyHours: Math.round((Number(r.weekly_hours) || 0) * 10) / 10,
        ecueCount: Number(r.ecue_count) || 0,
        filiereCount: Number(r.filiere_count) || 0,
        hasUserAccount: Boolean(r.has_user_account),
      })),
      roomUsage: roomRows.map((r) => {
        const hours = Number(r.weekly_hours) || 0;
        return {
          classroomId: r.classroom_id,
          name: r.name,
          code: r.code,
          capacity: Number(r.capacity) || 0,
          building: r.building,
          weeklyHours: Math.round(hours * 10) / 10,
          occupancyRate: rate(hours, OWNER_ASSIDUITE_OPEN_HOURS_PER_WEEK),
        };
      }),
      unassignedEcue: unassignedRows.map((r) => ({
        ueSessionId: r.ue_session_id,
        ueCode: r.ue_code,
        ecueId: r.ecue_id,
        ecueCode: r.ecue_code,
        ecueLibelle: r.ecue_libelle,
        filiereName: r.filiere_name,
      })),
      presenceTrend: trendRows.map((r) => {
        const tot = Number(r.total_records) || 0;
        return {
          weekStart: dateOf(r.week_start),
          presentRate: rate(Number(r.presentish) || 0, tot),
          totalRecords: tot,
        };
      }),
    };
  } finally {
    client.release();
  }
}
